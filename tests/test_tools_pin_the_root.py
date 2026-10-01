"""Every `tools/*.py` that imports `api.*` either applies the shared-data-root CENSUS before
that import, or is named in `EXEMPT_TOOLS` below with a stated reason. Notebook wave 10, lane TP.

WHY THIS EXISTS. CLAUDE.md's "`C:\\data` IS REAL ON THIS BOX" section and
`tests/test_notebook_bridges_pin_the_root.py` cover the bridges and the `notebook_*` family --
the wave-7 whole-branch-fix report that widened that rail measured **90 of 356** `tools/*.py`
importing `api.` and **77** of those failing the ordering check, deliberately left unpinned
"because deciding which should be sandboxed is each tool owner's call, not this rail's." This
is that decision, made file by file, by READING each tool rather than guessing from its name.

Re-derived fresh against THIS tree (409 `tools/*.py`, 103 importing `api.*`): 67 already carry
a correctly-ordered module-level `import conftest` (17 pre-existing + 50 pinned by this lane),
leaving exactly the 36 named in `EXEMPT_TOOLS`.

⛔⛔ **CONTROLLER REVIEW, ROUND 2 (not a hypothetical -- each one measured):** the first pass of
this lane pinned 59 tools under "when in doubt, PIN" and that default was WRONG for three
classes, moving 9 of the 59 to EXEMPT:

  1. **Runs on the production pod** (`railway ssh`/`railway run`/"on Railway via shell"/the
     pod's own `/data`), where `import conftest` would redirect every shared-root path to a
     throwaway sandbox the moment the tool runs there -- `seed_twitter_accounts.py` ("Run once
     locally (or on Railway via shell)") and `snaptrade_trade_detection.py` ("Runs ON the web
     pod ... needs ... auth.db", its own usage lines are `/opt/venv/bin/python
     /app/tools/snaptrade_trade_detection.py`, the exact nixpacks.toml venv path).
  2. **Operates on the live store by design, through an in-tool override the census would
     silently defeat.** `bars_integrity_repair.py` and `bars_split_repair_sweep.py` both read
     `--db` and set `os.environ["DATA_DIR"] = args.db` -- AFTER the module's own `api.*` imports
     have already captured their census-pinned defaults, so a pin leaves `--db` pointing
     somewhere the already-resolved store path never reads. `store_restore.py` already has its
     OWN hand-built guard for exactly this (`if not args.restore: import conftest` -- it
     deliberately skips the census during a REAL `--restore --to PATH`, "the one mode that
     writes a store", so `--to` reaches its real target); a blind top-level pin ran that import
     UNCONDITIONALLY and defeated the tool's own, already-correct design.
  3. **`conftest.py:87` overwrites `AUTH_DB_PATH` UNCONDITIONALLY** (`os.environ["AUTH_DB_PATH"]
     = ISOLATED_AUTH_DB`, no "is it already pointed somewhere safe" check, unlike the general
     census redirect at lines 501-512 for every other pin). `seed_sweep_admin.py` already wrote
     "Local-only: writes to ./data/auth.db (never the Railway volume)" via
     `os.environ.setdefault("AUTH_DB_PATH", ...)` -- a pin's unconditional overwrite runs FIRST,
     so `setdefault` never fires and the tool silently seeds a throwaway temp file instead of
     the deterministic repo-local path a companion local server is meant to read.
     `wave4_search_correctness_matrix.py` calls `notebook_sandbox_guard.require_sandboxed_env()`
     (default `needs_auth_db=True`) at module level, which REQUIRES `AUTH_DB_PATH` to resolve
     INSIDE the same sandbox root as `DATA_DIR` -- but conftest mints `ISOLATED_AUTH_DB` and
     `SANDBOX_DATA_ROOT` as two SEPARATE `tempfile.mkdtemp()` directories, so a pin here means
     every bare run raises `SystemExit` even when the operator followed the tool's own
     documented safe usage (`DATA_DIR=... AUTH_DB_PATH=.../auth.db python tools/...`) to the
     letter, because the unconditional overwrite clobbers their explicit `AUTH_DB_PATH` choice.
  4. **`pre_push_guard.py` runs on every `git push`.** Measured (subprocess, this box, `python -c
     "import conftest"` from the repo root): a COLD run cost **119.8 s**, a WARM run **40.8 s**,
     against a bare `python -c "pass"` baseline of **0.27 s** -- `import conftest` runs an AST
     census over all of `api/**`, `scripts/`, `tools/` on every import, and this guard already
     deliberately defers its one `api.*`-touching import (`_freshness()`, read `discord_render`)
     to stay cheap for `--audit` and the unit tests. Adding 40-120 seconds to every push is not
     a tradeoff this lane gets to make unilaterally.

Each of the 9 was reverted to the byte-identical pre-pin state (verified: `git diff --stat`
against the prior commit shows exactly the six inserted lines removed, nothing else touched --
the strongest available proof that `authdb_restore_drill.py` in particular, a weekly scheduled
production task (`UCT-AuthDB-Restore-Drill`) another program clause depends on, behaves
IDENTICALLY before and after this lane: it is, byte for byte, the same file it always was).

TWO TREATMENTS, chosen by reading the tool's own purpose, never its filename:

  (a) PIN -- a module-level `import conftest` before the first `api.*` import (module-level or
      function-local; a function-local import still counts because it necessarily appears later
      in the file than anything inserted near the top). This is purely additive: it changes
      WHERE a bare local run's default data paths resolve, never what the tool computes. A bare
      run now lands in a per-process sandbox instead of `C:\\data`; nothing about an explicit
      `--db`/`--base`/`--auth-db`-style override, or a tool's own additional env pin layered on
      top of the census, is touched.
  (b) EXEMPT BY NAME -- for a tool whose stated, designed purpose is to read or write the REAL
      shared data root (bars.db, auth.db, implied_moves.db, the cboe store, ...), where the
      ONLY path to that data is the standard env-var default the census would redirect, and
      where no separate CLI flag reaches the same literal. Pinning one of these would not make
      it safer -- it would make it **silently wrong**: an intentional run against production
      (via `railway ssh`/`railway run`, or DATA_DIR pointed at a locally pulled snapshot) would
      get redirected to an empty sandbox and read/write nothing real, while looking like it
      worked. That is worse than the status quo, and it is why "when in doubt, PIN" cuts the
      other way here -- these are not doubtful; each is read below.

⚠️ WHAT THIS RAIL DOES NOT SEE, same shape as the bridges rail's own disclosure: it walks
`tools/*.py` (flat, non-recursive -- the wave-7 measurement and this lane's report both use the
same scope) and sees only ABSOLUTE `api` imports IN THE TOOL ITSELF; a tool importing a non-api
helper that itself imports `api.*` at ITS module level, before the tool's `import conftest` line
runs, would pass this walk. No such case was found while deriving the offender set (checked by
hand for every non-`api.*` import among the 59 pinned tools).

⛔ EXEMPT DOES NOT MEAN UNPROTECTED. Every exempt tool was read for its data-writing surface:
several are already read-only by the vendor connection mode (`mode=ro` URIs), several write only
to a repo-tracked file or their own named scratch store, and the ones that DO write the real
root (`rollout_cohort.py --apply`, `desk_premarket_purge.py`, `alert_soak_matrix.py --arm`,
`implied_backfill_run.py`, `build_cboe_indices.py`) are one-shot, owner-approved, or the sole
declared replacement for a banned hand-typed write -- never a tool whose only guard was "nobody
has run it against real data yet."
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOLS = REPO / "tools"


def _is_api(name: str | None) -> bool:
    return bool(name) and (name == "api" or name.startswith("api."))


def _api_import_sites(tree: ast.AST) -> list[int]:
    """Every line that imports from `api`, at ANY depth (a walk, not `tree.body`) -- so a
    function-local import (where every one of the 86 offenders keeps theirs, in `main()`)
    is seen too. Mirrors `tests/test_notebook_bridges_pin_the_root.py::_api_import_sites`."""
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and _is_api(node.module):
            sites.append(node.lineno)
        elif isinstance(node, ast.Import) and any(_is_api(a.name) for a in node.names):
            sites.append(node.lineno)
        elif (isinstance(node, ast.Call) and node.args
              and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)
              and _is_api(node.args[0].value)
              and ((isinstance(node.func, ast.Attribute) and node.func.attr == "import_module")
                   or (isinstance(node.func, ast.Name) and node.func.id in ("import_module", "__import__")))):
            sites.append(node.lineno)
    return sorted(sites)


def _module_level_conftest_import(tree: ast.Module) -> int | None:
    """The line of a MODULE-LEVEL `import conftest`, or None. Module level on purpose: a
    function-local import runs only when that function does, which is the ordering hazard
    this whole rail exists to close."""
    for node in tree.body:
        if isinstance(node, ast.Import) and any(a.name == "conftest" for a in node.names):
            return node.lineno
    return None


def _problems(src: str, name: str) -> list[str]:
    """Ordering only (never hand-pin detection): several PINNED tools here legitimately layer
    their OWN extra env pin on top of the census (the `measure_expectancy.py` pattern of a
    named `UCT_LIVE_*` var re-opened read-only, or a tool that self-isolates `AUTH_DB_PATH` to
    a throwaway file before the census would have) -- that is additive, not a defect, and is
    out of scope for this rail (in scope for whoever owns that tool's own correctness)."""
    tree = ast.parse(src, name)
    api = _api_import_sites(tree)
    ct = _module_level_conftest_import(tree)
    out = []
    if ct is None:
        out.append(f"{name}: no module-level `import conftest` -- the census and the tripwire never run")
    elif api and ct > api[0]:
        out.append(f"{name}: `import conftest` at line {ct} comes AFTER the first api import at line {api[0]}")
    return out


#: ⛔ PAIRINGS THIS RAIL IS CORRECT TO SKIP, DECLARED BY HAND, EACH WITH THE REASON A HUMAN READ
#: FROM THE TOOL (never guessed from its name). Shrink this map when a tool grows a CLI override
#: for its data path, or when its production-only reason stops being true; never grow it to
#: silence a red without reading the tool first.
EXEMPT_TOOLS: dict[str, str] = {
    "alert_corpus_extend.py": (
        "Read-only (`mode=ro` URI) against the live bars.db to extract REAL market conditions "
        "into a committed test fixture; writes only `tests/fixtures/...`, never the shared "
        "root. A pin would silently read an empty sandbox instead of real tape."),
    "alert_soak_matrix.py": (
        "Arms REAL indicator alerts in production's `indicator_alerts` table for the Task 8 "
        "cutover's shadow-lane soak, run against the live pod. A pin would silently arm an "
        "empty sandboxed table while the soak believes it observed something."),
    "archive_authdb_backup.py": (
        "Runs via `railway ssh` on the production pod to archive the newest pre-purge auth.db "
        "backup out of R2; an operator tool with no purpose outside the live pod, no CLI "
        "override for which pod's backups it reads."),
    "audit_bars.py": (
        "DATA_DIR-steered audit comparing the store it is pointed at against Polygon canonical; "
        "the whole point is inspecting the REAL store (production via Railway, or a locally "
        "pulled snapshot) -- a census pin would make it audit an always-empty sandbox."),
    "build_cboe_indices.py": (
        "The only writer of the live Cboe volatility-index store (serve-time reads are "
        "read-only by design). No CLI flag overrides the OUTPUT path (`--local` only reuses a "
        "source CSV cache), so a pin would silently write an unused sandbox on every run."),
    "build_prebuilt_lists.py": (
        "Reads the real bars/grouped-daily store via `railway run` to build accurate prebuilt "
        "ETF lists (writes only a repo JSON file, not the shared root); a pin would make it "
        "read an empty sandbox and ship an empty or wrong list, silently."),
    "cadence_rollup_report.py": (
        "Docstring: 'Runs ON `web`' -- reads that pod's own real cadence markers off its "
        "live volume. READ-ONLY, and there is no sandboxed equivalent for it to report on."),
    "candle_backtest_run.py": (
        "Docstring: 'Reads bars.db READ-ONLY and writes nothing.' A backtest measuring the "
        "candle-label edge over REAL historical bars; a pin would backtest an empty sandbox "
        "and print a meaningless edge table with no way to tell it apart from a real one."),
    "catalyst_selection_diag.py": (
        "Docstring: run 'locally (prod env via `railway run`)' to show what the catalyst tile "
        "would select right now over real premarket movers; a diagnostic with no local-data "
        "mode -- a pin would make it diagnose an empty sandbox and report nothing to select."),
    "cutover_watch.py": (
        "Docstring: 'Run this ON THE PRODUCTION POD, repeatedly' -- the GO/NO-GO instrument for "
        "the ALERT_EVAL_MODE flip, reading real shadow-lane and armed-alert state. A pin would "
        "silently read an empty sandbox and could hand back a false verdict for a real flip."),
    "desk_premarket_purge.py": (
        "Docstring: 'One-shot production purge... (owner-approved 2026-07-29)' of retired "
        "pre-market-stream Desk archives. No CLI override for its DB path, so pinning would let "
        "`--execute` silently no-op against a sandbox while reading as if it ran."),
    "discord_render_bench.py": (
        "Benchmarks the real production render/timing path via its own explicit opt-in flag "
        "`--adopt-pod-env`; pinning the module would defeat that deliberate adoption of the "
        "pod's real environment before the flag ever gets a say."),
    "earnings_ai_live_revalidation.py": (
        "Bounded LIVE re-validation of the Earnings AI slice's shipped fixes, run via "
        "`railway run` against real earnings data and a real model, by design -- the exact "
        "thing a sandboxed pin would replace with nothing to validate."),
    "earnings_ai_live_validation.py": (
        "Docstring: 'Run via: PYTHONPATH=. railway run python tools/earnings_ai_live_"
        "validation.py' -- bounded LIVE validation against real data and a real model; same "
        "reasoning as its revalidation sibling above."),
    "implied_backfill_probe.py": (
        "Docstring: 'Read-only; makes live Massive calls.' Sizes cold-start coverage for the "
        "expected-move service before launch against the real universe; no local-data mode."),
    "implied_backfill_run.py": (
        "Docstring: 'Backfill historical implied moves into /data/implied_moves.db.' Writes "
        "the real production store from Massive's historical option data with no CLI override "
        "for the destination; the RICH/CHEAP verdict needs the real paired-quarter history."),
    "implied_fiscal_backfill.py": (
        "Docstring: 'Run this on the box that owns the real implied_moves.db (Railway web pod, "
        "via railway ssh...)' -- a local dev DB is stated as a harmless no-op, but production "
        "is the intended target and a pin would make it unreachable even there, on purpose."),
    "notebook_volume_report.py": (
        "Existing exemption, carried forward from `tests/test_notebook_bridges_pin_the_root.py`"
        "'s `LIVE_ROOT_READERS`: READ-ONLY by construction, built to measure the LIVE "
        "attachment volume before a connector opens; pinned it would report an empty volume."),
    "rating_ai_live_validation.py": (
        "Docstring: 'Run via: PYTHONPATH=. railway run python tools/rating_ai_live_"
        "validation.py' -- real orchestrator, real composers, real model, exactly as "
        "production serves it; a pin would validate against sandboxed nonsense instead."),
    "rollout_cohort.py": (
        "Docstring: 'the operator door for `rollout:` cohorts' -- the approved, sole mechanism "
        "for writing cohort tags into the real auth.db, replacing a banned hand-typed SQL "
        "insert. No CLI override, so a pin would make `--apply` silently tag an empty "
        "sandboxed user table instead of real members, defeating the tool's entire purpose."),
    "run_lift_ledger.py": (
        "Re-measures structure lift over the real historical bars/structure data (read-only "
        "`mode=ro` connection); no CLI override for the data source, so a sandboxed run would "
        "produce a meaningless ledger with no real trades to measure."),
    "s7_price_level_dryrun.py": (
        "Docstring: 'PIPELINE DRY RUN against real bars' -- runs the pipeline over the REAL "
        "admin cohort and REAL session bars to prove a row carries through end to end; writes "
        "only to its own named SCRATCH store, but needs the real inputs to mean anything."),
    "screener_wave1_smoke.py": (
        "Docstring: 'READ-ONLY: reads bars.db via bars_sqlite (read path)' over 20 REAL "
        "tickers to census non-null columns; no CLI override, and a sandboxed run would "
        "report every column null, which is not the smoke test it is meant to be."),
    "screener_wave1_timing.py": (
        "Times `get_bars` performance over a REAL 200-ticker sample to project the deep-read "
        "cost before shipping Wave 1; an empty sandbox store would time near-zero and "
        "understate the real cost the measurement exists to size."),
    "screener_wave2_smoke.py": (
        "Docstring: 'READ-ONLY' over 20 REAL tickers with real Wave-2 source artifacts; same "
        "reasoning and same no-CLI-override shape as its Wave-1 sibling above."),
    "slice3_live_validation.py": (
        "Docstring: 'Bounded live validation for Security Research Q&A Slice 3' -- run against "
        "real data and a real model, the same live-validation family as the earnings/rating "
        "instruments above."),
    "wave_p_activation_canary.py": (
        "Docstring: 'ONE controlled document, in production... THE ONLY SCRIPT IN THE WAVE "
        "THAT TOUCHES PRODUCTION MEMBER-SERVING.' No CLI override; touching real production is "
        "its explicit, sole, approved purpose, not an accident a pin should prevent."),

    # ── Round 2 (controller review): moved OUT of PINNED, each for a measured reason ──
    "seed_twitter_accounts.py": (
        "Docstring: 'Run once locally (or on Railway via shell) after the schema exists.' A "
        "pin would redirect TWEET_DB_PATH to a throwaway sandbox the moment it runs on the "
        "pod, silently seeding nothing real while the operator believes the accounts landed."),
    "snaptrade_trade_detection.py": (
        "Docstring: 'Runs ON the web pod (needs SNAPTRADE_* + BROKER_ENCRYPTION_KEY + "
        "auth.db)', usage lines are literally `/opt/venv/bin/python /app/tools/...` -- the "
        "nixpacks.toml venv path. A pin would make `add`/`cancel` silently operate on an "
        "empty sandboxed auth.db instead of the real member/account rows it must resolve."),
    "store_restore.py": (
        "Already carries its OWN conditional census guard (`if not args.restore: import "
        "conftest`) that deliberately SKIPS the sandbox during a REAL `--restore --to PATH` "
        "-- 'the one mode that writes a store' per its own docstring -- so `--to` reaches its "
        "real target. A blind top-level pin ran unconditionally and defeated that existing, "
        "already-correct design; reverted to let the tool's own guard do its job."),
    "bars_integrity_repair.py": (
        "`--db` sets `os.environ['DATA_DIR'] = args.db` INSIDE main(), after the module's own "
        "api.* imports already captured their census-pinned defaults -- so pinning leaves "
        "`--db` pointing nowhere the already-resolved bars-store path reads: a SILENT NO-OP "
        "that is worse than the hazard it would guard against. Controller-reviewed, exempt."),
    "bars_split_repair_sweep.py": (
        "Same `--db` / `os.environ['DATA_DIR']`-after-import shape as "
        "bars_integrity_repair.py, its sibling; a pin would make `--db` a silent no-op "
        "instead of reaching the sandbox (or real) store the operator named."),
    "authdb_restore_drill.py": (
        "A weekly SCHEDULED production task (Task Scheduler job `UCT-AuthDB-Restore-Drill`) "
        "that a program clause depends on; reverted to its byte-identical pre-pin state "
        "rather than risk ANY behavior drift in a safety-net drill nothing else backs up."),
    "seed_sweep_admin.py": (
        "Docstring: 'Local-only: writes to ./data/auth.db (never the Railway volume)' via "
        "`os.environ.setdefault('AUTH_DB_PATH', ...)`. conftest.py:87 overwrites AUTH_DB_PATH "
        "UNCONDITIONALLY (no 'already safe' check, unlike every other pin), which runs BEFORE "
        "this setdefault and makes it a no-op -- the tool would silently seed a throwaway temp "
        "file instead of the deterministic repo-local path a companion local server reads."),
    "wave4_search_correctness_matrix.py": (
        "Calls `notebook_sandbox_guard.require_sandboxed_env()` (needs_auth_db=True, the "
        "default) at module level, which REQUIRES AUTH_DB_PATH to resolve INSIDE the same "
        "sandbox root as DATA_DIR -- but conftest mints them as two SEPARATE mkdtemp() "
        "directories, so a pin makes every bare run raise SystemExit even when the operator "
        "follows the tool's own documented safe usage to the letter."),
    "pre_push_guard.py": (
        "Runs on EVERY git push. Measured: `import conftest` alone costs 119.8s cold / 40.8s "
        "warm in a subprocess on this box, against a 0.27s bare-python baseline (it runs an "
        "AST census over api/**, scripts/, tools/ on every import) -- an unacceptable tax on "
        "every push, and the guard already deliberately defers its one api.*-touching import "
        "to stay cheap for --audit and the unit tests. It only talks to Railway's CLI/API."),
}

#: Named members, never a count: the walk must see these three PINNED tools and these three
#: EXEMPT ones, or it is walking the wrong directory / matching the wrong glob.
KNOWN_PINNED_TOOLS = ("record_clock_parity.py", "vendor_truth.py", "wave4_fts_benchmark.py")
KNOWN_EXEMPT_TOOLS = ("audit_bars.py", "rollout_cohort.py", "wave_p_activation_canary.py")


def _all_api_importing_tools() -> list[Path]:
    """Every `tools/*.py` (flat, non-recursive) that imports `api.*` anywhere in its AST."""
    out = []
    for path in sorted(TOOLS.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), path.name)
        except SyntaxError:
            continue
        if _api_import_sites(tree):
            out.append(path)
    return out


def test_every_tools_api_importer_pins_the_census_or_is_named_exempt():
    """The rail. An `api.*`-importing tool not in `EXEMPT_TOOLS` must carry a correctly-ordered
    module-level `import conftest`, by name -- never a count."""
    problems = []
    for path in _all_api_importing_tools():
        if path.name in EXEMPT_TOOLS:
            continue
        problems.extend(_problems(path.read_text(encoding="utf-8"), path.name))
    assert not problems, "\n".join(problems)


def test_every_exempt_name_is_real_and_every_reason_is_stated():
    """A typo in `EXEMPT_TOOLS` matches nothing and would silently stop covering that tool --
    or silently exempt a tool that no longer imports `api.*` at all. Both fail here by name."""
    names = {p.name for p in _all_api_importing_tools()}
    for exempt, why in EXEMPT_TOOLS.items():
        assert exempt in names, (
            f"stale exemption: {exempt!r} no longer imports api.* (or is gone, or misspelled) "
            f"-- a typo in this dict matches nothing and silently un-exempts the real tool")
        assert len(why) > 60, f"{exempt}: the stated reason is too short to be a real reason"
    checked = [n for n in names if n not in EXEMPT_TOOLS]
    assert checked, "every api-importing tool is exempt -- this rail checks nothing"
    assert len(checked) >= 50, (
        f"only {len(checked)} tools are checked -- the glob or the api-import walk may be "
        f"reading the wrong place (wave-7's measurement found 90 in this repo)")


def test_the_walk_sees_the_known_pinned_and_known_exempt_members():
    """Non-vacuity: the glob finds the directory, the api-import walk finds real files, and
    the three named PINNED tools are seen as clean while the three named EXEMPT ones are seen
    as still lacking a pin (which is exactly why they are declared, not derived)."""
    by_name = {p.name: p for p in _all_api_importing_tools()}
    for known in KNOWN_PINNED_TOOLS:
        assert known in by_name, f"{known} not found -- the walk is reading the wrong place"
        src = by_name[known].read_text(encoding="utf-8")
        assert _problems(src, known) == [], f"{known}: expected clean, got {_problems(src, known)}"
    for known in KNOWN_EXEMPT_TOOLS:
        assert known in by_name, f"{known} not found -- the walk is reading the wrong place"
        assert known in EXEMPT_TOOLS, f"{known}: test assumption drifted, pick another exemplar"


def test_the_walk_correctly_flags_a_real_unpinned_tool_before_any_exemption_is_applied():
    """Non-vacuity against REAL code, not only a fixture string: every `EXEMPT_TOOLS` member
    genuinely has no correctly-ordered module-level `import conftest` today (that is WHY each
    needed a human's declared reason, not a defect in the walk). Prove the walk would flag one
    of them as a problem if the exemption were not consulted -- i.e. the walk can fail."""
    name = "audit_bars.py"
    assert name in EXEMPT_TOOLS, "test assumption drifted -- pick another exempted tool"
    src = (TOOLS / name).read_text(encoding="utf-8")
    problems = _problems(src, name)
    assert problems, f"{name}: the walk sees NO problem in a genuinely unpinned real tool -- it cannot fail"


def test_the_walk_sees_what_it_claims_to_on_fixture_strings():
    """Same five-shape fixture set as `test_notebook_bridges_pin_the_root.py::test_the_walk_
    sees_what_it_claims_to`, reused here because this rail's `_problems` is the same ordering
    check applied to a wider glob: good / late / nested-only / absent."""
    good = "import conftest\n\ndef main():\n    from api.services import x\n"
    late = "def main():\n    from api.services import x\n\nimport conftest\n"
    nested = "def main():\n    import conftest\n    from api.services import x\n"
    absent = "def main():\n    from api.services import x\n"
    assert _problems(good, "good") == []
    assert _problems(late, "late") and "AFTER" in _problems(late, "late")[0]
    assert _problems(nested, "nested") and "no module-level" in _problems(nested, "nested")[0]
    assert _problems(absent, "absent") and "no module-level" in _problems(absent, "absent")[0]


def test_MUTATION_removing_the_pin_from_a_real_tool_goes_red_then_is_restored_byte_for_byte():
    """Capture the real bytes, mutate exactly once (strip the `import conftest` line), prove
    the walk goes RED against the mutated on-disk file, then restore the captured bytes and
    verify by sha256 -- never `git checkout` (`feedback_mutation_check_never_git_checkout`)."""
    target = TOOLS / "record_clock_parity.py"
    original = target.read_bytes()
    original_sha = hashlib.sha256(original).hexdigest()
    assert _problems(original.decode("utf-8"), target.name) == [], (
        "test assumption drifted -- the target is not clean before mutation")
    try:
        lines = original.decode("utf-8").splitlines(keepends=True)
        mutated_lines = [ln for ln in lines if not ln.lstrip().startswith("import conftest")]
        assert len(mutated_lines) < len(lines), (
            f"{target.name} carries no `import conftest` line to remove -- pick another target")
        target.write_bytes("".join(mutated_lines).encode("utf-8"))

        mutated_problems = _problems(target.read_text(encoding="utf-8"), target.name)
        assert mutated_problems, (
            "removing the pin did NOT turn the walk red -- the rail cannot fail "
            "(lesson_gate_that_cannot_fail)")
    finally:
        target.write_bytes(original)

    restored = target.read_bytes()
    assert restored == original, "restore did not reproduce the captured bytes byte-for-byte"
    assert hashlib.sha256(restored).hexdigest() == original_sha, "restored bytes' sha disagrees"
    assert _problems(restored.decode("utf-8"), target.name) == [], (
        "the restored file is not clean -- the restore itself is suspect")


# ─── spot-proof: a PINNED tool actually resolves conftest + arms the tripwire ──────────────

_IMPORT_DRIVER = r'''
import json, os, runpy, sqlite3, sys
tool, repo = sys.argv[1], sys.argv[2]
sys.path.append(repo)
out = {"conftest_before": "conftest" in sys.modules}
runpy.run_path(tool, run_name="uct_tool_spotcheck")   # module body only; no __main__ guard fires
ct = sys.modules.get("conftest")
out["conftest_loaded"] = ct is not None
out["armed"] = bool(getattr(sqlite3.connect, "_uct_guarded", False))
out["auth_db_env"] = os.environ.get("AUTH_DB_PATH")
if ct is not None:
    out["mode"] = ct._GUARD_MODE
    out["roots"] = list(ct.SHARED_DATA_ROOTS)
    out["pins"] = {k: os.environ.get(k) for k in ct.SHARED_DATA_ENV_PINS}
    out["isolated_auth_db"] = ct.ISOLATED_AUTH_DB
sys.stdout.write("\nSPOTCHECK " + json.dumps(out) + "\n")
'''


def _clean_env(tmp_home: Path) -> dict:
    """The parent's environment minus every census pin -- under pytest the parent has ALREADY
    pinned all of them, and a child inherits them, which would look pinned whether or not the
    tool's own `import conftest` did anything."""
    import conftest as rootconf  # the repo-root one pytest already loaded
    strip = set(rootconf.SHARED_DATA_ENV_PINS) | {"AUTH_DB_PATH"}
    env = {k: v for k, v in os.environ.items() if k not in strip}
    env["UCT_TEST_SHARED_ROOT_GUARD"] = "report"   # audit mode: record, never raise, never write
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(TMP=str(tmp_home), TEMP=str(tmp_home), TMPDIR=str(tmp_home))
    return env


def _spotcheck(tool_name: str, tmp_path: Path) -> dict:
    home = tmp_path / tool_name.replace(".py", "")
    home.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [sys.executable, "-c", _IMPORT_DRIVER, str(TOOLS / tool_name), str(REPO)],
        capture_output=True, text=True, encoding="utf-8", env=_clean_env(home), cwd=str(home),
        timeout=120,
    )
    assert r.returncode == 0, f"{tool_name}: driver exit {r.returncode}\nstdout:\n{r.stdout}\nstderr:\n{r.stderr}"
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("SPOTCHECK ")]
    assert lines, f"{tool_name}: the driver printed no SPOTCHECK line -- it did not run\nstderr:\n{r.stderr}"
    return json.loads(lines[-1][len("SPOTCHECK "):])


def _under_shared_root(path: str, roots: list[str]) -> bool:
    p = os.path.normcase(os.path.abspath(path))
    return any(p == r or p.startswith(r + os.sep) for r in roots)


def test_SPOTCHECK_three_pinned_tools_actually_pin_and_arm_from_a_clean_process(tmp_path):
    """Item 4: import-check three real PINNED tools in a CLEAN subprocess (every census pin
    stripped, `UCT_TEST_SHARED_ROOT_GUARD=report` so nothing can ever raise or write for real)
    and prove `import conftest` in the tool itself -- not pytest's own conftest, which this
    process never inherits -- pinned every var away from `C:\\data` and armed the tripwire.
    Module body only (`runpy.run_path` with a non-`__main__` run_name), so no tool's `main()`
    or its network/DB calls ever execute; nothing here can reach production or write anything
    real.

    ⚠️ Three tools are deliberately NOT picked here: `wave4_fts_benchmark.py`,
    `wave4_date_range_index_benchmark.py` and `wave4_search_correctness_matrix.py` each call
    `notebook_sandbox_guard.require_sandboxed_env()`, which installs `audit_shared_root_probe`'s
    OWN separate sqlite3/open wrapper on top of the census's -- a genuine second layer of
    protection, but it replaces `sqlite3.connect` again afterward, so the specific
    `_uct_guarded` marker this check looks for is no longer the live one. That is a property of
    this test's assertion, not a gap in their pin (`test_every_tools_api_importer_pins_the_
    census_or_is_named_exempt` already covers their `import conftest` ordering)."""
    for tool_name in ("ai_door_census.py", "record_clock_parity.py", "vendor_truth.py"):
        out = _spotcheck(tool_name, tmp_path)
        assert out["conftest_before"] is False, f"{tool_name}: conftest leaked in from the parent"
        assert out["conftest_loaded"] is True, f"{tool_name}: it never imported the repo-root conftest"
        assert out["mode"] == "report"
        assert out["armed"] is True, f"{tool_name}: sqlite3.connect is not the tripwire's wrapper"
        roots = [os.path.normcase(r) for r in out["roots"]]
        assert roots, f"{tool_name}: the child's conftest names no shared root"

        unset = sorted(k for k, v in out["pins"].items() if not v)
        assert not unset, f"{tool_name}: census pins left unset: {unset}"
        inside = sorted(k for k, v in out["pins"].items() if _under_shared_root(v, roots))
        assert not inside, f"{tool_name}: census pins still pointing INSIDE the shared root: {inside}"
        assert out["pins"], f"{tool_name}: the census produced no pins at all"
        assert out["auth_db_env"] == out["isolated_auth_db"], (
            f"{tool_name}: AUTH_DB_PATH ({out['auth_db_env']!r}) is not the isolated sandbox "
            f"({out['isolated_auth_db']!r}) -- a bare run of this tool would still reach C:\\data")
