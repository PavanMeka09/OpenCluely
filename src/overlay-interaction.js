export function setOverlayInteraction(mainWindow, allow) {
  if (!mainWindow || mainWindow.isDestroyed() || typeof allow !== 'boolean') {
    return false;
  }

  mainWindow.setIgnoreMouseEvents(!allow, { forward: true });
  return true;
}
