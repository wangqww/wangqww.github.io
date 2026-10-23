(() => {
  "use strict";

  const menuToggle = document.querySelector(".menu-toggle");
  const siteNav = document.getElementById("site-nav");

  if (menuToggle && siteNav) {
    const header = menuToggle.closest(".site-header");
    const setMenuOpen = (isOpen) => {
      siteNav.classList.toggle("is-open", isOpen);
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    };
    const closeMenu = () => setMenuOpen(false);
    closeMenu();

    menuToggle.addEventListener("click", () => {
      setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
    });

    siteNav.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menuToggle.focus();
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (menuToggle.getAttribute("aria-expanded") === "true" && header && !header.contains(event.target)) closeMenu();
    }, { passive: true });
    header?.addEventListener("focusout", (event) => {
      if (!header.contains(event.relatedTarget)) closeMenu();
    });

    const desktopQuery = window.matchMedia("(min-width: 801px)");
    const onDesktopChange = (event) => {
      if (event.matches) closeMenu();
    };
    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", onDesktopChange);
    } else if (typeof desktopQuery.addListener === "function") {
      desktopQuery.addListener(onDesktopChange);
    }
  }

  const filterButtons = [...document.querySelectorAll("button[data-filter]")];
  const projects = [...document.querySelectorAll("article[data-topics]")];
  const resultCount = document.getElementById("result-count");
  const allowedFilters = new Set(["all", "reconstruction", "localization", "synthesis", "interaction"]);

  const applyFilter = (filter) => {
    if (!allowedFilters.has(filter)) return;

    filterButtons.forEach((button) => {
      const isActive = button.dataset.filter === filter;
      button.setAttribute("aria-pressed", String(isActive));
      button.classList.toggle("is-active", isActive);
    });

    let visibleCount = 0;
    projects.forEach((project) => {
      const topics = (project.dataset.topics || "").split(/\s+/);
      const matches = filter === "all" || topics.includes(filter);
      project.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (resultCount) {
      resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? "project" : "projects"}`;
    }
  };

  if (filterButtons.length && projects.length) {
    filterButtons.forEach((button) => {
      button.addEventListener("click", () => applyFilter(button.dataset.filter));
    });
    const initialButton = filterButtons.find((button) => button.getAttribute("aria-pressed") === "true");
    applyFilter(initialButton?.dataset.filter || "all");
  }

  const missions = [...document.querySelectorAll("a[data-mission]")];
  const questProgress = document.getElementById("quest-progress");
  const visitedPorts = new Set();
  const markPortVisited = (id) => {
    const mission = missions.find((item) => item.dataset.mission === id);
    if (!mission || visitedPorts.has(id)) return;
    visitedPorts.add(id);
    mission.classList.add("is-visited");
    const state = mission.querySelector(".mission-state");
    if (state) {
      state.textContent = "✓";
      state.setAttribute("aria-label", "Port visited");
    }
    if (questProgress) {
      questProgress.textContent = `${visitedPorts.size} / ${missions.length} ports visited`;
    }
  };

  if (missions.length && "IntersectionObserver" in window) {
    const portObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          markPortVisited(entry.target.id);
          portObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "-90px 0px -25% 0px", threshold: 0 });
    missions.forEach((mission) => {
      const section = document.getElementById(mission.dataset.mission);
      if (section) portObserver.observe(section);
    });
  }
})();
