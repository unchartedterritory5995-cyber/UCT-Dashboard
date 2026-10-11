"""S7 FLIP for `regime-change` (TERM-025, owner approval 2026-10-10): the
taxonomy rule DELIVERS and both legacy regime emitters stand down.

ENABLEMENT GATE: `ALERT_TAXONOMY_REGIME_CHANGE_LIVE_ENABLED`, default OFF, read
per call. Off: nothing here runs and both legacy paths are unchanged
(`tests/test_alert_flip_regime_change.py` pins it).

THE TWO LEGACY EMITTERS THIS TYPE ABSORBS (`regime_change.py`'s table), AND
WHAT EACH ONE DOES WHEN THE FLAG IS ON
  A. `awareness/rules.rule_regime_flip` (R4), driven by
     `awareness/engine.run_awareness_scan`. The engine no longer calls R4; it
     keeps R4's slot in the member's candidate list and hands that slot to
     `fire_ledger`, so the regime fire still meets `add_insight`'s shared 8/day
     cap in R4's order. The decision is `regime_change.would_fire` with the
     projection's ledger params; the WORDS and the importance score come from
     the shipped pure renderer (`rule_regime_flip` + `compute_relevance_score`)
     so the member's insight is byte-identical. Dedup is what it always was,
     the ledger: one fire per ledger move, keyed by the ledger row's own id
     (`ledger_cycle_key`).
  B. `voice_proactive_service.maybe_emit_regime_shift`, driven by the Compass
     window scans and the voice router. With the flag on it hands its own
     inputs (the current reading and the member's last summary) to
     `fire_session_summary` before its loop. The decision is `would_fire` with
     the projection's session-summary params; the legacy dedup is kept by
     calling the legacy's own `_regime_shift_already_told`; the words are
     `session_summary_insight`, railed against the real function.

  ⛔ NOT ABSORBED, unchanged by this flag: `alerts.alert_regime_change`, the
  brain's market-PHASE broadcast (F-S7-RC-4, `EXCLUDED_EMITTER_ALERTS_TYPE`).

DELIVERY: `delivery.deliver_insight`, the in-app-only path. `regime_change`
pins `CHANNELS_FIXED = ("in_app",)` and `ENTITY_REF_FIXED = None`; the legacy
surface is the Compass insight row, so the taxonomy writes that same row
(after the lease, the FT-036 routing rule and the AC-4 queue cap) and never
reaches `deliver_alert_payload`, which would email every position holder.
Every fire is recorded in `alert_fires` first.

ONE ALERT PER EVENT: each legacy emitter returns this module's answer before
reaching its own `add_insight`, and the fire key is unique per event
(`UNIQUE(predicate_id, fire_key)`), so neither a scheduler retry nor the
on-demand voice door can deliver one event twice.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

FLAG = "ALERT_TAXONOMY_REGIME_CHANGE_LIVE_ENABLED"

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
LIVE_PREFIX = "live:"


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def live_predicate_id(user_id: str, prior_label_source: str) -> str:
    return f"{LIVE_PREFIX}{user_id}:{prior_label_source}"


def _market_date(now: Optional[float] = None) -> str:
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, _ET).strftime("%Y-%m-%d")


# ── path A: the ledger ─────────────────────────────────────────────────────

def ledger_cycle_key(scan_ctx: dict) -> str:
    """The fire key for THIS awareness cycle's flip: the ledger row the engine
    just appended (`regime_snapshots.record_snapshot`), read-only. One ledger
    move is one event. Never raises: a failed read falls back to a key built
    from the flip itself plus the cycle's own time, which is still unique per
    cycle (the engine appends one row per cycle)."""
    regime = (scan_ctx or {}).get("regime") or {}
    label, prev = regime.get("label"), regime.get("prev_label")
    try:
        from api.services.alert_taxonomy import regime_change_projection as _proj
        lid = _proj.ledger_reading().get("ledger_id")
        if lid is not None:
            return f"ledger:{int(lid)}"
    except Exception:  # noqa: BLE001
        pass
    return f"ledger:{prev}>{label}:{int(time.time())}"


def fire_ledger(user_id: str, scan_ctx: dict, user_ctx: dict, *, fire_key: str) -> int:
    """R4's slot, delivered by the taxonomy. Returns 1 when an insight was
    queued (what `_fire_candidate` counted), else 0."""
    from api.services.alert_taxonomy import delivery as _delivery
    from api.services.alert_taxonomy import receipts as _receipts
    from api.services.alert_taxonomy import regime_change as _rc
    from api.services.alert_taxonomy import regime_change_projection as _proj
    from api.services.awareness import rules as _rules

    regime = (scan_ctx or {}).get("regime") or {}
    params = _proj._params(_rc.LEDGER)
    has_positions = bool((user_ctx or {}).get("positions"))
    has_watch = bool((user_ctx or {}).get("watch_syms"))
    if not _rc.would_fire(params, current_label=regime.get("label"),
                          confidence=regime.get("confidence"),
                          ledger_label=regime.get("prev_label"),
                          has_positions=has_positions, has_watch=has_watch):
        return 0
    cands = _rules.rule_regime_flip(scan_ctx, user_ctx)
    if not cands:
        logger.warning("[regime-change live] would_fire said yes and R4's renderer "
                       "produced nothing for %s; nothing sent", user_id)
        return 0
    cand = cands[0]
    importance = _rules.compute_relevance_score(
        cand.base_signal, cand.personal_multiplier, cand.urgency)
    fire_id = _receipts.record_fire(
        predicate_id=live_predicate_id(user_id, _rc.LEDGER), trigger_type=_rc.TYPE_ID,
        user_id=user_id, entity_ref=_rc.resolve_entity_ref(params), fire_key=fire_key,
        detail={"prior_label_source": _rc.LEDGER, "from": regime.get("prev_label"),
                "to": regime.get("label"), "confidence": regime.get("confidence"),
                "kind": cand.kind, "importance": importance},
        source_data_class="regime_ledger", freshness_class=None, as_of=time.time())
    if fire_id is None:
        return 0
    report = _delivery.deliver_insight(
        fire_id, user_id, trigger_type=_rc.TYPE_ID, kind=cand.kind,
        headline=cand.headline, body=cand.body, importance=importance,
        symbol=_rc.resolve_entity_ref(params))
    return 1 if report.get("insight_id") else 0


# ── path B: the session summary ────────────────────────────────────────────

def session_summary_insight(current_label: str, prior_label: str,
                            narration: str) -> dict[str, Any]:
    """Path B's insight, field for field. ⛔ A RESTATEMENT of the literal call in
    `maybe_emit_regime_shift`, kept there because the type's schema rails read
    that call's `kind`/`importance` by AST.
    `test_the_session_summary_insight_matches_the_REAL_legacy_call` drives the
    real function and fails on any drift."""
    return {
        "kind": "regime_shift",
        "symbol": None,
        "headline": f"Regime shifted to {current_label.replace('_', ' ')}",
        "body": (f"Previously discussed in context of {prior_label.replace('_', ' ')}. "
                 f"{narration}"),
        "importance": 8,
    }


def _last_regime_shift_id(user_id: str) -> int:
    """The newest `regime_shift` row's id (0 when none): the anchor that makes
    a flap-back to the same label a NEW event with a NEW key."""
    from api.services.voice_proactive_service import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM voice_proactive_insights WHERE user_id = ? "
            "AND kind = 'regime_shift' ORDER BY id DESC LIMIT 1", (user_id,)).fetchone()
    finally:
        conn.close()
    return int(row[0]) if row else 0


def fire_session_summary(user_id: str, *, current: dict, last_summary_text: str,
                         now: Optional[float] = None) -> int:
    """Path B, delivered by the taxonomy. Returns what the legacy returned: 1
    when an insight was queued, else 0."""
    from api.services import voice_proactive_service as _vps
    from api.services.alert_taxonomy import delivery as _delivery
    from api.services.alert_taxonomy import receipts as _receipts
    from api.services.alert_taxonomy import regime_change as _rc
    from api.services.alert_taxonomy import regime_change_projection as _proj

    cur = (current or {}).get("regime")
    params = _proj._params(_rc.SESSION_SUMMARY)
    if not _rc.would_fire(params, current_label=cur,
                          confidence=(current or {}).get("confidence"),
                          last_summary_text=last_summary_text):
        return 0
    # The legacy's own dedup (F-S7-RC-3's fix), called, not restated.
    if _vps._regime_shift_already_told(user_id, cur):
        return 0
    prior = _rc.prior_label(params, current_label=cur, last_summary_text=last_summary_text)
    fields = session_summary_insight(cur, prior or "", (current or {}).get("narration", ""))
    # One event = (this member, this label, since the last shift they were
    # told about, this market day). The day re-opens an event whose insight
    # the 8/day cap swallowed, which is when the legacy would have retried.
    fire_key = f"summary:{cur}:after:{_last_regime_shift_id(user_id)}:{_market_date(now)}"
    pid = live_predicate_id(user_id, _rc.SESSION_SUMMARY)
    fire_id = _receipts.record_fire(
        predicate_id=pid,
        trigger_type=_rc.TYPE_ID, user_id=user_id,
        entity_ref=_rc.resolve_entity_ref(params), fire_key=fire_key,
        detail={"prior_label_source": _rc.SESSION_SUMMARY, "from": prior, "to": cur,
                "kind": fields["kind"], "importance": fields["importance"]},
        source_data_class="regime_classifier", freshness_class=None,
        as_of=time.time() if now is None else now)
    if fire_id is None:
        # Already recorded. Only a fire whose insight write FAILED (lease
        # released) is retried, as the legacy retried on its next scan.
        fire_id = _receipts.released_fire_id(pid, fire_key)
        if fire_id is None:
            return 0
    report = _delivery.deliver_insight(
        fire_id, user_id, trigger_type=_rc.TYPE_ID, kind=fields["kind"],
        headline=fields["headline"], body=fields["body"],
        importance=fields["importance"], symbol=fields["symbol"])
    return 1 if report.get("insight_id") else 0
