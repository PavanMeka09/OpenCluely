const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const screenshot = require('screenshot-desktop');
require('dotenv').config();

let mainWindow = null;
let sizeLocked = false;
let screenshotStack = [];
const MAX_SCREENSHOTS = 5;

ipcMain.on('allow-scroll', (event, allow) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(!allow, { forward: true });
});

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
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.once('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(`
      const { ipcRenderer } = require('electron');
      const aiBox = document.getElementById('ai-response');
      aiBox.addEventListener('mouseenter', () => {
        ipcRenderer.send('allow-scroll', true);
      });
      aiBox.addEventListener('mouseleave', () => {
        ipcRenderer.send('allow-scroll', false);
      });
    `);
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setSkipTaskbar(true);
  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(true);
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    lockWindowSize(mainWindow);
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();

  // Toggle overlay visibility (Ctrl+B)
  globalShortcut.register('Ctrl+B', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    }
  });

  // Take screenshot (Ctrl+H)
  globalShortcut.register('Ctrl+H', async () => {
    try {
      const image = await screenshot();
      const base64Image = image.toString('base64');
      if (screenshotStack.length < MAX_SCREENSHOTS) {
        screenshotStack.push(base64Image);
        mainWindow.webContents.send('screenshot-stack', screenshotStack);
      } else {
        mainWindow.webContents.send('api-error', 'Maximum 5 screenshots allowed.');
      }
    } catch (err) {
      console.error('Screenshot failed:', err);
      mainWindow.webContents.send('api-error', 'Failed to capture screenshot');
    }
  });

  // Process screenshots (Ctrl+Enter)
  globalShortcut.register('Ctrl+Enter', async () => {
    if (screenshotStack.length === 0) {
      mainWindow.webContents.send('api-error', 'No screenshots to process.');
      return;
    }
    mainWindow.webContents.send('show-loading');
    try {
      await processScreenshot(screenshotStack);
      screenshotStack = [];
      mainWindow.webContents.send('screenshot-stack', screenshotStack);
    } catch (err) {
      console.error('Processing screenshots failed:', err);
      mainWindow.webContents.send('api-error', 'Failed to process screenshots');
    }
  });

  // Reset (Ctrl+G)
  globalShortcut.register('Ctrl+G', () => {
    screenshotStack = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshot-stack', screenshotStack);
      mainWindow.webContents.send('clear-ai-response');
    }
  });

  // Quit (Ctrl+Q)
  globalShortcut.register('Ctrl+Q', () => {
    app.quit();
  });

  // Move overlay left (Ctrl+Left)
  globalShortcut.register('Ctrl+Left', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setBounds({ x: x - 100, y, width: 800, height: 600 });
  });

  // Move overlay right (Ctrl+Right)
  globalShortcut.register('Ctrl+Right', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setBounds({ x: x + 100, y, width: 800, height: 600 });
  });
}

async function processScreenshot(imageDataOrArray) {
  const API_KEY = process.env.GEMINI_API_KEY;
  const prompt = `You are a concise coding assistant for stealth interview help.
Look at the screenshots and directly give the clean solution or answer without unnecessary explanations.
If code is needed, provide only the essential working code in markdown code blocks.`;

  const contents = imageDataOrArray.map(img => ({
    inline_data: { mime_type: "image/png", data: img }
  }));
  contents.push({ text: prompt });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({
          contents: [{ parts: contents }],
          generationConfig: { temperature: 0.4, topK: 32, topP: 1, maxOutputTokens: 2048 }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API request failed');
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      mainWindow.webContents.send('api-response', data.candidates[0].content.parts[0].text);
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('API Error:', error);
    mainWindow.webContents.send('api-error', error.message || 'Failed to process image');
  }
}

app.whenReady().then(() => {
  createMainWindow();
  registerShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function lockWindowSize(window) {
  if (sizeLocked) return;
  const [currentWidth, currentHeight] = window.getSize();
  if (currentWidth !== 800 || currentHeight !== 600) {
    window.setBounds({ x: window.getPosition()[0], y: window.getPosition()[1], width: 800, height: 600 });
  }
  sizeLocked = true;
  setInterval(() => {
    if (window && !window.isDestroyed()) {
      const [width, height] = window.getSize();
      if (width !== 800 || height !== 600) {
        window.setBounds({ x: window.getPosition()[0], y: window.getPosition()[1], width: 800, height: 600 });
      }
    }
  }, 100);
}
