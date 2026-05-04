// ═══════════════════════════════════════════════════════════
//  mic.js — Web Speech API integration
// ═══════════════════════════════════════════════════════════

let recognition   = null;
let isRecording   = false;
let micTranscript = '';
let onTextReady   = null; // callback(text) when user clicks Analyze

export function initSpeechRecognition(analyzeCallback) {
  onTextReady = analyzeCallback;

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    document.getElementById('mic-no-support').style.display = 'block';
    document.getElementById('mic-ui').style.display         = 'none';
    return;
  }

  recognition                = new SpeechRec();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) micTranscript += final + ' ';

    const display = micTranscript + interim;
    const el = document.getElementById('mic-transcript');
    el.innerHTML = display
      ? `<span style="color:var(--text)">${display}</span>`
      : `<span style="color:var(--muted)">Listening…</span>`;

    const analyzeBtn = document.getElementById('mic-analyze-btn');
    analyzeBtn.style.display = micTranscript.trim() ? 'block' : 'none';
  };

  recognition.onerror = (e) => {
    document.getElementById('mic-status').textContent = `Error: ${e.error}`;
    _stopMicUI();
    isRecording = false;
  };

  recognition.onend = () => {
    // Restart if user hasn't manually stopped
    if (isRecording) recognition.start();
  };
}

export function toggleMic() {
  if (isRecording) stopMic();
  else startMic();
}

export function startMic() {
  if (!recognition) return;
  micTranscript = '';
  document.getElementById('mic-transcript').innerHTML =
    '<span style="color:var(--muted)">Listening…</span>';
  document.getElementById('mic-analyze-btn').style.display = 'none';

  isRecording = true;
  try { recognition.start(); } catch {}

  _startMicUI();
}

export function stopMic() {
  isRecording = false;
  try { recognition.stop(); } catch {}
  _stopMicUI();
}

export function getMicText() {
  return micTranscript.trim();
}

// ── Private UI helpers ────────────────────────────────────
function _startMicUI() {
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-btn').textContent = '⏹️';
  document.getElementById('mic-rings').classList.add('on');
  document.getElementById('mic-status').textContent = '🔴 Recording… speak now';
}

function _stopMicUI() {
  document.getElementById('mic-btn').classList.remove('recording');
  document.getElementById('mic-btn').textContent = '🎙️';
  document.getElementById('mic-rings').classList.remove('on');
  document.getElementById('mic-status').textContent = 'Recording stopped';
}