---
id: WISDOM-RECON-INDEX
title: UCT Wisdom Loop — session reports, where each one lives and why
---

# Wisdom Loop — recon and session reports

⛔⛔ **Not every report is in git, and the reason is §0.4f**, the owner's hard rule:

> *Public repo: no transcript text, golden quotes, private levels, positions, or credentials in
> git. gitignored `data/wisdom/` only.*

Owner ruling **R20_RECON_TRACKING: TRACK_IF_CLEAN** (2026-09-14): each report is scanned against
that rule; a clean one is tracked here, one with a hit lives in the gitignored
`data/wisdom/recon/` tree instead. **A report is never edited to make it publishable** — it is a
record of what a session found, and trimming it to fit a repo would make it a worse record.

| # | report | date | location | one line |
|---|---|---|---|---|
| 1 | `2026-09-14-recon-for-guiding-chat.md` | 2026-09-14 | ⛔ **gitignored** — `data/wisdom/recon/` | Read-only reconnaissance, Parts A–F: the whole programme mapped for the guiding chat |
| 2 | `2026-09-14-session2-repair-e5-e6.md` | 2026-09-14 | ✅ tracked, here | Repaired E5 (the `_tokens` shadowing), settled E6 on paper, prepped item 3 |
| 3 | `2026-09-14-session3-cost-item3.md` | 2026-09-14 | ✅ tracked, here | Cost menu for the 9,733-segment corpus, the item-3 decision pack, ledger closed |
| 4 | `2026-09-14-session4-rulings-build.md` | 2026-09-14 | ✅ tracked, here | Session-3 rulings applied, gate persistence (R12), item 3 built |
| 5 | `2026-09-14-session5-q17-merge-dark.md` | 2026-09-14 | ✅ tracked, here | Q17 into the rail, item 3 merged, production measured dark 27/27 |
| 6 | `2026-09-15-session6-master-sync-reconciler.md` | 2026-09-15 | ✅ tracked, here | 111 commits of master synced, item 2 reconciler built, RQ-v11-001 as review items; push and spend both blocked on the owner |
| 7 | `2026-09-15-session7-push-merge-rq.md` | 2026-09-15 | ✅ tracked, here | The branch pushed at last, RQ-v11-001 merged, the DAILY chain complete and measured inert; the three passes still unbought |
| 8 | `2026-09-15-session8-key-plumbing.md` | 2026-09-15 | ✅ tracked, here | The gate gets its own API-key variable (R32), master synced short at 25; the three passes still unbought |
| 9 | `2026-09-15-session9-three-passes.md` | 2026-09-15 | ✅ tracked, here | **The three passes are BOUGHT** ($14.6090). The floor blocks 88% of what it governs; every CALL was demoted to MENTION by an unresolvable entity master; R24 closed at 0 of 25 |
| 10 | `2026-09-15-session10-identity-bounds.md` | 2026-09-15 | ✅ tracked, here | **$0.00.** Bounds the 88%: ~18 points are a matching artifact, ~70% real instability. The chain writes 826 real rows and the queue holds 327. Corrects two session-9 errors |
| 11 | `2026-09-15-session11-promotion-ready.md` | 2026-09-15 | ✅ tracked, here | **$0.00.** Identity RULED and applied (MARKET_SIGNAL 21→61), R36 live, the promotion prepared — master merged in, CI green, PR body written. `gh` absent, so Patrick opens it |
| 12 | `2026-09-15-session12-pr-ready.md` | 2026-09-15 | ✅ tracked, here | **$0.00.** A stale market-hours clock retired from the push guard (and from my own docs), the floor retracts so the queue stops drifting, PRINCIPLE publishes under the lens (31→66), cap raised to 100 |
| 13 | `2026-09-15-session13-premerge.md` | 2026-09-15 | ✅ tracked, here | **$0.00.** R48 delivered — the ledger carries its tokens and an ABSENT count is unknown, never zero. R50 settled: **list (i), member-visible AND ungated, is EMPTY**, and it is now enforced by a rail rather than recorded in a doc. The re-run rehearsal (records present, not an empty store) found that a FORCED chain run bypasses the one switch that spends. R46 superseded by master's R18 in the sync. **Still NOT merged** |

## Why report 1 is not tracked

Scanned 2026-09-14 (session 5) against seven classes: transcript text, golden quotes/labels,
private levels, positions, credentials, member identity, and G-030-adjacent content. Reports 2, 3,
4 and 5 came back **CLEAN**. Report 1 did not.

**Classes hit, by class and count — never the content itself:**

| class | count | what it is |
|---|---|---|
| **B** golden quote / label example | 5 lines | Labelled extraction examples reproducing the statement text, including one scorer example that carries a cashtag with an entry condition and a stop |
| **C** private level | 1 line | The same example: a ticker bound to a trigger and a stop (expressed as a percentage and an R-multiple) |
| **E** credential-shaped | 3 lines | A local path carrying a session UUID, and two mentions of an outstanding token **by kind only** — no value anywhere |
| **F** member identity | 1 line | A reproduced git-log author header carrying a vendor no-reply address |
| **G** G-030 adjacent | 3 lines | Names the ruling id, the indicator, and the publication bar — **no statement text** |

⭐ **Class B alone is disqualifying**, and it is the one the rule names outright. Classes E, F and G
would not have been enough on their own: no credential VALUE appears, the address is a vendor
no-reply rather than a member's, and the G-030 lines record that the ruling's own content is *not*
held in the report. They are listed because the scan found them, not because they decided it.

⚠️ **No class A (transcript text) and no class D (position or share count) appeared in any of the
tracked reports.**

⭐ **The scan reported counts of CANDIDATES EXAMINED per class, not just hits**, so a zero is
distinguishable from "did not look". Report 1's sweep examined 350 ticker-like tokens for class C
and found exactly one bound to a level; the other 349 are version numbers, section numbers, SHAs,
costs and percentages. A regex for `$` would have flagged 185 dollar figures that are all budgets
and rates.

## Reading them in order

1 is the map. 2 repairs what 1 found. 3 prices the work and turns item 3 into a decision pack.
4 applies the rulings and builds item 3. 5 rules on what 4 left open, merges it, and measures
production. 6 syncs 111 commits of master, builds item 2's offline half and RQ-v11-001, and
records the two things only the owner can unblock. 7 gets the branch off this box and
completes the chain. 8 gives that key its own name, so feeding the gate no longer means
re-authenticating the agent session that launches it — leaving exactly one blocker: the
variable being exported. 9 spends it: three passes, reconciled and re-scored offline for $0.00, which
turn item 3 from a thing that was measured inert into a thing that blocks 366 of 418, and
which reveal that the gate scores the EXTRACTOR while the records it persists would publish
no CALL at all. 10 spends nothing and bounds what 9 measured: it puts a floor and a
ceiling under the identity question, gets the chain writing to real rows for the first time,
and corrects two of session 9's own conclusions — the entity-master mechanism (it was the
SANDBOX, not a production path) and the idea that the CALL lane was broken (a $0.00 offline
seed recovers 76.8% of it). 11 turns the measurements into rulings and gets the branch ready to leave
this box: the identity is applied to the write path, the reservation estimator is live, and the PR
body is written for a merge that changes nothing for members on the night it lands. 12 retires a
stale clock rule, makes the floor's queue self-correct, and puts PRINCIPLE under the lens. 13
delivers the one ruling 12 did not, and answers the question that has to be settled BEFORE
EXTRACT is ever ruled — who can see the four types the floor does not govern. The answer is
nobody, and the reason that is worth more than a sentence is that 12's rehearsal could not have
produced it: it ran against an EMPTY store, where a gated consumer and an ungated one print the
same zeros. Each report's own QUESTIONS section carries the state of every open decision at that
point; the newest report's list supersedes the older ones.
