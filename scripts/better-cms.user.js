// ==UserScript==
// @name         Better Viewlift
// @namespace    https://github.com/Pepperoni-mc/viewlift-userscripts
// @version      3.6.0
// @author       Happy, Potato
// @description  Unified ViewLift toolkit for Freshdesk and CMS. Migration-compatible installer for previous Better CMS users.
// @match        https://viewlift.freshdesk.com/*
// @match        https://cms.viewlift.com/*
// @match        https://cms-gcp.viewlift.com/*
// @match        https://cms-qcp.viewlift.com/*
// @match        https://cms.monumentalsportsnetwork.com/*
// @updateURL    https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js
// @downloadURL  https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js
// @require      https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-viewlift.user.js?v=3.6.0
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// ==/UserScript==

// Better Viewlift is loaded by @require above. This file preserves automatic
// updates for users who originally installed Better CMS.
