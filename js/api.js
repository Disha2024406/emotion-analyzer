// ═══════════════════════════════════════════════════════════
//  api.js — Groq real-time emotion detection
//  Groq uses the OpenAI-compatible chat completions API,
//  so streaming follows the OpenAI SSE format.
// ═══════════════════════════════════════════════════════════

import { GROQ_API, MODEL, MODEL_EXTRA_PARAMS, SYSTEM_PROMPT } from './config.js';

// ── Key management ────────────────────────────────────────
let _apiKey = sessionStorage.getItem('emo_api_key') || '';

export function setApiKey(key) {
  _apiKey = key.trim();
  sessionStorage.setItem('emo_api_key', _apiKey);
}

export function getApiKey() { return _apiKey; }
export function hasApiKey() { return _apiKey.length > 10; }

// ── Readable error messages ───────────────────────────────
function friendlyGroqError(status, apiMessage) {
  const msg = apiMessage || '';
  if (status === 401) {
    return 'Groq rejected the API key. Re-enter a valid key and try again.';
  }
  if (status === 429) {
    return 'Groq rate limit reached. Wait a moment and retry, or switch to the Local Model.';
  }
  if (status === 404 || /does not exist|decommission|do not have access/i.test(msg)) {
    return `Groq model unavailable (${msg || status}). Update MODEL in js/config.js ` +
           `(see console.groq.com/docs/models) or switch to the Local Model.`;
  }
  return `Groq API error ${status}${msg ? ': ' + msg : ''}`;
}

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
    max_completion_tokens: 1024,   // was 300; reasoning tokens share this budget
    temperature: 0.1,              // low temp = consistent JSON
    stream: !!onToken,
    ...MODEL_EXTRA_PARAMS,         // reasoning_effort / include_reasoning (see config.js)
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Analyze this text: "${text}"` },
    ],
  };

  let res;
  try {
    res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    // fetch() only throws on network failure (offline, DNS, blocked)
    throw new Error('Could not reach Groq. Check your connection or switch to the Local Model.');
  }

  if (!res.ok) {
    const errText = await res.text();
    let apiMessage = '';
    try {
      apiMessage = JSON.parse(errText).error?.message || '';
    } catch {}
    throw new Error(friendlyGroqError(res.status, apiMessage));
  }

  let rawJson = '';
  let finishReason = '';

  if (onToken && res.body) {
    // ── Streaming path (OpenAI SSE format) ─────────────
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line) => {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        // OpenAI/Groq delta format; reasoning chunks may carry no content
        const delta = choice?.delta?.content;
        if (delta) {
          rawJson += delta;
          onToken(delta);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch {}
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();          // keep the incomplete last line for the next read
      lines.forEach(handleLine);
    }
    if (buffer) handleLine(buffer);  // flush anything left at end of stream
  } else {
    // ── Non-streaming path ──────────────────────────────
    const data = await res.json();
    rawJson = data.choices?.[0]?.message?.content || '';
    finishReason = data.choices?.[0]?.finish_reason || '';
  }

  const latencyMs = Math.round(performance.now() - t0);

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
      finishReason === 'length'
        ? 'The model response was cut off before it finished. Please try again.'
        : 'The model did not return valid JSON. Please try again.'
    );
  }

  result.latency_ms = latencyMs;
  result.emoji      = getEmoji(result.emotion);

  return result;
}

function getEmoji(emotion) {
  const map = { joy:'😄', sadness:'😢', anger:'😠', fear:'😨', love:'❤️', surprise:'😮' };
  return map[emotion] || '🤔';
}
