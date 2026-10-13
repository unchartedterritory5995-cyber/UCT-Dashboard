"""Rule versions (Notebook P2 Tier 1, spec §P2 item 2; R-P2b-1, R-P2b-2).

A version is recorded when a rule's WORDS change (label or evidence); v1 when it is made. Marking a rule
"before entry" changes where it shows, not what it says, and records no version. ⛔ Rules are not notes:
nothing here touches j2_notes. Every query is scoped by user_id.

A wrong type in a patch is a RuleEditError (the route's 400, R-PF-N5), never a silent coercion: a string
"true" for beforeEntry would otherwise turn the switch OFF, and a non-text label would be a 500.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

_LABEL_MAX = 200
_NOTE_MAX = 500

#: The 400 sentence for a blank label (the client's rulesApi.editRule shows it as written).
BLANK_LABEL_SENTENCE = "A rule needs words."


class RuleEditError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rule_row(conn: sqlite3.Connection, user_id: str, rule_id: str):
    return conn.execute("SELECT * FROM j2_journal_rules WHERE id = ? AND user_id = ?", (rule_id, user_id)).fetchone()


def _ensure_v1(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """R-P2b-2: a rule made before this release gets its v1, dated its creation."""
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, row["user_id"], row["id"], row["label"], row["evidence"], row["created_at"]))


def record_v1(conn: sqlite3.Connection, user_id: str, rule_id: str, label: str, evidence: str | None, at: str) -> None:
    conn.execute("INSERT OR IGNORE INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                 " changed_at, change_note) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)",
                 (uuid.uuid4().hex, user_id, rule_id, label, evidence, at))


def current_changed_at(conn: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    """The CURRENT version's changed_at, read from its version row (R-PF-N4): a later before-entry
    toggle moves the rule's updated_at, never the day its words changed. None when the row is absent
    (a rule from before this release whose v1 has not been written yet)."""
    keys = row.keys()
    version = int(row["version"]) if "version" in keys and row["version"] is not None else 1
    got = conn.execute("SELECT changed_at FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                       " AND version = ?", (row["user_id"], row["id"], version)).fetchone()
    return got[0] if got is not None else None


def list_versions(user_id: str, rule_id: str, conn: sqlite3.Connection | None = None) -> list[dict] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _rule_row(conn, user_id, rule_id)
        if row is None:
            return None
        _ensure_v1(conn, row)
        conn.commit()
        rows = conn.execute("SELECT * FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                            " ORDER BY version DESC", (user_id, rule_id)).fetchall()
        return [{"version": r["version"], "label": r["label"], "evidence": r["evidence"],
                 "changedAt": r["changed_at"], "changeNote": r["change_note"]} for r in rows]
    finally:
        if owned:
            conn.close()


def _check_types(patch: dict[str, Any]) -> None:
    """R-PF-N5: 400 on wrong types, before any lock is taken or any row read."""
    if not isinstance(patch, dict):
        raise RuleEditError("Send a JSON object")
    if "label" in patch and not isinstance(patch["label"], str):
        raise RuleEditError("label must be text")
    if "evidence" in patch and patch["evidence"] is not None and not isinstance(patch["evidence"], str):
        raise RuleEditError("evidence must be text")
    if "changeNote" in patch and patch["changeNote"] is not None and not isinstance(patch["changeNote"], str):
        raise RuleEditError("changeNote must be text")
    if "beforeEntry" in patch and not isinstance(patch["beforeEntry"], bool):
        raise RuleEditError("beforeEntry must be true or false")


def edit_rule(user_id: str, rule_id: str, patch: dict[str, Any], conn: sqlite3.Connection | None = None) -> dict | None:
    from api.services.journal_two import journal_rules
    from api.services.journal_two import notes as notes_service
    _check_types(patch)
    owned = conn is None
    conn = conn or get_connection()
    try:
        notes_service._begin_immediate(conn)
        row = _rule_row(conn, user_id, rule_id)
        # Ruling R-M1-1: a dismissed rule has left the member's list, so it answers like before_after.
        if row is None or row["status"] == "dismissed":
            conn.rollback()
            return None
        _ensure_v1(conn, row)
        label, evidence = row["label"], row["evidence"]
        if "label" in patch:
            label = patch["label"].strip()
            if not label:
                raise RuleEditError(BLANK_LABEL_SENTENCE)
            label = label[:_LABEL_MAX]
        if "evidence" in patch:
            evidence = patch["evidence"]
        now = _now()
        sets, params = ["updated_at = ?"], [now]
        if (label, evidence) != (row["label"], row["evidence"]):
            version = int(row["version"] or 1) + 1
            note = patch.get("changeNote")
            conn.execute("INSERT INTO j2_journal_rule_versions (id, user_id, rule_id, version, label, evidence,"
                         " changed_at, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (uuid.uuid4().hex, user_id, rule_id, version, label, evidence, now,
                          (note or "").strip()[:_NOTE_MAX] or None))
            sets += ["label = ?", "evidence = ?", "version = ?"]
            params += [label, evidence, version]
        if "beforeEntry" in patch:
            sets.append("before_entry = ?")
            params.append(1 if patch["beforeEntry"] else 0)
        conn.execute(f"UPDATE j2_journal_rules SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, rule_id, user_id))
        conn.commit()
        return journal_rules._row_to_dict(_rule_row(conn, user_id, rule_id), conn)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── "Before / after this rule" (spec §P2 item 2; R-P2b-3) ───────────────────────────────────
SMALL_SAMPLE = 10


def _day(iso: str | None) -> str | None:
    """The ET trading day of a stored stamp (R-PF-N6): a change made at 21:00 ET is stamped the next
    UTC day, and R-P2b-3 splits on the member's day. One spelling for a version's change and a
    trade's entry: journal_two.timeutil.compute_trading_day_et (a bare date is its own day)."""
    from api.services.journal_two.timeutil import compute_trading_day_et
    return compute_trading_day_et(iso) if iso else None


def _window(trades: list[tuple[str | None, sqlite3.Row]], frm: str | None, to: str | None, adh: dict) -> dict:
    """One window, [from's day, to's day). `trades` is (ET entry day, row), already scoped to the
    member, the rule's account and analytics. Sample sizes always; `small` below SMALL_SAMPLE."""
    from api.services.journal_two.trade_refs import trade_ref_for_row
    from api.services.journal_two.trader_blocks import adherence_of_trade
    lo, hi = _day(frm), _day(to)
    rows = [r for day, r in trades if day is not None and (lo is None or day >= lo) and (hi is None or day < hi)]
    wins = sum(1 for r in rows if r["result"] == "Win")
    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
    recs = (adherence_of_trade(adh.get, trade_ref_for_row(r), r["position_id"]) for r in rows)
    ad = [rec["adherencePct"] for rec in recs if rec is not None and rec.get("adherencePct") is not None]
    n = len(rows)
    return {"from": frm, "to": to, "trades": n, "wins": wins,
            "winRate": (wins / n) if n else None,
            "rCount": len(rs), "avgR": round(sum(rs) / len(rs), 2) if rs else None,
            "adherenceCount": len(ad), "adherence": round(sum(ad) / len(ad), 4) if ad else None,
            "small": n < SMALL_SAMPLE}


def before_after(user_id: str, rule_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Every version's before and after windows, newest version first. None (the route's 404) for
    another member's rule, a missing one, or a DISMISSED one (R-PF-N20: the client's "It may have
    been dismissed" must be true). Read-only apart from the lazy v1 (R-P2b-2)."""
    from api.services.journal_two import adherence_store
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _rule_row(conn, user_id, rule_id)
        if row is None or row["status"] == "dismissed":
            return None
        _ensure_v1(conn, row)
        conn.commit()
        vs = conn.execute("SELECT * FROM j2_journal_rule_versions WHERE user_id = ? AND rule_id = ?"
                          " ORDER BY version", (user_id, rule_id)).fetchall()
        # B4: the store answers {trade_ref: record}, never a list.
        adh = adherence_store.list_adherence_for_user(user_id, conn=conn)
        sql = ["SELECT * FROM j2_trades WHERE user_id = ? AND COALESCE(analytics_excluded, 0) = 0"]
        params: list = [user_id]
        if row["account_id"]:
            sql.append("AND account_id = ?")
            params.append(row["account_id"])
        trades = [(_day(t["entry_date"]), t) for t in conn.execute(" ".join(sql), params).fetchall()]
        out = []
        for i, v in enumerate(vs):
            prev_start = vs[i - 1]["changed_at"] if i > 0 else None
            nxt = vs[i + 1]["changed_at"] if i + 1 < len(vs) else None
            out.append({"version": v["version"], "label": v["label"], "changedAt": v["changed_at"],
                        "before": _window(trades, prev_start, v["changed_at"], adh),
                        "after": _window(trades, v["changed_at"], nxt, adh)})
        return {"ruleId": rule_id, "accountId": row["account_id"], "versions": list(reversed(out))}
    finally:
        if owned:
            conn.close()
