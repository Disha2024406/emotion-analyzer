// ═══════════════════════════════════════════════════════════
//  config.js — shared constants & emotion data
// ═══════════════════════════════════════════════════════════

export const EMOTION_COLORS = {
  joy:      '#FFD700',
  sadness:  '#4f8fff',
  anger:    '#ff4d4d',
  fear:     '#c084fc',
  love:     '#ff69b4',
  surprise: '#4ade80',
};

export const EMOTION_BG = {
  joy:      '#3d3500',
  sadness:  '#001a3d',
  anger:    '#3d0000',
  fear:     '#1e003d',
  love:     '#3d0020',
  surprise: '#003d15',
};

export const EMOTION_EMOJI = {
  joy:      '😄',
  sadness:  '😢',
  anger:    '😠',
  fear:     '😨',
  love:     '❤️',
  surprise: '😮',
};

export const EXAMPLES = [
  { text: "I'm absolutely thrilled about this!",       emo: 'joy'      },
  { text: "I feel so lost and heartbroken today.",     emo: 'sadness'  },
  { text: "This is infuriating, I can't stand it!",    emo: 'anger'    },
  { text: "I'm terrified of what might happen next.",  emo: 'fear'     },
  { text: "I love spending time with my family.",      emo: 'love'     },
  { text: "Oh wow, I never expected that at all!",     emo: 'surprise' },
  { text: "Everything feels perfect right now.",       emo: 'joy'      },
  { text: "I miss them so much, it hurts.",            emo: 'sadness'  },
];

// Groq API — OpenAI-compatible endpoint
export const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Available fast Groq models (pick one):
//   'llama-3.3-70b-versatile'   ← best quality
//   'llama-3.1-8b-instant'      ← fastest / cheapest
//   'mixtral-8x7b-32768'        ← good balance
export const MODEL = 'openai/gpt-oss-120b';
// System prompt for emotion detection
export const SYSTEM_PROMPT = `You are an emotion detection AI. Analyze the emotional content of text and respond ONLY with a JSON object in this exact format (no markdown, no explanation):

{
  "emotion": "<primary emotion: joy|sadness|anger|fear|love|surprise>",
  "confidence": <number 0-100>,
  "latency_ms": <realistic number 2-8>,
  "breakdown": [
    {"emotion": "joy",      "probability": <0-100>, "color": "#FFD700"},
    {"emotion": "sadness",  "probability": <0-100>, "color": "#4f8fff"},
    {"emotion": "anger",    "probability": <0-100>, "color": "#ff4d4d"},
    {"emotion": "fear",     "probability": <0-100>, "color": "#c084fc"},
    {"emotion": "love",     "probability": <0-100>, "color": "#ff69b4"},
    {"emotion": "surprise", "probability": <0-100>, "color": "#4ade80"}
  ]
}

Rules:
- The primary "emotion" must be the highest probability one in breakdown
- "confidence" must match the probability of the primary emotion in breakdown
- All breakdown probabilities must sum to 100
- Be accurate and nuanced in your analysis`;
