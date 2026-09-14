---
id: WISDOM-OVERNIGHT-CHECKPOINTS
title: Overnight autonomous run — checkpoint after each master merge
status: in progress (2026-09-13 23:38 CT →)
---

# Overnight checkpoints

⛔ **Why this file exists.** The owner asked for a checkpoint after each master merge. An
interactive session that emits prose ENDS ITS TURN, and the run would stop there — so the
checkpoints are written here as they happen and the run continues. The morning report is the
one piece of prose.

---

## Merge 3 — S-C sources · `a64336c89` · 2026-09-14 01:05 CT

| stream | branch | SHA | tests | import-ban | reviewer verdict | blockers |
|---|---|---|---|---|---|---|
| S-C sources | `wisdom/w1-c-sources` | `9193a5aa3` → **`a64336c89`** | **1009 passed, 0 failed** (24 named files, 397s) | substack/journal/private_store/offlimits **PASS** | SHIP-WITH-FOLLOW-UPS | 6 blocks-merge, **all fixed on branch** |

- **Master SHA merged onto:** `0794772b9` (re-measured immediately before; 35 behind at the start of the gate, 0 at push).
- **Railway:** `web` SUCCESS on `a64336c89`, `/api/health` `uptime_seconds: 27` — a fresh boot, not the old pod answering.
- **flow-worker:** OK, `reachable=154 watched=24 changed=26` — web-only.
- **Agents running at the time:** 0 during the gate (integrator alone), then 2 (pair 2 launched after the push). **Free memory 9.6 GB.**
- **Cost:** $0 — no model calls in this merge; reviewers are session tokens, no API spend.

**What the reviewer actually found — the adjudication, not a re-reading:**
19 candidates adjudicated → **6 VERIFIED · 5 REFUTED · 4 DOWNGRADED · 4 NEW.**

Six blocks-merge, all closed on the branch, and the two most serious were about a delete that
could outrun its copy:

| id | finding |
|---|---|
| **S01** | the Zoom trash gate read `if coverage is not None and coverage < THRESHOLD`, so an **UNMEASURABLE** coverage skipped the block entirely and deleted the only copy. Probe printed `coverage: None … DELETED: ['UUIDNODUR']`. §8a.6a: "we could not measure it" is not "it verified". |
| **S02** | the **CHAT LOG was never archived** and the recording was deleted anyway — `_is_vtt_file` answers False for a CHAT/TXT file, while §8a.6a.1 names four artifacts. Zoom has no trash recovery, so that chat log was gone. |
| **N1** *(new)* | a **SECOND Zoom delete path** no gate ever covered, behind a **default-ON** flag. |
| **N4** *(new)* | **five pre-existing desk tests asserted the delete §8a.6a forbids** — tests agreeing with the defect, the same shape as S-A's dry-run rail. |
| **S07** | the transcript resolver **MINTED A GUEST** from an ambiguous label (`Uncharted Territory → guest:uncharted-territory`) — drift #3/#4 for the **third** time. |
| **S08** | an ambiguous host label with no title match was **DROPPED as an attendee**, so a possible AUTHOR's words lost their speaker. Now `team-unresolved`, never the raw label (§0.4e). |

**Refuted, and worth naming** (the reviewer disagreeing where it should): **S05** — the archived
Zoom metadata was said to leak a credential in `download_url`. It does not: `zoom_client.download_text`
sends the token as an `Authorization: Bearer` **header**, so there is no token in the URL at all.
Read the client, not the call site.

**Also fixed this hour, and it is not S-C's:** `tests/test_cross_module_imports_resolve.py` — the
shared §7 rail that had been red "pre-existing, someone else's" for weeks — was **wrong**. Its
`_bindings` collector skipped tuple-unpacking targets, so `HOLIDAY, WEEKEND, PRE, RTH, POST,
OVERNIGHT = …` bound nothing and two importable modules were reported as unresolved. ⛔ The obvious
fix (add both to `KNOWN_DEAD`) would have permanently blinded the rail at exactly the two names it
was wrong about. The collector was fixed instead; mutation-proved (old collector → 2 of 4 red).

**Open from S-C, carried as follow-ups, not blockers:** the Zoom archive still uses `put_immutable`
rather than §8c.1.3's `put_verified` (the reviewer correctly refused to change an integrator-owned
contract), and the R2 prefix is `wisdom/sources/zoom_vtt/` where §8a.6a.1 names `wisdom/sources/zoom/`.
Both are integrator decisions; `core/r2.py` has no delete path, so a prefix change strands whatever
is already written.

---

## Reviewers — pair 1 (S-C, S-E) and pair 2 (S-F1, S-F2), 2026-09-14 00:38–01:27 CT

⭐ **The adjudication profile is the point.** The owner's instruction was that *"all N confirmed" is a red flag, not a clean bill* — a review that agrees with every scout candidate is a re-reading. Across the four streams the reviewers **refuted or downgraded 31 of 63** and found **23 findings no scout had**.

| stream | verdict | adjudicated | VERIFIED | REFUTED | DOWNGRADED | NEW | blocks-merge | all fixed |
|---|---|---|---|---|---|---|---|---|
| S-C | SHIP-WITH-FOLLOW-UPS | 19 | 6 | 5 | 4 | 4 | 6 | yes |
| S-E | FIX-BEFORE-MERGE | 20 | 1 | 6 | 5 | 8 | 3 | **NO** |
| S-F1 | SHIP-WITH-FOLLOW-UPS | 11 | 0 | 4 | 1 | 5 | 1 | yes |
| S-F2 publish | SHIP-WITH-FOLLOW-UPS | 13 | 0 | 6 | 1 | 6 | 2 | yes |
| **total** | | **63** | **7** | **21** | **11** | **23** | **12** | |

⭐ **S-E's one unfixed blocker was not S-E's to fix, and it was the best finding of the night.**
E-5: the shared §7 rail `tests/test_cross_module_imports_resolve.py` was RED on `feat/wisdom-loop`
and it was a **FALSE POSITIVE** — `_bindings` collected only `ast.Name` targets, so tuple unpacking
bound nothing and two importable modules were reported as unresolved imports. That red had been
carried as "a pre-existing non-Wisdom failure" in this programme's own ledger rows for weeks.
The reviewer correctly refused to touch it (CONTRACTS §8.2 gives shared files to the integrator) and
⛔ explicitly warned that the obvious fix — adding both names to `KNOWN_DEAD` — would permanently
blind the rail at exactly the two names it was wrong about. Fixed by the integrator at `409b7dd74`;
mutation-proved (old collector reds 2 of 4). **S-E therefore has zero open blockers.**

**Each reviewer also refuted something it had raised itself**, which is the habit worth keeping:
- **S-C / S05** — the archived Zoom metadata was said to leak a credential in `download_url`. It does
  not: `zoom_client.download_text` sends the token as an `Authorization: Bearer` **header**. Read the
  client, not the call site.
- **S-F1 / F-N4** — D20's silent scorer running with `WISDOM_LEVEL_ALERTS_ENABLED=0` looked like an
  ungated feature. It is the DESIGN: §0 ruling 13 builds D20 as a silent scorer and the enablement
  gate needs ≥14 days of silent scoring, so the scorer MUST run while emission is off. The flag gates
  EMISSION, in S-F2's module.
- **S-F2** attacked its OWN provenance rail (committed hours earlier) and found two blockers in it:
  the marked-predicate excuse laundered an UPDATE, and **a SQL COMMENT spelling `source = 'wisdom'`
  marked the site** — an analyser reading comments as code, which is the exact defect class this
  repo's "CODE, NEVER PROSE" rule exists for, committed by the rail written to enforce it.
