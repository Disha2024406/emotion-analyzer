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

  const tfidf  = _computeTfidf(text);
  const scores = _logisticScores(tfidf);   // raw log-probs per class
  const probs  = _softmax(scores);         // normalized 0-1

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

  // Normalize so breakdown sums to exactly 100
  _normalize100(breakdown);

  return {
    emotion,
    confidence,
    emoji:      _emojiMap[emotion] || '🤔',
    latency_ms: latencyMs,
    breakdown,
    source:     'local',   // flag so UI can show "Local Model"
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

/** Tokenize into unigrams + bigrams (matching sklearn's analyzer) */
function _tokenize(text) {
  // Lowercase, strip accents, split on non-alphanumeric
  const words = text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1);  // sklearn min_df removes length-1 tokens

  const tokens = [...words];
  // bigrams
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]} ${words[i+1]}`);
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