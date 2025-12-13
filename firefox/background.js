const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
const recentUrls = new Set();
const redirectMap = new Map();
let state;

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

async function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const finalUrl = downloadItem.url;
  const originalUrl = getOriginalUrl(finalUrl);

  if (recentUrls.has(finalUrl) || recentUrls.has(originalUrl)) {
    recentUrls.delete(finalUrl);
    recentUrls.delete(originalUrl);
    return;
  }

  try {
    await browser.downloads.cancel(downloadItem.id);
    await browser.downloads.erase({ id: downloadItem.id });
  } catch (e) {}

  const encoded = encodeURIComponent(originalUrl);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`http://localhost:3128${endpoint}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      console.log('Download sent to JDownloader:', originalUrl);
    } else {
      throw new Error('JDownloader returned error');
    }
  } catch (e) {
    console.log('JDownloader failed, restarting in browser:', e.message);
    recentUrls.add(originalUrl);
    browser.downloads.download({ url: originalUrl });
  }
}

async function toggleState() {
  const idx = (MODES.indexOf(state) + 1) % MODES.length;
  state = MODES[idx];
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
