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
3. **Any non-`warm` `/api/bars/` row anywhere after `A1_START`** — proves the
   capture sees on-demand fetches at all

⚠️ Gate 3 is deliberately **not** "Phase B non-`warm` > 0". A correctly working
feed paints a row when you centre it to tap it, so B's selection fetches are
*predicted to be zero* — and the old gate would have voided the run for the feed
working. A1 should produce non-`warm` rows (the chart fires on transition); if it
somehow doesn't, A2's feed paint burst will. **Zero across the entire run means
the capture is blind.** That is the only void condition from this gate.

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

**A2 — three open→paint→select cycles.** Selecting **closes and unmounts** the
feed (`pickFromFeed` → `setFeedOpen(false)`, and the mount is gated on `feedOpen`),
so each selection needs the feed reopened:

```
open feed → window paints → r5=A2_SEL_1 → tap it  (feed closes)
reopen    → window paints → r5=A2_SEL_2 → tap it  (feed closes)
reopen    → window paints → r5=A2_SEL_3 → tap it  (feed closes)
```

⛔ **Interval position alone cannot separate feed paints from main-chart
fetches** — they produce **identical URLs** (same sym, tf, bars, no `&warm`). And
a reopen repaints a fresh window around the new index, so paints land *after* a
marker too. **The parse discriminates by SYMBOL, not by time:**

| after `A2_SEL_n` / `B_SEL_n` | Reading |
|---|---|
| non-`warm` fetch for **the symbol you tapped** | **the main chart's own fetch** — predicted **zero**, it was already painted |
| non-`warm` fetch for **any other symbol** | the feed repainting its window |

Everything before `A2_SEL_1` is the initial paint burst. **Paste which symbol you
tapped at each marker** — that is what makes the pairing possible.

The predicted zero on the tapped symbol is the `ReviewFeedCard.jsx:67` finding,
observed rather than read.

```js
fetch('/api/health?r5=A2_END')
fetch('/api/health?r5=B_START')
```

**B — ~3 far jumps to rows NOT painted in A2.** Screener-adjacent, similar
liquidity — **not** deliberately obscure. Server-cache hotness is driven by all
traffic, so an obscure name would confound "cold because nobody warmed it" with
"cold because nobody looks at it."

**Per target, three times** — scroll to it, let it paint, then:

```js
fetch('/api/health?r5=B_SEL_1')   // ... then tap it.  (B_SEL_2, B_SEL_3)
```

- non-`warm` rows **before** each `B_SEL_n` → scroll paints
- after `B_SEL_n`: **same symbol-pairing rule as A2** — a fetch for the symbol you
  tapped is the main chart's (**predicted zero**); a fetch for any other symbol is
  the feed repainting. Paste the tapped symbol for each `B_SEL_n` too.

```js
fetch('/api/health?r5=B_END')
```

### ⭐ Two facts about the feed that set your expectations

**The feed is not mounted at session entry.** `MobileChartsApp.jsx:472` renders it
under `{feedOpen && review.session && …}`, with the in-file reason: *"a feed
rendered closed would be N charts nobody asked for."* **So A1 is clean at entry** —
nothing peeks, nothing pre-paints, and you do not need to close anything before
`A1_START`.

**The feed does NOT paint every visible row.** `feedWindow.js`: `FEED_RADIUS = 1`,
`FEED_MAX_LIVE = 3`. Only the centred card ±1 hold live charts — the budget is
enforced by windowing *before* the staggered-mount queue, deliberately, because
that hook "NEVER unmounts a live id."

⭐ **But the WARMING footprint is far wider than 3.** `FEED_MAX_LIVE` bounds live
*charts*, not SWR *cache entries*. `App.jsx:261`'s `SWR_CONFIG` sets no `provider`
— SWR's default global `Map`, no eviction on unmount, no TTL — and it is the only
`<SWRConfig>` in the app. So when the window rolls and a row unmounts, **its bars
stay in SWR under the chart's key for the rest of the session**.

⇒ The record's sentence is the wide one: **the feed paints a rolling window of 3,
and every row ever centred stays client-warm until the page reloads.**
(`prefetchBars.js:204` confirms the in-memory cache is "wiped on every page
reload".)

Consequences for the parse: A2's paint burst is a rolling ≤3, not "all visible
rows"; in B, centring a target paints **that row and its two neighbours** — expect
~3 fetches per B target, not one; and a symbol centred earlier in the run will
**not** refetch later, which the symbol-pairing rule already handles.

---

## The parse — what I do with the HAR

Per phase (and per marker interval): warm / non-`warm` counts, `Server-Timing`
tier distribution, `dur=` values, `timings.wait`.

**Reported, never assumed:**

- **The `tf` observed in the `/api/bars/` URLs.** Do not assume `D`. A persisted
  non-daily tf on the chart widget puts the **whole run in the count-key mismatch
  case**, and the parse must say so rather than quietly reading it as Daily.
- **`uct.barsHistory.enabled`** from the paste-alongside. `"0"` ⇒ the Daily
  key-match does not hold for this browser; flag it.
- **The `bars=` value on warm rows vs chart rows.** On Daily with the split on
  both should read `600`. If they differ, that is the third mismatch — observed,
  not predicted — and it goes into candidate 3a.

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
Symbol tapped at A2_SEL_1 / 2 / 3   : ___ / ___ / ___
Symbol tapped at B_SEL_1 / 2 / 3    : ___ / ___ / ___
Used the app earlier today          : yes / no
Sanitized HAR available             : yes / no
OPTIONAL — Performance panel, 3 A1 transitions, main-thread cost: ___
```
