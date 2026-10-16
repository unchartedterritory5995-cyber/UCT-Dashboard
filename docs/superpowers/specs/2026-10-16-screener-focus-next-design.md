# Screener Focus: New today, pre-market mode, phones

Date: 2026-10-16. Owner approved the three directions and the pre-market price ruling in chat ("YES") the same day.
Builds on `2026-10-13-screener-focus-layout-design.md` and `2026-10-15-screener-live-relative-volume-design.md`.

## Why

Three workflow gaps, measured or observed on production on 2026-10-16:

1. A trader re-runs the same screens every morning. What they want first is **what changed**. Nothing in Focus says which names are new to a screen.
2. 08:00-09:30 ET is when traders prepare. Every live-volume starter is blank before 09:45 ET, and the live tier does not run before the open. So the screener is least useful in the window traders use it most.
3. Phones never get the Focus layout (`app/src/pages/Screener.jsx:99-101`, `!isPhone`). At 390 px a member sees about 30 screen buttons before the first result, and the floating hub controls and toast cover the list.

Out of scope:
- A setup quality score or ranking. The owner paused that work on 2026-09-07, and explanation facts are not a quality score.
- Intraday membership history.
- Pre-market volume. The feed carries no whole-market pre-market volume (`live_prices.py:234-262`).

## 1. New today

**Meaning (one definition everywhere).** A row is **New** when it is in the screen's current results and was not in the screen's results at the **previous session's** nightly build.
- Before the open, the current results are the nightly ones, so New means "entered on yesterday's close".
- During the session, New also includes names that entered today on live values.
- The label always names the session it compares against: "New since Oct 15 close".

**Record.** A new table, `screen_membership`, holds one row per `(spec_hash, snapshot_date)`:
- `tickers`: a JSON list;
- `n`;
- `state`: `ok`, or `too_wide` for more than 2,000 rows, which stores the count only.

The table keeps the newest 5 dates per hash.

**Who is recorded.** Every starter (`saved_screens.starters()`) and every member's saved screen, deduplicated by hash.
- A job runs once the 03:00 build finishes successfully. It is chained after the build in `register_screener_jobs._run`, with no separate clock, so it can never read a half-built snapshot.
- Each spec runs through the same query path the scan uses (`scr_query`), with no user list joins.
- A spec carrying a `list` filter (a member's watchlist) is skipped, because its answer is per user.

**Hash.** `spec_hash = sha256` of canonical JSON (sorted keys) of the spec's **criteria only**: `filters`, `logic` and `rank`. Sort, view and columns are excluded, the same split as `screenSigOf` in `FocusScreener.jsx`. One function owns the hash, server side. The client never computes it.

**Read.** `POST /api/screener/membership-diff {spec}` (paid) returns `{state, as_of, prev_as_of, entered, exited, new_since_label}`. `state` is one of:
- `ok`;
- `no_history`: fewer than 2 recorded dates, or never recorded;
- `too_wide`;
- `live_screen`: the spec reads `rvol_live`. That column is blank in every nightly build by design, so a nightly comparison would mark every row New. The screen says "New markers follow the overnight build; this screen is live" and shows no markers;
- `unsaved`: an edited ad-hoc spec matching no recorded hash. It shows no markers and no message until saved.

**UI (Focus list).**
- A small "New" pill on the row, carrying a text label for screen readers.
- A list-head line, "4 new · 3 dropped". "dropped" opens a popover naming the exited tickers, with a maximum of 12 and "+N more".
- A "New only" toggle in the list head filters the loaded rows client side.

**Flag:** `SCREENER_NEW_TODAY_ENABLED`, read per request. It is off by default; off means no job, no route answer (404) and no UI.

## 2. Pre-market mode

**Owner ruling (2026-10-16).** Extended-hours prints may enter the screener **only** through new pre-market columns, labelled as pre-market. The 22 regular live columns and their anchor contract (`live_tier.py`) are unchanged, and `run_sweep` still refuses outside the regular session.

**Writer.** `live_tier` gains a separate pre-market sweep that runs while `_session() == "pre_market"` (04:00-09:30 ET), every 60 s.
- It reads the same cached `scan_volume.full_market_snapshot()`. No new provider call is made.
- It writes a separate table, `screener_premarket(ticker, session_ymd, premarket_price, premarket_chg_pct, premarket_asof)`.
- `premarket_chg_pct = last_price / prev_close - 1`.
- A row is written only when the symbol has traded **today in pre-market**, meaning a last-trade time at or after 04:00 ET today. Otherwise `last_price` is yesterday's close and the change would read 0.0% as if measured.
- The sweep never touches `screener_live` or `screener_rows`, and takes no build lock (it reads no anchors).
- Before writing, confirm whether the snapshot parse exposes the last-trade timestamp. If not, add it to the parse in `massive.py` (field `lastTrade.t`). This is the one change outside the screener.

**Serving.** `premarket_price` and `premarket_chg_pct` join like the live overlay (LEFT JOIN on ticker). They are served only while the session is pre-market, for today's `session_ymd`, with `premarket_asof` under 3 minutes old. Otherwise they are NULL. They are filterable and sortable columns, labelled "Pre-mkt %" and "Pre-mkt price".

**Starters (group "Morning prep").**
- *Gapping pre-market*: `premarket_chg_pct >= 3`, `dollar_vol_30d >= 10M`, `price >= 5`, sorted by `premarket_chg_pct` descending.
- *Setups gapping pre-market*: `base_pivot_px` present, `premarket_chg_pct >= 2`, `dollar_vol_30d >= 10M`, same sort.
- Outside 04:00-09:30 both answer empty with "Pre-market screens fill from 4:00 to 9:30 ET". This follows the `emptyReason.js` pattern used for live-volume screens.

**Label.** The data label reads "Pre-market · 8:42 AM" off the pre-market receipt's `as_of`, in the same component as "Live · 10:09 AM".

**Disclosure.** The filter description says plainly that there is no pre-market volume, so these screens cannot filter on it.

**Flag:** `SCREENER_PREMARKET_ENABLED`, read per call. It is off by default; off means no sweep and NULL columns.

## 3. Focus on phones

Behind `SCREENER_FOCUS_PHONE_ENABLED`. When on, `Screener.jsx` drops the `!isPhone` exclusion. At 640 px and below the Focus layout renders as one column:
- **List first**, full width, with the list head (screen name and count, sort) pinned at the top.
- **Tapping a row** opens the chart as a full-screen sheet with the header (ticker, price, change, setup line). Swiping up or down, or the ↑ and ↓ buttons in the header, step to the next or previous stock using the same `useFocusSelection` state. "Back" returns to the list with the same row selected and in view.
- **Screen picker** as a bottom sheet. **Filters drawer** full screen.
- **Hub launcher and toast** (another workstream's components) are not modified. The list gets bottom padding equal to the launcher's footprint plus the safe-area inset, so no row is ever under it.
- Tap targets are at least 44 px. No horizontal overflow at 390 px.

Tablet (641-1024 px) is unchanged: it measured clean on 2026-10-16.

## Testing and verification

- **New today:**
  - hashing is stable across key order and ignores sort and view;
  - diff states (`ok`, `no_history`, `too_wide`, `live_screen`, `unsaved`);
  - the job skips list-filter specs and runs only after a successful build;
  - a first-ever record says nothing.
  - Frontend: the pill, the head line, the dropped popover cap and "New only".
- **Pre-market:**
  - the sweep writes only in `pre_market`;
  - no write without a today pre-market trade;
  - serving cuts off at 09:30 and at 3 minutes of age;
  - `screener_live` and `screener_rows` are never written (asserted);
  - starters answer empty with the reason outside the window.
- **Phone:** vitest for the layout switch, sheet stepping and back-to-list.
- **Mutation proof** for each new guard, per house rules.
- **Production walks** (smoke@, Playwright):
  - New today on the morning after its first two recorded builds;
  - pre-market between 08:00 and 09:30 ET;
  - phone at 390 px and tablet at 820 px, with screenshots;
  - each before its flag is turned on for everyone.

## Rollout

Each piece ships dark behind its own flag, then is verified on production as smoke@ and armed by the owner. Order: New today, then pre-market, then phones. Each is independent of the others.
