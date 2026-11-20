(() => {
  "use strict";

  // The odometer combines scroll distance and the distance driven on the map.
  const odo = document.querySelector(".odo");
  const odoValue = document.getElementById("odo-value");
  if (odo && odoValue) {
    let roverDistance = 0;
    let odoQueued = false;

    function renderOdo() {
      odoQueued = false;
      const km = window.scrollY * 0.002 + roverDistance * 0.004;
      odoValue.textContent = km.toFixed(1).padStart(6, "0").replace(".", ",");
      odo.style.setProperty("--odo-shift", `${-window.scrollY * 0.6}px`);
    }

    function queueOdo() {
      if (!odoQueued) {
        odoQueued = true;
        requestAnimationFrame(renderOdo);
      }
    }

    window.addEventListener("scroll", queueOdo, { passive: true });
    document.addEventListener("scene:distance", (event) => {
      roverDistance += event.detail;
      queueOdo();
    });
    renderOdo();
  }

  const copy = document.getElementById("copy-mail");
  const copyStatus = document.getElementById("copy-status");
  if (copy && copyStatus && navigator.clipboard) {
    copy.hidden = false;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.mail);
        copyStatus.textContent = "Скопировано";
      } catch {
        copyStatus.textContent = "Не получилось, скопируйте вручную";
      }
      window.setTimeout(() => { copyStatus.textContent = ""; }, 2500);
    });
  }
  // Case screenshots open full size in a viewer; without JS the link opens the image itself.
  const shots = document.querySelectorAll("a.shot-frame");
  if (shots.length && typeof HTMLDialogElement === "function") {
    const viewer = document.createElement("dialog");
    viewer.className = "viewer";
    viewer.setAttribute("aria-label", "Скриншот");
    viewer.innerHTML = '<button class="viewer-close" type="button" aria-label="Закрыть">×</button>' +
      '<div class="viewer-stage"><img alt=""></div><p class="viewer-caption"></p>' +
      '<p class="viewer-hint">Нажмите на картинку, чтобы увеличить</p>';
    document.body.append(viewer);
    const stage = viewer.querySelector(".viewer-stage");
    const image = viewer.querySelector("img");
    const caption = viewer.querySelector(".viewer-caption");
    // The hint shows only when the picture is shrunk to fit the screen.
    const markShrunk = () => viewer.classList.toggle("is-shrunk", image.naturalWidth > image.clientWidth + 1);
    image.addEventListener("load", markShrunk);
    let opener = null;

    shots.forEach((link) => link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const thumb = link.querySelector("img");
      opener = link;
      image.src = link.href;
      image.alt = thumb.alt;
      caption.textContent = link.closest("figure")?.querySelector("figcaption")?.textContent || "";
      viewer.classList.remove("is-zoomed");
      viewer.showModal();
      document.documentElement.classList.add("has-viewer");
    }));

    // Click the picture to see it at its own size (scroll to move around); click again to fit.
    image.addEventListener("click", (event) => {
      event.stopPropagation();
      const fits = image.naturalWidth > image.clientWidth + 1 || image.naturalHeight > image.clientHeight + 1;
      if (!fits && !viewer.classList.contains("is-zoomed")) return;
      const rect = image.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      viewer.classList.toggle("is-zoomed");
      if (!viewer.classList.contains("is-zoomed")) markShrunk();
      if (viewer.classList.contains("is-zoomed")) {
        stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
      }
    });
    stage.addEventListener("click", () => viewer.close());
    viewer.querySelector(".viewer-close").addEventListener("click", () => viewer.close());
    viewer.addEventListener("close", () => {
      document.documentElement.classList.remove("has-viewer");
      image.removeAttribute("src");
      opener?.focus();
    });
  }

  // Demo videos: without JS (or with reduced motion) they keep their controls and wait for a click.
  // Otherwise they play silently in a loop while on screen and pause when scrolled away.
  const videos = document.querySelectorAll("video.demo-video");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (videos.length && !calm && "IntersectionObserver" in window) {
    const watch = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) target.play().catch(() => { target.controls = true; });
      else target.pause();
    }), { threshold: 0.4 });
    videos.forEach((video) => {
      video.muted = true;
      video.controls = false;
      video.preload = "auto";
      watch.observe(video);
    });
  }
})();
