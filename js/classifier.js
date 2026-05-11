// ═══════════════════════════════════════════════════════════
//  classifier.js — TF-IDF + Logistic Regression in the browser
//  Runs the trained emotion_model.json entirely offline.
//  No API key, no network, < 2ms inference.
// ═══════════════════════════════════════════════════════════

import { EMOTION_COLORS } from './config.js';

let _model  = null;   // loaded model JSON
let _ready  = false;  // true once model is loaded
let _loading = false;

// ── Public API ────────────────────────────────────────────

/** Load model from /model/emotion_model.json. Call once on boot. */
export async function loadModel(onProgress = null) {
  if (_ready || _loading) return;
  _loading = true;

  try {
    onProgress?.('Loading emotion model…');

    // Try both path variants to handle different server setups
    let res;
    const paths = ['./model/emotion_model.json', 'model/emotion_model.json', '/model/emotion_model.json'];
    let lastErr;

    for (const path of paths) {
      try {
        console.log(`[classifier] Trying: ${path}`);
        res = await fetch(path);
        if (res.ok) { console.log(`[classifier] Loaded from: ${path}`); break; }
        lastErr = new Error(`HTTP ${res.status} at ${path}`);
        res = null;
      } catch (e) {
        lastErr = e;
        res = null;
      }
    }

    if (!res) throw lastErr || new Error('All model paths failed');

    onProgress?.('Parsing model data…');
    _model = await res.json();
    _ready = true;
    onProgress?.('Model ready ✓');
    console.log(
      `[classifier] Ready | vocab=${Object.keys(_model.vocab).length}` +
      ` | classes=${_model.classes} | accuracy=${_model.accuracy}%`
    );
  } catch (err) {
    console.error('[classifier] Load failed:', err);
    console.error('[classifier] Make sure emotion_model.json is in the model/ folder');
    console.error('[classifier] and you are running via http:// not file://');
    onProgress?.(`Model load failed: ${err.message}`);
    throw err;
  } finally {
    _loading = false;
  }
}

export function isReady() { return _ready; }

/**
 * Predict emotion for a text string.
 * Returns same shape as api.js predictEmotion() so the UI is identical.
 */
export function predict(text) {
  if (!_ready) throw new Error('Model not loaded yet');

  const t0 = performance.now();

  // Step 1: Detect which emotions are explicitly negated in the text
  // e.g. "not sad" → negatedEmotions = Set{'sadness'}
  const negatedEmotions = _detectNegatedEmotions(text);

  // Step 2: Compute TF-IDF vector (with negation-tagged tokens)
  const tfidf  = _computeTfidf(text);

  // Step 3: Get raw logistic regression scores
  let scores = _logisticScores(tfidf);

  // Step 4: Damp negated emotions AND boost their semantic opposites.
  //
  // Opposite emotion map — when X is negated, Y should be boosted:
  //   not happy   → sad       not sad      → joy
  //   not angry   → joy/love  not afraid   → joy
  //   not loving  → sadness   not surprised→ neutral(sadness)
  //
  // Scores are raw logits before softmax, so:
  //   -2.5 suppresses the negated class strongly
  //   +2.0 boosts the opposite class enough to surface it as top result
  const OPPOSITE = {
    joy:      'sadness',
    sadness:  'joy',
    anger:    'joy',
    fear:     'joy',
    love:     'sadness',
    surprise: 'sadness',
  };

  if (negatedEmotions.size > 0) {
    scores = scores.map((score, i) => {
      const cls = _model.classes[i];

      // Suppress the negated emotion
      if (negatedEmotions.has(cls)) return score - 2.5;

      // Boost the opposite of each negated emotion
      for (const negated of negatedEmotions) {
        if (OPPOSITE[negated] === cls) return score + 2.0;
      }

      return score;
    });
  }

  const probs = _softmax(scores);

  // Find top class
  let topIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[topIdx]) topIdx = i;
  }

  const emotion    = _model.classes[topIdx];
  const confidence = Math.round(probs[topIdx] * 100);
  const latencyMs  = Math.round(performance.now() - t0);

  const breakdown = _model.classes.map((cls, i) => ({
    emotion:     cls,
    probability: Math.round(probs[i] * 100),
    color:       EMOTION_COLORS[cls] || '#888',
  })).sort((a, b) => b.probability - a.probability);

  _normalize100(breakdown);

  return {
    emotion,
    confidence,
    emoji:      _emojiMap[emotion] || '🤔',
    latency_ms: latencyMs,
    breakdown,
    source:     'local',
    negated:    negatedEmotions.size > 0 ? [...negatedEmotions] : null,
  };
}

// ── Private: TF-IDF ──────────────────────────────────────

function _computeTfidf(text) {
  const tokens  = _tokenize(text);
  const tf      = _termFreq(tokens);
  const { vocab, idf } = _model;

  // Build sparse vector: index → tfidf value
  const vec = {};
  for (const [term, count] of Object.entries(tf)) {
    const idx = vocab[term];
    if (idx === undefined) continue;
    // sublinear TF: 1 + log(tf)
    const tfVal = 1 + Math.log(count);
    vec[idx] = tfVal * idf[idx];
  }

  // L2 normalize
  let norm = 0;
  for (const v of Object.values(vec)) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const k in vec) vec[k] /= norm;

  return vec;
}

// ── Negation handling ────────────────────────────────────
// Negation words that trigger tagging of following tokens
const NEGATION_WORDS = new Set([
  'not', 'no', 'never', 'neither', 'nor', 'nobody', 'nothing',
  'nowhere', 'hardly', 'scarcely', 'barely', 'without', 'cant',
  'cannot', 'wont', 'dont', 'doesnt', 'didnt', 'isnt', 'arent',
  'wasnt', 'werent', 'havent', 'hasnt', 'hadnt', 'shouldnt',
  'wouldnt', 'couldnt', 'mightnt', 'mustnt', 'neednt',
]);

// Words/punctuation that end the negation scope
const NEGATION_ENDERS = new Set([
  'but', 'although', 'however', 'yet', 'still', 'though',
  'because', 'since', 'while', 'whereas',
]);

/**
 * Tags words following a negation word with NOT_ prefix
 * within a window of up to 4 words.
 * e.g. ["i","am","not","sad"] → ["i","am","not","NOT_sad"]
 * These become distinct tokens so "sad" and "NOT_sad" have
 * different (or zero) weights in the classifier.
 */
function _applyNegation(words) {
  const result  = [];
  let negating  = false;
  let negWindow = 0;

  for (const w of words) {
    // Punctuation embedded as empty strings already filtered;
    // ender words reset negation scope
    if (NEGATION_ENDERS.has(w)) {
      negating = false; negWindow = 0;
      result.push(w);
      continue;
    }
    if (NEGATION_WORDS.has(w)) {
      negating = true; negWindow = 4;
      result.push(w);
      continue;
    }
    if (negating && negWindow > 0) {
      result.push('NOT_' + w);
      negWindow--;
      if (negWindow === 0) negating = false;
    } else {
      result.push(w);
    }
  }
  return result;
}

/**
 * Detect if text contains negation of a specific emotion word.
 * Used by predict() to damp the score of the negated emotion.
 */
function _detectNegatedEmotions(text) {
  const emotionWords = {
    joy:      ['happy','joy','joyful','glad','excited','thrilled','pleased','great','wonderful','fantastic','amazing','delighted','cheerful','ecstatic','content'],
    sadness:  ['sad','sadness','unhappy','depressed','miserable','heartbroken','gloomy','sorrow','grief','crying','cry','tears','upset','disappointed','lonely'],
    anger:    ['angry','anger','furious','mad','rage','hate','annoyed','irritated','frustrated','livid','outraged','disgusted'],
    fear:     ['afraid','fear','scared','terrified','frightened','anxious','nervous','worried','panic','dread','horrified'],
    love:     ['love','loving','adore','cherish','affection','fond','romantic','devoted','caring'],
    surprise: ['surprised','surprise','shocked','amazed','astonished','stunned','unexpected','wow'],
  };

  const negated = new Set();
  const lower = text.toLowerCase().replace(/[^a-z\s]/g, ' ');
  const words = lower.split(/\s+/);

  let negActive = false;
  let negWin    = 0;

  for (const w of words) {
    if (NEGATION_ENDERS.has(w)) { negActive = false; negWin = 0; continue; }
    if (NEGATION_WORDS.has(w))  { negActive = true;  negWin = 4; continue; }

    if (negActive && negWin > 0) {
      // Check if this word is an emotion word
      for (const [emo, wordList] of Object.entries(emotionWords)) {
        if (wordList.includes(w)) negated.add(emo);
      }
      negWin--;
      if (negWin === 0) negActive = false;
    }
  }
  return negated;   // Set of emotion labels that are negated in this text
}

/** Tokenize into unigrams + bigrams (matching sklearn's analyzer) */
function _tokenize(text) {
  // Lowercase, strip accents, split on non-alphanumeric
  const words = text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 0);

  // Apply negation tagging BEFORE building n-grams
  const tagged   = _applyNegation(words);
  const filtered = tagged.filter(w => w.length > 1 || w.startsWith('NOT_'));

  const tokens = [...filtered];
  // bigrams — naturally captures "NOT_sad" pairs e.g. "am NOT_sad"
  for (let i = 0; i < filtered.length - 1; i++) {
    tokens.push(`${filtered[i]} ${filtered[i+1]}`);
  }
  return tokens;
}

function _termFreq(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

// ── Private: Logistic Regression ─────────────────────────

function _logisticScores(vec) {
  const { coef, intercept, classes } = _model;
  return classes.map((_, ci) => {
    let score = intercept[ci];
    for (const [idx, val] of Object.entries(vec)) {
      score += coef[ci][idx] * val;
    }
    return score;
  });
}

function _softmax(scores) {
  const max  = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/** Adjust breakdown so probabilities sum to exactly 100 */
function _normalize100(breakdown) {
  const sum  = breakdown.reduce((a, b) => a + b.probability, 0);
  const diff = 100 - sum;
  if (diff !== 0) breakdown[0].probability += diff;
}

// ── Emoji map ─────────────────────────────────────────────
const _emojiMap = {
  joy: '😄', sadness: '😢', anger: '😠',
  fear: '😨', love: '❤️', surprise: '😮',
};