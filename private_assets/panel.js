const queue = document.querySelector("#queue-fragment");
const refreshButton = document.querySelector("#refresh");
const sync = document.querySelector("#sync");

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
