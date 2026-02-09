import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowMotionController } from './window-motion.js';

function makeHarness({
  initialX = 100,
  width = 200,
  minX = 0,
  workAreaWidth = 1000
} = {}) {
  let bounds = { x: initialX, y: 0, width, height: 300 };
  let intervalCallback = null;
  let intervalActive = false;
  let clearCount = 0;

  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      bounds = { ...next };
    }
  };

  const electronScreen = {
    getDisplayMatching: () => ({
      workArea: {
        x: minX,
        y: 0,
        width: workAreaWidth,
        height: 900
      }
    })
  };

  const controller = createWindowMotionController({
    mainWindow,
    electronScreen,
    config: {
      WINDOW_MOVE_STIFFNESS: 0.2,
      WINDOW_MOVE_DAMPING: 0.78,
      WINDOW_MOVE_VELOCITY_EPSILON: 0.35,
      WINDOW_MOVE_POSITION_EPSILON: 0.5,
      WINDOW_MOVE_TICK_MS: 16
    },
    scheduleInterval: (callback) => {
      intervalCallback = callback;
      intervalActive = true;
      return 1;
    },
    clearScheduledInterval: () => {
      intervalActive = false;
      clearCount += 1;
    }
  });

  const tick = (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      if (!intervalActive || typeof intervalCallback !== 'function') {
        return;
      }
      intervalCallback();
    }
  };

  return {
    controller,
    tick,
    getBounds: () => ({ ...bounds }),
    isIntervalActive: () => intervalActive,
    getClearCount: () => clearCount
  };
}

test('window motion moves toward target smoothly and settles', () => {
  const harness = makeHarness();
  assert.equal(harness.controller.moveBy(100), true);
  assert.equal(harness.isIntervalActive(), true);

  harness.tick(1);
  const firstStepX = harness.getBounds().x;
  assert.equal(firstStepX > 100, true);
  assert.equal(firstStepX < 200, true);

  harness.tick(100);
  assert.equal(harness.getBounds().x, 200);
  assert.equal(harness.isIntervalActive(), false);
  assert.equal(harness.getClearCount(), 1);
});

test('window motion accumulates repeated move commands', () => {
  const harness = makeHarness();
  assert.equal(harness.controller.moveBy(100), true);
  assert.equal(harness.controller.moveBy(100), true);

  harness.tick(120);
  assert.equal(harness.getBounds().x, 300);
});

test('window motion clamps target inside work area', () => {
  const harness = makeHarness({
    initialX: 650,
    width: 200,
    minX: 0,
    workAreaWidth: 800
  });

  assert.equal(harness.controller.moveBy(100), true);
  harness.tick(120);
  assert.equal(harness.getBounds().x, 600);
});

test('window motion rejects invalid delta and can be disposed', () => {
  const harness = makeHarness();
  assert.equal(harness.controller.moveBy(Number.NaN), false);
  assert.equal(harness.isIntervalActive(), false);

  assert.equal(harness.controller.moveBy(100), true);
  assert.equal(harness.isIntervalActive(), true);
  harness.controller.dispose();
  assert.equal(harness.isIntervalActive(), false);
});
