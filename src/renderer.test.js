import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererController } from './renderer.js';

class ClassListMock {
  constructor(initial = []) {
    this.tokens = new Set(initial);
  }

  add(...names) {
    names.forEach((name) => this.tokens.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.tokens.delete(name));
  }

  contains(name) {
    return this.tokens.has(name);
  }

  toggle(name, force) {
    if (typeof force === 'boolean') {
      if (force) this.tokens.add(name);
      else this.tokens.delete(name);
      return force;
    }
    if (this.tokens.has(name)) {
      this.tokens.delete(name);
      return false;
    }
    this.tokens.add(name);
    return true;
  }
}

function makeElement(initialClasses = []) {
  return {
    textContent: '',
    innerHTML: '',
    classList: new ClassListMock(initialClasses),
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    scrollCalls: [],
    scrollBy(payload) {
      this.scrollCalls.push(payload);
    }
  };
}

function makeHarness() {
  const elements = {
    'debug-status': makeElement(),
    loading: makeElement(['hidden']),
    'screenshot-stack-preview': makeElement(['hidden', 'opacity-0']),
    'screenshot-empty': makeElement(),
    'screenshot-count': makeElement(),
    'ai-response': makeElement(['hidden'])
  };

  const doc = {
    getElementById(id) {
      return elements[id] ?? null;
    }
  };

  const handlers = {};
  const electronAPI = {
    on(channel, handler) {
      handlers[channel] = handler;
      return () => {};
    },
    setOverlayInteractive() {}
  };

  const timeouts = [];
  createRendererController({
    doc,
    electronAPI,
    screenshotLimit: 5,
    setTimeoutFn: (fn, delay) => {
      timeouts.push({ fn, delay });
    }
  });

  return { elements, handlers, timeouts };
}

test('renderer initializes with empty screenshot helper and count', () => {
  const { elements } = makeHarness();

  assert.equal(elements['screenshot-count'].textContent, '0/5');
  assert.equal(elements['screenshot-empty'].classList.contains('hidden'), false);
  assert.equal(elements['screenshot-stack-preview'].classList.contains('hidden'), true);
});

test('renderer shows screenshot thumbnails and stack count', () => {
  const { elements, handlers } = makeHarness();

  handlers['screenshot-stack'](['a', 'b']);

  assert.equal(elements['screenshot-count'].textContent, '2/5');
  assert.equal(elements['screenshot-empty'].classList.contains('hidden'), true);
  assert.equal(elements['screenshot-stack-preview'].classList.contains('hidden'), false);
  assert.match(elements['screenshot-stack-preview'].innerHTML, /Screenshot 1 preview/);
});

test('renderer toggles loading visibility for request lifecycle', () => {
  const { elements, handlers } = makeHarness();

  handlers['show-loading']();
  assert.equal(elements.loading.classList.contains('hidden'), false);

  handlers['api-response']('ok');
  assert.equal(elements.loading.classList.contains('hidden'), true);
});

test('renderer applies and clears error styling on responses', () => {
  const { elements, handlers } = makeHarness();

  handlers['api-error']('bad request');
  assert.equal(elements['ai-response'].classList.contains('is-error'), true);

  handlers['api-response']('all good');
  assert.equal(elements['ai-response'].classList.contains('is-error'), false);
});

test('renderer formats markdown-like ai responses safely', () => {
  const { elements, handlers } = makeHarness();

  handlers['api-response'](
    '## Plan\n\n- item one\n- item two\n\n```js\nconsole.log("x")\n```\n\ninline `code`'
  );

  const html = elements['ai-response'].innerHTML;
  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(html, /<ul><li>item one<\/li><li>item two<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-js">console\.log\(&quot;x&quot;\)<\/code><\/pre>/);
  assert.match(html, /inline <code>code<\/code>/);
});

test('renderer escapes raw html in ai response', () => {
  const { elements, handlers } = makeHarness();
  handlers['api-response']('<script>alert("xss")</script>');

  const html = elements['ai-response'].innerHTML;
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
});

test('renderer clears ai response after transition timeout', () => {
  const { elements, handlers, timeouts } = makeHarness();

  handlers['api-error']('bad request');
  handlers['clear-ai-response']();

  assert.equal(elements['ai-response'].classList.contains('opacity-0'), true);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 220);

  timeouts[0].fn();
  assert.equal(elements['ai-response'].textContent, '');
  assert.equal(elements['ai-response'].innerHTML, '');
  assert.equal(elements['ai-response'].classList.contains('hidden'), true);
  assert.equal(elements['ai-response'].classList.contains('is-error'), false);
});
