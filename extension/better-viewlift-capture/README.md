# ViewLift Helper

This companion Chrome extension lets Better ViewLift capture the visible CMS tab without showing Chrome's screen-sharing confirmation on every screenshot. It is named broadly so additional ViewLift productivity tools can be added later.

## One-time installation

1. Download this repository (or the `extension/better-viewlift-capture` folder).
2. Open `chrome://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select this folder.

Chrome requires this one-time user confirmation. Tampermonkey cannot silently install extensions.

After installation, keep the extension enabled and reload the CMS tab. Better ViewLift will use it automatically; if it is unavailable, the normal screen-share fallback remains available.
