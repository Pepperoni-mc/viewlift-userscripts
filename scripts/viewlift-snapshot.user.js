// ==UserScript==
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/viewlift-snapshot.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/viewlift-snapshot.user.js
// @name         ViewLift CMS Real Snapshot to Clipboard
// @namespace    https://cms.viewlift.com/
// @version      2.9
// @author       Happy
// @description  Real tab snapshot for ViewLift CMS user pages with Payment Handler badge next to the camera button
// @match        https://cms.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    if (window.__viewliftSnapshotToolsInstalled) {
        return;
    }

    window.__viewliftSnapshotToolsInstalled = true;

    const BUTTON_ID = "tm-viewlift-real-snapshot-button";
    const BADGE_ID = "tm-viewlift-payment-handler-badge";
    const WRAPPER_ID = "tm-viewlift-snapshot-tools";
    const STYLE_ID = "tm-viewlift-snapshot-tools-style";

    const AUTO_OPEN_SUBSCRIPTION_PLANS = true;

    let autoOpenAttempted = false;
    let lastUrl = location.href;
    let routeTimer = null;

    const GREEN_HANDLERS = [
        "roku",
        "stripe",
        "google",
        "google play",
        "play store"
    ];

    const RED_HANDLERS = [
        "itunes",
        "apple",
        "app store",
        "amazon"
    ];

    const HIDE_DURING_CAPTURE_SELECTORS = [
        `#${BUTTON_ID}`,
        `#${BADGE_ID}`,
        `#${WRAPPER_ID}`,
        "#refund-capture-panel"
    ];

    function isUserPage() {
        return /^\/users(\/|$)/i.test(location.pathname);
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${WRAPPER_ID} {
                display: inline-flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin-left: 10px !important;
            }

            #${BUTTON_ID} {
                width: 38px !important;
                height: 38px !important;
                padding: 0 !important;
                font-size: 21px !important;
                font-family: Arial, sans-serif !important;
                background: linear-gradient(180deg, #22c55e 0%, #16a34a 100%) !important;
                color: #ffffff !important;
                border: 1px solid #15803d !important;
                border-radius: 10px !important;
                cursor: pointer !important;
                box-shadow:
                    0 4px 10px rgba(22, 163, 74, 0.28),
                    inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
                line-height: 1 !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                vertical-align: middle !important;
                transform: translateY(0) !important;
                transition:
                    background 140ms ease,
                    box-shadow 140ms ease,
                    transform 140ms ease,
                    opacity 140ms ease !important;
            }

            #${BUTTON_ID}:hover {
                background: linear-gradient(180deg, #16a34a 0%, #15803d 100%) !important;
                box-shadow:
                    0 6px 14px rgba(22, 163, 74, 0.34),
                    inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
                transform: translateY(-1px) !important;
            }

            #${BUTTON_ID}:active {
                transform: translateY(0) !important;
                box-shadow:
                    0 2px 6px rgba(22, 163, 74, 0.24),
                    inset 0 2px 4px rgba(0, 0, 0, 0.12) !important;
            }

            #${BADGE_ID} {
                display: none !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 7px !important;
                width: fit-content !important;
                min-width: 86px !important;
                padding: 5px 11px !important;
                border-radius: 999px !important;
                font-size: 12px !important;
                font-weight: 800 !important;
                line-height: 1.2 !important;
                letter-spacing: 0.04em !important;
                text-transform: uppercase !important;
                box-sizing: border-box !important;
                white-space: nowrap !important;
                user-select: text !important;
                font-family: Arial, sans-serif !important;
            }

            #${BADGE_ID}::before {
                content: "" !important;
                width: 7px !important;
                height: 7px !important;
                border-radius: 999px !important;
                flex: 0 0 auto !important;
            }

            #${BADGE_ID}.tm-payment-handler-good {
                display: inline-flex !important;
                color: #065f46 !important;
                background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%) !important;
                border: 1px solid rgba(16, 185, 129, 0.55) !important;
                box-shadow:
                    0 2px 6px rgba(16, 185, 129, 0.16),
                    inset 0 1px 0 rgba(255, 255, 255, 0.70) !important;
            }

            #${BADGE_ID}.tm-payment-handler-good::before {
                background: #10b981 !important;
                box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16) !important;
            }

            #${BADGE_ID}.tm-payment-handler-bad {
                display: inline-flex !important;
                color: #991b1b !important;
                background: linear-gradient(180deg, #fff1f2 0%, #fee2e2 100%) !important;
                border: 1px solid rgba(239, 68, 68, 0.55) !important;
                box-shadow:
                    0 2px 6px rgba(239, 68, 68, 0.14),
                    inset 0 1px 0 rgba(255, 255, 255, 0.70) !important;
            }

            #${BADGE_ID}.tm-payment-handler-bad::before {
                background: #ef4444 !important;
                box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16) !important;
            }
        `;

        document.head.appendChild(style);
    }

    function removeToolsIfNotUserPage() {
        if (isUserPage()) return;

        const wrapper = document.getElementById(WRAPPER_ID);
        if (wrapper) wrapper.remove();
    }

    function createOrMoveTools() {
        if (!isUserPage()) {
            removeToolsIfNotUserPage();
            return;
        }

        addStyles();

        const clientNameHeader = findClientNameHeader();

        if (!clientNameHeader) {
            return;
        }

        let wrapper = document.getElementById(WRAPPER_ID);

        if (!wrapper) {
            wrapper = document.createElement("span");
            wrapper.id = WRAPPER_ID;
        }

        let button = document.getElementById(BUTTON_ID);

        if (!button) {
            button = document.createElement("button");
            button.id = BUTTON_ID;
            button.type = "button";
            button.textContent = "📸";
            button.title = "Copy page snapshot";
            button.setAttribute("aria-label", "Copy page snapshot");
            button.addEventListener("click", captureRealTabSnapshot);
        }

        let badge = document.getElementById(BADGE_ID);

        if (!badge) {
            badge = document.createElement("span");
            badge.id = BADGE_ID;
            badge.title = "Payment Handler";
        }

        if (!wrapper.contains(button)) wrapper.appendChild(button);
        if (!wrapper.contains(badge)) wrapper.appendChild(badge);

        const nameContainer = clientNameHeader.parentElement;

        if (!nameContainer) {
            return;
        }

        nameContainer.style.display = "flex";
        nameContainer.style.alignItems = "center";
        nameContainer.style.gap = "8px";
        nameContainer.style.flexDirection = "row";

        if (wrapper.parentElement !== nameContainer || wrapper.previousElementSibling !== clientNameHeader) {
            clientNameHeader.insertAdjacentElement("afterend", wrapper);
        }

        updatePaymentHandlerBadge();

        if (AUTO_OPEN_SUBSCRIPTION_PLANS) {
            autoOpenSubscriptionPlansIfNeeded();
        }
    }

    function updatePaymentHandlerBadge() {
        const badge = document.getElementById(BADGE_ID);
        if (!badge) return;

        let handler = findPaymentHandlerValue();

        if (handler) {
            saveStoredHandler(handler);
        } else {
            handler = getStoredHandler();
        }

        badge.classList.remove("tm-payment-handler-good", "tm-payment-handler-bad");

        if (!handler) {
            badge.textContent = "";
            badge.style.display = "none";
            return;
        }

        const normalized = normalizeHandler(handler);
        const isGreen = GREEN_HANDLERS.some(value => normalized.includes(value));
        const isRed = RED_HANDLERS.some(value => normalized.includes(value));

        if (!isGreen && !isRed) {
            badge.textContent = "";
            badge.style.display = "none";
            return;
        }

        badge.textContent = cleanHandlerDisplay(handler).toUpperCase();

        if (isGreen) {
            badge.classList.add("tm-payment-handler-good");
            return;
        }

        if (isRed) {
            badge.classList.add("tm-payment-handler-bad");
        }
    }

    function autoOpenSubscriptionPlansIfNeeded() {
        if (autoOpenAttempted) return;

        const currentHandler = findPaymentHandlerValue();

        if (currentHandler) {
            saveStoredHandler(currentHandler);
            updatePaymentHandlerBadge();
            return;
        }

        const storedHandler = getStoredHandler();

        if (storedHandler) {
            updatePaymentHandlerBadge();
            return;
        }

        const trigger = findSubscriptionPlansTrigger();

        if (!trigger) {
            return;
        }

        autoOpenAttempted = true;
        trigger.click();

        waitForPaymentHandler(12000).then(handler => {
            if (handler) {
                saveStoredHandler(handler);
                updatePaymentHandlerBadge();
            }
        });
    }

    function findSubscriptionPlansTrigger() {
        const elements = Array.from(document.querySelectorAll(
            "button, [role='button'], [role='tab'], a, [tabindex], div, span, p"
        ));

        for (const element of elements) {
            if (element.closest(`#${WRAPPER_ID}, #refund-capture-panel`)) continue;

            const text = cleanText(element.textContent);

            if (text !== "Subscription Plans") continue;

            const clickable = element.closest("button, [role='button'], [role='tab'], a, [tabindex]");

            if (clickable && !clickable.disabled) {
                return clickable;
            }

            return element;
        }

        return null;
    }

    function waitForPaymentHandler(timeoutMs) {
        return new Promise(resolve => {
            const startedAt = Date.now();

            const timer = setInterval(() => {
                const handler = findPaymentHandlerValue();

                if (handler) {
                    clearInterval(timer);
                    resolve(handler);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    clearInterval(timer);
                    resolve("");
                }
            }, 300);
        });
    }

    function findPaymentHandlerValue() {
        const labels = Array.from(document.querySelectorAll("p, span, div, label"))
            .filter(element => cleanText(element.textContent) === "Payment Handler");

        for (const label of labels) {
            const row = label.parentElement;
            if (!row) continue;

            const directCandidates = Array.from(row.children)
                .filter(element => element !== label)
                .map(element => cleanText(element.textContent))
                .filter(text => text && text !== "Payment Handler");

            for (const text of directCandidates) {
                if (isKnownHandler(text)) return cleanHandlerDisplay(text);
            }

            const nestedCandidates = Array.from(row.querySelectorAll("p, span"))
                .filter(element => element !== label)
                .map(element => cleanText(element.textContent))
                .filter(text => text && text !== "Payment Handler");

            for (const text of nestedCandidates) {
                if (isKnownHandler(text)) return cleanHandlerDisplay(text);
            }
        }

        return "";
    }

    function saveStoredHandler(handler) {
        try {
            localStorage.setItem(getHandlerStorageKey(), cleanHandlerDisplay(handler));
        } catch (error) {
            // Ignore storage errors.
        }
    }

    function getStoredHandler() {
        try {
            return localStorage.getItem(getHandlerStorageKey()) || "";
        } catch (error) {
            return "";
        }
    }

    function getHandlerStorageKey() {
        return `tm-viewlift-payment-handler:${location.pathname}`;
    }

    function cleanHandlerDisplay(value) {
        const normalized = normalizeHandler(value);

        if (normalized.includes("roku")) return "Roku";
        if (normalized.includes("stripe")) return "Stripe";
        if (normalized.includes("google") || normalized.includes("play store")) return "Google Play";
        if (normalized.includes("itunes")) return "iTunes";
        if (normalized.includes("apple") || normalized.includes("app store")) return "iTunes";
        if (normalized.includes("amazon")) return "Amazon";

        return cleanText(value);
    }

    function isKnownHandler(value) {
        const normalized = normalizeHandler(value);

        return GREEN_HANDLERS.some(handler => normalized.includes(handler)) ||
               RED_HANDLERS.some(handler => normalized.includes(handler));
    }

    function findClientNameHeader() {
        const pageHeader = document.querySelector("#header");

        if (pageHeader) {
            const h4 = pageHeader.querySelector("h4");
            if (h4) return h4;
        }

        return document.querySelector("h4");
    }

    async function captureRealTabSnapshot() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        const originalText = "📸";
        let restoreHiddenElements = null;
        let stream;

        try {
            updatePaymentHandlerBadge();

            button.disabled = true;
            button.style.opacity = "0.75";

            restoreHiddenElements = hideElementsForCapture();

            await nextFrame();
            await nextFrame();
            await delay(150);

            stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: "browser",
                    logicalSurface: true,
                    cursor: "never"
                },
                audio: false,
                preferCurrentTab: true
            });

            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            await video.play();

            await new Promise(resolve => {
                if (video.readyState >= 2) {
                    resolve();
                } else {
                    video.onloadedmetadata = resolve;
                }
            });

            await nextFrame();

            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const context = canvas.getContext("2d");
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const blob = await canvasToBlob(canvas);

            await navigator.clipboard.write([
                new ClipboardItem({
                    "image/png": blob
                })
            ]);

            stopStream(stream);
            stream = null;

            restoreHiddenElements();
            restoreHiddenElements = null;

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "✅";

            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);

        } catch (error) {
            if (stream) {
                stopStream(stream);
            }

            if (restoreHiddenElements) {
                restoreHiddenElements();
            }

            console.error("Real snapshot failed:", error);

            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "⚠️";

            alert(
                "Snapshot failed.\n\n" +
                "When prompted, choose the current browser tab, not the whole screen or window.\n\n" +
                "Check the browser console for details."
            );

            setTimeout(() => {
                button.textContent = originalText;
            }, 1200);
        }
    }

    function hideElementsForCapture() {
        const changedElements = [];

        for (const selector of HIDE_DURING_CAPTURE_SELECTORS) {
            document.querySelectorAll(selector).forEach(element => {
                if (changedElements.some(item => item.element === element)) {
                    return;
                }

                changedElements.push({
                    element,
                    visibility: element.style.visibility,
                    pointerEvents: element.style.pointerEvents
                });

                element.style.visibility = "hidden";
                element.style.pointerEvents = "none";
            });
        }

        return function restoreHiddenElements() {
            for (const item of changedElements) {
                item.element.style.visibility = item.visibility;
                item.element.style.pointerEvents = item.pointerEvents;
            }
        };
    }

    function handleRouteChange() {
        if (location.href === lastUrl) {
            return;
        }

        lastUrl = location.href;
        autoOpenAttempted = false;

        const badge = document.getElementById(BADGE_ID);
        if (badge) {
            badge.textContent = "";
            badge.classList.remove("tm-payment-handler-good", "tm-payment-handler-bad");
            badge.style.display = "none";
        }

        clearTimeout(routeTimer);

        routeTimer = setTimeout(() => {
            runStartupPasses();
        }, 250);
    }

    function installRouteWatcher() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function () {
            const result = originalPushState.apply(this, arguments);
            setTimeout(handleRouteChange, 0);
            return result;
        };

        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);
            setTimeout(handleRouteChange, 0);
            return result;
        };

        window.addEventListener("popstate", () => {
            setTimeout(handleRouteChange, 0);
        });

        window.addEventListener("hashchange", () => {
            setTimeout(handleRouteChange, 0);
        });

        setInterval(handleRouteChange, 400);
    }

    function runStartupPasses() {
        createOrMoveTools();

        setTimeout(createOrMoveTools, 250);
        setTimeout(createOrMoveTools, 600);
        setTimeout(createOrMoveTools, 1200);
        setTimeout(createOrMoveTools, 2200);
        setTimeout(createOrMoveTools, 3500);
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Could not create PNG blob."));
                }
            }, "image/png");
        });
    }

    function stopStream(stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    function nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeHandler(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function cleanText(value) {
        return String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function installObserver() {
        let timer = null;

        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                handleRouteChange();
                createOrMoveTools();
                updatePaymentHandlerBadge();
            }, 200);
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 300);
            return;
        }

        addStyles();
        installRouteWatcher();
        installObserver();
        runStartupPasses();

        setInterval(() => {
            handleRouteChange();
            createOrMoveTools();
            updatePaymentHandlerBadge();

            if (AUTO_OPEN_SUBSCRIPTION_PLANS) {
                autoOpenSubscriptionPlansIfNeeded();
            }
        }, 1000);
    }

    init();
})();
