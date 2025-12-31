const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const redirectMap = new Map();
let state;
let jdAvailable = true;
let lastCheckTime = 0;
const CHECK_INTERVAL = 30000; // Re-check JD availability every 30 seconds

// URL schemes that cannot be handled by JDownloader
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
  
  // Use cached result if checked recently
  if (now - lastCheckTime < CHECK_INTERVAL) {
    return jdAvailable;
  }
  
  // Perform fresh check
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
    const res = await fetch(`http://localhost:3128${endpoint}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      jdAvailable = true;
      lastCheckTime = Date.now();
      return true;
    }
    return false;
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

  // Skip URLs that can't be handled
  if (shouldSkipUrl(url)) {
    console.log('Skipping unsupported URL:', url.substring(0, 50));
    return;
  }

  // CHECK FIRST: Is JDownloader available?
  const isUp = await isJDownloaderAvailable();
  
  if (!isUp) {
    // JDownloader is down - let browser handle download normally
    console.log('JDownloader offline, letting browser handle download');
    return;
  }

  const originalUrl = getOriginalUrl(url);

  // JDownloader is available - cancel browser download and send to JD
  try {
    await browser.downloads.cancel(downloadItem.id);
    await browser.downloads.erase({ id: downloadItem.id });
  } catch (e) {
    console.log('Could not cancel download');
    return;
  }

  // Send to JDownloader
  const success = await sendToJDownloader(originalUrl);

  if (success) {
    console.log('Download sent to JDownloader:', originalUrl);
  } else {
    console.log('JDownloader failed - download was already canceled, please retry');
    // Show notification that user needs to retry
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'JDownloader Failed',
      message: 'Download was canceled but JDownloader failed. Please retry the download.'
    });
  }
}

async function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
  
  // Reset JDownloader check on mode change
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
  
  // Initial JDownloader check
  isJDownloaderAvailable();
})();
