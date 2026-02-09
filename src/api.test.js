import test from 'node:test';
import assert from 'node:assert/strict';
import { processScreenshot } from './api.js';

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

function makeTextErrorResponse(message, status = 500) {
  return {
    ok: false,
    status,
    headers: new HeadersMock('text/plain'),
    json: async () => {
      throw new Error('not json');
    },
    text: async () => message
  };
}

test('processScreenshot validates screenshots and API key', async () => {
  await assert.rejects(
    () => processScreenshot([], 'x'),
    /No screenshots to process/
  );

  await assert.rejects(
    () => processScreenshot(['a'], ''),
    /Missing GEMINI_API_KEY/
  );
});

test('processScreenshot sends required headers and parses success response', async () => {
  const originalFetch = global.fetch;
  let capturedHeaders = null;
  try {
    global.fetch = async (_url, options) => {
      capturedHeaders = options.headers;
      return makeJsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok-result' }] } }]
      });
    };

    const result = await processScreenshot(['abcd'], 'test-key', 'Python');
    assert.equal(result, 'ok-result');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.equal(capturedHeaders['x-goog-api-key'], 'test-key');
  } finally {
    global.fetch = originalFetch;
  }
});

test('processScreenshot handles non-JSON API errors', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => makeTextErrorResponse('gateway down', 502);

    await assert.rejects(
      () => processScreenshot(['abcd'], 'test-key', 'Python'),
      /gateway down/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('processScreenshot maps AbortError to timeout message', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };

    await assert.rejects(
      () => processScreenshot(['abcd'], 'test-key', 'Python'),
      /Request timed out/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
