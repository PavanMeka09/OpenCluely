import { ipcMain } from 'electron';
import { setOverlayInteraction } from './overlay-interaction.js';

export function registerIpcHandlers(mainWindow) {
  ipcMain.on('allow-scroll', (_event, allow) => {
    if (!setOverlayInteraction(mainWindow, allow)) {
      console.warn('Ignored invalid allow-scroll payload:', allow);
    }
  });
}
