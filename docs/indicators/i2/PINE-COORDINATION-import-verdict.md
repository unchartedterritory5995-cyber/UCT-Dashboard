# I2: import-verdict coordination with the Pine workstream

**From:** Indicators (Milestone I2 "Honest Imports", owner-approved 2026-11-01).
**To:** the Pine integrator. The Pine program runs on another machine, so the owner relays this note.
**Status:** PROPOSAL. No shared file has been edited. Owner, 2026-11-01: no Pine session is open now,
so the owner decides whether to authorize Indicators to make edit 1 itself.

## What exists, on branch `feat/indicators-import-verdict`

- `app/src/components/chart/engine/ast/importVerdict.js` is a NEW file. It wraps `importOutcome.js`
  and does not modify it.
- It gives a four-class verdict: values / visuals / inputs / behaviour.
- It applies a closed note registry. An unknown code reads "values may differ", never
  presentation-only.
- **"Exact" needs evidence:**
  - a thinkScript or TC2000 import reads at best "Imported, no known differences";
  - the engine's own formula language keeps "Exact".
- **Pine is passed through byte-for-byte.** For `dialect === 'pine'`, the verdict, label and reason
  equal `importOutcome`'s, and a rail pins that.

## The two shared-file edits I2 needs, and wants Pine's OK for

1. **`builder/PineBox.jsx`.** This is the corrected snippet (2026-11-01). The first draft replaced
   `outcome` wholesale, which would have broken `semanticShown`: it reads `outcome.semantic`, and
   `importVerdict` does not return that field. The change is now additive:

   ```js
   // next to `const outcome = …` (about line 1032); `outcome` itself is unchanged
   const verdict = useMemo(
     () => (report && report.dialect !== 'pine' ? importVerdict(report) : null), [report])
   const shown = verdict || outcome
   ```

   - The verdict line (`data-testid="import-outcome"`, about line 1129) reads `shown.verdict`,
     `shown.label` and `shown.reason` instead of `outcome.*`. That is three expressions, plus one
     import line.
   - **Pine:** `verdict` is `null`, so `shown === outcome` and the DOM is byte-identical. A new rail
     renders Pine scripts before and after and compares `innerHTML`.
   - **Non-Pine:** the line can now read `data-outcome="no-known-differences"`.
   - **Unchanged:** `semanticShown`, `collapsedNotes`, the support-loop gap notice, and every other
     Pine path.

2. **No edit to `importOutcome.js`.** I2 deliberately keeps it as it is so that Pine's 336-capture
   verdict grading is untouched.
   - Its unknown-code-as-PRESENTATION rule still applies to Pine.
   - Whether Pine adopts the closed registry (the audit's P0-7: 77 Pine headlines would honestly
     downgrade) is Pine's decision, and can be made later by adding `'pine'` to
     `DECIDED_DIALECTS` and Pine's codes to `NOTE_REGISTRY`.

## What Pine is asked

- **(a)** Either make edit 1 on the Pine side, or **explicitly authorize Indicators** to make exactly
  that narrowly scoped, non-Pine-only change (owner ruling 2026-11-01: Indicators does not edit
  `PineBox.jsx` without one of the two). The byte-for-byte Pine pass-through rail stays either way.
- **(b)** Any Pine work in flight that touches `PineBox.jsx` around the verdict line, so the two
  branches sequence cleanly.
- **(c)** Whether Pine wants `importVerdict`'s classes for its own door later. This is optional and
  not needed for I2.

## Decision (2026-11-01)

- **The Pine integrator was not reachable.** No Pine session was open. Pine works from another
  machine, and the program has no cross-workstream inbox.
- **The owner explicitly authorized Indicators to make edit 1.** It is commit `7a503b07f3` on PR #577,
  as written above: additive, non-Pine only, with `importOutcome.js` untouched.
- **Pine is unchanged, and this is pinned:**
  - `pineBoxImportVerdict.test.jsx` renders 6 Pine scripts and compares their `innerHTML` with a
    fixture captured on untouched `origin/master` `f4fb9cab45`;
  - a spy proves the verdict module is never called for a Pine import.
- **For the Pine integrator on resume:** please review `7a503b07f3`. If Pine wants it shaped
  differently, Indicators will follow. Questions (b) and (c) above stay open.
