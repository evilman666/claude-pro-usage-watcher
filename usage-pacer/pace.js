// Pure logic: pacing math + locating the weekly-usage numbers inside a JSON blob.
(function (root) {
  const DAY = 86400000;

  // Day boundaries are aligned to the weekly reset time (reset - 7 days = day 1 start).
  function compute(used, resetsAtMs, nowMs) {
    if (!isFinite(used) || !isFinite(resetsAtMs)) return null;
    if (nowMs >= resetsAtMs) return { stale: true };
    const start = resetsAtMs - 7 * DAY;
    const elapsed = Math.max(0, nowMs - start);
    const dayIndex = Math.min(7, Math.floor(elapsed / DAY) + 1);
    const target = (dayIndex / 7) * 100; // cumulative goal by end of today
    return {
      stale: false,
      used,
      dayIndex,
      target,
      perDay: 100 / 7,
      remaining: target - used, // negative = over pace; unused budget carries over within the week
      dayEndsAt: start + dayIndex * DAY,
      resetsAt: resetsAtMs,
    };
  }

  function fmtDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + mm + "m";
    return mm + "m";
  }

  const PCT_KEYS = ["utilization", "used_percent", "percent_used", "usage_percent", "percentage", "percent"];
  const RESET_KEYS = ["resets_at", "reset_at", "resetsAt", "resetAt", "reset_time"];
  const TAG_KEYS = ["type", "name", "window", "period", "id", "label", "kind"];

  function toMs(v) {
    if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    return null;
  }
  function toPct(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  // Walks any JSON and returns {used, resetsAt, path} for the weekly limit, or null.
  function findWeekly(json) {
    const found = [];
    (function walk(node, path, depth) {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (!Array.isArray(node)) {
        const pk = PCT_KEYS.find((k) => k in node);
        const rk = RESET_KEYS.find((k) => k in node);
        if (pk && rk) {
          const used = toPct(node[pk]);
          const resetsAt = toMs(node[rk]);
          if (used != null && resetsAt != null) {
            const tag = TAG_KEYS.map((k) => (typeof node[k] === "string" ? node[k] : "")).join(".");
            found.push({ used, resetsAt, path: (path.join(".") + "." + tag).toLowerCase() });
          }
        }
      }
      for (const k of Object.keys(node)) walk(node[k], path.concat(k), depth + 1);
    })(json, [], 0);

    const weekly = found.filter((f) => /seven_day|7_day|week/.test(f.path) && !/hour|session/.test(f.path));
    if (!weekly.length) return null;
    // Prefer the all-models weekly limit over per-model ones.
    return weekly.find((f) => !/opus|sonnet|haiku|model/.test(f.path)) || weekly[0];
  }

  const api = { compute, fmtDuration, findWeekly };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UsagePace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
