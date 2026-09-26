"""The sharded frontend gate, with the checks that make its result mean something.

⛔ WHY THIS EXISTS AS A COMMITTED SCRIPT rather than a shell loop somebody types.

Three separate times this project has recorded a gate result that was not a gate result:

  1. A run launched with an invalid `--minWorkers` died at argument parsing having executed
     nothing, and the background-task wrapper reported **exit 0**. Nothing distinguished
     "17,000 tests passed" from "the runner never started"
     (`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).
  2. A chunked run covered 1,016 of 1,178 files and its total was quoted as the gate. A partial
     suite fails in the FLATTERING direction: fewer files run, fewer failures found.
  3. 2026-09-09: a run's own totals-line assertion was written as `grep '^ *Test Files'` and never
     matched, because vitest prefixes that line with ANSI escapes. It alarmed on six healthy
     shards. **The assertion that exists because exit codes lie was itself unverified.** That is
     the direct reason this file has a test.

And a fourth, found the same day: that run's shards saw 1180 files and then 1181, because a new
test file was created WHILE it ran. A gate whose input changes underneath it is not a gate — so
this script refuses a dirty tree, and records the tree hash at start AND end.

⭐ THE SHAPE THAT MAKES IT TESTABLE: every decision lives in a pure function, and `run_gate` takes
its git and subprocess access as parameters. The test drives all four failure modes without
running a 13-minute suite or dirtying a repo.

Usage:
    python scripts/gate_shards.py                       # 6 shards, manifest to docs/plans/joystick/
    python scripts/gate_shards.py --shards 6 --out DIR
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import fnmatch
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

# ⛔ UNGUARDED ON PURPOSE. A `try: import … except: lock = None` would turn a missing or broken
# lock tool into a SILENTLY UNLOCKED gate — the swallowed-error shape this repo has paid for
# repeatedly. The two files are committed together; if one is absent the tree is broken and
# saying so loudly is the correct behaviour.
sys.path.insert(0, str(REPO / "tools"))
import gate_box_lock  # noqa: E402
# ⛔ SAME RULING, SAME REASON. The lock hands back a load reading and this file renders it; a
# guarded import would turn a missing sampler into a gate that quietly stopped saying whether the
# box was busy. ⚰️ It was MISSING on the first cut of C-4 — `_announce_box_load` referenced the
# module and every path that reaches it is an exception path, so the unit tests were green and the
# NameError only surfaced when a rail drove `main()` end to end.
import gate_box_sampler  # noqa: E402
APP = REPO / "app"

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# ` Test Files  3 failed | 194 passed (197)`  /  `      Tests  4 failed | 2498 passed (2502)`
_FILES_RE = re.compile(r"^\s*Test Files\s+(?P<body>.+?)\s*$")
_TESTS_RE = re.compile(r"^\s*Tests\s+(?P<body>.+?)\s*$")
_TOTAL_RE = re.compile(r"\((\d+)\)\s*$")
_COUNT_RE = re.compile(r"(\d+)\s+(failed|passed|skipped|todo)")


def strip_ansi(text: str) -> str:
    """⛔ ALWAYS BEFORE MATCHING. Proof (a) in the test feeds this real captured bytes."""
    return ANSI_RE.sub("", text)


def _parse_counts(body: str) -> dict:
    out = {"failed": 0, "passed": 0, "skipped": 0, "todo": 0}
    for n, what in _COUNT_RE.findall(body):
        out[what] = int(n)
    m = _TOTAL_RE.search(body)
    out["total"] = int(m.group(1)) if m else 0
    return out


def parse_totals(log_text: str) -> dict | None:
    """The two totals lines, or None if this log has no run in it.

    ⛔ None is the ALARM, and both lines are required. A log with `Test Files` but no `Tests` is a
    run that died between them, which is exactly the shape that must never read as a pass.
    """
    clean = strip_ansi(log_text)
    files = tests = None
    for line in clean.split("\n"):
        m = _FILES_RE.match(line)
        if m:
            files = _parse_counts(m.group("body"))
            continue
        m = _TESTS_RE.match(line)
        if m and "Test Files" not in line:
            tests = _parse_counts(m.group("body"))
    if files is None or tests is None:
        return None
    return {"files": files, "tests": tests}


#: ⛔ AN IDENTITY STARTS WITH A TEST FILE, OR IT IS NOT AN IDENTITY. vitest names every failure by
#: the file first — `FAIL  src/x.test.jsx > describe > test`, or `FAIL  src/x.test.jsx [ src/x.test.jsx ]`
#: for a file that errored before its tests ran. A bare `FAIL\s+\S+` also took every stdout line a
#: test PRINTS that happens to begin with the word: `dailyFirstPaint.probe.test.jsx` and
#: `dailyFirstPaintAcceptance.test.jsx` log report tables whose rows read
#: `FAIL    | NC-A missing today | … | lastT 2026-09-22->2026-09-23 | to 324.579->325.579 | …`,
#: which carry dates and timings, differ run to run, and so read as NEW on every gate (four
#: phantom branch-introduced rows on 2026-09-23). A row of a report is not a failing test.
#:
#: ⛔ AND "A TEST FILE" MEANS WHAT VITEST MEANS BY ONE. The first version hand-typed six
#: extensions (js jsx ts tsx mjs cjs); vitest's default include also admits .mts .cts .mjsx .cjsx
#: .mtsx .ctsx, and a failing `x.test.mts` would have been dropped from `failures` and never
#: reached `new` -- the flattering direction. So the suffix is DERIVED from the glob vitest
#: itself uses: `app/vite.config.js` sets no `test.include`, so its `defaultInclude` decides, and
#: `tests/test_gate_shards.py` pins this constant to the installed vitest's own literal.
VITEST_DEFAULT_INCLUDE = "**/*.{test,spec}.?(c|m)[jt]s?(x)"


def glob_file_suffix_regex(glob: str) -> str:
    """The file-name suffix of a vitest include glob -- everything after its last `*` -- as a
    regex fragment. Knows exactly the constructs vitest's default uses (`{a,b}`, `?(a|b)`,
    `[..]`, literals) and REFUSES anything else, so a changed glob fails loudly here instead of
    quietly producing a pattern that means something different."""
    tail = glob.rsplit("*", 1)[-1]
    out, i = [], 0
    while i < len(tail):
        ch = tail[i]
        if ch == "{":
            j = tail.index("}", i)
            out.append("(?:" + "|".join(re.escape(a) for a in tail[i + 1:j].split(",")) + ")")
            i = j + 1
        elif ch == "?" and tail[i + 1:i + 2] == "(":
            j = tail.index(")", i)
            out.append("(?:" + "|".join(re.escape(a) for a in tail[i + 2:j].split("|")) + ")?")
            i = j + 1
        elif ch == "[":
            j = tail.index("]", i)
            body = tail[i + 1:j]
            if not body.isalnum():
                raise ValueError(f"unsupported character class [{body}] in {glob!r}")
            out.append(f"[{body}]")
            i = j + 1
        elif ch.isalnum() or ch in "._-":
            out.append(re.escape(ch))
            i += 1
        else:
            raise ValueError(f"unsupported glob construct {tail[i:]!r} in {glob!r}")
    return "".join(out)


_FAIL_RE = re.compile(
    r"^\s*FAIL\s+(?P<id>\S*" + glob_file_suffix_regex(VITEST_DEFAULT_INCLUDE) + r"(?=\s|$).*?)\s*$")

BASELINE = REPO / "docs" / "plans" / "joystick" / "gate-baseline.json"


def parse_failures(log_text: str) -> list[str]:
    """Every failing test's full identity — `file > describe > test`.

    ⛔ NAMES, NOT A COUNT. "9 failed" is satisfied by NINE DIFFERENT failures just as happily as by
    the nine known ones, so a count-based gate passes a branch that fixed nine and broke nine. The
    merge ruling rests on this comparison, so it compares identities.
    """
    out = []
    for line in strip_ansi(log_text).split("\n"):
        m = _FAIL_RE.match(line)
        if m:
            ident = m.group("id").strip()
            if ident and ident not in out:
                out.append(ident)
    return sorted(out)


def load_baseline() -> dict:
    """The known-failing set this branch is measured against, or an empty baseline if absent."""
    if not BASELINE.exists():
        return {"measured_at": None, "sha": None, "failures": []}
    return json.loads(BASELINE.read_text(encoding="utf-8"))


def compare_failures(observed: list[str], baseline: list[str],
                     expected_red: list[str] | None = None) -> dict:
    """What this run changed about the failing set. `new` is the only one that can block a merge.

    ⛔⛔ TWO KINDS OF KNOWN RED, AND COLLAPSING THEM LOSES THE DISTINCTION THAT
    MATTERS. `failures` is a measurement OF MASTER — this file's own invariant is
    "Nothing here is the hub's". `expected_red` is the opposite: a DELIBERATE
    reproduction this branch added, red BECAUSE the defect is real, carrying the
    fix it waits on. A reproduction filed under `failures` would corrupt the
    baseline's meaning; one filed nowhere hands every other workstream a phantom
    regression to chase.

    ⭐ STRICT IN BOTH DIRECTIONS: an `expected_red` that is NOT observed has been
    FIXED, and its entry is stale — that fails, because a stale entry is a slot a
    real failure can occupy unnoticed. Same discipline the baseline already
    applies to a `failures` row that starts passing.
    """
    obs, base = set(observed), set(baseline)
    exp = set(expected_red or [])
    return {
        "observed_count": len(obs),
        "baseline_count": len(base),
        "new": sorted(obs - base - exp),          # ⛔ regressions — the gate's actual verdict
        "expected_red_seen": sorted(obs & exp),   # red on purpose, named, not blocking
        "expected_red_stale": sorted(exp - obs),  # ⛔ GREEN now — the entry must go
        "no_longer_failing": sorted(base - obs),  # informational: fixed, or silently stopped running
        "matches_baseline": obs == base,
    }


def unexplained(baseline: dict) -> list[str]:
    """`expected_red` entries with no reason beside them — the gate's own class of answer.

    ⛔ ONE IMPLEMENTATION, AND IT LIVES HERE RATHER THAN IN THE TEST. It was written in
    `tests/test_gate_shards.py` on 2026-09-14 and used by the rail, the rail's control and
    nothing else — so the *product* never applied the predicate its own test enforced. A run
    against a baseline carrying an unexplained entry exited 0 with "no NEW failures", because
    `compare_failures` subtracts `expected_red` from `new` WITHOUT ASKING WHETHER ANYBODY CAN
    VOUCH FOR THE ENTRY. Promoted, so the check the suite makes at commit time is the same
    check the gate makes at run time (`lesson_a_guard_repeated_is_a_guard_unproved`: the test
    now imports this, it does not restate it).

    ⛔⛔ AND IT IS ITS OWN CLASS, NOT A FAILURE AND NOT A PASS. An unexplained entry is neither
    a regression (`new`) nor a fixed defect (`expected_red_stale`): it is a waiver nobody
    signed. Folding it into the pass/fail count would reproduce exactly the defect this repo
    keeps paying for — an UNREADABLE layer scored as an EMPTY one. `EXIT_UNEXPLAINED_RED`
    below carries it out to the caller intact.

    ⭐ A MISSING KEY AND AN EMPTY LIST ANSWER THE SAME WAY, deliberately: a baseline that
    declares no `expected_red` has nothing to explain, which is the honest empty answer and
    the reason every rail over this needs a planted control beside it.
    """
    reasons = baseline.get("expected_red_reasons") or {}
    return [e for e in (baseline.get("expected_red") or []) if e not in reasons]


def sum_totals(per_shard: list[dict]) -> dict:
    """The summed line a future reader reconciles against, without re-running anything."""
    acc = {"files": {}, "tests": {}}
    for group in ("files", "tests"):
        for k in ("failed", "passed", "skipped", "todo", "total"):
            acc[group][k] = sum(s[group].get(k, 0) for s in per_shard)
    return acc


def blob_hash(path: pathlib.Path) -> str:
    """This script's own git blob hash — the manifest names the version that produced it."""
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def _git(args: list[str]) -> str:
    # ⛔ encoding= IS NOT OPTIONAL. `text=True` alone decodes with the platform default, which is
    # cp1252 on this machine — so a non-ASCII commit message or branch name would take the wrapper
    # down with a UnicodeDecodeError and no obvious cause. Same omission as `_run_shard` below.
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=True).stdout.strip()


# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═
# ⛔⛔ THE RE-DERIVATION RULE, codified 2026-09-14.
#
#   A completed gate's verdict carries to a NEW tree WITHOUT re-running when the
#   tree hash of every path the gate READS is identical between the gated tree and
#   the new tree. Re-derive `vs_baseline` only. Always with a planted-failure
#   control.
#
# ⭐ WHY IT IS ALLOWED AT ALL: the suite is a pure function of these paths. If
# none of them moved, the observed failing set cannot have moved either, and only
# the BASELINE can have changed - and `compare_failures` is a pure function of
# (observed, baseline, expected_red).
#
# ⛔ WHY IT NEEDS A MEASURED PRECONDITION: on 2026-09-14 this was justified twice
# by hashing `app/src` ALONE. That is the big one but it is not the whole read set,
# and "I checked the obvious path" is how a flattering answer gets published. The
# precondition is now a list, and the helper below is the only thing allowed to
# answer it.
# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═# ═

#: Every path the gate reads. `app/src` covers the tests, the sources under test
#: and `src/test-setup.js` (vite.config.js's `setupFiles`), because a tree hash
#: covers everything beneath it.
#:
#: ⛔⛔ AND `app/src` IS NOT THE WHOLE READ SET — VERIFIED 2026-09-15, NOT ASSERTED.
#: The runner is `npx vitest run` from `app/`, so `process.cwd()` is `app/` and a
#: rail's `path.resolve(process.cwd(), '../…')` lands at the REPO ROOT. Read off
#: the sources rather than assumed, the suite reaches four families of file that
#: no `app/src` tree hash can see:
#:
#:   · the script CORPORA under `tests/fixtures/**` — `libraryIntake`, `dialect`,
#:     `doorScorecard`, `productScorecard`, `criteria`, `goldenFixtures` and a
#:     dozen more read every committed .pine/.ts/.json from there. Change one
#:     fixture and the observed failing set can move with `app/src` untouched.
#:   · GENERATED artifacts the rails byte-compare, and the GENERATORS they exec:
#:     `tools/hub_surface_matrix.mjs` + the two joystick docs it writes,
#:     `docs/formulas/GRAMMAR.md`, `tools/chart_parity_cases.json`.
#:   · DECISION RECORDS read back as data by the ledger rails (`lint.test.js`,
#:     `enumerationSites.test.js`, `engineEnabledMigration.test.js`,
#:     `flipCRecord.test.js`, `indicatorCatalog.test.js`).
#:   · PYTHON sources on the other side of the lane, read for cross-lane parity
#:     (`enumerationSites`, `IndicatorAlertPopover`, `deferredRowClosures`,
#:     `useGroupMeta.chunk`, `exposureGate`) — and one that is EXECUTED, by
#:     `exportRoundtrip.test.js`.
#:
#: ⭐ THE GRANULARITY IS A DECISION, PER ENTRY, AND IT GOES BOTH WAYS.
#:   · A DIRECTORY where the rails ENUMERATE the tree — `tests/fixtures` is read
#:     with `readdirSync` and several rails assert a floor on the file count, so
#:     an added file changes the run. It also covers a corpus dir that does not
#:     exist yet (`tests/fixtures/pine-inbox`, `…/thinkscript-inbox` are named by
#:     `dialect.test.js` and are absent today) — and an absent path cannot be
#:     listed here, because `git rev-parse` fails on both sides and this helper
#:     correctly calls that DIFFERING, which would refuse every carry-over forever.
#:   · A FILE everywhere else. `docs/` and `api/` move on nearly every commit in
#:     this repo; naming them whole would answer DIFFERS forever, and a check that
#:     always refuses is one nobody runs.
#: The drift that per-file precision costs is paid for by the derivation rail
#: `test_the_read_set_covers_every_root_relative_path_the_suite_reads`, which
#: re-derives this list from the test sources and fails BY NAME on the next one.
#:
#: ⚠️ RESIDUAL, stated rather than hidden: `rule12Paths.test.js`,
#: `reachable.test.js`, `sourcesAreText.test.js` and `enumerationSites.test.js`
#: shell out to `git` (`ls-files`, `status`, `diff`, `show <sha>:…`). That reads
#: repository STATE, not a fixed path, so no tree hash can cover it. Those rails
#: are scoped to `app/src` or to history that is immutable by SHA, which is why
#: this is recorded as a known edge and not as a path.
GATE_READ_PATHS = (
    # the suite, its config, its dependency pins, and the build entry points two
    # rails import and run (`build-cot-facts.mjs`, `build-flow-facts.mjs`).
    "app/src",
    "app/scripts",
    "app/vite.config.js",
    "app/package.json",
    "app/package-lock.json",
    # corpora + repo-root files the rails read with cwd = app/
    "tests/fixtures",
    "tests/fixtures_pm_citation_text.json",
    "tests/test_ast_conformance.py",
    "tests/test_the_member_loop_end_to_end.py",
    # ⛔ READ BY app/src/pages/journal-2-0/lib/askCitation.schemaParity.test.js, which regex-
    # reads the Python tables (_LEAF_TYPES, _INLINE_LEAF_TYPES, _TEXTBLOCK_TYPES, _ATOM_TEXT)
    # and pins them to the editor's real schema -- a change to this file CAN change a suite
    # result, so a carry-over verdict must not cross it.
    "api/services/journal_two/note_citation_text.py",
    # generators the rails execute, and the artifacts they byte-compare
    "tools/hub_surface_matrix.mjs",
    "tools/chart_parity_cases.json",
    # ⛔ THE PINE PARITY CORPUS IS READ, NOT JUST NAMED.
    # `pineBoxCreateDrop.test.js` does a real fs.readFileSync on
    # `mid_engagement__01-zeiierman-trend-pressure.pine`, so a change to a
    # fixture here CAN change a suite result and a carry-over verdict must
    # not cross it. ⚠️ Two of that fixture's three mentions are PROSE (a
    # comment about why it left the parity set) -- classifying it from those
    # alone would have put it in NAMED_BUT_NOT_READ and kept the hole open.
    # ⭐ The DIRECTORY, so a fixture added later is covered the day it lands.
    "tools/c0_parity_fixtures",
    # ⛔⛔ THE OOS CORPUS AND THE VENDOR PROBES ARE READ THE SAME WAY, and the
    # rail below (`test_the_read_set_covers_every_root_relative_path_the_suite_reads`)
    # had been RED naming exactly these. Its own message states the cost:
    # "a re-derivation would carry a verdict across a change to them".
    #
    # ⚰️ IT WAS RED ON BOTH PARENTS OF THE 2026-09-23 MERGE, so this is not a
    # regression being papered over — `visual_conformance/probes` already had a
    # reader on master. What the merge changed is the SIZE of the hole: this
    # branch brings six readers of the probes and the only reader of
    # `target-scripts.json`, and its own carry-over decisions leaned on C0,
    # which is precisely the check this hole weakens.
    #
    # ⭐ DIRECTORIES WHERE A SIBLING CAN BE ADDED LATER, files where one cannot —
    # the same reasoning the parity corpus above is declared under.
    "tools/visual_conformance/probes",
    "docs/pine/target-scripts.json",
    "docs/formulas/GRAMMAR.md",
    "docs/plans/joystick/surface-matrix.md",
    "docs/plans/joystick/glass-acceptance-steps.md",
    # decision records and the spec section read back as data
    "docs/decisions/2026-08-03-engine-enabled-settings-migration.md",
    "docs/decisions/2026-08-04-engine-enabled-deleted.md",
    "docs/decisions/2026-08-04-flip-c-pane-geometry.md",
    "docs/decisions/2026-08-06-machine-repaint-linter.md",
    "docs/superpowers/specs/2026-07-31-indicator-platform-design.md",
    # python sources the cross-lane rails read — and one they EXECUTE
    "api/routers/auth.py",
    "api/routers/breadth_monitor.py",
    "api/routers/definition_record.py",
    "api/routers/indicator_alerts.py",
    "api/services/alert_series.py",
    "api/services/ast_interpret.py",
    "api/services/implied_move.py",
    "api/services/indicator_alert_evaluator.py",
    "api/services/indicator_alert_service.py",
    "api/services/indicator_compute.py",
    "api/services/setup_grade.py",
    "api/services/voice_client_action_tools.py",
    "api/services/journal_two/roundtrip_export_fixture.py",
    "api/services/ticker_meta.py",
    # ⛔ THE NOTEBOOK BRIDGE + PARITY RAILS READ (AND EXECUTE) THESE. `calloutNode.variant`,
    # `selectionExport.roundtrip` and `importer/exportRoundtrip` shell out to the export
    # bridges, which import `notes.py`; `dateMentionNode` and the tag-key parity rails read
    # the JSON corpora. A change to any of them CAN change a suite result, so a carry-over
    # verdict must not cross it. Named by the derivation rail on PR #186's CI run
    # (2026-09-25), which is the only way this list is ever extended.
    "api/services/journal_two/notes.py",
    "tests/fixtures_plain_text.json",
    "tests/fixtures_tag_keys.json",
    # the Pine translator's own corpus + parity/lookback rails read these —
    # directories are whole-tree entries (same idiom as app/src above), the
    # rest are individual files `tests/test_the_read_set_covers_...` named
    "corpus/committed",
    "tools/c0_oos_fixtures",
    "tools/corpus_metric.json",
    "tools/lookback_agreement.json",
    "tests/test_ast_bind_parity.py",
    "docs/pine/lwc5-capability-map.md",
    "docs/pine/param-ids.json",
    "docs/pine/pine-presentation-spec.md",
    "docs/pine/pine-version-evolution.md",
    "docs/superpowers/specs/universal-indicator-ecosystem/OOS_2_PARITY_SET.json",
)


def gate_read_identical(sha_a: str, sha_b: str, paths=GATE_READ_PATHS, run=None):
    """(identical, differing) for the gate's read set between two commits.

    ⚰️⚰️ THIS IS NO LONGER THE SOLE CARRY-OVER TEST — owner ruling 2026-09-15. It is now
    **C0**, a SHORT-CIRCUIT: IDENTICAL still means the gate carries with no further check,
    but DIFFERING no longer means re-gate. `app/src` is in the read set as a WHOLE
    DIRECTORY, so this answered DIFFERS for any frontend commit anywhere on master — and
    with a ~25 min gate against workstreams landing in `app/src` every ~10, carry-over
    could never hold. Two sound gates died to it in one evening.

    ⛔ The full rule is `tools/gate_carry_over.py` (C0 here, then C1 file-overlap, C2 AST
    import interaction to depth 2, C3 infra, C4 scoped run, C5 the master deploy gate on
    the landed SHA). **Do not re-derive "DIFFERS means re-gate" from this function's
    existence** — that is the struck rule, and this repo has had a rescinded restriction
    reinstated from its surviving mechanism three times.

    ⛔ A path that is MISSING on one side and present on the other counts as
    DIFFERING, not as equal-because-both-unreadable. Two absent paths hashing to
    the same "" is the vacuous answer this check exists to refuse.
    """
    runner = run or (lambda argv: subprocess.run(
        argv, cwd=REPO, capture_output=True, text=True,
        encoding="utf-8", errors="replace"))
    differing = []
    for rel in paths:
        a = runner(["git", "rev-parse", f"{sha_a}:{rel}"])
        b = runner(["git", "rev-parse", f"{sha_b}:{rel}"])
        ha = a.stdout.strip() if a.returncode == 0 else None
        hb = b.stdout.strip() if b.returncode == 0 else None
        if ha is None or hb is None or ha != hb:
            differing.append(rel)
    return (not differing), differing


def tree_state() -> tuple[str, list[str]]:
    """(HEAD, dirty paths). Both halves matter: a clean tree at the wrong commit is still wrong."""
    head = _git(["rev-parse", "HEAD"])
    dirty = [ln for ln in _git(["status", "--porcelain=v1"]).split("\n") if ln.strip()]
    return head, dirty


def count_test_files() -> int:
    """The denominator. A chunked run must be diffed against it before its total is quoted."""
    return sum(1 for p in (APP / "src").rglob("*") if p.suffix in (".js", ".jsx")
               and (".test." in p.name or ".spec." in p.name))


def count_waived_files(exclude: tuple[str, ...], root=None) -> int:
    """How many ON-DISK test files the exclusion globs remove from the run.

    ⛔⛔ WITHOUT THIS THE RECONCILE LINE LIES BY ONE PER WAIVER. A waived run
    legitimately executes fewer files than exist, so the blunt equality printed
    "⛔ DOES NOT RECONCILE" on a healthy gate and left the reader to re-derive
    `1283 on disk - 1 waived = 1282 run` by hand. A reconcile check that cries
    wolf on its own waiver is one a reader learns to skip — and the whole reason
    it exists is that a partial suite fails in the FLATTERING direction.

    ⛔ Matched against the SAME filename shape vitest is given, and counted from
    disk rather than trusted from the caller, so a glob that matches nothing
    subtracts nothing instead of silently excusing a real shortfall.
    """
    base = pathlib.Path(root) if root is not None else (APP / "src")
    if not exclude:
        return 0
    hit = set()
    for p in base.rglob("*"):
        if p.suffix not in (".js", ".jsx") or not (".test." in p.name or ".spec." in p.name):
            continue
        rel = p.relative_to(base).as_posix()
        for pat in exclude:
            tail = pat.rsplit("/", 1)[-1]
            if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(p.name, tail):
                hit.add(rel)
                break
    return len(hit)


class Captured(str):
    """What a subprocess said, AND the code it exited with. A `str` subclass, deliberately.

    ⚰⚰ THE CODE USED TO BE THROWN AWAY HERE, AND THAT IS THE BUG THIS CLASS EXISTS FOR.
    `_capture` returned `proc.stdout + proc.stderr` and never read `proc.returncode` — so at
    the one place this tool reads a subprocess, a process that exited 2 and a process that
    exited 0 returned values of the same type carrying the same information. No caller could
    tell them apart, so none reported it, and an unreported failure reads downstream as success.

    ⚰ Measured 2026-09-14, and it nearly corrupted a measurement: a box-clearance waiter
    printed `TIMEOUT - box never cleared within 25 min` and exited **2**; what reached the
    operator was **exit 0**. Read as "clear", that would have sent a settling run into a live
    six-shard gate and produced exactly the load-contaminated answer the procedure exists to
    exclude. Third sighting of the family — the other two are in CLAUDE.md under
    *"A test run without a totals line is not a run"*.

    ⭐ WHY A `str` SUBCLASS AND NOT A TUPLE. This seam is SHARED: `scripts/gate_shards.py` is
    on master and other workstreams run it, so the fix must not change what an existing caller
    receives. Every consumer today treats the result as text (`.strip()`, `in`, `write_text`,
    `parse_totals`) and all of it keeps working byte-for-byte; `.returncode` is simply there
    for anyone who now asks. A tuple return would have had to touch every call site and both
    existing capture rails to fix a bug in neither.

    ⚠ The attribute does not survive string operations — `captured.strip()` is a plain `str`.
    Read `.returncode` off the `_capture` result itself, and use `getattr(x, "returncode", None)`
    wherever a plain `str` may arrive (an injected test seam, for instance). **`None` means NOT
    OBSERVED, which is a different fact from `0`** and is rendered as such by `_code_text`.
    """

    def __new__(cls, text: str, returncode: int | None):
        self = super().__new__(cls, text)
        self.returncode = returncode
        return self


def _code_text(code: int | None) -> str:
    """Render an exit code for a human, keeping "not observed" distinguishable from 0.

    ⛔ `f"exited {code}"` on a `None` prints "exited None", which reads as a tool bug rather
    than as the honest statement that nobody looked. `lesson_a_swallowed_error_becomes_a_
    confident_finding`, in miniature.
    """
    return "with an UNOBSERVED code" if code is None else f"with code {code}"


def _capture(cmd: list[str], cwd, *, shell: bool | None = None, timeout=None) -> Captured:
    """⛔ THE ONE PLACE A SUBPROCESS IS READ, so `encoding=` cannot be omitted in two places.

    It was omitted in one, and that is the entire reason this function exists as a seam: a rail can
    execute THIS for real, which is what rule 10 asks for. Duplicating the `subprocess.run(...)`
    call shape at another site is how the omission comes back.

    ⛔ AND IT IS THE ONE PLACE AN EXIT CODE CAN BE READ, so it must not be discarded here
    either — see `Captured`. A second `subprocess.run(...)` elsewhere loses it again.
    """
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        shell=(sys.platform == "win32") if shell is None else shell,
        timeout=timeout,
    )
    return Captured((proc.stdout or "") + (proc.stderr or ""), proc.returncode)


# ⛔⛔ AN EXCLUSION IS A CLAIM, AND IT MUST BE VISIBLE IN THE ARTEFACT.
# A gate that quietly drops a test is not a gate. Whatever is excluded is named in
# the manifest, WITH ITS REASON, beside the totals it changed — so a reader who
# only ever sees the manifest cannot mistake a waived suite for a whole one.
EXCLUDE_REASONS: dict[str, str] = {}


def _run_shard(index: int, shards: int, out_dir: pathlib.Path, max_workers: int = 2,
               exclude: tuple[str, ...] = ()) -> str:
    log = out_dir / f"shard-{index}.log"
    # ⛔⛔ `encoding="utf-8"` IS THE WHOLE POINT OF THIS LINE. Shipped without it, `text=True`
    # decoded vitest's UTF-8 output as cp1252, the reader thread died on the first check mark
    # (0x90), and SIX SHARDS RAN FOR SIXTEEN MINUTES AND RETURNED EMPTY STDOUT. The wrapper then
    # correctly reported "no totals line" — a true statement about a false cause.
    # `errors="replace"` means a stray undecodable byte degrades one character instead of
    # destroying an entire run.
    cmd = ["npx", "vitest", "run", f"--shard={index}/{shards}", f"--maxWorkers={max_workers}"]
    for pat in exclude:
        cmd += ["--exclude", pat]
    text = _capture(cmd, APP)
    log.write_text(text, encoding="utf-8")
    return text


def say(text: str, *, err: bool = False) -> None:
    """⛔ CONSOLE OUTPUT IS AN I/O BOUNDARY TOO, AND THIS IS THE THIRD BODY OF ONE DISEASE.

    First the subprocess READ decoded as cp1252 and destroyed a sixteen-minute run. Then `_git` had
    the same exposure. Now the WRITE: `print(render(manifest))` raised UnicodeEncodeError on the Σ
    in the summary row, and the wrapper died **after a completely successful gate** — manifest
    written, tree verified, zero new failures, exit 1.

    Failing at the last line of a passing run is the least harmful version of this bug and the most
    embarrassing. Every console write goes through here so there is ONE place, and `errors=replace`
    means an unencodable character degrades to `?` instead of taking the process down.
    """
    stream = sys.stderr if err else sys.stdout
    data = (text + "\n").encode("utf-8", "replace")
    buf = getattr(stream, "buffer", None)
    if buf is not None:
        buf.write(data)
        buf.flush()
    else:                                   # a stream with no binary buffer (captured in tests)
        stream.write(data.decode("utf-8", "replace"))
        stream.flush()


class _Parser(argparse.ArgumentParser):
    """⛔ ARGPARSE IS THE SECOND CONSOLE WRITER, AND IT WAS MISSED WHEN THE FIRST WAS FIXED.

    `say()` above exists because `print(render(manifest))` raised `UnicodeEncodeError` on the Σ in
    the summary row and killed the wrapper **after a completely successful gate**. The fix routed
    every console write through one place — except argparse, which writes `--help` and usage
    errors STRAIGHT to the stream and never goes near `say()`.

    So `--help` kept dying, on `\\u26d4` (⛔) in this module's own docstring, on any console whose
    encoding is cp1252 — which is every default Windows console on this box. A new reader's first
    command returned a traceback instead of the help text, and the flag that exists to stop this
    script OOM-killing a neighbour (`--max-workers`) was in the output nobody could read.

    ⭐ Fixed by routing argparse through the SAME channel rather than by reconfiguring stdout
    beside it: a second encoding fix would be a second authority over one value, and the next
    writer added to this file would miss it the same way this one was missed.
    """

    def _print_message(self, message, file=None):       # noqa: D102 - argparse's own hook
        if message:
            say(message.rstrip("\n"), err=(file is sys.stderr))


class GateError(RuntimeError):
    """Raised for every condition that invalidates a run. The message NAMES the cause."""



def do_not_build_sweep(run=None) -> dict:
    """C-4 — has any DO-NOT-BUILD item quietly gained code? Owner ruling 2026-09-13:
    run it in every gate.

    ⛔ IT REPORTS, IT DOES NOT DECIDE. A hit is a QUESTION -- several of the §8
    names sit next to code that is supposed to exist -- so the gate prints the
    matches and the verdict stays with the failing-set comparison. Making a
    regex the arbiter of a merge is how a probe gets narrowed until it is quiet.

    ⛔ AND ITS ABSENCE IS REPORTED TOO. A sweep that could not run must not read
    as a sweep that found nothing: `lesson_a_swallowed_error_becomes_a_confident_finding`.
    """
    tool = REPO / "tools" / "q1_do_not_build_sweep.py"
    if not tool.exists():
        return {"ran": False, "why": "tools/q1_do_not_build_sweep.py is not in this tree"}
    run = run or (lambda argv: subprocess.run(
        argv, cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace"))
    try:
        proc = run([sys.executable, str(tool)])
    except OSError as e:
        return {"ran": False, "why": f"the sweep could not be launched: {e}"}
    out = (proc.stdout or "") + (proc.stderr or "")
    # A hit line is `<item>: <path>:<line>  `<fragment>``. Matching that SHAPE
    # beats matching item names -- the roster is derived, so a list of names here
    # would be the typed second authority the sweep itself refuses to have.
    hits = [ln.strip() for ln in out.splitlines()
            if re.match(r"\s+\S.*: \S+:\d+\s", ln)]
    return {"ran": True, "clean": proc.returncode == 0,
            "hits": hits[:20], "output": out.strip()[-2000:]}


def run_gate(shards: int, out_dir: pathlib.Path, *, tree_state_fn=None,
             run_shard_fn=None, file_count_fn=None, max_workers: int = 2,
             exclude: tuple[str, ...] = (), exclude_reasons: tuple[str, ...] = ()) -> dict:
    """Run the gate, or refuse. Returns the manifest dict.

    Every failure mode raises `GateError` naming itself, so a caller can never mistake one for
    another — and so the test can assert WHICH one fired.
    """
    # ⛔⛔ LATE-BOUND, LIKE `run_shard_fn` BESIDE THEM — and the inconsistency was a real bug.
    # ⚰️ These two were `tree_state_fn=tree_state` and `file_count_fn=count_test_files`:
    # DEFAULT ARGUMENTS, evaluated once when this module is imported, capturing the ORIGINAL
    # functions forever. So `monkeypatch.setattr(gate_shards, "tree_state", ...)` — which is
    # what every caller reasonably expects to work, and what
    # `test_the_wrapper_takes_and_RELEASES_the_lock_around_a_run` actually does — reached
    # NOTHING. That test drives a "dirty tree" refusal; with the patch inert it called the
    # REAL tree_state, found the tree CLEAN, skipped the refusal and ran a REAL SIX-SHARD
    # GATE inside a unit test.
    #
    # ⭐ WHICH IS WHY IT LOOKED INTERMITTENT: it PASSED whenever the working tree happened to
    # be dirty (the real tree_state answered "dirty", the refusal fired, rc=2 in a second) and
    # HUNG whenever the tree was clean. Every hang was right after a commit; every pass was
    # mid-edit. Four hypotheses were spent on that pattern before the binding was read.
    tree_state_fn = tree_state_fn or tree_state
    file_count_fn = file_count_fn or count_test_files
    run_shard_fn = run_shard_fn or (lambda i: _run_shard(i, shards, out_dir, max_workers, tuple(exclude)))

    # ⛔ THE WRAPPER'S OWN OUTPUT IS NOT TREE DRIFT, AND THIS COST A SECOND RUN.
    #
    # `out_dir` lives inside the repo, so the shard logs this script writes show up in
    # `git status` as untracked — and the drift check then fired on the tool's own artifacts:
    # "started clean, ended with 1 uncommitted file(s)", where the file was `gate-runs/` itself.
    # The check was right and its SCOPE was wrong. Drift means the SOURCE changed underneath the
    # run; a log the wrapper wrote on purpose is not that.
    #
    # ⚠️ Deliberately narrow: only paths under `out_dir` are exempt. Anything else that appears
    # mid-run still voids the run, which is the whole point of the check.
    try:
        out_rel = out_dir.resolve().relative_to(REPO).as_posix()
    except (ValueError, OSError):
        out_rel = None

    def _real_dirt(entries: list[str]) -> list[str]:
        if not out_rel:
            return entries
        keep = []
        for e in entries:
            path = e[3:].strip().strip('"') if len(e) > 3 else e
            if not path.startswith(out_rel):
                keep.append(e)
        return keep

    # ⛔ (d) DIRTY START — refuse BEFORE running anything. A gate runs on committed code only;
    # otherwise the artifact it reports on cannot be recovered by anyone reading the manifest.
    start_head, start_dirty = tree_state_fn()
    start_dirty = _real_dirt(start_dirty)
    if start_dirty:
        raise GateError(
            "DIRTY TREE: refusing to start. A gate runs on committed code only, so its result can "
            f"be tied to a hash. Uncommitted: {', '.join(start_dirty[:10])}"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    per_shard, missing, failures = [], [], []
    identity_mismatches: list[dict] = []
    # ⛔ RECORDED, NEVER THE ARBITER. The exit code below is DIAGNOSIS: it says WHY a shard
    # produced nothing, which "no totals line" on its own cannot. The verdict stays the
    # failing-set comparison — vitest exits 1 on an ordinary test failure, so a non-zero shard
    # is not a defect, and promoting this to a gate condition would fail every red run twice.
    exit_codes: dict[int, int | None] = {}
    for i in range(1, shards + 1):
        # ⛔ THE RAW VALUE FIRST. `run_shard_fn(i) or ""` collapses an empty result to a plain
        # `str` and loses the code — precisely in the EMPTY CAPTURE case below, where the code
        # is the only evidence of what happened.
        captured = run_shard_fn(i)
        exit_codes[i] = getattr(captured, "returncode", None)
        text = captured or ""
        # ⛔ CAPTURE FAILURE IS NOT PARSE FAILURE, AND CONFLATING THEM COST SIXTEEN MINUTES OF
        # DIAGNOSIS. A shard that ran for minutes and returned NOTHING is a broken pipe between
        # this process and vitest; a shard that returned output with no totals line is a run that
        # died. Different causes, different fixes, so they get different names.
        # ⭐ AND IT ABORTS: five more shards into a pipe already known to be broken is thirteen
        # wasted minutes to reach a conclusion that was available at shard 1.
        if not text.strip():
            raise GateError(
                f"EMPTY CAPTURE from shard {i}: the shard was executed but its output never "
                f"reached this process — a broken pipe, not a failed run (check the subprocess "
                f"decoding). It exited {_code_text(exit_codes[i])}. "
                f"Aborting; the remaining shards were NOT run."
            )
        totals = parse_totals(text)
        # ⛔ (b) A SHARD WITH OUTPUT BUT NO TOTALS LINE DID NOT RUN. Never the exit code.
        if totals is None:
            missing.append(i)
        else:
            per_shard.append({"shard": i, "exit_code": exit_codes[i], **totals})
            shard_ids = parse_failures(text)
            failures.extend(shard_ids)
            # ⚠️ THE PARSER'S COUNT AGAINST VITEST'S OWN. The identity pattern can only DROP
            # a line now (a `projects` config puts `|name|` before the path; a path with a space
            # breaks the token), and a dropped identity never reaches `new` -- the flattering
            # direction. vitest's `Tests N failed` counts test-level failures, so it is compared
            # with the identities that are NOT file-level `[ … ]` errors. A WARNING, not a verdict:
            # two tests with one full name dedupe to one identity and disagree honestly.
            parsed = sum(1 for ident in shard_ids if " [ " not in ident)
            if parsed != totals["tests"]["failed"]:
                identity_mismatches.append({"shard": i, "parsed": parsed,
                                            "vitest_failed": totals["tests"]["failed"]})

    if missing:
        raise GateError(
            "NO TOTALS LINE from shard(s) "
            + ", ".join(f"{i} (exited {_code_text(exit_codes[i])})" for i in missing)
            + " — those shards did not run. A test run without a totals line is not a run."
        )

    # ⛔ (c) DRIFT — the tree that finished must be the tree that started.
    end_head, end_dirty = tree_state_fn()
    end_dirty = _real_dirt(end_dirty)
    if end_head != start_head or end_dirty:
        raise GateError(
            # ⛔ NAME WHAT DRIFTED. This said "with N uncommitted file(s)" and a count is not a
            # diagnosis — the reader then has to reconstruct which file moved, which is the same
            # names-not-counts defect the baseline comparison exists to fix.
            f"TREE DRIFT during the run: started at {start_head} clean, ended at {end_head}"
            + (f" with {len(end_dirty)} uncommitted file(s): "
               + ", ".join(e.strip() for e in end_dirty[:10]) if end_dirty else "")
            + ". The tree it ran against is not the tree it would report on; this run is void."
        )

    summed = sum_totals(per_shard)
    declared = file_count_fn()
    waived = count_waived_files(tuple(exclude))
    base = load_baseline()
    failures = sorted(set(failures))
    vs_baseline = compare_failures(failures, base.get("failures") or [],
                                   base.get("expected_red") or [])
    # ⛔ COMPUTED WHERE THE BASELINE DICT IS STILL IN HAND, and published into the SAME block the
    # exit code reads. `compare_failures` takes lists, so it cannot see the reasons map; adding
    # the key afterwards in run_gate keeps ONE place where `vs_baseline` is assembled rather than
    # a second authority patching it later (`lesson_a_second_authority_over_one_value`).
    vs_baseline["expected_red_unexplained"] = unexplained(base)
    return {
        "at": _dt.datetime.now().isoformat(timespec="seconds"),
        "tree_head_start": start_head,
        "tree_head_end": end_head,
        "wrapper": "scripts/gate_shards.py",
        "wrapper_blob": blob_hash(pathlib.Path(__file__)),
        "shards": shards,
        # ⛔ PAIRED, so a pattern can never appear without the reason it was waived for.
        "excluded": list(zip(exclude, list(exclude_reasons) + ["⛔ NO REASON GIVEN"] * len(exclude))),
        "per_shard": per_shard,
        # ⛔ PUBLISHED, so a reader of the manifest alone can see it. A shard that exited
        # non-zero while printing a clean totals line is not a failure — but it is a fact,
        # and it was invisible for the entire life of this tool.
        "shard_exit_codes": {str(i): exit_codes.get(i) for i in range(1, shards + 1)},
        "summed": summed,
        "test_files_on_disk": declared,
        "test_files_waived": waived,
        # ⛔ ON DISK minus WAIVED is what a run can possibly execute.
        "file_count_reconciles": summed["files"]["total"] == declared - waived,
        "failures": failures,
        # ⚠️ A WARNING, NEVER PART OF THE VERDICT: shards whose parsed test-level identities
        # disagree with vitest's own `Tests N failed`. Empty means every shard agreed.
        "failures_reconcile": {"ok": not identity_mismatches, "shards": identity_mismatches},
        "baseline_sha": base.get("sha"),
        "baseline_measured_at": base.get("measured_at"),
        "vs_baseline": vs_baseline,
        "do_not_build": do_not_build_sweep(),
    }


def render(manifest: dict) -> str:
    s, f, t = manifest["summed"], manifest["summed"]["files"], manifest["summed"]["tests"]
    lines = [
        f"# Gate run — {manifest['at']}",
        "",
        f"- tree: `{manifest['tree_head_start']}` (start) -> `{manifest['tree_head_end']}` (end)",
        f"- wrapper: `{manifest['wrapper']}` blob `{manifest['wrapper_blob']}`",
        f"- shards: {manifest['shards']}",
    ] + ([
        "",
        "## ⛔ WAIVED — this run did NOT execute the following",
        "",
    ] + [f"- `{pat}` — {why}" for pat, why in manifest.get("excluded", [])] + [
        "",
        "⛔ The totals above are over the REMAINING suite. A waiver covers exactly what it names.",
    ] if manifest.get("excluded") else []) + [
        "",
        "| shard | test files | tests |",
        "|---|---|---|",
    ]
    for sh in manifest["per_shard"]:
        lines.append(
            f"| {sh['shard']} | {sh['files']['failed']} failed / {sh['files']['total']} "
            f"| {sh['tests']['failed']} failed / {sh['tests']['passed']} passed / {sh['tests']['total']} |"
        )
    lines += [
        f"| **Σ** | **{f['failed']} failed / {f['total']}** "
        f"| **{t['failed']} failed / {t['passed']} passed / {t['total']}** |",
        "",
        f"- test files on disk: **{manifest['test_files_on_disk']}**"
        + (f" − **{manifest['test_files_waived']}** waived = "
           f"**{manifest['test_files_on_disk'] - manifest['test_files_waived']}** runnable"
           if manifest.get("test_files_waived") else "")
        + f" — {'RECONCILES' if manifest['file_count_reconciles'] else '⛔ DOES NOT RECONCILE'} "
        f"with the summed file total ({f['total']}).",
    ]

    # ⛔ THE VERDICT IS A SET COMPARISON, NOT A COUNT. Nine different failures also count nine.
    v = manifest.get("vs_baseline") or {}
    lines += [
        "",
        f"## Failing set vs baseline (`{manifest.get('baseline_sha') or 'NO BASELINE'}`, "
        f"measured {manifest.get('baseline_measured_at') or '—'})",
        "",
        f"- observed **{v.get('observed_count', 0)}** failing tests, baseline has "
        f"**{v.get('baseline_count', 0)}**",
        f"- **NEW failures (regressions): {len(v.get('new') or [])}**"
        + ("" if v.get("new") else " — none"),
    ]
    for nf in (v.get("new") or []):
        lines.append(f"    - ⛔ {nf}")
    if v.get("no_longer_failing"):
        lines.append(f"- no longer failing: {len(v['no_longer_failing'])} "
                     f"(fixed, or silently stopped running — check which)")
        for nf in v["no_longer_failing"]:
            lines.append(f"    - {nf}")
    # ⛔ ITS OWN LINE, AND IT ALWAYS PRINTS. An unexplained waiver was subtracted out of the NEW
    # count above, so the reader must be told the subtraction happened on an unsigned excuse —
    # and on a clean baseline the explicit "0" is what distinguishes a gate that CHECKED from an
    # older artifact whose gate could not.
    _unx = v.get("expected_red_unexplained") or []
    lines.append(f"- expected-red entries naming **no reason**: **{len(_unx)}**"
                 + ("" if _unx else " — none"))
    for ue in _unx:
        lines.append(f"    - ⛔ {ue} (subtracted from NEW on an excuse nobody wrote down)")
    lines.append("")
    lines.append("✅ **The failing set matches the baseline exactly.**" if v.get("matches_baseline")
                 else "⛔ **The failing set DIFFERS from the baseline** — read the two lists above.")

    # ── Did the parser see every failure vitest counted? ─────────────────────
    # ⚠️ A SECTION THAT ALWAYS PRINTS, and a WARNING rather than a verdict. The identity pattern
    # can only DROP a line (a `projects` badge before the path, a path with a space), and a
    # dropped identity never reaches NEW -- so a disagreement is the one sign that the set above
    # is short. It does not change the exit code: two tests with one full name dedupe honestly.
    rec = manifest.get("failures_reconcile")
    lines += ["", "## Failing identities vs vitest's own count", ""]
    if rec is None:
        lines.append("⚠️ Not recorded by this run.")
    elif rec.get("ok"):
        lines.append("✅ Every shard's parsed test-level identities equal its `Tests N failed`.")
    else:
        lines.append("⚠️ **WARNING — parsed identities disagree with vitest's count** "
                     "(not a failure; read which, before trusting the NEW count above):")
        for m in rec.get("shards") or []:
            lines.append(f"    - shard {m['shard']}: parsed **{m['parsed']}** test-level "
                         f"identities, vitest counted **{m['vitest_failed']}** failed")

    # ── C-4 — DO-NOT-BUILD, swept every gate (owner ruling 2026-09-13) ───────
    # ⛔ A SECTION THAT ALWAYS PRINTS. "The sweep did not run" and "the sweep
    # found nothing" are different facts, and a section that appears only on a
    # hit makes them look identical to anyone reading a clean manifest.
    dnb = manifest.get("do_not_build") or {"ran": False, "why": "not recorded by this run"}
    lines += ["", "## §8 DO-NOT-BUILD sweep", ""]
    if not dnb.get("ran"):
        lines.append(f"⛔ **DID NOT RUN** — {dnb.get('why')}. This is not a clean result.")
    elif dnb.get("clean"):
        lines.append("✅ No §8 item has gained code in `app/src`, `api`, `scripts`, `tools`.")
    else:
        lines.append("⛔ **The sweep reported matches — each is a QUESTION, not a verdict.**")
        for h in dnb.get("hits") or []:
            lines.append(f"    - {h}")
        lines.append("")
        lines.append("A legitimate match is exempted in the tool WITH its argument written out — "
                     "never by narrowing the probe until it goes quiet.")
    return "\n".join(lines) + "\n"


def _announce_box_load(load: dict | None) -> None:
    """Say what the box is DOING, beside what the lock says about who HOLDS it.

    ⛔⛔ IT REPORTS; IT NEVER REFUSES. The lock is advisory — a queue, not a mutex — and a gate
    that refused on observed load would deadlock behind its own vitest workers the moment the
    exclusion logic drifted, and would be blocked by any co-resident pytest run in the meantime.
    The operator decides; this makes sure they are not deciding on the strength of `FREE` alone,
    which is what `gate_box_lock status` printed onto a box with fifteen live processes on it.

    ⛔ AND AN UNREADABLE PROBE IS SAID OUT LOUD, not treated as a quiet box. "We could not look"
    and "there was nothing to see" call for different responses.
    """
    state = (load or {}).get("state")
    if state == gate_box_sampler.LOAD_BUSY:
        say("", err=True)
        say("  ⚠ THE BOX IS NOT QUIET — " + gate_box_sampler.describe_load(load), err=True)
        for proc in (load or {}).get("processes") or []:
            say(f"      {proc['kind']:<7} pid {proc['pid']:<7} "
                f"{(proc.get('command_line') or '')[:110]}", err=True)
        say("  Nothing here refuses the run: the lock is advisory and only a LIVE HOLDER "
            "refuses it.", err=True)
        say("  But a shard's totals line has gone missing on a contended box before, and an "
            "INVALID", err=True)
        say("  manifest costs 13 minutes. Consider waiting, or --max-workers 1.", err=True)
    elif state in (gate_box_sampler.LOAD_UNREADABLE, gate_box_sampler.LOAD_NOT_PROBED):
        say("", err=True)
        say("  ⛔ " + gate_box_sampler.describe_load(load), err=True)
        say("  That is NOT 'the box is quiet' — it is an unanswered question. A count of 0 from "
            "a probe", err=True)
        say("  that never ran is indistinguishable from a genuinely idle machine.", err=True)


def main(argv=None) -> int:
    ap = _Parser(description=__doc__)
    ap.add_argument("--shards", type=int, default=6)
    ap.add_argument("--out", default=str(REPO / "docs" / "plans" / "joystick" / "gate-runs"))
    # ⛔ DEFAULT UNCHANGED AT 2. This exists because this box runs several
    # sessions at once: three worktrees had full suites in flight and the host
    # OOM-killed mine twice. Lowering MY footprint is the only lever that does
    # not require destroying somebody else's 13-minute run.
    ap.add_argument("--exclude", action="append", default=[],
                    metavar="GLOB",
                    help="vitest --exclude glob; repeatable. Pair with --exclude-reason.")
    ap.add_argument("--exclude-reason", action="append", default=[],
                    metavar="TEXT",
                    help="why the matching --exclude is waived. ⛔ REQUIRED per --exclude: an "
                         "unexplained exclusion is how a suite shrinks without anyone deciding to.")
    ap.add_argument("--max-workers", type=int, default=2,
                    help="vitest workers per shard; lower it when the box is contended")
    args = ap.parse_args(argv)
    out_dir = pathlib.Path(args.out)

    # ⛔ ARGUMENT ERRORS ARE SETTLED BEFORE THE LOCK IS TOUCHED. Taking a machine-wide lock to
    # discover a typo would block another workstream's gate for nothing.
    if len(args.exclude_reason) != len(args.exclude):
        say('⛔ REFUSING: every --exclude needs an --exclude-reason. An unexplained '
            'exclusion is how a suite shrinks without anyone deciding to.', err=True)
        say(verdict_line(EXIT_INVALID, cause='MISSING_EXCLUDE_REASON'))
        return 2

    # ── the box lock (owner ruling R3) ────────────────────────────────────────────────────────
    run_id = _dt.datetime.now().isoformat(timespec="seconds")
    try:
        lock = gate_box_lock.acquire(run_id, worktree=REPO)
        _announce_box_load(lock.get("load"))
    except gate_box_lock.LockHeld as e:
        # ⛔ ONE LINE NAMING THE HOLDER. "The box is busy" sends the reader nowhere; a pid, a
        # start time and a command line tell them whose run to wait for and who to ask.
        say(f"\n  GATE REFUSED — the box is held: {e}\n", err=True)
        say("  Wait for it, or re-run with "
            f'{gate_box_lock.BYPASS_ENV}="<reason>" — but read the next line first.', err=True)
        say("  ⛔ A BYPASS NEVER BUYS A CLEAR VERDICT: the run is still sampled and still lands "
            "INCONCLUSIVE-CONTENDED while that holder is alive.", err=True)
        # ⛔ THE HOLDER AND THE LOAD ARE TWO SEPARATE SENTENCES. Knowing whose run holds the
        # ticket does not tell you what the box is doing; a refused caller needs both.
        say("  " + gate_box_sampler.describe_load(getattr(e, "load", None)), err=True)
        say(verdict_line(EXIT_LOCK_HELD, holder_pid=(e.holder or {}).get("pid"),
                         held_since=(e.holder or {}).get("started_at"),
                         holder_workstream=(e.holder or {}).get("workstream") or "unknown"))
        return EXIT_LOCK_HELD

    # ⛔ EVERY EXIT PATH RELEASES — a normal verdict, a GateError refusal, an unexpected
    # exception, a KeyboardInterrupt. A lock only a happy path releases is a lock that strands
    # the box the first time anything goes wrong, which is when it matters most.
    try:
        return _gate_body(args, out_dir, lock)
    finally:
        gate_box_lock.release()


def _gate_body(args, out_dir: pathlib.Path, lock: dict) -> int:
    """The gate itself, exactly as it was before the lock existed."""
    try:
        manifest = run_gate(args.shards, out_dir, max_workers=args.max_workers,
                            exclude=tuple(args.exclude), exclude_reasons=tuple(args.exclude_reason))
    except GateError as e:
        # ⛔ A REFUSED RUN LEAVES NO ARTIFACT THAT LOOKS LIKE A RUN. The first failure of this
        # wrapper left six 0-byte `shard-*.log` files behind, and a directory of empty logs reads
        # as "a run happened" to anyone who does not know the story. Clear them, and leave ONE
        # file that says INVALID and why.
        removed = 0
        stamp = _dt.datetime.now().isoformat(timespec="seconds").replace(":", "-")
        if out_dir.exists():
            for stale in out_dir.glob("shard-*.log"):
                stale.unlink()
                removed += 1
            (out_dir / f"INVALID-{stamp}.md").write_text(
                f"# Gate run INVALID — {stamp}\n\n"
                f"**No result was produced. This is not a gate run.**\n\n"
                f"> {e}\n\n"
                f"Per-shard logs from the refused attempt were deleted ({removed} file(s)) so an\n"
                f"empty log directory cannot be mistaken for a completed run.\n",
                encoding="utf-8", newline="\n")
        say(f"\n  GATE INVALID: {e}\n", err=True)
        say(f"  (cleared {removed} partial shard log(s); wrote INVALID-{stamp}.md)\n", err=True)
        say(verdict_line(EXIT_INVALID, cause=_invalid_cause(str(e))))
        return 2
    # ⛔ THE LOCK'S STORY GOES INTO THE ARTIFACT. A bypass that is only visible in a log nobody
    # opens is a bypass nobody reviews; and a reclaimed stale lock is how you learn some earlier
    # gate died without anyone noticing.
    manifest["box_lock"] = {
        "acquired": lock.get("acquired"),
        "path": lock.get("path"),
        "bypass": lock.get("bypass"),
        "bypass_reason": lock.get("bypass_reason"),
        "overrode": lock.get("overrode"),
        "reclaimed": lock.get("reclaimed"),
    }
    stamp = manifest["at"].replace(":", "-")
    # ⛔ newline="\n" IS LOAD-BEARING ON WINDOWS. `write_text` without it
    # uses os.linesep, so every manifest lands CRLF while this repo stores LF and
    # `tools/check_repo_hygiene.py` refuses the untracked file. It is invisible
    # once staged (autocrlf normalises at `git add`), which is why it kept coming
    # back: the committed blob looks right and the working file is wrong.
    (out_dir / f"{stamp}.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8", newline="\n")
    (out_dir / f"{stamp}.md").write_text(
        render(manifest), encoding="utf-8", newline="\n")
    say(render(manifest))
    code = verdict_exit_code(manifest, say=say)
    # ⛔ DERIVED FROM THE SAME MANIFEST AS THE EXIT CODE, in the same breath, so the line and
    # the status can never disagree with each other the way the status and the report did.
    v = manifest.get("vs_baseline") or {}
    say(verdict_line(
        code,
        new=len(v.get("new") or []),
        no_longer_failing=len(v.get("no_longer_failing") or []),
        # ⛔ MASTER'S EXPECTED-RED DISTINCTION SURVIVES ONTO THE LINE. A deliberate
        # reproduction that is red on purpose and a baseline row that is red by measurement
        # are different facts; a line reporting only a total would re-collapse the very
        # distinction `compare_failures` was changed to make.
        expected_red_seen=len(v.get("expected_red_seen") or []),
        expected_red_stale=len(v.get("expected_red_stale") or []),
        # ⛔ ON THE LINE, ALWAYS, INCLUDING WHEN IT IS 0. A field that appears only on a hit makes
        # "the gate checked and found none" indistinguishable from "this gate never checked" to
        # anyone grepping an older artifact — the same reason the DO-NOT-BUILD section always
        # prints. Zero here is a measurement.
        expected_red_unexplained=len(v.get("expected_red_unexplained") or []),
        test_files=manifest["summed"]["files"]["total"],
        tests_failed=manifest["summed"]["tests"]["failed"],
        reconciles=str(bool(manifest["file_count_reconciles"])).lower(),
    ))
    return code


# Exit codes. 2 is the refused/invalid run above; these two are the verdict of a VALID run.
EXIT_NO_NEW = 0
EXIT_NEW_FAILURES = 1
# ⛔ ITS OWN CODE. A suite that did not run every file and a suite that found a
# regression are different facts, and a caller that cannot tell them apart will
# eventually treat one as the other.
EXIT_DID_NOT_RECONCILE = 3
EXIT_INVALID = 2
# ⛔ ITS OWN CODE, because "the box was busy" is not a verdict about this branch. Collapsing it
# into INVALID would make a queued run indistinguishable from a broken one, and the two call for
# opposite responses: wait, versus go and look.
EXIT_LOCK_HELD = 4
# ⛔ ITS OWN CODE, for the same reason 3 and 4 have theirs. An `expected_red` entry that names no
# reason is a WAIVER NOBODY SIGNED: `compare_failures` subtracts it out of `new`, so the run reads
# green on the strength of an excuse that cannot be checked. That is neither a regression (1) nor
# a broken run (2) nor a busy box (4) — and it is emphatically not a pass. A caller that cannot
# tell it from `NEW_FAILURES` would go hunting for a regression that does not exist; one that
# cannot tell it from `NO_NEW_FAILURES` would merge on an unaudited excuse.
EXIT_UNEXPLAINED_RED = 5

# ⛔⛔ THE VERDICT IS A LINE OF OUTPUT, BECAUSE THE EXIT CODE IS NOT TRUSTWORTHY IN TRANSIT.
#
# `verdict_exit_code` below is correct and stays correct. What is not reliable is everything
# BETWEEN this process and the person reading the result. Measured, twice, in this repo:
#
#   2026-09-09  a runner died at argument parsing having executed nothing  -> reported exit 0
#   2026-09-13  this wrapper printed "GATE EXIT: 1" on a NEW failure       -> reported exit 0
#
# so the background-task status is uninformative in BOTH directions — it is not merely
# optimistic about startup. A third sighting on 2026-09-14 (a waiter exiting 2 reported as 0)
# is what `Captured` above exists for; this is the same disease at the other end of the tool.
#
# ⭐ THE FIX IS NOT TO REPAIR THE CHANNEL — it is not ours — BUT TO STOP DEPENDING ON IT.
# One unambiguous line, on stdout, derived from the SAME manifest the exit code is derived
# from, so the two can never disagree. A reader greps `^VERDICT=` and is done.
#
# ⛔ ADDITIVE ONLY. This wrapper is shared — it is on master and other workstreams run it —
# so not one existing line of output changed and not one exit code moved. A consumer that
# has never heard of VERDICT= behaves exactly as it did before.
VERDICT_NAMES = {
    EXIT_NO_NEW: "NO_NEW_FAILURES",
    EXIT_NEW_FAILURES: "NEW_FAILURES",
    EXIT_INVALID: "INVALID",
    # ⛔ MASTER'S, AND THE ONE THIS LINE MOST NEEDS TO CARRY. A suite that did not run every
    # file fails in the FLATTERING direction — fewer files, fewer failures — so `exit=3` with
    # no name is precisely the run an operator must not mistake for a quiet one. Every code
    # `verdict_exit_code` can return must appear here, and a rail derives that set from the
    # module rather than retyping it.
    EXIT_DID_NOT_RECONCILE: "DID_NOT_RECONCILE",
    # ⛔ NOT A SUITE VERDICT, and named so it cannot be read as one. Consistent with how
    # stage-2-verification.md §2 now treats run-hub-rails.mjs's exit 2: a refusal to start is
    # "this did not run", never "this ran and was fine".
    EXIT_LOCK_HELD: "REFUSED-LOCK",
    # ⛔ NAMED FOR THE THING THAT IS WRONG WITH THE BASELINE, not for the suite. The suite may
    # have been perfect; what cannot be trusted is the subtraction that made it look that way.
    EXIT_UNEXPLAINED_RED: "UNEXPLAINED_RED",
}


def verdict_line(code: int, **fields) -> str:
    """One greppable line: `VERDICT=<NAME> exit=<n> [k=v ...]`.

    ⚠ Field values must not contain spaces — the line is meant to survive `awk`/`cut` in a
    shell that has no JSON parser. Prose belongs in the lines above it, which already carry it.
    """
    name = VERDICT_NAMES.get(code, "UNKNOWN")
    extra = " ".join(f"{k}={v}" for k, v in fields.items())
    return f"VERDICT={name} exit={code}" + (f" {extra}" if extra else "")


def _invalid_cause(message: str) -> str:
    """The GateError's own leading label as a space-free token, for the VERDICT line.

    Every refusal in `run_gate` names itself in capitals first — DIRTY TREE, EMPTY CAPTURE,
    NO TOTALS LINE, TREE DRIFT — precisely so a caller can tell them apart. This carries that
    distinction onto the verdict line instead of flattening four different refusals into one
    word, which is the failure `GateError` was given named cases to avoid.
    """
    m = re.match(r"^[A-Z][A-Z0-9 ]*[A-Z]", message.strip())
    return m.group(0).replace(" ", "_") if m else "REFUSED"


def verdict_exit_code(manifest: dict, *, say=lambda *_a, **_k: None) -> int:
    """The exit code, derived from the SAME `vs_baseline` block the manifest publishes.

    ⛔ WHY THIS EXISTS. This function used to be `return 0`, under a comment saying the verdict was
    "a judgement the manifest supports and this script deliberately does not make". That produced a
    wrapper which exited 0 while printing **"The failing set DIFFERS from the baseline"** — and it
    did exactly that on Increment 3's 2026-09-10 run. A caller reading `$?`, a CI step, or a `&&`
    chain all saw success on a run whose own report said otherwise. An exit code that disagrees
    with the artifact beside it is worse than no exit code: it is a green light nobody audited.

    ⭐ THE VERDICT IS `new`, NOT SET EQUALITY. `compare_failures` already says so in its own
    docstring — *"`new` is the only one that can block a merge"*. The other direction,
    `no_longer_failing`, is a baseline entry that stopped failing: master fixed something, or the
    test stopped running. The repo's three-direction protocol
    (`scripts/gate_baseline_diff.py`, railed in `test_gate_baseline_diff.py`) is explicit that this
    direction **never blocks**, and exiting non-zero on it would fail a branch for making things
    better — which is precisely how a gate teaches people to stop reading it.

    So `matches_baseline` is what gets REPORTED, and `new` is what gets ENFORCED. When they
    disagree — a stale baseline in the harmless direction — that is said out loud rather than
    silently collapsed into either answer.
    """
    # ⛔⛔ THE COVERAGE CHECK IS PART OF THE VERDICT, NOT DECORATION.
    # `file_count_reconciles` was computed and RENDERED into the manifest from the
    # day this wrapper was written, and read by NOTHING: a run whose shards
    # executed 1,016 of 1,178 files printed 'DOES NOT RECONCILE' and still exited 0
    # with 'no NEW failures'. That is failure mode #2 in this file's own docstring -
    # a partial suite fails in the FLATTERING direction, because fewer files run
    # means fewer failures found. count_waived_files() already removes the only
    # legitimate cause of a shortfall, so this cannot cry wolf.
    #
    # ⭐ It runs BEFORE the baseline comparison on purpose. If the suite did not
    # execute every file, the observed failing set is INCOMPLETE, so `new: 0` is not
    # a green verdict - it is an unanswered question wearing one.
    if manifest.get("file_count_reconciles") is False:
        disk = manifest.get("test_files_on_disk")
        waived = manifest.get("test_files_waived") or 0
        ran = ((manifest.get("summed") or {}).get("files") or {}).get("total")
        expected = (disk - waived) if isinstance(disk, int) else None
        say("", err=True)
        say(f"  GATE: DOES NOT RECONCILE - exit {EXIT_DID_NOT_RECONCILE}.", err=True)
        say(f"  {ran} test file(s) ran; {disk} on disk minus {waived} waived = "
            f"{expected} expected.", err=True)
        say("  Per shard (a shortfall is usually ONE shard, not a spread):", err=True)
        for s in manifest.get("per_shard") or []:
            say(f"    shard {s.get('shard')}: "
                f"{(s.get('files') or {}).get('total')} file(s)", err=True)
        say("  No baseline comparison is reported: the failing set is incomplete,",
            err=True)
        say("  and a partial suite finds fewer failures and reads as a pass.", err=True)
        return EXIT_DID_NOT_RECONCILE

    v = manifest.get("vs_baseline") or {}
    new = v.get("new") or []
    stale = v.get("no_longer_failing") or []
    exp_seen = v.get("expected_red_seen") or []
    exp_stale = v.get("expected_red_stale") or []
    # ⛔⛔ AN UNEXPLAINED WAIVER IS ANSWERED BEFORE THE THING IT WAIVES.
    # `compare_failures` has ALREADY subtracted every `expected_red` entry out of `new` by the
    # time this function runs, so if one of those entries names no reason, `new: 0` is not a
    # green verdict — it is an unanswered question wearing one, the same shape as a run that
    # did not reconcile. Reported here rather than folded into the counts above, because the
    # correct response is different from every other code's: go and write the reason, or delete
    # the entry. `unexplained()` is the one predicate, shared with the rail in the test suite.
    unexplained_red = v.get("expected_red_unexplained") or []
    if unexplained_red:
        say("", err=True)
        say(f"  GATE: {len(unexplained_red)} expected-red entr(ies) name NO reason — "
            f"exit {EXIT_UNEXPLAINED_RED}.", err=True)
        for _e in unexplained_red:
            say("    - " + _e, err=True)
        say("  Each was subtracted out of the NEW-failure count on the strength of an excuse", err=True)
        say("  nobody wrote down. Give it a `why` and a `waits_on` in expected_red_reasons, or", err=True)
        say("  remove the entry — a deliberate red nobody can explain is indistinguishable from", err=True)
        say("  one nobody noticed.", err=True)
        return EXIT_UNEXPLAINED_RED
    # ⛔⛔ A DELIBERATE RED THAT HAS TURNED GREEN IS A FAILURE, NOT A RELIEF. Its
    # defect is fixed, so the entry is stale — and a stale entry is a slot a real
    # failure can occupy unnoticed. Named, so the next reader knows what to delete.
    if exp_stale:
        say("", err=True)
        say("  GATE: EXPECTED-RED entr(ies) are GREEN now, so their defect is fixed", err=True)
        say("  and the entry must be removed, citing the fix that did it:", err=True)
        for _e in exp_stale:
            say("    - " + _e, err=True)
        return EXIT_NEW_FAILURES
    if exp_seen:
        # ⭐ Named, never silent: a deliberate red nobody can see is
        # indistinguishable from one nobody noticed.
        say("", err=True)
        say("  (expected-red, not blocking — deliberate reproductions carrying the fix "
            "they wait on: " + ", ".join(e.split(" > ")[0] for e in exp_seen) + ")",
            err=True)
    if new:
        say(f"\n  GATE: {len(new)} NEW failure(s) against the baseline — exit {EXIT_NEW_FAILURES}.\n"
            f"  Classify each by direction before treating it as a regression: a failure the BASE\n"
            f"  also has is master's (ADD to the baseline, cite the base hash); one only this\n"
            f"  branch has BLOCKS. Re-run a load-sensitive name ALONE before classifying it.\n",
            err=True)
        return EXIT_NEW_FAILURES
    if stale:
        # Not a regression, and deliberately not a failure: say why the sets differ anyway, so
        # "matches_baseline: false" in the manifest is never mistaken for a blocked gate.
        say(f"\n  GATE: no NEW failures — exit {EXIT_NO_NEW}. {len(stale)} baseline entr(ies) no\n"
            f"  longer fail, so the failing set DIFFERS from the baseline in the direction that\n"
            f"  never blocks. The baseline is stale; refresh it, but nothing here stops a merge.\n")
    return EXIT_NO_NEW


if __name__ == "__main__":
    raise SystemExit(main())
