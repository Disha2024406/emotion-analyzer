// ═══════════════════════════════════════════════════════════
//  app.js — main entry point (all events bound here, no onclick= in HTML)
// ═══════════════════════════════════════════════════════════

import { EXAMPLES, EMOTION_COLORS, EMOTION_EMOJI } from './config.js';
import { predictEmotion, setApiKey, getApiKey, hasApiKey } from './api.js';
import { loadModel, isReady, predict as localPredict } from './classifier.js';
import { analyzeImageFile } from './vision.js';
import {
  showToast, setKeyStatus,
  renderResult, clearResult, showStreamingState,
  addToTimeline, updateSessionStats, renderDashboard,
} from './ui.js';
import { initSpeechRecognition, toggleMic, stopMic, getMicText } from './mic.js';
import { updateEmotionChart } from './analytics.js';
import { deepAnalyze, EMOTIONS_27 } from './deep_analyze.js';

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

  // ── Analytics clear ──────────────────────────────────────
  // ── Deep Analyze button ──────────────────────────────────
  document.getElementById('deep-analyze-btn')?.addEventListener('click', runDeepAnalysis);

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
  ['type', 'mic', 'file'].forEach(m => {
    const el = document.getElementById(`mode-${m}`);
    if (el) el.style.display = m === mode ? 'block' : 'none';
  });
  if (mode !== 'type') clearResult();
  if (mode !== 'mic')  { try { stopMic(); } catch {} }
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
      if (lbl) {
        if (result.is_factual && result.topic && result.topic !== 'personal' && result.topic !== 'general') {
          lbl.textContent = `Topic: ${result.topic} · neutral (${result.confidence}%) · local`;
        } else {
          lbl.textContent = `Detected: ${result.emotion} (${result.confidence}%) · local`;
        }
      }
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
//  DEEP ANALYSIS
// ═══════════════════════════════════════════════════════════
async function runDeepAnalysis() {
  const text = document.getElementById('live-ta')?.value?.trim();
  if (!text) return showToast('⚠ Type something first.', 'err');
  if (!hasApiKey()) return showToast('⚠ Groq API key required for Deep Analysis.', 'err');

  const btn = document.getElementById('deep-analyze-btn');
  btn.textContent = '⏳ Analyzing…';
  btn.disabled = true;

  const resultEl      = document.getElementById('deep-result');
  const placeholderEl = document.getElementById('deep-placeholder');

  try {
    const r = await deepAnalyze(text);
    placeholderEl.style.display = 'none';
    resultEl.style.display      = 'block';
    _renderDeepResult(r);
    updateEmotionChart(r.primary_emotions?.[0] || 'neutral');
  } catch (err) {
    showToast(`⚠ ${err.message}`, 'err');
    console.error('[deepAnalysis]', err);
  } finally {
    btn.textContent = '✨ Deep Analyze';
    btn.disabled = false;
  }
}

function _renderDeepResult(r) {
  // ── Risk banner — proportional to actual risk level ─────
  const riskBanner = document.getElementById('deep-risk-banner');
  const riskConfig = {
    low:      { icon: 'ℹ️',  label: 'Low risk',      note: 'Politically charged or opinionated content — no direct harm signal detected.' },
    medium:   { icon: '⚠️',  label: 'Medium risk',   note: 'Contains hostile or dehumanizing framing. Review recommended.' },
    high:     { icon: '🔴',  label: 'High risk',     note: null },
    critical: { icon: '🚨',  label: 'Critical',      note: null },
  };
  const rc = riskConfig[r.risk_level];
  if (rc) {
    riskBanner.style.display = 'flex';
    riskBanner.className = `deep-risk-banner risk-${r.risk_level}`;
    const noteText = r.crisis_note || rc.note || '';
    riskBanner.innerHTML = `
      <span style="font-size:1.4rem">${rc.icon}</span>
      <div>
        <strong>${rc.label}</strong>
        ${noteText ? `<div style="font-size:.82rem;margin-top:3px">${noteText}</div>` : ''}
        ${r.risk_level === 'critical' ? '<div style="font-size:.82rem;margin-top:6px;opacity:.85">Crisis support (India): <strong>iCall 9152987821</strong> · <strong>Vandrevala 1860-2662-345</strong></div>' : ''}
      </div>
    `;
  } else {
    riskBanner.style.display = 'none';
  }

  // ── Valence gauge (−1 to +1 → 0% to 100%) ────────────
  const valPct  = Math.round((r.valence + 1) / 2 * 100);
  const valFill = document.getElementById('valence-fill');
  const valence = r.valence ?? 0;
  valFill.style.width      = `${valPct}%`;
  valFill.style.background = valence >= 0
    ? `linear-gradient(90deg, #4ade80, #22c55e)`
    : `linear-gradient(90deg, #ef4444, #f97316)`;
  document.getElementById('valence-val').textContent =
    (valence >= 0 ? '+' : '') + valence.toFixed(2);

  // ── Arousal gauge (0 to 1 → 0% to 100%) ─────────────
  const arPct = Math.round((r.arousal ?? 0.5) * 100);
  const arousalFill = document.getElementById('arousal-fill');
  arousalFill.style.width      = `${arPct}%`;
  arousalFill.style.background = `linear-gradient(90deg, #60a5fa, #f97316)`;
  document.getElementById('arousal-val').textContent = `${arPct}%`;

  // ── Ambiguity ─────────────────────────────────────────
  const ambPct = Math.round((r.ambiguity_score ?? 0) * 100);
  const ambBar = document.getElementById('ambiguity-bar');
  ambBar.style.width      = `${ambPct}%`;
  ambBar.style.background = ambPct > 60
    ? `linear-gradient(90deg, #f59e0b, #ef4444)`
    : `linear-gradient(90deg, #4ade80, #60a5fa)`;
  document.getElementById('ambiguity-val').textContent = `${ambPct}%`;

  // ── Insight ───────────────────────────────────────────
  document.getElementById('insight-text').textContent =
    r.psychological_insight || 'No insight generated.';
  // Build context line: content_type + sentiment + flags
  const flagsStr = (r.flags || []).filter(f => f !== 'none').join(' · ');
  const ctxParts = [
    r.content_type   ? `Type: ${r.content_type}`         : null,
    r.sentiment      ? `Sentiment: ${r.sentiment}`        : null,
    flagsStr         ? `⚑ ${flagsStr}`                   : null,
  ].filter(Boolean);
  document.getElementById('insight-context').textContent = ctxParts.join('  |  ') || 'Context: unknown';
  document.getElementById('insight-latency').textContent = `${r.latency_ms}ms · Groq`;

  // ── Primary emotion badges ────────────────────────────
  const badgesEl = document.getElementById('primary-badges');
  badgesEl.innerHTML = '';
  (r.primary_emotions || []).forEach(emo => {
    const meta = EMOTIONS_27[emo] || { emoji: '❓', color: '#888' };
    const badge = document.createElement('div');
    badge.className = 'primary-badge';
    badge.style.borderColor = meta.color;
    badge.style.color       = meta.color;
    badge.innerHTML = `${meta.emoji} ${emo}`;
    badgesEl.appendChild(badge);
  });

  // ── 27-emotion grouped heatmap ────────────────────────
  const groups = {};
  (r.emotions_sorted || []).forEach(item => {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  });

  const groupsEl = document.getElementById('emotion-groups');
  groupsEl.innerHTML = '';

  const groupOrder = ['joy','appreciation','love','anger','sadness','fear','ambiguous','neutral'];
  const groupLabels = {
    joy:'Joy & Positivity', appreciation:'Appreciation', love:'Love & Care',
    anger:'Anger & Disapproval', sadness:'Sadness & Grief', fear:'Fear & Anxiety',
    ambiguous:'Ambiguous', neutral:'Neutral',
  };

  groupOrder.forEach(gKey => {
    const items = groups[gKey];
    if (!items || items.every(i => i.score < 2)) return;

    const section = document.createElement('div');
    section.className = 'emo-group';
    section.innerHTML = `<div class="emo-group-label">${groupLabels[gKey] || gKey}</div>`;

    items.forEach(item => {
      if (item.score < 1) return;
      const row = document.createElement('div');
      row.className = 'emo-heat-row';
      row.innerHTML = `
        <div class="emo-heat-name">
          <span>${item.emoji}</span>
          <span>${item.name}</span>
        </div>
        <div class="emo-heat-track">
          <div class="emo-heat-bar" style="width:${item.score}%;background:${item.color}"></div>
        </div>
        <div class="emo-heat-pct" style="color:${item.score > 30 ? item.color : 'var(--muted)'}">${item.score}%</div>
      `;
      section.appendChild(row);
    });
    groupsEl.appendChild(section);
  });
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