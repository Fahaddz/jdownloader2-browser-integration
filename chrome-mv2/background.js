const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
let state;

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

function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const downloadUrl = downloadItem.url;

  if (recentUrls.has(downloadUrl)) {
    recentUrls.delete(downloadUrl);
    return;
  }

  chrome.downloads.cancel(downloadItem.id, function() {
    chrome.downloads.erase({ id: downloadItem.id });
  });

  const encoded = encodeURIComponent(downloadUrl);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  const controller = new AbortController();
  const timeout = setTimeout(function() { controller.abort(); }, 6000);

  fetch(`http://localhost:3128${endpoint}`, { signal: controller.signal })
    .then(function(res) {
      clearTimeout(timeout);
      if (res.ok) {
        console.log('Download sent to JDownloader');
      } else {
        throw new Error('JDownloader returned error');
      }
    })
    .catch(function(e) {
      clearTimeout(timeout);
      console.log('JDownloader failed, restarting in browser:', e.message);
      recentUrls.add(downloadUrl);
      chrome.downloads.download({ url: downloadUrl });
    });
}

function toggleState() {
  const idx = (MODES.indexOf(state) + 1) % MODES.length;
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
