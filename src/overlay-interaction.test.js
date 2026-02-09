import test from 'node:test';
import assert from 'node:assert/strict';
import { setOverlayInteraction } from './overlay-interaction.js';

test('setOverlayInteraction rejects invalid window or payload', () => {
  const invalidWindow = null;
  assert.equal(setOverlayInteraction(invalidWindow, true), false);

  const destroyedWindow = {
    isDestroyed: () => true,
    setIgnoreMouseEvents: () => {}
  };
  assert.equal(setOverlayInteraction(destroyedWindow, true), false);

  const liveWindow = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: () => {}
  };
  assert.equal(setOverlayInteraction(liveWindow, 'yes'), false);
});

test('setOverlayInteraction updates ignoreMouseEvents with forward option', () => {
  const calls = [];
  const liveWindow = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(args)
  };

  assert.equal(setOverlayInteraction(liveWindow, true), true);
  assert.equal(setOverlayInteraction(liveWindow, false), true);

  assert.deepEqual(calls[0], [false, { forward: true }]);
  assert.deepEqual(calls[1], [true, { forward: true }]);
});
