# Better ViewLift Capture Helper

This companion Chrome extension lets Better ViewLift capture the visible CMS tab without showing Chrome's screen-sharing confirmation on every screenshot.

## One-time installation

1. Download this repository (or the `extension/better-viewlift-capture` folder).
2. Open `chrome://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select this folder.

Chrome requires this one-time user confirmation. Tampermonkey cannot silently install extensions.

After installation, keep the extension enabled and reload the CMS tab. Better ViewLift will use it automatically; if it is unavailable, the normal screen-share fallback remains available.
