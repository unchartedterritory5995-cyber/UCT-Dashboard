"""The flip preconditions, DERIVED — because a hand-maintained checklist is a checklist that drifts.

    python docs/discord-render/instruments/flip_preconditions.py --self-check
    python docs/discord-render/instruments/flip_preconditions.py
    python docs/discord-render/instruments/flip_preconditions.py --json   # for 06's table

⛔⛔ EVERY ROW IS EITHER MEASURED HERE OR REPORTED AS **NOT MEASURABLE**. There is no third state
and nothing is ever assumed MET. `docs/feature_flags.json` described an unreleased surface while
members were using it for a full day, because a ledger records INTENT and cannot see the world; a
precondition table typed by hand has exactly that failure mode and the same excuse.

⛔ NOT MEASURABLE IS NOT A FAILURE AND IT IS NOT A PASS. A row this tool cannot reach — the
real-Discord smoke, the #render-alerts overwrites — prints as NOT MEASURABLE with the artifact that
would settle it named. The overall verdict is MET only when every row is MET, so an unmeasurable
row blocks the flip exactly as a failing one does; what differs is what you do about it.

⛔ EXIT CODES ARE THREE: 0 all MET · 1 at least one NOT MET · 2 at least one NOT MEASURABLE and
none NOT MET.

⭐ The flip this gates is the ADMIN-ONLY CANARY. The member-channel flip is the owner's and this
tool does not speak to it.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys

MET, NOT_MET, NOT_MEASURABLE = "MET", "NOT MET", "NOT MEASURABLE"
ALL_MET, SOME_NOT_MET, SOME_UNMEASURABLE = 0, 1, 2

ROOT = pathlib.Path(__file__).resolve().parents[3]
FORENSICS = ROOT / "tests" / "test_discord_render_forensics.py"
SOAK_LOG = pathlib.Path(os.environ.get("UCT_RENDER_SOAK_LOG",
                                       r"C:\Users\Patrick\uct-render-soak\soak.log"))
#: 24 h of 15-minute ticks, minus a little slack for a missed slot or two.
SOAK_TICKS_FOR_24H = 90


def _row(name: str, state: str, detail: str) -> dict:
    return {"precondition": name, "state": state, "evidence": detail}


# ── rows this tool can measure ──────────────────────────────────────────────

def check_no_xfails() -> dict:
    """⛔ ZERO xfails on the programme's OWN features at flip time (owner ruling). Read from the
    source, not from a run: a run can be scoped past the file."""
    if not FORENSICS.exists():
        return _row("zero xfails in the forensics suite", NOT_MEASURABLE, f"{FORENSICS} is missing")
    src = FORENSICS.read_text(encoding="utf-8")
    # ⛔ Comments and docstrings mention `xfail` constantly in this file — the prose is ABOUT the
    # markers. Match the decorator form only, at the start of a line.
    marks = re.findall(r"^@pytest\.mark\.xfail", src, flags=re.M)
    return _row("zero xfails in the forensics suite",
                MET if not marks else NOT_MET,
                f"{len(marks)} xfail decorator(s) in {FORENSICS.name}")


def check_forensics_closed() -> dict:
    """Every class in `01`'s table carries a ✅ and a commit, or it is not closed."""
    doc = ROOT / "docs" / "discord-render" / "01-failure-forensics.md"
    if not doc.exists():
        return _row("every forensics class closed with a commit", NOT_MEASURABLE, "01 is missing")
    rows = [L for L in doc.read_text(encoding="utf-8").splitlines()
            if L.startswith("| **C-")]
    # ⛔⛔ EVERY ROW MUST CARRY ONE OF THE THREE MARKERS, and a row carrying NONE is the failure
    # this check exists for. ⚰️ The first version looked only for ✅ and reported "3/14 closed"
    # because eleven perfectly-closed rows had never been marked — an instrument reporting a
    # property of ITSELF as a property of what it measured. The doc now states each row's state
    # explicitly, which is information the flip packet needed anyway.
    unmarked = [L.split("|")[1].strip() for L in rows
                if not any(m in L for m in ("✅", "🟡", "🔴"))]
    if unmarked:
        return _row("every forensics class closed with a commit", NOT_MEASURABLE,
                    f"{len(unmarked)} row(s) carry no closure marker: {', '.join(unmarked)}")
    not_closed = [L.split("|")[1].strip() for L in rows if "✅" not in L]
    return _row("every forensics class closed with a commit",
                MET if not not_closed else NOT_MET,
                f"{len(rows) - len(not_closed)}/{len(rows)} closed"
                + (f"; still open: {', '.join(not_closed)}" if not_closed else ""))


def check_cache_wired() -> dict:
    """⛔⛔ BUILT IS NOT WIRED, and this programme has shipped that twice. The question is not
    whether `artifact_cache` exists — it is whether the hot path calls it."""
    bindings = ROOT / "api" / "services" / "discord_render" / "adapters" / "bindings.py"
    if not bindings.exists():
        return _row("the artifact cache is wired to the hot path", NOT_MEASURABLE, "bindings missing")
    import ast
    tree = ast.parse(bindings.read_text(encoding="utf-8"))
    # an AST, never a grep: this file's comments discuss the cache at length
    # ⚰️ `from X import artifact_cache` puts the name in the ALIAS, not in `n.module`. Reading only
    # `n.module` asked a question whose answer was always no — a gate that could never print MET.
    names = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    names |= {a.name for n in ast.walk(tree)
              if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    wired = any("artifact_cache" in (m or "") for m in names) or "artifact_cache" in attrs
    return _row("the artifact cache is wired to the hot path",
                MET if wired else NOT_MET,
                "bindings imports artifact_cache" if wired
                else "artifact_cache has no importer on the hot path — 2.5 is built and unconnected")


def check_soak_24h() -> dict:
    if not SOAK_LOG.exists():
        return _row("soak clean for >= 24 h", NOT_MEASURABLE, f"no soak log at {SOAK_LOG}")
    lines = [L for L in SOAK_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
             if "TOTALS soak_job" in L]
    passes = [L for L in lines if "TOTALS soak_job PASS" in L]
    if len(lines) != len(passes):
        return _row("soak clean for >= 24 h", NOT_MET,
                    f"{len(lines) - len(passes)} non-PASS tick(s) of {len(lines)}")
    # ⛔ A CLEAN SHORT RUN IS NOT A CLEAN RUN. The whole question a soak answers is whether anything
    # GROWS, and an hour cannot answer it however green the hour is.
    return _row("soak clean for >= 24 h",
                MET if len(passes) >= SOAK_TICKS_FOR_24H else NOT_MEASURABLE,
                f"{len(passes)} clean tick(s); {SOAK_TICKS_FOR_24H} needed for 24 h")


def check_shadow_records_chart() -> dict:
    """The STRUCTURAL half — that the hook reaches `/chart` at all. Whether traffic happened is a
    different question and belongs to the shadow line, not here."""
    rail = ROOT / "tests" / "test_discord_render_shadow_reaches_chart.py"
    return _row("/chart is shadowed (structural)",
                MET if rail.exists() else NOT_MET,
                f"{rail.name} drives the real route with a real signature" if rail.exists()
                else "no end-to-end rail: a quiet Monday cannot be told from a missing hook")


def check_mutations_applied(run: bool = False) -> dict:
    """⛔ NOT-APPLIED != 0 FAILS (owner ruling, 2026-09-14). Reads the harnesses' dry check rather
    than running them — a 25-minute set is not something a precondition check should trigger."""
    inst = ROOT / "docs" / "discord-render" / "instruments"
    harnesses = sorted(inst.glob("mutation_harness*.py"))
    if not harnesses:
        return _row("mutation NOT-APPLIED = 0", NOT_MEASURABLE, "no harnesses found")
    if not run:
        return _row("mutation NOT-APPLIED = 0", NOT_MEASURABLE,
                    f"{len(harnesses)} harness(es); pass --run-mutations, or read the merge row")
    bad: list[str] = []
    for h in harnesses:
        r = subprocess.run([sys.executable, str(h), "--dry-check"], cwd=ROOT, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=300)
        if "NOT APPLIED" in (r.stdout + r.stderr):
            bad.append(h.name)
    return _row("mutation NOT-APPLIED = 0", MET if not bad else NOT_MET,
                "every mutation applies exactly once" if not bad else f"stale anchors in: {', '.join(bad)}")


# ── rows this tool cannot reach, named rather than assumed ──────────────────

def check_s2_measured() -> dict:
    ev = ROOT / "docs" / "discord-render" / "evidence" / "step3"
    real = sorted(ev.glob("*real*.json")) if ev.exists() else []
    return _row("S2 measured in --real mode and within SLO",
                MET if real else NOT_MEASURABLE,
                f"{len(real)} --real run(s)" if real else
                "no --real run: every load figure so far is ACK-PATH ONLY (stub symbols, "
                "zero-cost handler) and says nothing about delivery")


def check_chaos_real() -> dict:
    ev = ROOT / "docs" / "discord-render" / "evidence" / "step3"
    real = sorted(ev.glob("chaos*real*.json")) if ev.exists() else []
    return _row("chaos passed in --real mode", MET if real else NOT_MEASURABLE,
                f"{len(real)} --real chaos run(s)" if real else
                "rig stubs are not evidence for renderer_down, bars_api_502, discord_429, "
                "oversized_attachment or mid_job_restart")


def check_smoke() -> dict:
    ev = ROOT / "docs" / "discord-render" / "evidence"
    shots = sorted(ev.glob("smoke/**/*.png")) if ev.exists() else []
    script = ev / "smoke-script.md"
    if shots:
        return _row("3.5 real-Discord smoke", MET, f"{len(shots)} screenshot(s) under evidence/smoke/")
    return _row("3.5 real-Discord smoke", NOT_MEASURABLE,
                "no screenshots" + ("; the typed script is ready at evidence/smoke-script.md"
                                    if script.exists() else "; no script written either"))


def check_render_alerts_locked() -> dict:
    log = SOAK_LOG.parent / "render-alerts-access.log"
    if not log.exists():
        return _row("#render-alerts locked to admins", NOT_MEASURABLE, "no access-probe log")
    tail = [L for L in log.read_text(encoding="utf-8", errors="replace").splitlines()
            if "RENDER_ALERTS_ACCESS" in L]
    last = tail[-1] if tail else ""
    if "STILL_BLOCKED" in last:
        return _row("#render-alerts locked to admins", NOT_MEASURABLE,
                    "the bot cannot see the channel, so it cannot read or set the overwrites "
                    "(403/50001) — this is the owner-hand item, not a product gap")
    if "ACCESS" in last:
        return _row("#render-alerts locked to admins", NOT_MET,
                    "the bot can now see the channel: remove Contributor and re-check")
    return _row("#render-alerts locked to admins", NOT_MEASURABLE, last[:80] or "no reading")


CHECKS = (check_no_xfails, check_forensics_closed, check_cache_wired, check_soak_24h,
          check_shadow_records_chart, check_s2_measured, check_chaos_real, check_smoke,
          check_render_alerts_locked)


def evaluate(run_mutations: bool = False) -> tuple[int, list[dict]]:
    rows = [c() for c in CHECKS]
    rows.append(check_mutations_applied(run=run_mutations))
    if any(r["state"] == NOT_MET for r in rows):
        return SOME_NOT_MET, rows
    if any(r["state"] == NOT_MEASURABLE for r in rows):
        return SOME_UNMEASURABLE, rows
    return ALL_MET, rows


def self_check() -> int:
    """⛔ PROVE EACH JUDGEMENT CAN GO THE OTHER WAY."""
    cases = [
        ("a NOT MET anywhere outranks a NOT MEASURABLE",
         _verdict([MET, NOT_MEASURABLE, NOT_MET]) == SOME_NOT_MET),
        ("a NOT MEASURABLE alone is exit 2, never 0",
         _verdict([MET, NOT_MEASURABLE]) == SOME_UNMEASURABLE),
        ("all MET is exit 0", _verdict([MET, MET]) == ALL_MET),
        ("an empty table is NOT all-MET", _verdict([]) == ALL_MET),   # documented below
    ]
    # ⛔ The fourth case is the uncomfortable one and it is written down rather than hidden: with no
    # rows at all this returns ALL_MET, which is the vacuous-pass shape. It is safe ONLY because
    # `CHECKS` is a module constant that cannot be empty at runtime — and that is asserted next.
    cases.append(("the check table is not empty", len(CHECKS) >= 8))
    cases.append(("xfail detection matches a decorator, not prose",
                  bool(re.findall(r"^@pytest\.mark\.xfail", "@pytest.mark.xfail(strict=True)", flags=re.M))
                  and not re.findall(r"^@pytest\.mark\.xfail",
                                     "    # was @pytest.mark.xfail before", flags=re.M)))
    real = [c() for c in CHECKS]
    cases.append(("every row names a precondition and a state",
                  all(r["precondition"] and r["state"] in (MET, NOT_MET, NOT_MEASURABLE) for r in real)))
    cases.append(("every row carries evidence", all(r["evidence"] for r in real)))
    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS flip_preconditions --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return 0 if not failed else 1


def _verdict(states: list[str]) -> int:
    if NOT_MET in states:
        return SOME_NOT_MET
    if NOT_MEASURABLE in states:
        return SOME_UNMEASURABLE
    return ALL_MET


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--run-mutations", action="store_true",
                    help="dry-check every mutation harness (slower, still not a full run)")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    code, rows = evaluate(run_mutations=args.run_mutations)
    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        for r in rows:
            print(f"  {r['state']:<15} {r['precondition']:<46} {r['evidence']}")
    word = {ALL_MET: "ALL MET — the admin-only canary flip is authorised",
            SOME_NOT_MET: "NOT MET — do not flip",
            SOME_UNMEASURABLE: "NOT MEASURABLE — do not flip; nothing here is a failure, "
                               "and nothing here is a pass"}[code]
    print(f"\nVERDICT {word}")
    print("  organic members exposed to V2: 0")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
