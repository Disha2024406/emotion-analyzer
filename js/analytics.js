// ═══════════════════════════════════════════════════════════
//  analytics.js — Emotion Analytics Dashboard (Chart.js)
//  • Reads/writes counts to localStorage for persistence
//  • Exports updateEmotionChart(emotion) — call on every prediction
//  • Exports clearEmotionData() — wired to the Clear button
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = 'emotionai_counts';

// Canonical emotion list (matches project + chart display order)
const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'love', 'surprise'];

const CHART_COLORS = {
  joy:      { bg: 'rgba(255,215,0,0.7)',    border: '#FFD700' },
  sadness:  { bg: 'rgba(79,143,255,0.7)',   border: '#4f8fff' },
  anger:    { bg: 'rgba(255,77,77,0.7)',    border: '#ff4d4d' },
  fear:     { bg: 'rgba(192,132,252,0.7)',  border: '#c084fc' },
  love:     { bg: 'rgba(255,105,180,0.7)',  border: '#ff69b4' },
  surprise: { bg: 'rgba(74,222,128,0.7)',   border: '#4ade80' },
};

const LABELS = {
  joy: 'Joy 😄', sadness: 'Sadness 😢', anger: 'Anger 😠',
  fear: 'Fear 😨', love: 'Love ❤️', surprise: 'Surprise 😮',
};

// ── State ─────────────────────────────────────────────────
let _chart = null;
let _counts = _loadCounts();

// ── localStorage helpers ──────────────────────────────────
function _loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    // Ensure all emotions present even if not yet seen
    const counts = {};
    EMOTIONS.forEach(e => { counts[e] = saved[e] || 0; });
    return counts;
  } catch {
    const counts = {};
    EMOTIONS.forEach(e => { counts[e] = 0; });
    return counts;
  }
}

function _saveCounts() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_counts)); } catch {}
}

// ── Chart initialisation ──────────────────────────────────
export function initAnalyticsChart() {
  const canvas = document.getElementById('emotion-chart');
  if (!canvas) return;

  // Guard: Chart.js must be loaded globally via CDN script tag
  if (typeof Chart === 'undefined') {
    console.warn('[analytics] Chart.js not loaded yet — retrying in 500ms');
    setTimeout(initAnalyticsChart, 500);
    return;
  }

  const ctx = canvas.getContext('2d');

  _chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: EMOTIONS.map(e => LABELS[e]),
      datasets: [{
        label: 'Times Detected',
        data: EMOTIONS.map(e => _counts[e]),
        backgroundColor: EMOTIONS.map(e => CHART_COLORS[e].bg),
        borderColor:     EMOTIONS.map(e => CHART_COLORS[e].border),
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1120',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#eef0f8',
          bodyColor: '#a095ff',
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.raw} detection${ctx.raw !== 1 ? 's' : ''}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#6b7399', font: { family: 'Inter', size: 12 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#6b7399',
            font: { family: 'Inter', size: 12 },
            stepSize: 1,
            precision: 0,
          },
        },
      },
    },
  });

  _refreshTotalBadge();
}

// ── Public API ────────────────────────────────────────────

/**
 * Call this every time a new emotion is detected.
 * Works even if the chart canvas isn't visible yet.
 */
export function updateEmotionChart(emotion) {
  const key = emotion?.toLowerCase?.();
  if (!key || !EMOTIONS.includes(key)) return;  // ignore unknown emotions

  _counts[key] = (_counts[key] || 0) + 1;
  _saveCounts();
  _refreshTotalBadge();

  if (_chart) {
    _chart.data.datasets[0].data = EMOTIONS.map(e => _counts[e]);
    _chart.update('active');
  }
}

/** Reset all counts, clear localStorage, redraw empty chart */
export function clearEmotionData() {
  EMOTIONS.forEach(e => { _counts[e] = 0; });
  _saveCounts();
  _refreshTotalBadge();

  if (_chart) {
    _chart.data.datasets[0].data = EMOTIONS.map(() => 0);
    _chart.update('active');
  }
}

// ── Internal helpers ──────────────────────────────────────
function _refreshTotalBadge() {
  const total = EMOTIONS.reduce((s, e) => s + (_counts[e] || 0), 0);
  const el = document.getElementById('analytics-total');
  if (el) el.textContent = `${total} total detection${total !== 1 ? 's' : ''}`;
}