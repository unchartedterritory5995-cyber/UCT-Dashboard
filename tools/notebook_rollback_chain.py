"""Roll the Notebook back, newest landing first, as a CHAIN of commits built from objects only.

    python tools/notebook_rollback_chain.py --through wave7              # from origin/master
    python tools/notebook_rollback_chain.py --through wave5 --from <rev>
    python tools/notebook_rollback_chain.py --list                        # the chain and keep-list
    python tools/notebook_rollback_chain.py --check --from origin/master  # current (0) or stale (2)?

It never touches a worktree, an index (only a temporary GIT_INDEX_FILE) or a ref. It writes ONE
commit per step, each the parent of the next (so the result is a chain of commits on top of
`--from`), prints one JSON line per step and, last, the chain's tip to review, e.g.

    {"result": "<sha>", "tree": "<tree>", "through": "wave7", "from": "<sha>",
     "next": "git switch -c rollback/notebook-through-wave7 <sha>"}

⛔ The branch lands on master as ONE SQUASH-MERGE, so "revert the rollback" (rolling FORWARD) is
reverting that one squash. Merged as a chain instead, `git revert <result>` would undo only the
last step; the range `<from>..<result>` is what a revert would have to cover.

⛔ FAIL CLOSED on anything not measured (review round 1, 2026-09-28). The tool refuses to run when
`MEASURED_AT` is not an ancestor of `--from`, and when `MEASURED_AT..--from` holds a commit the
landing census (subject, OR a path in the derived Notebook file set) marks as Notebook work
that neither `CHAIN` nor `REVIEWED_NOT_LANDINGS` names. Every recorded
conflict resolution is PINNED to the conflict content it was measured on (`PINS`): a later commit
that changes the lines of a recorded conflict stops the chain instead of being resolved by a rule
written for different lines.

What "rolling back wave N" means at the measured tip (docs/notebook/wave5-rollback.md, the
procedure; rehearsed on a sandbox for every step, 2026-09-28, re-measured with L2 on top at
f4cec49be 2026-09-29 (lane R1b), re-measured with L4 and L5 on top at 0812b5ec3 2026-09-29
(lane R1c), and re-measured with L6 and L7 on top at 8d08da86f 2026-09-29 (lane R1d)): revert
EVERY Notebook landing newer than or equal to N, newest first, one squash at a time, because every
later wave is built on the earlier ones. At every step:

  * `docs/`, `tools/`, `scripts/` and `CLAUDE.md` stay exactly as the previous step has them
    (so as the tip has them): a rollback reverts what ships to members, never the records,
    the runbook it is following, or the operator's own instruments;
  * both schema tables stay byte-identical to the tip (`SCHEMA_FILES`): a table entry is never
    removed (wave5-rollback.md, "Rules that outlive this wave"); so do the two rails that test
    them (`SCHEMA_RAILS`);
  * a product conflict is resolved ONLY by a recorded rule (`RULES`); any other conflict STOPS
    the chain and names the file -- fail closed, never a guess.

The keep-list, by rule (never reverted): the two server H14 hotfixes (`KEPT`), the schema tables,
and, after wave 5's revert, the guard commits 8167f7aa0 and fd87271fd re-applied (tags
notebook-wave5-guard-*). 82c56dd63 is not re-applied: measured, it conflicts in five files whose
context wave 5's revert removes, and a rolled-back bundle declares schema 0 from every door,
where it is not load-bearing (wave5-rollback.md, "Why 82c56dd63 rides along").

MEASURED_AT is the tip the chain, its rules and the rehearsal were measured on.
`tests/test_notebook_rollback_chain.py` rebuilds the chain from MEASURED_AT and asserts every
step's tree equals the rehearsed one, and that no Notebook landing is missing from `CHAIN`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MEASURED_AT = "b529c8a78"          # moved from c75bf6ea0 by lane R1h, 2026-10-01 (L15 #262 live)
SCHEMA_FILES = ("app/src/pages/journal-2-0/lib/notebookSchema.js",
                "api/services/journal_two/notebook_schema.py")
# The two rails that test those tables stay with them: a table kept at the tip checked by a rail
# reverted to an older wave is a red rail on a correct tree (measured 2026-09-28: wave 6's revert
# brought back a rail that expects no level 2; the 8167f7aa0 pick brought back one that expects
# levels {0, 1} only).
SCHEMA_RAILS = ("app/src/pages/journal-2-0/lib/notebookSchema.rail.test.js",
                "tests/test_notebook_schema_guard.py")
KEEP_AT_TIP = SCHEMA_FILES + SCHEMA_RAILS
KEEP_PATHS = ("docs", "CLAUDE.md", "tools", "scripts")

# Every Notebook landing on master from wave 5 to MEASURED_AT, newest first: (key, squash, what).
# A key is what --through takes. Verified one-parent squashes, each an ancestor of the next.
CHAIN = [
    ("L15", "b529c8a78", "wave 10 L15 #262"),
    ("L14", "0e7d0561a", "wave 10 L14 #260"),
    ("L13", "a680b0d40", "wave 10 L13 #259"),
    ("L12", "599cd44f1", "wave 10 L12 #258"),
    ("L10", "8eb7f008b", "wave 10 L10 #257"),
    ("L9", "89390fb85", "wave 10 L9 #256"),
    ("L8", "6f563c158", "wave 10 L8 #255"),
    ("L7", "8d08da86f", "wave 10 L7 #254"),
    ("L6", "3fb184cdf", "wave 10 L6 #253"),
    ("L5", "0812b5ec3", "wave 10 L5 #252"),
    ("L4", "7bd834b9f", "wave 10 L4 #251"),
    ("L2", "f4cec49be", "wave 10 L2 #242"),
    ("L1c", "38bb9a421", "wave 10 L1c #228"),
    ("225", "4bba30b73", "#225 H14: the phone skip link"),
    ("L1b", "d9e887ca0", "wave 10 L1b #224"),
    ("L1a", "4f708a0d2", "wave 10 L1a #205"),
    ("204", "2ab637644", "#204 H14: every read-then-write note door takes the write lock"),
    ("203", "c6a8a9d3a", "#203 H14: depth cap, Word intake, PDF extraction budget"),
    ("wave9", "1c4b0bf74", "wave 9 #202"),
    ("201", "7e3f9e117", "#201 H14: the pane heading never moves the toolbar"),
    ("wave8", "caf6d1b9e", "wave 8 #198"),
    ("9C", "2e0598bfa", "wave 9C #197: the soak instrument"),
    ("wave7", "f883e0996", "wave 7 #196"),
    ("wave6", "271a078b6", "wave 6 #193"),
    ("wave5", "2c3ed3093", "wave 5 #186"),
]
# Server write-safety hotfixes: never reverted with the features (measured merge-clean at every
# step below them). --revert-hotfixes reverts them too (also measured merge-clean).
KEPT = {"2ab637644", "c6a8a9d3a"}
# After wave 5's revert, in this order.
GUARD_PICKS = ("8167f7aa0", "fd87271fd")

# The landing census (what counts as a Notebook landing past MEASURED_AT): two criteria, and a
# one-parent commit EITHER one selects stops the tool unless CHAIN or REVIEWED_NOT_LANDINGS names it.
#   * SUBJECT: it changes shipped code (`app/`, `api/`) and its subject takes one of the forms a
#     Notebook LANDING's squash subject takes (`NOTEBOOK_SUBJECT`). Over wave5^..MEASURED_AT this
#     selects every CHAIN entry except five, for two DIFFERENT reasons:
#       - `ships` is false: L6 (`3fb184cdf`), L8 (`6f563c158`) and L9 (`89390fb85`, all lane R1d
#         then R1e, 2026-09-29/30) are real wave 10 landings -- rollback-chain tooling + rehearsal
#         evidence, a restore-drill fix, proof-walk evidence, the parity-scorecard re-score, and
#         (L9) the tool coverage for L6/L7/L8 itself -- that ship NO `app/` or `api/` file at all,
#         so `ships` is false and SUBJECT never selects them however their subject reads.
#       - the subject lost the literal word "wave": L10 (`8eb7f008b`) and L12 (`599cd44f1`, lane
#         R1e, 2026-09-30) DO ship real `app/`/`api/` Notebook code (`ships` is true), but their
#         squash subjects read "Notebook w10 L10: ..." / "Notebook w10 L12: ...", a convention
#         shift from "Notebook 10/10 -- wave 10 LN: ..." that drops "wave", so `NOTEBOOK_SUBJECT`
#         does not match. Left as a declared exception rather than a regex change: widening the
#         pattern to catch "w10" is exactly the kind of loosening that once made this regex select
#         a build-perf commit (see the R1b fix note below) -- PATH already catches both, and a
#         future subject convention drift gets the same treatment, not a new regex clause per drift.
#     All five are in CHAIN anyway (the wave's own numbering names them, and the operator needs
#     `--through L6`/`--through L8`/`--through L9`/`--through L10`/`--through L12` to mean what
#     they say), selected by PATH ONLY (L6's one Notebook-owned file is
#     `tests/test_notebook_rollback_chain.py`, the rollback tool's own test suite; L8's is
#     `tests/test_parity_scorecard.py`; L9's is also `tests/test_notebook_rollback_chain.py`;
#     L10's and L12's are the many `app/src/pages/journal-2-0/**` files they ship, which SUBJECT
#     would have selected too had the word "wave" survived). Reverting any of the three
#     `ships`-false ones is a no-op for members and, measured, conflict-free (nothing else in this
#     window touches their files); L10 and L12 revert real product code, measured conflict-free
#     below. `test_the_subject_criterion_selects_every_chain_landing` states this exception rather
#     than silently tolerating it.
#   * PATHS: it touches a file in `notebook_files()` -- DERIVED, never typed: the union of the
#     files every CHAIN landing's own squash changed, minus KEEP_PATHS (never reverted, so a
#     later change there cannot make a revert wrong). Review round 2 (2026-09-28): a hand-typed
#     path regex missed real Notebook files (useJ2Notes.js, importer/commit.js,
#     public_note_payload.py). ⚠️ The union is BROAD on purpose: shared files such as `app/src/
#     App.jsx` and `api/main.py` are in it, so another workstream's commit that touches them is
#     flagged too. Each such commit needs a REVIEWED_NOT_LANDINGS entry with a reason; that is the
#     intended fail-closed behaviour, not noise to tune away.
# The three forms CHAIN's own squash subjects take, read off them (a rail iterates CHAIN and asserts
# every entry is still selected by this pattern):
#   "Notebook [10/10 — ]wave N ..."            -- every wave squash (5 to 10 L2);
#   "fix(notebook): ..." / "hotfix(notebook): ..." -- the H14 hotfixes #201 #203 #204 #225;
#   "Wave 9C: ..."                              -- the soak instrument.
# ⚰️ Until fix round 1 of lane R1b (2026-09-29) this was `\bnotebook\b` ANYWHERE in the subject,
# which selected 3e5153f1d "perf(build): ... (Notebook bytes back under budget)" -- a build fix
# the REVIEWED rail may not rule out (a subject-selected commit is a landing), so the next
# re-measure would have had to add a build perf fix to the chain and revert it. A Notebook change
# in any other form is still caught by the PATH criterion.
NOTEBOOK_SUBJECT = re.compile(r"(?i)^(?:notebook\b.*\bwave\b|(?:hot)?fix\(notebook\):|wave 9c\b)")
# Commits a person reviewed and ruled NOT a Notebook landing although a criterion selects them:
# {full sha: why}. Each one is selected by PATH only (never by subject: a subject-selected commit
# is a landing and belongs in CHAIN); the rail re-derives that. Lane R1b, 2026-09-29: the twelve
# path-only commits in 38bb9a421..f4cec49be, read one by one. Only 948af2c17 edits Notebook CODE
# (the Ask and writing-help doors); it is a Terminal feature, not a landing, and its lines are
# handled by the L1a and wave-7 rules below -- reported, not buried.
# Lane R1c, 2026-09-29: the thirteen path-only commits in f4cec49be..0812b5ec3 (L4..L5), read one
# by one. NONE edits Notebook-owned code (no app/src/pages/journal-2-0/**, no
# api/services/journal_two/**, no notebook_*.py router) -- every one touches only a file the
# derived Notebook set pulls in because an earlier CHAIN landing also touched it: api/main.py
# (lifespan wiring or a router's own dependency list), api/routers/auth.py (a preference key or an
# unrelated flag helper), app/src/pages/Settings.jsx or Support.jsx (an unrelated card or strip),
# app/vite.config.js (the build-time manifest-stripping plugin every page's bundle goes through),
# or app/src/components/screener/reachable.test.js (the AWAITING_A_DECISION ledger, Pine/breadth
# entries). Nothing here is RAISED.
# Lane R1d, 2026-09-29: the four path-only commits in 0812b5ec3..8d08da86f (L5..L7), read one by
# one via their own diffs and messages. NONE edits Notebook-owned code: 8393002716 (TERM-038, the
# command palette's address space) and 0c74088f0 (TERM-049, Research History tab) each add a
# router mount to api/main.py and a flag-reader + payload key to api/routers/auth.py, the same
# shape as the existing TERM-039/TERM-049(054)-room entries above; 8393002716 also edits
# app/src/components/CommandPalette.jsx (adds a `saved` row kind below tickers/notes -- the L1b
# `notebookTelemetry` import and the L1b `note`-row telemetry hunk are both untouched regions of
# that file, confirmed by re-recording L1b's pin, which came back unchanged). 197e524176 (breadth,
# a read/write-safety fix + the dark V2 authority replica) touches only api/main.py (a lifespan
# startup block). 9633d68e8 is the RE-LAND of the *same* H15 rollback `1be4b9a2b` already reviewed
# above (a different "wave 2" -- the Pine/deploy-integration branch, not a Notebook wave): its
# reachable.test.js hunk re-adds the identical Pine-runtime AWAITING_A_DECISION entries
# `1be4b9a2b`'s revert removed, and its vite.config.js hunk re-adds the market_calendar.json
# stripping block that revert took out -- confirmed by reading both diffs side by side. Nothing
# here is RAISED.
# Lane R1d, continued: a fifth path-only commit landed while this lane worked, in
# 8d08da86f..6f563c158 (on top of L8 #255, itself in CHAIN by path -- see the SUBJECT-criterion
# comment above): cd9ecc833 (Fundamentals V5 cutover foundation, dark -- no flag set, no V5 object
# published) touches only api/main.py, removing the web-pod's own lifespan registration of the
# fundamentals_pit scheduler (moved to the worker pod, a comment left in its place); no Notebook
# route touched.
# Lane R1e, 2026-09-30: the nine path-only commits in 6f563c158..599cd44f1 (on top of L9/L10/L12,
# all three in CHAIN by path -- see the SUBJECT-criterion comment above), read one by one via their
# own diffs. Two were handed down already ruled by the controller and reverified here by reading
# them: df82f7a1e (a revert of another workstream's wave-3 Pine-engine integrate merge, a3afa840d
# -- a 2-parent merge commit itself, so the census never selects it directly) and da7d23f49 (a
# clock/build-budget perf commit). NONE of the nine edits Notebook-owned code: two touch only the
# shared AWAITING_A_DECISION rail (app/src/components/screener/reachable.test.js, an econ-harness
# entry each); two touch only api/main.py (an event-loop fix, a Terminal-Next router mount); one
# touches only api/routers/auth.py (a Terminal-Next flag reader); one touches api/main.py AND
# api/routers/auth.py (a BRK-01 router mount + flag reader); and three -- da7d23f49, and the
# revert/reapply pair df82f7a1e/ae60a34b3 -- touch app/vite.config.js (the same shared
# manifest-stripping build plugin 20bbfd05d and 3e5153f1d used) and
# app/src/pages/journal-2-0/lib/widgetEmbed{,Core}.test.jsx: da7d23f49 only widens that test file's
# purity-scan assertion to match its own calendarCompact.js change (no Notebook behaviour edited);
# df82f7a1e/ae60a34b3 toggle one async/await sequencing test for `stampChartSettings` on and off as
# the Pine-engine merge they wrap is reverted then reapplied -- read side by side, byte-identical
# except for that one `await`/lazy-load pairing, confirming the two are mirror-image toggles of the
# SAME external change, not two separate edits. Nothing here is RAISED.
# Lane R1f, 2026-09-30: one path-only commit in 599cd44f1..a680b0d40 (on top of L13, in CHAIN by
# subject AND path -- its squash kept the literal word "wave", unlike L10/L12), read via its own
# diff: 69beea8d1 (Terminal TERM-073, the nightly analyst-revisions "what changed" timeline, dark)
# touches only api/main.py among shared files (one router mount behind ANALYST_REVISIONS_ENABLED);
# its own router, service and panel files are all outside the derived Notebook set. Nothing here is
# RAISED.
# Lane R1g, 2026-10-01: five path-only commits in a680b0d40..c75bf6ea0 (on top of L14, in CHAIN by
# SUBJECT AND PATH both -- its squash kept the literal word "wave", same shape as L13), read via
# their own diffs and messages. Four are a Terminal accessible-name initiative (TERM-067), each
# touching exactly one shared file already in the derived Notebook set: f771f3d0b (Admin page +
# the Desk team form) touches only app/src/pages/desk/TeamSection.jsx; 9601fe2c2 (a Textarea UI
# primitive + the Model Book pass) touches app/src/pages/Settings.jsx only to move the
# account-deletion reason box onto the new primitive; 3735184f7 (every control on the Settings
# page) touches app/src/pages/Settings.jsx wholesale; 79e16f694 (Input/Select/Checkbox/FieldError
# primitives + control-density tokens) touches app/src/styles/tokens.css only to add density
# steps, migrated onto the chart Custom-Period Sort popover. None edits a Notebook route or file.
# The fifth, c75bf6ea0 (hotfix(tools) #261), is a direct sequel to L14's own tools-census-pin work:
# it un-pins tools/record_clock_parity.py (KEEP_PATHS, excluded from the census regardless -- a CI
# job without pytest runs it and the promotion that pinning it broke was refused) and adds a test
# to tests/test_tools_pin_the_root.py, which the census now sees ONLY because L14 itself created
# that file; no app/ or api/ Notebook code is touched. Nothing here is RAISED. MEASURED_AT moves
# all the way to c75bf6ea0 (not L14's own sha) because a REVIEWED_NOT_LANDINGS entry must fall
# inside the measured window the rail checks (`WAVE5^..MEASURED_AT`); and because the hotfix's
# own edit to tests/test_tools_pin_the_root.py is a REAL conflict with L14's revert (both touch
# that file; it is not a KEEP_PATH), that conflict now has its own rule -- see RULES["0e7d0561a"].
# Lane R1h, 2026-10-01: one path-only commit in c75bf6ea0..b529c8a786 (on top of L14+hotfix, in
# CHAIN by SUBJECT AND PATH both -- its squash kept the literal word "wave", same shape as
# L13/L14), read via its own diff and message: 726586201 (feat(charts): Technical library Tier 1
# -- 33 studies, 9 MA types, real fixed scales) touches app/src/pages/Settings.jsx only to widen
# the Moving Average overlay's type <select> from a hardcoded SMA/EMA pair to the full MA_TYPES
# kit for an ADOPTED (engine-instance) overlay slot; every other file it ships
# (movingAverages.js, technicalStudies.js, technicalCategories.js, indicatorCatalog.js, the chart
# engine's readout/sourceRef/registrySizes modules, their tests, and a decision-record doc) sits
# outside the derived Notebook set entirely. No Notebook route or file touched. Nothing here is
# RAISED. MEASURED_AT moves to L15's own sha, b529c8a786, not past it: unlike L14's window, no
# REVIEWED_NOT_LANDINGS commit lands after L15 in this one -- L15 is the newest commit the census
# selects at all, and it is itself the tip.
REVIEWED_NOT_LANDINGS: dict[str, str] = {
    "7265862018f7a2fee21771fce86e5dea580e87c7":
        "feat(charts): Technical library Tier 1 -- 33 studies, 9 MA types, real fixed scales; "
        "touches app/src/pages/Settings.jsx only to widen the Moving Average overlay's type "
        "<select> from a hardcoded SMA/EMA pair to the full MA_TYPES kit for an ADOPTED "
        "(engine-instance) overlay slot (shared file); every other shipped file "
        "(movingAverages.js, technicalStudies.js, technicalCategories.js, indicatorCatalog.js, "
        "the chart engine's readout/sourceRef/registrySizes modules) is outside the derived "
        "Notebook set, no Notebook route touched",
    "1be4b9a2b8a6d916e8f4750f0bd4cc495137341e":
        "Revert of an accidental merge from the Pine vendor-harness branch (wave 2); its "
        "reachable.test.js hunk is entirely Pine-runtime AWAITING_A_DECISION entries and its "
        "vite.config.js hunk removes the market_calendar.json stripping block this same window's "
        "20bbfd05d re-adds; no Notebook file touched",
    "ea93f15287401c670a24ee470a84d40263a232b2":
        "Terminal TERM-021: read-new phase adds a watchlist_columns preference key to "
        "api/routers/auth.py's _PREFERENCE_KEYS dict (shared file); the Charts board's own column "
        "layout, no Notebook route touched",
    "57f6348363abccfb99419500df898a54540d08f4":
        "Terminal TERM-052: publish density ceilings; touches app/src/pages/Settings.jsx only to "
        "widen one SEARCH_INDEX keyword string (shared file), not a Notebook card",
    "d506943792ddc4a0154a8399eaaf4da14092e6aa":
        "Terminal TERM-059: the NAAIM freshness badge adopts freshnessAge.js; its "
        "reachable.test.js hunk retires a Breadth AWAITING_A_DECISION entry (shared rail)",
    "584896582286d22d04912f63ab8c53a74086f227":
        "Terminal TERM-042: server-computed EOD breadth row, dark behind BREADTH_EOD_SOURCE; adds "
        "one lifespan startup block to api/main.py (shared file), no Notebook router touched",
    "20bbfd05de695e8d18483f1cd3e8c9118d01a5f6":
        "perf(clock): ship market_calendar.json compact via the SAME vite.config.js build plugin "
        "that strips the Pine manifests' prose (shared build file); the subject's 'so the Notebook "
        "stays in budget' names the bundle-wide byte budget the Notebook's own perf gate reads, "
        "not a Notebook code change",
    "9cfb3c9639383af9033f3600532ed1846bd37786":
        "Terminal TERM-037: the panel set as a by-product of the surface set; its "
        "reachable.test.js hunk is a surfaces/ AWAITING_A_DECISION entry (shared rail)",
    "2994ab6f3690578c912074320e23a724b1637fef":
        "Terminal TERM-053: gates the GEX router's own mount with get_current_user in api/main.py "
        "(shared file), an ARCH-06 auth fix unrelated to any Notebook router",
    "71fdb71ad1b8c38735f43d6cc24be708d8ff6ce3":
        "Terminal TERM-062: the filing-watch cooldown sweep reads its enable flag from "
        "document_arrival.py instead of an inline os.environ check in api/main.py (shared file); "
        "no Notebook route touched",
    "3e5153f1d3bba79263d804c76b3b8cd8b4801dc9":
        "perf(build): strips symbolScope.json's prose via the same vite.config.js manifest plugin "
        "as 20bbfd05d (shared build file); its subject's '(Notebook bytes back under budget)' is "
        "the same bundle-wide byte-budget reference, not a Notebook code change -- also excluded "
        "by SUBJECT (NOTEBOOK_SUBJECT requires 'wave' after 'notebook')",
    "e90fddc34bae507c5487837085c41613fa8cf1d4":
        "Terminal TERM-039: member-facing feature status; touches api/routers/auth.py (an "
        "unrelated _breadth_dc_flags refactor) and adds a FeatureStatusStrip import+render to "
        "app/src/pages/Support.jsx (shared files), no Notebook code path changed",
    "bb72f130548ff78a6f3bb8a7b90376070caecb15":
        "feat(pine): routes the columnar lane's unrepresentable scripts to the per-bar runtime "
        "lane, dark behind VITE_PINE_RUNTIME_PANE_ENABLED; its reachable.test.js hunk retires Pine "
        "AWAITING_A_DECISION entries (shared rail)",
    "3646a4c193830a359e4aa480769b5e173c7081aa":
        "test(pine): param ids re-pinned after new inputs minted; touches "
        "app/src/components/screener/reachable.test.js only via the shared AWAITING_A_DECISION "
        "ledger's line-count drift, not a Notebook entry",
    "91a33ea2899afa7a635740b14c44b98d11f08169":
        "Terminal TERM-080: rate-limit middleware mounted in api/main.py (shared file); dark, "
        "edits no Notebook file",
    "c26c8f8634152af58e289b769069cfbb730debdc":
        "Terminal TERM-089: wire archive rows appended to tests/test_paywall_gate_free_tier.py "
        "(shared rail wave 5 touched); the wave-5 rule keeps them",
    "59eefe3913a11232e776052bd917f102927a99c8":
        "Terminal TERM-081: users.toolkit column in api/services/auth_db.py (shared file), "
        "not a Notebook change",
    "dccc0acc4b4a474ecc32669d737c7ea8019444e4":
        "Terminal TERM-088: decision-record router mounted in api/main.py and flag in "
        "api/routers/auth.py (shared files); dark",
    "948af2c17d034f2cf938acf2fa01f45e96d89671":
        "Terminal TERM-078: AI meters + population cap. EDITS NOTEBOOK CODE (a dark population "
        "gate in notebook_writing_help.py and the Ask door in journal_two.py, a read() in "
        "daily_counters.py); not a landing -- the L1a and wave-7 rules resolve its lines",
    "105e611abe18b16db6c3287861b153edcc10a5a5":
        "Terminal TERM-086: inbound-alerts router mounted in api/main.py (shared file); dark",
    "11f9c5803da4bb4981bdf68fdf9271c999ed777d":
        "Terminal TERM-076: DeviceSyncCard mounted in app/src/pages/Settings.jsx (shared file)",
    "4cd31df8b24024b7958af0bd0335d0d31ea14cd1":
        "Terminal TERM-077: watchlist copy-or-link flag in api/routers/auth.py (shared file); dark",
    "c7a8a7309c963032d45c1cc129efdd3b52a1eb74":
        "Compass ai-spend: daily caps on Compass routes in api/routers/journal_two.py (shared "
        "J2 router), no Notebook route touched",
    "1b26a787bf556fe8a8a9b3850ddff3a0c5e51c40":
        "Charts: moving-average settings in app/src/pages/Settings.jsx (shared file)",
    "3fa6e6becb4d43f23129931f405458d2041566a7":
        "Terminal TERM-035: registers sessionCalendar.js in "
        "app/src/components/screener/reachable.test.js (shared rail)",
    "3998b7c7053ebddbc17d315ed9acee08c3359ae7":
        "Terminal TERM-035: NYSE calendar derivation; edits "
        "app/src/components/screener/reachable.test.js (shared rail)",
    "8393002716ba1aecbf044c895f40ed473bdf9deb":
        "Terminal TERM-038: command palette address space (Ctrl/Cmd+K types a saved layout/"
        "watchlist/note by name); mounts a router in api/main.py, adds a flag reader + payload "
        "key in api/routers/auth.py, and adds a 'saved' row kind to "
        "app/src/components/CommandPalette.jsx below tickers/notes (shared files); no Notebook "
        "route or file touched",
    "197e524176569a4aeb1bbd647041aa58280bcfd0":
        "Breadth: a member request never writes Breadth state (read/write-safety fix) + the dark "
        "BREADTH_V2_SYNC_ENABLED authority replica; touches only api/main.py (a lifespan startup "
        "block), no Notebook route touched",
    "0c74088f0ff41c7c3103d3b882f1050d91f815f8":
        "Terminal TERM-049: Research > History tab (per-ticker citable-lane join), dark behind "
        "TICKER_HISTORY_ENABLED; mounts a router in api/main.py and adds a flag reader + payload "
        "key in api/routers/auth.py (shared files), no Notebook route touched",
    "9633d68e8cfd3e2ca5cdc2b39d579f2b65800300":
        "Re-lands 7ffd8e655 (the H15 rollback 1be4b9a2b, already reviewed above, reverted): a "
        "different 'wave 2' -- the Pine vendor-harness / deploy-integration branch merge, not a "
        "Notebook wave. Its reachable.test.js hunk re-adds the identical Pine-runtime "
        "AWAITING_A_DECISION entries 1be4b9a2b's revert removed, and its vite.config.js hunk "
        "re-adds the market_calendar.json stripping block that revert took out; no Notebook file "
        "touched",
    "cd9ecc83333ab0ffaf64b2185aab0d6d1b6c6fd3":
        "Fundamentals V5 cutover foundation, dark (no flag set, no V5 object published); touches "
        "only api/main.py, removing the web pod's own lifespan registration of the "
        "fundamentals_pit scheduler (moved to the worker pod), no Notebook route touched",
    "71035621d27bbb282b03cf4924a8d55cac5aba88":
        "test(econ): records the dev-only Economic UI acceptance harness in the shared "
        "reachable.test.js AWAITING_A_DECISION ledger and symbolLinkChannels.test.js (shared "
        "rails), no Notebook route or file touched",
    "422bad42c1fa658fcb49a07e095206b2666f5f8c":
        "fix(web): the etf-index-symbols route runs off the event loop (a production-stall fix); "
        "touches only api/main.py (shared file), no Notebook route touched",
    "706f89b83086220ef8eea2d72a92c22efb5996dd":
        "feat(tnext): Terminal-Next MVP trial withdrawal switch (Rung 0 kill); touches only "
        "api/routers/auth.py among shared files (a flag reader), the rest is breadth-drill UI and "
        "Terminal-Next tests, no Notebook route touched",
    "017f40d9388160b1b659e8b7679c31dcdd15d468":
        "feat(research): BRK-01 increment 1, the member-facing option chain, dark; mounts a router "
        "in api/main.py and adds a flag reader + payload key in api/routers/auth.py (shared "
        "files), no Notebook route touched",
    "ae60a34b3f6e7ab70b8ed61b446962ab2b1781e3":
        "Reapplies the wave-3 Pine-engine integrate merge a3afa840d after df82f7a1e's revert (same "
        "workstream toggling itself); its widgetEmbed.test.jsx hunk only restores the "
        "await/lazy-load pairing for stampChartSettings that the revert removed, no new Notebook "
        "behaviour",
    "df82f7a1e97d6a00a25a5a7f5ca0ff638618ac4c":
        "Revert of another workstream's wave-3 Pine-engine integrate merge a3afa840d (a 2-parent "
        "merge commit, never itself selected by the census); its widgetEmbed.test.jsx/"
        "widgetEmbedCore.js hunk removes a lazy-load-the-Pine-engine optimisation for "
        "stampChartSettings, reverting to synchronous settings resolution -- a Pine-engine byte-"
        "budget change to a Notebook-owned file, not a Notebook feature or fix",
    "da7d23f493a64b2aed276545ffce9fb803c07611":
        "perf(clock): market calendar dates as base-36 day gaps (wave-3 byte budget, same "
        "shared manifest-stripping vite.config.js plugin as 20bbfd05d/3e5153f1d); its only "
        "journal-2-0 touch is none -- the notebook_first_open byte-budget line it moves is a "
        "shared build gate, not a Notebook code change",
    "711b95c038b52bbbfd0b3ff928cafaef97accb50":
        "feat(econ): frontend currentness mapping and the real-data econ harness; its only shared-"
        "rail touch is app/src/components/screener/reachable.test.js (an econ AWAITING_A_DECISION "
        "entry), no Notebook route touched",
    "326d070c0d21b1bb575d121c9a342bcf6318f2fd":
        "feat(econ): 10 economic-data source adapters, member API and serving, isolated from stock "
        "bars; touches only api/main.py among shared files (router mounts + lifespan wiring), no "
        "Notebook route touched",
    "69beea8d10520fac1374bcf20a4e9a54af845c95":
        "Terminal TERM-073: nightly analyst-revisions 'what changed' timeline, dark; mounts a "
        "router in api/main.py (shared file) behind ANALYST_REVISIONS_ENABLED, no Notebook route "
        "touched",
    "f771f3d0b8c9a1baa63668ddc7c98758b56f9f15":
        "Terminal TERM-067: accessible-name pass over the Admin page and the Desk team form; "
        "touches app/src/pages/desk/TeamSection.jsx only to add aria-labels to its ten "
        "member-form controls (shared file), no Notebook route touched",
    "9601fe2c2dda9127f3842cc9402c3215f2810540":
        "Terminal TERM-067: a Textarea UI primitive + the Model Book accessible-name pass; "
        "touches app/src/pages/Settings.jsx only to move the account-deletion reason box onto "
        "the new Textarea primitive (shared file), not a Notebook card",
    "3735184f77df338a1a0dfcf1617b6d2b4c370aa8":
        "Terminal TERM-067: every control on the Settings page gets an accessible name (26 "
        "controls); touches app/src/pages/Settings.jsx wholesale (shared file) and the "
        "form-control census rail, no Notebook route touched",
    "79e16f694e6f86e5a53f8fef8981dc84fb02a2c4":
        "Terminal TERM-067: Input/Select/Checkbox/FieldError UI primitives + control-density "
        "tokens; touches app/src/styles/tokens.css only to add compact/comfortable density "
        "steps (shared file), migrated onto the chart Custom-Period Sort popover, no Notebook "
        "route touched",
    "c75bf6ea0accaaf0465d69813c40331657466e78":
        "hotfix(tools) #261: un-pins tools/record_clock_parity.py (KEEP_PATHS, excluded from "
        "the census regardless -- a CI job without pytest runs it and the promotion that "
        "pinning it broke was refused) and adds a test to tests/test_tools_pin_the_root.py, "
        "which the census sees only because L14 itself created that file; no app/ or api/ "
        "Notebook code touched",
}
_NOTEBOOK_FILES: dict[str, frozenset] = {}
# `ours_drop` on `api/main.py` takes out only the wave's own router lines, so everything else in
# the hunk -- the tip's `_OPEN_READS` dependency on the journal_two mount (94926db1e, not a
# Notebook commit) included -- stays.
# Recorded resolutions for PRODUCT conflicts, {squash: {path: rule}}:
#   "delete"  the file goes (the wave added it; a later commit only touched its prose)
#   "ours"    the previous step's copy
#   ("hunks", [choice per conflict hunk], {post})  choice: "ours", "theirs", a literal
#       replacement, or ["ours_drop", <substring>...] = ours minus the lines holding them
#       (each substring must drop exactly one line); "all-ours" for every hunk.
RULES: dict[str, dict] = {
    # Lane R1g, measured at c75bf6ea0: modify/delete, same shape as wave 7's daily_counters.py
    # below. L14 ADDED tests/test_tools_pin_the_root.py (the tools-census-pin rail); the hotfix
    # c75bf6ea0 (REVIEWED_NOT_LANDINGS, #261) is a direct continuation of that SAME repo-hygiene
    # work -- it un-pins tools/record_clock_parity.py (a CI job without pytest runs it) and adds
    # a test to this file for that EXEMPT_TOOLS move. The rail covers 50 pinned + 36 exempt
    # tools/*.py files, none of it Notebook-owned in a product sense; deleting the file on L14's
    # revert would also delete the hotfix's own, independent, already-landed test coverage. Kept
    # ("ours"): the newer work stays, same reasoning as daily_counters.py.
    "0e7d0561a": {"tests/test_tools_pin_the_root.py": "ours"},
    # Lane R1b, measured at f4cec49be: TERM-078 (948af2c17) put one population-gate call inside
    # L1a's property-autofill route. The route is L1a's own and goes whole ("theirs" = the
    # pre-L1a side, which has no route); the `_population_gate` helper it calls stays, because
    # the writing-help stream route (wave 7) still calls it.
    "4f708a0d2": {"api/routers/notebook_writing_help.py": ("hunks", ["theirs"])},
    "d9e887ca0": {
        "app/src/components/CommandPalette.jsx": ("hunks", [["ours_drop", "lib/notebookTelemetry'"]]),
        "tests/test_alert_destination.py": ("hunks", [[
            "ours_drop", "Notebook wave 10 lane 10D: the Notebook save-SLO pager",
            "read and converted at the Notebook's L1b integration",
            "so it never shipped as a literal reader", "api/services/journal_two/notebook_slo.py"]]),
    },
    "caf6d1b9e": {
        "api/main.py": ("hunks", [[
            "ours_drop", "Wave 8 seam S8-2: the share routes' own router",
            "# same pre-journal_two slot; tests/test_notebook_share_routes.py +",
            "# tests/test_main_router_order.py).", "notebook_shares_router.router",
            "Wave 8 seam S8-2: three STUB routers", "/api/j2/publish*|published* (8B)",
            "Outside /api/j2/notes/..., so mount order", "notebook_publish_router.router",
            "notebook_export_router.router", "notebook_onboarding_router.router"]]),
        "api/routers/auth.py": ("hunks", [[
            "ours_drop",
            "# Wave 8 seam S8-1: the ONE parse for every Notebook capability flag. The truthy /",
            "# falsy sets live there now; `_breadth_dc_flags` below reads the same two sets.",
            "from api.services.notebook_flags import FALSY as _FALSY, TRUTHY as _TRUTHY, flag_on"]]),
        "api/services/journal_two/public_note_payload.py": "delete",
        "tests/test_share_publish_authorization.py": "delete",
        # Lane R1c, measured at 0812b5ec3: TERM-039 (e90fddc34, REVIEWED_NOT_LANDINGS)
        # added a FeatureStatusStrip import right after wave 8's two notebook imports.
        # Drop only wave 8's own two lines; TERM-039's import is not this landing's to
        # revert and stays.
        "app/src/pages/Support.jsx": ("hunks", [[
            "ours_drop", "offline/notebookFlags'", "onboarding/tourControl'"]]),
    },
    "f883e0996": {
        "api/main.py": ("hunks", [[
            "ours_drop", "# Wave 7 lane H (controller wiring): /api/j2/notes/{note_id}/writing-help/stream.",
            "# Mounted beside the other pre-journal_two Notebook routers; no path here can",
            "# be shadowed by journal_two's /api/j2/notes/{note_id} (different depth), but",
            "# the family is kept together and the mount is railed by name",
            "# (tests/test_main_router_order.py).", "notebook_writing_help_router.router"]]),
        # Lane R1b, measured at f4cec49be (modify/delete: wave 7 added both files, TERM-078
        # 948af2c17 edited both). The writing-help router is wave 7's own door and goes; its
        # only later edit is TERM-078's population gate, which gates nothing once the route
        # is gone.
        "api/routers/notebook_writing_help.py": "delete",
        # ⛔ daily_counters.py STAYS: it is no longer the Notebook's alone. TERM-078's
        # ai_population_cap.py and c7a8a7309's compass_daily_caps.py import it at module
        # level (journal_two.py imports compass_daily_caps), so deleting it stops the server
        # from importing at all. Keep the newer work.
        "api/services/daily_counters.py": "ours",
    },
    "271a078b6": {"api/main.py": ("hunks", [[
        "ours_drop", "# Wave 6 (controller wiring) -- ORDER IS LOAD-BEARING: notebook_insights before",
        "# journal_two, or /api/j2/notes/tasks is answered as a note called",
        "# (lane F's report; rail tests/test_main_router_order.py).",
        "notebook_insights_router.router", "client_errors_router.router",
        "notebook_link_preview_router.router"]]),
                  "api/services/client_errors.py": "delete"},
    # Lane R1b, measured at f4cec49be: TERM-089 (c26c8f863) appended its two /api/wire/archive
    # rows to REACHED_FROM_FREE_PAGE right after wave 5's five editor-widget rows. The hunk's
    # pre-wave-5 side is empty, so the resolution is exactly TERM-089's block: wave 5's rows go,
    # TERM-089's stay (its PAID_NOW rows merged cleanly).
    "2c3ed3093": {"tests/test_paywall_gate_free_tier.py": ("hunks", [
        "    # TERM-089 (2026-09-28): the Morning Wire page itself mounts WireArchive, the\n"
        "    # replay of PAST issues. Verdict, made out loud: today's wire stays free, past\n"
        "    # issues are paid. The component renders NOTHING and fetches NOTHING unless\n"
        "    # `useIsPaid()` is true (WireArchive.test.jsx asserts no request for a free\n"
        "    # member), so a free member's page never sends the 402 this file proves.\n"
        "    \"/api/wire/archive\":\n"
        "        \"WireArchive on /morning-wire, rendered and fetched only for a paid \"\n"
        "        \"member; a free member sees today's wire exactly as before.\",\n"
        "    \"/api/wire/archive/\":\n"
        "        \"Same component, the by-date read behind its date picker; same gate.\",\n"]),
        # Lane R1d, measured at 8d08da86f: TERM-038 (8393002716, REVIEWED_NOT_LANDINGS) built its
        # dark "saved things" palette rows INSIDE the same functions wave 5's own quick-switcher
        # added (rowAriaLabel, the debounced run() closure, orderPaletteRows's displayRows) --
        # seven hunks, none separable: TERM-038's added lines are single statements inside
        # wave-5-authored function bodies (a branch inside rowAriaLabel, a fetch block inside
        # run(), a spread onto orderedRows), not lines beside them. Dropping wave 5's own lines
        # here means deleting the functions TERM-038's lines live inside -- the same shape as wave
        # 7's api/services/daily_counters.py ("ours" below): a later, still-pending feature became
        # structurally dependent on this wave's scaffolding. Keep the newer work.
        "app/src/components/CommandPalette.jsx": "ours"},
    "8167f7aa0": {
        "app/src/pages/journal-2-0/lib/tiptap.js": ("hunks", "all-ours", {
            "import_after": ("import StarterKit from '@tiptap/starter-kit'",
                             "import { getSchema } from '@tiptap/core'"),
            "append": (
                "let editorSchemaCache = null\n"
                "/**\n"
                " * The app's REAL editor schema, built once from `buildExtensions()`. It is\n"
                " * what notebookSchema.js::declaredNotebookSchema reads to declare which note\n"
                " * types this bundle can read (X-UCT-Notebook-Schema).\n"
                " */\n"
                "export function editorSchema() {\n"
                "  if (!editorSchemaCache) editorSchemaCache = getSchema(buildExtensions())\n"
                "  return editorSchemaCache\n"
                "}\n")}),
    },
}

# Every recorded resolution is PINNED to the conflict it was measured on: sha256 (first 16 hex)
# of the conflict hunks' two sides (a hunk rule) or of the previous step's file (a "delete" or
# "ours" rule), recorded at MEASURED_AT with `--record-pins`. A different conflict on the same
# path STOPS. Re-recorded at f4cec49be (lane R1b, 2026-09-29): the ten pins recorded at
# 38bb9a421 came back byte-identical, so the chain below L2 still composes unchanged from the
# new tip; the four new pins are the four conflicts TERM-078 and TERM-089 introduced.
# Re-recorded at 0812b5ec3 (lane R1c, 2026-09-29, L4 #251 + L5 #252 live): all eleven pins
# above came back byte-identical from the new tip. The one new pin is caf6d1b9e's
# app/src/pages/Support.jsx, the conflict TERM-039 (e90fddc34) introduced.
# Re-recorded at 8d08da86f (lane R1d, 2026-09-29, L6 #253 + L7 #254 live): all fifteen pins
# above came back byte-identical from the new tip. The one new pin is 2c3ed3093's (wave 5)
# app/src/components/CommandPalette.jsx, the conflict TERM-038 (8393002716) introduced.
# Re-recorded at c75bf6ea0 (lane R1g, 2026-10-01, L14 #260 + hotfix #261 live): all seven pins
# above came back byte-identical from the new tip (a680b0d40). The one new pin is 0e7d0561a's
# (L14) tests/test_tools_pin_the_root.py, the modify/delete conflict hotfix #261 introduced.
PINS: dict[str, dict[str, str]] = {
    "0e7d0561a": {
        "tests/test_tools_pin_the_root.py": "a3d3d3476ceba493",
    },
    "271a078b6": {
        "api/main.py": "64a4d181d834d6cc",
        "api/services/client_errors.py": "660c00227b8c0bc3",
    },
    "2c3ed3093": {
        "app/src/components/CommandPalette.jsx": "c81d1bda54eb3ff2",
        "tests/test_paywall_gate_free_tier.py": "3033a4865ff1c3ba",
    },
    "4f708a0d2": {
        "api/routers/notebook_writing_help.py": "ecb06e27a7c24dea",
    },
    "8167f7aa0": {
        "app/src/pages/journal-2-0/lib/tiptap.js": "af62a614d13bcc04",
    },
    "caf6d1b9e": {
        "api/main.py": "e19c020e021008a4",
        "api/routers/auth.py": "5525f10d14838f71",
        "api/services/journal_two/public_note_payload.py": "77da29e1bdb202e7",
        "app/src/pages/Support.jsx": "7e83b493575ccb6f",
        "tests/test_share_publish_authorization.py": "9f65da1bb6ff25e2",
    },
    "d9e887ca0": {
        "app/src/components/CommandPalette.jsx": "01c1a8f549ba6de9",
        "tests/test_alert_destination.py": "c50343b6f961eb35",
    },
    "f883e0996": {
        "api/main.py": "ca48146728a32293",
        "api/routers/notebook_writing_help.py": "f84695dfd9aa2ba4",
        "api/services/daily_counters.py": "258b54f4a653f1c3",
    },
}

NL = bytes([10])
HUNK = re.compile(rb"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)


class ChainStopped(Exception):
    """A conflict with no recorded rule: the chain refuses to guess."""


def _git(*a, env=None, inp=None, ok=(0,)):
    r = subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, env=env, input=inp)
    if r.returncode not in ok:
        raise RuntimeError(f"git {' '.join(a)}: rc {r.returncode}: {r.stderr.decode(errors='replace')}")
    return r


def _out(*a, **k) -> str:
    return _git(*a, **k).stdout.decode("utf-8", errors="replace")


def _blob(tree: str, path: str) -> str | None:
    return _git("rev-parse", "--verify", "-q", f"{tree}:{path}", ok=(0, 1, 128)).stdout.decode().strip() or None


def _fingerprint(merged: str, prev: str, path: str, rule) -> str:
    """What a recorded rule was measured against: the conflict hunks' two sides for a hunk rule,
    the previous step's file for a whole-file rule ("delete" removes it, "ours" keeps it).

    ⛔ A whole-file rule is never fingerprinted by its hunks: on a modify/delete conflict git
    leaves the file with NO conflict markers, so the hunk fingerprint is sha256(b"") -- the same
    for every such conflict, i.e. a pin that can never fail (measured 2026-09-29: the first
    record of wave 7's `api/services/daily_counters.py` "ours" rule came back e3b0c44298fc1c14)."""
    import hashlib
    if rule in ("delete", "ours"):
        data = _git("cat-file", "blob", f"{prev}:{path}", ok=(0, 128)).stdout
    else:
        text = _git("cat-file", "blob", f"{merged}:{path}").stdout
        data = bytes([0]).join(m.group(1) + bytes([1]) + m.group(2) for m in HUNK.finditer(text))
    return hashlib.sha256(data).hexdigest()[:16]


def _resolve_hunks(text: bytes, choices) -> bytes:
    hunks = list(HUNK.finditer(text))
    if choices == "all-ours":
        choices = ["ours"] * len(hunks)
    if len(hunks) != len(choices):
        raise ChainStopped(f"{len(hunks)} conflict hunks, the rule names {len(choices)}")
    res, pos = [], 0
    for m, c in zip(hunks, choices):
        res.append(text[pos:m.start()])
        if isinstance(c, list) and c[:1] == ["ours_drop"]:
            lines = m.group(1).splitlines(keepends=True)
            keep = [ln for ln in lines if not any(s.encode("utf-8") in ln for s in c[1:])]
            if len(lines) - len(keep) != len(c) - 1:
                raise ChainStopped(f"ours_drop removed {len(lines) - len(keep)} lines for {len(c) - 1} substrings")
            res.append(b"".join(keep))
        elif c == "ours":
            res.append(m.group(1))
        elif c == "theirs":
            res.append(m.group(2))
        else:
            res.append(c.encode("utf-8"))
        pos = m.end()
    res.append(text[pos:])
    return b"".join(res)


def apply_step(prev: str, squash: str, tip: str, *, pick: bool = False, pins=None) -> dict:
    """One revert (or, `pick`, one cherry-pick) of `squash` onto `prev` -> a resolved tree."""
    base, theirs = (f"{squash}^", squash) if pick else (squash, f"{squash}^")
    r = _git("merge-tree", "--write-tree", "--name-only", "--messages", f"--merge-base={base}",
             prev, theirs, ok=(0, 1))
    lines = r.stdout.decode("utf-8", errors="replace").splitlines()
    merged, conflicts, i = lines[0], [], 1
    if r.returncode == 1:
        while i < len(lines) and lines[i].strip():
            conflicts.append(lines[i])
            i += 1
    conflicts = sorted(set(conflicts))
    fd, idx = tempfile.mkstemp(prefix="nb-rollback-idx-")
    os.close(fd)
    os.remove(idx)
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    try:
        _git("read-tree", merged, env=env)
        # KEEP_PATHS: the index's entries there are replaced wholesale by prev's.
        want = {}
        for ln in _out("ls-tree", "-r", prev, "--", *KEEP_PATHS).splitlines():
            meta, path = ln.split("\t", 1)
            mode, _kind, sha = meta.split()
            want[path] = (mode, sha)
        have = {}
        for ln in _out("ls-files", "-s", "--", *KEEP_PATHS, env=env).splitlines():
            meta, path = ln.split("\t", 1)
            mode, sha, _stage = meta.split()
            have[path] = (mode, sha)
        info = [f"0 {'0' * 40}\t{p}" for p in have if p not in want]
        info += [f"{m} {s}\t{p}" for p, (m, s) in want.items() if have.get(p) != (m, s)]
        if info:
            _git("update-index", "--index-info", env=env, inp=("\n".join(info) + "\n").encode("utf-8"))

        def put_from(tree, path):
            b = _blob(tree, path)
            if b is None:
                _git("update-index", "--force-remove", "--", path, env=env)
            else:
                mode = _out("ls-tree", tree, "--", path).split()[0]
                _git("update-index", "--add", "--cacheinfo", f"{mode},{b},{path}", env=env)

        def put_bytes(path, data):
            b = _git("hash-object", "-w", "--stdin", inp=data).stdout.decode().strip()
            _git("update-index", "--add", "--cacheinfo", f"100644,{b},{path}", env=env)

        product = [p for p in conflicts if p not in KEEP_AT_TIP
                   and not any(p == k or p.startswith(k + "/") for k in KEEP_PATHS)]
        rules = RULES.get(squash, {})
        missing = [p for p in product if p not in rules]
        if missing:
            raise ChainStopped(f"{'cherry-pick' if pick else 'revert'} {squash}: no recorded rule for "
                               f"the conflict in {', '.join(missing)}")
        for p in product:
            rule = rules[p]
            fp = _fingerprint(merged, prev, p, rule)
            if pins is not None:                       # --record-pins: collect, never enforce
                pins.setdefault(squash, {})[p] = fp
            elif PINS.get(squash, {}).get(p) != fp:
                raise ChainStopped(
                    f"{'cherry-pick' if pick else 'revert'} {squash}: the conflict in {p} is not the one "
                    f"its rule was measured on at {MEASURED_AT} (fingerprint {fp}, recorded "
                    f"{PINS.get(squash, {}).get(p)}). A later commit changed those lines: resolve by "
                    "hand (keep the newer work, take out only this landing's own lines), record the "
                    "rule and its pin, and rehearse the step (wave5-rollback.md, 'If the tool stops').")
            if rule == "delete":
                _git("update-index", "--force-remove", "--", p, env=env)
            elif rule == "ours":
                put_from(prev, p)
            else:
                post = rule[2] if len(rule) > 2 else {}
                data = _resolve_hunks(_git("cat-file", "blob", f"{merged}:{p}").stdout, rule[1])
                if post.get("import_after"):
                    anchor, line = post["import_after"]
                    if line.encode() not in data:
                        j = data.index(NL, data.index(anchor.encode())) + 1
                        data = data[:j] + line.encode() + NL + data[j:]
                if post.get("append"):
                    data = data.rstrip(NL) + NL + NL + post["append"].encode("utf-8")
                if re.search(rb"^(<<<<<<<|>>>>>>>) ", data, re.M):
                    raise ChainStopped(f"conflict markers left in {p}")
                put_bytes(p, data)
        would_change = [p for p in KEEP_AT_TIP if p in conflicts or _blob(merged, p) != _blob(prev, p)]
        for p in KEEP_AT_TIP:
            put_from(tip, p)
        tree = _out("write-tree", env=env).strip()
    finally:
        if os.path.exists(idx):
            os.remove(idx)
    return {"op": "cherry-pick" if pick else "revert", "squash": squash, "conflicts": conflicts,
            "product_conflicts": product, "schema_change_undone": would_change, "tree": tree,
            "schema_identical_to_tip": all(_blob(tree, p) == _blob(tip, p) for p in KEEP_AT_TIP)}


def plan(through: str, revert_hotfixes: bool = False) -> list[tuple[str, str, str, bool]]:
    keys = [k for k, _s, _w in CHAIN]
    if through not in keys:
        raise SystemExit(f"--through must be one of {', '.join(keys)}")
    kept = {k: s for k, s, _w in CHAIN if s in KEPT}
    if through in kept and not revert_hotfixes:
        raise ChainStopped(
            f"--through {through}: {kept[through]} is a kept server hotfix, never reverted with the "
            "features, so a rollback 'through' it would stop where the landing above it stops and "
            "leave it in place. Name the landing above or below it, or pass --revert-hotfixes to "
            "revert the hotfixes too (merge-clean, never booted).")
    steps = []
    for key, squash, what in CHAIN[: keys.index(through) + 1]:
        if squash in KEPT and not revert_hotfixes:
            continue
        steps.append((key, squash, what, False))
    if through == "wave5":
        steps += [(f"guard-{g}", g, f"re-apply guard {g}", True) for g in GUARD_PICKS]
    return steps


def notebook_files() -> frozenset:
    """The Notebook's file set, derived from git: every path any CHAIN landing's own squash
    changed (its diff against its one parent), minus KEEP_PATHS. Cached per process."""
    key = ",".join(s for _k, s, _w in CHAIN)
    if key not in _NOTEBOOK_FILES:
        files = set()
        for _k, squash, _w in CHAIN:
            files.update(_out("diff-tree", "--no-commit-id", "--name-only", "-r", squash).splitlines())
        _NOTEBOOK_FILES[key] = frozenset(
            f for f in files if f and not any(f == k or f.startswith(k + "/") for k in KEEP_PATHS))
    return _NOTEBOOK_FILES[key]


def notebook_landings(rng: str) -> list[dict]:
    """Every one-parent commit in `rng` (newest first) that EITHER census criterion selects:
    [{"sha", "subject", "by_subject", "by_path", "paths"}]. Merges are skipped: a Notebook landing
    is a squash."""
    out = []
    for line in _out("log", "--format=%H %P%x09%s", rng).splitlines():
        head, subject = line.split("\t", 1)
        sha, *parents = head.split()
        if len(parents) != 1:
            continue
        files = _out("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines()
        ships = any(f.startswith(("app/", "api/")) for f in files)
        by_subject = bool(ships and NOTEBOOK_SUBJECT.search(subject))
        nb = notebook_files()
        paths = [f for f in files if f in nb]
        if by_subject or paths:
            out.append({"sha": sha, "subject": subject, "by_subject": by_subject,
                        "by_path": bool(paths), "paths": paths[:5]})
    return out


def check_base(start_sha: str) -> str | None:
    """Why the chain must not run from `start_sha`, or None. The reason says what to re-measure."""
    measured = _out("rev-parse", "--verify", f"{MEASURED_AT}^{{commit}}").strip()
    if _git("merge-base", "--is-ancestor", measured, start_sha, ok=(0, 1)).returncode != 0:
        return (f"{start_sha[:9]} does not contain MEASURED_AT {MEASURED_AT}: the chain and every rule "
                "were measured on a tree this base is not built on. Re-measure the chain from this base "
                "(wave5-rollback.md, 'If the tool stops') before rolling anything back.")
    named = {_out("rev-parse", f"{s}^{{commit}}").strip() for _k, s, _w in CHAIN}
    new = [c for c in notebook_landings(f"{measured}..{start_sha}")
           if c["sha"] not in named and c["sha"] not in REVIEWED_NOT_LANDINGS]
    if new:
        rows = "; ".join(
            f"{c['sha'][:9]} {c['subject'][:70]!r} (selected by "
            + " and ".join(k for k, v in (("subject", c["by_subject"]), ("path", c["by_path"])) if v)
            + (": " + ", ".join(c["paths"]) if c["paths"] else "") + ")" for c in new)
        return (f"{len(new)} commit(s) after MEASURED_AT {MEASURED_AT} look like Notebook landings the "
                f"chain does not name: {rows}. Add each landing to CHAIN newest first (or, if a person "
                "rules it is NOT one, to REVIEWED_NOT_LANDINGS with the reason), re-run from the new "
                "tip, record a rule and a pin for each conflict, rehearse the new step on a sandbox, "
                "and move MEASURED_AT.")
    return None


def run(start: str, through: str, revert_hotfixes: bool = False, emit=print, pins=None) -> dict:
    tip = _out("rev-parse", "--verify", f"{start}^{{commit}}").strip()
    why = check_base(tip)
    if why:
        raise ChainStopped(why)
    measured = _out("rev-parse", "--verify", f"{MEASURED_AT}^{{commit}}").strip()
    if tip != measured:
        n = len(_out("rev-list", f"{measured}..{tip}").split())
        emit(json.dumps({"warning": (
            f"the rules were measured at {MEASURED_AT}; this run is at {tip[:9]}, {n} commit(s) later, "
            "with no uncharted Notebook landing among them and every conflict matching its pin. The "
            "check list (step 2) and the sandbox rehearsal (step 3) are MANDATORY before this ships.")}))
    prev = tip
    for key, squash, what, pick in plan(through, revert_hotfixes):
        res = apply_step(prev, squash, tip, pick=pick, pins=pins)
        res.update(key=key, what=what)
        msg = (f"{'Re-apply' if pick else 'Revert'} {squash} ({what}) -- Notebook rollback through "
               f"{through}, built by tools/notebook_rollback_chain.py")
        res["commit"] = _out("commit-tree", res["tree"], "-p", prev, "-m", msg).strip()
        emit(json.dumps(res))
        prev = res["commit"]
    final = {"result": prev, "tree": _out("rev-parse", f"{prev}^{{tree}}").strip(), "through": through,
             "from": tip, "next": f"git switch -c rollback/notebook-through-{through} {prev}"}
    emit(json.dumps(final))
    return final


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--through", help="the oldest landing to roll back (see --list)")
    ap.add_argument("--from", dest="start", default="origin/master")
    ap.add_argument("--revert-hotfixes", action="store_true",
                    help=f"revert the kept server hotfixes {sorted(KEPT)} as well")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="is the chain current at --from? Prints the verdict; exit 0 current, 2 stale "
                         "(re-measure first: wave5-rollback.md, 'If the tool stops')")
    ap.add_argument("--record-pins", action="store_true",
                    help="run --through from MEASURED_AT with pins NOT enforced and print the pins "
                         "measured there (paste into PINS; the rail rebuilds and checks them)")
    a = ap.parse_args(argv)
    if a.record_pins:
        got: dict = {}
        run(MEASURED_AT, a.through or "wave5", a.revert_hotfixes, emit=lambda _l: None, pins=got)
        print(json.dumps(got, indent=4, sort_keys=True))
        return 0
    if a.check:
        # The same question run() asks before it builds anything (run() still asks it itself).
        tip = _out("rev-parse", "--verify", f"{a.start}^{{commit}}").strip()
        why = check_base(tip)
        print(json.dumps({"check": "stale" if why else "current", "from": tip,
                          "measured_at": MEASURED_AT, **({"stopped": why} if why else {})}))
        return 2 if why else 0
    if a.list:
        for key, squash, what in CHAIN:
            print(f"{key:6} {squash}  {what}{'  [KEPT unless --revert-hotfixes]' if squash in KEPT else ''}")
        print(f"after wave5: re-apply {', '.join(GUARD_PICKS)}; kept paths: {', '.join(KEEP_PATHS)}; "
              f"schema tables: {', '.join(SCHEMA_FILES)}")
        return 0
    if not a.through:
        ap.error("--through is required (or --list)")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        run(a.start, a.through, a.revert_hotfixes)
    except ChainStopped as e:
        print(json.dumps({"stopped": str(e)}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
