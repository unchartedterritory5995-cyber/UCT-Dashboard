# OPEN QUESTIONS REGISTER (Document C Part XCV)

Each question: owner · evidence needed · decision gate · current answer · confidence. Items marked "unknowable-this-week" carry a resolution path (Document B §27A, §49).

| ID | Question | Owner | Evidence needed | Decision gate | Current answer | Confidence |
|---|---|---|---|---|---|---|
| OQ-01 | What data can legally be redistributed to members, stored, derived, and passed to AI, per vendor? | E-01..E-04, F-04; owner (OI-03, OI-09) | vendor terms + owner contract facts | licensing register (gate 5) | Unknown for FMP/Massive/Finviz contracts; public terms being collected | 🔴 |
| OQ-02 | Which provider is the source of truth for estimates, and is any estimates coverage licensed for member display? | D-03, C1-01, E-02 | provider inventory; terms | data architecture | Not yet determined (FMP price-target consensus works; upgrades/downgrades 404) | 🔴 |
| OQ-03 | Do members need options in V1, or is options flow desk-first? | D-13, B-DESK, A-04 | desk workflows, proprietary inventory | product tiers | Default: options are active for the desk; member scope decided by research | 🔴 |
| OQ-04 | Is a multi-panel / multi-monitor workspace worth its state complexity for UCT's users? | C5-01/02/03, D-06, D-11, G-01 | fixed/modular/hybrid comparison, red-teamed | Tier S eligibility | Hypothesis of equal standing with fixed pages (Part XXI) | 🔴 |
| OQ-05 | Should AI be a panel, a global interface, or a context layer on existing surfaces? | D-12, C6-*, ARCH-05 | existing AI systems; grounding patterns | AI architecture | Not determined | 🔴 |
| OQ-06 | What coexistence mechanism (route / flag / tab / mode) has the smallest blast radius on Terminal-Current? | D-08, H-07 | coexistence-current-mechanisms.md | coexistence plan (gate 16) | Options being enumerated | 🔴 |
| OQ-07 | Can the single-replica web pod carry a terminal's subscription and fan-out load, or is a separate service required (constrained by SQLite on the volume)? | D-05, D-04, C7-01, ARCH-07 | current-performance-and-realtime.md; DB/infra map | performance architecture | Not determined; constraint: jobs cannot move off web | 🔴 |
| OQ-08 | Which of the ~36 PC-scheduled jobs would a terminal depend on, and what happens when the PC is off? | D-14 | scheduler appendix | reliability architecture; risk register | Not determined | 🔴 |
| OQ-09 | Is Massive the rebranded Polygon.io, and does the plan in use permit member-facing display? | E-01, E-03, owner (OI-09) | vendor announcement; plan page; owner | licensing | Unverified claim | 🔴 |
| OQ-10 | What is the desk's fourth daily external tool (benchmark slot B-DESK-04)? | D-13, D-14, owner (OI-06) | code links, pipelines, owner | benchmark universe | Unknown | 🔴 |
| OQ-11 | Does any per-user feature targeting exist for a dark beta, or must it be built? | D-10 | flags-and-entitlements.md | rollout plan | Unknown | 🔴 |
| OQ-12 | Why does an unauthenticated GET of `/api/calendar/week` return the SPA shell (route shape vs auth fall-through)? Is this the intended API surface? | D-02, D-09 | router inspection | Terminal-Current map | Unknown | 🔴 |
