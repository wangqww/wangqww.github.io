/* Scroll-linked details: paint on input, never run an idle animation loop. */
(() => {
  "use strict";
  const root = document.documentElement;
  const journal = document.querySelector(".atlas-journal");
  const hero = document.getElementById("home");
  const footer = document.querySelector(".site-footer");
  const motion = document.getElementById("sea-motion-toggle");
  if (!journal || !hero || !motion) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const chapters = ["about", "research", "logbook", "contact"].map(id => document.getElementById(id)).filter(Boolean);
  const scenery = [...chapters, document.getElementById("memories")].filter(Boolean);
  const names = { about: "About", research: "Research", logbook: "Logbook", contact: "Contact" };
  const clamp = value => Math.max(0, Math.min(1, value));
  const rail = document.createElement("nav");
  rail.className = "deck-rail";
  rail.setAttribute("aria-label", "Voyage chapters");
  rail.innerHTML = '<span class="deck-rail-title">THE VOYAGE</span><div class="deck-rail-track" aria-hidden="true"><span class="deck-rail-progress"></span></div>' + chapters.map((section, i) => `<a class="deck-stop" href="#${section.id}"><span class="deck-stop-number">0${i + 1}</span><span class="deck-stop-label">${names[section.id]}</span></a>`).join("");
  const toggle = document.createElement("button");
  toggle.className = "deck-motion-toggle";
  toggle.type = "button";
  toggle.innerHTML = '<svg class="motion-icon-pause" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg><svg class="motion-icon-play" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z"/></svg><span data-deck-motion-label>Pause effects</span>';
  toggle.addEventListener("click", () => motion.click());
  document.body.append(rail, toggle);
  const stops = [...rail.querySelectorAll(".deck-stop")];
  const entries = [...journal.querySelectorAll(".aj-timeline li,.aj-honors li")];
  entries.forEach((entry, i) => { entry.classList.add("deck-entry"); entry.style.setProperty("--deck-delay", `${i % 3 * 60}ms`); });
  const timelines = [...journal.querySelectorAll(".aj-timeline")];
  const chart = document.querySelector(".voyage-chart");
  const course = document.getElementById("chart-course");
  const ink = document.getElementById("chart-ink");
  const ship = document.getElementById("chart-ship");
  const ports = [...document.querySelectorAll("[data-chart-port]")];
  let routeLength = 0;
  if (course && typeof course.getTotalLength === "function") routeLength = course.getTotalLength();
  let request = 0, dirty = true, bounds = new Map(), chartProgress = -1, activeId = "", away = false;
  let observer = null;

  function documentTop(element) {
    let top = 0;
    for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  }
  function measure() {
    bounds = new Map([hero, footer, ...scenery, ...timelines, chart].filter(Boolean).map(element => [element, { top: documentTop(element), height: element.offsetHeight }]));
    dirty = false;
  }
  function enabled() { return root.dataset.seaMotion === "sailing" && !reduced.matches; }
  function schedule() {
    if (!request && !document.hidden) request = requestAnimationFrame(paint);
  }
  function invalidate() { dirty = true; schedule(); }
  function paint() {
    request = 0;
    if (document.hidden) return;
    if (dirty) measure();
    const y = window.scrollY, vh = window.innerHeight, cursor = y + vh * .38;
    const atEnd = y + vh >= root.scrollHeight - 2;
    const sailing = enabled();
    const heroBox = bounds.get(hero);
    const nextAway = y > heroBox.top + heroBox.height - 100;
    if (away !== nextAway) { away = nextAway; root.classList.toggle("deck-away", away); }
    const footerBox = footer && bounds.get(footer);
    root.classList.toggle("deck-at-end", Boolean(footerBox && y + vh > footerBox.top));
    let current = chapters[0]?.id || "";
    chapters.forEach(section => {
      const box = bounds.get(section);
      if (cursor >= box.top) current = section.id;
    });
    if (atEnd && chapters.length) current = chapters[chapters.length - 1].id;
    scenery.forEach(section => {
      const box = bounds.get(section);
      const progress = clamp((y + vh * .72 - box.top) / Math.max(box.height + vh * .28, 1));
      const travel = sailing ? Math.max(-1, Math.min(1, (box.top + box.height * .5 - y - vh * .5) / Math.max((vh + box.height) * .5, 1))) : 0;
      section.style.setProperty("--deck-travel", travel.toFixed(4));
      section.style.setProperty("--deck-progress", progress.toFixed(4));
    });
    if (current !== activeId) {
      activeId = current;
      stops.forEach(stop => {
        const active = stop.hash === `#${current}`;
        stop.classList.toggle("is-current", active);
        if (active) stop.setAttribute("aria-current", "location"); else stop.removeAttribute("aria-current");
      });
    }
    const first = bounds.get(chapters[0]), last = bounds.get(chapters[chapters.length - 1]);
    if (first && last) rail.style.setProperty("--deck-overall", (atEnd ? 1 : clamp((cursor - first.top) / Math.max(last.top + last.height - first.top, 1))).toFixed(4));
    timelines.forEach(line => {
      const box = bounds.get(line);
      line.style.setProperty("--timeline-progress", (sailing ? clamp((y + vh * .72 - box.top) / Math.max(box.height, 1)) : 1).toFixed(4));
    });
    if (chart && routeLength && ink && ship) {
      const box = bounds.get(chart);
      const progress = sailing ? clamp((y + vh * .88 - box.top) / Math.max(vh * .8 + box.height * .2, 1)) : 1;
      if (Math.abs(progress - chartProgress) > .0005) {
        chartProgress = progress;
        const length = progress * routeLength, point = course.getPointAtLength(length);
        const before = course.getPointAtLength(Math.max(0, length - 2)), after = course.getPointAtLength(Math.min(routeLength, length + 2));
        const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
        ink.style.strokeDashoffset = (1 - progress).toFixed(4);
        ship.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
        ports.forEach((port, i) => port.classList.toggle("is-current", i === Math.min(ports.length - 1, Math.floor(progress * ports.length))));
      }
    }
  }
  function syncMotion() {
    const on = root.dataset.seaMotion === "sailing";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.setAttribute("aria-label", on ? "Pause page effects" : "Resume page effects");
    toggle.querySelector("[data-deck-motion-label]").textContent = on ? "Pause effects" : "Resume effects";
    if (!enabled()) entries.forEach(entry => entry.classList.add("is-on-deck"));
    schedule();
  }
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(items => {
      items.forEach(item => {
        if (!item.isIntersecting) return;
        item.target.classList.add("is-on-deck");
        observer.unobserve(item.target);
      });
    }, { rootMargin: "0px 0px -28px 0px", threshold: .12 });
    entries.forEach(entry => observer.observe(entry));
  } else entries.forEach(entry => entry.classList.add("is-on-deck"));
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", invalidate, { passive: true });
  journal.addEventListener("toggle", invalidate, true);
  if ("ResizeObserver" in window) {
    const sizeObserver = new ResizeObserver(invalidate);
    [journal, ...scenery, ...timelines].forEach(element => sizeObserver.observe(element));
  }
  const papers = journal.querySelector(".aj-papers");
  if (papers) new MutationObserver(invalidate).observe(papers, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(syncMotion).observe(root, { attributes: true, attributeFilter: ["data-sea-motion", "data-cinema"] });
  if (reduced.addEventListener) reduced.addEventListener("change", syncMotion); else reduced.addListener(syncMotion);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (request) cancelAnimationFrame(request); request = 0; } else invalidate();
  });
  document.fonts?.ready.then(invalidate);
  root.classList.add("deck-enhanced");
  syncMotion();
  invalidate();
})();
