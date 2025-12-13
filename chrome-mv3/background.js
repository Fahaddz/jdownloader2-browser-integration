const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
const redirectMap = new Map();
let state;
let jdAvailable = true;
let lastFailureTime = 0;
const FAILURE_COOLDOWN = 30000;

chrome.webRequest.onBeforeRedirect.addListener(
  function(details) {
    if (details.type === 'main_frame' || details.type === 'sub_frame') return;
    const originalUrl = redirectMap.get(details.url) || details.url;
    redirectMap.set(details.redirectUrl, originalUrl);
    setTimeout(() => {
      redirectMap.delete(details.url);
      redirectMap.delete(details.redirectUrl);
    }, 60000);
  },
  { urls: ['<all_urls>'] }
);

async function loadState() {
  const data = await chrome.storage.local.get('state');
  return (typeof data.state === 'number') ? data.state : 2;
}

async function saveState() {
  await chrome.storage.local.set({ state });
}

function updateAction() {
  switch (state) {
    case 0:
      chrome.action.setIcon({ path: ICON_OFF });
      chrome.action.setTitle({ title: 'Download Disabled' });
      break;
    case 1:
      chrome.action.setIcon({ path: ICON_MANUAL });
      chrome.action.setTitle({ title: 'Manual Mode' });
      break;
    case 2:
      chrome.action.setIcon({ path: ICON_AUTO });
      chrome.action.setTitle({ title: 'Auto Mode' });
      break;
  }
}

function getOriginalUrl(url) {
  return redirectMap.get(url) || url;
}

function isInCooldown() {
  if (!jdAvailable) {
    if (Date.now() - lastFailureTime < FAILURE_COOLDOWN) {
      return true;
    }
    jdAvailable = true;
  }
  return false;
}

function markJDownloaderFailed() {
  jdAvailable = false;
  lastFailureTime = Date.now();
}

function markJDownloaderSuccess() {
  jdAvailable = true;
  lastFailureTime = 0;
}

async function quickPing() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const res = await fetch('http://localhost:3128/device/ping', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function fallbackToBrowser(url, originalUrl) {
  recentUrls.add(url);
  recentUrls.add(originalUrl);
  
  setTimeout(() => {
    recentUrls.delete(url);
    recentUrls.delete(originalUrl);
  }, 10000);
  
  chrome.downloads.download({ url }, () => {
    if (chrome.runtime.lastError) {
      console.error('Fallback download failed:', chrome.runtime.lastError.message);
    }
  });
}

async function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const url = downloadItem.url;
  const originalUrl = getOriginalUrl(url);

  if (recentUrls.has(url) || recentUrls.has(originalUrl)) {
    recentUrls.delete(url);
    recentUrls.delete(originalUrl);
    return;
  }

  try {
    await chrome.downloads.cancel(downloadItem.id);
    await chrome.downloads.erase({ id: downloadItem.id });
  } catch (e) {}

  if (isInCooldown()) {
    console.log('JDownloader in cooldown, falling back to browser');
    fallbackToBrowser(url, originalUrl);
    return;
  }

  const isUp = await quickPing();
  if (!isUp) {
    console.log('JDownloader not responding, falling back to browser');
    markJDownloaderFailed();
    fallbackToBrowser(url, originalUrl);
    return;
  }

  const encoded = encodeURIComponent(originalUrl);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:3128${endpoint}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      console.log('Download sent to JDownloader:', originalUrl);
      markJDownloaderSuccess();
    } else {
      throw new Error('JDownloader returned error');
    }
  } catch (e) {
    console.log('JDownloader failed:', e.message);
    markJDownloaderFailed();
    fallbackToBrowser(url, originalUrl);
  }
}

async function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
  jdAvailable = true;
  lastFailureTime = 0;
  
  chrome.downloads.onCreated.removeListener(handleDownloadCreated);
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  await saveState();
  updateAction();
}

async function init() {
  state = await loadState();
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  updateAction();
}

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
chrome.action.onClicked.addListener(toggleState);
init();
