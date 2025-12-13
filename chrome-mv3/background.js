const ICON_MANUAL = 'icons/icon-128.png';
const ICON_AUTO = 'icons/icon-128-auto.png';
const ICON_OFF = 'icons/icon-128-disabled.png';
const MODES = [0, 1, 2];
let state;

async function loadState() {
  const data = await chrome.storage.local.get("state");
  return (typeof data.state === "number") ? data.state : 2;
}

async function saveState() {
  await chrome.storage.local.set({ state: state });
}

function updateAction() {
  switch (state) {
    case 0:
      chrome.action.setIcon({ path: ICON_OFF });
      chrome.action.setTitle({ title: "Download Disabled" });
      break;
    case 1:
      chrome.action.setIcon({ path: ICON_MANUAL });
      chrome.action.setTitle({ title: "Manual Mode" });
      break;
    case 2:
      chrome.action.setIcon({ path: ICON_AUTO });
      chrome.action.setTitle({ title: "Auto Mode" });
      break;
  }
}

async function handleDownloadCreated(downloadItem) {
  if (state === 0) return;

  const downloadUrl = downloadItem.url;
  const encoded = encodeURIComponent(downloadUrl);
  const endpoint = state === 1
    ? `/linkcollector/addLinks?links=${encoded}&packageName=&extractPassword=&downloadPassword=`
    : `/linkcollector/addLinksAndStartDownload?links=${encoded}&packageName=&extractPassword=&downloadPassword=`;

  fetch(`http://localhost:3128${endpoint}`)
    .then(res => console.log('Response status:', res.status))
    .catch(console.error);

  try {
    await chrome.downloads.cancel(downloadItem.id);
    await chrome.downloads.erase({ id: downloadItem.id });
  } catch (e) {
    console.error(e);
  }
}

async function toggleState() {
  const idx = (MODES.indexOf(state) + 1) % MODES.length;
  state = MODES[idx];
  chrome.downloads.onCreated.removeListener(handleDownloadCreated);
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  await saveState();
  updateAction();
}

async function init() {
  state = await loadState();
  if (state !== 0) chrome.downloads.onCreated.addListener(handleDownloadCreated);
  updateAction();
}

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
chrome.action.onClicked.addListener(toggleState);
init();
