// content.js — X Cleaner worker (Delete, Undo Repost optional, Unlike) + status rehydrate support

(() => {
  if (window.__XAM_WORKER__) return; // guard

  const CFG = {
    // Base delays (will be randomized)
    PAUSE_BETWEEN_STEPS: 500,
    PAUSE_BETWEEN_TWEETS: 800,
    SCROLL_CHUNK: 1800
  };

  const DELETE_LABELS = ["Delete", "Hapus", "Eliminar", "Löschen", "Supprimer"];
  const CONFIRM_TESTIDS = ["confirmationSheetConfirm", "ConfirmationDialog-Confirm", "confirmationSheetConfirmDialog"];

  // More robust selectors
  const MORE_BUTTON_SELECTORS = [
    '[data-testid="caret"]',
    '[aria-label="More"]',
    'button[aria-label="More"]',
    '[data-testid="overflow"]',
    '[aria-haspopup="menu"][role="button"] svg[aria-hidden="true"]'
  ];

  const TWEET_SELECTORS = [
    'article[role="article"][data-testid*="tweet"]',
    'article[role="article"]'
  ];

  // Official buttons/selectors
  const UNRETWEET_BTN = '[data-testid="unretweet"]';
  const UNRETWEET_CONFIRM = '[data-testid="unretweetConfirm"]';
  const UNLIKE_BTN = '[data-testid="unlike"]'; // when tweet is liked

  // Randomized sleep helper
  const sleep = (ms) => {
    // Add up to 50% jitter
    const jitter = Math.floor(Math.random() * (ms * 0.5));
    return new Promise(r => setTimeout(r, ms + jitter));
  };

  const findWithin = (root, sels) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const queryAllTweets = () => {
    const list = TWEET_SELECTORS.flatMap(sel => Array.from(document.querySelectorAll(sel)));
    // Filter visible and sort by position
    return list.filter(a => a.offsetParent !== null)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  };

  const getStatusId = (article) => {
    const a = article.querySelector('a[href*="/status/"]');
    const m = a?.getAttribute('href')?.match(/status\/(\d+)/);
    return m ? m[1] : null;
  };

  // --- Delete Post helpers
  async function openMoreMenu(article) {
    let btn = findWithin(article, MORE_BUTTON_SELECTORS)
      || findWithin(article.querySelector('[role="group"]') || article.closest('[data-testid="tweet"]') || article, MORE_BUTTON_SELECTORS);

    if (!btn) return false;
    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return true;
  }

  async function clickDeleteInMenu() {
    // Try to find by data-testid first (if X adds one for delete item)
    // Currently relying on text is still the most common way for the menu items as they lack specific testids often
    // But we can look for "Delete" specifically in red color or specific icon if we want to be super fancy, 
    // but text fallback is still needed.
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] span, div[role="dialog"] span, div[role="menu"] div'));
    const target = items.find(el => DELETE_LABELS.some(lbl => (el.textContent || '').trim() === lbl));

    if (!target) return false;
    (target.closest('[role="menuitem"]') || target).click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return true;
  }

  async function confirmDelete() {
    let btn = null;
    for (const id of CONFIRM_TESTIDS) {
      btn = document.querySelector(`[data-testid="${id}"]`);
      if (btn) break;
    }

    if (!btn) {
      // Fallback to text search in dialogs
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'));
      const spans = dialogs.flatMap(d => Array.from(d.querySelectorAll('span, div, button')));
      const byText = spans.find(el => DELETE_LABELS.some(lbl => (el.textContent || '').trim() === lbl));
      btn = byText?.closest('button') || byText;
    }

    if (!btn) return false;
    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return true;
  }

  async function deleteOne(article) {
    if (!(await openMoreMenu(article))) return false;
    if (!(await clickDeleteInMenu())) {
      // Close menu if failed
      document.body.click();
      await sleep(200);
      return false;
    }
    if (!(await confirmDelete())) {
      document.body.click();
      await sleep(200);
      return false;
    }
    return true;
  }

  // --- Undo Repost
  async function undoOneRepost(article) {
    const btn = article.querySelector(UNRETWEET_BTN);
    if (!btn) return false;

    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);

    const confirm = document.querySelector(UNRETWEET_CONFIRM);
    if (!confirm) return false;

    confirm.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return true;
  }

  // --- Unlike
  async function unlikeOne(article) {
    const btn = article.querySelector(UNLIKE_BTN);
    if (!btn) return false;

    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return true;
  }

  function sendProgress(payload) { chrome.runtime.sendMessage({ type: 'xam-progress', payload }); }
  function sendStopped() { chrome.runtime.sendMessage({ type: 'xam-stopped' }); }

  const worker = {
    running: false,
    stopSignal: false,
    total: 0,
    seenDelete: new Set(),
    seenUndo: new Set(),
    seenUnlike: new Set(),
    startedAt: null,
    current: { mode: null, alsoUndoReposts: false, batchSize: 0 },

    async run({ mode, alsoUndoReposts = false, batchSize = 5, pauseMs = 3000 }) {
      this.running = true;
      this.stopSignal = false;
      this.startedAt = Date.now();
      this.current = { mode, alsoUndoReposts, batchSize };

      // Batch counter persists outside the inner loop until full
      let inBatch = 0;

      try {
        while (this.running && !this.stopSignal) {
          sendProgress({ total: this.total, inBatch, batchSize, status: inBatch === 0 ? 'Starting batch...' : 'Scanning...' });

          const list = queryAllTweets();

          // If no tweets found, just scroll and retry
          if (!list.length) {
            sendProgress({ total: this.total, inBatch, batchSize, status: 'No items → scrolling…' });
            window.scrollBy(0, CFG.SCROLL_CHUNK);
            await sleep(1500);
            continue;
          }

          // Process visible tweets
          for (const article of list) {
            if (!this.running || this.stopSignal) break;
            if (inBatch >= batchSize) break; // Batch filled

            const rect = article.getBoundingClientRect();
            if (rect.bottom < 0) continue;
            if (rect.top > window.innerHeight) break;

            const id = getStatusId(article);
            let ok = false;

            if (mode === 'unlike') {
              if (id && this.seenUnlike.has(id)) continue;

              const hasUn = article.querySelector(UNLIKE_BTN);
              if (!hasUn) {
                if (id) this.seenUnlike.add(id);
                continue;
              }

              sendProgress({ total: this.total, inBatch, batchSize, status: 'Unliking…' });
              ok = await unlikeOne(article);
              if (id) this.seenUnlike.add(id);

            } else { // mode === 'delete'
              if (alsoUndoReposts) {
                const hasUnRt = article.querySelector(UNRETWEET_BTN);
                if (hasUnRt) {
                  if (!(id && this.seenUndo.has(id))) {
                    sendProgress({ total: this.total, inBatch, batchSize, status: 'Undoing…' });
                    ok = await undoOneRepost(article);
                    if (id) this.seenUndo.add(id);
                  }
                }
              }

              if (!ok) {
                if (id && this.seenDelete.has(id)) continue;

                sendProgress({ total: this.total, inBatch, batchSize, status: 'Deleting…' });
                ok = await deleteOne(article);
                if (id) this.seenDelete.add(id);
              }
            }

            if (ok) {
              inBatch++;
              this.total++;
              sendProgress({ total: this.total, inBatch, batchSize, status: 'Done ✔' });
              await sleep(CFG.PAUSE_BETWEEN_TWEETS);
            }
          }

          // Check if batch is full
          if (inBatch >= batchSize) {
            // Cooldown Logic
            const cool = Number(pauseMs || 0);
            const start = Date.now();
            while ((Date.now() - start < cool) && this.running && !this.stopSignal) {
              const remaining = Math.max(0, Math.ceil((cool - (Date.now() - start)) / 1000));
              sendProgress({ total: this.total, inBatch, batchSize, status: `Cooling ${remaining}s…` });
              await sleep(250);
            }
            // Reset batch after cooldown
            inBatch = 0;
          } else {
            // Batch not full yet, scroll to find more
            sendProgress({ total: this.total, inBatch, batchSize, status: 'Fetching more...' });
            window.scrollBy(0, CFG.SCROLL_CHUNK);
            await sleep(1500);
          }
        }
      } finally {
        this.running = false;
        this.stopSignal = false;
        this.startedAt = null;
        this.current = { mode: null, alsoUndoReposts: false, batchSize: 0 };
        sendStopped();
      }
    },

    stop() { this.stopSignal = true; }
  };

  // message bridge: start/stop/status
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'xam-start') {
      if (!worker.running) worker.run(msg.payload || {});
    }
    if (msg?.type === 'xam-stop') {
      worker.stop();
    }
    if (msg?.type === 'xam-get-status') {
      sendResponse({
        ok: true,
        running: worker.running,
        startedAt: worker.startedAt,
        total: worker.total,
        current: worker.current
      });
    }
    // no async response needed
  });

  window.__XAM_WORKER__ = worker;
})();
