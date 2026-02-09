import { CONFIG } from './config.js';

const REQUEST_TIMEOUT_MS = 45_000;
const VALID_PROMPT_MODES = new Set(CONFIG.PROMPT_MODES);

async function safeParseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    return { message: text || null };
  } catch {
    return null;
  }
}

export function resolvePromptMode(mode) {
  if (typeof mode !== 'string') return CONFIG.DEFAULT_PROMPT_MODE;
  const normalized = mode.trim().toLowerCase();
  return VALID_PROMPT_MODES.has(normalized) ? normalized : CONFIG.DEFAULT_PROMPT_MODE;
}

function buildBasePrompt(language, mode) {
  if (mode === 'mcq') {
    return `You are a concise coding assistant for interview MCQs.
Look at the screenshots and answer in ${language}.
Response format:
1) Final answer (option/choice)
2) Short explanation (2-5 bullets)
3) Elimination notes for other options.
If the screenshot is ambiguous, say what is missing and provide the best probable answer.`;
  }

  return `You are a concise coding assistant for stealth interview help.
First give your thoughts on the problem.
Look at the screenshots and directly give the clean solution in ${language}.
If code is needed, provide only the essential working code in markdown code blocks.
Give solution with comments explaining the code.
After giving the solution, give complexity (both time and space).`;
}

export async function processScreenshot(
  imageDataOrArray,
  apiKey,
  language = CONFIG.DEFAULT_LANGUAGE,
  options = {}
) {
  if (!Array.isArray(imageDataOrArray) || imageDataOrArray.length === 0) {
    throw new Error('No screenshots to process.');
  }

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Missing GEMINI_API_KEY. Add it to your .env file.');
  }

  const mode = resolvePromptMode(options.mode);
  const prompt = buildBasePrompt(language, mode);

  const contents = imageDataOrArray.map(img => ({
    inline_data: { mime_type: "image/png", data: img }
  }));
  contents.push({ text: prompt });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: contents }],
          generationConfig: { temperature: 0.4 }
        })
      }
    );

    if (!response.ok) {
      const errorData = await safeParseBody(response);
      const message =
        errorData?.error?.message ||
        errorData?.message ||
        `API request failed with status ${response.status}`;
      throw new Error(message);
    }

    const data = await safeParseBody(response);
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out while processing screenshots.');
    }
    console.error('API Error:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
