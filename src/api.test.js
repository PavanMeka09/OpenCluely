import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processScreenshot,
  resolvePromptMode,
  resolveAIProvider,
  resolveProviderKeys
} from './api.js';

class HeadersMock {
  constructor(contentType = '') {
    this.contentType = contentType;
  }

  get(name) {
    if (name.toLowerCase() === 'content-type') {
      return this.contentType;
    }
    return null;
  }
}

function makeJsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new HeadersMock('application/json'),
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

function withEnv(overrides, fn) {
  const snapshot = { ...process.env };
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = snapshot;
    });
}

test('resolvePromptMode falls back to default for invalid mode', () => {
  assert.equal(resolvePromptMode('mcq'), 'mcq');
  assert.equal(resolvePromptMode('code'), 'code');
  assert.equal(resolvePromptMode('unknown'), 'code');
  assert.equal(resolvePromptMode(null), 'code');
});

test('resolveAIProvider defaults to gemini when invalid', () => {
  assert.equal(resolveAIProvider('gemini'), 'gemini');
  assert.equal(resolveAIProvider('openai'), 'openai');
  assert.equal(resolveAIProvider('anthropic'), 'anthropic');
  assert.equal(resolveAIProvider('openrouter'), 'openrouter');
  assert.equal(resolveAIProvider('x'), 'gemini');
  assert.equal(resolveAIProvider(undefined), 'gemini');
});

test('resolveProviderKeys parses multi-key formats', () => {
  assert.deepEqual(
    resolveProviderKeys('openai', {
      OPENAI_API_KEYS: 'k1,k2\nk3',
      OPENAI_API_KEY: 'k4'
    }),
    ['k1', 'k2', 'k3', 'k4']
  );

  assert.deepEqual(
    resolveProviderKeys('gemini', {
      GEMINI_API_KEYS: '["a","b"]',
      GEMINI_API_KEY: ''
    }),
    ['a', 'b']
  );
});

test('processScreenshot validates screenshots and key presence', async () => {
  await assert.rejects(() => processScreenshot([], '', 'Python'), /No screenshots to process/);

  await withEnv(
    {
      GEMINI_API_KEY: '',
      GEMINI_API_KEYS: ''
    },
    async () => {
      await assert.rejects(
        () => processScreenshot(['a'], undefined, 'Python', { provider: 'gemini' }),
        /Missing API key/
      );
    }
  );
});

test('processScreenshot uses gemini endpoint and parses success response', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(String(url), /generativelanguage\.googleapis\.com/);
      assert.equal(options.headers['x-goog-api-key'], 'g-key');
      return makeJsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok-result' }] } }]
      });
    };

    await withEnv(
      {
        GEMINI_API_KEY: 'g-key',
        GEMINI_API_KEYS: ''
      },
      async () => {
        const result = await processScreenshot(['abcd'], undefined, 'Python', { provider: 'gemini' });
        assert.equal(result, 'ok-result');
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('processScreenshot retries with next key on rate limit and load balances keys', async () => {
  const originalFetch = global.fetch;
  const seenKeys = [];

  try {
    global.fetch = async (_url, options) => {
      const header = options.headers['x-goog-api-key'];
      seenKeys.push(header);
      if (header === 'k1') {
        return makeJsonResponse({ error: { message: 'rate limit' } }, false, 429);
      }
      return makeJsonResponse({
        candidates: [{ content: { parts: [{ text: `ok-${header}` }] } }]
      });
    };

    await withEnv(
      {
        GEMINI_API_KEYS: 'k1,k2',
        GEMINI_API_KEY: ''
      },
      async () => {
        const first = await processScreenshot(['abcd'], undefined, 'Python', { provider: 'gemini' });
        const second = await processScreenshot(['abcd'], undefined, 'Python', { provider: 'gemini' });

        assert.equal(first, 'ok-k2');
        assert.equal(second, 'ok-k2');

        // Across calls and retries both keys must be exercised.
        assert.equal(seenKeys.includes('k1'), true);
        assert.equal(seenKeys.includes('k2'), true);
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('processScreenshot supports OpenAI/Anthropic/OpenRouter payloads', async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async (url, options) => {
      const endpoint = String(url);

      if (endpoint.includes('api.openai.com')) {
        assert.equal(options.headers.Authorization, 'Bearer oa-key');
        return makeJsonResponse({
          choices: [{ message: { content: 'openai-ok' } }]
        });
      }

      if (endpoint.includes('api.anthropic.com')) {
        assert.equal(options.headers['x-api-key'], 'an-key');
        return makeJsonResponse({
          content: [{ type: 'text', text: 'anthropic-ok' }]
        });
      }

      if (endpoint.includes('openrouter.ai')) {
        assert.equal(options.headers.Authorization, 'Bearer or-key');
        return makeJsonResponse({
          choices: [{ message: { content: 'openrouter-ok' } }]
        });
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    };

    await withEnv(
      {
        OPENAI_API_KEY: 'oa-key',
        OPENAI_API_KEYS: '',
        ANTHROPIC_API_KEY: 'an-key',
        ANTHROPIC_API_KEYS: '',
        OPENROUTER_API_KEY: 'or-key',
        OPENROUTER_API_KEYS: ''
      },
      async () => {
        assert.equal(await processScreenshot(['img'], undefined, 'Python', { provider: 'openai' }), 'openai-ok');
        assert.equal(await processScreenshot(['img'], undefined, 'Python', { provider: 'anthropic' }), 'anthropic-ok');
        assert.equal(await processScreenshot(['img'], undefined, 'Python', { provider: 'openrouter' }), 'openrouter-ok');
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('processScreenshot emits actionable diagnostics for auth and timeout', async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => makeJsonResponse({ error: { message: 'bad key' } }, false, 401);
    await withEnv(
      {
        GEMINI_API_KEY: 'g-key',
        GEMINI_API_KEYS: ''
      },
      async () => {
        await assert.rejects(
          () => processScreenshot(['img'], undefined, 'Python', { provider: 'gemini' }),
          /Authentication failed/
        );
      }
    );

    global.fetch = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };

    await withEnv(
      {
        GEMINI_API_KEY: 'g-key',
        GEMINI_API_KEYS: ''
      },
      async () => {
        await assert.rejects(
          () => processScreenshot(['img'], undefined, 'Python', { provider: 'gemini' }),
          /Request timed out/
        );
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
