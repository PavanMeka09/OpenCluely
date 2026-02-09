const DEFAULT_SCREENSHOT_LIMIT = 5;
const CLEAR_TRANSITION_MS = 220;

function screenshotMarkup(stack) {
    return stack.map((img, index) => (
        `<figure class="screenshot-thumb">` +
        `<img src="data:image/png;base64,${img}" alt="Screenshot ${index + 1} preview" />` +
        `<figcaption>${index + 1}</figcaption>` +
        `</figure>`
    )).join('');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatInline(text) {
    let out = text;
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return out;
}

function formatBlock(block) {
    if (/^@@CODEBLOCK_\d+@@$/.test(block)) {
        return block;
    }

    const headingMatch = block.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
        const level = headingMatch[1].length;
        return `<h${level}>${formatInline(headingMatch[2])}</h${level}>`;
    }

    const lines = block.split('\n').filter(Boolean);
    if (lines.length > 0 && lines.every((line) => /^>\s?/.test(line))) {
        const quote = lines.map((line) => line.replace(/^>\s?/, '')).join('<br>');
        return `<blockquote>${formatInline(quote)}</blockquote>`;
    }

    if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
        const items = lines.map((line) => `<li>${formatInline(line.replace(/^[-*]\s+/, ''))}</li>`).join('');
        return `<ul>${items}</ul>`;
    }

    if (lines.length > 0 && lines.every((line) => /^\d+\.\s+/.test(line))) {
        const items = lines.map((line) => `<li>${formatInline(line.replace(/^\d+\.\s+/, ''))}</li>`).join('');
        return `<ol>${items}</ol>`;
    }

    return `<p>${formatInline(lines.join('<br>'))}</p>`;
}

function formatAIResponse(rawText) {
    const normalized = String(rawText ?? '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return '';

    const codeBlocks = [];
    const withCodeTokens = normalized.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_, language = '', code = '') => {
        const safeCode = escapeHtml(code.trimEnd());
        const safeLanguage = escapeHtml(language);
        const classAttr = safeLanguage ? ` class="language-${safeLanguage}"` : '';
        const index = codeBlocks.length;
        codeBlocks.push(`<pre><code${classAttr}>${safeCode}</code></pre>`);
        return `\n@@CODEBLOCK_${index}@@\n`;
    });

    const escaped = escapeHtml(withCodeTokens);
    const html = escaped
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map(formatBlock)
        .join('');

    return html.replace(/@@CODEBLOCK_(\d+)@@/g, (_token, idx) => codeBlocks[Number(idx)] || '');
}

function normalizeModeLabel(mode) {
    const normalized = String(mode ?? '').trim().toLowerCase();
    return normalized === 'mcq' ? 'mcq' : 'code';
}

export function createRendererController({
    doc,
    electronAPI,
    screenshotLimit = DEFAULT_SCREENSHOT_LIMIT,
    setTimeoutFn = setTimeout
}) {
    const getEl = (id) => doc.getElementById(id);

    const setDebugStatus = (text) => {
        const el = getEl('debug-status');
        if (!el) return;
        el.textContent = text;
    };

    const setLoadingVisible = (visible) => {
        const loading = getEl('loading');
        if (!loading) return;
        loading.classList.toggle('hidden', !visible);
    };

    const setModeIndicator = (mode) => {
        const modeIndicator = getEl('mode-indicator');
        if (!modeIndicator) return;
        modeIndicator.textContent = `Mode: ${normalizeModeLabel(mode)}`;
    };

    const updateScreenshotStack = (stack) => {
        const preview = getEl('screenshot-stack-preview');
        const empty = getEl('screenshot-empty');
        const count = getEl('screenshot-count');

        if (!Array.isArray(stack)) {
            console.error('updateScreenshotStack received invalid stack:', stack);
            return;
        }
        if (!preview || !empty || !count) return;

        preview.innerHTML = screenshotMarkup(stack);
        count.textContent = `${stack.length}/${screenshotLimit}`;

        const hasShots = stack.length > 0;
        preview.classList.toggle('hidden', !hasShots);
        preview.classList.toggle('opacity-0', !hasShots);
        preview.classList.toggle('opacity-100', hasShots);
        empty.classList.toggle('hidden', hasShots);
    };

    const showAIResponse = (text, isError = false) => {
        const resp = getEl('ai-response');
        if (!resp) return;

        if (isError) {
            resp.innerHTML = '';
            resp.textContent = String(text ?? '');
        } else {
            resp.textContent = '';
            const formatted = formatAIResponse(text);
            resp.innerHTML = formatted || '<p>No response generated.</p>';
        }
        resp.classList.remove('hidden');
        resp.classList.toggle('is-error', isError);
        resp.classList.add('opacity-100');
        resp.classList.remove('opacity-0');
    };

    const clearAIResponse = () => {
        const resp = getEl('ai-response');
        if (!resp) return;
        resp.classList.remove('opacity-100');
        resp.classList.add('opacity-0');
        setTimeoutFn(() => {
            resp.textContent = '';
            resp.innerHTML = '';
            resp.classList.add('hidden');
            resp.classList.remove('is-error');
        }, CLEAR_TRANSITION_MS);
    };

    if (!electronAPI || typeof electronAPI.on !== 'function') {
        setDebugStatus('renderer error | preload bridge missing');
        throw new Error('electronAPI bridge is unavailable. Check preload.js and BrowserWindow preload path.');
    }

    electronAPI.on('screenshot-stack', (stack) => {
        setDebugStatus(`Screenshots: ${Array.isArray(stack) ? stack.length : 'invalid'}`);
        updateScreenshotStack(stack);
    });

    electronAPI.on('show-loading', () => {
        setLoadingVisible(true);
    });

    electronAPI.on('api-response', (text) => {
        setLoadingVisible(false);
        setDebugStatus('Response received');
        showAIResponse(text, false);
    });

    electronAPI.on('api-error', (text) => {
        setLoadingVisible(false);
        setDebugStatus('Error received');
        showAIResponse(text, true);
    });

    electronAPI.on('shortcut-registration-warning', (text) => {
        showAIResponse(text, true);
    });

    electronAPI.on('mode-changed', (mode) => {
        setModeIndicator(mode);
    });

    electronAPI.on('debug-status', (text) => {
        setDebugStatus(text);
    });

    electronAPI.on('clear-ai-response', clearAIResponse);

    electronAPI.on('scroll-ai-response', (amount) => {
        const resp = getEl('ai-response');
        if (!resp || resp.classList.contains('hidden')) return;
        resp.scrollBy({ top: amount, behavior: 'smooth' });
    });

    const aiResponse = getEl('ai-response');
    if (aiResponse && typeof electronAPI.setOverlayInteractive === 'function') {
        aiResponse.addEventListener('mouseenter', () => {
            electronAPI.setOverlayInteractive(true);
        });
        aiResponse.addEventListener('mouseleave', () => {
            electronAPI.setOverlayInteractive(false);
        });
    }

    setDebugStatus('Waiting for shortcuts');
    setModeIndicator('code');
    updateScreenshotStack([]);

    return {
        setLoadingVisible,
        showAIResponse,
        clearAIResponse,
        updateScreenshotStack,
        setDebugStatus,
        setModeIndicator
    };
}

if (typeof window !== 'undefined') {
    createRendererController({
        doc: window.document,
        electronAPI: window.electronAPI
    });
}
