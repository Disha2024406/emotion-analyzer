// ═══════════════════════════════════════════════════════════
//  ui.js — DOM rendering helpers
// ═══════════════════════════════════════════════════════════

import { EMOTION_COLORS, EMOTION_BG, EMOTION_EMOJI } from './config.js';

// ── Toast ─────────────────────────────────────────────────
let _toastTimer;
export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

// ── API Key UI ────────────────────────────────────────────
export function setKeyStatus(text, cls = '') {
  const el = document.getElementById('api-key-status');
  el.textContent = text;
  el.className   = `api-key-status ${cls}`;
}

// ── Result panel ──────────────────────────────────────────
export function renderResult(r) {
  document.getElementById('res-placeholder').style.display = 'none';
  document.getElementById('res-filled').style.display      = 'block';

  const hero = document.getElementById('emo-hero');
  hero.style.background  = EMOTION_BG[r.emotion] || '#1a1a2e';
  hero.style.borderColor = (EMOTION_COLORS[r.emotion] || '#fff') + '44';

  const emojiEl = document.getElementById('emo-emoji');
  emojiEl.textContent = EMOTION_EMOJI[r.emotion] || r.emoji || '❓';
  emojiEl.classList.remove('bounce');
  void emojiEl.offsetWidth; // reflow to restart animation
  emojiEl.classList.add('bounce');

  document.getElementById('emo-name').textContent = r.emotion;
  document.getElementById('emo-name').style.color  = EMOTION_COLORS[r.emotion] || '#fff';
  document.getElementById('emo-conf').textContent  = `${r.confidence}% confident`;
  document.getElementById('emo-latency').textContent = `Analyzed in ${r.latency_ms}ms`;

  // Show negation hint when local model suppressed an emotion
  const negHint = document.getElementById('negation-hint');
  if (negHint) {
    if (r.negated && r.negated.length > 0) {
      negHint.textContent = `\u26a1 Negation detected \u2014 suppressed: ${r.negated.join(', ')}`;
      negHint.style.display = 'block';
    } else {
      negHint.style.display = 'none';
    }
  }

  // Probability bars
  const list = document.getElementById('prob-list');
  list.innerHTML = '';

  (r.breakdown || []).sort((a,b) => b.probability - a.probability).forEach(item => {
    const isTop = item.emotion === r.emotion;
    const div = document.createElement('div');
    div.className = 'prob-row';
    div.innerHTML = `
      <div class="prob-hdr">
        <span class="prob-name" style="color:${isTop ? item.color : 'var(--text)'}">
          ${EMOTION_EMOJI[item.emotion] || ''} ${item.emotion}
        </span>
        <span class="prob-pct">${item.probability}%</span>
      </div>
      <div class="prob-track">
        <div class="prob-bar" id="pb-${item.emotion}" style="background:${item.color}"></div>
      </div>
    `;
    list.appendChild(div);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const bar = document.getElementById(`pb-${item.emotion}`);
      if (bar) bar.style.width = `${item.probability}%`;
    }));
  });
}

export function clearResult() {
  document.getElementById('res-placeholder').style.display = 'flex';
  document.getElementById('res-filled').style.display      = 'none';
}

// Streaming partial update — just pulse the emoji while waiting
export function showStreamingState(active) {
  const badge = document.getElementById('streaming-badge');
  if (badge) badge.classList.toggle('on', active);
}

// ── Timeline ──────────────────────────────────────────────
const _timeline = [];

export function addToTimeline(r) {
  _timeline.push(r);
  if (_timeline.length > 40) _timeline.shift();

  const container = document.getElementById('timeline');
  container.innerHTML = '';

  _timeline.forEach((item, i) => {
    const dot = document.createElement('div');
    dot.className = `t-dot${i === _timeline.length - 1 ? ' newest' : ''}`;
    dot.title     = `${item.emotion} (${item.confidence}%)`;
    dot.textContent = EMOTION_EMOJI[item.emotion] || '❓';
    dot.style.background = (EMOTION_COLORS[item.emotion] || '#333') + '33';
    container.appendChild(dot);
  });
}

// ── Dashboard ─────────────────────────────────────────────
const _counts = {};
let   _total  = 0;
const _confs  = [];
const _recent = [];

export function updateSessionStats(r) {
  _total++;
  _counts[r.emotion] = (_counts[r.emotion] || 0) + 1;
  _confs.push(r.confidence);
  _recent.unshift(r);
  if (_recent.length > 50) _recent.pop();
}

export function renderDashboard() {
  document.getElementById('kpi-total').textContent = _total;

  if (_total === 0) return;

  const avg = (_confs.reduce((a,b) => a+b, 0) / _confs.length).toFixed(1);
  document.getElementById('kpi-conf').textContent = `${avg}%`;

  const top = Object.entries(_counts).sort((a,b) => b[1]-a[1])[0];
  document.getElementById('kpi-top').textContent =
    top ? `${EMOTION_EMOJI[top[0]]} ${top[0]}` : '—';

  // Distribution bars
  const barsEl = document.getElementById('dist-bars');
  barsEl.innerHTML = '';
  Object.entries(_counts).sort((a,b) => b[1]-a[1]).forEach(([emo, cnt]) => {
    const pct = Math.round(cnt / _total * 100);
    const row = document.createElement('div');
    row.className = 'emo-dist-row';
    row.innerHTML = `
      <div class="emo-dist-lbl">${EMOTION_EMOJI[emo]} ${emo}</div>
      <div class="emo-dist-track">
        <div class="emo-dist-bar" id="db-${emo}" style="background:${EMOTION_COLORS[emo]}"></div>
      </div>
      <div class="emo-dist-pct">${cnt} (${pct}%)</div>
    `;
    barsEl.appendChild(row);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = document.getElementById(`db-${emo}`);
      if (b) b.style.width = `${pct}%`;
    }));
  });

  // Recent list
  const recentEl = document.getElementById('recent-list');
  recentEl.innerHTML = '';
  _recent.slice(0, 10).forEach(r => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    row.innerHTML = `
      <div class="recent-emo" style="color:${EMOTION_COLORS[r.emotion]}">
        ${EMOTION_EMOJI[r.emotion] || ''} ${r.emotion}
      </div>
      <div style="flex:1;color:var(--muted);font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${(r._text || '').slice(0, 60)}
      </div>
      <div class="recent-conf">${r.confidence}%</div>
    `;
    recentEl.appendChild(row);
  });
}