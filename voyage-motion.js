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
  const tiltElements = [...document.querySelectorAll("[data-tilt]")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const tiltState = new Map();
  const activeRipples = new Map();
  let storedChoice = null;
  let sailing = false;
  let frame = 0;
  let progressDirty = true;
  let pointerDirty = false;
  let pointerX = 0;
  let pointerY = 0;
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

    if (pointerDirty) {
      root.style.setProperty("--pointer-x", pointerX.toFixed(4));
      root.style.setProperty("--pointer-y", pointerY.toFixed(4));
      pointerDirty = false;
    }

    tiltState.forEach((state, element) => {
      if (!state.dirty) return;
      state.dirty = false;
      if (!state.active || !sailing || !finePointer.matches) {
        element.style.setProperty("--tilt-x", "0deg");
        element.style.setProperty("--tilt-y", "0deg");
        element.style.setProperty("--glow-x", "50%");
        element.style.setProperty("--glow-y", "50%");
        return;
      }
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = clamp((state.x - bounds.left) / bounds.width, 0, 1);
      const y = clamp((state.y - bounds.top) / bounds.height, 0, 1);
      element.style.setProperty("--tilt-x", `${((0.5 - y) * 6).toFixed(2)}deg`);
      element.style.setProperty("--tilt-y", `${((x - 0.5) * 6).toFixed(2)}deg`);
      element.style.setProperty("--glow-x", `${(x * 100).toFixed(1)}%`);
      element.style.setProperty("--glow-y", `${(y * 100).toFixed(1)}%`);
    });
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

  const resetPointer = () => {
    pointerX = 0;
    pointerY = 0;
    pointerDirty = true;
    tiltState.forEach((state) => {
      state.active = false;
      state.dirty = true;
    });
    schedule();
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
    if (!sailing) {
      resetPointer();
      clearRipples();
    }
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
  onMediaChange(finePointer, () => {
    if (!finePointer.matches) resetPointer();
  });

  tiltElements.forEach((element) => {
    const state = { x: 0, y: 0, active: false, dirty: false };
    tiltState.set(element, state);
    element.addEventListener("pointermove", (event) => {
      if (!sailing || !finePointer.matches || document.hidden) return;
      state.x = event.clientX;
      state.y = event.clientY;
      state.active = true;
      state.dirty = true;
      schedule();
    }, { passive: true });
    element.addEventListener("pointerleave", () => {
      state.active = false;
      state.dirty = true;
      schedule();
    }, { passive: true });
  });

  window.addEventListener("pointermove", (event) => {
    if (!sailing || !finePointer.matches || document.hidden) return;
    pointerX = clamp(event.clientX / Math.max(1, window.innerWidth) * 2 - 1, -1, 1);
    pointerY = clamp(event.clientY / Math.max(1, window.innerHeight) * 2 - 1, -1, 1);
    pointerDirty = true;
    schedule();
  }, { passive: true });
  root.addEventListener("pointerleave", resetPointer, { passive: true });

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
