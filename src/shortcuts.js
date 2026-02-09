import { globalShortcut, app, screen } from 'electron';
import screenshot from 'screenshot-desktop';
import { processScreenshot, resolveAIProvider } from './api.js';
import { CONFIG } from './config.js';
import { createWindowMotionController } from './window-motion.js';
import dotenv from 'dotenv';
dotenv.config();

export function registerShortcuts(mainWindow, screenshotStack, maxScreenshots = CONFIG.MAX_SCREENSHOTS) {
  const motionController = createWindowMotionController({
    mainWindow,
    electronScreen: screen,
    config: CONFIG
  });

  globalShortcut.unregisterAll();
  let currentMode = CONFIG.DEFAULT_PROMPT_MODE;
  let currentProvider = resolveAIProvider(process.env.AI_PROVIDER);

  const defaultShortcuts = {
    toggle_visibility: 'Ctrl+B',
    take_screenshot: 'Ctrl+H',
    process_screenshots: 'Ctrl+Enter',
    toggle_mode: 'Ctrl+M',
    toggle_provider: 'Ctrl+P',
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
  const failedShortcuts = [];
  let isProcessing = false;

  const sendToRenderer = (channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channel, payload);
        }
      });
      return;
    }
    mainWindow.webContents.send(channel, payload);
  };

  const registerShortcut = (name, accelerator, handler) => {
    const wrappedHandler = async () => {
      console.log(`[shortcut] triggered: ${name} (${accelerator})`);
      try {
        await handler();
      } catch (error) {
        console.error(`[shortcut] handler failed: ${name} (${accelerator})`, error);
      }
    };

    const registered = globalShortcut.register(accelerator, wrappedHandler);
    if (!registered) {
      failedShortcuts.push(`${name}: ${accelerator}`);
      console.warn(`[shortcut] failed to register: ${name} (${accelerator})`);
    } else {
      console.log(`[shortcut] registered: ${name} (${accelerator})`);
    }
  };

  const sendStatusToRenderer = () => {
    sendToRenderer('mode-changed', currentMode);
    sendToRenderer('debug-status', `Mode: ${currentMode} | Provider: ${currentProvider}`);
  };

  const processWithMode = async (images, options = {}) => {
    const language = process.env.language || CONFIG.DEFAULT_LANGUAGE;
    return processScreenshot(images, undefined, language, {
      mode: currentMode,
      provider: currentProvider,
      ...options
    });
  };

  // Toggle overlay visibility
  registerShortcut('toggle_visibility', shortcuts.toggle_visibility, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    }
  });

  // Take screenshot
  registerShortcut('take_screenshot', shortcuts.take_screenshot, async () => {
    try {
      const image = await screenshot({ format: 'png' });
      if (!Buffer.isBuffer(image) || image.length === 0) {
        throw new Error('Screenshot capture returned empty image data.');
      }
      const base64Image = image.toString('base64');

      if (screenshotStack.length < maxScreenshots) {
        screenshotStack.push(base64Image);
        sendToRenderer('screenshot-stack', [...screenshotStack]);
        console.log(`[shortcut] screenshot captured. stack=${screenshotStack.length}`);
      } else {
        sendToRenderer('api-error', `Maximum ${maxScreenshots} screenshots allowed.`);
      }
    } catch (err) {
      console.error('Screenshot failed:', err);
      sendToRenderer('api-error', 'Failed to capture screenshot');
    }
  });


  // Process screenshots
  registerShortcut('process_screenshots', shortcuts.process_screenshots, async () => {
    if (isProcessing) return;
    if (screenshotStack.length === 0) {
      sendToRenderer('api-error', 'No screenshots to process.');
      return;
    }
    isProcessing = true;
    sendToRenderer('show-loading');
    sendToRenderer('debug-status', `Processing ${screenshotStack.length} screenshot(s) via ${currentProvider}`);

    try {
      const imagesToProcess = [...screenshotStack];
      const result = await processWithMode(imagesToProcess);

      // Update UI with response
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendToRenderer('api-response', result);
      }

      screenshotStack.length = 0;
      sendToRenderer('screenshot-stack', [...screenshotStack]);
    } catch (err) {
      console.error('Processing screenshots failed:', err);
      // Properly extract error message
      const errorMessage = err.message || 'Failed to process screenshots';
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendToRenderer('debug-status', `Error from ${currentProvider}`);
        sendToRenderer('api-error', errorMessage);
      }
    } finally {
      isProcessing = false;
    }
  });

  registerShortcut('toggle_mode', shortcuts.toggle_mode, () => {
    const modes = CONFIG.PROMPT_MODES;
    const currentIdx = modes.indexOf(currentMode);
    currentMode = modes[(currentIdx + 1) % modes.length];
    sendStatusToRenderer();
  });

  registerShortcut('toggle_provider', shortcuts.toggle_provider, () => {
    const providers = CONFIG.AI_PROVIDERS;
    const currentIdx = providers.indexOf(currentProvider);
    currentProvider = providers[(currentIdx + 1) % providers.length];
    sendStatusToRenderer();
  });

  // Scroll AI response up
  registerShortcut('scroll_up', 'Ctrl+Up', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendToRenderer('scroll-ai-response', -50); // scroll up by 50px
    }
  });

  // Scroll AI response down
  registerShortcut('scroll_down', 'Ctrl+Down', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendToRenderer('scroll-ai-response', 50); // scroll down by 50px
    }
  })

  // Reset
  registerShortcut('reset_context', shortcuts.reset_context, () => {
    screenshotStack.length = 0;
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendToRenderer('screenshot-stack', [...screenshotStack]);
      sendToRenderer('clear-ai-response');
    }
  });

  // Quit
  registerShortcut('quit', shortcuts.quit, () => {
    app.quit();
  });

  // Move overlay left
  registerShortcut('move_left', shortcuts.move_left, () => {
    motionController.moveBy(-CONFIG.WINDOW_MOVE_STEP);
  });

  // Move overlay right
  registerShortcut('move_right', shortcuts.move_right, () => {
    motionController.moveBy(CONFIG.WINDOW_MOVE_STEP);
  });

  if (failedShortcuts.length > 0) {
    const warning = `Some shortcuts could not be registered:\n${failedShortcuts.join('\n')}`;
    console.warn(warning);
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendToRenderer('shortcut-registration-warning', warning);
    }
  }

  sendStatusToRenderer();
}
