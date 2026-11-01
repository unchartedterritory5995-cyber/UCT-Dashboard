# I2: import-verdict coordination with the Pine workstream

**From:** Indicators (Milestone I2 "Honest Imports", owner-approved 2026-11-01).
**To:** the Pine integrator. The Pine program runs on another machine, so the owner relays this note.
**Status:** PROPOSAL. No shared file has been edited.

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

1. **`builder/PineBox.jsx`.** The verdict line (`data-testid="import-outcome"`, about line 1129)
   would render `importVerdict(report)` instead of `report.outcome`, **for non-Pine dialects only**:

   ```js
   const outcome = report
     ? (report.dialect !== 'pine' ? importVerdict(report) : (report.outcome || importOutcome(report)))
     : null
   ```

   - Pine's rendering and `data-outcome` values stay identical.
   - Non-Pine imports can now show `data-outcome="no-known-differences"`.
   - A new rail would render one Pine script before and after and assert the DOM is identical.

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
