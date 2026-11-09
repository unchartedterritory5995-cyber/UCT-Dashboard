#!/usr/bin/env python
"""THE FLOW-READ GATE. One command for "do we still read the tape right?"

    python tools/flow_read_gate.py              # exit 0 pass / 1 failure / 2 could-not-ask
    python tools/flow_read_gate.py --list       # print the manifest, run nothing
    python tools/flow_read_gate.py --backend    # skip the frontend lane
    python tools/flow_read_gate.py --json

⚰️ WHY THIS EXISTS. On 2026-11-08 `tests/test_flow_classification.py::test_cream_meta_key`
was found RED against production code, and had been red since 2026-09-15 -- 54 days. The
router was right; the TEST was stale, left behind by 6b606990c4 (the fix that stopped the
Top Flow card's contract key from failing open and silently disabling its own weekly and
block-only filters). Nothing caught it because:

  1. NO RUNNER IN THIS REPO NAMED THE FILE. `grep -rn test_flow_classification tools/
     scripts/ .github/` returned nothing. The 924-line file holding the MU 835C, AMAT,
     PPTA and IREN classification cases was never executed by anything.
  2. An unscoped `pytest` cannot be the fallback: it reaches ~11,854 MB RSS on this box
     (CLAUDE.md, 2026-09-12) and gets OOM-killed, so "just run everything" is not an
     option anyone takes twice.

A regression corpus that nothing runs is not a corpus. This gate names the files.

⛔ SCOPED BY NAMED FILE, IN BOUNDED BATCHES, ON PURPOSE. Each batch is its own subprocess
so RSS is released between them. Do not "simplify" this into one pytest invocation over
`tests/` -- that is precisely the thing that OOMs.

⛔ EXIT 2 IS NOT A PASS. "Could not be asked" and "asked and came back clean" are
different facts and must never share an exit code (the rule
`flow_worker_watch_coverage.py` already carries). A batch whose module cannot even be
IMPORTED here -- `tests/test_oi17_auth_gate.py` pulls `api.main`, which pulls
`linkify_it`, which is pinned at requirements.txt:65 but is NOT installed on this box,
blocking collection for 236 test files -- is reported BLOCKED and exits 2. Never green.

⛔ NEVER READ THIS RUNNER THROUGH A PIPE. `python tools/flow_read_gate.py | tail` returns
tail's exit code, not the gate's. Redirect to a file and echo the code.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# THE MANIFEST. Every file here was run and green on 2026-11-08 unless marked.
# Grouped by WHICH SURFACE a regression would reach, because the three surfaces
# share only two modules, and a wrong shared prior is wrong on all three at once.
# ---------------------------------------------------------------------------
BATCHES: list[tuple[str, str, list[str]]] = [
    ("ingest_aggregate", "WS ingest -> RawTrade -> TradeAggregator -> flow.db", [
        "tests/test_massive_processor_f3.py",
        "tests/test_cancel_conditions.py",
        "tests/test_massive_ws_worker_qpool.py",
        "tests/test_massive_ws_stop.py",
        "tests/test_flow_heal_side.py",
        "tests/test_flow_heal_enrich.py",
    ]),
    ("classification", "type_ priority, ML gate, tiers, curated qualification", [
        "tests/test_flow_classification.py",
        "tests/test_aggregate_side_gate.py",
        "tests/test_flow_single_ticker_floors.py",
        "tests/test_massive_r69_contract_scoped_enrichment.py",
        "tests/test_bullflow_is_retired.py",
        "tests/test_ticker_types_generation.py",
    ]),
    ("discord_push", "should_auto_push, cream ranking, card webhooks", [
        "tests/test_push_quality_gates.py",
        "tests/test_cream_rank_side.py",
        "tests/test_cream_selection_audit_1009.py",
        "tests/test_cream_card_webhook.py",
        "tests/test_alpha_gold_eod_mixed_gate.py",
        "tests/test_alert_destination.py",
        "tests/test_optionsflow_etf_push.py",
        "tests/test_discord_render_symbols.py",
        "tests/test_term011_step5_flow_watched_posters.py",
    ]),
    ("live_massive", "the curated feed surface and its self-heal", [
        "tests/test_massive_curated_stream.py",
        "tests/test_liveflow_side_recovery.py",
        "tests/test_liveflow_rehydrate.py",
        "tests/test_liveflow_selfheal_lease.py",
        "tests/test_live_massive_dst.py",
        "tests/test_live_massive_cache_invalidation.py",
        "tests/test_live_chain_stream.py",
        "tests/test_live_recent_snapshot.py",
        "tests/test_recent_selfheal.py",
    ]),
    ("page_product", "the OptionsFlow page's server-side product and its caches", [
        "tests/test_flow_aggregate.py",
        "tests/test_flow_card_parity_audit.py",
        "tests/test_flow_board_endpoint.py",
        "tests/test_flow_day_counts.py",
        "tests/test_flow_explain.py",
        "tests/test_flow_freshness_header.py",
        "tests/test_flow_meta_cold_cache_freeze.py",
        "tests/test_optionsflow_etf_replica.py",
        "tests/test_null_chunk_direction.py",
        "tests/test_flow_tape_spool.py",
        "tests/test_ticker_flow_gil_convoy.py",
    ]),
    ("deploy_reach", "does a fix to any of the above actually reach the tape, "
                     "and does this gate still cover the corpus", [
        # ⭐ The gate runs its OWN rail. Without this the manifest is the one artifact in
        # the flow-read path that nothing checks -- the exact shape of the 54-day bug.
        "tests/test_flow_read_gate_manifest.py",
        "tests/test_flow_worker_watch_coverage.py",
        "tests/test_flow_auth_surface.py",
        "tests/test_flow_proxy_auth.py",
        "tests/test_oi44_loop_blockers_gate.py",
    ]),
]

# The frontend half of the read: flowCompute IS the page's classifier.
FRONTEND = [
    "src/pages/optionsFlow/wiring.guard.test.js",
    "src/pages/optionsFlow/flowCompute.test.js",
    "src/pages/optionsFlow/flowParts.test.js",
    "src/pages/optionsFlow/flowGridSort.seedParity.test.js",
]

# Comparators must prove they can still FIRE. A comparator that cannot fail is not a
# comparator, so its own self-check is part of the gate.
SELF_CHECKS = [("flow_card_parity", ["tools/flow_card_parity_audit.py", "--self-check"])]

# Cannot be COLLECTED on a box missing a pinned dep. Reported BLOCKED -> exit 2.
BLOCKED: dict[str, str] = {
    "tests/test_oi17_auth_gate.py":
        "imports api.main -> linkify_it (requirements.txt:65) not installed here",
}

# Imports a read-path module but is deliberately NOT a flow-read assertion.
# ⛔ A reason string is mandatory. `tests/test_flow_read_gate_manifest.py` fails BY NAME
# on any read-path test file that is in neither BATCHES, BLOCKED, nor here -- so a new
# test cannot quietly land outside the gate, which is exactly how the 54 days happened.
EXCLUDED: dict[str, str] = {
    "tests/test_massive_guard_census.py":
        "provider-abstraction ratchet, not a flow-read assertion. RED ON MASTER "
        "2026-11-08: 3 unexempted api.massive.com literals (live_massive_router.py "
        ":6111 and :6272, services/options_universe_log.py:47). Tracked separately.",
    "tests/test_vendor_callsite_census.py":
        "vendor call-site ratchet. RED ON MASTER 2026-11-08: 9 new call sites outside "
        "their adapters against a 0 baseline. Tracked separately.",
    "tests/test_no_shadowed_definitions.py": "repo-wide AST rail over every module",
    "tests/test_d3_realtime_topology_rail.py": "repo-wide vendor-socket rail",
    "tests/test_schwab_partner_fixes.py": "Schwab fallback, not the Massive read path",
    "tests/test_dashboard_warm.py":
        "boot/warm path; imports the router but asserts nothing about the read",
    "tests/test_breadth_series_boot_warm.py": "boot/warm path, breadth not flow",
    "tests/test_screener_meta_warm.py": "boot/warm path, screener not flow",
    "tests/test_terminal_cold_start_warm.py": "boot/warm path, terminal not flow",
    "tests/test_ticker_history.py": "bars/history, not the options tape",
    "tests/test_wisdom_golden_tokens_shadow.py":
        "unrelated; matches on a module name sitting in a token list",
    "api/services/journal_two/test_symbol_normalize.py":
        "symbol normalization under journal_two",
}

READ_PATH_MODULES = ("live_massive_router", "massive_processor",
                     "massive_ws_worker", "flow_heal_enrich")


def manifest_files() -> list[str]:
    return [f for _, _, files in BATCHES for f in files]


def _log_dir() -> str:
    d = os.path.join(REPO, ".flow_read_gate")
    os.makedirs(d, exist_ok=True)
    return d


def _run(name: str, argv: list[str], cwd: str) -> dict:
    """One bounded subprocess. Output goes to a file; the EXIT CODE is read directly."""
    log = os.path.join(_log_dir(), "%s.log" % name)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    t0 = time.time()
    with open(log, "wb") as fh:
        code = subprocess.call(argv, cwd=cwd, stdout=fh,
                               stderr=subprocess.STDOUT, env=env)
    tail = ""
    try:
        with open(log, encoding="utf-8", errors="replace") as fh:
            lines = [ln.rstrip() for ln in fh if ln.strip()]
        tail = lines[-1] if lines else ""
    except OSError:
        pass
    return {"name": name, "exit": code, "secs": round(time.time() - t0, 1),
            "tail": tail, "log": log}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--backend", action="store_true", help="skip the frontend lane")
    ap.add_argument("--frontend", action="store_true", help="only the frontend lane")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.list:
        for key, why, files in BATCHES:
            print("%-18s %s" % (key, why))
            for f in files:
                print("    " + f)
        print("%-18s %s" % ("frontend", "flowCompute is the page's classifier"))
        for f in FRONTEND:
            print("    app/" + f)
        for nm, argv in SELF_CHECKS:
            print("%-18s %s" % ("selfcheck:" + nm, " ".join(argv)))
        print("\nBLOCKED (exit 2, never green):")
        for f, why in BLOCKED.items():
            print("    %s\n        %s" % (f, why))
        print("\nEXCLUDED (not a flow-read assertion):")
        for f, why in EXCLUDED.items():
            print("    %s\n        %s" % (f, why))
        return 0

    results: list[dict] = []
    could_not_ask: list[str] = []

    # A file named in the manifest but gone from disk is a MEASUREMENT FAILURE, not a
    # pass -- pytest would collect nothing for it and exit 0 on the rest.
    for f in manifest_files():
        if not os.path.exists(os.path.join(REPO, f)):
            could_not_ask.append("manifest names a file that is not on disk: " + f)

    if not a.frontend:
        for key, _why, files in BATCHES:
            results.append(_run(key, [sys.executable, "-m", "pytest", *files, "-q"], REPO))
        for nm, argv in SELF_CHECKS:
            results.append(_run("selfcheck_" + nm, [sys.executable, *argv], REPO))

    if not a.backend:
        app = os.path.join(REPO, "app")
        vitest = os.path.join(app, "node_modules", ".bin",
                              "vitest.cmd" if os.name == "nt" else "vitest")
        if not os.path.exists(vitest):
            could_not_ask.append("vitest not installed at app/node_modules/.bin "
                                 "(do NOT `npm ci` to fix this -- see CLAUDE.md)")
        else:
            results.append(_run("frontend", [vitest, "run", *FRONTEND], app))

    for f, why in BLOCKED.items():
        could_not_ask.append("BLOCKED %s -- %s" % (f, why))

    failed = [r for r in results if r["exit"] != 0]
    verdict = 1 if failed else (2 if could_not_ask else 0)

    if a.json:
        print(json.dumps({"verdict": verdict, "results": results,
                          "could_not_ask": could_not_ask}, indent=2))
        return verdict

    print("FLOW-READ GATE")
    for r in results:
        print("  %-26s %-4s %6ss  %s" % (
            r["name"], "PASS" if not r["exit"] else "FAIL", r["secs"], r["tail"][:88]))
    if could_not_ask:
        print("\n  COULD NOT BE ASKED (this is exit 2, NOT a pass):")
        for m in could_not_ask:
            print("    - " + m)
    print("\n  logs: %s" % _log_dir())
    print("  VERDICT: %s" % {0: "0 clean", 1: "1 FAILURE", 2: "2 could-not-ask"}[verdict])
    return verdict


if __name__ == "__main__":
    sys.exit(main())
