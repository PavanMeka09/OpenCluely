import { CONFIG } from './config.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveHorizontalBounds(mainWindow, electronScreen) {
  const bounds = mainWindow.getBounds();
  const display = electronScreen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - bounds.width;
  return { minX, maxX };
}

export function createWindowMotionController({
  mainWindow,
  electronScreen,
  config = CONFIG,
  scheduleInterval = setInterval,
  clearScheduledInterval = clearInterval
}) {
  let targetX = null;
  let velocity = 0;
  let timerId = null;

  const stop = () => {
    if (timerId === null) return;
    clearScheduledInterval(timerId);
    timerId = null;
  };

  const isLiveWindow = () => Boolean(mainWindow) && !mainWindow.isDestroyed();

  const step = () => {
    if (!isLiveWindow()) {
      stop();
      return;
    }

    const bounds = mainWindow.getBounds();
    const { minX, maxX } = resolveHorizontalBounds(mainWindow, electronScreen);
    const normalizedTarget = clamp(targetX ?? bounds.x, minX, maxX);
    targetX = normalizedTarget;

    const distance = normalizedTarget - bounds.x;
    velocity = (velocity * config.WINDOW_MOVE_DAMPING) + (distance * config.WINDOW_MOVE_STIFFNESS);

    let nextX = bounds.x + velocity;
    const willOvershoot =
      (distance > 0 && nextX > normalizedTarget) ||
      (distance < 0 && nextX < normalizedTarget);
    if (willOvershoot) {
      nextX = normalizedTarget;
      velocity = 0;
    }
    nextX = clamp(nextX, minX, maxX);

    const roundedX = Math.round(nextX);
    if (roundedX !== bounds.x) {
      mainWindow.setBounds({ ...bounds, x: roundedX });
    }

    const remaining = normalizedTarget - roundedX;
    if (
      Math.abs(remaining) <= config.WINDOW_MOVE_POSITION_EPSILON &&
      Math.abs(velocity) <= config.WINDOW_MOVE_VELOCITY_EPSILON
    ) {
      const settledX = Math.round(normalizedTarget);
      if (settledX !== roundedX) {
        mainWindow.setBounds({ ...bounds, x: settledX });
      }
      velocity = 0;
      stop();
    }
  };

  const start = () => {
    if (timerId !== null || !isLiveWindow()) return;
    timerId = scheduleInterval(step, config.WINDOW_MOVE_TICK_MS);
  };

  const moveBy = (deltaX) => {
    if (!isLiveWindow() || !Number.isFinite(deltaX)) {
      return false;
    }
    const bounds = mainWindow.getBounds();
    const { minX, maxX } = resolveHorizontalBounds(mainWindow, electronScreen);
    const baseTarget = targetX ?? bounds.x;
    targetX = clamp(baseTarget + deltaX, minX, maxX);
    start();
    return true;
  };

  const dispose = () => {
    stop();
  };

  return {
    moveBy,
    dispose
  };
}
