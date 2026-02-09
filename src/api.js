import { CONFIG } from './config.js';

const REQUEST_TIMEOUT_MS = 45_000;
const VALID_PROMPT_MODES = new Set(CONFIG.PROMPT_MODES);
const VALID_AI_PROVIDERS = new Set(CONFIG.AI_PROVIDERS);

const providerRoundRobin = new Map();

function nextRoundRobinIndex(provider, size) {
  const safeSize = Number.isInteger(size) && size > 0 ? size : 1;
  const current = providerRoundRobin.get(provider) ?? 0;
  providerRoundRobin.set(provider, (current + 1) % safeSize);
  return current % safeSize;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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

export function resolveAIProvider(provider) {
  if (typeof provider !== 'string') return CONFIG.DEFAULT_AI_PROVIDER;
  const normalized = provider.trim().toLowerCase();
  return VALID_AI_PROVIDERS.has(normalized) ? normalized : CONFIG.DEFAULT_AI_PROVIDER;
}

function parseApiKeys(raw) {
  if (typeof raw !== 'string') return [];

  const asJson = safeJsonParse(raw.trim());
  if (Array.isArray(asJson)) {
    return asJson
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  return raw
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveProviderKeys(provider, env = process.env) {
  const keyMap = {
    gemini: {
      plural: 'GEMINI_API_KEYS',
      single: 'GEMINI_API_KEY'
    },
    openai: {
      plural: 'OPENAI_API_KEYS',
      single: 'OPENAI_API_KEY'
    },
    anthropic: {
      plural: 'ANTHROPIC_API_KEYS',
      single: 'ANTHROPIC_API_KEY'
    },
    openrouter: {
      plural: 'OPENROUTER_API_KEYS',
      single: 'OPENROUTER_API_KEY'
    }
  };

  const keys = keyMap[provider];
  if (!keys) return [];

  const multi = parseApiKeys(env[keys.plural]);
  const single = parseApiKeys(env[keys.single]);

  return [...multi, ...single].filter(Boolean);
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

function classifyErrorMessage(provider, status, message, keyIndex, totalKeys) {
  const prefix = `[${provider}]`;
  const statusPart = Number.isInteger(status) ? ` (status ${status})` : '';
  const keyPart = totalKeys > 1 ? ` [key ${keyIndex + 1}/${totalKeys}]` : '';

  if (status === 401 || status === 403) {
    return `${prefix} Authentication failed${statusPart}${keyPart}. Check API key validity and permissions.\nProvider says: ${message}`;
  }
  if (status === 429) {
    return `${prefix} Rate limit exceeded${statusPart}${keyPart}. Rotated through available keys but all were limited.\nProvider says: ${message}`;
  }
  if (status >= 500 && status <= 599) {
    return `${prefix} Provider service is temporarily unavailable${statusPart}${keyPart}. Retry shortly.\nProvider says: ${message}`;
  }
  if (status === 400) {
    return `${prefix} Invalid request${statusPart}${keyPart}. Check model id or payload format.\nProvider says: ${message}`;
  }
  return `${prefix} API request failed${statusPart}${keyPart}.\nProvider says: ${message}`;
}

function isRateLimited(status, message = '') {
  if (status === 429) return true;
  const normalized = String(message).toLowerCase();
  return normalized.includes('rate limit') || normalized.includes('too many requests');
}

function classifyTransportError(provider, error, keyIndex, totalKeys) {
  const message = String(error?.message || error);
  const keyPart = totalKeys > 1 ? ` [key ${keyIndex + 1}/${totalKeys}]` : '';
  const prefix = `[${provider}]`;

  if (message.toLowerCase().includes('fetch failed') || message.toLowerCase().includes('network')) {
    return `${prefix} Network error${keyPart}. Check internet connectivity or provider endpoint reachability.\nProvider says: ${message}`;
  }

  return `${prefix} Request failed${keyPart}. ${message}`;
}

function extractOpenAIText(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  if (Array.isArray(direct)) {
    const joined = direct
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  }

  return null;
}

function extractAnthropicText(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .map((part) => (part?.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || null;
}

function buildProviderRequest(provider, model, apiKey, images, prompt) {
  if (provider === 'gemini') {
    const parts = images.map((img) => ({
      inline_data: { mime_type: 'image/png', data: img }
    }));
    parts.push({ text: prompt });

    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.4 }
        })
      },
      parseText: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text || null
    };
  }

  if (provider === 'anthropic') {
    const content = images.map((img) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: img
      }
    }));
    content.push({ type: 'text', text: prompt });

    return {
      url: 'https://api.anthropic.com/v1/messages',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: 0.4,
          messages: [{ role: 'user', content }]
        })
      },
      parseText: extractAnthropicText
    };
  }

  const userContent = [
    { type: 'text', text: prompt },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${img}` }
    }))
  ];

  if (provider === 'openrouter') {
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          messages: [{ role: 'user', content: userContent }]
        })
      },
      parseText: extractOpenAIText
    };
  }

  return {
    url: 'https://api.openai.com/v1/chat/completions',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [{ role: 'user', content: userContent }]
      })
    },
    parseText: extractOpenAIText
  };
}

function resolveModelForProvider(provider, options = {}) {
  const overrideModel = typeof options.model === 'string' ? options.model.trim() : '';
  if (overrideModel) return overrideModel;

  if (provider === 'openai') return CONFIG.OPENAI_MODEL;
  if (provider === 'anthropic') return CONFIG.ANTHROPIC_MODEL;
  if (provider === 'openrouter') return CONFIG.OPENROUTER_MODEL;
  return CONFIG.GEMINI_MODEL;
}

export async function processScreenshot(
  imageDataOrArray,
  _legacyApiKey,
  language = CONFIG.DEFAULT_LANGUAGE,
  options = {}
) {
  if (!Array.isArray(imageDataOrArray) || imageDataOrArray.length === 0) {
    throw new Error('No screenshots to process.');
  }

  const mode = resolvePromptMode(options.mode);
  const provider = resolveAIProvider(options.provider);
  const prompt = buildBasePrompt(language, mode);
  const keys = resolveProviderKeys(provider);

  if (keys.length === 0) {
    throw new Error(
      `[${provider}] Missing API key.\nSet ${provider.toUpperCase()}_API_KEY for a single key or ${provider.toUpperCase()}_API_KEYS as comma/newline/JSON array for multiple keys.`
    );
  }

  const model = resolveModelForProvider(provider, options);
  const startIndex = nextRoundRobinIndex(provider, keys.length);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let lastError = null;

  try {
    for (let attempt = 0; attempt < keys.length; attempt += 1) {
      const keyIndex = (startIndex + attempt) % keys.length;
      const apiKey = keys[keyIndex];
      const request = buildProviderRequest(provider, model, apiKey, imageDataOrArray, prompt);

      try {
        const response = await fetch(request.url, {
          ...request.options,
          signal: controller.signal
        });

        if (!response.ok) {
          const errorData = await safeParseBody(response);
          const message =
            errorData?.error?.message ||
            errorData?.message ||
            `API request failed with status ${response.status}`;

          const formatted = classifyErrorMessage(provider, response.status, message, keyIndex, keys.length);
          const shouldRetryWithNextKey = keys.length > 1 && isRateLimited(response.status, message) && attempt < keys.length - 1;

          if (shouldRetryWithNextKey) {
            lastError = new Error(formatted);
            continue;
          }

          throw new Error(formatted);
        }

        const data = await safeParseBody(response);
        const parsedText = request.parseText(data);

        if (parsedText && String(parsedText).trim()) {
          return parsedText;
        }

        throw new Error(`[${provider}] Invalid response format from API.`);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(`[${provider}] Request timed out while processing screenshots.`);
        }

        const msg = String(error?.message || error);
        const retryWithNextKey = keys.length > 1 && isRateLimited(undefined, msg) && attempt < keys.length - 1;

        if (retryWithNextKey) {
          lastError = error;
          continue;
        }

        if (msg.startsWith(`[${provider}]`)) {
          throw error;
        }

        throw new Error(classifyTransportError(provider, error, keyIndex, keys.length));
      }
    }

    throw lastError || new Error(`[${provider}] Failed to process screenshot request.`);
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
