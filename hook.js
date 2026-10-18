// Runs in the page's own JS world so it can see claude.ai's own API responses.
// It never sends anything off-site; it only posts window messages to content.js.
(function () {
  if (window.__usagePacerHooked) return;
  window.__usagePacerHooked = true;

  const P = globalThis.UsagePace;
  const origin = window.location.origin;
  const origFetch = window.fetch.bind(window);
  const post = (msg) => window.postMessage(Object.assign({ source: "usage-pacer" }, msg), origin);

  // Headers the site itself sends on its API calls (client version, device id, ...).
  // Our own refresh requests reuse them so the server treats them like the app's.
  const siteHeaders = {};

  function urlOf(raw) {
    return typeof raw === "string" ? raw : raw instanceof URL ? raw.href : (raw && raw.url) || "";
  }
  function isSameOriginApi(url) {
    try {
      const u = new URL(url, origin);
      return u.origin === origin && u.pathname.startsWith("/api/");
    } catch (_) {
      return false;
    }
  }
  function rememberHeaders(raw, init) {
    try {
      const h = new Headers((init && init.headers) || (raw instanceof Request ? raw.headers : undefined));
      h.forEach((v, k) => {
        if (/^(anthropic-|x-activity-)/i.test(k)) siteHeaders[k] = v;
      });
    } catch (_) {}
  }

  function handle(url, json) {
    if (!P.isUsageUrl(url, origin)) return false;
    const hit = P.findWeekly(json);
    if (!hit) return false;
    const sess = P.findSession(json);
    post({
      type: "usage",
      url: new URL(url, origin).href,
      used: hit.used,
      resetsAt: hit.resetsAt,
      session: sess ? { used: sess.used, resetsAt: sess.resetsAt } : null,
    });
    return true;
  }

  // 1) Passive: watch the site's own usage response (e.g. when Settings > Usage loads).
  window.fetch = async function (...args) {
    const url = urlOf(args[0]);
    const api = !!url && isSameOriginApi(url);
    if (api) rememberHeaders(args[0], args[1]);
    const res = await origFetch(...args);
    try {
      if (api && P.isUsageUrl(url, origin) && (res.headers.get("content-type") || "").includes("json")) {
        res.clone().json().then((j) => handle(url, j)).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // 2) Active: re-fetch the usage endpoint on request from content.js.
  async function pollUrl(url) {
    try {
      const r = await origFetch(url, { credentials: "include", cache: "no-store", headers: siteHeaders });
      if (!r.ok) {
        post({ type: "poll-error", status: r.status });
        return false;
      }
      const ok = handle(url, await r.json());
      if (!ok) post({ type: "poll-error", status: "unrecognized response" });
      return ok;
    } catch (_) {
      post({ type: "poll-error", status: "network" });
      return false;
    }
  }

  // 3) Best-effort discovery of the endpoint before the user has opened the usage page.
  async function probe() {
    try {
      const r = await origFetch("/api/organizations", { credentials: "include", cache: "no-store", headers: siteHeaders });
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
      const u = new URL(e.data.url, origin);
      if (P.isUsageUrl(u.href, origin)) pollUrl(u.href);
    } else if (e.data.type === "probe") {
      probe();
    }
  });
})();
