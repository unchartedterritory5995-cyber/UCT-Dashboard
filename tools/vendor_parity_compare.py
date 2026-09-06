"""Vendor parity comparison — UCT's own interpreter vs. a real vendor observation.

⛔ THIS IS NOT DUAL-KERNEL CONFORMANCE. JS and Python already agreeing with
each other (1e-9 tolerance, `tools/ast_conformance.py`) is a separate,
already-existing, already-passing check and is never re-proven here. This
tool answers a different question: does UCT's OWN output (either lane —
they're already proven to agree) match what the REAL VENDOR RUNTIME actually
produced. Running the Python lane directly (`api/services/ast_interpret.py`)
is sufficient for that question; it is not a second, weaker check standing
in for dual-kernel conformance.

Reads an observation JSON (`tests/fixtures/vendor/observations/*.json`) whose
`market.bars` is the REAL series, `engine.ast` is the canonical AST for the
exact function under test, and `vendor.values` maps bar timestamp -> the REAL
value read off the vendor platform (per `provenance`).

⛔⛔ REFUSES an observation whose provenance names UCT itself as the source.
`_assert_real_vendor_source` checks `provenance.platform`/`provenance.who`
for forbidden tokens ("uct", "self", "synthetic-self", "our-own",
"interpret()") — this is the direct guard against the authorization's own
named failure mode: "UCT output was accidentally substituted for vendor
output."

⛔ WARM-UP ROWS ARE REPORTED, NEVER SILENTLY DROPPED, AND NEVER COUNTED
TOWARD THE VERDICT. A row with no vendor value (or no UCT value) is reported
as `DATA_BLOCKED`, not silently skipped out of the comparison denominator —
`tools/vendor_parity_compare_test.py` proves both halves of this
structurally, not just by inspection.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.services.ast_interpret import interpret  # noqa: E402


class VendorSourceRefused(Exception):
    """Raised when an observation's vendor values are not genuinely external."""


# ⛔ EVERY TOKEN HERE IS A DIRECT NAME FOR "THIS DIDN'T COME FROM THE REAL
# VENDOR" — a denylist, deliberately, unlike the interpreter's own closed
# table: the set of ways someone could mislabel a self-generated value as
# vendor truth is open-ended prose, not a closed vocabulary, so there is no
# analogous "everything not on this list is safe" argument to make here.
_FORBIDDEN_SOURCE_TOKENS = (
    "uct", "self", "synthetic-self", "our-own", "interpret()", "internal",
)


def _assert_real_vendor_source(observation: dict) -> None:
    provenance = observation.get("provenance") or {}
    platform = str(provenance.get("platform", "")).lower()
    who = str(provenance.get("who", "")).lower()
    for token in _FORBIDDEN_SOURCE_TOKENS:
        if token in platform or token in who:
            raise VendorSourceRefused(
                f"observation's provenance names a forbidden source token {token!r} — "
                "refusing to treat UCT's own output as vendor truth")
    if not platform:
        raise VendorSourceRefused(
            "observation carries no provenance.platform — cannot confirm this is a "
            "real external vendor observation")


def compare(observation: dict, warmup_bars: int, tolerance_rel: float = 1e-6) -> dict:
    """Compare UCT's interpreted column against `observation['vendor']['values']`.

    Returns {rows, warmup_bars, tolerance_rel, compared_non_warmup,
    max_abs_delta_non_warmup, any_data_blocked, disagreement_count, verdict}.

    `verdict` is one of: "VENDOR-PARITY VERIFIED" (≥1 non-warmup bar compared,
    zero disagreements), "PARTIAL" (≥1 compared but ≥1 disagreement), or
    "DATA BLOCKED" (zero non-warmup bars had both a UCT and a vendor value).
    """
    _assert_real_vendor_source(observation)

    bars = observation["market"]["bars"]
    ast = observation.get("engine", {}).get("ast")
    if ast is None:
        raise ValueError(
            "observation.engine.ast is null — no UCT implementation to compare against "
            "(this observation is VENDOR SEMANTICS CAPTURED, not parity-comparable yet)")
    vendor_values = observation["vendor"]["values"]

    column = interpret(ast, bars, opts={"tf": observation.get("market", {}).get("timeframe", "D")})

    rows: list[dict] = []
    compared_non_warmup = 0
    max_abs_delta_non_warmup = 0.0
    any_data_blocked = False

    for i, bar in enumerate(bars):
        t = str(bar["t"])
        is_warmup = i < warmup_bars
        uct_v = column[i] if i < len(column) else None
        vendor_v = vendor_values.get(t)
        row: dict[str, Any] = {
            "index": i, "t": t, "is_warmup": is_warmup,
            "uct_value": uct_v, "vendor_value": vendor_v,
        }
        uct_missing = uct_v is None or (isinstance(uct_v, float) and math.isnan(uct_v))
        if vendor_v is None or uct_missing:
            row["status"] = "DATA_BLOCKED"
            any_data_blocked = True
        else:
            delta = abs(float(uct_v) - float(vendor_v))
            denom = max(abs(float(vendor_v)), 1e-12)
            rel = delta / denom
            row["abs_delta"] = delta
            row["rel_delta"] = rel
            if is_warmup:
                # Reported, but a warm-up bar can never itself fail the verdict —
                # this is exactly the seed/alignment class of difference this
                # tranche's own readiness report exists to keep separate from a
                # real calculation defect.
                row["status"] = "WARMUP_DELTA" if rel > tolerance_rel else "AGREE"
            else:
                row["status"] = "AGREE" if rel <= tolerance_rel else "DISAGREE"
                compared_non_warmup += 1
                max_abs_delta_non_warmup = max(max_abs_delta_non_warmup, delta)
        rows.append(row)

    disagreements = [r for r in rows if r.get("status") == "DISAGREE"]
    if compared_non_warmup == 0:
        verdict = "DATA BLOCKED"
    elif disagreements:
        verdict = "PARTIAL"
    else:
        verdict = "VENDOR-PARITY VERIFIED"

    return {
        "rows": rows,
        "warmup_bars": warmup_bars,
        "tolerance_rel": tolerance_rel,
        "compared_non_warmup": compared_non_warmup,
        "max_abs_delta_non_warmup": max_abs_delta_non_warmup,
        "any_data_blocked": any_data_blocked,
        "disagreement_count": len(disagreements),
        "verdict": verdict,
    }


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("observation", help="path to an observation JSON")
    ap.add_argument("--warmup-bars", type=int, required=True,
                     help="number of leading bars this function's own warm-up covers")
    ap.add_argument("--tolerance-rel", type=float, default=1e-6)
    ap.add_argument("--out", help="write the full parity result JSON here")
    args = ap.parse_args(argv)

    observation = json.loads(Path(args.observation).read_text(encoding="utf-8"))
    result = compare(observation, args.warmup_bars, args.tolerance_rel)

    print(
        f"verdict: {result['verdict']}  "
        f"compared={result['compared_non_warmup']}  "
        f"disagreements={result['disagreement_count']}  "
        f"max_abs_delta={result['max_abs_delta_non_warmup']:.6g}  "
        f"data_blocked={result['any_data_blocked']}"
    )

    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"wrote {args.out}")

    return 0 if result["verdict"] == "VENDOR-PARITY VERIFIED" else 1


if __name__ == "__main__":
    sys.exit(main())
