# Notebook program — RESUME HERE (all waves)

**Last verified against git: `PENDING` — set by the first session that runs a check.**

⛔⛔ **SCOPE LIVES IN `PROGRAM-MANIFEST.md`, NOT HERE.** That file is the contract.
This file holds **status, ledger, queues, and drift** — nothing else. If the two
disagree about what is in scope, the manifest wins and this file is wrong.

⭐ Q1 is **FLIPPED and live** (`OFFLINE_DEFAULT_ON = true`, 2026-09-12 00:45 ET). Its
7-day window runs to **2026-09-19 00:45 ET** and **outranks every track below.** A
Sunday REVERT or a real Q1 product anomaly stops everything.

---

## Deploy rules for this program

⭐ **`app/**` web-only — no deploy window.** The Notebook never touches
flow-worker's watch list, so the OPRA-gap reasoning in
`docs/runbooks/deploy-windows.md` does not apply. ⛔ That runbook is the Options
Flow session's and is not edited from here.

⛔ **Merges serialize: one at a time, Railway web SUCCESS before the next.** A
queue, not a window — three merges in four minutes on 2026-09-12 served 502s for
several minutes, each push marking the previous deploy `REMOVED`.

## Per-track status

| track | rows | spec | rails | code | gate | gauntlet | sweep | sandbox | matrix | MERGED-DARK | FLIPPED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **K** kill switch | — | ⏳ | — | — | — | — | — | — | — | — | — |
| **R** MUST items | R-1a R-3b R-3c R-4a | — | — | — | — | — | — | — | — | — | — |
| **S** debt | S-07 first, then S-03 S-04 S-06 S-08 S-16 … | — | — | — | — | — | — | — | — | — | — |
| **Q2-A** offline read | Q2 | — | — | — | — | — | — | — | — | — | — |
| **Q2-B/C/D** | conflict UX · attachments · mobile shell | ⏳ specs only | — | — | — | — | — | — | — | ⛔ blocked on R | — |
| **T** | T-01…T-12 | ⛔ do not build | | | | | | | | | |

## ⛔ FILE-OWNERSHIP MAP — no two tracks edit one file concurrently

| owner | files |
|---|---|
| **K** | `lib/offline/offlineFlag.js` · new `lib/config/` · the Notebook route's first-render gate |
| **R** | `app/src/widgets/registry.js` · `app/src/widgets/captureRelease.js` · `app/src/components/TickerActions.jsx` · new embed renderers |
| **S** | `lib/notebookTemplates.js` · `lib/templateContext.js` · `components/notebook/FolderSidebar.jsx` · `tabs/NotebookTab.jsx` |
| **Q2-A** | `lib/offline/` (new read-cache module + `notebookDb.js`) |

### Serialized — two tracks need one file

| file | tracks | order | why |
|---|---|---|---|
| `app/src/widgets/registry.js` | R-1a, R-3b, R-3c | **within R, sequentially** | all three add registry entries; one branch, three commits |
| `components/notebook/NoteEditorPage.jsx` | **R-4a** (image paste coverage) · **Q2-A** (cached-read render) | **R-4a first, Q2-A after R merges** | R is ahead in the queue and is the second writer to the save path; Q2-A merges master in afterwards |
| `lib/offline/offlineFlag.js` | **K** owns it; every track reads it | **K merges first** | every other track's flag rides on K's config |

⭐ **Everything else is disjoint** and may run concurrently.

## Master merge queue — dependency order, one at a time

1. **K** (dark) → 2. **R** rows → 3. **S** rows and **Q2-A** interleaved as they gate → 4. **Q2-B/C/D**

After each: Railway web **SUCCESS** → three-way verification → **DEPLOY row** in the
Q1 observation log → **one Q1 real-door canary** against production.

## Flip queue — nothing flips without the owner

| # | key | state |
|---|---|---|
| 1 | `NOTEBOOK_OFFLINE_DEFAULT_ON` (K migrates Q1 onto config) | packet pending K merge |
| 2 | R rows, as they gate | — |
| 3 | `notebook.offlineReadOn` (Q2-A) | — |
| 4 | `notebook.attachmentsOn` (Q2-C) | after K has run 48 h |

## ⛔ HOW THIS COULD DRIFT — read before trusting the table above

1. **The status table is hand-maintained.** Nothing verifies it against git. A row
   reading MERGED-DARK is a claim until someone checks the SHA — which is what
   "Last verified against git" at the top is for, and it is `PENDING`.
2. **Scope drifts by planning from the wrong doc.** Manifest §10 is titled *"TRAPS
   IN THE OLDER DOCS"* for a reason, and it has already caught one session:
   `wave-q2-PRD.md` was written from the observation-window doc and omitted mobile
   shell, which §2 names in Q2–Q5.
3. **Dark is not self-proving.** A merge that changes member-visible behaviour with
   a flag off is a defect, and only a rail catches it — the flag being false is not
   evidence.
4. **The ownership map ages.** It was measured 2026-09-12 by grepping for each
   track's entry points. New files shift it; re-measure before spawning, never
   inherit it.
