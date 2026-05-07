// WJP Chrome Extension — background service worker (MV3)

const WJP_BASE = 'https://wjpdebttracking.com';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'wjp:detected-card') {
    // Store detection in extension storage
    chrome.storage.local.get(['detections'], (data) => {
      const list = data.detections || [];
      list.push({
        ...msg.data,
        detectedAt: Date.now(),
        url: sender.tab && sender.tab.url
      });
      chrome.storage.local.set({ detections: list.slice(-25) });
      // Update badge count
      chrome.action.setBadgeText({ text: String(list.length).slice(0, 3) });
      chrome.action.setBadgeBackgroundColor({ color: '#1f7a4a' });
    });
    sendResponse({ ok: true });
  }
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[WJP ext] installed');
});
