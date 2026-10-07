# Wave 13, lane 13Q-Q1check — Q1's "cursor lands in body" claim, re-verified

Branch `feat/notebook-w13q1check`, base `9a7a40494d` (the wave-13 landing tip, 13Q-3
merged). Task: verify lane 13Q-2's claim (`docs/notebook/wave13-13q2.md`) that creating
a new blank note puts the text cursor in the note body, given 13Q-3's own doubt
(`docs/notebook/wave13-13q3.md`, `docs/notebook/evidence/wave13-13q3/q1-second-attempt-diagnosis/`)
that the click-budget instrument's Q1 PASS was the tool's own compensation, not the
product's doing.

## 1. The doubt was correct — measured, with no instrument help

Step 1's protocol (exactly as specified): a brand-new browser context + page per
repetition, brought to the foreground (`page.bring_to_front()`), headless Chromium (one
of the two accepted forms — this box has no interactive display), 1200px and 390px, 5
reps each. The real "+ New note" UI control was clicked; nothing else in the script ever
called `.focus()` or `.click()` on the note body. `document.activeElement` was read at
+100ms, +500ms and +2000ms from the click. A real-member-path check followed: typing a
short marker with `page.keyboard.type()` (no focus()/click), then reading the product's
own saved note back via `GET /api/j2/notes/{id}` to see where the characters landed.

**Result: 0 of 10 repetitions ever got the cursor into the body.** `document.activeElement`
stayed `BODY` for the entire 2-second window every single time, even after `.ProseMirror`
existed in the DOM. The typed marker landed in **neither** the title nor the body in all
10 reps — the keystrokes went nowhere. Raw data, committed before interpretation (R-RAW):
`docs/notebook/evidence/wave13-q1check/results.json` (+ `raw-console.txt`,
`q1check_measure.py`, `screenshots/`, and the sandbox's own shared-data-root integrity log
at `docs/plans/joystick/sandbox-runs/2026-10-03T08-35-32.md`, CLEAN at every checkpoint —
`C:\data` was never touched).

**13Q-3's doubt was right: the Q1 PASS was the instrument's own `pm.focus()` compensation
doing the member's job, not the product.**

## 2. Two product-side fixes were tried. Both measured to fail.

### 2a. Retry `editor.commands.focus('end')` a second time

The first, most literal reading of the task's suggestion ("retry once in a rAF"): a small
pure helper (`retryFocusUntilLanded`, unit-tested in isolation, 6/6 green, mutation-provable)
wrapped the SAME TipTap command, calling it again via `requestAnimationFrame` if the first
call did not land. Wired into `NoteEditorPage.jsx`'s existing `useLayoutEffect`. Rebuilt,
re-ran the IDENTICAL step-1 measurement with no instrument help: **still 0 of 10**, typed-
landed still neither in all 10. Raw: `docs/notebook/evidence/wave13-q1check/results-after-retry-fix.json`.

### 2b. A synchronous, un-deferred direct DOM focus call

Reading `@tiptap/core`'s own `focus` command source explains why 2a changed nothing:
`editor.commands.focus(position)` sets the ProseMirror selection synchronously, but the
actual `view.focus()` DOM call that moves `document.activeElement` is wrapped in the
command's OWN internal `requestAnimationFrame(...)`. Retrying the *command* is just
scheduling a second deferred call, never an earlier one.

A targeted diagnostic confirmed a SYNCHRONOUS, un-deferred `view.dom.focus()` (bypassing
TipTap's command for the actual focus grab) lands reliably: **3 of 3** against the real
sandbox (`docs/notebook/evidence/wave13-q1check/direct-dom-focus-diagnosis/`). This was
wired into the product (`editor.commands.focus('end')` for the selection, immediately
followed by a direct, retried `editor.view.dom.focus()` for the actual grab), rebuilt, and
the full 10-rep step-1 measurement was re-run.

**Still 0 of 10**, typed-landed still neither in all 10
(`docs/notebook/evidence/wave13-q1check/results-final.json`) — **despite the identical
call having just been measured to work 3/3 in isolation.**

## 3. The isolating measurement: the variable is not timing, retry count, sync vs.
   deferred, headed vs. headless, or context freshness. It is execution context.

Before concluding, several alternative explanations were measured and ruled out (full
scripts and raw output: `docs/notebook/evidence/wave13-q1check/further-isolation-scripts/`,
`headed-mode-diagnosis/`):

- **Headed vs. headless** — re-ran the formal protocol in headed Chromium (3 reps,
  1200px): still 0/3.
- **Fresh context per rep vs. a single persistent context/page** (closer to a real
  member's long-lived tab) — 0/5, even over 5.6+ seconds elapsed.
- **`bring_to_front()` called once vs. per-rep, and whether only the FIRST note in a
  session fails** (a "warm-up" theory) — a persistent session with one `bring_to_front()`
  up front still failed all 5 reps, including reps 2–5 on an already-used page.
- **Manual (`page.evaluate()`-injected) calls to the deferred TipTap command** — flaky
  (succeeded once in isolation, failed in two other identically-shaped runs) — the same
  rAF-deferral problem as 2a, just injected instead of natural.

The decisive test (`docs/notebook/evidence/wave13-q1check/natural-vs-injected-diagnosis/`):
on the **same note, same page, same element**, back-to-back —

1. The product's own effect (page-native JS; every variant above was tried) left
   `document.activeElement` on `BODY`.
2. The **identical** `pm.focus()` call, injected a moment later via Playwright's own
   `page.evaluate()` — a DevTools-protocol-level execution, never page script — **landed
   it immediately.**

**The real variable is whether the call originates from the page's own natural script or
from a CDP-injected one.** Not timing. Not retry count. Not deferred-vs-synchronous (both
were tried and both failed naturally; the synchronous one succeeds only when injected).
Not headed vs. headless. Not context freshness. A page's own code — including everything
`NoteEditorPage.jsx` can ever run — only ever executes in the natural context. There is no
way for the product to reach the CDP-privileged one Playwright's own `.focus()` uses.

## 4. Conclusion and what shipped

> ⚰️ **SUPERSEDED, struck 2026-10-06. A product fix exists and shipped.** This section records
> the lane's state before its last commit and is kept as history. The fix is
> `74bfc895b0` ("fix(notebook 13Q-Q1check): poll the editor's own DOM connection before the one-shot body focus", 2026-10-03): the editor's
> DOM was not yet connected when the one-shot focus ran, so the call was a silent no-op; the
> effect now waits for `editor.view.dom.isConnected`. Measured after it in a real browser:
> `docs/notebook/evidence/wave13-q1check/attach-fix-reverify/results.json` holds 10 rows (5 at
> 1200 px, 5 at 390 px), and in all 10 `typed_landed_in_body` is true and
> `typed_landed_in_title` is false. The cause named below (a CDP automation artifact) was the
> wrong explanation. `BETA-HANDOFF.md` section 1 already says the fix shipped.

~~**No product-side JavaScript fix was found, after two genuinely different, carefully
re-measured attempts and a controlled isolation.**~~ This reads as a genuine finding, not a
failure to try hard enough: the same mechanism (CDP automation privileging its own
injected calls over the automated page's natural script) is the simplest explanation
consistent with every measurement above, and it is specific to the page being
CDP-automated at all — something no real member's browser ever is.

~~**Both product changes were reverted.**~~ (⚰️ true of the first two attempts only; the third, `74bfc895b0`, shipped: see the note at the top of this section.) `NoteEditorPage.jsx` is back to 13Q-2's original
single `editor.commands.focus('end')` call (confirmed unchanged behaviour: the existing
jsdom rail `NoteEditorPage.wave13Q2focus.test.jsx`, 4/4, and the full 50-file
`NoteEditorPage.*.test.jsx` sweep, 353/353, both still pass — jsdom has no notion of this
automation-specific defect and was never going to see it either way). `retryFocus.js` and
its tests were removed (dead code for a fix that did not work).

**`tools/notebook_w13q_clicks.py::focus_editor_body` keeps 13Q-3's `pm.focus()`
compensation** — removing it, per the task's original conditional, was contingent on a
working product fix that does not exist. Its comment is rewritten to carry this lane's
much stronger evidence (a controlled same-element A/B, not an assumption) for why the
compensation is correct to keep. `tests/test_notebook_w13q_clicks.py` is unchanged from
13Q-3 (40/40 passing); nothing needed to change since the instrument itself was reverted.

## 5. What this lane does NOT claim

- Does **not** claim Q1 "cursor lands in body" is VERIFIED for a real member — the step-1
  measurement conclusively shows the opposite under automation, 30 times over (10 original
  + 10 + 10 across the two fix attempts), with zero exceptions.
- Does **not** claim the defect is definitely harmless for real (non-automated) members.
  That would require a genuinely manual, human-operated device test, which no automated
  lane can perform. What IS established, carefully: the specific mechanism measured here
  (natural-context script losing a focus race that an injected CDP call wins) requires a
  CDP connection to even exist as a distinction — a real member's browser has no CDP
  attached and therefore has only the "natural" context, which is also the one 13Q-2's own
  jsdom tests and real-browser check found working. This is consistent with — but does not
  independently re-prove — 13Q-2's original claim that a real member is unaffected.
- Does **not** modify the click-budget instrument's compensation or its tests, since no
  working replacement was found.

## 6. Evidence paths (all R-RAW — committed before this doc interpreted them)

- `docs/notebook/evidence/wave13-q1check/results.json` — step 1, BEFORE any fix, 0/10.
- `docs/notebook/evidence/wave13-q1check/results-after-retry-fix.json` — fix 2a (retry the
  TipTap command), 0/10.
- `docs/notebook/evidence/wave13-q1check/results-final.json` — fix 2b (synchronous direct
  DOM focus), 0/10.
- `docs/notebook/evidence/wave13-q1check/direct-dom-focus-diagnosis/` — the isolated
  3/3 success of a direct DOM focus call via `page.evaluate()`.
- `docs/notebook/evidence/wave13-q1check/natural-vs-injected-diagnosis/` — the decisive
  same-element A/B (natural fails, injected succeeds).
- `docs/notebook/evidence/wave13-q1check/further-isolation-scripts/` — the ruled-out
  alternative explanations (headed/headless, fresh/persistent context, warm-up, flaky
  manual-evaluate), with a README indexing each.
- `docs/notebook/evidence/wave13-q1check/headed-mode-diagnosis/` — the headed-mode re-run.
- `docs/notebook/evidence/wave13-q1check/screenshots/` — one per step-1 repetition.
- `docs/plans/joystick/sandbox-runs/2026-10-03T08-35-32.md` — shared-data-root integrity
  log for the first sandbox boot (`C:\data` CLEAN at every checkpoint).

## 7. Test commands run, with totals

- `python -m pytest tests/test_notebook_w13q_clicks.py -q` → **40 passed** (unchanged from
  13Q-3's own baseline — the instrument reverted to its pre-lane state).
- `npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.wave13Q2focus.test.jsx --maxWorkers=1` (from `app/`) → **4 passed**.
- `npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.*.test.jsx --maxWorkers=1` (all 50 pre-existing files) → **353 passed** (see §8 for the exact totals line from this run).
- `python tools/check_repo_hygiene.py` → clean, no line-ending flips.

## 8. Open items

- ~~No product fix exists for Q1 within this lane's means.~~ ⚰️ Struck 2026-10-06: the fix shipped in `74bfc895b0` (section 4's note). The rest of this item is kept as history. If a future lane wants to pursue
  this further, the one untried avenue with any theoretical basis is restructuring note
  creation to be optimistic (mount a blank editor and grab focus synchronously within the
  ORIGINAL trusted click handler's call stack, before any `await`, reconciling with the
  server-assigned note id once the API call resolves) — a materially larger architecture
  change than this lane's scope, touching the note-creation path's interaction with the
  offline/durable-write machinery documented elsewhere in this repo's Notebook sections.
- A genuinely manual (non-automated, human-operated) device check of this exact flow would
  raise confidence beyond what any Playwright-driven lane can establish, since the entire
  finding in §3 is that CDP's mere presence changes the measured behaviour.
