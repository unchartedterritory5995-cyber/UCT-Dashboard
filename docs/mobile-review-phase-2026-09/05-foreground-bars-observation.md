# Foreground bars observation — protocol

**One question:** under human-paced review navigation, in a browser tab that is
genuinely visible, does `/api/bars/<SYM>` fire on transition?

This exists to close **caveat (a)** on the §P2 observation. §P2 recorded 147
`/api/` calls and **zero** `/api/bars/` requests across ~15 transitions — but the
tab it recorded them in ran `visibilityState: "hidden"`, and this app's
`useMobileSWR` deliberately pauses polling on hidden tabs. 147 calls did fire, so
the frame was not network-suppressed wholesale, but a bars fetch specifically
cannot be ruled out as suppressed. A foreground re-observation settles it.

⛔ **This is not a timing measurement.** No stopwatch, no p50, no fps. It counts
requests. That is the whole point: a count is immune to the noise floor that makes
a small latency effect unmeasurable.

---

## Decision rule, agreed in advance

### Phase B is the known-positive control — check it FIRST

A genuinely cold target (not opened this session, not viewed in ~26 h) **must**
produce a non-`warm` `/api/bars/` row: the visible chart has no mem hit, no IDB
hit, and has to reach the network while the member waits.

| Phase B non-`warm` | Meaning |
|---|---|
| **> 0** | Instrument validated. Phase A's number is trustworthy. |
| **0** | **Run VOID.** Either the targets weren't cold or the filter is blind. Redo with colder targets after re-running the filter-liveness check. **Do not read Phase A.** |

⭐ This is Q6 lesson #2 applied to ourselves: validate the instrument against a
known positive before believing any negative from it. The first `canvases: 0`
should have triggered exactly this and never did.

### Then Phase A

| Phase A non-`warm` | Consequence |
|---|---|
| **0** (with B > 0) | Network caveat closed. R5 closes — **in-memory benefit recorded as UNMEASURED**, not as "no benefit". |
| **> 0** | The experiment is valid after all. Sample size from the observed fire rate, not the inherited 90/60. **See the prediction below — this outcome is now more likely than it looked.** |

### The `&warm=1` count is the prefetcher's pulse

⛔ **`&warm=1` rows never count toward either rule above.** But record them:
**zero `&warm=1` rows in a visible tab across Phase A transitions means the
prefetcher is not running in the foreground either** — a finding in its own right,
and the thing that would retroactively explain §P2.

### ⚠️ Prediction, recorded before the run so it can be wrong

`prefetchBars` writes SWR under `…&bars=600&warm=1`. The visible chart reads
`…&bars=<_primaryBars>` with **no `&warm`** (`StockChart.jsx:5322`). **Different
keys.** So current+2 cannot produce an SWR hit for the chart's read; its benefit
is server-side cache warming, and the chart may still have to make a network
request that is merely *fast*. If that's right, Phase A non-`warm` should be
**nonzero on most transitions**. If it comes back zero, something else is serving
the chart — most likely IDB filled by the feed's own per-row charts — and that is
worth knowing too.

⛔⛔ **The rule no longer says "R5 closes clean".** `prefetchBars` warms **SWR's
in-memory cache**, not IndexedDB (`prefetchBars.js:204`, in-file). So a prefetched
neighbour is a memory hit, while a symbol that is IDB-warm-but-not-prefetched
still costs an IndexedDB read plus deserialize plus render — **and both show zero
network requests.** A request count is structurally blind to that difference. Zero
therefore establishes the *network* half only.

**Phase B is a candidate future item if nonzero, not merely annotation** — a
nonzero Phase B means the ±2 window does not cover feed selection, which is a
possible future work item. It remains **not** an R5 decision input.

---

## Preconditions

- Desktop Chrome, **normal foreground window**. Not an iframe, not the extension,
  not a driven tab.
- Signed in to `uctintelligence.com` as yourself.
- DevTools open, docked or undocked — either is fine as long as the page stays
  visible.

---

## Setup

### 1 · Narrow to phone width

Resize the window (or use the DevTools device toolbar) so the **viewport** is
390 wide. Height doesn't matter for this.

### 2 · Confirm the phone shell actually mounted

The attribute is on the **`<html>` element** — `document.documentElement` — set by
`MobileChartsApp.jsx:107` when the phone shell mounts and removed on unmount. So
it is a live indicator, not a one-time flag.

In the Console:

```js
document.documentElement.getAttribute('data-mobile-chart-shell')
```

Expect `"1"`. **If it returns `null`, stop** — you are on the desktop workspace
and nothing below means anything. Narrow further and re-check.

### 3 · Arm the visibility guard

Paste this once, before you start. It records every visibility change so you can
prove the tab never went hidden rather than trusting memory:

```js
window.__vis = [document.visibilityState]
document.addEventListener('visibilitychange',
  () => window.__vis.push(document.visibilityState))
```

At the end, read `window.__vis`. **If it contains `"hidden"` anywhere, the run is
void** — redo it. No alt-tab, no covering the window, no switching desktops.

### 4 · Network tab

- Filter box: `/api/bars/`
- **"Disable cache" UNCHECKED.** We want the real caching behavior, not a
  cache-defeated worst case.
- Leave "Preserve log" **unchecked** — you'll clear deliberately in step 6.

### 5 · Enter the review session

Go to `/screener`, tap **Review charts**, and let the first chart fully paint.

⚠️ The cinematic intro plays on **every page load** (~9.3s) — click **Skip** or
wait it out. Gate on the chart being on screen, not on a count of seconds.

### 6 · Clear the log — this is the step that makes or breaks the run

Once the first chart has painted, **clear the Network log** (🚫 icon).

⛔ **The first chart's own bars fetch is a legitimate cold load, not a
transition.** Counting it would produce a false positive and invalidate the whole
observation. Everything you count from here is a *transition*.

---

## Phase A — human-paced review

Do what you'd actually do reviewing charts. Roughly:

- ~10 next/prev transitions **at genuine reading pace** — actually look at each
  chart. Don't machine-gun it; the entire validity objection to the old harness
  was that it tapped faster than a member would.
- Open the feed once.
- Select a **nearby** symbol from the feed (within a couple of positions).

Then read the Network rows.

## Phase B — far jumps

Clear the log again, then:

- ~3 feed selections to symbols **well outside the current ±2 window** — e.g.
  from position 3 to position 40, then somewhere else distant, then a third.

⛔ **Pick targets that are actually cold, or Phase B sees nothing.** Two ordinary
kinds of real-life warmth will mask the signal: a symbol you already opened
earlier in this session, and a symbol you viewed within roughly the last 26 hours
(`barsIDB` evicts intraday entries on bar-data freshness, so anything newer than
~26h is still a cache hit). Neither is a defect — both are the product working —
but a falsely-warm target makes Phase B look like Phase A for the wrong reason.
Choose symbols you have not opened this session and, as far as you can tell,
haven't looked at today; **record in the report whether you used the app earlier
today at all**, since that's what a later reader needs to judge how cold "cold"
really was.

`neighbours()` warms next+1, next+2 and prev−1 only (`reviewSession.js:189`), so a
far jump is by definition outside what current+2 covers.

**Why this is worth the extra minute:** if Phase A is zero and Phase B is nonzero,
that is the one signal that partially separates W1 from W2 — it shows the other
warming layers do *not* cover everything, and current+2 is doing real work on the
neighbours it owns. Still not actionable, but a better sentence in the closure
than "not separated."

---

## ⛔⛔ FIRST: separate `&warm=1` rows from the rest — this decides the run

**A `/api/bars/` request is not automatically evidence of a cold transition.** The
prefetcher issues its own network requests, and they are marked:

| URL contains | What it is | Counts as |
|---|---|---|
| `&warm=1` | **the prefetcher working ahead** — `prefetchBars` → `_enqueue` → `_url(sym, tf, warm=true)`. Server-side this is best-effort and shed with a fast 503 under load. | **prefetch traffic — NOT a cold transition** |
| no `&warm` | **the visible chart fetching on demand** — the member is waiting for this one | **cold transition** |

⛔ **The decision rule keys on the second row only.** Counting `&warm=1` rows as
"server hits" would make Phase A nonzero for the best possible reason — the
prefetch doing exactly its job — and would fire the "experiment is valid" branch
backwards.

**Expect `&warm=1` rows.** Up to two concurrent (`_MAX_CONCURRENT = 2`), idle-
deferred, deduped per-URL for 30 s. Seeing them is the prefetcher confirming it is
alive, which is itself useful: §P2 recorded **zero** `/api/bars/` of any kind, and
the most likely reason is that the hidden tab never fired `requestIdleCallback`
and clamped `setTimeout`, so the warm queue never drained at all. In other words
§P2 may have observed *prefetch not running*, not *everything already warm*.

**Report both numbers separately.**

## Counting: server hit vs cache hit

Read the **Size** column:

| Size column shows | Count as |
|---|---|
| a byte figure (e.g. `4.2 kB`) | **server hit** |
| `(memory cache)` | cache hit |
| `(disk cache)` | cache hit |
| `(ServiceWorker)` | cache hit |
| `(prefetch cache)` | cache hit |

Both are "warm" for our purposes — a cache hit means no network round trip, which
is the thing that would cost a member time. But they're counted separately because
they mean different things about *which* layer is doing the work.

⚠️ A row served from IndexedDB by the app's own `barsIDB` layer **will not appear
in the Network tab at all** — that's an app-level cache, not an HTTP one. So zero
rows is a genuine possible outcome and is not evidence the filter is broken. If
you want to confirm the filter works, briefly clear the filter box and check other
`/api/` rows are flowing.

---

## Report back

```
Shell attribute at start / at end:  ___ / ___   (data-mobile-chart-shell === "1")
window.__vis contained "hidden":    yes / no    (yes ⇒ run void, redo)
Filter-liveness check passed:       yes / no
Used the app earlier today:         yes / no

Phase A  — non-warm server hits: ___   &warm=1 rows: ___   cache hits: ___
Phase B  — non-warm server hits: ___   &warm=1 rows: ___   cache hits: ___
Phase B targets: ___________________________

OPTIONAL, if you have another minute — bounds "expected small" with a number
instead of a hope, now that we know a memory layer exists:
Performance panel, 3 Phase A transitions, main-thread cost per transition: ___
```

Approximate transition counts for A and B are useful but not critical — the
zero/nonzero distinction is what decides.

---

## What happens next

- **Phase A = 0** → I write the closure entry into
  `04-master-integration-and-regression.md` with your numbers substituted, and R5
  is done. Nothing is built, launched, or pushed.
- **Phase A > 0** → we reopen the instrument discussion, and the sample size comes
  from your observed fire rate rather than the inherited 90/60.
