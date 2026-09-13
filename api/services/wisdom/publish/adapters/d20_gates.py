"""D20 hard gates, checked in code (W1 D20; CONTRACTS §0 #13 and §6.6).

The owner's ruling: the level-reached alert and the "looks like what TSDR buys" list are
built today and enabled — even for admins — only after (a) CALL-REPLAY has a baseline with
n ≥ 100 calls and (b) the list has been scored SILENTLY against his stated calls for two
weeks. Both scorers therefore refuse to deliver unless ALL of these hold:
  1. its flag is on (WISDOM_LEVEL_ALERTS_ENABLED / WISDOM_LOOKALIKE_ENABLED),
  2. replay_baseline_n() >= BASELINE_N_MIN,
  3. silent scoring began >= SILENT_DAYS_MIN calendar days ago AND covered at least
     SILENT_SESSIONS_MIN sessions that actually scored something (a run that scored
     nothing is not silent scoring — it is not running).
Every failing condition is reported, not just the first.

Even with every gate passing, W1 has NO delivery channel: a Wisdom stated-level trigger is
not registered with S7 (a new type trips S7's `_EXPECTED` roster and `CP3_SIGNED`; reusing
`price-level` pollutes S7's dark comparison). That registration needs the S7 owner's CP3 and
is a W5/W6 item — see S7_DEPENDENCY. Nothing here imports `api.services.alert_taxonomy`.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

BASELINE_N_MIN = 100
SILENT_DAYS_MIN = 14
SILENT_SESSIONS_MIN = 10
REPLAY_METRIC = "uct_see_rate_any"
S7_DEPENDENCY = (
    "No W1 delivery channel: a Wisdom stated-level alert type needs S7 registration, which needs the S7 "
    "owner's signed CP3 (tests/test_alert_taxonomy_registration_is_wired.py CP3_SIGNED) and a roster entry "
    "(tests/test_alert_taxonomy_filing_watch_parity.py _EXPECTED). W5/W6 item.")


def replay_baseline_n(conn) -> int:
    """n of the CALL-REPLAY baseline: the denominator of the newest UNSLICED `uct_see_rate_any`
    row (slice `{}` or `{"status": "combined"}`) stream S-E wrote to wisdom_metrics. 0 if none."""
    from api.services.wisdom.publish.adapters import common

    if not common.table_exists(conn, "wisdom_metrics"):
        return 0
    for row in conn.execute("SELECT slice_json, denominator FROM wisdom_metrics WHERE metric = ? "
                            "ORDER BY computed_at DESC LIMIT 500", (REPLAY_METRIC,)):
        slice_ = common.parse_json(row["slice_json"], {})
        if any(k != "status" for k in slice_) or slice_.get("status", "combined") != "combined":
            continue
        return int(row["denominator"] or 0)
    return 0


def silent_window(conn, scorer: str, today: date) -> dict:
    from api.services.wisdom.publish.adapters import common

    if not common.table_exists(conn, "wisdom_d20_scoring_runs"):
        return {"first": None, "last": None, "sessions": 0, "days": 0}
    sessions = [r[0] for r in conn.execute(
        "SELECT session_date FROM wisdom_d20_scoring_runs WHERE scorer = ? AND n_scored > 0 ORDER BY session_date",
        (scorer,))]
    if not sessions:
        return {"first": None, "last": None, "sessions": 0, "days": 0}
    first = date.fromisoformat(sessions[0])
    return {"first": sessions[0], "last": sessions[-1], "sessions": len(sessions), "days": (today - first).days}


def delivery_gate(conn, scorer: str, *, flag_env: str, flag_on: bool, today: date) -> dict:
    reasons = []
    if not flag_on:
        reasons.append(f"{flag_env} is off")
    n = replay_baseline_n(conn)
    if n < BASELINE_N_MIN:
        reasons.append(f"CALL-REPLAY baseline n={n} is below {BASELINE_N_MIN}")
    window = silent_window(conn, scorer, today)
    if window["days"] < SILENT_DAYS_MIN or window["sessions"] < SILENT_SESSIONS_MIN:
        reasons.append(f"silent scoring has run {window['days']} day(s) over {window['sessions']} scored session(s); "
                       f"needs {SILENT_DAYS_MIN} days and {SILENT_SESSIONS_MIN} sessions")
    return {"scorer": scorer, "allowed": not reasons, "reasons": reasons, "flag_on": flag_on,
            "baseline_n": n, "window": window}


def refuse_delivery(conn, scorer: str, *, flag_env: str, flag_on: bool, today: date,
                    pending: Optional[int] = None) -> dict:
    """The W1 delivery answer: refused by a gate, or — with every gate open — refused for
    want of the S7 channel. Never delivers."""
    gate = delivery_gate(conn, scorer, flag_env=flag_env, flag_on=flag_on, today=today)
    reasons = list(gate["reasons"]) if not gate["allowed"] else [S7_DEPENDENCY]
    return {**gate, "delivered": 0, "refused": True, "refusal_reasons": reasons, "pending": pending}
