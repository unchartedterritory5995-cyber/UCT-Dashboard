# Foreground bars observation — protocol

**⛔ Fire/no-fire is retired as a discriminator.** It was the design when we
believed a prefetched neighbour would produce a client-side cache hit and skip the
chart's fetch. The read-path check falsified that: `prefetchBars` writes SWR under
`…&bars=600&warm=1`, the chart reads `…&bars=<_primaryBars>` with **no `&warm`**
(`StockChart.jsx:5322`). Different keys. **The chart fetches on transition
regardless of what the prefetcher did**, so a non-`warm` row is a *transition*, not
a *cold* one, and counting them discriminates nothing.

**What current+2 actually does is warm the server.** Its `&warm=1` request makes
the server build and cache the bars, so the chart's later fetch under its own key
is served from a server cache tier instead of built cold. That difference is
invisible in a request count.

**It is not invisible in `Server-Timing`.**

---

## ⭐ The instrument: `Server-Timing` names the serving tier, per request

`/api/bars` emits (`api/routers/bars.py:669`):

```
Server-Timing: bars;desc="<serve-layer>";dur=<server-compute-ms>
```

The in-file comment states the intent exactly: *"expose server-compute ms + which
cache tier served, so cold vs warm (and cold-fetch vs inflight-wait vs disk) is
observable in prod devtools / curl — the cold path was previously unmeasured."*

Complete label set (`_mark_serve` call sites):

| `desc` | Meaning |
|---|---|
| `mem` | server in-memory hit — hottest |
| `sqlite` | served from `bars.db` |
| `fetch` | **cold upstream provider fetch** — the expensive path |
| `inflight-wait` | waited on another request's in-flight fetch |
| `cold-bg` | cold, backgrounded |
| `delta` / `delta-async-heal` | incremental update path |
| `stale-swr` | stale-while-revalidate |
| `warm-mem` / `warm-sqlite` | a `&warm=1` request that found the server **already warm** — it warmed nothing |
| `warm-shed` | a `&warm=1` request **shed** with a fast 503 under load — it warmed nothing |
| `index` / `breadth` / `yf-only` | other serve paths |

**This answers W1 vs W2 per request, directly, with no inference and no liquidity
confound** — which is why the TTFB-comparison design is dropped. Sub-metrics
localise a slow serve to its phase; they ride the same header.

`Server-Timing` is a response header, so it is captured in the HAR.

---

## Validity gates — all three must pass or the run is void

1. `window.__vis` never contained `"hidden"`
2. shell attribute `"1"` at start **and** end
3. **Phase B non-`warm` count > 0** — proves the filter/capture sees on-demand
   fetches at all

⚠️ Gate 3 no longer means "the targets were cold." The chart fires either way;
coldness shows in `Server-Timing`, not in the presence of a row. A zero here means
**the capture is blind**, not that the targets were warm. Void and redo.

⛔ **There is no numeric threshold that decides close vs continue.** The code
reading already answered *what current+2 does*; this run only annotates *how much*.
Anyone reading the closure later should not think a number was the deciding factor.

---

## Setup

**1 · Phone width.** Resize so the viewport is 390 wide.

**2 · Confirm the phone shell.** The attribute is on `<html>` — set by
`MobileChartsApp.jsx:107`, removed on unmount, so it is live:

```js
document.documentElement.getAttribute('data-mobile-chart-shell')   // expect "1"
```

Null ⇒ you're on the desktop workspace; stop and narrow further.

**3 · Arm the visibility guard.**

```js
window.__vis = [document.visibilityState]
document.addEventListener('visibilitychange',
  () => window.__vis.push(document.visibilityState))
```

**4 · Network tab.** Filter `/api/bars/`. **"Disable cache" UNCHECKED.**
**"Preserve log" CHECKED** — the HAR must span both phases.

**5 · Enter the review session.** `/screener` → Review charts. The cinematic
intro plays on **every** page load (~9.3s) — click Skip or wait it out. Gate on the
chart being on screen, never on a count of seconds.

**6 · Let the first chart paint, then drop the phase marker.** Do **not** clear the
log this time — Preserve log is on and the markers separate the phases instead.

---

## Phase markers

One deliberate request per boundary, findable in the HAR, nothing else touched.
Paste each into the Console at the moment it says:

```js
fetch('/api/health?r5=A_START')   // after the first chart has painted
fetch('/api/health?r5=A_END')     // after the last Phase A interaction
fetch('/api/health?r5=B_START')   // before the first far jump
fetch('/api/health?r5=B_END')     // after the last far jump
```

`/api/health` is unauthenticated and trivial, and the `r5=` query param makes each
marker unique in the HAR. Everything before `A_START` — including the first chart's
own legitimate cold load — is excluded by the parse.

---

## Phase B first — the capture control

~3 feed selections to symbols **well outside the ±2 window**.

⭐ **Draw them from the same population as the Phase A neighbours** —
screener-adjacent names of similar liquidity. **Not** deliberately obscure ones.
Server-cache hotness is driven by all traffic, not just ours, so an obscure name
would confound "cold because nobody warmed it" with "cold because nobody looks at
it." Client-side coldness is no longer the requirement; **server-side
comparability is**.

## Then Phase A

~10 transitions at genuine reading pace — actually read each chart. Then open the
feed and select a nearby symbol.

---

## What the run produces — findings, not switches

| Observable | What it tells us |
|---|---|
| Phase A `&warm=1` count | **The prefetcher's pulse.** Zero in a *visible* tab means it isn't running in the foreground either — a finding on its own, and what would retroactively explain §P2. |
| `Server-Timing` on the `&warm=1` rows | `warm-mem` / `warm-sqlite` ⇒ the server was already warm and prefetch warmed **nothing**. `fetch` / `cold-bg` ⇒ it genuinely built something. `warm-shed` ⇒ shed under load. |
| `Server-Timing` on Phase A non-`warm` rows | Which tier served the chart's own fetch after a preceding warm |
| Same for Phase B non-`warm` rows | The comparison population |
| Phase A non-`warm` count | **Predicted nonzero.** Zero ⇒ something else served the chart — see the feed finding below. |
| `dur=` values | Server compute ms per tier — bounds the benefit (see below) |

**The bound worth writing into the closure:** current+2's benefit is bounded by
*(server cold-build time − server cache-hit time)* for the symbol in question. For
a symbol the server already holds hot, that bound is **~0**. That is the strongest
"expected small" statement available, and it comes from the code rather than from
reasoning.

---

## ⚠️ Pre-registered: the feed is a client-tier warmer and current+2 is not

Established by reading, before the run: `ReviewFeedCard.jsx:67` renders a full
`<StockChart sym={sym} tf={tf} …>` per row with no `bars` override. So each feed
row fetches under **the same key construction the main chart reads** — same sym,
same `tf`, same `_primaryBars`, **no `&warm`**.

⇒ **Opening the feed populates the main chart's SWR key for every visible row.**
The feed does the client-tier warming current+2 was designed to do and doesn't.

This holds as long as the feed's `tf` equals the main chart's; if a run shows
otherwise, say so. It is a finding regardless of the numbers and belongs in the
closure.

---

## Capture — HAR, not hand-counting

At the end of the run, Network panel → right-click → **"Export HAR (sanitized)"**,
which strips cookies and auth headers.

⛔ **If this Chrome build offers only plain "Export HAR", stop and tell me.** An
unsanitized HAR carries the `uct_session` cookie — a **live 30-day credential** —
in every request header.

Save to:

```
C:\Users\Patrick\uct-worktrees\mobile-impl\tools\r5_har\run.har
```

`tools/r5_har/` is gitignored (`.gitignore:135`, verified with `git check-ignore`)
and the entry landed **before** the run, so there is no cleanup race. **The HAR is
deleted once the numbers are in the trail.**

I parse it: warm/non-warm split, per-phase counts, `Server-Timing` tier
distributions, warm-request durations, TTFB, and any cache headers.

## Paste alongside the HAR

```
window.__vis                     : ___
shell attribute at start / end   : ___ / ___
Phase B targets                  : ___
Used the app earlier today       : yes / no
Sanitized HAR available          : yes / no
OPTIONAL — Performance panel, 3 Phase A transitions, main-thread cost: ___
```
