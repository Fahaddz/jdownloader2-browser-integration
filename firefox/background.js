const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
const redirectMap = new Map();
let state;
let jdAvailable = true;
let lastFailureTime = 0;
const FAILURE_COOLDOWN = 30000; // 30 seconds before retrying after failure

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
  { urls: ["<all_urls>"] }
);

async function loadState() {
  const data = await browser.storage.local.get("state");
  return (typeof data.state === "number") ? data.state : 2;
}

async function saveState() {
  await browser.storage.local.set({ state });
}

function updateBrowserAction() {
  switch (state) {
    case 0:
      browser.browserAction.setIcon({ path: ICON_OFF });
      browser.browserAction.setTitle({ title: "Download Disabled" });
      break;
    case 1:
      browser.browserAction.setIcon({ path: ICON_MANUAL });
      browser.browserAction.setTitle({ title: "Manual Mode" });
      break;
    case 2:
      browser.browserAction.setIcon({ path: ICON_AUTO });
      browser.browserAction.setTitle({ title: "Auto Mode" });
      break;
  }
}

function getOriginalUrl(url) {
  return redirectMap.get(url) || url;
}

function extractFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    // Remove query string if present
    if (filename.includes('?')) {
      filename = filename.split('?')[0];
    }
    if (filename && filename.includes('.')) {
      return decodeURIComponent(filename);
    }
  } catch (e) {}
  return null;
}

function isInCooldown() {
  if (!jdAvailable) {
    const timeSinceFailure = Date.now() - lastFailureTime;
    if (timeSinceFailure < FAILURE_COOLDOWN) {
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

function fallbackToBrowser(context) {
  // Don't set filename - let browser determine it from Content-Disposition header
  // This ensures correct filenames for GitHub archives and similar downloads
  const downloadOptions = { url: context.finalUrl };

  recentUrls.add(context.finalUrl);
  recentUrls.add(context.originalUrl);
  
  // Clean up recentUrls after 10 seconds to prevent memory leak
  setTimeout(() => {
    recentUrls.delete(context.finalUrl);
    recentUrls.delete(context.originalUrl);
  }, 10000);
  
  browser.downloads.download(downloadOptions).catch(err => {
    console.error('Fallback download failed:', err.message);
  });
}

async function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const finalUrl = downloadItem.url;
  const originalUrl = getOriginalUrl(finalUrl);

  if (recentUrls.has(finalUrl) || recentUrls.has(originalUrl)) {
    recentUrls.delete(finalUrl);
    recentUrls.delete(originalUrl);
    return;
  }

  // CANCEL IMMEDIATELY - no waiting
  try {
    await browser.downloads.cancel(downloadItem.id);
    await browser.downloads.erase({ id: downloadItem.id });
  } catch (e) {}

  // Store context for fallback
  // Prefer downloadItem.filename as browser resolves it from Content-Disposition
  // Fall back to URL extraction if not available
  let filename = null;
  if (downloadItem.filename) {
    filename = downloadItem.filename;
  } else {
    // Try to get filename from URL, prefer original URL for better names
    filename = extractFilenameFromUrl(originalUrl) || extractFilenameFromUrl(finalUrl);
  }
  
  const downloadContext = {
    finalUrl: finalUrl,
    originalUrl: originalUrl,
    filename: filename
  };

  // Check cooldown first (instant)
  if (isInCooldown()) {
    console.log('JDownloader in cooldown, falling back to browser');
    fallbackToBrowser(downloadContext);
    return;
  }

  // Quick ping check (500ms max)
  const isUp = await quickPing();
  if (!isUp) {
    console.log('JDownloader not responding to ping, falling back to browser');
    markJDownloaderFailed();
    fallbackToBrowser(downloadContext);
    return;
  }

  // Send to JDownloader
  const encoded = encodeURIComponent(originalUrl);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://localhost:3128${endpoint}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      console.log('Download sent to JDownloader:', originalUrl);
      markJDownloaderSuccess();
    } else {
      throw new Error('JDownloader returned error');
    }
  } catch (e) {
    console.log('JDownloader failed, restarting in browser:', e.message);
    markJDownloaderFailed();
    fallbackToBrowser(downloadContext);
  }
}

async function toggleState() {
  const idx = (MODES.indexOf(state) + 1) % MODES.length;
  state = MODES[idx];
  
  // Reset JDownloader availability on mode change
  jdAvailable = true;
  lastFailureTime = 0;
  
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
})();
