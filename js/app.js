// ═══════════════════════════════════════════════════════════
//  app.js — main entry point (all events bound here, no onclick= in HTML)
// ═══════════════════════════════════════════════════════════

import { EXAMPLES, EMOTION_COLORS, EMOTION_EMOJI } from './config.js';
import { predictEmotion, setApiKey, getApiKey, hasApiKey } from './api.js';
import { loadModel, isReady, predict as localPredict } from './classifier.js';
import {
  analyzeImageFile, loadFaceApi, isFaceApiReady,
  startWebcam, stopWebcam, captureAndAnalyze,
} from './vision.js';
import {
  showToast, setKeyStatus,
  renderResult, clearResult, showStreamingState,
  addToTimeline, updateSessionStats, renderDashboard,
} from './ui.js';
import { initSpeechRecognition, toggleMic, stopMic, getMicText } from './mic.js';
import { updateEmotionChart } from './analytics.js';

// ── State ─────────────────────────────────────────────────
let debounceTimer  = null;
let currentMode    = 'type';
let currentSubMode = 'text';
let useLocalModel  = false;   // starts false; set true once model loads

// ═══════════════════════════════════════════════════════════
//  BOOT — bind ALL events here, never rely on inline onclick
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {

  // ── Navigation ───────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => goPage(btn.dataset.page, btn));
  });

  // ── Engine toggle ────────────────────────────────────────
  document.getElementById('btn-engine-local')?.addEventListener('click', () => switchEngine('local'));
  document.getElementById('btn-engine-groq')?.addEventListener('click',  () => switchEngine('groq'));

  // ── Save API key ─────────────────────────────────────────
  document.getElementById('api-key-save-btn')?.addEventListener('click', saveApiKey);

  // ── Mode tabs ────────────────────────────────────────────
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode, btn));
  });

  // ── Sub-mode tabs (text / image) ─────────────────────────
  document.getElementById('sub-text-btn')?.addEventListener('click', e => setSubMode('text', e.currentTarget));
  document.getElementById('sub-img-btn')?.addEventListener('click',  e => setSubMode('image', e.currentTarget));

  // ── Live textarea ────────────────────────────────────────
  document.getElementById('live-ta')?.addEventListener('input', onType);

  // ── Text file drop zone ──────────────────────────────────
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('click',      () => document.getElementById('file-inp').click());
    dropZone.addEventListener('dragover',   e  => { e.preventDefault(); dropZone.classList.add('drag'); });
    dropZone.addEventListener('dragleave',  ()  => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop',       e  => { e.preventDefault(); dropZone.classList.remove('drag'); processTextFile(e.dataTransfer.files[0]); });
  }
  document.getElementById('file-inp')?.addEventListener('change', e => processTextFile(e.target.files[0]));

  // ── Image drop zone ──────────────────────────────────────
  const imgZone = document.getElementById('img-drop-zone');
  if (imgZone) {
    imgZone.addEventListener('click',     () => document.getElementById('img-inp').click());
    imgZone.addEventListener('dragover',  e  => { e.preventDefault(); imgZone.classList.add('drag'); });
    imgZone.addEventListener('dragleave', ()  => imgZone.classList.remove('drag'));
    imgZone.addEventListener('drop',      e  => { e.preventDefault(); imgZone.classList.remove('drag'); processImageFile(e.dataTransfer.files[0]); });
  }
  document.getElementById('img-inp')?.addEventListener('change', e => processImageFile(e.target.files[0]));

  // ── Mic ──────────────────────────────────────────────────
  document.getElementById('mic-btn')?.addEventListener('click', toggleMic);
  document.getElementById('mic-analyze-btn')?.addEventListener('click', analyzeMicText);

  // ── Webcam ───────────────────────────────────────────────
  document.getElementById('webcam-start-btn')?.addEventListener('click',   startWebcamMode);
  document.getElementById('webcam-stop-btn')?.addEventListener('click',    stopWebcamMode);
  document.getElementById('webcam-capture-btn')?.addEventListener('click', captureWebcam);

  // ── Analytics clear ──────────────────────────────────────
  document.getElementById('analytics-clear-btn')?.addEventListener('click', () => {
    import('./analytics.js').then(m => m.clearEmotionData());
  });

  // ── Keyboard shortcut Ctrl+Enter ─────────────────────────
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const text = document.getElementById('live-ta')?.value?.trim();
      if (text) runAnalysis(text);
    }
  });

  // ── Init ─────────────────────────────────────────────────
  buildExamples();
  initSpeechRecognition(runAnalysis);
  restoreApiKey();
  _setEngineUI('groq');   // default to groq while model loads

  await _bootLocalModel();
});

// ═══════════════════════════════════════════════════════════
//  LOCAL MODEL BOOT
// ═══════════════════════════════════════════════════════════
async function _bootLocalModel() {
  const statusEl = document.getElementById('model-status');

  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Timed out after 10s')), 10000));

    await Promise.race([
      loadModel(msg => { if (statusEl) statusEl.textContent = msg; }),
      timeout,
    ]);

    if (statusEl) {
      statusEl.textContent = '✓ Local model ready (86.5% acc) — works offline';
      statusEl.style.color = 'var(--green)';
    }
    useLocalModel = true;
    _setEngineUI('local');

  } catch (err) {
    console.warn('[app] Local model failed to load:', err.message);
    if (statusEl) {
      statusEl.textContent = `⚠ Local model unavailable — ${err.message}`;
      statusEl.style.color = '#ff9966';
    }
    useLocalModel = false;
    _setEngineUI('groq');
  }
}

// ═══════════════════════════════════════════════════════════
//  ENGINE TOGGLE
// ═══════════════════════════════════════════════════════════
function switchEngine(engine) {
  if (engine === 'local' && !isReady()) {
    showToast('⚠ Local model not ready. Check model/emotion_model.json exists.', 'err');
    return;
  }
  useLocalModel = (engine === 'local');
  _setEngineUI(engine);
  showToast(`Switched to ${useLocalModel ? 'Local Model (offline)' : 'Groq API'}`, 'ok');
}

function _setEngineUI(engine) {
  document.getElementById('btn-engine-local')?.classList.toggle('on', engine === 'local');
  document.getElementById('btn-engine-groq')?.classList.toggle('on',  engine === 'groq');
  const kb = document.getElementById('api-key-banner');
  if (kb) kb.style.display = (engine === 'groq') ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════════
//  API KEY
// ═══════════════════════════════════════════════════════════
function restoreApiKey() {
  const saved = getApiKey();
  if (saved) {
    const inp = document.getElementById('api-key-inp');
    if (inp) inp.value = saved;
    setKeyStatus('✓ Key loaded', 'ok');
  }
}

function saveApiKey() {
  const key = document.getElementById('api-key-inp')?.value?.trim() || '';
  if (key.length < 10) { setKeyStatus('⚠ Enter a valid key', 'err'); return; }
  setApiKey(key);
  setKeyStatus('✓ Key saved', 'ok');
  showToast('✅ Groq API key saved!', 'ok');
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════
function goPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('on'));
  document.getElementById(`page-${id}`)?.classList.add('on');
  btn.classList.add('on');
  if (id === 'dash') renderDashboard();
}

// ═══════════════════════════════════════════════════════════
//  MODE SWITCHING
// ═══════════════════════════════════════════════════════════
function setMode(mode, btn) {
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  currentMode = mode;
  ['type', 'mic', 'file', 'webcam'].forEach(m => {
    const el = document.getElementById(`mode-${m}`);
    if (el) el.style.display = m === mode ? 'block' : 'none';
  });
  if (mode !== 'type')   clearResult();
  if (mode !== 'mic')    { try { stopMic(); } catch {} }
  if (mode !== 'webcam') { try { stopWebcamMode(); } catch {} }
}

function setSubMode(sub, btn) {
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  currentSubMode = sub;
  document.getElementById('sub-text').style.display  = sub === 'text'  ? 'block' : 'none';
  document.getElementById('sub-image').style.display = sub === 'image' ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════
//  LIVE TYPING
// ═══════════════════════════════════════════════════════════
function onType() {
  const text = document.getElementById('live-ta').value;
  document.getElementById('char-ct').textContent = text.length;
  const dot = document.getElementById('typing-dot');
  const lbl = document.getElementById('typing-label');
  if (!text.trim()) {
    dot.classList.remove('on');
    lbl.textContent = 'Start typing to detect emotion';
    clearResult();
    return;
  }
  dot.classList.add('on');
  lbl.textContent = 'Analyzing…';
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runAnalysis(text), (useLocalModel && isReady()) ? 200 : 600);
}

// ═══════════════════════════════════════════════════════════
//  CORE ANALYSIS
// ═══════════════════════════════════════════════════════════
async function runAnalysis(text) {
  text = text?.trim();
  if (!text) return;

  const lbl = document.getElementById('typing-label');
  const dot = document.getElementById('typing-dot');
  dot?.classList.add('on');

  try {
    let result;

    if (useLocalModel && isReady()) {
      result = localPredict(text);
      result._text = text;
      if (lbl) lbl.textContent = `Detected: ${result.emotion} (${result.confidence}%) · local`;
    } else {
      if (!hasApiKey()) {
        showToast('⚠ Enter your Groq API key first.', 'err');
        if (lbl) lbl.textContent = 'API key required';
        return;
      }
      showStreamingState(true);
      result = await predictEmotion(text, () => {});
      result._text = text;
      if (lbl) lbl.textContent = `Detected: ${result.emotion} (${result.confidence}%) · groq`;
    }

    renderResult(result);
    addToTimeline(result);
    updateSessionStats(result);
    updateEmotionChart(result.emotion);

  } catch (err) {
    if (lbl) lbl.textContent = `Error — ${err.message}`;
    showToast(`⚠ ${err.message}`, 'err');
    console.error('[runAnalysis]', err);
  } finally {
    dot?.classList.remove('on');
    showStreamingState(false);
  }
}

// ═══════════════════════════════════════════════════════════
//  MICROPHONE
// ═══════════════════════════════════════════════════════════
async function analyzeMicText() {
  const text = getMicText();
  if (!text) return showToast('No speech detected yet.', 'err');
  stopMic();
  await runAnalysis(text);
  showToast('✅ Mic analyzed!', 'ok');
}

// ═══════════════════════════════════════════════════════════
//  TEXT FILE UPLOAD
// ═══════════════════════════════════════════════════════════
async function processTextFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.txt')) return showToast('Please upload a .txt file.', 'err');

  const lines = (await file.text()).split('\n').map(l => l.trim()).filter(l => l);
  if (!lines.length)     return showToast('File is empty.', 'err');
  if (lines.length > 50) return showToast('Max 50 lines.', 'err');

  const engine = (useLocalModel && isReady()) ? 'Local Model' : 'Groq API';
  const el = document.getElementById('file-results');
  el.innerHTML = `<div style="color:var(--muted);margin-top:14px">Analyzing ${lines.length} lines with ${engine}…</div>`;

  const results = [];
  for (const line of lines) {
    try {
      const r = (useLocalModel && isReady()) ? localPredict(line) : await predictEmotion(line);
      r._text = line;
      results.push({ line, res: r });
      updateEmotionChart(r.emotion);
    } catch (err) { console.warn('Skipped line:', err.message); }
  }

  if (!results.length) {
    el.innerHTML = '<div style="color:#fca5a5;margin-top:14px">Analysis failed — check API key or model.</div>';
    return;
  }

  el.innerHTML = `<div style="margin-top:18px">
    <div class="card-label">Results for ${results.length} lines · ${engine}</div>
    ${results.map(({ line, res }) => `
      <div class="file-row">
        <div class="file-emo-icon">${EMOTION_EMOJI[res.emotion] || '🤔'}</div>
        <div style="flex:1">
          <div class="file-text">${line.slice(0, 90)}${line.length > 90 ? '…' : ''}</div>
          <div class="file-label" style="color:${EMOTION_COLORS[res.emotion]};margin-top:3px">${res.emotion} · ${res.confidence}%</div>
        </div>
      </div>`).join('')}
  </div>`;

  results.forEach(({ res }) => { updateSessionStats(res); addToTimeline(res); });
  showToast(`✅ Analyzed ${results.length} lines`, 'ok');
}

// ═══════════════════════════════════════════════════════════
//  IMAGE FILE UPLOAD
// ═══════════════════════════════════════════════════════════
async function processImageFile(file) {
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) return showToast('Upload a JPG, PNG, or WEBP image.', 'err');
  if (!hasApiKey()) return showToast('⚠ Groq API key required for image analysis.', 'err');

  const previewWrap = document.getElementById('img-preview-wrap');
  const previewImg  = document.getElementById('img-preview');
  const resultPanel = document.getElementById('img-result-panel');
  const descEl      = document.getElementById('img-description');

  previewImg.src = URL.createObjectURL(file);
  previewWrap.style.display = 'block';
  resultPanel.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">Analyzing with Groq Vision…</div>';
  descEl.textContent = '';

  try {
    const result = await analyzeImageFile(file);
    result._text = `[Image: ${file.name}]`;

    resultPanel.innerHTML = `
      <div class="img-emo-result" style="background:${_emoBg(result.emotion)};border-color:${EMOTION_COLORS[result.emotion]}44;border:1px solid;border-radius:12px;padding:18px;text-align:center;margin-bottom:12px">
        <div style="font-size:2.5rem">${EMOTION_EMOJI[result.emotion] || '🤔'}</div>
        <div style="font-size:1.2rem;font-weight:800;color:${EMOTION_COLORS[result.emotion]};text-transform:capitalize">${result.emotion}</div>
        <div style="font-size:.82rem;background:rgba(255,255,255,0.1);padding:3px 10px;border-radius:99px;margin-top:4px;display:inline-block">${result.confidence}% confident</div>
        <div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-top:4px">${result.latency_ms}ms · Groq Vision</div>
      </div>
      ${(result.breakdown || []).sort((a, b) => b.probability - a.probability).map(item => `
        <div class="prob-row" style="margin-bottom:8px">
          <div class="prob-hdr">
            <span class="prob-name" style="color:${item.emotion === result.emotion ? item.color : 'var(--text)'}">${EMOTION_EMOJI[item.emotion] || ''} ${item.emotion}</span>
            <span class="prob-pct">${item.probability}%</span>
          </div>
          <div class="prob-track"><div class="prob-bar" style="background:${item.color};width:${item.probability}%"></div></div>
        </div>`).join('')}
    `;

    if (result.description) descEl.textContent = `💬 ${result.description}`;

    renderResult(result);
    addToTimeline(result);
    updateSessionStats(result);
    updateEmotionChart(result.emotion);
    showToast(`✅ Image: ${result.emotion}`, 'ok');

  } catch (err) {
    resultPanel.innerHTML = `<div style="color:#fca5a5;padding:16px">⚠ ${err.message}</div>`;
    showToast(`⚠ ${err.message}`, 'err');
  }
}

function _emoBg(e) {
  const m = { joy:'#3d3500', sadness:'#001a3d', anger:'#3d0000', fear:'#1e003d', love:'#3d0020', surprise:'#003d15' };
  return m[e] || '#1a1a2e';
}

// ═══════════════════════════════════════════════════════════
//  WEBCAM
// ═══════════════════════════════════════════════════════════
async function startWebcamMode() {
  const statusEl   = document.getElementById('webcam-status-text');
  const loader     = document.getElementById('faceapi-loader');
  const fillEl     = document.getElementById('faceapi-fill');
  const msgEl      = document.getElementById('faceapi-msg');
  const startBtn   = document.getElementById('webcam-start-btn');
  const stopBtn    = document.getElementById('webcam-stop-btn');
  const capBtn     = document.getElementById('webcam-capture-btn');
  const placeholder = document.getElementById('webcam-placeholder');
  const faceCount  = document.getElementById('webcam-face-count');

  startBtn.style.display = 'none';
  loader.style.display   = 'block';

  if (!isFaceApiReady()) {
    let pct = 0;
    const fakeProgress = setInterval(() => {
      pct = Math.min(pct + 8, 85);
      if (fillEl) fillEl.style.width = pct + '%';
    }, 300);
    try {
      await loadFaceApi(msg => { if (msgEl) msgEl.textContent = msg; });
      clearInterval(fakeProgress);
      if (fillEl) fillEl.style.width = '100%';
    } catch (err) {
      clearInterval(fakeProgress);
      loader.style.display   = 'none';
      startBtn.style.display = 'inline-flex';
      showToast(`⚠ Face detection failed: ${err.message}`, 'err');
      return;
    }
  }

  loader.style.display = 'none';

  try {
    await startWebcam(
      (result) => {
        result._text = '[Webcam]';
        renderResult(result);
        if (faceCount) {
          faceCount.style.display = 'flex';
          faceCount.textContent   = `${result.faces || 1} face${(result.faces || 1) > 1 ? 's' : ''}`;
        }
        const now = Date.now();
        if (!window._lastTimelineAdd || now - window._lastTimelineAdd > 5000) {
          addToTimeline(result);
          updateSessionStats(result);
          updateEmotionChart(result.emotion);
          window._lastTimelineAdd = now;
        }
      },
      (msg) => { if (statusEl) statusEl.textContent = msg; }
    );

    placeholder.style.display = 'none';
    stopBtn.style.display     = 'inline-flex';
    capBtn.style.display      = 'inline-flex';
    startBtn.style.display    = 'none';

  } catch (err) {
    loader.style.display   = 'none';
    startBtn.style.display = 'inline-flex';
    if (statusEl) statusEl.textContent = err.message;
    showToast(`⚠ ${err.message}`, 'err');
  }
}

function stopWebcamMode() {
  try { stopWebcam(); } catch {}
  document.getElementById('webcam-start-btn').style.display   = 'inline-flex';
  document.getElementById('webcam-stop-btn').style.display    = 'none';
  document.getElementById('webcam-capture-btn').style.display = 'none';
  document.getElementById('webcam-placeholder').style.display = 'flex';
  document.getElementById('webcam-status-text').textContent   = 'Camera stopped';
  const fc = document.getElementById('webcam-face-count');
  if (fc) fc.style.display = 'none';
}

async function captureWebcam() {
  if (!hasApiKey()) return showToast('⚠ Groq API key required for capture.', 'err');
  const capBtn = document.getElementById('webcam-capture-btn');
  capBtn.textContent = '⏳ Analyzing…';
  capBtn.disabled = true;
  try {
    const result = await captureAndAnalyze();
    result._text = '[Webcam Capture]';
    renderResult(result);
    addToTimeline(result);
    updateSessionStats(result);
    updateEmotionChart(result.emotion);
    showToast(`✅ Captured: ${result.emotion} (${result.confidence}%)`, 'ok');
  } catch (err) {
    showToast(`⚠ ${err.message}`, 'err');
  } finally {
    capBtn.textContent = '📸 Capture & Analyze';
    capBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  EXAMPLE CHIPS
// ═══════════════════════════════════════════════════════════
function buildExamples() {
  const grid = document.getElementById('ex-grid');
  if (!grid) return;
  EXAMPLES.forEach(ex => {
    const btn = document.createElement('button');
    btn.className = 'ex-chip';
    btn.innerHTML = `<div class="ex-emo" style="color:${EMOTION_COLORS[ex.emo]}">${EMOTION_EMOJI[ex.emo]} ${ex.emo}</div>${ex.text}`;
    btn.addEventListener('click', () => {
      const ta = document.getElementById('live-ta');
      ta.value = ex.text;
      document.getElementById('char-ct').textContent = ex.text.length;
      runAnalysis(ex.text);
    });
    grid.appendChild(btn);
  });
}