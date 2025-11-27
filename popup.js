// popup.js — X Cleaner (iOS Style)

let mode = 'delete';
let running = false;
let currentTabId = null;
let startTime = null;
let timerId = null;

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
  if (reset) elapsedEl.textContent = '00:00';
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

function sendMsg(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
    });
  });
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
  if (running) {
    mainBtn.classList.add('running');
    mainBtn.textContent = 'Stop Cleaning';
  } else {
    mainBtn.classList.remove('running');
    mainBtn.textContent = 'Start Cleaning';
    stopTimer();
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
document.addEventListener('DOMContentLoaded', hydrateUI);

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
      batchEl.textContent = `0/${size}`;

      if (status.startedAt) startTimer(status.startedAt);
      else startTimer(Date.now());
    } else {
      setRunningState(false);
    }
  } catch { }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'xam-progress') {
    const { total, inBatch, batchSize } = msg.payload || {};
    if (typeof total === 'number') totalEl.textContent = total;
    if (typeof inBatch === 'number') {
      const size = typeof batchSize === 'number' ? batchSize : Number(batchSizeEl.value || 5);
      batchEl.textContent = `${inBatch}/${size}`;
    }
  }
  if (msg?.type === 'xam-stopped') {
    setRunningState(false);
    batchEl.textContent = `0/${batchSizeEl.value || 5}`;
  }
});

async function startRun() {
  currentTabId = await getActiveTabId();
  if (!currentTabId) return;

  await chrome.scripting.executeScript({ target: { tabId: currentTabId }, files: ['content.js'] });

  await sendMsg(currentTabId, {
    type: 'xam-start',
    payload: {
      mode,
      alsoUndoReposts: (mode === 'delete') ? !!toggleUndo.checked : false,
      batchSize: Number(batchSizeEl.value || 5),
      pauseMs: Number(pauseMsEl.value || 3000),
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
