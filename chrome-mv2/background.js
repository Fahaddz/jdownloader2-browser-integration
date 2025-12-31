var ICON_MANUAL = 'icons/icon-128.png';
var ICON_AUTO = 'icons/icon-128-auto.png';
var ICON_OFF = 'icons/icon-128-disabled.png';
var MODES = [0, 1, 2];
var redirectMap = new Map();
var state;
var jdAvailable = true;
var lastCheckTime = 0;
var CHECK_INTERVAL = 30000;

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
  if (now - lastCheckTime < CHECK_INTERVAL) {
    callback(jdAvailable);
    return;
  }
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
    .then(function() {
      clearTimeout(timeout);
      jdAvailable = true;
      lastCheckTime = Date.now();
      callback(true);
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

  if (shouldSkipUrl(url)) {
    console.log('Skipping unsupported URL:', url.substring(0, 50));
    return;
  }

  isJDownloaderAvailable(function(isUp) {
    if (!isUp) {
      console.log('JDownloader offline, letting browser handle download');
      return;
    }

    var originalUrl = getOriginalUrl(url);

    chrome.downloads.cancel(downloadItem.id, function() {
      if (chrome.runtime.lastError) {
        console.log('Could not cancel download');
        return;
      }
      
      chrome.downloads.erase({ id: downloadItem.id });

      sendToJDownloader(originalUrl, function(success) {
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
      });
    });
  });
}

// Context menu to manually send links to JDownloader
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

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  var url;
  
  if (info.menuItemId === 'send-link-to-jd' && info.linkUrl) {
    url = info.linkUrl;
  } else if (info.menuItemId === 'send-page-to-jd') {
    url = info.pageUrl || tab.url;
  }
  
  if (!url) return;
  
  sendToJDownloader(url, function(success) {
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
});

function toggleState() {
  state = MODES[(MODES.indexOf(state) + 1) % MODES.length];
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
  isJDownloaderAvailable(function() {});
});
