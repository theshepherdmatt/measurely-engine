function toast(msg, type = 'info') {
    const colours = { error: 'var(--c-poor)', success: 'var(--c-excellent)', info: 'var(--c-okay)' };
    const box = document.createElement('div');
    box.style.cssText = `
        position:fixed;top:1rem;right:1rem;
        padding:0.75rem 1rem;border-radius:8px;
        color:white;font-size:0.9rem;z-index:9999;
        transition:opacity 0.3s;
        background:${colours[type] ?? colours.info};
    `;
    box.textContent = msg;
    document.body.appendChild(box);
    setTimeout(() => { box.style.opacity = '0'; }, 6000);
    setTimeout(() => { box.remove(); }, 8300);
}
