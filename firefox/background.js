const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const redirectMap = new Map();
let state;
let jdAvailable = true;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000;

const SKIP_SCHEMES = ['blob:', 'data:', 'file:', 'javascript:', 'about:', 'moz-extension:'];

browser.webRequest.onBeforeRedirect.addListener(
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
  const data = await browser.storage.local.get('state');
  return (typeof data.state === 'number') ? data.state : 2;
}

async function saveState() {
  await browser.storage.local.set({ state });
}

function updateBrowserAction() {
  switch (state) {
    case 0:
      browser.browserAction.setIcon({ path: ICON_OFF });
      browser.browserAction.setTitle({ title: 'Download Disabled' });
      break;
    case 1:
      browser.browserAction.setIcon({ path: ICON_MANUAL });
      browser.browserAction.setTitle({ title: 'Manual Mode' });
      break;
    case 2:
      browser.browserAction.setIcon({ path: ICON_AUTO });
      browser.browserAction.setTitle({ title: 'Auto Mode' });
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
  const autostart = state === 2 ? '1' : '0';
  const body = `urls=${encodeURIComponent(url)}&autostart=${autostart}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    await fetch('http://localhost:3128/flash/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      signal: controller.signal
    });
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
    await browser.downloads.cancel(downloadItem.id);
    await browser.downloads.erase({ id: downloadItem.id });
  } catch (e) {
    console.log('Could not cancel download');
    return;
  }

  const success = await sendToJDownloader(originalUrl);

  if (success) {
    console.log('Download sent to JDownloader:', originalUrl);
  } else {
    console.log('JDownloader failed - please retry download');
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'JDownloader Failed',
      message: 'Download was canceled but JDownloader failed. Please retry the download.'
    });
  }
}

// Context menu to manually send links to JDownloader
browser.contextMenus.create({
  id: 'send-page-to-jd',
  title: 'Send page to JDownloader',
  contexts: ['page']
});

browser.contextMenus.create({
  id: 'send-link-to-jd',
  title: 'Send link to JDownloader',
  contexts: ['link']
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
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
    browser.notifications.create({
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
  
  browser.downloads.onCreated.removeListener(handleDownloadCreated);
  if (state !== 0) browser.downloads.onCreated.addListener(handleDownloadCreated);
  await saveState();
  updateBrowserAction();
}

(async () => {
  state = await loadState();
  if (state !== 0) browser.downloads.onCreated.addListener(handleDownloadCreated);
  updateBrowserAction();
  browser.browserAction.onClicked.addListener(toggleState);
  isJDownloaderAvailable();
})();
