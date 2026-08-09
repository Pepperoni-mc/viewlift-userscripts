window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'better-viewlift' || message.type !== 'capture-visible-tab') return;

  chrome.runtime.sendMessage({ type: 'better-viewlift-capture-visible-tab' }, (response) => {
    window.postMessage({
      source: 'better-viewlift-capture-helper',
      type: 'capture-visible-tab-result',
      requestId: message.requestId,
      ok: Boolean(response?.ok),
      dataUrl: response?.dataUrl || '',
      error: response?.error || ''
    }, '*');
  });
});
