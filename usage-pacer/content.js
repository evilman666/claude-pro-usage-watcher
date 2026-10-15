// Isolated-world script: stores the latest reading, polls, and draws the badge.
(function () {
  if (window.top !== window) return;
  const P = window.UsagePace;
  const POLL_MS = 60 * 1000;
  const RENDER_MS = 15 * 1000;
  const PROBE_EVERY_MS = 10 * 60 * 1000;
  const STALE_MS = 5 * 60 * 1000;
  const KEY = "usagePacer";

  let state = { used: null, resetsAt: null, endpoint: null, fetchedAt: 0, expanded: false };
  let lastProbe = 0;
  let refs = null;

  function save() {
    try { chrome.storage.local.set({ [KEY]: state }); } catch (_) {}
  }

  function ensureBadge() {
    if (refs && refs.root.isConnected) return refs;
    const root = document.createElement("div");
    root.id = "usage-pacer";
    root.setAttribute("role", "status");
    root.title = "Click to show or hide details";
    const row = document.createElement("div");
    row.className = "up-row";
    const dot = document.createElement("span");
    dot.className = "up-dot";
    const main = document.createElement("span");
    main.className = "up-main";
    row.append(dot, main);
    const sub = document.createElement("div");
    sub.className = "up-sub";
    root.append(row, sub);
    root.addEventListener("click", () => {
      state.expanded = !state.expanded;
      save();
      render();
    });
    document.documentElement.appendChild(root);
    refs = { root, main, sub };
    return refs;
  }

  function render() {
    const { root, main, sub } = ensureBadge();
    root.classList.toggle("up-expanded", !!state.expanded);
    const now = Date.now();
    const r = state.used == null ? null : P.compute(state.used, state.resetsAt, now);

    if (!r) {
      root.dataset.level = "idle";
      main.textContent = "Usage pacer";
      sub.textContent = "Open Settings → Usage once to link your weekly usage.";
      return;
    }
    if (r.stale) {
      root.dataset.level = "idle";
      main.textContent = "Refreshing…";
      sub.textContent = "Weekly reset time has passed.";
      poll();
      return;
    }
    const rem = r.remaining;
    main.textContent = rem >= 0 ? rem.toFixed(1) + "% left today" : (-rem).toFixed(1) + "% over pace";
    root.dataset.level = rem < 0 ? "over" : rem < r.perDay * 0.25 ? "low" : "ok";
    let text =
      "Day " + r.dayIndex + "/7 · used " + r.used.toFixed(1) + "% of " + r.target.toFixed(1) + "%\n" +
      "Day ends in " + P.fmtDuration(r.dayEndsAt - now) + " · resets in " + P.fmtDuration(r.resetsAt - now);
    if (now - state.fetchedAt > STALE_MS) text += "\n(last update " + P.fmtDuration(now - state.fetchedAt) + " ago)";
    sub.textContent = text;
  }

  function sendToHook(msg) {
    window.postMessage(Object.assign({ source: "usage-pacer-cs" }, msg), window.location.origin);
  }

  function poll() {
    if (state.endpoint) {
      sendToHook({ type: "poll", url: state.endpoint });
    } else if (Date.now() - lastProbe > PROBE_EVERY_MS) {
      lastProbe = Date.now();
      sendToHook({ type: "probe" });
    }
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== "usage-pacer" || d.type !== "usage") return;
    try {
      if (new URL(d.url).origin !== window.location.origin) return;
    } catch (_) { return; }
    if (typeof d.used !== "number" || typeof d.resetsAt !== "number") return;
    state.used = d.used;
    state.resetsAt = d.resetsAt;
    state.endpoint = d.url;
    state.fetchedAt = Date.now();
    save();
    render();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { render(); poll(); }
  });

  function start() {
    render();
    poll();
    setInterval(poll, POLL_MS);
    setInterval(render, RENDER_MS);
  }

  try {
    chrome.storage.local.get(KEY, (res) => {
      if (res && res[KEY]) state = Object.assign(state, res[KEY]);
      start();
    });
  } catch (_) {
    start();
  }
})();
