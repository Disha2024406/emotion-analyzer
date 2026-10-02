// ═══════════════════════════════════════════════════════════
//  vision.js — Image upload + Webcam face emotion detection
//  Image analysis  → Groq Vision API (qwen/qwen3.8-27b, preview model)
//  Webcam stream   → face-api.js (runs fully in-browser)
// ═══════════════════════════════════════════════════════════

import { EMOTION_COLORS, EMOTION_EMOJI } from './config.js';
import { getApiKey, hasApiKey } from './api.js';

const GROQ_VISION_API = 'https://api.groq.com/openai/v1/chat/completions';
// Checked against console.groq.com/docs/models on 2 Oct 2026. This is a Groq
// "Preview" model and may be discontinued at short notice, so recheck there.
const VISION_MODEL        = 'qwen/qwen3.8-27b';
const VISION_EXTRA_PARAMS = { reasoning_effort: 'none' };   // no reasoning tokens

// face-api.js CDN (tiny models, runs in browser)
const FACEAPI_CDN  = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const MODELS_URL   = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

let _faceApiLoaded  = false;
let _faceApiLoading = false;
let _webcamStream   = null;
let _webcamTimer    = null;
let _onResult       = null;   // callback(result)

// ── Emotion mapping: face-api → our labels ────────────────
const FACEAPI_MAP = {
  happy:    'joy',
  sad:      'sadness',
  angry:    'anger',
  fearful:  'fear',
  disgusted:'anger',
  surprised:'surprise',
  neutral:  'sadness',
};

// ═══════════════════════════════════════════════════════════
//  IMAGE UPLOAD — Groq Vision
// ═══════════════════════════════════════════════════════════

/**
 * Analyze an image File object for facial emotion via Groq Vision.
 * Returns same result shape as classifier.predict().
 */
export async function analyzeImageFile(file) {
  if (!hasApiKey()) throw new Error('Groq API key required for image analysis.');

  const base64 = await _fileToBase64(file);
  const mime   = file.type || 'image/jpeg';

  const body = {
    model: VISION_MODEL,
    max_completion_tokens: 1024,   // was 300
    ...VISION_EXTRA_PARAMS,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` },
        },
        {
          type: 'text',
          text: `Analyze the facial expression and emotion in this image.
Respond ONLY with a JSON object (no markdown, no explanation):
{
  "emotion": "<joy|sadness|anger|fear|love|surprise>",
  "confidence": <0-100>,
  "description": "<one sentence about what you see>",
  "breakdown": [
    {"emotion":"joy",      "probability":<0-100>, "color":"#FFD700"},
    {"emotion":"sadness",  "probability":<0-100>, "color":"#4f8fff"},
    {"emotion":"anger",    "probability":<0-100>, "color":"#ff4d4d"},
    {"emotion":"fear",     "probability":<0-100>, "color":"#c084fc"},
    {"emotion":"love",     "probability":<0-100>, "color":"#ff69b4"},
    {"emotion":"surprise", "probability":<0-100>, "color":"#4ade80"}
  ]
}
Rules: primary emotion = highest probability in breakdown. All probabilities sum to 100.
If no face is visible, set emotion to "neutral" and confidence to 0.`,
        },
      ],
    }],
  };

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(GROQ_VISION_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach Groq. Check your connection.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || '';
    if (res.status === 401) throw new Error('Groq rejected the API key. Re-enter a valid key and try again.');
    if (res.status === 429) throw new Error('Groq rate limit reached. Wait a moment and retry.');
    if (res.status === 404 || /does not exist|decommission|do not have access/i.test(msg)) {
      throw new Error('Groq vision model unavailable. Update VISION_MODEL in js/vision.js (see console.groq.com/docs/models).');
    }
    throw new Error(`Vision API error ${res.status}${msg ? ': ' + msg : ''}`);
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
        : 'The vision model did not return valid JSON. Please try again.'
    );
  }

  result.latency_ms = Math.round(performance.now() - t0);
  result.emoji      = EMOTION_EMOJI[result.emotion] || '🤔';
  result.source     = 'vision';
  return result;
}

// ═══════════════════════════════════════════════════════════
//  WEBCAM — face-api.js
// ═══════════════════════════════════════════════════════════

/** Load face-api.js script + tiny models from CDN */
export async function loadFaceApi(onStatus) {
  if (_faceApiLoaded)  return true;
  if (_faceApiLoading) return false;
  _faceApiLoading = true;

  onStatus?.('Loading face detection library…');

  await _loadScript(FACEAPI_CDN);

  onStatus?.('Loading face models…');

  // Use tiny models for speed
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL),
  ]);

  _faceApiLoaded  = true;
  _faceApiLoading = false;
  onStatus?.('Face detection ready ✓');
  return true;
}

export function isFaceApiReady() { return _faceApiLoaded; }

/**
 * Start webcam stream into <video id="webcam-video">.
 * Calls onResult(result) every intervalMs with detected emotion.
 */
export async function startWebcam(onResult, onStatus, intervalMs = 1200) {
  _onResult = onResult;

  onStatus?.('Requesting camera access…');

  try {
    _webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error('Camera permission denied. Please allow camera access.');
    if (err.name === 'NotFoundError')   throw new Error('No camera found on this device.');
    throw new Error(`Camera error: ${err.message}`);
  }

  const video = document.getElementById('webcam-video');
  video.srcObject = _webcamStream;
  await video.play();

  onStatus?.('Detecting faces…');

  // Start detection loop
  _webcamTimer = setInterval(() => _detectFrame(video, onResult, onStatus), intervalMs);
}

export function stopWebcam() {
  clearInterval(_webcamTimer);
  _webcamTimer = null;

  if (_webcamStream) {
    _webcamStream.getTracks().forEach(t => t.stop());
    _webcamStream = null;
  }

  const video = document.getElementById('webcam-video');
  if (video) { video.srcObject = null; }

  const overlay = document.getElementById('webcam-overlay');
  if (overlay) { const ctx = overlay.getContext('2d'); ctx.clearRect(0,0,overlay.width,overlay.height); }
}

export function isWebcamActive() { return !!_webcamStream; }

/** Capture one frame from webcam and analyze it via Groq Vision */
export async function captureAndAnalyze() {
  const video  = document.getElementById('webcam-video');
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      try {
        const file   = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
        const result = await analyzeImageFile(file);
        resolve(result);
      } catch (err) { reject(err); }
    }, 'image/jpeg', 0.85);
  });
}

// ── Private: face-api detection loop ─────────────────────
async function _detectFrame(video, onResult, onStatus) {
  if (!_faceApiLoaded || video.paused || video.ended) return;

  try {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
      .withFaceExpressions();

    // Draw overlay
    _drawOverlay(video, detections);

    if (!detections.length) {
      onStatus?.('No face detected — position your face in the frame');
      return;
    }

    // Use the face with highest detection score
    const best  = detections.reduce((a, b) =>
      (a.detection.score > b.detection.score ? a : b));

    const exprs = best.expressions;   // { happy: 0.9, sad: 0.1, … }

    // Convert to our format
    const sorted = Object.entries(exprs)
      .filter(([k]) => FACEAPI_MAP[k])
      .map(([k, v]) => ({ faceKey: k, mapped: FACEAPI_MAP[k], prob: v }))
      .sort((a, b) => b.prob - a.prob);

    // Aggregate by mapped emotion
    const aggr = {};
    sorted.forEach(({ mapped, prob }) => {
      aggr[mapped] = (aggr[mapped] || 0) + prob;
    });

    // Normalize to 100
    const total = Object.values(aggr).reduce((a, b) => a + b, 0) || 1;
    const breakdown = Object.entries(aggr).map(([emotion, raw]) => ({
      emotion,
      probability: Math.round((raw / total) * 100),
      color: EMOTION_COLORS[emotion] || '#888',
    })).sort((a, b) => b.probability - a.probability);

    // Fix rounding so sum = 100
    const sum  = breakdown.reduce((a, b) => a + b.probability, 0);
    if (breakdown.length) breakdown[0].probability += (100 - sum);

    const top = breakdown[0];
    const result = {
      emotion:    top.emotion,
      confidence: top.probability,
      emoji:      EMOTION_EMOJI[top.emotion] || '🤔',
      latency_ms: 0,
      breakdown,
      source:     'webcam',
      faces:      detections.length,
    };

    onStatus?.(`${detections.length} face${detections.length > 1 ? 's' : ''} detected`);
    onResult(result);

  } catch (err) {
    console.warn('[vision] Frame detection error:', err);
  }
}

// ── Draw bounding boxes on canvas overlay ────────────────
function _drawOverlay(video, detections) {
  const overlay = document.getElementById('webcam-overlay');
  if (!overlay) return;

  overlay.width  = video.videoWidth;
  overlay.height = video.videoHeight;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  detections.forEach(det => {
    const box  = det.detection.box;
    const expr = det.expressions;
    const top  = Object.entries(expr).sort((a,b) => b[1]-a[1])[0];
    const emo  = FACEAPI_MAP[top[0]] || top[0];
    const color = EMOTION_COLORS[emo] || '#7c6ffc';

    // Box
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Label background
    const label = `${EMOTION_EMOJI[emo] || ''} ${emo}`;
    ctx.font      = 'bold 14px Inter, sans-serif';
    const tw      = ctx.measureText(label).width;
    ctx.fillStyle = color + 'cc';
    ctx.fillRect(box.x - 1, box.y - 24, tw + 12, 22);

    // Label text
    ctx.fillStyle = '#fff';
    ctx.fillText(label, box.x + 5, box.y - 7);
  });
}

// ── Helpers ───────────────────────────────────────────────
function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s  = document.createElement('script');
    s.src    = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}
