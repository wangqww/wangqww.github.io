/* One canvas, one motion preference, and an optional full-viewport voyage. */
(() => {
  "use strict";
  const root = document.documentElement;
  const canvas = document.getElementById("ocean-canvas");
  const opener = document.getElementById("cinema-open");
  const motionToggle = document.getElementById("sea-motion-toggle");
  if (!canvas || !opener || !motionToggle || typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") return;

  const originalParent = canvas.parentNode;
  const originalNextSibling = canvas.nextSibling;
  const dialog = document.createElement("dialog");
  dialog.id = "sea-cinema";
  dialog.setAttribute("aria-labelledby", "cinema-title");
  dialog.setAttribute("aria-describedby", "cinema-description");
  dialog.innerHTML = `
    <div class="cinema-stage" aria-hidden="true"></div>
    <div class="cinema-vignette" aria-hidden="true"></div>
    <div class="cinema-topbar">
      <span class="cinema-mark"><span aria-hidden="true">✧</span> A RESEARCHER'S VOYAGE</span>
      <button class="cinema-close" type="button" aria-label="Close cinematic voyage" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Back to shore</span></button>
    </div>
    <div class="cinema-bottom">
      <div class="cinema-caption"><p class="cinema-eyebrow">THE GRAND LINE</p><h2 id="cinema-title">The Thousand Sunny.</h2><p id="cinema-description">Somewhere along the Grand Line.</p></div>
      <button id="cinema-motion-toggle" class="cinema-motion" type="button" aria-pressed="false"><svg class="motion-icon-pause" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg><svg class="motion-icon-play" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z"/></svg><span>Resume motion</span></button>
    </div>`;
  document.body.append(dialog);
  const stage = dialog.querySelector(".cinema-stage");
  const closeButton = dialog.querySelector(".cinema-close");
  const cinematicMotion = dialog.querySelector("#cinema-motion-toggle");
  const cinematicMotionLabel = cinematicMotion.querySelector("span");
  let active = false;
  let pageState = null;

  function syncMotion() {
    const sailing = root.dataset.seaMotion === "sailing";
    const label = sailing ? "Pause motion" : "Resume motion";
    cinematicMotion.setAttribute("aria-pressed", String(sailing));
    cinematicMotion.setAttribute("aria-label", label);
    cinematicMotionLabel.textContent = label;
  }

  function restorePage() {
    if (!active) return;
    active = false;
    delete root.dataset.cinema;
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) originalParent.insertBefore(canvas, originalNextSibling);
    else originalParent.append(canvas);
    opener.setAttribute("aria-expanded", "false");
    root.style.setProperty("overflow", pageState.rootOverflow, pageState.rootOverflowPriority);
    document.body.style.setProperty("overflow", pageState.bodyOverflow, pageState.bodyOverflowPriority);
    // Native modal focus and overflow changes must not move the reader's place.
    window.scrollTo({ left: pageState.x, top: pageState.y, behavior: "instant" });
    if (opener.getClientRects().length) opener.focus({ preventScroll: true });
    else document.querySelector(".brand")?.focus({ preventScroll: true });
    pageState = null;
  }

  function closeCinema() {
    if (dialog.open) dialog.close();
    restorePage();
  }

  function openCinema() {
    if (active || dialog.open || !root.classList.contains("webgl-ocean-ready")) return;
    const state = { x: window.scrollX, y: window.scrollY, rootOverflow: root.style.overflow, bodyOverflow: document.body.style.overflow, rootOverflowPriority: root.style.getPropertyPriority("overflow"), bodyOverflowPriority: document.body.style.getPropertyPriority("overflow") };
    try { dialog.showModal(); } catch (_) { return; }
    pageState = state;
    active = true;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    stage.append(canvas);
    root.dataset.cinema = "open";
    opener.setAttribute("aria-expanded", "true");
    syncMotion();
    closeButton.focus({ preventScroll: true });
  }

  opener.setAttribute("aria-controls", dialog.id);
  opener.setAttribute("aria-haspopup", "dialog");
  opener.setAttribute("aria-expanded", "false");
  opener.hidden = false;
  opener.addEventListener("click", openCinema);
  closeButton.addEventListener("click", closeCinema);
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeCinema(); });
  dialog.addEventListener("close", () => { if (!dialog.open) restorePage(); });
  cinematicMotion.addEventListener("click", () => { motionToggle.click(); syncMotion(); });
  canvas.addEventListener("webglcontextlost", closeCinema);
  new MutationObserver(syncMotion).observe(root, { attributes: true, attributeFilter: ["data-sea-motion"] });
  syncMotion();
})();
