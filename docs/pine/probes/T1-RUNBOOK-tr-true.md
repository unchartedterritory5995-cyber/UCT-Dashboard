# T1 runbook — reading `ta.tr(true)`, prepared 2026-09-11 so it is a 10-minute job

Everything here is written so tomorrow's session does not re-derive anything. The one
thing it cannot supply is a connected browser.

**Probe:** `docs/pine/probes/r11-tr-true.pine` — 12 plots, **plot roster below**.
**Fixture filename, reserved:** `tests/fixtures/vendor/r11-tr-true-spy-1d-2026-09-12.json`
(change only the date if the reading slips a day).
**Chart:** SPY, **1D**. Nothing here is intraday-sensitive, and every other Group-B
reading was taken on a daily chart.

---

## 0. The go/no-go, first — 30 seconds

```
list_connected_browsers       -> must NOT be []
tabs_context_mcp              -> must not say "Browser extension is not connected"
```

⛔ If either fails, **stop and say so**. That is the whole of last night's item 1.

Then, in the page, before adding anything:

```js
({ visible: document.visibilityState === 'visible', focused: document.hasFocus() })
```

⛔ Both must be `true`. `insertStudy` reports success while inserting nothing on a
hidden tab, and a pane added hidden is not rescued by `_adjustSize()`.

---

## 1. The binding gate — assert BEFORE touching the buffer

```js
[...document.querySelectorAll('button,[role="button"]')]
  .map(b => (b.getAttribute('title') || b.textContent || '').trim())
  .filter(t => /Add to chart|Update on chart/i.test(t))
```

⛔ Must be exactly **one `"Add to chart"` and zero `"Update on chart"`**. If it reads
*Update on chart*, the editor is BOUND to a saved script and a `setValue` + click would
**edit that script in place**. This fired for real twice on 2026-09-11. Unbind first:
script-title dropdown → **hover** *Create new* → *Indicator*. The submenu populates on
HOVER, not click — a click alone leaves a zero-height container and looks broken.

---

## 2. Put the source in the buffer — Monaco handle, base64

The webpack module id is a **build artifact and must be re-derived each visit** (it was
`423129` on 2026-09-10). Scan for the Monaco handle, then:

```js
// source passed as base64 and decoded in the page; a gzip round-trip corrupted one
// attempt, plain base64 has not
model.setValue(atob(B64))
```

## 3. Verify the receipt BEFORE clicking

```js
// chars + FNV-1a, then sha256 of model.getValue() === sha256 of the committed file
```

⛔ Byte-exact, every time. A partial paste is real: one attempt left `fold-pass`
concatenated with a stray fragment (1614 chars against a committed 628) and only the
receipt caught it.

---

## 4. Add, then gate the study

Click **Add to chart**, then:

```js
const si = /* study handle */
({ failed: si.isFailed(), status: si.status(), len: si.dataLength() })
```

⛔ `isFailed() === false` **and** plot count === **12** (the roster below). A study whose
script fails to COMPILE still lands, still answers `metaInfo()`, and shows a single plot
titled `"Plot"` with the shared placeholder digest — that is the shape that looks like
success and is not.

⛔ **Read values with `si.dataLength()` / `si.status()` / `si._study.data().last()`.**
`si._data._items.length` inside a `try` returns **0 for every study** — the wrapper has
no `_data` — so thirteen healthy studies once read as "nothing loaded".

---

## 5. Poll from OUTSIDE, in cheap calls

⛔⛔ **Never write an `await` loop inside one `Runtime.evaluate`.** A 40-second wait
inside a single call exceeds that call's 45 s budget and returns as a timeout
indistinguishable from a dead page — that is what wedged the renderer on 2026-09-11.
Poll: one cheap evaluate, return, decide, repeat.

If it does freeze: ONE `navigate` to the same layout URL recovers it (tab id unchanged),
then **read state before touching anything**.

---

## The plot roster — 12, in `_metaInfo.plots` order

```
 1 subject_tr_true        ta.tr(true)              THE SUBJECT
 2 sibling_tr_false       ta.tr(false)             already translates here
 3 candA_guarded          na(close[1]) ? high-low : 3-term max
 4 candB_unguarded        3-term max, no guard
 5 diff_vs_candA          subject - candA          expect 0 on every bar
 6 diff_vs_candB          subject - candB          expect 0 EXCEPT bar 0
 7 diff_vs_sibling        subject - sibling        expect 0 EXCEPT bar 0
 8 SPREAD_control         high - low               ⭐ MUST be non-zero everywhere
 9 is_first_bar           bar_index == 0
10 subject_is_na          expect 0 on bar 0
11 sibling_is_na          expect 1 on bar 0 if `false` leaves it na
12 subject_eq_highlow     expect 1 on bar 0
```

⛔ **Read column order from `_metaInfo.plots`, never `Object.keys(_metaInfo.styles)`.**

## What the reading decides

- **bar 0 carries a value and it is `high - low`** → `ta.tr(true)` is candA, and the
  engine can declare it with the guarded first bar.
- **`diff_vs_candA` is 0 on all bars** → candA is the definition; pin it **only if a
  corpus case exercises the argument form** (4 committed scripts write `ta.tr(`).
- **`SPREAD_control` is 0 or `na` anywhere** → the capture is VOID, not confirming. A
  difference that measures zero on a study that never ran looks exactly like agreement.

## Recording

Follow the existing fixture convention: `_probe`, `_probeSha256`, `_probeBytes`,
`_studyName`, `_capturedUTC`, `_capturedET`, `symbol`, `tf`, `bars`, `_the_question`,
`verdict`, `measured`, `_the_discriminator_and_why_it_matters`, `_bounds`.

Then **item 5**: pin it with its corpus case, or record-and-do-not-pin if no corpus case
exercises `ta.tr(true)`. ⛔ Declaring a new BAR name owes a corpus case and re-freezes a
cross-lane oracle — `ceil`/`floor` were built and backed out the same hour for skipping
that.
