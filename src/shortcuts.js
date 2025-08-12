import { globalShortcut, app } from 'electron';
import screenshot from 'screenshot-desktop';
import { processScreenshot } from './api.js';

export function registerShortcuts(mainWindow, screenshotStack, maxScreenshots) {

  globalShortcut.unregisterAll();

  const defaultShortcuts = {
    toggle_visibility: 'Ctrl+B',
    take_screenshot: 'Ctrl+H',
    process_screenshots: 'Ctrl+Enter',
    reset_context: 'Ctrl+G',
    quit: 'Ctrl+Q',
    move_left: 'Ctrl+Left',
    move_right: 'Ctrl+Right'
  };

  let customShortcuts = {};
  try {
    if (process.env.npm_package_config_shortcuts) {
      customShortcuts = JSON.parse(process.env.npm_package_config_shortcuts);
    }
  } catch (e) {
    console.error('Error parsing custom shortcuts from package.json:', e);
  }

  const shortcuts = { ...defaultShortcuts, ...customShortcuts };

  // Toggle overlay visibility
  globalShortcut.register(shortcuts.toggle_visibility, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    }
  });

  // Take screenshot
  globalShortcut.register(shortcuts.take_screenshot, async () => {
    try {
      const image = await screenshot();
      const base64Image = image.toString('base64');

      if (screenshotStack.length < maxScreenshots) {
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


  // Process screenshots
  globalShortcut.register(shortcuts.process_screenshots, async () => {
    if (screenshotStack.length === 0) {
      mainWindow.webContents.send('api-error', 'No screenshots to process.');
      return;
    }
    mainWindow.webContents.send('show-loading');
    try {
      await processScreenshot(mainWindow, screenshotStack);
      screenshotStack.length = 0;
      mainWindow.webContents.send('screenshot-stack', screenshotStack);
    } catch (err) {
      console.error('Processing screenshots failed:', err);
      mainWindow.webContents.send('api-error', 'Failed to process screenshots');
    }
  });
  // Scroll AI response up
  globalShortcut.register('Ctrl+Up', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scroll-ai-response', -50); // scroll up by 50px
    }
  });
  
  // Scroll AI response down
  globalShortcut.register('Ctrl+Down', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scroll-ai-response', 50); // scroll down by 50px
    }
  })

  // Reset
  globalShortcut.register(shortcuts.reset_context, () => {
    screenshotStack.length = 0;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshot-stack', screenshotStack);
      mainWindow.webContents.send('clear-ai-response');
    }
  });

  // Quit
  globalShortcut.register(shortcuts.quit, () => {
    app.quit();
  });

  // Move overlay left
  globalShortcut.register(shortcuts.move_left, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setBounds({ x: x - 100, y, width: 800, height: 600 });
  });

  // Move overlay right
  globalShortcut.register(shortcuts.move_right, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    mainWindow.setBounds({ x: x + 100, y, width: 800, height: 600 });
  });
}