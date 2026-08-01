"""Signature indicator v1 rule constants + shared parsers.

Every tunable number for the three Signature indicators lives HERE so
owner tuning is a one-file diff. Versions bump when output-changing
logic changes (spec: compute.rev semantics).
"""

import math

DPL_WINDOW_DAYS = 20
DPL_BIN_PCT = 0.0025
DPL_MIN_CLUSTER_NOTIONAL = 10_000_000.0
DPL_TOP_K = 5

FCB_LOOKBACK = 20
# 1.5x, not the 1.25x this shipped as in the branch: the owner's call on
# 2026-08-01, pre-launch. Convention for a volume-confirmed breakout runs
# 1.25x-2.0x; 1.25 sat at the loose end and bought a fatter ledger at the cost
# of marginal arrows on the chart. 1.5 is the middle. It is still a judgement,
# not a measurement — there is no backtest behind any number in this file.
FCB_VOL_MULT = 1.5
FCB_MIN_CALL_PREM = 500_000.0
FCB_DOMINANCE = 1.75

GXW_DTE = "week"
GXW_MAX_DIST_PCT = 0.15
GXW_TTL_S = 600
GXW_MAX_AGE_S = 1800

# `fcb-v2` because FCB_VOL_MULT changed OUTPUT. The ledger's uniqueness key
# includes the version, so the bump is what keeps rows written under the old
# gate attributable to `fcb-v1` instead of silently being re-read as evidence
# for a rule that never produced them.
VERSIONS = {"dpl": "dpl-v1", "fcb": "fcb-v2", "gxw": "gxw-v1"}

_SUFFIX = {"K": 1e3, "M": 1e6, "B": 1e9}


def parse_money(raw) -> float:
    """Tolerant money parser for the flow table's TEXT columns.

    Handles "1500000", "$1.5M", "250K", "1,500,000", None/"" -> 0.0.

    Non-finite input is garbage and returns 0.0: NaN/inf floats, the strings
    "nan"/"inf" (float() accepts both), and values that overflow to inf
    (e.g. 10**400, "1e400"). A NaN premium must never reach a caller -- it
    would poison a sum and turn every downstream threshold comparison False,
    silently DELETING a cluster instead of failing loudly.

    Never raises.
    """
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        try:
            val = float(raw)
        except (ValueError, TypeError, OverflowError):
            return 0.0
        return val if math.isfinite(val) else 0.0
    try:
        s = str(raw).strip().upper().replace("$", "").replace(",", "")
        if not s:
            return 0.0
        mult = 1.0
        if s[-1] in _SUFFIX:
            mult = _SUFFIX[s[-1]]
            s = s[:-1]
        val = float(s) * mult
    except (ValueError, TypeError, OverflowError):
        return 0.0
    return val if math.isfinite(val) else 0.0
