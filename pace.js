// Pure logic: pacing math, locating usage numbers in JSON, and sub-1% inference.
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
      remainingDay: ((target - used) / (100 / 7)) * 100, // same budget as % of one day's allowance; can exceed 100
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

  // ---------- locating numbers in the usage JSON ----------

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

  // Every {percent, reset time} pair in a JSON blob, with a path/label string describing it.
  function collect(json) {
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
    return found;
  }

  // Weekly limit (all models preferred over per-model ones), or null.
  function findWeekly(json) {
    const weekly = collect(json).filter((f) => /seven_day|7_day|week/.test(f.path) && !/hour|session/.test(f.path));
    if (!weekly.length) return null;
    return weekly.find((f) => !/opus|sonnet|haiku|model/.test(f.path)) || weekly[0];
  }

  // The rolling 5-hour session meter, or null when no session window is active.
  function findSession(json) {
    const s = collect(json).filter((f) => /five_hour|5_hour|session/.test(f.path) && !/seven_day|7_day|week/.test(f.path));
    if (!s.length) return null;
    return s.find((f) => !/opus|sonnet|haiku|model/.test(f.path)) || s[0];
  }

  // Only this endpoint is trusted. Other pages (e.g. Claude Code) load JSON with
  // similar-looking fields that would otherwise overwrite the real reading.
  function isUsageUrl(href, origin) {
    try {
      const u = new URL(href, origin);
      return u.origin === origin && /^\/api\/organizations\/[^/]+\/usage\/?$/.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  // ---------- sub-1% inference of weekly usage from the 5-hour session meter ----------
  //
  // Both meters are reported as whole percents. If they measure the same underlying
  // usage, weekly% rises by k x session% (k = session cap / weekly cap), so inside one
  // session window  weekly = x + k * (session - session_now)  with x constant (x is the weekly
  // value at the moment of the latest session reading; it is re-anchored at every sample so
  // the uncertainty in k only multiplies the progress since the last informative reading).
  // Each sample says: weekly lies in the rounding range of the reported integer, and the
  // session's true value lies within +-0.5 of its integer. Intersecting those constraints over
  // the window pins x down (sharply right after the weekly integer ticks), giving a sub-1%
  // estimate with an honest +-. If the data contradicts the model (empty intersection) we
  // count a conflict, and stop showing the estimate when conflicts are frequent.

  const ROUND_MODE = "nearest"; // "floor" if the backend truncates instead of rounding
  const WEEK_TOL = 3600000; // resets_at jitters by microseconds; 1h tolerance
  const WIN_TOL = 600000;
  const MIN_K_SAMPLE = 10; // session-% observed before trusting k
  const MAX_HALF = 0.3; // +- above this is labelled "coarse"

  const isNum = (x) => typeof x === "number" && isFinite(x);
  const isWhole = (x) => Math.abs(x - Math.round(x)) < 1e-9;
  function roundRange(W, mode) {
    return mode === "floor" ? [W, W + 1] : [W - 0.5, W + 0.5];
  }

  function newEstimator() {
    return {
      v: 2, exact: false,
      sumDS: 0, sumDW: 0, runs: 0, runCounted: false, pairs: 0, conflicts: 0, maxRate: 0,
      week: null, win: null, lastS: null, lastW: null, lastT: null,
      xa: null, xb: null, // interval for the weekly value at the latest session reading (anchor)
      wa: null, wb: null, // interval for the true weekly% at the last sample
    };
  }

  function kOf(e) {
    if (e.sumDS < MIN_K_SAMPLE) return null;
    const k = e.sumDW / e.sumDS;
    // Each contiguous run contributes up to +-1 rounding error to both sums.
    const err = Math.max(0.002, (Math.sqrt(Math.max(1, e.runs)) * (1 + k)) / e.sumDS);
    return { k, err };
  }

  // s = { W, S, wReset, sReset, t }  (S/sReset may be null when no session is active)
  function updateEstimator(e, s, opts) {
    const mode = (opts && opts.mode) || ROUND_MODE;
    const [lo, hi] = roundRange(s.W, mode);
    const hasS = isNum(s.S) && isNum(s.sReset);
    const t = isNum(s.t) ? s.t : Date.now();
    e.exact = !isWhole(s.W); // the server gave real decimals: nothing to infer

    if (e.week == null || Math.abs(s.wReset - e.week) >= WEEK_TOL) {
      e.week = s.wReset;
      e.win = e.lastS = e.lastW = e.lastT = null;
      e.xa = e.xb = e.wa = e.wb = null;
      e.runCounted = false;
    }
    const prevOK = e.lastW != null && s.W >= e.lastW && e.wa != null && (e.lastT == null || t >= e.lastT);
    let wa = lo, wb = hi; // default: nothing inferable beyond the rounding range

    if (e.exact) {
      wa = wb = s.W;
      e.xa = e.xb = null;
      e.win = e.lastS = e.lastT = null;
    } else if (!hasS) {
      // No active session window: no usage is happening, so the weekly value cannot move
      // (apart from whatever the last window added after our final sample of it).
      const kk = kOf(e);
      if (kk && prevOK && s.W === e.lastW) {
        let R = 0;
        if (e.win != null && e.lastS != null && e.lastT != null) {
          R = Math.min(100 - e.lastS, (2 * e.maxRate * Math.max(0, e.win - e.lastT)) / 60000 + 0.5) * (kk.k + kk.err);
        }
        wa = Math.max(e.wa, lo);
        wb = Math.min(e.wb + R, hi);
        if (wa > wb) { wa = lo; wb = hi; }
      }
      e.win = e.lastS = e.lastT = null;
      e.xa = e.xb = null;
    } else {
      const inWin = prevOK && e.win != null && e.lastS != null && e.lastT != null &&
        Math.abs(s.sReset - e.win) < WIN_TOL && s.S >= e.lastS;
      if (inWin) {
        const dS = s.S - e.lastS;
        e.sumDS += dS;
        e.sumDW += s.W - e.lastW;
        e.pairs++;
        if (!e.runCounted) { e.runs++; e.runCounted = true; }
        const dtMin = (t - e.lastT) / 60000;
        if (dtMin > 0) e.maxRate = Math.max(e.maxRate, dS / Math.max(1, dtMin));
      } else {
        e.runCounted = false;
      }
      const kk = kOf(e);
      if (kk) {
        const kmax = kk.k + kk.err;
        const kmin = Math.max(0, kk.k - kk.err);
        // x is anchored at this sample's session reading; what do we already know about it?
        let x = null;
        if (inWin) {
          if (e.xa != null) {
            const dS = s.S - e.lastS;
            x = [e.xa + kmin * dS, e.xb + kmax * dS];
          }
        } else if (prevOK) {
          if (e.win != null && e.lastS != null && e.lastT != null && s.sReset > e.win + WIN_TOL) {
            // Window rolled over: weekly at the new window's start is the value at our last
            // sample plus whatever the old window added before it ended.
            const R = Math.min(100 - e.lastS, (2 * e.maxRate * Math.max(0, e.win - e.lastT)) / 60000 + 0.5);
            x = [e.wa + kmin * s.S, e.wb + (kk.k + kk.err) * R + kmax * s.S];
          } else if (e.win == null) {
            x = [e.wa + kmin * s.S, e.wb + kmax * s.S]; // session was idle: weekly carried over
          }
        }
        const dh = isWhole(s.S) ? 0.5 : 0; // session rounding half-width (0 if the server gave decimals)
        const cxa = lo - kmax * dh;
        const cxb = hi + kmax * dh;
        let xa = cxa, xb = cxb;
        if (x) {
          xa = Math.max(cxa, x[0]);
          xb = Math.min(cxb, x[1]);
          if (xa > xb + 1e-9) { e.conflicts++; xa = cxa; xb = cxb; } // data contradicts the model
          else if (xa > xb) xb = xa;
        }
        e.xa = xa; e.xb = xb;
        wa = Math.max(lo, xa - kmax * dh);
        wb = Math.min(hi, xb + kmax * dh);
      } else {
        e.xa = e.xb = null;
      }
      e.win = s.sReset; e.lastS = s.S; e.lastT = t;
    }

    e.lastW = s.W;
    e.wa = wa; e.wb = wb;
    if (e.sumDS > 4000) { // slow decay so old weeks stop dominating
      e.sumDS /= 2; e.sumDW /= 2;
      e.runs = Math.ceil(e.runs / 2); e.pairs = Math.floor(e.pairs / 2); e.conflicts = Math.floor(e.conflicts / 2);
    }
    return e;
  }

  // What to display. status: exact | ok | coarse | learning | distrust
  function readEstimate(e, W) {
    const out = { used: W, half: 0.5, inferred: false, exact: false, k: null, kErr: null, status: "learning" };
    if (!e) return out;
    if (e.exact) return Object.assign(out, { half: 0, exact: true, status: "exact" });
    const kk = kOf(e);
    if (kk) { out.k = kk.k; out.kErr = kk.err; }
    if (!kk || e.wa == null) return out;
    if (e.pairs >= 20 && e.conflicts > 3 && e.conflicts > 0.1 * e.pairs) return Object.assign(out, { status: "distrust" });
    // The midpoint of a valid interval is never worse than the bare integer, so use it whenever
    // the interval is meaningfully narrower than the rounding range; "coarse" flags a wide +-.
    const half = (e.wb - e.wa) / 2;
    if (half >= 0.45) return Object.assign(out, { half, status: "coarse" }); // no better than the integer
    return Object.assign(out, { used: (e.wa + e.wb) / 2, half, inferred: true, status: half > MAX_HALF ? "coarse" : "ok" });
  }

  const api = {
    compute, fmtDuration, findWeekly, findSession, isUsageUrl,
    newEstimator, updateEstimator, readEstimate, kOf,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UsagePace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
