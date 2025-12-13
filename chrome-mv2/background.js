const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
const redirectMap = new Map();
let state;

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

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  var finalUrl = downloadItem.url;
  var originalUrl = getOriginalUrl(finalUrl);

  if (recentUrls.has(finalUrl) || recentUrls.has(originalUrl)) {
    recentUrls.delete(finalUrl);
    recentUrls.delete(originalUrl);
    return;
  }

  chrome.downloads.cancel(downloadItem.id, function() {
    chrome.downloads.erase({ id: downloadItem.id });
  });

  var encoded = encodeURIComponent(originalUrl);
  var endpoint = state === 1
    ? '/linkcollector/addLinks?links=' + encoded + '&packageName=&extractPassword=&downloadPassword='
    : '/linkcollector/addLinksAndStartDownload?links=' + encoded + '&packageName=&extractPassword=&downloadPassword=';

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 10000);

  fetch('http://localhost:3128' + endpoint, { signal: controller.signal })
    .then(function(res) {
      clearTimeout(timeout);
      if (res.ok) {
        console.log('Download sent to JDownloader:', originalUrl);
      } else {
        throw new Error('JDownloader returned error');
      }
    })
    .catch(function(e) {
      clearTimeout(timeout);
      console.log('JDownloader failed, restarting in browser:', e.message);
      recentUrls.add(originalUrl);
      chrome.downloads.download({ url: originalUrl });
    });
}

function toggleState() {
  var idx = (MODES.indexOf(state) + 1) % MODES.length;
  state = MODES[idx];
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
