chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'better-viewlift-capture-visible-tab' || !sender.tab) return;

  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Capture failed.' });
      return;
    }

    sendResponse({ ok: true, dataUrl });
  });

  return true;
});
