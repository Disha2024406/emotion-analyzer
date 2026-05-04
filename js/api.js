// ═══════════════════════════════════════════════════════════
//  api.js — Groq real-time emotion detection
//  Groq uses the OpenAI-compatible chat completions API,
//  so streaming follows the OpenAI SSE format.
// ═══════════════════════════════════════════════════════════

import { GROQ_API, MODEL, SYSTEM_PROMPT } from './config.js';

// ── Key management ────────────────────────────────────────
let _apiKey = sessionStorage.getItem('emo_api_key') || '';

export function setApiKey(key) {
  _apiKey = key.trim();
  sessionStorage.setItem('emo_api_key', _apiKey);
}

export function getApiKey() { return _apiKey; }
export function hasApiKey() { return _apiKey.length > 10; }

// ── Core prediction (streaming) ───────────────────────────
/**
 * Calls Groq API with streaming, returns parsed emotion result.
 * onToken(chunk) is called with each streamed text delta.
 */
export async function predictEmotion(text, onToken = null) {
  if (!hasApiKey()) {
    throw new Error('No API key set. Please enter your Groq API key above.');
  }

  const t0 = performance.now();

  const body = {
    model: MODEL,
    max_tokens: 300,
    temperature: 0.1,          // low temp = consistent JSON
    stream: !!onToken,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Analyze this text: "${text}"` },
    ],
  };

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${_apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `Groq API error ${res.status}`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  let rawJson = '';

  if (onToken && res.body) {
    // ── Streaming path (OpenAI SSE format) ─────────────
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          // OpenAI/Groq delta format
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            rawJson += delta;
            onToken(delta);
          }
        } catch {}
      }
    }
  } else {
    // ── Non-streaming path ──────────────────────────────
    const data = await res.json();
    rawJson = data.choices?.[0]?.message?.content || '';
  }

  const latencyMs = Math.round(performance.now() - t0);

  // Strip markdown fences if model wraps in ```json
  const cleaned = rawJson.replace(/```json|```/g, '').trim();
  const result  = JSON.parse(cleaned);

  result.latency_ms = latencyMs;
  result.emoji      = getEmoji(result.emotion);

  return result;
}

function getEmoji(emotion) {
  const map = { joy:'😄', sadness:'😢', anger:'😠', fear:'😨', love:'❤️', surprise:'😮' };
  return map[emotion] || '🤔';
}