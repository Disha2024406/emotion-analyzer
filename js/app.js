// ═══════════════════════════════════════════════════════════
//  app.js — main entry point
//  Strategy: local model (instant) → Groq API (fallback)
// ═══════════════════════════════════════════════════════════

import { EXAMPLES, EMOTION_COLORS, EMOTION_EMOJI } from './config.js';
import { predictEmotion, setApiKey, getApiKey, hasApiKey } from './api.js';
import { loadModel, isReady, predict as localPredict } from './classifier.js';
import {
  showToast, setKeyStatus,
  renderResult, clearResult, showStreamingState,
  addToTimeline, updateSessionStats, renderDashboard,
} from './ui.js';
import { initSpeechRecognition, toggleMic, stopMic, getMicText } from './mic.js';

let debounceTimer = null;
let currentMode   = 'type';
let useLocalModel = true;

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  buildExamples();
  initSpeechRecognition(runAnalysis);
  restoreApiKey();

  window.goPage         = goPage;
  window.setMode        = setMode;
  window.onType         = onType;
  window.toggleMic      = toggleMic;
  window.analyzeMicText = analyzeMicText;
  window.doDragOver     = doDragOver;
  window.doDragLeave    = doDragLeave;
  window.doDrop         = doDrop;
  window.doFile         = doFile;
  window.saveApiKey     = saveApiKey;
  window.switchEngine   = switchEngine;

  await _bootLocalModel();
});

async function _bootLocalModel() {
  const statusEl = document.getElementById('model-status');
  _setEngineUI('loading');
  try {
    await loadModel((msg) => { if (statusEl) statusEl.textContent = msg; });
    if (statusEl) {
      statusEl.textContent = '✓ Local model ready (86.5% acc) — works offline, no API needed';
      statusEl.style.color = 'var(--green)';
    }
    useLocalModel = true;
    _setEngineUI('local');
  } catch {
    if (statusEl) {
      statusEl.textContent = 'Local model unavailable — using Groq API';
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
    showToast('⚠ Local model not loaded yet.', 'err'); return;
  }
  useLocalModel = (engine === 'local');
  _setEngineUI(engine);
  showToast(`Switched to ${useLocalModel ? 'Local Model (offline)' : 'Groq API'}`, 'ok');
}

function _setEngineUI(engine) {
  document.getElementById('btn-engine-local')?.classList.toggle('on', engine === 'local');
  document.getElementById('btn-engine-groq')?.classList.toggle('on',  engine === 'groq');
  const keyBanner = document.getElementById('api-key-banner');
  if (keyBanner) keyBanner.style.display = (engine === 'groq') ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════════
//  API KEY
// ═══════════════════════════════════════════════════════════
function restoreApiKey() {
  const saved = getApiKey();
  if (saved) {
    const inp = document.getElementById('api-key-inp');
    if (inp) inp.value = saved;
    setKeyStatus('✓ Key loaded from session', 'ok');
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
  document.getElementById(`page-${id}`).classList.add('on');
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
  ['type', 'mic', 'file'].forEach(m => {
    const el = document.getElementById(`mode-${m}`);
    if (el) el.style.display = m === mode ? 'block' : 'none';
  });
  if (mode !== 'type') clearResult();
  if (mode !== 'mic')  { try { stopMic(); } catch {} }
}

// ═══════════════════════════════════════════════════════════
//  LIVE TYPING
// ═══════════════════════════════════════════════════════════
function onType() {
  const text = document.getElementById('live-ta').value;
  document.getElementById('char-ct').textContent = text.length;
  const dot = document.getElementById('typing-dot');
  const label = document.getElementById('typing-label');
  if (!text.trim()) {
    dot.classList.remove('on'); label.textContent = 'Start typing to detect emotion';
    clearResult(); return;
  }
  dot.classList.add('on'); label.textContent = 'Analyzing…';
  clearTimeout(debounceTimer);
  const delay = (useLocalModel && isReady()) ? 200 : 600;
  debounceTimer = setTimeout(() => runAnalysis(text), delay);
}

// ═══════════════════════════════════════════════════════════
//  CORE ANALYSIS
// ═══════════════════════════════════════════════════════════
async function runAnalysis(text) {
  text = text?.trim(); if (!text) return;
  const label = document.getElementById('typing-label');
  const dot   = document.getElementById('typing-dot');
  dot?.classList.add('on');
  try {
    let result;
    if (useLocalModel && isReady()) {
      result = localPredict(text);
      result._text = text;
      if (label) label.textContent = `Detected: ${result.emotion} (${result.confidence}%) · local`;
    } else {
      if (!hasApiKey()) {
        showToast('⚠ Enter Groq key or switch to Local Model.', 'err'); return;
      }
      showStreamingState(true);
      result = await predictEmotion(text, () => {});
      result._text = text;
      if (label) label.textContent = `Detected: ${result.emotion} (${result.confidence}%) · groq`;
    }
    renderResult(result);
    addToTimeline(result);
    updateSessionStats(result);
  } catch (err) {
    if (label) label.textContent = `Error — ${err.message}`;
    showToast(`⚠ ${err.message}`, 'err');
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
  stopMic(); await runAnalysis(text);
  showToast('✅ Mic transcript analyzed!', 'ok');
}

// ═══════════════════════════════════════════════════════════
//  FILE UPLOAD
// ═══════════════════════════════════════════════════════════
function doDragOver(e) { e.preventDefault(); document.getElementById('drop-zone').classList.add('drag'); }
function doDragLeave()  { document.getElementById('drop-zone').classList.remove('drag'); }
function doDrop(e)      { e.preventDefault(); doDragLeave(); processFile(e.dataTransfer.files[0]); }
function doFile(e)      { processFile(e.target.files[0]); }

async function processFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.txt')) return showToast('Please upload a .txt file.', 'err');
  const text  = await file.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (!lines.length)    return showToast('File is empty.', 'err');
  if (lines.length > 50) return showToast('Max 50 lines.', 'err');
  const engine    = (useLocalModel && isReady()) ? 'Local Model' : 'Groq API';
  const resultsEl = document.getElementById('file-results');
  resultsEl.innerHTML = `<div style="color:var(--muted);margin-top:14px">Analyzing ${lines.length} lines with ${engine}…</div>`;
  const results = [];
  for (const line of lines) {
    try {
      const r = (useLocalModel && isReady()) ? localPredict(line) : await predictEmotion(line);
      r._text = line; results.push({ line, res: r });
    } catch (err) { console.warn('Skipped:', err.message); }
  }
  if (!results.length) { resultsEl.innerHTML = '<div style="color:#fca5a5;margin-top:14px">Analysis failed.</div>'; return; }
  resultsEl.innerHTML = `<div style="margin-top:18px">
    <div class="card-label">Results for ${results.length} lines · ${engine}</div>
    ${results.map(({ line, res }) => `
      <div class="file-row">
        <div class="file-emo-icon">${EMOTION_EMOJI[res.emotion]||'🤔'}</div>
        <div style="flex:1">
          <div class="file-text">${line.slice(0,90)}${line.length>90?'…':''}</div>
          <div class="file-label" style="color:${EMOTION_COLORS[res.emotion]};margin-top:3px">${res.emotion} · ${res.confidence}%</div>
        </div>
      </div>`).join('')}
  </div>`;
  results.forEach(({ res }) => { updateSessionStats(res); addToTimeline(res); });
  showToast(`✅ Analyzed ${results.length} lines from ${file.name}`, 'ok');
}

// ═══════════════════════════════════════════════════════════
//  EXAMPLE CHIPS
// ═══════════════════════════════════════════════════════════
function buildExamples() {
  const grid = document.getElementById('ex-grid');
  EXAMPLES.forEach(ex => {
    const btn = document.createElement('button');
    btn.className = 'ex-chip';
    btn.innerHTML = `<div class="ex-emo" style="color:${EMOTION_COLORS[ex.emo]}">${EMOTION_EMOJI[ex.emo]} ${ex.emo}</div>${ex.text}`;
    btn.onclick = () => {
      const ta = document.getElementById('live-ta');
      ta.value = ex.text;
      document.getElementById('char-ct').textContent = ex.text.length;
      runAnalysis(ex.text);
    };
    grid.appendChild(btn);
  });
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const text = document.getElementById('live-ta')?.value?.trim();
    if (text) runAnalysis(text);
  }
});