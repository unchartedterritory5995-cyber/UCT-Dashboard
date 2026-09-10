# Foreground bars observation — protocol

**⛔ Fire/no-fire is retired as a discriminator.** `prefetchBars` writes SWR under
`…&bars=600&warm=1`; the chart reads `…&bars=<_primaryBars>` with **no `&warm`**
(`StockChart.jsx:5322`). Different keys, so the chart fetches on transition
regardless. A non-`warm` row is a *transition*, not a *cold* one.

**What current+2 does is warm the server** — and whether that warm lands on the
entry the chart reads is **conditional on timeframe**. See the next section; it is
the single most important thing established before this run.

---

## ⭐ Established by reading — the timeframe conditional

**Server bars cache is COUNT-KEYED.** Memory: `cache_key = f"bars_{ticker_up}_{tf}_{bars}"`
(`bars_fetch.py:1704, 2237, 2664, 2706`). Disk: `disk_cache.get(ticker, tf, bars)`.
The SQLite tier is row-based per `(ticker, tf, ts)` and is *not* count-keyed.

**The review session opens Daily.** `useReviewSession(symbol, { tf = 'D' })`
(`:22`) and the mobile shell's `chartWidget?.opts?.tf || 'D'`
(`MobileChartsApp.jsx:155`). Intraday is **not** the common path.

**On Daily, `_splitOn` is true for effectively everyone.**
`BARS_HISTORY_SPLIT_ROLLOUT_PCT = 100` (`StockChart.jsx:990`), so
`_primaryBars = Math.min(barCount, FIRST_PAINT_BARS) = 600` — **the same 600 the
prefetch sends.**

⇒ **On Daily the server cache keys MATCH** (`bars_SYM_D_600` for both), so
current+2's warm does land on the entry the chart reads. Current+2 works at the
server tier on the default path.

⇒ **On any intraday timeframe `_splitOn` is false**, the chart asks for
`barCount` (not 600), the server keys differ, and **current+2 warms an entry the
chart never reads — zero benefit.**

⚠️ A browser that opted out via `localStorage['uct.barsHistory.enabled'] = '0'`
flips Daily into the mismatch case too. **Record the value** (console check below).

---

## ⭐ The instrument: `Server-Timing` names the serving tier, per request

`/api/bars` emits (`api/routers/bars.py:669`):

```
Server-Timing: bars;desc="<serve-layer>";dur=<server-compute-ms>
```

| `desc` | Meaning |
|---|---|
| `mem` | server in-memory hit — hottest |
| `sqlite` | served from `bars.db` |
| `fetch` | **cold upstream provider fetch** — the expensive path |
| `inflight-wait` | waited on another request's in-flight fetch |
| `cold-bg` | cold, backgrounded |
| `delta` / `delta-async-heal` | incremental update path |
| `stale-swr` | stale-while-revalidate |
| `warm-mem` / `warm-sqlite` | a `&warm=1` request that found the server **already warm** — warmed nothing |
| `warm-shed` | a `&warm=1` request **shed** with a fast 503 — warmed nothing |
| `index` / `breadth` / `yf-only` | other serve paths |

Response header ⇒ captured in the HAR.

---

## Pre-flight — 30 seconds, before the real run

I cannot verify from the repo what your Chrome build's sanitizer does. Rather than
guess:

1. Load any page with DevTools Network open.
2. Console: `fetch('/api/health?r5=PREFLIGHT')`
3. Export HAR **(sanitized)** → save as `tools/r5_har/preflight.har`
4. Tell me it's there.

I'll confirm the sanitized export preserves **`r5=` query params** and
**`Server-Timing` response headers**. If `Server-Timing` is stripped, the fallback
is the HAR's `timings.wait` and we're back to TTFB with the liquidity caveat —
better to know before than after.

---

## Validity gates — all must pass or the run is void

1. `window.__vis` never contained `"hidden"`
2. shell attribute `"1"` at start **and** end
3. **Phase B non-`warm` count > 0** — proves the capture sees on-demand fetches

⚠️ Gate 3 does **not** mean "the targets were cold." The chart fires either way;
coldness shows in `Server-Timing`. Zero here means the capture is **blind**.

⛔ **No numeric threshold decides close vs continue.** The code reading answered
*what current+2 does*; this run annotates *how much*.

---

## Setup

**1 · Phone width.** Viewport 390 wide.

**2 · Console checks — paste all three, record the output:**

```js
document.documentElement.getAttribute('data-mobile-chart-shell')   // expect "1"
localStorage.getItem('uct.barsHistory.enabled')                    // null | "1" | "0"
window.__vis = [document.visibilityState]
document.addEventListener('visibilitychange',
  () => window.__vis.push(document.visibilityState))
```

`uct.barsHistory.enabled === "0"` means the split is OFF for this browser and the
Daily key-match above does **not** hold — say so, it changes the reading.

**3 · Network tab.** Filter `/api/bars/` if you like — display only, the HAR
captures everything regardless. **"Disable cache" UNCHECKED. "Preserve log"
CHECKED** (the HAR must span all three phases).

**4 · Enter the review session.** `/screener` → Review charts. The cinematic intro
plays on **every** page load (~9.3s) — click Skip or wait. Gate on the chart being
on screen, never on seconds.

**5 · Do not clear the log.** Markers separate the phases; everything before
`A1_START` — including the first chart's legitimate cold load — is excluded by the
parse.

---

## Phases — A1 → A2 → B, in that order

⛔ **Order matters and B is no longer first.** Opening the feed populates the main
chart's SWR key for every visible row, so any feed exposure before A1 contaminates
it. With the HAR capturing everything, running B first no longer buys anything.

Paste each marker into the Console at the moment it says.

```js
fetch('/api/health?r5=A1_START')   // after the first chart has painted
```

**A1 — ~8 next/prev at reading pace. Do NOT open the feed.**
Pure current+2 territory: does the chart fire, and what tier serves it after a
preceding `&warm=1` for that symbol.

```js
fetch('/api/health?r5=A1_END')
fetch('/api/health?r5=A2_START')
```

**A2 — open the feed, let visible rows paint, then select ~3 rows that were
visible.** Feed-warmer territory.
**Prediction:** those selections produce **no** non-`warm` `/api/bars/` row for the
main chart, because the feed already fetched under the same key. That confirms the
`ReviewFeedCard.jsx:67` finding empirically rather than by reading.

```js
fetch('/api/health?r5=A2_END')
fetch('/api/health?r5=B_START')
```

**B — ~3 far jumps via the feed to rows that were NOT visible in A2** (scroll past
without letting them paint, or pick from further down). Screener-adjacent, similar
liquidity — **not** deliberately obscure. Server-cache hotness is driven by all
traffic, so an obscure name would confound "cold because nobody warmed it" with
"cold because nobody looks at it."

```js
fetch('/api/health?r5=B_END')
```

---

## The parse — what I do with the HAR

Per phase: warm / non-`warm` counts, `Server-Timing` tier distribution, `dur=`
values, `timings.wait`.

**Plus the pairing, per A1 transition** — pair the preceding `&warm=1` row for a
symbol with that symbol's own non-`warm` chart row:

| warm row `desc` | chart row `desc` | Reading |
|---|---|---|
| `warm-mem` / `warm-sqlite` | anything | server was already hot; the warm did nothing either way |
| `warm-shed` | anything | warm was shed under load; warmed nothing |
| `fetch` / `cold-bg` | `mem` / `sqlite` | **the warm worked** — it built, the chart read it |
| `fetch` / `cold-bg` | `fetch` / `cold-bg` / `inflight-wait` | **the warm populated an entry the chart didn't read** — count-key mismatch, observed |

**Pre-registered:** on Daily with the split on, the keys match, so the bottom row
should be **rare**. If it is common on Daily, either `uct.barsHistory.enabled` is
`"0"` or something else diverges — and that goes into candidate 3a as a third
mismatch, with the closure's bound becoming *"server-tier benefit zero on intraday,
bounded on D/W/M."*

---

## Capture

Network panel → right-click → **"Export HAR (sanitized)"** → save to:

```
C:\Users\Patrick\uct-worktrees\mobile-impl\tools\r5_har\run.har
```

⛔ **If your Chrome offers only plain "Export HAR", stop and tell me.**
Unsanitized carries `uct_session` — a live 30-day credential — in every request
header.

`tools/r5_har/` is gitignored (`.gitignore:135`, `git check-ignore` verified),
landed before the run. **Deleted once the numbers are in the trail.**

## Paste alongside

```
window.__vis                        : ___
shell attribute start / end         : ___ / ___
uct.barsHistory.enabled             : ___   (null | "1" | "0")
Phase B targets                     : ___
Used the app earlier today          : yes / no
Sanitized HAR available             : yes / no
OPTIONAL — Performance panel, 3 A1 transitions, main-thread cost: ___
```
