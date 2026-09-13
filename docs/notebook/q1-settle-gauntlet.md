# Wave Q1 — settle-site mutation gauntlet

- generated: 2026-09-12T19:14:03Z
- call sites (derived from source): **16**
- RED (covered): **16** · GREEN (UNCOVERED): **0** · skipped: **0**

⛔ GREEN is a defect, not a pass: the settle was removed and no rail noticed.

| # | site | verdict | rails said |
|---|---|---|---|
| 1 | `app/src/pages/journal-2-0/hooks/useJ2Notes.js:186` | **RED** | 2 failed | 169 passed |
| 2 | `app/src/pages/journal-2-0/hooks/useJ2NoteVersions.js:82` | **RED** | 2 failed | 169 passed |
| 3 | `app/src/pages/journal-2-0/lib/captureFinancialFact.js:53` | **RED** | 2 failed | 169 passed |
| 4 | `app/src/pages/journal-2-0/lib/captureTargets.js:49` | **RED** | 2 failed | 169 passed |
| 5 | `app/src/pages/journal-2-0/lib/importer/commit.js:434` | **RED** | 2 failed | 169 passed |
| 6 | `app/src/pages/journal-2-0/lib/importer/enrichment.js:65` | **RED** | 2 failed | 169 passed |
| 7 | `app/src/pages/journal-2-0/lib/importer/enrichment.js:86` | **RED** | 2 failed | 169 passed |
| 8 | `app/src/pages/journal-2-0/lib/noteCreation.js:46` | **RED** | 2 failed | 169 passed |
| 9 | `app/src/pages/journal-2-0/components/AddPositionModal.jsx:256` | **RED** | 1 failed | 170 passed |
| 10 | `app/src/pages/journal-2-0/components/AddPositionModal.jsx:324` | **RED** | 2 failed | 169 passed |
| 11 | `app/src/pages/journal-2-0/components/notebook/HeroImagePicker.jsx:36` | **RED** | 2 failed | 169 passed |
| 12 | `app/src/pages/journal-2-0/components/notebook/HeroImagePicker.jsx:55` | **RED** | 2 failed | 169 passed |
| 13 | `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx:1175` | **RED** | 2 failed | 169 passed |
| 14 | `app/src/pages/journal-2-0/components/notebook/ThesisReviewSection.jsx:221` | **RED** | 2 failed | 169 passed |
| 15 | `app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx:173` | **RED** | 1 failed | 170 passed |
| 16 | `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:481` | **RED** | 2 failed | 169 passed |
