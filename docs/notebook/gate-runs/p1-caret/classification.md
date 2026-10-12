# P1 list-caret gate -- classification of the NEW rows

Gated tree: `4c0dcccc69` (the list caret follow-up, branched from the P1 tip `3704241461`). Manifest: `2026-10-12T08-12-19.md`.
Verdict line: `VERDICT=NEW_FAILURES exit=1 new=2 tests_failed=4 reconciles=true`.

Both NEW rows are master's and are identical to the P1 landing gate's (`../p1-landing/classification.md`). **Caret regressions: 0.**

| NEW row | Direction | Evidence |
|---|---|---|
| `src/pages/terminal/formControls.terminal.test.js` > no native <select> remains | MASTER | Also red on the base `b4282b5d9d`, run alone. The sites are `pages/research/depth/SocialPolarity.jsx:102,107`, which this branch does not touch. |
| `src/pages/terminal/panelProvenance.rail.test.js` > EXEMPT is shrink-only | MASTER | Also red on the base `b4282b5d9d`, run alone. The chain is `MyResearchPanel.jsx -> TickerResearchWorkspace.jsx -> AskPanel.jsx -> Provenance.jsx`, and this branch changes none of those files. |
