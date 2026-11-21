const queue = document.querySelector("#queue-fragment");
const refreshButton = document.querySelector("#refresh");
const sync = document.querySelector("#sync");
const stripQueue = document.querySelector("#strip-queue");

const formatCount = (value) => Number(value).toLocaleString("ru-RU").replace(/ /g, " ");

if (queue && refreshButton && sync) {
  refreshButton.hidden = false;
  sync.textContent = "Обновление каждые 30 с";

  async function refreshQueue(manual = false) {
    if (refreshButton.disabled || (!manual && (document.hidden || queue.contains(document.activeElement)))) {
      return;
    }
    refreshButton.disabled = true;
    try {
      const response = await fetch(queue.dataset.refresh, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (response.type === "opaqueredirect" || response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        throw new Error("Queue refresh failed");
      }
      queue.innerHTML = await response.text();
      const fresh = queue.querySelector("[data-queue]");
      if (fresh && stripQueue) {
        stripQueue.textContent = formatCount(fresh.dataset.queue);
      }
      sync.textContent = manual ? "Очередь обновлена" : "Обновление каждые 30 с";
    } catch {
      sync.textContent = "Не удалось обновить очередь. Можно повторить.";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", () => refreshQueue(true));
  window.setInterval(refreshQueue, 30000);
}

// ---- Session timer ---------------------------------------------------------------------------

const sessionTime = document.querySelector("#session-time");
if (sessionTime) {
  const started = Date.parse(sessionTime.dataset.started);
  const tick = () => {
    if (Number.isNaN(started)) {
      return;
    }
    const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
    sessionTime.textContent = minutes < 60
      ? `· ${minutes} мин`
      : `· ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  };
  tick();
  window.setInterval(tick, 30000);
}

// ---- YouTube in one reusable tab -------------------------------------------------------------

const YOUTUBE_TAB = "nightscout-youtube";
const AUTOOPEN_KEY = "nightscout-autoopen";
const autoOpenBox = document.querySelector("#autoopen");

function readAutoOpen() {
  try {
    return window.localStorage.getItem(AUTOOPEN_KEY) !== "off";
  } catch {
    return true;
  }
}

if (autoOpenBox) {
  autoOpenBox.checked = readAutoOpen();
  autoOpenBox.addEventListener("change", () => {
    try {
      window.localStorage.setItem(AUTOOPEN_KEY, autoOpenBox.checked ? "on" : "off");
    } catch {
      // Private mode: the toggle still works for this page.
    }
  });
}

const autoOpen = () => (autoOpenBox ? autoOpenBox.checked : readAutoOpen());

// Opens (or re-navigates) the single YouTube tab. Must run inside a click or key press,
// otherwise the browser treats it as a pop-up and blocks it.
function openYouTube(url) {
  if (!url) {
    return;
  }
  const tab = window.open(url, YOUTUBE_TAB);
  try {
    if (tab) {
      tab.opener = null; // YouTube must not be able to script or redirect the panel.
    }
  } catch {
    // The tab already shows YouTube (another origin); it was detached when first opened.
  }
}

const detail = document.querySelector(".detail");
const youtubeLink = document.querySelector("#open-youtube");
if (youtubeLink) {
  youtubeLink.addEventListener("click", (event) => {
    event.preventDefault();
    openYouTube(youtubeLink.href);
  });
}

// ---- Decisions -------------------------------------------------------------------------------

const reviewForm = document.querySelector("#channel-review");
if (reviewForm) {
  reviewForm.addEventListener("submit", (event) => {
    if (reviewForm.dataset.busy) {
      event.preventDefault(); // one decision per card, even on a double press
      return;
    }
    reviewForm.dataset.busy = "1";
    reviewForm.classList.add("is-busy");
    const decision = event.submitter && event.submitter.value;
    if (decision && autoOpen() && detail && detail.dataset.nextYoutube) {
      openYouTube(detail.dataset.nextYoutube);
    }
  });
  // After choosing a category with the mouse, give the keys back to the page.
  reviewForm.querySelector("select")?.addEventListener("change", (event) => event.target.blur());
}

const undoForm = document.querySelector("#undo-form");
if (undoForm) {
  undoForm.addEventListener("submit", () => {
    if (autoOpen() && undoForm.dataset.youtube) {
      openYouTube(undoForm.dataset.youtube);
    }
  });
}

// ---- Hotkeys ---------------------------------------------------------------------------------

const help = document.querySelector("#hotkeys");
document.querySelector("#hotkeys-open")?.addEventListener("click", () => help?.showModal());

function typing(target) {
  return target instanceof Element
    && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  // Esc in a text field: leave the field so the hotkeys work again.
  if (event.code === "Escape" && typing(event.target)) {
    event.target.blur();
    return;
  }
  if (typing(event.target)) {
    return;
  }
  // `?` is Shift+/ on an English layout; the same physical key works on a Russian one.
  if (event.code === "Slash" || event.key === "?") {
    event.preventDefault();
    if (help) {
      help.open ? help.close() : help.showModal();
    }
    return;
  }
  if ((help && help.open) || event.repeat) {
    return;
  }

  // event.code is the physical key, so A/R/S/Z work in any keyboard layout (Ф/К/Ы/Я on Russian).
  if (["KeyA", "KeyR", "KeyS"].includes(event.code) && reviewForm && !reviewForm.dataset.busy) {
    const button = document.querySelector(`[form="channel-review"][data-code="${event.code}"]`);
    if (button && !button.disabled) {
      event.preventDefault();
      reviewForm.requestSubmit(button);
    }
    return;
  }
  if (event.code === "KeyZ" && undoForm) {
    event.preventDefault();
    undoForm.requestSubmit();
    return;
  }
  if (event.code === "Space") {
    // A focused button or link keeps its own Space behaviour.
    if (event.target instanceof Element && event.target.closest("button, a, summary, label")) {
      return;
    }
    if (youtubeLink) {
      event.preventDefault();
      openYouTube(youtubeLink.href);
      return;
    }
    const start = document.querySelector("#continue");
    if (start && !detail?.dataset.youtube) {
      event.preventDefault();
      window.location.assign(start.href);
    }
  }
});
