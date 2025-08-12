import { ipcMain } from 'electron';

export function registerIpcHandlers(mainWindow) {
  ipcMain.on('allow-scroll', (allow) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(!allow, { forward: true });
  });
}