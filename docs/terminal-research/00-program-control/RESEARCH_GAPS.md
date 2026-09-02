# RESEARCH GAPS (Document C Part CCLIII)

Questions requiring second-pass or targeted research. Populated as Wave 1 leaf reports land (their GAPS and NOT INSPECTED sections feed this file) and at every checkpoint.

| ID | Gap | Source report | Proposed follow-up (role, wave) | Status |
|---|---|---|---|---|
| RG-01 | GitHub branch-protection / required-checks state for `master` is not observable from this box. | D-07 §3, NOT INSPECTED | Owner input OI-13; or a read-only GitHub API call if a token becomes available. | owner-answerable |
| RG-02 | Rail selection was unguarded (substring filters) and missed three calendar-adjacent backend suites. | D-07 §1, gap 6 | FIXED on Day 1a: DL-009 tightened the rail. | closed |
| RG-03 | Live flag VALUES on Railway (e.g. whether `PATTERN_VISION_ENABLED=0` is actually set, which `*_ENABLED` gates are armed) are unknown; D-04/D-10 were restricted to key NAMES. | D-10 open q1; D-04 pending | Orchestrator-only read: `railway variables --service web --json` filtered to `*_ENABLED` / `*_MODE` keys (non-secret by construction), written to `02-data-providers/railway-flag-state.md`. Wave 2. | planned |
| RG-04 | Per-user cohort targeting for a dark beta does not exist; is `user_tags` a viable durable store, or is an env allowlist acceptable for Stage 1–2? | D-10 open q2, q3 | Fold into D-08/H-07 coexistence design; ask nothing of the owner yet. | planned |
| RG-05 | `StockChart.jsx` (15,500 lines, ~120 props) sits under the reusable `ChartPane`; whether decomposition is in scope changes the UI architecture estimate. | D-06 open q2 | ARCH-01..03 must state the assumption; red team G-02 challenges it. | planned |
| RG-06 | The four-colour link-group ceiling in `/charts` (multi-chart grid bypasses `ChartWidget` because of it). Does a typed-channel link model generalise? | D-06 open q3 | C5-01 survey + C5-03 comparison; prototype only inside the envelope if still uncertain. | planned |
| RG-08 | `/r/calendar` is consumed by morning-wire and Sunday Scan screenshot flows, not by the chart renderer as the D-09 contract assumed; D-09's integration section must be reconciled against D-08 §4 during internal synthesis (F-03a). | D-08 open q3 | F-03a cross-check; no new dispatch. | planned |
| RG-07 | Is Terminal-Next a route inside the existing `Layout` shell or its own shell? Every reuse estimate turns on it. | D-06 open q1 | D-08 coexistence options + ARCH proposals answer it as a decision with code reality; not a research gap per se. | planned |
