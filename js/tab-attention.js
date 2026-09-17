/** Invite visitors back after 10 seconds in another tab. Never steal focus. */
(() => {
  "use strict";
  const icon = document.querySelector('link[rel~="icon"]');
  if (!icon) return;

  const originalHref = icon.getAttribute("href");
  const originalTitle = document.title;
  const attentionHref = new URL("favicon-emoji.svg", icon.href).href;
  const blankHref = new URL("favicon-blank.svg", icon.href).href;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let delayTimer;
  let blinkTimer;
  let highlighted = false;

  function paintAttention() {
    icon.href = highlighted ? attentionHref : blankHref;
    document.title = "Hey, I miss u";
  }

  function reset() {
    window.clearTimeout(delayTimer);
    window.clearInterval(blinkTimer);
    delayTimer = blinkTimer = undefined;
    highlighted = false;
    icon.setAttribute("href", originalHref);
    document.title = originalTitle;
  }

  function update() {
    reset();
    if (!document.hidden) return;
    delayTimer = window.setTimeout(() => {
      if (!document.hidden) return;
      highlighted = true;
      paintAttention();
      // A steady highlight provides the same cue without motion when requested.
      if (reducedMotion.matches) return;
      blinkTimer = window.setInterval(() => {
        if (!document.hidden) { reset(); return; }
        highlighted = !highlighted;
        paintAttention();
      }, 500);
    }, 10_000);
  }

  document.addEventListener("visibilitychange", update);
  reducedMotion.addEventListener("change", update);
  window.addEventListener("pagehide", reset);
  window.addEventListener("pageshow", update);
  update();
})();
