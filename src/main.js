import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerShortcuts } from './shortcuts.js';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;

let screenshotStack = [];
const MAX_SCREENSHOTS = 5;

function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: CONFIG.WINDOW_WIDTH,
    height: CONFIG.WINDOW_HEIGHT,
    x: (width - CONFIG.WINDOW_WIDTH) / 2,
    y: 0,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.cjs')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    if (width !== CONFIG.WINDOW_WIDTH || height !== CONFIG.WINDOW_HEIGHT) {
      mainWindow.setBounds({ x: mainWindow.getPosition()[0], y: mainWindow.getPosition()[1], width: CONFIG.WINDOW_WIDTH, height: CONFIG.WINDOW_HEIGHT });
    }
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setSkipTaskbar(true);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
  });
}

app.whenReady().then(() => {
  createMainWindow();
  registerShortcuts(mainWindow, screenshotStack, MAX_SCREENSHOTS);
  registerIpcHandlers(mainWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
