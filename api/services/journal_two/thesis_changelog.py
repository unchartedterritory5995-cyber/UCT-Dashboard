"""Wave G — Thesis Changelog: a COMPUTED READ, not a stored event log.

The entry checkpoint (decision 22/24, directive §34's "prove it against
existing infrastructure first") found every event class the changelog needs
already has a durable, timestamped, authoritative home:

  (a) property changes  -- diffed from consecutive j2_note_versions rows'
      properties_json (Wave C+E), restricted to the four USER-SET builtin
      properties (thesis_status/confidence/research_type/review_date) so a
      live-derived property (Ticker/Sector/Industry/Theme/Linked-Trade,
      recomputed on every read, never stored) can NEVER appear as a "user
      changed this" event -- checkpoint §32's explicit concern, satisfied
      structurally because those keys are never written into properties_json
      at all (see note_properties._derived_financial_values).
  (b) thesis edits (title/subtitle/body) -- diffed the same way; a restore
      is distinguished from an ordinary edit via the pre-restore version
      row's own `restored_from_version_id` marker (checkpoint §24).
  (c) evidence added/removed -- j2_thesis_evidence's own created_at/removed_at.
  (d) fact captures -- j2_fact_observations.observed_at, for facts the note
      currently references. Deliberately NOT re-fired on a current-value
      refresh (checkpoint §28) -- resolve_current_values has no write path,
      so there is structurally nothing here to re-fire on.
  (e) trade/position linkage -- j2_note_embeds' trade_ref + captured_at,
      resolved via note_trade_links.resolve_trade_ref; a position that has
      since graduated into a closed trade additionally surfaces a
      trade_closed event off that trade's own exit_date.

No new write path. No event can exist here that doesn't trace back to one
of the systems above -- "auditable" by construction (directive §33/§169).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.note_properties import BUILTIN_USER_SET_IDS

# Property ids whose transitions are meaningful thesis-research events. A
# custom (non-builtin) property change is intentionally NOT surfaced here in
# v1 -- the changelog is a research timeline, not a generic audit of every
# field (directive §35's "read as a timeline, not an audit database");
# revisit only if a member need for it actually surfaces.
_TRACKED_PROPERTY_IDS = BUILTIN_USER_SET_IDS


def _parse_props(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    import json
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _version_sequence(conn: sqlite3.Connection, user_id: str, note_id: str) -> list[dict[str, Any]]:
    """Ascending-by-created_at list of every captured version PLUS a final
    synthetic entry for the note's current live content -- see this module's
    docstring for why a version row's created_at is when ITS content became
    current (never when it stopped being current)."""
    rows = conn.execute(
        "SELECT id, title, subtitle, body_plain, properties_json, created_at,"
        " restored_from_version_id FROM j2_note_versions"
        " WHERE note_id = ? AND user_id = ? ORDER BY created_at ASC",
        (note_id, user_id),
    ).fetchall()
    seq = [
        {
            "versionId": r["id"],
            "title": r["title"] or "",
            "subtitle": r["subtitle"],
            "bodyPlain": r["body_plain"] or "",
            "properties": _parse_props(r["properties_json"]),
            "at": r["created_at"],
            "restoredFromVersionId": r["restored_from_version_id"],
        }
        for r in rows
    ]
    note = conn.execute(
        "SELECT title, subtitle, body_plain, properties_json, updated_at FROM j2_notes"
        " WHERE id = ? AND user_id = ?",
        (note_id, user_id),
    ).fetchone()
    if note is not None:
        seq.append({
            "versionId": None,  # None marks "current live content", not a version row
            "title": note["title"] or "",
            "subtitle": note["subtitle"],
            "bodyPlain": note["body_plain"] or "",
            "properties": _parse_props(note["properties_json"]),
            "at": note["updated_at"],
            "restoredFromVersionId": None,
        })
    return seq


def _content_transition_events(conn: sqlite3.Connection, user_id: str, note_id: str) -> list[dict[str, Any]]:
    seq = _version_sequence(conn, user_id, note_id)
    events: list[dict[str, Any]] = []
    for i in range(1, len(seq)):
        prev, cur = seq[i - 1], seq[i]

        if prev["restoredFromVersionId"]:
            target = conn.execute(
                "SELECT created_at FROM j2_note_versions WHERE id = ? AND user_id = ?",
                (prev["restoredFromVersionId"], user_id),
            ).fetchone()
            events.append({
                "type": "restored",
                "at": cur["at"],
                "restoredFromVersionId": prev["restoredFromVersionId"],
                "restoredFromVersionAt": target["created_at"] if target else None,
            })
            continue  # a restore's content diff is a consequence, not a second event

        if prev["title"] != cur["title"] or prev["subtitle"] != cur["subtitle"] or prev["bodyPlain"] != cur["bodyPlain"]:
            events.append({
                "type": "thesis_edited",
                "at": cur["at"],
                "fromVersionId": prev["versionId"],
                "toVersionId": cur["versionId"],  # None = "current" (no later checkpoint yet)
            })

        for prop_id in _TRACKED_PROPERTY_IDS:
            old_val = prev["properties"].get(prop_id)
            new_val = cur["properties"].get(prop_id)
            if old_val != new_val:
                events.append({
                    "type": "property_changed",
                    "at": cur["at"],
                    "propertyId": prop_id,
                    "from": old_val,
                    "to": new_val,
                })
    return events


def _evidence_events(user_id: str, note_id: str, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    from api.services.journal_two.thesis_evidence import list_note_evidence
    events: list[dict[str, Any]] = []
    for ev in list_note_evidence(user_id, note_id, include_removed=True, conn=conn):
        events.append({
            "type": "evidence_added", "at": ev["createdAt"],
            "evidenceId": ev["id"], "targetType": ev["targetType"],
            "targetId": ev["targetId"], "stance": ev["stance"],
        })
        if ev["removedAt"]:
            events.append({
                "type": "evidence_removed", "at": ev["removedAt"],
                "evidenceId": ev["id"], "targetType": ev["targetType"],
                "targetId": ev["targetId"], "stance": ev["stance"],
            })
    return events


def _fact_events(user_id: str, note_id: str, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    from api.services.journal_two.note_facts import list_note_facts
    return [
        {
            "type": "fact_captured", "at": f["observedAt"],
            "factId": f["id"], "ticker": f["ticker"], "factType": f["factType"],
            "factLabel": f["factLabel"], "value": f["value"],
        }
        for f in list_note_facts(user_id, note_id, conn=conn)
    ]


def _trade_events(user_id: str, note_id: str, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    from api.services.journal_two.note_trade_links import resolve_trade_ref
    events: list[dict[str, Any]] = []
    rows = conn.execute(
        "SELECT symbol, trade_ref, trade_ref_type, captured_at FROM j2_note_embeds"
        " WHERE note_id = ? AND user_id = ? AND trade_ref IS NOT NULL",
        (note_id, user_id),
    ).fetchall()
    seen_trades: set[str] = set()
    for row in rows:
        resolved = resolve_trade_ref(conn, user_id, row["trade_ref"], row["trade_ref_type"])
        kind = resolved.get("kind")
        if kind not in ("equity_trade", "option_strategy", "position"):
            continue
        events.append({
            "type": "position_linked", "at": row["captured_at"],
            "symbol": resolved.get("symbol") or row["symbol"], "kind": kind,
            "tradeRef": row["trade_ref"], "tradeRefType": row["trade_ref_type"],
        })
        if kind == "equity_trade" and resolved.get("id") not in seen_trades:
            trade = conn.execute(
                "SELECT exit_date, result FROM j2_trades WHERE id = ? AND user_id = ?",
                (resolved["id"], user_id),
            ).fetchone()
            if trade is not None:
                seen_trades.add(resolved["id"])
                events.append({
                    "type": "trade_closed", "at": trade["exit_date"],
                    "symbol": resolved.get("symbol"), "result": trade["result"],
                    "tradeId": resolved["id"],
                })
    return events


def get_thesis_changelog(
    user_id: str, note_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every event, newest-first, merged from the five source classes above.
    A source read failing (a malformed embed row, a provider hiccup inside
    resolve_trade_ref) never takes the whole changelog down -- each source
    is independently best-effort so one bad row degrades to "that source
    contributed nothing," never a 500 on the whole thesis view."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        events: list[dict[str, Any]] = []
        for fn in (_content_transition_events, _evidence_events, _fact_events, _trade_events):
            try:
                if fn is _content_transition_events:
                    events.extend(fn(conn, user_id, note_id))
                else:
                    events.extend(fn(user_id, note_id, conn))
            except Exception:  # noqa: BLE001 -- one source's failure never blanks the rest
                continue
        events = [e for e in events if e.get("at")]
        events.sort(key=lambda e: e["at"], reverse=True)
        return events
    finally:
        if owned:
            conn.close()
