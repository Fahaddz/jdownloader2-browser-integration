var ICON_MANUAL = 'icons/icon-128.png';
var ICON_AUTO = 'icons/icon-128-auto.png';
var ICON_OFF = 'icons/icon-128-disabled.png';
var MODES = [0, 1, 2];
var redirectMap = new Map();
var processingDownloads = new Set();
var state;
var jdAvailable = true;
var lastFailureTime = 0;
var FAILURE_COOLDOWN = 30000;

// URL schemes that cannot be handled by JDownloader
var SKIP_SCHEMES = ['blob:', 'data:', 'file:', 'javascript:', 'about:', 'chrome:', 'chrome-extension:'];

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
  { urls: ['<all_urls>'] }
);

function shouldSkipUrl(url) {
  if (!url) return true;
  var lowerUrl = url.toLowerCase();
  for (var i = 0; i < SKIP_SCHEMES.length; i++) {
    if (lowerUrl.indexOf(SKIP_SCHEMES[i]) === 0) return true;
  }
  return false;
}

function loadState(callback) {
  chrome.storage.local.get('state', function(data) {
    callback((typeof data.state === 'number') ? data.state : 2);
  });
}

function saveState() {
  chrome.storage.local.set({ state: state });
}

function updateBrowserAction() {
  switch (state) {
    case 0:
      chrome.browserAction.setIcon({ path: ICON_OFF });
      chrome.browserAction.setTitle({ title: 'Download Disabled' });
      break;
    case 1:
      chrome.browserAction.setIcon({ path: ICON_MANUAL });
      chrome.browserAction.setTitle({ title: 'Manual Mode' });
      break;
    case 2:
      chrome.browserAction.setIcon({ path: ICON_AUTO });
      chrome.browserAction.setTitle({ title: 'Auto Mode' });
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

function sendToJDownloader(url, callback) {
  var encoded = encodeURIComponent(url);
  var endpoint = state === 1
    ? '/linkcollector/addLinks?links=' + encoded + '&packageName=&extractPassword=&downloadPassword='
    : '/linkcollector/addLinksAndStartDownload?links=' + encoded + '&packageName=&extractPassword=&downloadPassword=';

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 3000);

  fetch('http://localhost:3128' + endpoint, { signal: controller.signal })
    .then(function(res) {
      clearTimeout(timeout);
      callback(res.ok);
    })
    .catch(function() {
      clearTimeout(timeout);
      callback(false);
    });
}

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  var downloadId = downloadItem.id;
  var url = downloadItem.url;

  // Skip URLs that can't be handled
  if (shouldSkipUrl(url)) {
    console.log('Skipping unsupported URL:', url.substring(0, 50));
    return;
  }

  // Prevent re-processing
  if (processingDownloads.has(downloadId)) {
    return;
  }
  processingDownloads.add(downloadId);

  var originalUrl = getOriginalUrl(url);

  // PAUSE immediately to stop bandwidth usage while keeping download context
  chrome.downloads.pause(downloadId, function() {
    if (chrome.runtime.lastError) {
      console.log('Could not pause download, skipping interception');
      processingDownloads.delete(downloadId);
      return;
    }

    // If in cooldown, resume immediately
    if (isInCooldown()) {
      console.log('JDownloader in cooldown, resuming browser download');
      chrome.downloads.resume(downloadId, function() {
        processingDownloads.delete(downloadId);
      });
      return;
    }

    // Quick ping to check if JDownloader is available
    quickPing(function(isUp) {
      if (!isUp) {
        console.log('JDownloader not responding, resuming browser download');
        markJDownloaderFailed();
        chrome.downloads.resume(downloadId, function() {
          processingDownloads.delete(downloadId);
        });
        return;
      }

      // Try to send to JDownloader
      sendToJDownloader(originalUrl, function(success) {
        if (success) {
          console.log('Download sent to JDownloader:', originalUrl);
          markJDownloaderSuccess();
          // Cancel and remove from browser since JDownloader has it
          chrome.downloads.cancel(downloadId, function() {
            chrome.downloads.erase({ id: downloadId });
            processingDownloads.delete(downloadId);
          });
        } else {
          console.log('JDownloader failed, resuming browser download');
          markJDownloaderFailed();
          chrome.downloads.resume(downloadId, function() {
            processingDownloads.delete(downloadId);
          });
        }
      });
    });
  });
}

function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
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
