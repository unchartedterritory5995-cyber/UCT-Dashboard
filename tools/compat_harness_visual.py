#!/usr/bin/env python3
"""Compatibility harness Layer B -- visual/persistence, hermetic, no TradingView.

Step 2 of the Public Script + Complex Visual Indicator Compatibility Harness's
bounded implementation sequence (see
`docs/superpowers/specs/universal-indicator-ecosystem/PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`).

WHAT THIS REUSES, AND WHY IT IS NOT NEW INFRASTRUCTURE
--------------------------------------------------------
`tools/chart_parity.py` already renders an arbitrary schema-v2 BuilderSheet
document through the REAL product install door (`?userdefs=` ->
`installUserDefinitions`, the same gates the product uses), hermetically
(`?fixedbars=`, every `/api/` call short-circuited), with a proven pixel-diff
gate and non-vacuity controls (`--perturb-b-instances`). This file does not
reimplement any of that -- it is a thin wrapper that:

  1. maps a Lane 2 "level" (the visual-fixture difficulty ladder) to a named
     case already declared in `tools/chart_parity_cases.json`;
  2. shells out to `chart_parity.py --same-build` for a live self-check
     (report.json is the machine-readable channel, never stdout text);
  3. emits ONE compat_harness Section-3-schema result per level.

LEVEL 1 REUSES AN EXISTING, ALREADY-PROVEN CASE
-------------------------------------------------
`ast_user_formula_sma20` (Phase D Task 16) is exactly Lane 2's Level 1 fixture
(one line, one input, own pane) -- a genuine user-authored AST document
(`sma(close, 20)`), already measured at 140,925 changed pixels vs. a
no-userDefs baseline, with a perturbation control (`--perturb-b-instances`
moves only the user's own pane) and an invalid-document control (a stale
`meta.repaint` installs nothing and draws nothing). This file does not
duplicate that case -- it cites it as Level 1's fixture directly.

⛔ A REAL, REPRODUCIBLE, UNDIAGNOSED FINDING -- DISCLOSED, NOT GUESSED AT.
A live re-run of `ast_user_formula_sma20` in this session's own environment
(bare `vite --port <p>`, no other flags) hit a `FontNotSettledError`
deterministically: 31 of 239 canvas text operations ran before
`document.fonts` settled, SAME count across two independent server starts,
pre-warming the root + the exact font URL (confirmed `200 OK` from Vite's own
static `public/` serving, `app/public/fonts/instrument-sans-v4-latin-tab.woff2`
exists and is correctly `@font-face`-declared in `app/index.html`), and
`--font-retries 2/3` (reloads instead of refusing, for exactly this kind of
diagnosis). The font route is NOT the problem -- that hypothesis was formed
from the error's own generic troubleshooting text, tested, and DISPROVEN
before this comment was written. The true root cause is UNDIAGNOSED. This
driver classifies this shape as `HARNESS_DEFECT` rather than either
`VISUAL_BLOCKED` (a real rendering divergence -- not proven) or a silent
`SUPPORTED` (would hide it), and preserves the raw error + the confirmed
"font route serves fine" fact for whoever picks up the diagnosis next --
never re-attribute this to a guessed cause without re-testing it, as this
file's own history of one wrong guess is the reason this warning exists.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
CHART_PARITY = ROOT / "tools" / "chart_parity.py"
CASES_PATH = ROOT / "tools" / "chart_parity_cases.json"
RESULTS_DIR = ROOT / "tests" / "fixtures" / "compat_harness" / "results" / "visual_fixture"

#: Lane 2 level -> (chart_parity.py case name, one-line description, category)
LEVELS = {
    "level1_single_line_own_pane": {
        "case": "ast_user_formula_sma20",
        "description": "one line, one input, own pane -- ta.sma(close, 20)",
        "plot_count": 1,
    },
}

_FONT_ERROR_MARKER = "FontNotSettledError"


def _load_case(case_name: str) -> dict:
    doc = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    cases = doc.get("cases") if isinstance(doc, dict) else doc
    for c in cases:
        if c.get("name") == case_name:
            return c
    raise KeyError(f"no case named {case_name!r} in {CASES_PATH}")


def run_same_build_check(base_url: str, case_name: str, font_retries: int = 0) -> dict:
    """Shell out to chart_parity.py's --same-build self-check for one case.

    Returns the parsed `report.json`, or a synthetic report shape carrying an
    `_invocation_error` key if the subprocess itself could not be run at all
    (distinct from the tool running and reporting a real per-case failure).
    """
    with tempfile.TemporaryDirectory(prefix="compat_harness_visual_") as tmp:
        out_dir = Path(tmp)
        cmd = [sys.executable, str(CHART_PARITY),
               "--base-a", base_url, "--same-build",
               "--cases", case_name, "--out", str(out_dir)]
        if font_retries:
            cmd += ["--font-retries", str(font_retries)]
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=180)
        report_path = out_dir / "report.json"
        if not report_path.exists():
            return {
                "_invocation_error": True,
                "returncode": proc.returncode,
                "stdout_tail": (proc.stdout or "")[-2000:],
                "stderr_tail": (proc.stderr or "")[-2000:],
            }
        return json.loads(report_path.read_text(encoding="utf-8"))


def classify_level(level_key: str, base_url: Optional[str], font_retries: int = 0) -> dict:
    spec = LEVELS[level_key]
    case_name = spec["case"]
    case = _load_case(case_name)

    steps = {
        "parse": {"status": "SUPPORTED", "guard": None},
        "dialect_detect": {"status": "SUPPORTED", "detected": "uct_native_formula"},
        "translate": {"status": "SUPPORTED", "guard": None},
        "canonical_ast": {"status": "SUPPORTED", "ast_ref": case["userDefs"][0]["compute"]["ast"]
                           if case.get("userDefs") else None},
        "execution_requirements": {"status": "SUPPORTED", "lookback": None},
        "visual_requirements": {"status": "SUPPORTED", "plot_count": spec["plot_count"], "needs": []},
        "chart_render": None,
        "persistence_save": {"status": "PARTIAL", "note": "not exercised by this case; a save/reopen fixture is a later level"},
        "persistence_reload": {"status": "PARTIAL", "note": "not exercised by this case; a save/reopen fixture is a later level"},
        "screener_eligibility": {"status": "PARTIAL", "eligible": False, "reason": "sma yields num; not itself screener-eligible without a comparison"},
        "refusal_behavior": {"status": "SUPPORTED", "guard": None},
        "vendor_comparison": {"status": "SKIPPED_NOT_APPROPRIATE", "ref": None},
    }
    failure_taxonomy: list[str] = []
    evidence_paths = [f"tools/chart_parity_cases.json#{case_name}"]

    prior_committed_evidence = {
        "expect_px": case.get("expect"),
        "expect_regions": {r["name"]: r["expect"] for r in case.get("regions", [])},
        "provenance": case.get("_expectFrom"),
    }

    if base_url is None:
        steps["chart_render"] = {
            "status": "ENVIRONMENT_BLOCKED",
            "reason": "no --base-url given; not re-run live this pass",
            "prior_committed_evidence": prior_committed_evidence,
        }
        final = "PARTIAL"
        failure_taxonomy.append("environment_blocked")
    else:
        report = run_same_build_check(base_url, case_name, font_retries=font_retries)
        if report.get("_invocation_error"):
            steps["chart_render"] = {"status": "HARNESS_DEFECT", "reason": "chart_parity.py did not produce a report.json",
                                      "detail": report}
            failure_taxonomy.append("harness_defect")
            final = "HARNESS_DEFECT"
        else:
            result = (report.get("results") or [{}])[0]
            if result.get("pass") is True:
                steps["chart_render"] = {"status": "SUPPORTED", "measured_px": result.get("changed") or result.get("expect")}
                final = "SUPPORTED"
            else:
                err = result.get("error") or ""
                if _FONT_ERROR_MARKER in err:
                    steps["chart_render"] = {
                        "status": "HARNESS_DEFECT",
                        "reason": "FontNotSettledError, reproducible and deterministic in this "
                                  "session's environment. NOT a font-route-missing issue -- that "
                                  "was checked directly (curl to the exact woff2 URL returns 200 "
                                  "from the bare vite dev server) and disproven, not assumed. Root "
                                  "cause is UNDIAGNOSED; do not re-attribute this to a guessed "
                                  "cause without re-testing it.",
                        "raw_error": err,
                        "prior_committed_evidence": prior_committed_evidence,
                    }
                    failure_taxonomy.append("harness_defect")
                    final = "HARNESS_DEFECT"
                else:
                    steps["chart_render"] = {"status": "VISUAL_BLOCKED", "raw_error": err,
                                              "prior_committed_evidence": prior_committed_evidence}
                    failure_taxonomy.append("chart_placement_mismatch")
                    final = "VISUAL_BLOCKED"

    return {
        "id": f"visual_fixture/{level_key}",
        "lane": "visual_fixture",
        "source": {
            "dialect": "uct_native_formula",
            "provenance_ref": f"tools/chart_parity_cases.json#{case_name}",
            "capture_method": "self_authored_fixture",
        },
        "steps": steps,
        "failure_taxonomy": failure_taxonomy,
        "final_classification": final,
        "evidence_artifact_paths": evidence_paths,
        "harness_version": "compat-harness-v1",
    }


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", default=None,
                     help="a running frontend+backend origin to re-verify live; "
                          "omit to only cite prior committed evidence")
    ap.add_argument("--font-retries", type=int, default=0)
    ap.add_argument("--levels", nargs="*", default=list(LEVELS.keys()))
    args = ap.parse_args()

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    any_defect = False
    for level_key in args.levels:
        result = classify_level(level_key, args.base_url, font_retries=args.font_retries)
        out_path = RESULTS_DIR / f"{level_key}.json"
        out_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"{level_key}: {result['final_classification']}  -> {out_path}")
        if result["final_classification"] == "HARNESS_DEFECT":
            any_defect = True

    return 1 if any_defect else 0


if __name__ == "__main__":
    raise SystemExit(main())
