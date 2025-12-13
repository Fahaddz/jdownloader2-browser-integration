const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
const redirectMap = new Map();
var state;
var jdAvailable = true;
var lastFailureTime = 0;
var FAILURE_COOLDOWN = 30000; // 30 seconds before retrying after failure

chrome.webRequest.onBeforeRedirect.addListener(
  function(details) {
    if (details.type === 'main_frame' || details.type === 'sub_frame') return;
    var originalUrl = redirectMap.get(details.url) || details.url;
    redirectMap.set(details.redirectUrl, originalUrl);
    setTimeout(function() {
      redirectMap.delete(details.url);
      redirectMap.delete(details.redirectUrl);
    }, 60000);
  },
  { urls: ["<all_urls>"] }
);

function loadState(callback) {
  chrome.storage.local.get("state", function(data) {
    callback((typeof data.state === "number") ? data.state : 2);
  });
}

function saveState() {
  chrome.storage.local.set({ state: state });
}

function updateBrowserAction() {
  switch (state) {
    case 0:
      chrome.browserAction.setIcon({ path: ICON_OFF });
      chrome.browserAction.setTitle({ title: "Download Disabled" });
      break;
    case 1:
      chrome.browserAction.setIcon({ path: ICON_MANUAL });
      chrome.browserAction.setTitle({ title: "Manual Mode" });
      break;
    case 2:
      chrome.browserAction.setIcon({ path: ICON_AUTO });
      chrome.browserAction.setTitle({ title: "Auto Mode" });
      break;
  }
}

function getOriginalUrl(url) {
  return redirectMap.get(url) || url;
}

function extractFilenameFromUrl(url) {
  try {
    var urlObj = new URL(url);
    var pathname = urlObj.pathname;
    var filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    // Remove query string if present
    if (filename.indexOf('?') !== -1) {
      filename = filename.split('?')[0];
    }
    if (filename && filename.indexOf('.') !== -1) {
      return decodeURIComponent(filename);
    }
  } catch (e) {}
  return null;
}

function isInCooldown() {
  if (!jdAvailable) {
    var timeSinceFailure = Date.now() - lastFailureTime;
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

function quickPing(callback) {
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 500);
  
  fetch('http://localhost:3128/device/ping', { signal: controller.signal })
    .then(function(res) {
      clearTimeout(timeout);
      callback(res.ok);
    })
    .catch(function() {
      clearTimeout(timeout);
      callback(false);
    });
}

function fallbackToBrowser(context) {
  var downloadOptions = { url: context.finalUrl };
  
  // Chrome filename must be just the filename, not a full path
  if (context.filename) {
    var filename = context.filename;
    if (filename.indexOf('/') !== -1) {
      filename = filename.substring(filename.lastIndexOf('/') + 1);
    }
    if (filename.indexOf('\\') !== -1) {
      filename = filename.substring(filename.lastIndexOf('\\') + 1);
    }
    if (filename) {
      downloadOptions.filename = filename;
    }
  }

  recentUrls.add(context.finalUrl);
  recentUrls.add(context.originalUrl);
  
  // Clean up recentUrls after 10 seconds to prevent memory leak
  setTimeout(function() {
    recentUrls.delete(context.finalUrl);
    recentUrls.delete(context.originalUrl);
  }, 10000);
  
  chrome.downloads.download(downloadOptions, function(downloadId) {
    if (chrome.runtime.lastError) {
      console.error('Fallback download failed:', chrome.runtime.lastError.message);
      // Try again without filename constraint
      chrome.downloads.download({ url: context.finalUrl });
    }
  });
}

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  var finalUrl = downloadItem.url;
  var originalUrl = getOriginalUrl(finalUrl);

  if (recentUrls.has(finalUrl) || recentUrls.has(originalUrl)) {
    recentUrls.delete(finalUrl);
    recentUrls.delete(originalUrl);
    return;
  }

  // CANCEL IMMEDIATELY - no waiting
  chrome.downloads.cancel(downloadItem.id, function() {
    chrome.downloads.erase({ id: downloadItem.id });
  });

  // Store context for fallback
  var downloadContext = {
    finalUrl: finalUrl,
    originalUrl: originalUrl,
    filename: downloadItem.filename || 
              extractFilenameFromUrl(originalUrl) || 
              extractFilenameFromUrl(finalUrl) ||
              null
  };

  // Check cooldown first (instant)
  if (isInCooldown()) {
    console.log('JDownloader in cooldown, falling back to browser');
    fallbackToBrowser(downloadContext);
    return;
  }

  // Quick ping check (500ms max)
  quickPing(function(isUp) {
    if (!isUp) {
      console.log('JDownloader not responding to ping, falling back to browser');
      markJDownloaderFailed();
      fallbackToBrowser(downloadContext);
      return;
    }

    // Send to JDownloader
    var encoded = encodeURIComponent(originalUrl);
    var endpoint = state === 1
      ? '/linkcollector/addLinks?links=' + encoded + '&packageName=&extractPassword=&downloadPassword='
      : '/linkcollector/addLinksAndStartDownload?links=' + encoded + '&packageName=&extractPassword=&downloadPassword=';

    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 3000);

    fetch('http://localhost:3128' + endpoint, { signal: controller.signal })
      .then(function(res) {
        clearTimeout(timeout);
        if (res.ok) {
          console.log('Download sent to JDownloader:', originalUrl);
          markJDownloaderSuccess();
        } else {
          throw new Error('JDownloader returned error');
        }
      })
      .catch(function(e) {
        clearTimeout(timeout);
        console.log('JDownloader failed, restarting in browser:', e.message);
        markJDownloaderFailed();
        fallbackToBrowser(downloadContext);
      });
  });
}

function toggleState() {
  var idx = (MODES.indexOf(state) + 1) % MODES.length;
  state = MODES[idx];
  
  // Reset JDownloader availability on mode change
  jdAvailable = true;
  lastFailureTime = 0;
  
  chrome.downloads.onCreated.removeListener(handleDownloadCreated);
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  saveState();
  updateBrowserAction();
}

loadState(function(loadedState) {
  state = loadedState;
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  updateBrowserAction();
  chrome.browserAction.onClicked.addListener(toggleState);
});
