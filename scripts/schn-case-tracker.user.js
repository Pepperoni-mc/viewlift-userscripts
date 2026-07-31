// ==UserScript==
// @name         SCHN+ Case Tracker
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Auto-tracks a case when status changes to Waiting on End User in Freshdesk
// @match        https://viewlift.freshdesk.com/a/tickets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      135.181.37.72
// ==/UserScript==

(function () {
  'use strict';

  const TRACKER_URL = 'http://135.181.37.72:3001/api/ticket-tracker/';
  const WAITING_STATUS_ID = 12;
  const COOLDOWN_MS = 60000;
  const PROGRESS_KEY = 'schnTrackerProgress';
  const DAILY_GOAL = 35;
  const recentlyTracked = new Map();

  GM_registerMenuCommand('Set API Key', () => {
    const key = prompt('Paste your SCHN+ API Key (from Ticket Tracker page):');
    if (key && key.trim()) {
      GM_setValue('api_key', key.trim());
      alert('API Key saved.');
    }
  });

  function getApiKey() { return GM_getValue('api_key', null); }

  function updateLocalProgress() {
    const date = new Date().toISOString().slice(0, 10);
    let current = null;
    try { current = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (_) {}
    const count = current && current.date === date ? Number(current.count) || 0 : 0;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ date, count: count + 1, goal: DAILY_GOAL }));
  }

  function showToast(message, color) {
    const old = document.getElementById('schn-tracker-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'schn-tracker-toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:' + (color || '#4f46e5') + ';color:white;padding:11px 18px;border-radius:10px;font:600 13px sans-serif;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function trackTicket(ticketId) {
    const now = Date.now();
    if (recentlyTracked.has(ticketId) && now - recentlyTracked.get(ticketId) < COOLDOWN_MS) return;
    recentlyTracked.set(ticketId, now);
    const apiKey = getApiKey();
    if (!apiKey) { showToast('No API Key set. Use Tampermonkey > Set API Key.', '#dc2626'); return; }
    GM_xmlhttpRequest({
      method: 'POST',
      url: TRACKER_URL,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      data: JSON.stringify({ ticket_url: 'https://viewlift.freshdesk.com/a/tickets/' + ticketId }),
      onload: response => {
        if (response.status === 200 || response.status === 201) {
          updateLocalProgress();
          showToast('Ticket #' + ticketId + ' tracked', '#16a34a');
        } else {
          showToast('Tracker error (' + response.status + ')', '#d97706');
        }
      },
      onerror: () => showToast('Could not reach SCHN+ tracker', '#dc2626')
    });
  }

  function checkBody(body, url) {
    if (!/tickets/i.test(url)) return;
    const match = url.match(/\/tickets\/(\d+)/);
    if (!match) return;
    if (/execute_scenario/i.test(url)) { trackTicket(match[1]); return; }
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : (body || {});
      const status = data.status ?? data.ticket?.status ?? data.properties?.status;
      if (Number(status) === WAITING_STATUS_ID) trackTicket(match[1]);
    } catch (_) {}
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [input, options] = args;
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = (options?.method || 'GET').toUpperCase();
    if (['PUT', 'PATCH', 'POST'].includes(method)) checkBody(options?.body, url);
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._schnMethod = String(method || '').toUpperCase();
    this._schnUrl = String(url || '');
    return originalOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (['PUT', 'PATCH', 'POST'].includes(this._schnMethod)) checkBody(body, this._schnUrl);
    return originalSend.apply(this, arguments);
  };

  document.addEventListener('click', event => {
    const element = event.target.closest?.('button, [role="button"], li, a');
    if (!element || !/^execute$/i.test(element.textContent.trim())) return;
    const match = location.href.match(/\/tickets\/(\d+)/);
    if (match) setTimeout(() => trackTicket(match[1]), 500);
  }, true);
})();
