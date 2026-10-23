(() => {
  "use strict";

  const root = document.documentElement;
  const toggle = document.getElementById("sea-motion-toggle");
  const label = toggle?.querySelector("[data-motion-label]");
  const progressFill = document.querySelector(".voyage-progress-fill");
  const distance = document.getElementById("voyage-distance");
  const rippleLayer = document.getElementById("sea-ripples");
  const hero = document.getElementById("home");
  const reveals = [...document.querySelectorAll("[data-reveal]")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const activeRipples = new Map();
  let storedChoice = null;
  let sailing = false;
  let frame = 0;
  let progressDirty = true;
  let displayedPercent = -1;
  let revealObserver = null;

  try {
    const choice = sessionStorage.getItem("voyage-motion");
    if (choice === "sailing" || choice === "paused") storedChoice = choice;
  } catch (_) {
    // Motion controls remain usable when browser storage is unavailable.
  }

  const schedule = () => {
    if (!frame && !document.hidden) frame = requestAnimationFrame(flush);
  };

  function flush() {
    frame = 0;
    if (document.hidden) return;

    if (progressDirty) {
      const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
      const progress = maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) : 0;
      const percent = Math.round(progress * 100);
      root.style.setProperty("--voyage-progress", progress.toFixed(5));
      const eased = progress * progress * (3 - 2 * progress);
      root.style.setProperty("--compass-bearing", `${(eased * 270).toFixed(2)}deg`);
      if (progressFill) progressFill.style.transform = `scaleX(${progress.toFixed(5)})`;
      if (distance && percent !== displayedPercent) {
        distance.textContent = `${String(percent).padStart(2, "0")}% of the voyage`;
        displayedPercent = percent;
      }
      progressDirty = false;
    }
  }

  const revealAll = () => {
    revealObserver?.disconnect();
    reveals.forEach((element) => element.classList.add("is-revealed"));
  };

  const observeReveals = () => {
    if (!sailing || !("IntersectionObserver" in window)) {
      revealAll();
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -25px 0px", threshold: 0.04 });
    }
    reveals.forEach((element) => {
      if (!element.classList.contains("is-revealed")) revealObserver.observe(element);
    });
  };

  const clearRipples = () => {
    activeRipples.forEach((timeout, ripple) => {
      clearTimeout(timeout);
      ripple.remove();
    });
    activeRipples.clear();
  };

  const setMotion = (enabled, persist = false) => {
    sailing = Boolean(enabled);
    root.dataset.seaMotion = sailing ? "sailing" : "paused";
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(sailing));
      toggle.setAttribute("aria-label", sailing ? "Pause motion" : "Resume motion");
    }
    if (label) label.textContent = sailing ? "Pause motion" : "Resume motion";
    if (persist) {
      storedChoice = sailing ? "sailing" : "paused";
      try {
        sessionStorage.setItem("voyage-motion", storedChoice);
      } catch (_) {
        // A disabled storage policy must not disable the motion toggle.
      }
    }
    if (!sailing) clearRipples();
    observeReveals();
  };

  toggle?.addEventListener("click", () => setMotion(!sailing, true));

  const onMediaChange = (query, handler) => {
    if (typeof query.addEventListener === "function") query.addEventListener("change", handler);
    else if (typeof query.addListener === "function") query.addListener(handler);
  };
  onMediaChange(reducedMotion, () => {
    setMotion(!reducedMotion.matches && storedChoice !== "paused");
  });

  const refreshProgress = () => {
    progressDirty = true;
    schedule();
  };
  window.addEventListener("scroll", refreshProgress, { passive: true });
  window.addEventListener("resize", refreshProgress, { passive: true });
  if ("ResizeObserver" in window) {
    const main = document.querySelector("main");
    if (main) new ResizeObserver(refreshProgress).observe(main);
  }

  if (hero && rippleLayer) {
    hero.addEventListener("pointerdown", (event) => {
      if (!sailing || document.hidden || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (event.target instanceof Element && event.target.closest("a,button,input,select,textarea,summary,[role='button']")) return;
      while (activeRipples.size >= 5) {
        const [oldest, timeout] = activeRipples.entries().next().value;
        clearTimeout(timeout);
        oldest.remove();
        activeRipples.delete(oldest);
      }
      const ripple = document.createElement("span");
      const bounds = rippleLayer.getBoundingClientRect();
      ripple.className = "sea-ripple";
      ripple.style.left = `${event.clientX - bounds.left}px`;
      ripple.style.top = `${event.clientY - bounds.top}px`;
      const remove = () => {
        clearTimeout(activeRipples.get(ripple));
        activeRipples.delete(ripple);
        ripple.remove();
      };
      ripple.addEventListener("animationend", remove, { once: true });
      rippleLayer.append(ripple);
      activeRipples.set(ripple, setTimeout(remove, 1800));
    }, { passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearRipples();
    } else refreshProgress();
  });

  // Reduced motion always wins on load; the visitor may explicitly resume it.
  setMotion(!reducedMotion.matches && storedChoice !== "paused");
  root.classList.add("voyage-enhanced");
  schedule();
})();
