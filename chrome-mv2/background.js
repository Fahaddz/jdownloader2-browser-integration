var ICON_MANUAL = 'icons/icon-128.png';
var ICON_AUTO = 'icons/icon-128-auto.png';
var ICON_OFF = 'icons/icon-128-disabled.png';
var MODES = [0, 1, 2];
var recentUrls = new Set();
var redirectMap = new Map();
var state;
var jdAvailable = true;
var lastFailureTime = 0;
var FAILURE_COOLDOWN = 30000;

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

function fallbackToBrowser(url, originalUrl) {
  recentUrls.add(url);
  recentUrls.add(originalUrl);
  
  setTimeout(function() {
    recentUrls.delete(url);
    recentUrls.delete(originalUrl);
  }, 10000);
  
  chrome.downloads.download({ url: url }, function() {
    if (chrome.runtime.lastError) {
      console.error('Fallback download failed:', chrome.runtime.lastError.message);
    }
  });
}

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  var url = downloadItem.url;
  var originalUrl = getOriginalUrl(url);

  if (recentUrls.has(url) || recentUrls.has(originalUrl)) {
    recentUrls.delete(url);
    recentUrls.delete(originalUrl);
    return;
  }

  chrome.downloads.cancel(downloadItem.id, function() {
    chrome.downloads.erase({ id: downloadItem.id });
  });

  if (isInCooldown()) {
    console.log('JDownloader in cooldown, falling back to browser');
    fallbackToBrowser(url, originalUrl);
    return;
  }

  quickPing(function(isUp) {
    if (!isUp) {
      console.log('JDownloader not responding, falling back to browser');
      markJDownloaderFailed();
      fallbackToBrowser(url, originalUrl);
      return;
    }

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
        console.log('JDownloader failed:', e.message);
        markJDownloaderFailed();
        fallbackToBrowser(url, originalUrl);
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
