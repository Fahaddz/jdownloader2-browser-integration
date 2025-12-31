var ICON_MANUAL = 'icons/icon-128.png';
var ICON_AUTO = 'icons/icon-128-auto.png';
var ICON_OFF = 'icons/icon-128-disabled.png';
var MODES = [0, 1, 2];
var redirectMap = new Map();
var state;
var jdAvailable = true;
var lastCheckTime = 0;
var CHECK_INTERVAL = 30000; // Re-check JD availability every 30 seconds

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

function checkJDownloader(callback) {
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 1000);
  
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

function isJDownloaderAvailable(callback) {
  var now = Date.now();
  
  // Use cached result if checked recently
  if (now - lastCheckTime < CHECK_INTERVAL) {
    callback(jdAvailable);
    return;
  }
  
  // Perform fresh check
  checkJDownloader(function(isUp) {
    jdAvailable = isUp;
    lastCheckTime = Date.now();
    callback(isUp);
  });
}

function sendToJDownloader(url, callback) {
  var encoded = encodeURIComponent(url);
  var endpoint = state === 1
    ? '/linkcollector/addLinks?links=' + encoded + '&packageName=&extractPassword=&downloadPassword='
    : '/linkcollector/addLinksAndStartDownload?links=' + encoded + '&packageName=&extractPassword=&downloadPassword=';

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 5000);

  fetch('http://localhost:3128' + endpoint, { signal: controller.signal })
    .then(function(res) {
      clearTimeout(timeout);
      if (res.ok) {
        jdAvailable = true;
        lastCheckTime = Date.now();
        callback(true);
      } else {
        callback(false);
      }
    })
    .catch(function() {
      clearTimeout(timeout);
      jdAvailable = false;
      lastCheckTime = Date.now();
      callback(false);
    });
}

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  var url = downloadItem.url;
  var downloadId = downloadItem.id;

  // Skip URLs that can't be handled
  if (shouldSkipUrl(url)) {
    console.log('Skipping unsupported URL:', url.substring(0, 50));
    return;
  }

  // CHECK FIRST: Is JDownloader available?
  isJDownloaderAvailable(function(isUp) {
    if (!isUp) {
      // JDownloader is down - let browser handle download normally
      console.log('JDownloader offline, letting browser handle download');
      return;
    }

    var originalUrl = getOriginalUrl(url);

    // JDownloader is available - cancel browser download and send to JD
    chrome.downloads.cancel(downloadId, function() {
      if (chrome.runtime.lastError) {
        console.log('Could not cancel download');
        return;
      }
      
      chrome.downloads.erase({ id: downloadId });

      // Send to JDownloader
      sendToJDownloader(originalUrl, function(success) {
        if (success) {
          console.log('Download sent to JDownloader:', originalUrl);
        } else {
          console.log('JDownloader failed - download was already canceled, please retry');
          // Show notification that user needs to retry
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: 'JDownloader Failed',
            message: 'Download was canceled but JDownloader failed. Please retry the download.'
          });
        }
      });
    });
  });
}

function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
  
  // Reset JDownloader check on mode change
  jdAvailable = true;
  lastCheckTime = 0;
  
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
  
  // Initial JDownloader check
  isJDownloaderAvailable(function() {});
});
