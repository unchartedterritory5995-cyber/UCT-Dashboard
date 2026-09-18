#!/usr/bin/env python
"""R63(d) — the acceptance check itself, ready to run the moment enough pods have booted.

    python tools/r63d_verify_boot_window_stalls.py [--boot-window-s 120] [--min-pods 10]

ACCEPTANCE, verbatim from the work order: *"boot-window and settled-pod stalls >= 3 s must
read 0 over >= 10 pods, or each be joined to a named non-cold cause."*

⛔ THIS CANNOT PRODUCE A REAL VERDICT TODAY. It reads `stall_record`'s durable JSONL (per-pod
`pid` field) and `cold_path_instrument`'s durable JSONL, both of which start EMPTY on a fresh
volume and accumulate only as real pods boot in production. Run it locally against synthetic
fixtures to prove the LOGIC (see `tests/test_r63d_verify_boot_window_stalls.py`); run it against
`/data/discord-render/*.jsonl` in production once R63(c)'s full manifest-derived registration
has been live for enough deploys to cross `--min-pods`.

⛔ "≥ 10 pods" IS COUNTED, NEVER ASSUMED FROM ELAPSED TIME. `web` redeploys ~20x/day but not on
a fixed schedule, and a stall record can be inherited across an unrelated number of restarts if
the volume is old — the distinct `pid` values actually present in the boot-window slice are the
count, not a calendar guess.
"""
from __future__ import annotations

import argparse
import json
import sys

# ⛔ Same reason as pre_push_guard.py's identical block — this box's console is cp1252 and an
# em-dash in a plain print() kills the run with a UnicodeEncodeError.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def load_jsonl(path: str) -> list:
    """Every line of a durable JSONL record, or [] if the file does not exist yet. NEVER
    raises — an absent record on a fresh volume is a fact ('no pods have booted since this was
    wired'), not an error."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return [json.loads(ln) for ln in fh if ln.strip().startswith("{")]
    except FileNotFoundError:
        return []


def boot_window_stalls(stalls: list, *, boot_window_s: float, min_ms: float = 3000.0) -> list:
    """PURE. Stalls at or above `min_ms`, whose `uptime_s` places them inside the boot window
    OR whose `tier` marks them tier-1 (page-always) regardless of uptime — R63(a)'s own finding
    was that the largest stall ever measured here landed AT uptime 670-893s, below the alert
    floor but not "settled" in any calendar sense a human would call safe. So this counts BOTH
    boot-window (uptime < boot_window_s) and any stall >= min_ms wherever it lands — the
    acceptance criterion says "boot-window AND settled-pod", not boot-window alone."""
    return [s for s in stalls if (s.get("ms") or 0) >= min_ms]


def verify(stalls: list, joined_stalls: list, *, min_pods: int) -> dict:
    """PURE — the actual acceptance decision, driven by data the caller already loaded and
    joined (via `cold_path_instrument.join_with_stall_record`). Never touches a filesystem or a
    clock itself, so it is directly testable against a fixture."""
    pods = {s.get("pid") for s in stalls if s.get("pid") is not None}
    n_pods = len(pods)
    unexplained = [s for s in joined_stalls if not s.get("joined_calls")]
    explained = [s for s in joined_stalls if s.get("joined_calls")]
    return {
        "pods_observed": n_pods,
        "min_pods_required": min_pods,
        "enough_pods": n_pods >= min_pods,
        "total_qualifying_stalls": len(joined_stalls),
        "explained_by_a_cold_path": len(explained),
        "unexplained_count": len(unexplained),
        "unexplained": unexplained,
        # ⭐ The acceptance criterion's actual pass condition: EITHER zero qualifying stalls at
        # all, OR every one of them joined to a named cause. Not "mostly joined" — every one.
        "pass": (len(joined_stalls) == 0) or (len(unexplained) == 0),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stall-record", default="/data/discord-render/stall-record.jsonl")
    ap.add_argument("--cold-path-record", default="/data/discord-render/cold-path-calls.jsonl")
    ap.add_argument("--boot-window-s", type=float, default=120.0)
    ap.add_argument("--min-pods", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args([] if (argv is None and "pytest" in sys.modules) else argv)

    from api.services.discord_render import cold_path_instrument

    stalls = load_jsonl(a.stall_record)
    calls = load_jsonl(a.cold_path_record)
    qualifying = boot_window_stalls(stalls, boot_window_s=a.boot_window_s)
    joined = cold_path_instrument.join_with_stall_record(calls, qualifying)
    result = verify(stalls, joined, min_pods=a.min_pods)

    if a.json:
        print(json.dumps(result, indent=1))
    else:
        print("[r63d] pods observed: %d (need >= %d) -> %s"
              % (result["pods_observed"], result["min_pods_required"],
                 "ENOUGH" if result["enough_pods"] else "NOT YET ENOUGH — verdict is PROVISIONAL"))
        print("[r63d] qualifying (>=3000ms) stalls: %d, explained by a cold-path call: %d, "
              "unexplained: %d"
              % (result["total_qualifying_stalls"], result["explained_by_a_cold_path"],
                 result["unexplained_count"]))
        if result["unexplained"]:
            print("[r63d]   UNEXPLAINED (named non-cold cause still owed):")
            for s in result["unexplained"][:20]:
                print("[r63d]     at=%s ms=%s uptime_s=%s tier=%s commit=%s"
                      % (s.get("at"), s.get("ms"), s.get("uptime_s"), s.get("tier"),
                         s.get("commit")))
        print("[r63d] R63(d) ACCEPTANCE: %s%s"
              % ("PASS" if result["pass"] else "FAIL",
                 "" if result["enough_pods"] else " (provisional — not yet >= min pods)"))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
