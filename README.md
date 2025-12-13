# JDownloader2 Browser Integration

A browser extension that intercepts download requests and forwards them to your local JDownloader2 instance, allowing you to manage all downloads centrally.

## Supported Browsers

| Browser | Version | Manifest |
|---------|---------|----------|
| Firefox | 91.0+ | MV2 |
| Chrome/Chromium | 88+ | MV2 or MV3 |
| Edge | 88+ | MV2 or MV3 |
| Brave | Latest | MV2 or MV3 |
| Opera | Latest | MV2 or MV3 |

## Manifest V2 vs V3 Comparison

| Feature | Manifest V2 | Manifest V3 |
|---------|-------------|-------------|
| Download Interception | ✅ Full support | ✅ Full support |
| Manual Mode | ✅ Works | ✅ Works |
| Automatic Mode | ✅ Works | ✅ Works |
| State Persistence | ✅ Persistent background | ⚠️ Service worker (may reset on idle) |
| Browser Support | ✅ All browsers | ❌ Firefox not supported |
| Future Compatibility | ⚠️ Being deprecated | ✅ Future-proof |

> **Note:** Chrome is phasing out Manifest V2. Use MV3 for Chrome if you want future compatibility. Firefox currently only supports MV2.

## Modes

The extension offers three modes, switchable by clicking the toolbar icon:

* **Disabled**: The extension is inactive. Browser handles downloads normally.
* **Manual** (default): Intercepts each download and sends the link to JDownloader's LinkCollector without starting the download. You can review and start downloads manually in JDownloader.
* **Automatic**: Intercepts and automatically sends each download link to JDownloader's LinkCollector and immediately starts the download in JDownloader.

The icon and tooltip update to indicate the current mode:

* Disabled: grayed-out icon, title "Download Disabled"
* Manual: default icon, title "Manual Mode"
* Automatic: auto icon, title "Auto Mode"

## Features

* Intercepts browser downloads via the Downloads API
* Forwards links to JDownloader's local API endpoints:
  * `addLinks` in Manual mode
  * `addLinksAndStartDownload` in Automatic mode
* Toggle modes instantly by clicking the toolbar icon
* Works with any Chromium-based browser and Firefox
* **Quick availability check**: Uses `/device/ping` endpoint (~4ms) to verify JDownloader is running
* **Smart fallback**: If JDownloader is not running, downloads proceed normally in the browser
* **Filename preservation**: Fallback downloads retain the correct filename (fixes GitHub releases issue)
* **Redirect URL tracking**: Correctly handles URLs that redirect (e.g., GitHub releases) using the original URL
* **30-second cooldown**: After a failure, skips JDownloader checks for 30 seconds (instant fallback)
* **Click to reset**: Clicking the extension icon resets the cooldown, allowing immediate retry

## Requirements

* Local JDownloader2 installation
* JDownloader's deprecated API enabled (see Configuration)

## Configuration

1. Open JDownloader2
2. Go to **Settings → Advanced Settings**
3. Search for `DeprecatedApi.enabled` and set it to `true`
4. Restart JDownloader2

> **Note:** JDownloader's deprecated API is disabled by default. It must be enabled for link forwarding to work.

## Installation

### From Releases (Recommended)

1. Go to the [Releases](https://github.com/Lood2222/jdownloader2-browser-integration/releases) page
2. Download the appropriate file for your browser:
   - **Firefox**: `jdownloader2-browser-integration-firefox-v*.xpi`
   - **Chrome (MV2)**: `jdownloader2-browser-integration-chrome-mv2-v*.zip`
   - **Chrome (MV3)**: `jdownloader2-browser-integration-chrome-mv3-v*.zip`

#### Firefox

1. Open Firefox and navigate to `about:addons`
2. Click the gear icon ⚙️ and select "Install Add-on From File..."
3. Select the downloaded `.xpi` file

#### Chrome / Chromium-based Browsers

1. Extract the downloaded `.zip` file
2. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/` for Edge)
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the extracted folder

### Manual Installation (From Source)

1. Clone the repository:
   ```bash
   git clone https://github.com/Lood2222/jdownloader2-browser-integration.git
   cd jdownloader2-browser-integration
   ```

2. Install in your browser:

#### Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Navigate to the `firefox/` folder and select `manifest.json`

> **Note:** Temporary add-ons are removed when Firefox restarts. For permanent installation, use the release `.xpi` file.

#### Chrome / Chromium-based Browsers

1. Open your browser and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select either:
   - `chrome-mv2/` folder for Manifest V2
   - `chrome-mv3/` folder for Manifest V3

## Version Management

The project uses a centralized `VERSION` file. To update the version:

1. Edit the `VERSION` file with the new version number
2. Run `./update-version.sh` to sync all manifest files
3. Commit and push to trigger a new release

## Building from Source

The project includes a build script to create release packages:

```bash
chmod +x build.sh
./build.sh
```

This creates:
- `build/jdownloader2-browser-integration-firefox-v*.xpi`
- `build/jdownloader2-browser-integration-chrome-mv2-v*.zip`
- `build/jdownloader2-browser-integration-chrome-mv3-v*.zip`

## Usage

1. Click the extension icon to cycle through modes: Disabled → Manual → Automatic
2. In Manual or Automatic mode, start any download in your browser
3. The extension intercepts the download and sends the URL to JDownloader2
4. In Manual mode: links appear in JDownloader's LinkCollector awaiting manual start
5. In Automatic mode: downloads begin immediately in JDownloader2

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Downloads not being intercepted | Make sure the extension is in Manual or Automatic mode (not Disabled) |
| Links not appearing in JDownloader | Verify that `DeprecatedApi.enabled` is set to `true` and JDownloader is running |
| Connection refused errors | JDownloader must be running and listening on `http://localhost:3128` |
| Extension icon not visible | Pin the extension from the browser's extension menu |
| Download falls back to browser | This is expected behavior when JDownloader is not running or unreachable |
| Fallback happening too often | Click the extension icon to reset the cooldown and retry JDownloader |

## How It Works

1. When you start a download, the extension **immediately cancels** it in the browser
2. A quick ping check (~4ms when JD is running, 500ms timeout) verifies JDownloader availability
3. If JDownloader is **not available**:
   - The download restarts in the browser with the correct filename
   - A 30-second cooldown starts (subsequent downloads skip the ping check)
4. If JDownloader **is available**:
   - The **original URL** (before any redirects) is sent to JDownloader's API
   - On success, JDownloader handles the download
   - On failure, the download falls back to the browser

This ensures downloads never get lost and filenames are preserved correctly.

## Limitations

* Only works with a locally running JDownloader2 instance
* Depends on the deprecated API; incompatible with remote JDownloader servers

## Project Structure

```
jdownloader2-browser-integration/
├── firefox/           # Firefox extension (Manifest V2)
├── chrome-mv2/        # Chrome extension (Manifest V2)
├── chrome-mv3/        # Chrome extension (Manifest V3)
├── src/icons/         # Extension icons (by Lood2222)
├── VERSION            # Centralized version file
├── update-version.sh  # Script to sync version across manifests
├── build.sh           # Build script for creating release packages
└── .github/workflows/ # GitHub Actions for automated releases
```

## Credits

This project is based on [Firefox-Download-Interceptor-for-JDownloader](https://github.com/Lood2222/Firefox-Download-Interceptor-for-JDownloader) by **Lood2222**.

All original code, icons, and concept are credited to the original author. This fork adds:
- Chrome/Chromium browser support (Manifest V2 & V3)
- Multi-browser build system
- Automated GitHub releases
- Smart fallback with filename preservation
- Quick availability ping check


<details>
<summary><strong>How to Install JDownloader2 and Disable Ads</strong></summary>

### Installation

1. Go to [https://jdownloader.org/jdownloader2](https://jdownloader.org/jdownloader2) and click on the button for your operating system to download the setup file.

2. Run the setup file and follow the installation instructions. You can choose the installation directory and language during this process.

### Disable Ads

1. Once JDownloader is installed, open it and go to **Settings → Advanced Settings** (the icon with a warning sign).

2. In the Filter Settings, search for the following values and disable them by clicking on the check-mark button:

   - `premium alert`
   - `oboom`
   - `Special Deals`
   - `Donate`
   - `Banner`

</details>

## License

This project is licensed under the Mozilla Public License 2.0

[https://www.mozilla.org/en-US/MPL/2.0/](https://www.mozilla.org/en-US/MPL/2.0/)
