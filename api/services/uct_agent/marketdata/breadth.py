"""MD-1 kind `breadth.current` (owner: agent-md) — contract MD-1 v1.4 §4.4. MODEL-ISOLATED.

The current breadth reading for one universe and measure: a thin adapter over
`services/breadth_current.reading(universe, metric)`, the breadth side of the Agent integration contract
(docs/breadth/current-reading-contract.md). That module CHOOSES between the live engine's cached payload
and the canonical V2 store; it never computes inline. This adapter recomputes nothing, and never copies
breadth data.

⛔ MODEL ISOLATION (contract rule 8; agent-lead ruling 2026-11-01): UCT-derived breadth values must not
enter model-facing plans, history or chat naming. The kind is registered `model_isolated=True`, so the
gateway serves it only for purpose "answer" (rendered to the member through the local-result boundary) and
refuses every other purpose before admission. Whether such values may ever reach the model is the owner's
decision with the breadth owner, and is not taken here.

Mapping (contract "Response" table → MD-1 envelope)
  * `status` intraday → freshness `periodic` (a ~55 s recompute of a real-time snapshot);
    provisional | finalized → `historical` (a completed session).
  * `as_of` = `observed_at`: the VENDOR's snapshot observation time for intraday, or the session close for a
    completed session. Never `computed_at`. `observed_at` unknown → null, with a note.
  * `stale` = not `current`. When not current, the note says what the value is (its `label`) and that a
    current reading is unavailable. `stale_reason` is for logs, not members (contract rule 2), so it is
    logged, not returned.
  * The `label` is always a note (contract rule 1: "Intraday · 11:52 AM ET" is the disclosure).
  * accuracy tiers: `approximate` gets a note (never quote it to the single name); `finalized_only` gets a
    note that no current reading exists for this measure. The 52-week / 20-day new-high/new-low measures
    are `finalized_only` metrics here (MD-1 v1.3: `nhnl` is not a separate kind).
  * Scope: US, NYSE and Nasdaq aggregate measures only (contract rule 6).
  * `provider_calls` 0. A stale live payload kicks the breadth service's OWN background refresh. That is its
    behaviour, not this adapter's.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

log = logging.getLogger("uct_agent.data.breadth")

SOURCE = "uct-breadth"
UNIVERSES = ("us", "nyse", "nasdaq")
NHNL_METRICS = ("new_52w_highs", "new_52w_lows", "net_new_high_low", "new_20d_highs", "new_20d_lows")
DATA_FIELDS = ("universe", "metric", "value", "status", "session", "label", "accuracy_tier", "current",
               "finalized_session", "market_open", "population_drift")
_METRIC_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")

NOTE_NOT_CURRENT = "not a current reading — this is {label}; a current reading is unavailable"
NOTE_APPROXIMATE = "an approximate count from the live method — never quote it to the single name"
NOTE_FINALIZED_ONLY = ("this measure has no validated live reading — the value is the newest finalized "
                       "session's")
NOTE_NO_OBSERVATION = "the observation time of this reading is unknown"
NOTE_UNAVAILABLE = "no breadth reading is available for {metric} on the {universe} universe"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate). The metric NAME is checked for shape only; whether the
    breadth service knows it is the service's answer (an unknown measure reads `unavailable`)."""
    if params.get("universe", "us") not in UNIVERSES:
        return "`universe` must be one of " + ", ".join(UNIVERSES)
    metric = params.get("metric")
    if not isinstance(metric, str) or not _METRIC_RE.match(metric):
        return "`metric` must be a breadth measure name such as pct_above_50sma"
    return None


def _utc(v: Any) -> Optional[str]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return env.utc_iso(d if d.tzinfo else d.replace(tzinfo=timezone.utc))


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_breadth_current(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "breadth.current"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    universe = params.get("universe", "us")
    metric = params["metric"]

    from api.services import breadth_current
    r = breadth_current.reading(universe, metric)
    if not isinstance(r, dict) or not r.get("ok") or _num(r.get("value")) is None:
        if isinstance(r, dict) and r.get("stale_reason"):
            log.info("breadth.current %s/%s unavailable: %s", universe, metric, str(r["stale_reason"])[:200])
        return env.unavailable(kind, params, SOURCE, NOTE_UNAVAILABLE.format(metric=metric, universe=universe))

    status = r.get("status")
    freshness = "periodic" if status == "intraday" else "historical"
    current = bool(r.get("current"))
    label = str(r.get("label") or "")
    notes = [label] if label else []
    if not current:
        notes.append(NOTE_NOT_CURRENT.format(label=label or "an older reading"))
        if r.get("stale_reason"):
            log.info("breadth.current %s/%s not current: %s", universe, metric, str(r["stale_reason"])[:200])
    tier = r.get("accuracy_tier")
    if tier == "approximate":
        notes.append(NOTE_APPROXIMATE)
    elif tier == "finalized_only":
        notes.append(NOTE_FINALIZED_ONLY)
    as_of = _utc(r.get("observed_at"))
    if as_of is None:
        notes.append(NOTE_NO_OBSERVATION)

    data = {"universe": universe, "metric": metric, "value": _num(r.get("value")), "status": status,
            "session": r.get("session"), "label": label or None, "accuracy_tier": tier, "current": current,
            "finalized_session": r.get("finalized_session"), "market_open": bool(r.get("market_open")),
            "population_drift": _num(r.get("population_drift"))}
    return env.make_envelope(kind, params, status="ok", freshness=freshness, as_of=as_of, source=SOURCE,
                             data=data, stale=not current, notes=notes, provider_calls=0)
