// popup.js — X Cleaner (iOS Style — Compact)

let mode = 'delete';
let running = false;
let currentTabId = null;
let startTime = null;
let timerId = null;
const X_URL_PATTERN = /^https:\/\/(x\.com|twitter\.com)/;

// DOM Elements
const $ = (s) => document.querySelector(s);
const totalEl = $('#total');
const batchEl = $('#batch');
const elapsedEl = $('#elapsed');
const batchSizeEl = $('#batchSize');
const pauseMsEl = $('#pauseMs');
const mainBtn = $('#mainBtn');
const undoToggleRow = $('#undoToggleRow');
const undoDivider = $('#undoDivider');
const toggleUndo = $('#toggleUndo');
const segments = document.querySelectorAll('.segment');
const guideBtn = $('#guideBtn');
const guideModal = $('#guideModal');
const closeGuide = $('#closeGuide');
const activityBar = $('#activityBar');
const statusText = $('#statusText');

// Guide Modal
guideBtn.addEventListener('click', () => guideModal.classList.remove('hidden'));
closeGuide.addEventListener('click', () => guideModal.classList.add('hidden'));

// --- Utils ---
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const sc = String(s % 60).padStart(2, '0');
  return `${m}:${sc}`;
}

function startTimer(from = null) {
  startTime = from || Date.now();
  elapsedEl.textContent = '00:00';
  clearInterval(timerId);
  timerId = setInterval(() => {
    elapsedEl.textContent = fmt(Date.now() - startTime);
  }, 500);
}

function stopTimer(reset = true) {
  clearInterval(timerId);
  timerId = null;
  if (reset) {
    elapsedEl.textContent = '00:00';
    startTime = null;
  }
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

function sendMsg(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('sendMsg error:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(resp);
      }
    });
  });
}

// --- Activity Bar ---
function setActivityState(state, text) {
  // state: 'idle' | 'running' | 'paused' | 'error'
  activityBar.classList.remove('running', 'paused', 'error');
  if (state !== 'idle') activityBar.classList.add(state);
  statusText.textContent = text;
}

// --- UI Logic ---
function updateModeUI(newMode) {
  mode = newMode;
  segments.forEach(s => {
    if (s.dataset.mode === mode) s.classList.add('active');
    else s.classList.remove('active');
  });

  if (mode === 'delete') {
    undoToggleRow.style.display = 'flex';
    undoDivider.style.display = 'block';
  } else {
    undoToggleRow.style.display = 'none';
    undoDivider.style.display = 'none';
  }
}

function setRunningState(isRunning) {
  running = isRunning;
  // Disable/enable settings while running
  batchSizeEl.disabled = isRunning;
  pauseMsEl.disabled = isRunning;
  toggleUndo.disabled = isRunning;
  if (running) {
    mainBtn.classList.remove('paused');
    mainBtn.classList.add('running');
    mainBtn.textContent = 'Stop Cleaning';
    setActivityState('running', 'Starting…');
  } else {
    mainBtn.classList.remove('running', 'paused');
    mainBtn.textContent = 'Start Cleaning';
    stopTimer();
    setActivityState('idle', 'Ready');
  }
}

// --- Listeners ---
segments.forEach(seg => {
  seg.addEventListener('click', () => {
    if (running) return;
    updateModeUI(seg.dataset.mode);
  });
});

mainBtn.addEventListener('click', () => {
  if (!running) startRun();
  else stopRun();
});

// --- Init ---
hydrateUI();

async function hydrateUI() {
  currentTabId = await getActiveTabId();
  if (!currentTabId) return;

  try {
    const status = await sendMsg(currentTabId, { type: 'xam-get-status' });
    if (status?.ok && status.running) {
      setRunningState(true);
      const cur = status.current || {};
      updateModeUI(cur.mode || 'delete');
      if (cur.mode === 'delete') toggleUndo.checked = !!cur.alsoUndoReposts;

      if (typeof status.total === 'number') totalEl.textContent = status.total;
      const size = cur.batchSize ?? Number(batchSizeEl.value || 5);
      const currentInBatch = typeof status.inBatch === 'number' ? status.inBatch : 0;
      batchEl.textContent = `${currentInBatch}/${size}`;

      if (status.startedAt) startTimer(status.startedAt);
      else startTimer(Date.now());
    } else {
      setRunningState(false);
    }
  } catch { }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'xam-progress') {
    const { total, inBatch, batchSize, status } = msg.payload || {};
    if (typeof total === 'number') totalEl.textContent = total;
    if (typeof inBatch === 'number') {
      const size = typeof batchSize === 'number' ? batchSize : Number(batchSizeEl.value || 5);
      batchEl.textContent = `${inBatch}/${size}`;
    }
    // Update activity bar with live status
    if (status && running) {
      setActivityState('running', status);
    }
  }
  if (msg?.type === 'xam-paused') {
    const reason = msg.payload?.reason || 'Dijeda';
    mainBtn.textContent = 'Dijeda — cek tab X';
    mainBtn.classList.remove('running');
    mainBtn.classList.add('paused');
    setActivityState('paused', reason);
  }
  if (msg?.type === 'xam-stopped') {
    setRunningState(false);
    batchEl.textContent = `0/${batchSizeEl.value || 5}`;
  }
});

function clampInput(el, min, max, fallback) {
  let v = Number(el.value);
  if (isNaN(v) || v < min) v = min;
  if (v > max) v = max;
  el.value = v;
  return v;
}

async function startRun() {
  currentTabId = await getActiveTabId();
  if (!currentTabId) return;

  // Validate that we're on X/Twitter
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !X_URL_PATTERN.test(tab.url)) {
    mainBtn.textContent = 'Open x.com first';
    setTimeout(() => { mainBtn.textContent = 'Start Cleaning'; }, 2000);
    return;
  }

  // Validate inputs
  const batchSize = clampInput(batchSizeEl, 1, 50, 5);
  const pauseMs = clampInput(pauseMsEl, 500, 60000, 3000);

  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ['content.js'] });
  } catch (err) {
    console.error('Failed to inject content script:', err);
    mainBtn.textContent = 'Inject failed';
    setTimeout(() => { mainBtn.textContent = 'Start Cleaning'; }, 2000);
    return;
  }

  // Small delay to ensure content script listener is registered
  await new Promise(r => setTimeout(r, 150));

  await sendMsg(currentTabId, {
    type: 'xam-start',
    payload: {
      mode,
      alsoUndoReposts: (mode === 'delete') ? !!toggleUndo.checked : false,
      batchSize,
      pauseMs,
    }
  });

  setRunningState(true);
  startTimer();
}

async function stopRun() {
  if (!currentTabId) currentTabId = await getActiveTabId();
  if (!currentTabId) return;

  setRunningState(false);
  batchEl.textContent = `0/${batchSizeEl.value || 5}`;
  await sendMsg(currentTabId, { type: 'xam-stop' });
}

updateModeUI('delete');
