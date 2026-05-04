// analytics-boot.js — initialises the chart and exposes globals
import { initAnalyticsChart, clearEmotionData } from './analytics.js';

// Init chart on DOM ready (Chart.js CDN already loaded via <script> tag)
window.addEventListener('DOMContentLoaded', () => {
  initAnalyticsChart();
});

// Expose to inline onclick in index.html
window.clearAnalytics = () => {
  clearEmotionData();
};

// Also expose updateEmotionChart globally so app.js can import OR call it directly
import { updateEmotionChart } from './analytics.js';
window.updateEmotionChart = updateEmotionChart;