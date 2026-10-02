// ═══════════════════════════════════════════════════════════
//  deep_analyze.js — Research-Grade Emotion Analysis
//  27-emotion multi-label (GoEmotions taxonomy) via Groq
//  Includes: safety layer, ambiguity score, psychological insight
// ═══════════════════════════════════════════════════════════

import { getApiKey, hasApiKey } from './api.js';
import { MODEL, MODEL_EXTRA_PARAMS } from './config.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// ── GoEmotions 27-class taxonomy with metadata ─────────────
export const EMOTIONS_27 = {
  // Positive
  admiration:    { valence: 'positive', color: '#60a5fa', emoji: '🤩', group: 'appreciation' },
  amusement:     { valence: 'positive', color: '#fbbf24', emoji: '😄', group: 'joy'          },
  approval:      { valence: 'positive', color: '#34d399', emoji: '👍', group: 'appreciation' },
  caring:        { valence: 'positive', color: '#f472b6', emoji: '🤗', group: 'love'         },
  desire:        { valence: 'positive', color: '#f87171', emoji: '😍', group: 'love'         },
  excitement:    { valence: 'positive', color: '#fb923c', emoji: '🤩', group: 'joy'          },
  gratitude:     { valence: 'positive', color: '#a78bfa', emoji: '🙏', group: 'appreciation' },
  joy:           { valence: 'positive', color: '#fde047', emoji: '😊', group: 'joy'          },
  love:          { valence: 'positive', color: '#ec4899', emoji: '❤️', group: 'love'         },
  optimism:      { valence: 'positive', color: '#4ade80', emoji: '🌟', group: 'joy'          },
  pride:         { valence: 'positive', color: '#818cf8', emoji: '😤', group: 'appreciation' },
  relief:        { valence: 'positive', color: '#6ee7b7', emoji: '😮‍💨', group: 'joy'        },
  // Negative
  anger:         { valence: 'negative', color: '#ef4444', emoji: '😠', group: 'anger'        },
  annoyance:     { valence: 'negative', color: '#f97316', emoji: '😒', group: 'anger'        },
  disappointment:{ valence: 'negative', color: '#64748b', emoji: '😞', group: 'sadness'      },
  disapproval:   { valence: 'negative', color: '#dc2626', emoji: '👎', group: 'anger'        },
  disgust:       { valence: 'negative', color: '#84cc16', emoji: '🤢', group: 'anger'        },
  embarrassment: { valence: 'negative', color: '#f43f5e', emoji: '😳', group: 'sadness'      },
  fear:          { valence: 'negative', color: '#c084fc', emoji: '😨', group: 'fear'         },
  grief:         { valence: 'negative', color: '#475569', emoji: '😭', group: 'sadness'      },
  nervousness:   { valence: 'negative', color: '#a8a29e', emoji: '😰', group: 'fear'         },
  remorse:       { valence: 'negative', color: '#6b7280', emoji: '😔', group: 'sadness'      },
  sadness:       { valence: 'negative', color: '#3b82f6', emoji: '😢', group: 'sadness'      },
  // Ambiguous
  confusion:     { valence: 'ambiguous', color: '#d97706', emoji: '😕', group: 'ambiguous'   },
  curiosity:     { valence: 'ambiguous', color: '#06b6d4', emoji: '🤔', group: 'ambiguous'   },
  realization:   { valence: 'ambiguous', color: '#8b5cf6', emoji: '💡', group: 'ambiguous'   },
  surprise:      { valence: 'ambiguous', color: '#10b981', emoji: '😮', group: 'ambiguous'   },
  neutral:       { valence: 'neutral',   color: '#6b7280', emoji: '😐', group: 'neutral'      },
};

// ── System prompt ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are a research-grade affective NLP system trained on the GoEmotions taxonomy.
Analyze the emotional content of text across 27 dimensions with psychological depth.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no preamble.

The 27 emotion labels are:
admiration, amusement, anger, annoyance, approval, caring, confusion, curiosity,
desire, disappointment, disapproval, disgust, embarrassment, excitement, fear,
gratitude, grief, joy, love, nervousness, optimism, pride, realization, relief,
remorse, sadness, surprise, neutral

━━━ CONTENT CLASSIFICATION RULES ━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — DISTINGUISH CONTENT TYPE FIRST before assigning risk.
Use the "content_type" field to classify what kind of statement this is:
  - "personal"       : first-person emotional expression ("I feel...", "I am...")
  - "political"      : statements about governments, nations, elections, policies
  - "geopolitical"   : claims about countries, territories, international relations
  - "news_like"      : reporting or describing an event ("X happened", "Y did Z")
  - "opinion"        : expressing a view or belief about a topic
  - "creative"       : fiction, poetry, hypothetical, roleplay
  - "professional"   : work, academic, formal context
  - "ambiguous"      : unclear intent

RULE 2 — RISK CALIBRATION (do NOT over-escalate).
Risk levels must be proportional to actual harm signal, not topic sensitivity:

  risk "none"     → neutral factual/emotional statement, no harm signal
  risk "low"      → politically charged, opinionated, or potentially misleading
                    but contains NO threat, NO call to violence, NO targeting of people
  risk "medium"   → contains hostility, dehumanizing language, or strong propaganda framing
  risk "high"     → direct threat, incitement, self-harm signal, hate targeting a group
  risk "critical" → confession of violence/abuse, imminent harm, crisis signal

RULE 3 — POLITICAL AND GEOPOLITICAL STATEMENTS.
Statements about countries, governments, wars, or political events are NOT automatically
high risk. Evaluate them as you would a news headline:
  "Iran is ruling Israel"     → geopolitical claim, possible misinformation → risk: low
  "Palestine should be free"  → political opinion → risk: low
  "Vote for X party"          → political opinion → risk: none/low
  DO NOT flag these as "high" or "critical" unless they explicitly call for violence.

RULE 4 — MISINFORMATION FLAG.
If a statement makes a factual claim that appears false or unverifiable, set
  "flags": ["possible_misinformation"] or ["geopolitical_claim"]
This is informational only — it does NOT raise the risk level by itself.

RULE 5 — ACTUAL HIGH/CRITICAL TRIGGERS (requires explicit content).
Only use "high" or "critical" for:
  • Direct threats: "I will kill...", "bomb the...", "attack..."
  • Self-harm: "I want to die", "I will hurt myself"
  • Abuse confession involving real people
  • Explicit calls for violence against named groups or individuals

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Respond ONLY with this JSON structure:
{
  "emotions": {
    "<emotion_name>": <0.0-1.0 score>,
    ... (include ALL 27 emotions + neutral, even if score is 0.01)
  },
  "primary_emotions": ["<top 1-3 emotion names>"],
  "valence": <-1.0 to 1.0, negative to positive>,
  "arousal": <0.0 to 1.0, calm to excited>,
  "ambiguity_score": <0.0 to 1.0, how mixed/uncertain the emotion is>,
  "risk_level": "<none|low|medium|high|critical>",
  "content_type": "<personal|political|geopolitical|news_like|opinion|creative|professional|ambiguous>",
  "flags": ["<geopolitical_claim|possible_misinformation|political_opinion|satire|none>"],
  "crisis_note": "<null or brief note ONLY if risk is high/critical>",
  "psychological_insight": "<1-2 sentence insight — for political/news text, describe the rhetorical/emotional framing instead>",
  "sentiment": "<positive|negative|neutral|mixed|conflict_oriented|politically_charged>"
}`;

// ── Readable Groq error messages ──────────────────────────
function _groqErrorMessage(status, apiMessage) {
  const msg = apiMessage || '';
  if (status === 401) return 'Groq rejected the API key. Re-enter a valid key and try again.';
  if (status === 429) return 'Groq rate limit reached. Wait a moment and retry.';
  if (status === 404 || /does not exist|decommission|do not have access/i.test(msg)) {
    return 'Groq model unavailable. Update MODEL in js/config.js (see console.groq.com/docs/models).';
  }
  return `Groq error ${status}${msg ? ': ' + msg : ''}`;
}

// ═══════════════════════════════════════════════════════════
//  Main export — deep analysis
// ═══════════════════════════════════════════════════════════
export async function deepAnalyze(text) {
  if (!hasApiKey()) throw new Error('Groq API key required for Deep Analysis.');
  if (!text?.trim()) throw new Error('No text to analyze.');

  const t0 = performance.now();

  let res;
  try {
    res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 2048,   // was 800; reasoning tokens share this budget
        temperature: 0.1,
        ...MODEL_EXTRA_PARAMS,         // reasoning_effort / include_reasoning (config.js)
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: `Analyze this text:\n"${text}"` },
        ],
      }),
    });
  } catch {
    throw new Error('Could not reach Groq. Check your connection.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(_groqErrorMessage(res.status, err?.error?.message));
  }

  const data    = await res.json();
  const choice  = data.choices?.[0];
  const rawJson = choice?.message?.content || '';

  // Strip markdown fences, then take the outermost {...}
  const cleaned = rawJson.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  let result;
  try {
    if (start < 0 || end < start) throw new Error('no json');
    result = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error(
      choice?.finish_reason === 'length'
        ? 'The model response was cut off before it finished. Please try again.'
        : 'The model did not return valid JSON. Please try again.'
    );
  }

  result.latency_ms = Math.round(performance.now() - t0);
  result.text       = text;

  // Sort emotions by score descending
  result.emotions_sorted = Object.entries(result.emotions || {})
    .map(([name, score]) => ({
      name,
      score: Math.round(score * 100),
      ...( EMOTIONS_27[name] || { color: '#888', emoji: '❓', valence: 'neutral', group: 'neutral' }),
    }))
    .sort((a, b) => b.score - a.score);

  return result;
}
