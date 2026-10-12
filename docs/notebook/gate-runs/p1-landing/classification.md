# P1 landing gate -- classification of the NEW rows

Gated tree: `3cf28fd142` (P1 `ebbe856629` + `origin/master` `8179ab21be`). Manifest: `2026-10-12T04-13-20.md`.
Verdict line: `VERDICT=NEW_FAILURES exit=1 new=2 tests_failed=4 reconciles=true`.

Both NEW rows are master's. **P1 regressions: 0.**

| NEW row | Direction | Evidence |
|---|---|---|
| `src/pages/terminal/formControls.terminal.test.js` > no native <select> remains | MASTER | Also red on the base `b4282b5d9d`, run alone (2026-10-12). The sites are `pages/research/depth/SocialPolarity.jsx:102,107` (`0d3a1adfb1`, ft-080), which P1 does not touch. |
| `src/pages/terminal/panelProvenance.rail.test.js` > EXEMPT is shrink-only | MASTER | Also red on the base `b4282b5d9d`, run alone. The chain is `MyResearchPanel.jsx -> TickerResearchWorkspace.jsx -> AskPanel.jsx -> Provenance.jsx`, and P1 changes none of those four files. |

They read as NEW because the baseline (`73a4286d0`, measured 2026-09-24) predates them. They are not added to the baseline here: the baseline belongs to master, and re-measuring it is master's job.

## Gate run 1, on the pre-fix tip `a1ae66d7b2` (informational only; manifest not committed)
- `new=3`: the two rows above, plus `ScanObjectCard.test.jsx`. That one is load-sensitive: it passed when run alone on the same tree.
- P1's own red in that run was `usePreferences.additionsOnly.test.js` (an opaque `setPref(MAPPING_PREF)`). It was fixed in `ebbe856629` and is not failing in run 2.
