/* Dropcart integration for the actual SwiflyTV v196 lens engine.
   Decorates three existing, intentionally small surfaces; no layout redesign. */
(() => {
  "use strict";
  const CONFIG = [
    { selector: ".nav-capsule", theme: "light", tint: .07, distortionScale: -110, mapBlur: 8 },
    { selector: ".art-label", theme: "dark", tint: .14, distortionScale: -120, mapBlur: 7 },
    { selector: ".hero .eyebrow", theme: "dark", tint: .13, distortionScale: -90, mapBlur: 6 },
  ];
  const instances = new Map();
  const selectors = CONFIG.map(item => item.selector).join(",");
  let queued = false;

  function mount() {
    if (!window.SwiflyLiquidGlass?.mount) return;
    for (const [host, controller] of instances) {
      if (!host.isConnected || !host.querySelector(":scope > .dc-liquid-pane")) {
        controller.destroy();
        instances.delete(host);
      }
    }
    for (const config of CONFIG) {
      for (const host of document.querySelectorAll(config.selector)) {
        if (!(host instanceof HTMLElement) || instances.has(host)) continue;
        const pane = document.createElement("span");
        pane.className = "svLiquidPane dc-liquid-pane";
        pane.setAttribute("aria-hidden", "true");
        pane.dataset.dcGlassTheme = config.theme;
        pane.dataset.glassTint = String(config.tint);
        host.classList.add("dc-liquid-host");
        host.prepend(pane);
        try {
          const controller = window.SwiflyLiquidGlass.mount(pane, {
            tint: config.tint,
            distortionScale: config.distortionScale,
            mapBlur: config.mapBlur,
            channelOffsets: [0, 6, 12],
          });
          instances.set(host, controller);
        } catch {
          pane.remove();
          host.classList.remove("dc-liquid-host");
        }
      }
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      mount();
    });
  }
  function initialize() {
    if (!window.SwiflyLiquidGlass?.mount) {
      // A missing engine must leave the original page fully usable.
      return;
    }
    mount();
    const observer = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && !node.closest(".dc-liquid-pane") &&
            (node.matches(selectors) || node.querySelector(selectors))) changed = true;
        }
        for (const node of record.removedNodes) {
          if (node instanceof Element && (instances.has(node) || node.querySelector(selectors))) changed = true;
        }
        if (changed) break;
      }
      if (changed) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
