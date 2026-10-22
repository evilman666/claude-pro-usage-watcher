// Isolated-world script: stores the latest reading, polls, and draws the badge.
(function () {
  console.log("[usage-pacer] content.js loaded");
  if (window.top !== window) return;
  const P = globalThis.UsagePace;
  const POLL_MS = 60 * 1000;
  const RENDER_MS = 15 * 1000;
  const PROBE_EVERY_MS = 10 * 60 * 1000;
  const KEY = "usagePacer";
  const EST_KEY = "usagePacerEst";

  let state = { used: null, resetsAt: null, session: null, endpoint: null, fetchedAt: 0, expanded: false, mode: "day" };
  let est = P.newEstimator();
  let lastProbe = 0;
  let lastError = null;
  let refs = null;

  function save() {
    try { chrome.storage.local.set({ [KEY]: state }); } catch (_) {}
  }
  function saveEst() {
    try { chrome.storage.local.set({ [EST_KEY]: est }); } catch (_) {}
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
    const mode = document.createElement("span");
    mode.className = "up-mode";
    mode.title = "Switch between % of today and % of week";
    const mDay = document.createElement("span");
    mDay.textContent = "day";
    const mWk = document.createElement("span");
    mWk.textContent = "wk";
    mode.append(mDay, mWk);
    mode.addEventListener("click", (e) => {
      e.stopPropagation();
      state.mode = state.mode === "week" ? "day" : "week";
      save();
      render();
    });
    row.append(dot, main, mode);
    const sub = document.createElement("div");
    sub.className = "up-sub";
    const bar = document.createElement("div");
    bar.className = "up-bar";
    const fill = document.createElement("div");
    bar.appendChild(fill);
    root.append(row, sub, bar);
    root.addEventListener("click", () => {
      state.expanded = !state.expanded;
      save();
      render();
    });
    document.documentElement.appendChild(root);
    refs = { root, main, sub, mDay, mWk, bar, fill };
    return refs;
  }

  // Sub-1% estimate of weekly usage, only when it belongs to the reading on screen.
  function readEst() {
    if (state.used == null || state.resetsAt == null) return null;
    if (est.lastW !== state.used || est.week == null || Math.abs(est.week - state.resetsAt) > 3600000) return null;
    return P.readEstimate(est, state.used);
  }

  // 5h session meter as a thin bar along the badge's bottom edge; null when no window is active.
  function renderSession(bar, fill, now) {
    const s = state.session;
    if (!s || s.resetsAt <= now) {
      bar.hidden = true;
      return null;
    }
    const used = Math.max(0, Math.min(100, s.used));
    bar.hidden = false;
    bar.dataset.level = used < 60 ? "ok" : used < 85 ? "low" : "over";
    fill.style.width = used + "%";
    return "5h window: " + s.used.toFixed(0) + "% used · resets in " + P.fmtDuration(s.resetsAt - now);
  }

  function render() {
    const { root, main, sub, mDay, mWk, bar, fill } = ensureBadge();
    root.classList.toggle("up-expanded", !!state.expanded);
    const weekMode = state.mode === "week";
    mDay.className = weekMode ? "" : "up-on";
    mWk.className = weekMode ? "up-on" : "";
    const now = Date.now();
    const sessTxt = renderSession(bar, fill, now);
    const E = readEst();
    const guess = !!(E && E.inferred && !E.exact);
    const r = state.used == null ? null : P.compute(E && E.inferred ? E.used : state.used, state.resetsAt, now);

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
    const tilde = guess ? "~" : "";
    const shown = weekMode ? rem : r.remainingDay;
    main.textContent = tilde + shown.toFixed(1) + (weekMode ? "% wk" : "%") + " left today";
    root.dataset.level = rem < 0 ? "over" : rem < r.perDay * 0.25 ? "low" : "ok";
    root.dataset.stale = now - state.fetchedAt > 3 * POLL_MS ? "1" : "0";

    const usedTxt = guess ? "~" + r.used.toFixed(1) + "% (±" + E.half.toFixed(2) + ")" : r.used.toFixed(1) + "%";
    let text =
      "Day " + r.dayIndex + "/7 · used " + usedTxt + " of " + r.target.toFixed(1) + "%\n" +
      "Day ends in " + P.fmtDuration(r.dayEndsAt - now) + " · resets in " + P.fmtDuration(r.resetsAt - now);
    if (guess) {
      text += "\nReported " + state.used + "% · session→week ratio " + E.k.toFixed(3) +
        (E.status === "coarse" ? " (coarse)" : "");
    } else if (E && !E.exact) {
      text += E.status === "distrust"
        ? "\nEstimate off: session and weekly meters don't line up"
        : E.status === "coarse"
          ? "\nNo finer than the reported integer yet (±" + E.half.toFixed(2) + ")"
          : "\nLearning session→week ratio…";
    }
    if (sessTxt) text += "\n" + sessTxt;
    text += "\n" + (weekMode ? r.remainingDay : rem).toFixed(1) + (weekMode ? "% of today's allowance" : "% of the week") + " left";
    const age = now - state.fetchedAt;
    text += "\nUpdated " + (age < 60000 ? "just now" : P.fmtDuration(age) + " ago");
    if (lastError && lastError.at > state.fetchedAt) text += "\nRefresh failing (" + lastError.status + ")";
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
    if (e.source !== window || !d || d.source !== "usage-pacer") return;
    if (d.type === "poll-error") {
      lastError = { status: d.status, at: Date.now() };
      render();
      return;
    }
    if (d.type !== "usage") return;
    if (!P.isUsageUrl(d.url, window.location.origin)) return;
    if (typeof d.used !== "number" || typeof d.resetsAt !== "number") return;
    const sess = d.session && typeof d.session.used === "number" && typeof d.session.resetsAt === "number" ? d.session : null;
    state.used = d.used;
    state.resetsAt = d.resetsAt;
    state.session = sess ? { used: sess.used, resetsAt: sess.resetsAt } : null;
    state.endpoint = d.url;
    lastError = null;
    state.fetchedAt = Date.now();
    est = P.updateEstimator(est, {
      W: d.used,
      S: sess ? sess.used : null,
      wReset: d.resetsAt,
      sReset: sess ? sess.resetsAt : null,
      t: Date.now(),
    });
    est.savedAt = Date.now();
    save();
    saveEst();
    render();
  });

  // Several claude.ai tabs share one estimator: adopt a newer copy saved by another tab.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[EST_KEY] || !changes[EST_KEY].newValue) return;
      const inc = changes[EST_KEY].newValue;
      if (inc.v === 2 && (inc.savedAt || 0) > (est.savedAt || 0)) {
        est = inc;
        render();
      }
    });
  } catch (_) {}

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { render(); poll(); }
  });

  window.addEventListener("focus", () => { render(); poll(); });

  function start() {
    render();
    poll();
    setInterval(poll, POLL_MS);
    setInterval(render, RENDER_MS);
  }

  try {
    chrome.storage.local.get([KEY, EST_KEY], (res) => {
      if (res && res[KEY]) state = Object.assign(state, res[KEY]);
      if (res && res[EST_KEY] && res[EST_KEY].v === 2) est = res[EST_KEY];
      // Discard any reading cached from a wrong endpoint by v1.0.0.
      if (!P.isUsageUrl(state.endpoint || "", window.location.origin)) {
        state.endpoint = null;
        state.used = null;
        state.resetsAt = null;
      }
      start();
    });
  } catch (_) {
    start();
  }
})();
