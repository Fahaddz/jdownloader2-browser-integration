const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const redirectMap = new Map();
let state;
let jdAvailable = true;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000;

const SKIP_SCHEMES = ['blob:', 'data:', 'file:', 'javascript:', 'about:', 'chrome:', 'chrome-extension:'];

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

function shouldSkipUrl(url) {
  if (!url) return true;
  const lowerUrl = url.toLowerCase();
  return SKIP_SCHEMES.some(scheme => lowerUrl.startsWith(scheme));
}

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

async function checkJDownloader() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch('http://localhost:3128/device/ping', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function isJDownloaderAvailable() {
  const now = Date.now();
  if (now - lastCheckTime < CHECK_INTERVAL) {
    return jdAvailable;
  }
  jdAvailable = await checkJDownloader();
  lastCheckTime = now;
  return jdAvailable;
}

async function sendToJDownloader(url) {
  const encoded = encodeURIComponent(url);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  
  try {
    await fetch(`http://localhost:3128${endpoint}`, { signal: controller.signal });
    clearTimeout(timeout);
    jdAvailable = true;
    lastCheckTime = Date.now();
    return true;
  } catch {
    clearTimeout(timeout);
    jdAvailable = false;
    lastCheckTime = Date.now();
    return false;
  }
}

async function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const url = downloadItem.url;

  if (shouldSkipUrl(url)) {
    console.log('Skipping unsupported URL:', url.substring(0, 50));
    return;
  }

  const isUp = await isJDownloaderAvailable();
  
  if (!isUp) {
    console.log('JDownloader offline, letting browser handle download');
    return;
  }

  const originalUrl = getOriginalUrl(url);

  try {
    await chrome.downloads.cancel(downloadItem.id);
    await chrome.downloads.erase({ id: downloadItem.id });
  } catch (e) {
    console.log('Could not cancel download');
    return;
  }

  const success = await sendToJDownloader(originalUrl);

  if (success) {
    console.log('Download sent to JDownloader:', originalUrl);
  } else {
    console.log('JDownloader failed - please retry download');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'JDownloader Failed',
      message: 'Download was canceled but JDownloader failed. Please retry the download.'
    });
  }
}

// Context menu to manually send links to JDownloader
function setupContextMenus() {
  chrome.contextMenus.create({
    id: 'send-page-to-jd',
    title: 'Send page to JDownloader',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'send-link-to-jd',
    title: 'Send link to JDownloader',
    contexts: ['link']
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url;
  
  if (info.menuItemId === 'send-link-to-jd' && info.linkUrl) {
    url = info.linkUrl;
  } else if (info.menuItemId === 'send-page-to-jd') {
    url = info.pageUrl || tab.url;
  }
  
  if (!url) return;
  
  const success = await sendToJDownloader(url);
  
  if (success) {
    console.log('Sent to JDownloader:', url);
  } else {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'JDownloader Error',
      message: 'Could not send link to JDownloader. Is it running?'
    });
  }
});

async function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
  jdAvailable = true;
  lastCheckTime = 0;
  
  chrome.downloads.onCreated.removeListener(handleDownloadCreated);
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  await saveState();
  updateAction();
}

async function init() {
  state = await loadState();
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  updateAction();
  isJDownloaderAvailable();
}

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  init();
});
chrome.action.onClicked.addListener(toggleState);
init();
