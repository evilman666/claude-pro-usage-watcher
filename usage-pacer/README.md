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

## Notes

- Claude has no public usage API. The extension reads the same JSON the Usage page loads, so a site change can break it.
- It only reads from claude.ai and stores the last reading locally (chrome.storage). Nothing is sent anywhere.
- If the badge shows an implausibly small percentage (e.g. 0.4% when you have used 40%), the site reports a 0-1 fraction; multiply by 100 in `findWeekly` in `pace.js`.
