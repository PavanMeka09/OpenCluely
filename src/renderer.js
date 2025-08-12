import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

function updateScreenshotStack(stack) {
    const preview = document.getElementById('screenshot-stack-preview');

    if (!Array.isArray(stack)) {
        console.error('updateScreenshotStack received invalid stack:', stack);
        return;
    }
    
    // Render thumbnails
    preview.innerHTML = stack.map(img =>
        `<img src="data:image/png;base64,${img}" class="w-20 h-auto object-cover rounded border border-white/20" />`
    ).join('');

    // Show or hide preview container
    preview.classList.toggle('hidden', stack.length === 0);
    preview.classList.toggle('opacity-0', stack.length === 0);
    preview.classList.toggle('opacity-100', stack.length > 0);
}


function formatAIText(text) {
    console.log(text)
    const escaped = text
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return escaped.replace(/```([\s\S]*?)```/g, '<pre class="bg-black/50 p-2 rounded text-xs overflow-x-auto"><code>$1</code></pre>');
}

function showAIResponse(text, isError = false) {
    const resp = document.getElementById('ai-response');
    resp.innerHTML = marked.parse(text);
    resp.classList.remove('hidden');
    resp.classList.toggle('bg-red-500/20', isError);
    resp.classList.toggle('border-red-500/40', isError);
    resp.classList.toggle('bg-black/30', !isError);
    resp.classList.toggle('border-white/20', !isError);
    resp.classList.add('opacity-100');
    resp.classList.remove('opacity-0');
}

window.electronAPI.on('screenshot-stack', (stack) => {
    updateScreenshotStack(stack);
});

window.electronAPI.on('show-loading', () => {
    document.getElementById('loading').classList.remove('hidden');
});

window.electronAPI.on('api-response', (text) => {
    document.getElementById('loading').classList.add('hidden');
    showAIResponse(formatAIText(text), false);
});

window.electronAPI.on('api-error', (text) => {
    document.getElementById('loading').classList.add('hidden');
    showAIResponse(text, true);
});

window.electronAPI.on('clear-ai-response', () => {
    const resp = document.getElementById('ai-response');
    resp.classList.remove('opacity-100');
    resp.classList.add('opacity-0');
    // Use a timeout to hide the element after the transition
    setTimeout(() => {
        resp.textContent = '';
        resp.classList.add('hidden');
    }, 300);
});

window.electronAPI.on('scroll-ai-response', (amount) => {
    const resp = document.getElementById('ai-response');
    if (!resp || resp.classList.contains('hidden')) return;
    resp.scrollBy({ top: amount, behavior: 'smooth' });
});

updateScreenshotStack([]);