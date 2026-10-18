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

## Install (Firefox / Floorp)

Needs Firefox or Floorp 128+ (for MAIN-world content scripts). Firefox uses `manifest.firefox.json`; the code is shared.

Temporary (any build, lasts until restart):
1. Run `./build-firefox.sh` (or copy the files and rename `manifest.firefox.json` to `manifest.json` in a separate folder).
2. Open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on, and pick `manifest.json` from that folder (or the zip).

Permanent: the add-on is unsigned, so release Firefox rejects it. Either use Floorp/Developer Edition/Nightly/ESR with `xpinstall.signatures.required` set to `false` in `about:config` and install the zip from `about:addons` > gear > Install Add-on From File, or sign it for self-distribution via addons.mozilla.org (unlisted).

Check the add-on has access to claude.ai under `about:addons` > Weekly Usage Pacer > Permissions. Then continue from step 3 above.

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
