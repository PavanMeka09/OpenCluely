import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerShortcuts } from './shortcuts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;

let screenshotStack = [];
const MAX_SCREENSHOTS = 5;

function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    x: (width - 800) / 2,
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
    webPreferences: {
      nodeIntegration: true,
      // contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.once('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(`
      
      const aiBox = document.getElementById('ai-response');
      aiBox.addEventListener('mouseenter', () => {
        ipcRenderer.send('allow-scroll', true);
      });
      aiBox.addEventListener('mouseleave', () => {
        window.electronAPI.send('allow-scroll', false);
      });
    `);
  });
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    if (width !== 800 || height !== 600) {
      mainWindow.setBounds({ x: mainWindow.getPosition()[0], y: mainWindow.getPosition()[1], width: 800, height: 600 });
    }
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setSkipTaskbar(true);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(true);
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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