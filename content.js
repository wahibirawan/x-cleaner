// content.js — X Cleaner worker (Delete, Undo Repost, Unlike) + smart scroll + error notifications

(() => {
  if (window.__XAM_WORKER__) return; // guard

  const CFG = {
    // Base delays (will be randomized)
    PAUSE_BETWEEN_STEPS: 500,
    PAUSE_BETWEEN_TWEETS: 800,
    SCROLL_PADDING: 120,          // px above tweet when scrolling into view
    MAX_CONSECUTIVE_FAILS: 3,     // pause after this many failures in a row
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
    // Use Set to deduplicate — broader selectors can match the same elements
    const set = new Set();
    for (const sel of TWEET_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => set.add(el));
    }
    return Array.from(set)
      .filter(a => a.offsetParent !== null)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  };

  const getStatusId = (article) => {
    const a = article.querySelector('a[href*="/status/"]');
    const m = a?.getAttribute('href')?.match(/status\/(\d+)/);
    return m ? m[1] : null;
  };

  // --- Smart scroll: align to a specific tweet ---
  function scrollToTweet(article) {
    if (!article || !article.isConnected) return;
    const rect = article.getBoundingClientRect();
    // Only scroll if the tweet is not already mostly visible
    if (rect.top < 0 || rect.top > window.innerHeight * 0.6) {
      window.scrollTo({
        top: window.scrollY + rect.top - CFG.SCROLL_PADDING,
        behavior: 'smooth'
      });
    }
  }

  // Scroll down gently to load more tweets
  function scrollForMore() {
    // Scroll just enough to trigger X's infinite load — one viewport height
    const scrollAmount = Math.min(window.innerHeight * 0.8, 900);
    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
  }

  // --- In-page notification banner ---
  const NOTIFICATION_ID = '__xam-notification__';

  function getOrCreateNotification() {
    let el = document.getElementById(NOTIFICATION_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = NOTIFICATION_ID;
    el.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
      background: #1a1a2e; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 0; transform: translateY(-100%); transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
    `;
    el.innerHTML = `
      <div style="max-width: 560px; margin: 0 auto; padding: 16px 20px;">
        <div style="display:flex; align-items:flex-start; gap:12px;">
          <div style="flex-shrink:0; width:28px; height:28px; border-radius:50%;
                      background:#ff4757; display:flex; align-items:center; justify-content:center;
                      font-size:16px; margin-top:2px;">⚠</div>
          <div style="flex:1; min-width:0;">
            <div id="__xam-notif-title__" style="font-weight:600; font-size:15px; margin-bottom:4px;"></div>
            <div id="__xam-notif-body__" style="font-size:13px; color:#b0b0c0; line-height:1.5;"></div>
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:14px; justify-content:flex-end;">
          <button id="__xam-notif-stop__" style="
            background:transparent; border:1px solid rgba(255,255,255,0.2); color:#fff;
            padding:8px 18px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer;
          ">Berhenti</button>
          <button id="__xam-notif-resume__" style="
            background:#007AFF; border:none; color:#fff;
            padding:8px 18px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
          ">Coba Lagi</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function showNotification(title, body) {
    return new Promise((resolve) => {
      const el = getOrCreateNotification();
      el.querySelector('#__xam-notif-title__').textContent = title;
      el.querySelector('#__xam-notif-body__').textContent = body;

      // Slide in
      requestAnimationFrame(() => {
        el.style.transform = 'translateY(0)';
      });

      const stopBtn = el.querySelector('#__xam-notif-stop__');
      const resumeBtn = el.querySelector('#__xam-notif-resume__');

      function cleanup(action) {
        el.style.transform = 'translateY(-100%)';
        stopBtn.removeEventListener('click', onStop);
        resumeBtn.removeEventListener('click', onResume);
        resolve(action); // 'stop' or 'resume'
      }

      function onStop() { cleanup('stop'); }
      function onResume() { cleanup('resume'); }

      stopBtn.addEventListener('click', onStop);
      resumeBtn.addEventListener('click', onResume);
    });
  }

  function hideNotification() {
    const el = document.getElementById(NOTIFICATION_ID);
    if (el) el.style.transform = 'translateY(-100%)';
  }

  // --- User-friendly error messages ---
  const ERROR_MESSAGES = {
    deleteMenu: {
      title: 'Tidak bisa menghapus post',
      body: 'Tombol hapus tidak ditemukan. Kemungkinan ini bukan post milikmu, atau tampilan X sedang berubah.',
    },
    deleteConfirm: {
      title: 'Gagal mengonfirmasi penghapusan',
      body: 'Dialog konfirmasi tidak muncul. Coba lagi atau tunggu beberapa saat — X mungkin sedang lambat.',
    },
    undoRepost: {
      title: 'Gagal membatalkan repost',
      body: 'Tombol konfirmasi tidak muncul. Mungkin repost ini sudah dibatalkan sebelumnya.',
    },
    rateLimited: {
      title: 'Sepertinya ada batasan dari X',
      body: 'Beberapa aksi gagal berturut-turut. X mungkin membatasi aktivitasmu. Tunggu beberapa menit sebelum melanjutkan.',
    },
    unlike: {
      title: 'Gagal unlike post',
      body: 'Tombol unlike tidak ditemukan. Mungkin post ini sudah di-unlike atau sudah dihapus.',
    },
    generic: {
      title: 'Terjadi kesalahan',
      body: 'Sesuatu tidak berjalan sesuai rencana. Coba lagi, atau hentikan dan mulai ulang nanti.',
    },
  };

  // --- Delete Post helpers ---
  async function openMoreMenu(article) {
    let btn = findWithin(article, MORE_BUTTON_SELECTORS)
      || findWithin(article.querySelector('[role="group"]') || article.closest('[data-testid="tweet"]') || article, MORE_BUTTON_SELECTORS);

    if (!btn) return { ok: false, error: null }; // no button = skip silently (not our tweet)
    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return { ok: true, error: null };
  }

  async function clickDeleteInMenu() {
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] span, div[role="dialog"] span, div[role="menu"] div'));
    const target = items.find(el => DELETE_LABELS.some(lbl => (el.textContent || '').trim() === lbl));

    if (!target) return { ok: false, error: 'deleteMenu' };
    (target.closest('[role="menuitem"]') || target).click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return { ok: true, error: null };
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

    if (!btn) return { ok: false, error: 'deleteConfirm' };
    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return { ok: true, error: null };
  }

  async function deleteOne(article) {
    const menuResult = await openMoreMenu(article);
    if (!menuResult.ok) return menuResult;

    const delResult = await clickDeleteInMenu();
    if (!delResult.ok) {
      document.body.click();
      await sleep(200);
      return delResult;
    }

    const confResult = await confirmDelete();
    if (!confResult.ok) {
      document.body.click();
      await sleep(200);
      return confResult;
    }

    return { ok: true, error: null };
  }

  // --- Undo Repost ---
  async function undoOneRepost(article) {
    const btn = article.querySelector(UNRETWEET_BTN);
    if (!btn) return { ok: false, error: null }; // skip silently

    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);

    const confirm = document.querySelector(UNRETWEET_CONFIRM);
    if (!confirm) return { ok: false, error: 'undoRepost' };

    confirm.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return { ok: true, error: null };
  }

  // --- Unlike ---
  async function unlikeOne(article) {
    const btn = article.querySelector(UNLIKE_BTN);
    if (!btn) return { ok: false, error: 'unlike' };

    btn.click();
    await sleep(CFG.PAUSE_BETWEEN_STEPS);
    return { ok: true, error: null };
  }

  function sendProgress(payload) { chrome.runtime.sendMessage({ type: 'xam-progress', payload }).catch(() => { }); }
  function sendStopped() { chrome.runtime.sendMessage({ type: 'xam-stopped' }).catch(() => { }); }
  function sendPaused(reason) { chrome.runtime.sendMessage({ type: 'xam-paused', payload: { reason } }).catch(() => { }); }

  const worker = {
    running: false,
    stopSignal: false,
    total: 0,
    inBatch: 0,
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

      // Clear seen-sets from previous runs
      this.seenDelete.clear();
      this.seenUndo.clear();
      this.seenUnlike.clear();

      // Batch counter persists outside the inner loop until full
      let inBatch = 0;
      this.inBatch = 0;
      let noNewContentCount = 0;
      let consecutiveFails = 0;
      let lastErrorType = null;

      try {
        while (this.running && !this.stopSignal) {
          this.inBatch = inBatch;
          sendProgress({ total: this.total, inBatch, batchSize, status: inBatch === 0 ? 'Starting batch...' : 'Scanning...' });

          const list = queryAllTweets();

          // If no tweets found, scroll gently and retry
          if (!list.length) {
            sendProgress({ total: this.total, inBatch, batchSize, status: 'No items → scrolling…' });
            scrollForMore();
            await sleep(1500);

            // End detection even when no tweets are found at all
            noNewContentCount++;
            if (noNewContentCount >= 5) {
              sendProgress({ total: this.total, inBatch, batchSize, status: 'No more items found.' });
              break;
            }
            continue;
          }

          // Process visible tweets one by one
          for (const article of list) {
            if (!this.running || this.stopSignal) break;
            if (inBatch >= batchSize) break; // Batch filled

            const rect = article.getBoundingClientRect();
            if (rect.bottom < 0) continue;
            if (rect.top > window.innerHeight) break;

            const id = getStatusId(article);
            let result = { ok: false, error: null };

            // --- Scroll to align this tweet before processing ---
            scrollToTweet(article);
            await sleep(300); // Let scroll settle

            if (mode === 'unlike') {
              if (id && this.seenUnlike.has(id)) continue;

              const hasUn = article.querySelector(UNLIKE_BTN);
              if (!hasUn) {
                if (id) this.seenUnlike.add(id);
                continue;
              }

              sendProgress({ total: this.total, inBatch, batchSize, status: 'Unliking…' });
              result = await unlikeOne(article);
              if (id) this.seenUnlike.add(id);

            } else { // mode === 'delete'
              // Check if this is a repost we should undo first
              const hasUnRt = alsoUndoReposts && article.querySelector(UNRETWEET_BTN);

              if (hasUnRt) {
                // It's a repost — undo it (don't try to delete, it's not our tweet)
                if (id && this.seenUndo.has(id)) continue;
                sendProgress({ total: this.total, inBatch, batchSize, status: 'Undoing…' });
                result = await undoOneRepost(article);
                if (id) this.seenUndo.add(id);
              } else {
                // It's our own tweet — delete it
                if (id && this.seenDelete.has(id)) continue;

                sendProgress({ total: this.total, inBatch, batchSize, status: 'Deleting…' });
                result = await deleteOne(article);
                if (id) this.seenDelete.add(id);
              }
            }

            if (result.ok) {
              inBatch++;
              this.total++;
              consecutiveFails = 0; // Reset on success
              lastErrorType = null;
              sendProgress({ total: this.total, inBatch, batchSize, status: 'Success.' });
              await sleep(CFG.PAUSE_BETWEEN_TWEETS);
            } else if (result.error) {
              // Got a real error (not just "skip")
              consecutiveFails++;
              lastErrorType = result.error;

              sendProgress({ total: this.total, inBatch, batchSize, status: 'Error detected…' });

              // Too many failures in a row → pause and ask user
              if (consecutiveFails >= CFG.MAX_CONSECUTIVE_FAILS) {
                const msg = ERROR_MESSAGES.rateLimited;
                sendPaused(msg.title);
                sendProgress({ total: this.total, inBatch, batchSize, status: 'Dijeda — menunggu keputusanmu…' });

                const action = await showNotification(msg.title, msg.body);

                if (action === 'stop' || !this.running) {
                  this.stopSignal = true;
                  break;
                }

                // User chose to resume — reset counter and continue
                consecutiveFails = 0;
                lastErrorType = null;
                hideNotification();
                sendProgress({ total: this.total, inBatch, batchSize, status: 'Melanjutkan…' });
                await sleep(1000);
              } else {
                // Single failure — show brief error, keep going
                const msg = ERROR_MESSAGES[result.error] || ERROR_MESSAGES.generic;
                sendProgress({ total: this.total, inBatch, batchSize, status: msg.title });
                await sleep(CFG.PAUSE_BETWEEN_TWEETS);
              }
            }
            // result.error === null && !result.ok → silent skip, do nothing
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
            noNewContentCount = 0;
          } else {
            // Batch not full yet — scroll to load more tweets
            const prevHeight = document.body.scrollHeight;
            sendProgress({ total: this.total, inBatch, batchSize, status: 'Fetching more...' });

            // Find the last visible tweet and scroll just past it
            const lastTweet = list[list.length - 1];
            if (lastTweet && lastTweet.isConnected) {
              lastTweet.scrollIntoView({ behavior: 'smooth', block: 'start' });
              await sleep(400);
            }
            scrollForMore();
            await sleep(1200);

            // Detect end-of-page to avoid infinite scrolling
            if (document.body.scrollHeight === prevHeight) {
              noNewContentCount++;
              if (noNewContentCount >= 3) {
                sendProgress({ total: this.total, inBatch, batchSize, status: 'No more items found.' });
                break;
              }
            } else {
              noNewContentCount = 0;
            }
          }
        }
      } finally {
        this.running = false;
        this.stopSignal = false;
        this.inBatch = 0;
        this.startedAt = null;
        this.current = { mode: null, alsoUndoReposts: false, batchSize: 0 };
        hideNotification();
        sendStopped();
      }
    },

    stop() { this.stopSignal = true; }
  };

  // message bridge: start/stop/status
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'xam-start') {
      if (!worker.running) worker.run(msg.payload || {}).catch(console.error);
    } else if (msg?.type === 'xam-stop') {
      worker.stop();
    } else if (msg?.type === 'xam-get-status') {
      sendResponse({
        ok: true,
        running: worker.running,
        startedAt: worker.startedAt,
        total: worker.total,
        inBatch: worker.inBatch,
        current: worker.current
      });
      return true; // keep channel open
    }
  });

  window.__XAM_WORKER__ = worker;
})();
