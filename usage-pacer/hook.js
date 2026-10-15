// Runs in the page's own JS world so it can see claude.ai's own API responses.
// It never sends anything off-site; it only posts window messages to content.js.
(function () {
  if (window.__usagePacerHooked) return;
  window.__usagePacerHooked = true;

  const P = window.UsagePace;
  const origFetch = window.fetch.bind(window);
  const post = (msg) => window.postMessage(Object.assign({ source: "usage-pacer" }, msg), window.location.origin);

  function handle(url, json) {
    if (!P.isUsageUrl(url, window.location.origin)) return false;
    const hit = P.findWeekly(json);
    if (!hit) return false;
    post({ type: "usage", url: new URL(url, window.location.origin).href, used: hit.used, resetsAt: hit.resetsAt });
    return true;
  }

  // 1) Passive: watch the site's own JSON responses (e.g. when Settings > Usage loads).
  window.fetch = async function (...args) {
    const res = await origFetch(...args);
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const raw = args[0];
        const url = typeof raw === "string" ? raw : raw instanceof URL ? raw.href : (raw && raw.url) || "";
        if (url && P.isUsageUrl(url, window.location.origin)) {
          res.clone().json().then((j) => handle(url, j)).catch(() => {});
        }
      }
    } catch (_) {}
    return res;
  };

  // 2) Active: re-fetch a known endpoint on request from content.js.
  async function pollUrl(url) {
    try {
      const r = await origFetch(url, { credentials: "include" });
      if (!r.ok) return false;
      return handle(url, await r.json());
    } catch (_) {
      return false;
    }
  }

  // 3) Best-effort discovery of the endpoint before the user has opened the usage page.
  async function probe() {
    try {
      const r = await origFetch("/api/organizations", { credentials: "include" });
      const orgs = await r.json();
      const ids = (Array.isArray(orgs) ? orgs : []).map((o) => o.uuid || o.id).filter(Boolean);
      for (const id of ids) {
        if (await pollUrl("/api/organizations/" + id + "/usage")) return;
      }
    } catch (_) {}
    post({ type: "probe-failed" });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "usage-pacer-cs") return;
    if (e.data.type === "poll" && typeof e.data.url === "string") {
      const u = new URL(e.data.url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) pollUrl(u.href);
    } else if (e.data.type === "probe") {
      probe();
    }
  });
})();
