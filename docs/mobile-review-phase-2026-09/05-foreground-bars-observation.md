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

| Phase A result | Consequence |
|---|---|
| **0 server hits** | Caveat (a) closed. R5 closes clean. |
| **> 0 server hits** | The experiment is valid after all. Only then do we discuss the headless probe, storageState, and a sample size derived from the observed fire rate. |

**Phase B is annotation, never a decision input.**

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

`neighbours()` warms next+1, next+2 and prev−1 only (`reviewSession.js:189`), so a
far jump is by definition outside what current+2 covers.

**Why this is worth the extra minute:** if Phase A is zero and Phase B is nonzero,
that is the one signal that partially separates W1 from W2 — it shows the other
warming layers do *not* cover everything, and current+2 is doing real work on the
neighbours it owns. Still not actionable, but a better sentence in the closure
than "not separated."

---

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
Shell attribute present:   yes / no        (data-mobile-chart-shell === "1")
window.__vis contained "hidden":  yes / no  (yes ⇒ run void, redo)

Phase A  — server hits: ___    cache hits: ___
Phase B  — server hits: ___    cache hits: ___
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
