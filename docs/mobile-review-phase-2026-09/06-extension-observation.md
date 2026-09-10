# Foreground bars observation — extension-driven variant

# ⚰️ ATTEMPTED 2026-09-09 AND ABANDONED. THIS IS A RECORD OF AN ATTEMPT, NOT A METHOD.

**05 is the instrument.** It stays frozen at `c710ce4c2` and the observation is
done by hand. See "What actually happened" at the end of this file — three
findings came out of the attempt and they are the reason to keep the document.

**Supersedes `05-foreground-bars-observation.md` ONLY if this run validates.** It
did not.

Everything 05 established by *reading* — the key mismatch, the count-keyed server
cache, the Daily/intraday conditional, the feed's role, the `&warm=1` split, the
symbol-pairing rule — carries over unchanged. Only the **capture** differs.

---

## Why the extension path is viable now

§R5-A measured extension-driven tabs at `visibilityState: hidden`, 0.1–0.2 rAF fps,
~1 Hz timers, *including a freshly created tab*, with `SetForegroundWindow` /
`ShowWindow(SW_MAXIMIZE)` / `BringWindowToTop` / `HWND_TOPMOST` all applied and
the window title never changing.

**That measurement was of a Playwright-launched window fighting Win32
foregrounding. A user-owned foreground tab is a different case.** Checked
2026-09-09: Claude in Chrome read `document.visibilityState === "visible"` twice,
10 s apart, with `data-mobile-chart-shell === "1"`, in the owner's own app tab.

⇒ The throttling finding is scoped to *how the tab was created and owned*, not to
extension-driven tabs as a class. In a user-owned foreground tab
`requestIdleCallback` fires and the prefetcher runs.

**Check 1 failed and stays failed.** The serve-layer label is computed into a
response header at `bars.py:669` and never logged; no middleware logs response
headers. The smallest fix is an `api/` edit **and** a production deploy, so the
log-based capture path is dead.

---

## Capture: the in-page Performance API

DevTools is unavailable to the extension, so there is no HAR. There doesn't need
to be. `performance.getEntriesByType('resource')` carries everything the HAR was
for:

| field | gives us |
|---|---|
| `.name` | full URL — sym, tf, `bars=`, and `&warm=1` all recoverable |
| `.startTime` | ordering, so marker intervals work |
| `.duration` | wall time |
| `.serverTiming[]` | `{name, duration, description}` — **the serve-layer label** |

`Server-Timing` is exposed to JS for **same-origin** responses, and `/api/bars` is
same-origin with the app.

### Three traps, each with its control

**1 · Buffer overflow reports as silence.** The resource timing buffer defaults to
~250 entries and then silently drops. A full buffer reads as "no requests" — which
is `lesson_a_saturated_instrument_reports_zero` exactly. Control: raise it to 2000
**and** set a DOM flag on `resourcetimingbufferfull`, reported in the dump.

**2 · `window.*` may not survive between calls.** The extension may evaluate in an
isolated world. **State lives on the DOM**, which is shared across worlds —
`data-r5-markers` on `<html>`.

**3 · Navigation wipes everything.** A new document resets the performance timeline
*and* the DOM attributes. **Do not navigate after setup.** Entering the review
session happens *before* setup for this reason; every action after it — taps,
scrolls, feed open/close — is in-page.

### Instrument proof, before any phase begins

⛔ **If `serverTiming` comes back empty the instrument is blind and the whole run
is worthless.** Prove it on real entries before spending the run — this is the
known-positive check that four earlier attempts never did.

### `read_network_requests` as a cross-check

Its schema documents URL filtering, a `limit` (default **100** — raise it) and
`clear`. It does **not** promise response headers, so it cannot be assumed to
carry `Server-Timing`. It is still a useful independent count of URLs, since
warm vs non-`warm` is recoverable from the URL alone. Use it only to cross-check
counts; never as the serve-layer source.

---

## Validity gates

1. **Every marker's `vis` sample reads `"visible"`** — 12+ point samples replace
   the single `__vis` guard. Any `hidden` voids the run.
2. **`shell === "1"` at the first and last marker.**
3. **`bufferFull` absent** in the dump.
4. **`serverTiming` non-empty** on the proof sample.
5. **At least one non-`warm` `/api/bars/` entry after `A1_START`** — otherwise the
   capture is blind.

⛔ **No numeric threshold decides close vs continue.** The code reading answered
*what current+2 does*; this run annotates *how much*.

---

## The parse — JSON shape, not HAR

Input: `tools/r5_har/run.json` (already-gitignored directory).

Per marker interval, from `entries[]` split by `markers[].t` against `start`:

- **warm vs non-`warm`** by `&warm=1` in `.name`
- **serve-layer distribution** from `st[].desc` where `st[].n === "bars"`
- **`dur`** from `st[].d` (server compute) and `.dur` (wall)
- **observed `tf` and `bars=`** parsed from `.name` — **reported, never assumed**

**A1 pairing**, per transition: pair the preceding `&warm=1` entry for a symbol
with that symbol's own non-`warm` entry.

| warm entry `desc` | chart entry `desc` | Reading |
|---|---|---|
| `warm-mem` / `warm-sqlite` | anything | server already hot; warm did nothing |
| `warm-shed` | anything | shed under load; warmed nothing |
| `fetch` / `cold-bg` | `mem` / `sqlite` | **the warm worked** |
| `fetch` / `cold-bg` | `fetch` / `cold-bg` / `inflight-wait` | warm populated an entry the chart didn't read — count-key mismatch, observed |

**After any `*_SEL_n` marker — discriminate by SYMBOL, never by interval.** The
marker carries the symbol it is about to tap, recorded at marker time rather than
from memory afterwards:

| entry | Reading |
|---|---|
| non-`warm` for the **marker's `sym`** | the main chart's own fetch — **predicted zero**, already painted |
| non-`warm` for **any other symbol** | the feed repainting its window |

Also reported: `barsHistoryFlag` (`"0"` ⇒ the Daily key-match does not hold),
`entryCount` vs 2000 as buffer headroom, and the fact that a symbol centred
earlier will not refetch later — expected, not a finding.

---

## THE PASTE BLOCK

Everything from "R5 OBSERVATION RUN" to "END OF RUN INSTRUCTIONS" goes to Claude
in Chrome verbatim. It assumes only click, scroll, wait, and `javascript_tool`.

---

R5 OBSERVATION RUN — follow exactly, in order. Do not improvise.

HARD RULES
- DO NOT NAVIGATE at any point after STEP 1. No URL changes, no reloads, no
  back/forward. A navigation destroys the measurement silently.
- Everything is done in the tab that is already showing the app.
- Between taps, WAIT 3-4 SECONDS. This is reading pace and it is deliberate.
- If any JS call returns an error, STOP and report it. Do not continue.

STEP 1 - GET INTO POSITION (manual navigation allowed ONLY here)
Go to the screener, tap "Review charts" to enter a review session, and wait until
the first chart is fully painted and visible. The app plays a ~9 second intro on
page load - click "Skip" if it appears, or wait it out. Wait for the CHART to be
on screen, not for a number of seconds.

STEP 2 - SETUP (javascript_tool)

    performance.setResourceTimingBufferSize(2000);
    addEventListener('resourcetimingbufferfull', () =>
      document.documentElement.setAttribute('data-r5-bufferfull','1'));
    document.documentElement.setAttribute('data-r5-markers','[]');
    ({ ok:true, vis:document.visibilityState,
       shell:document.documentElement.getAttribute('data-mobile-chart-shell'),
       flag:localStorage.getItem('uct.barsHistory.enabled'),
       href:location.href })

Report the result. If vis is not "visible" or shell is not "1", STOP.

STEP 3 - INSTRUMENT PROOF (javascript_tool)

    (() => {
      const e = performance.getEntriesByType('resource')
        .filter(x => x.name.includes('/api/bars/'));
      return { barsEntries: e.length, sample: e.slice(-3).map(x => ({
        name: x.name,
        st: (x.serverTiming||[]).map(s => ({ n:s.name, desc:s.description, d:s.duration }))
      })) };
    })()

Report the result. If barsEntries is 0, tap "next symbol" once, wait 4 seconds,
and run STEP 3 again. If every "st" array is EMPTY, STOP AND REPORT - the
instrument is blind and the run must not proceed.

STEP 4 - MARKER TEMPLATE
Used many times below. Replace NAME and SYMBOL each time. When a marker has no
symbol, use an empty string for SYMBOL.

    (() => {
      const el = document.documentElement;
      const a = JSON.parse(el.getAttribute('data-r5-markers') || '[]');
      a.push({ name:'NAME', sym:'SYMBOL', t:performance.now(),
               vis:document.visibilityState,
               shell:el.getAttribute('data-mobile-chart-shell') });
      el.setAttribute('data-r5-markers', JSON.stringify(a));
      return { pushed:'NAME', sym:'SYMBOL', count:a.length,
               vis:document.visibilityState };
    })()

After EVERY marker, check the returned vis. If it is ever not "visible", STOP AND
REPORT.

STEP 5 - CLEAR AND START A1
Run this once (javascript_tool):

    performance.clearResourceTimings();
    'cleared'

Then run the STEP 4 marker with NAME=A1_START and an empty SYMBOL.

STEP 6 - PHASE A1 (~8 transitions, DO NOT OPEN THE FEED)
Repeat 8 times:
  - Tap the "Next symbol" control.
  - WAIT 3-4 SECONDS, letting the chart paint. Actually pause; do not rush.
Do not open the feed or the list during A1. Do not scroll the list.

Then run the STEP 4 marker with NAME=A1_END and an empty SYMBOL.

STEP 7 - PHASE A2 (three open / paint / select cycles)
Run the STEP 4 marker with NAME=A2_START and an empty SYMBOL.

Then do this THREE times, for n = 1, 2, 3:
  a. Open the feed - tap the centre pill that opens the list (its label reads
     like "N / 100 in Screener - open the list").
  b. WAIT 5 SECONDS for the visible cards to paint their charts.
  c. Choose a row that HAS a painted chart and READ ITS TICKER SYMBOL.
  d. Run the STEP 4 marker with NAME=A2_SEL_n and SYMBOL set to that ticker.
     Do this BEFORE tapping.
  e. Tap that row. The feed will close by itself.
  f. WAIT 4 SECONDS.

Then run the STEP 4 marker with NAME=A2_END and an empty SYMBOL.

STEP 8 - PHASE B (three far jumps)
Run the STEP 4 marker with NAME=B_START and an empty SYMBOL.

Then do this THREE times, for n = 1, 2, 3:
  a. Open the feed again.
  b. SCROLL DOWN A LONG WAY - at least 15 rows past the current position, to a
     row not used in A2 and not visited earlier in this session.
  c. WAIT 5 SECONDS for that row's chart to paint.
  d. READ ITS TICKER SYMBOL.
  e. Run the STEP 4 marker with NAME=B_SEL_n and SYMBOL set to that ticker.
     Do this BEFORE tapping.
  f. Tap that row. The feed will close.
  g. WAIT 4 SECONDS.

Then run the STEP 4 marker with NAME=B_END and an empty SYMBOL.

STEP 9 - DUMP (javascript_tool)

    (() => {
      const el = document.documentElement;
      return {
        markers: JSON.parse(el.getAttribute('data-r5-markers') || '[]'),
        bufferFull: el.getAttribute('data-r5-bufferfull') === '1',
        entryCount: performance.getEntriesByType('resource').length,
        barsHistoryFlag: localStorage.getItem('uct.barsHistory.enabled'),
        shellAtEnd: el.getAttribute('data-mobile-chart-shell'),
        visAtEnd: document.visibilityState,
        href: location.href,
        entries: performance.getEntriesByType('resource')
          .filter(e => e.name.includes('/api/bars/'))
          .map(e => ({ name:e.name, start:Math.round(e.startTime),
                       dur:Math.round(e.duration),
                       st:(e.serverTiming||[]).map(s =>
                          ({ n:s.name, d:s.duration, desc:s.description })) }))
      };
    })()

STEP 10 - REPORT
Paste the ENTIRE JSON result from STEP 9 into the chat AS-IS. Do not summarise it,
do not truncate it, do not reformat it. Then state, in one line each:
  - how many transitions you actually did in A1
  - the ticker you tapped at A2_SEL_1, A2_SEL_2, A2_SEL_3
  - the ticker you tapped at B_SEL_1, B_SEL_2, B_SEL_3
  - anything that did not go as described above

END OF RUN INSTRUCTIONS

---

# What actually happened — 2026-09-09

The run never reached STEP 1. Three findings, all worth more than the attempt cost.

## ⚰️ 1 · "Check 3 PASSED" was never measured

This document's own justification for the extension path — *"Checked 2026-09-09:
Claude in Chrome read `document.visibilityState === "visible"` twice, 10 s apart"*
— **was a claim carried forward without a measurement.** It arrived pre-filled in a
prompt template and was sent without the test having run. Source named so it can be
traced: reviewer's template.

⭐ It was caught the same way the cookie inference should have been: by refusing to
accept a result this session did not produce. When the reading was finally taken in
the tab that would actually be driven, **it came back `hidden`** — the opposite of
the claim the whole path was authorised on.

Same class as the session-scoped-cookie inference and the stale master SHA.
**A result nobody produced is not a result.**

## ⚰️ 2 · §R5-A extends to a user-profile tab — a created tab reads `hidden`

§R5-A scoped its throttling finding to a Playwright-launched window fighting Win32
foregrounding. **That scoping was too narrow.** Measured here, in the owner's own
Chrome, own profile, own authenticated session, tab created by the extension:

```
vis: "hidden"   hidden: true   hasFocus: false
href: https://uctintelligence.com/dashboard
```

⛔ **A screenshot capture does not activate the tab.** `computer:screenshot`
returned a correct, fully-rendered 1568×698 image of the live authenticated
dashboard **while the browser still reported the tab hidden**. Rendering for the
extension and being visible to the page are different things — so a capture that
"looks right" is not evidence the page is running.

⭐ **A human click fixes it and nothing programmatic does.** After the owner
clicked the tab: `visible`, `hidden: false`, rAF **23 fps**, and — the gate that
actually matters — **`requestIdleCallback` fired at 1 ms**. That is the mechanism
`_kickSoon → _pump` needs, dead in every prior attempt and alive here. So the
throttling is not inherent to extension-driven tabs; it is inherent to *nobody
having clicked one*.

⇒ Any future browser automation on this project must treat "the tab is visible" as
**something a human did**, not something the tooling can arrange.

## ⚰️ 3 · `resize_window` reports success on a maximized window and does nothing

```
resize_window(390×844) → "Successfully resized window ... to 390x844 pixels"
outerWidth: 1920   innerWidth: 1920   (unchanged, across two calls)
```

Chrome ignores programmatic resize on a **maximized** window; the tool reports
success regardless. This is the class of defect this project keeps paying for —
`BARS_PREWARM_DISABLED` matching no read site, three gate runs reporting exit 0
having run nothing. **A success string is not an effect.**

It mattered because at 1920 wide the app renders the desktop workspace:
`data-mobile-chart-shell` was `null` and `pointer: coarse` was `false`. Proceeding
would have measured the wrong surface entirely.

## Incidental confirmation

Navigating to `uctintelligence.com` redirected to `/dashboard` with live positions
rendering — **the profile was already authenticated, no sign-in step anywhere.**
That is the 30-day persistent-cookie finding confirmed by observation rather than
by reading `auth.py`.

## Verdict

The extension path is abandoned, not deferred. Two independent blockers, each
requiring a physical action from the owner, and the second only surfaced after the
first was cleared — which is the shape of a path that will keep producing a third.
**05 by hand is two minutes and is the instrument.**
