# Weekly Usage Pacer

Small badge (bottom-right of claude.ai) showing how much of your weekly usage you can still spend today.

- Daily pace = 100% / 7. Goal by end of today = (day number / 7) x 100.
- Days are aligned to your weekly reset time (reset minus 7 days = start of day 1).
- Left today = goal - used. Unused budget carries into the next day automatically, and everything restarts at the weekly reset.
- Green: comfortably under. Amber: under a quarter of a day's budget left. Red: over pace.
- Click the badge to show or hide details.

## Install (Brave)

1. Unzip, then open `brave://extensions` and turn on Developer mode.
2. Load unpacked and pick the `usage-pacer` folder.
3. Reload claude.ai (and the installed PWA window).
4. Open Settings > Usage once. The extension learns where the numbers come from, then refreshes every minute.

## Sub-1% estimate

The API reports weekly and session usage as whole percents. If both meters measure the same usage, weekly% moves by a fixed ratio of session% (session cap / weekly cap). The extension learns that ratio from paired readings, then uses the session meter to place the weekly value between its integer steps.

- The badge shows `~` and the details show `(+-x.xx)` when the estimate is in use. The reported integer is always listed too.
- It needs roughly 10 session-% of usage observed with the extension running before it starts, and gets tighter after each weekly tick.
- It assumes the backend rounds to the nearest integer. If it truncates instead, set `ROUND_MODE = "floor"` in `pace.js`.
- It turns itself off ("Estimate off") if the two meters repeatedly contradict each other. If the API ever returns real decimals, those are used directly.
- A small ratio (session cap much smaller than weekly cap) gives the best resolution. A ratio near 1 gives almost none.

## Notes

- Claude has no public usage API. The extension reads the same JSON the Usage page loads, so a site change can break it.
- It only reads from claude.ai and stores the last reading locally (chrome.storage). Nothing is sent anywhere.
- If the badge shows an implausibly small percentage (e.g. 0.4% when you have used 40%), the site reports a 0-1 fraction; multiply by 100 in `findWeekly` in `pace.js`.
