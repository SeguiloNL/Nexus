# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: g02-dashboard.spec.ts >> G.2.2 — Dashboard smoke >> H1 + Recente activaties tabel (minimaal 1 order rij) + 10 sidebalkoppen
- Location: tests/e2e/g02-dashboard.spec.ts:20:3

# Error details

```
Error: Channel closed
```

```
Error: page.goto: Target page, context or browser has been closed
```

```
Error: browserContext.close: Test ended.
Browser logs:

<launching> /Users/bas/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/var/folders/62/cp_4tvxs1qx1fyr8lj83j5280000gn/T/playwright_chromiumdev_profile-ytOAGw --remote-debugging-pipe --no-startup-window
<launched> pid=83388
[pid=83388][err] [0917/135257.458085:ERROR:ui/display/mac/cv_display_link_mac.mm:195] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=83388][err] [0917/135257.527991:ERROR:ui/display/mac/cv_display_link_mac.mm:195] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=83388][err] [0917/135257.756808:INFO:CONSOLE:38560] "%cDownload the React DevTools for a better development experience: https://reactjs.org/link/react-devtools font-weight:bold", source: webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react-dom/cjs/react-dom.development.js (38560)
[pid=83388][err] [0917/135318.054774:ERROR:ui/display/mac/cv_display_link_mac.mm:195] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
[pid=83388][err] [0917/135318.262509:INFO:CONSOLE:38560] "%cDownload the React DevTools for a better development experience: https://reactjs.org/link/react-devtools font-weight:bold", source: webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react-dom/cjs/react-dom.development.js (38560)
[pid=83388] <gracefully close start>
[pid=83388][err] [0917/135320.706339:ERROR:content/browser/gpu/gpu_process_host.cc:1054] GPU process exited unexpectedly: exit_code=15
[pid=83388][err] [0917/135320.706383:WARNING:content/browser/gpu/gpu_process_host.cc:1506] The GPU process has crashed 1 time(s)
[pid=83388][err] [0917/135320.728496:ERROR:content/browser/network_service_instance_impl.cc:655] Network service crashed or was terminated, restarting service.
```