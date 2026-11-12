# Notebook simplify 2026-11-11 ledger

## Task 1: quiet frame and no unprompted offers

Deferred (go-live pass):
- Walkthrough steps that point at header controls now not rendered on the desktop Notebook (Log Trade, account selector, Generate report, settings gear, More). Tours and `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py` may reference them.
- Community and Accounts (the More menu) and Portfolio settings are not reachable from the desktop Notebook header; they stay on every other Journal page and in the touch-tier header.
- `LEARN_COPY.isNew` and `.newBadge` CSS are now unused (left in place; remove at go-live).
- A member who deletes every note sees the Get started list again (its done-state is no longer recorded once a note exists, because the gate does not mount the list).

Pre-existing test expectations changed (old behaviour deliberately changed):
- `onboarding/darkImports.test.jsx`: door tests that expect the gate to load now build the door with the automatic trigger on (third argument `true`); new case proves the app's own door loads nothing.
- `onboarding/LearnMenu.progress.test.jsx`: never-taken tours no longer carry a "New" mark or description; "Done" unchanged.
- `voice/FloatingOrb.coachmark.test.jsx`: the slot-landing case now uses `/journal/trades`; the "Notebook on a wider screen shows it" control now asserts the card waits there too.
- `notebook/GettingStartedChecklist.test.jsx`: cases that drive the list's tick and close rules with `hasAnyNotes: true` mount `GettingStartedList` directly, since the gate now renders nothing once a note exists (new cases cover the gate).
- `a11y/gettingStarted.a11y.test.jsx` (progress surface) mounts `GettingStartedList` directly, same reason as above.
- `notebook/ResearchHome.checklist.test.jsx`: "still there once the member has notes" became "gone once the member has notes".
