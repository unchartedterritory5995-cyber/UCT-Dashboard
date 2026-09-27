# Protocols C and H, executed in a real foreground browser — 2026-09-26 ~02:48–03:0xZ

**Owner item 3 is closed by this run.** The owner moved a Chrome window to a second screen and
brought it to the front, which is the one thing that made these measurable. Both measurements are
the ones D-05 §8 reserved for "an operator task, not a headless one".

⛔⛔ **VALIDITY FIRST, because it is the whole reason this run counts and an earlier attempt did
not.** `document.visibilityState` was read **before** every measurement and was **`visible`**
throughout. An attempt twenty minutes earlier read `hidden` and was abandoned without taking a
number, because a hidden tab throttles timers and defers paint, so any figure from it measures
Chrome's throttling rather than the app. ⚠️ `document.hasFocus()` was **false** the whole time,
which is expected and harmless: Chrome gates frame and timer throttling on *visibility*, not on
keyboard focus.

Browser: the owner's own Chrome, signed in as the owner. ⛔ Identity was checked first —
`/api/auth/me` returned a `gmail.com` address with `role: admin`, **not**
`smoke@uctintelligence.internal` — because this repo's standing rule is that the owner's own
Chrome is never a smoke-account browser and the email domain must be read before acting "as the
owner". Viewport 2291 × 1248, DPR 1, HTTP/3 throughout.

---

## 1 · Protocol H — the 16-cell grid harness (`?gridspike=16&tf=D`)

`localStorage['uct.gridspike.last']`, verbatim:

```json
{"config":{"n":16,"tf":"D","startedAt":"2026-09-26T02:48:02.454Z","session":null},
 "allFramedMs":2582,"framed":16,"cellMedianMs":28,"cellP95Ms":82,
 "heap":{"base":33179252,"settled":261983475,"idle":78150793},
 "heapSettledDeltaMB":218,"heapIdleGrowthMB":-175,
 "sweep":{"invalid":true,"reason":"no crosshair events delivered"},
 "idleLongTasks":{"count":2,"worstMs":85,"windowMs":60000}}
```

⚠️ The URL's `&tf=D` was dropped in transit, but `config.tf` reads `"D"`, so the intended
timeframe was measured. 209 `<canvas>` elements were live on the page at peak.

### ⭐⭐ It moves the number this programme has been quoting, in both directions

| | recorded figure, quoted in D-05, C7-01 and ARCH-07 | measured tonight |
|---|---|---|
| 16 cells framed | **~900 ms** | **2,582 ms** (2.9× slower) |
| heap | **+63 MB** | **+218 MB settled**, then **+45 MB retained after idle** |

⛔ **"+63 MB" turns out to be ambiguous between two numbers that differ by 4.8×, and a capacity
budget needs to say which.** Settled peak is **+218 MB**; after the idle window the heap fell
from 262 MB back to 78 MB, i.e. **+45 MB retained** over a 33 MB base. So a 16-panel board costs
**~218 MB transiently and ~45 MB durably** — and the durable figure is *lower* than the recorded
one while the transient figure is 3.5× higher. Neither reading makes the old number right.

⭐ **The 2,582 ms is NOT framing cost.** `cellMedianMs` is **28** and `cellP95Ms` is **82**, so
sixteen cells at ≤3 concurrent is only ~450 ms of framing. The remaining ~2.1 s is data. **The
mount queue is doing its job; the cost is upstream of it.**

⭐ **The board is quiet once settled**, which is the reassuring half: **2 long tasks, worst 85 ms,
over a 60-second idle window.** A 16-panel board does not spin. That is the direct counter-measure
to the 2026-09-10 render-loop class, and it is the first time it has been measured on a board
rather than on a single surface.

⛔ **The hover sweep is INCONCLUSIVE, not zero.** `sweep.invalid: true`,
`reason: "no crosshair events delivered"` — no mouse was moved, so the harness correctly refused
to report a sweep figure rather than reporting 0. ⭐ **That refusal is the harness working**, and
the "hover sweep re-renders zero charts" contract in `GridChartCell`'s React.memo remains
unverified tonight. A real pointer sweep is what would close it.

---

## 2 · Protocol C — the page waterfall, and it ANSWERS the `/options-flow` load puzzle

The open question was why `/options-flow` twice missed a 45-second budget on a fresh pod during
market hours, when **both prior explanations failed their own falsifiers** — not pod age (3.11 s
DCL at 34 s old) and not new code chunks (3.69 s at 49 s old with changed hashes).

### 2.1 The document is not the problem

| | first load | control (second load) |
|---|---|---|
| TTFB | **63 ms** | — |
| DOMContentLoaded | **100 ms** | **113 ms** |
| First contentful paint | **140 ms** | — |
| `loadEventEnd` | **221 ms** | — |

### 2.2 ⭐⭐ The problem is 31 MB of cold packs, and the stall is SERVER-SIDE

Splitting each request into *stalled before send* / *server think time* / *download* is what
settles the mechanism:

| request | stall | **server** | download | size |
|---|---|---|---|---|
| `schwab/market-narrative` | **2 ms** | **20,768 ms** | 1 ms | 1 KB |
| `barspack/2026-09-25/hot` | **1 ms** | **10,896 ms** | 20 ms | 1,402 KB |
| `schwab/market-summary` | 2 ms | 10,685 ms | 2 ms | 0 KB |
| `j2/accounts` | 2 ms | 10,627 ms | 2 ms | 1 KB |
| `voice/settings` | 2 ms | 10,560 ms | 1 ms | 0 KB |
| `watchlist-alerts` | 2 ms | 10,554 ms | 1 ms | 1 KB |
| `ticker-tags`, `ticker-tags/public` | 3 ms | ~10,500 ms | 2 ms | 0 KB |

⛔⛔ **`stall` is 1–3 ms on every single call.** So this is **not** client queueing, not the
browser's connection limit, and could not be — the protocol is **HTTP/3** on every request, which
multiplexes. **The requests went out immediately and the SERVER took 10.5 to 20.8 seconds to
produce a first byte, for responses of 0–1 KB.**

⭐ **Ten small calls all reaching first byte at ~10.5 s, having been sent at 258–595 ms, is the
signature of one shared bottleneck clearing at once** — which on this architecture is the single
uvicorn event loop and its one 64-thread pool.

**And the payloads that occupy it are the page's own, 31.1 MB on a cold visit:**

| payload | size | server time | started |
|---|---|---|---|
| `/api/barspack/2026-09-25/hot` | 1.37 MB | **10,917 ms** | 313 ms |
| `/api/intradaypack/2026-09-25/0` | 1.93 MB | **8,575 ms** | 2,523 ms |
| `/api/intradaypack/2026-09-25/1` | 1.79 MB | **8,650 ms** | 2,523 ms |
| `/api/flow/data?days=1` | 1.18 MB | 7,765 ms | 3,296 ms |
| `/api/intradaypack/2026-09-25/2…15` | 1.67–1.97 MB each | **296–628 ms each** | 11,669 ms+ |

⭐⭐ **Shards 0 and 1 cost 8.6 s each; shards 2 through 15 cost 296–628 ms each.** That is a
server-side cache being *built* by the first shards and *hit* by the rest. **The cold cost is
concentrated in the first two requests, not spread across sixteen.**

### 2.3 ⛔ THE CONTROL, and it is what makes this reportable

A second `/options-flow` load after the server had settled:

| | first load | control |
|---|---|---|
| API calls | 79 | 50 |
| calls over 3 s | **10** | **2** |
| worst server time | **20,768 ms** | **7,531 ms** |
| pack bytes | **31.1 MB** | **0 MB** (all from browser cache) |
| everything except the two slowest | — | **≤ 549 ms** |

⭐⭐ **The ~10.5 s cluster does NOT reproduce.** So it is a **cold-cache cost**, not a permanent
defect, and the mechanism is named: a cold visit pulls ~31 MB of date-sharded packs whose first
requests cost 8.6–10.9 s of server time, and on a single-process server every other request waits
behind them.

⛔ **I nearly reported this as a permanent product defect, and I nearly reported the opposite —
that my own preceding grid run had contaminated it.** Both were wrong. The contamination
hypothesis died when the >900 KB payloads were resolved to full paths and turned out to be the
page's own `barspack`/`intradaypack`/`flow` packs rather than the grid's per-ticker bars; the
permanent-defect reading died on the control. **Neither would have been caught without resolving
the URLs and running the second load.**

### 2.4 ⛔⛔ ONE FINDING REPRODUCES ON BOTH RUNS, AND IT IS THE WORST CALL EACH TIME

`/api/schwab/market-narrative` — **20,768 ms** of server time on the first load and **7,531 ms**
on the control, for a **1 KB** response, `stall` 2 ms both times. It is the slowest call in both
runs and it is **not** explained by the cold packs, because the control had none.

⭐ **That is a standalone defect on a member-facing page's load path, and it is the single most
actionable thing this run found.** A 1 KB response taking 7.5 s warm is server compute, and the
name suggests a narrative generation. ⚠️ Not diagnosed further here: the cause is in code this
run did not read. `/api/calendar` at **4,519 ms** on the control is a second, smaller instance of
the same shape.

---

## 3 · What this changes

1. **`/options-flow`'s 45-second budget failure is explained**: ~31 MB of cold packs, server-side,
   with the cost concentrated in the first two shard requests. Both prior explanations remain
   correctly refuted.
2. **The recorded 16-cell figures are superseded** and the heap figure needs two numbers, not one.
3. **A 16-panel board is quiet at idle** (2 long tasks, worst 85 ms, over 60 s).
4. **`market-narrative` is a reproducible slow call** on a member page and does not need any
   further research to act on.
5. ⚠️ **The hover sweep is still unmeasured** and needs a real pointer sweep.

## GAPS

- **No true cold pass.** 45 of 107 resources came from browser cache on the "first" load, so even
  that run understates a genuinely first-time visitor. A cache-disabled pass needs DevTools.
- **No HAR exported.** The programme's most productive instrument remains untaken; this run used
  the Performance API, which gives timings but not headers per request.
- **One surface only.** `/calendar`, `/charts`, `/dashboard` and `/live-massive` were not walked.
  `/options-flow` was chosen because it carried the open question.
- **Market closed** (22:48 ET Thursday), so nothing here speaks to market-hours behaviour, which
  is where the original 45-second failures were observed. ⛔ That is a real limit on claim 1: the
  mechanism is established, its magnitude during RTH is not.
- **`largest-contentful-paint` returned no entries**, so no LCP figure. Not investigated.
