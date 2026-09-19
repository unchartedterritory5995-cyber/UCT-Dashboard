"""Draft listing and the owner's approve / reject decision (W1 §0.3 veto model, D19).

Routes: `adapters/routes.py` — list under require_admin, decide under core.owner.require_owner
(the FIRST address in ADMIN_EMAILS; a second admin gets 403).

WHAT AN APPROVAL DOES, per kind
- modelbook_example: calls `modelbook_service.create_setup_example(payload)` ONLY while
  `WISDOM_MODELBOOK_DRAFTS_ENABLED` is on (otherwise refused, nothing written). The draft is
  marked `approved` BEFORE the insert and `published` after it, so a crash between the two
  leaves an approved draft with no published_ref that can be retried, never a silent dup.
- modelbook_playbook: records the decision; the playbook is frontend code the Model Book
  owner applies.
- pv_exemplar: records the decision; nothing is written to pattern_vision.db while the
  Pattern Intelligence Lab is paused.
- desk_title_style, voice_principle_sourcing: record the decision.
A decided draft is never re-decided and never overwritten by a later daily build.
"""
from __future__ import annotations

from typing import Optional

from api.services.wisdom.core import flags

KINDS = ("pv_exemplar", "modelbook_example", "modelbook_playbook", "desk_title_style", "voice_principle_sourcing")


class DraftRefused(RuntimeError):
    pass


def list_drafts(*, kind: Optional[str] = None, status: Optional[str] = None, limit: int = 100) -> list[dict]:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    sql = ("SELECT draft_id, kind, subject_ref, title, payload_json, citations_json, status, provisional, "
           "created_at, updated_at, decided_at, decided_by, published_ref, note FROM wisdom_drafts WHERE 1 = 1")
    params: list = []
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(max(1, min(500, int(limit))))
    with store.read(for_request=True) as conn:
        if not common.table_exists(conn, "wisdom_drafts"):
            return []
        rows = [dict(r) for r in conn.execute(sql, params)]
    for r in rows:
        r["payload"] = common.parse_json(r.pop("payload_json"), {})
        r["citations"] = common.parse_json(r.pop("citations_json"), [])
        r["label"] = "provisional" if r["provisional"] else "confirmed"
    return rows


def _load(conn, draft_id: str) -> dict:
    row = conn.execute("SELECT * FROM wisdom_drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if row is None:
        raise LookupError("unknown draft")
    return dict(row)


def decide(draft_id: str, *, decision: str, actor: str, note: Optional[str] = None) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    if decision not in ("approve", "reject"):
        raise ValueError("decision must be approve or reject")
    at = common.now_iso()
    # ⛔⛔ TOCTOU FIX (session 28, adversarial review over the publish adapters, same class of bug
    # as the extraction budget race this session already closed). The draft used to be read under
    # a separate `store.read()`, with each state transition committed later in its OWN
    # `store.write()` -- an unlocked gap in which two near-simultaneous `decide(draft_id,
    # "approve", ...)` calls (a double-click on the admin approve button, or two admin sessions)
    # could both pass the initial check, both see `published_ref IS NULL`, and both call
    # `modelbook_service.create_setup_example` -- producing TWO rows in a `require_paid`,
    # member-facing table, with only one ever recorded in `published_ref` (the other silently
    # orphaned, found only by hand). The read, every status transition, and the
    # modelbook_example path's `create_setup_example` call now all happen inside ONE
    # already-open `store.write()` transaction, mirroring `review.py::act()`'s own established
    # "read and decide inside one transaction" pattern -- WRITE_LOCK (in-process) + BEGIN
    # IMMEDIATE (cross-process) serialize the whole thing against every other writer.
    # ⭐ Safe to hold wisdom.db's write lock across `create_setup_example` specifically because
    # that call is a single fast local SQLite INSERT into modelbook.db (verified: no network call,
    # no AI generation) -- unlike the extraction budget fix, which had to keep the slow Batch API
    # submission OUTSIDE the lock to avoid trading one bug for an availability regression.
    with store.write() as conn:
        draft = _load(conn, draft_id)
        retry = draft["status"] == "approved" and draft["kind"] == "modelbook_example" and not draft["published_ref"]
        if draft["status"] != "draft" and not retry:
            return {"draft_id": draft_id, "status": draft["status"], "changed": False}

        if decision == "reject":
            cur = conn.execute(
                "UPDATE wisdom_drafts SET status = 'rejected', decided_at = ?, decided_by = ?, note = ? "
                "WHERE draft_id = ? AND status = 'draft'", (at, actor, common.clip(note, 500) or None, draft_id))
            if cur.rowcount != 1:
                return {"draft_id": draft_id, "status": draft["status"], "changed": False}
            return {"draft_id": draft_id, "status": "rejected", "changed": True}

        if draft["kind"] != "modelbook_example":
            notes = {"pv_exemplar": "approved; Pattern Intelligence Lab paused, nothing written to pattern_vision.db",
                     "modelbook_playbook": "approved; playbooks are code — hand to the Model Book owner"}
            cur = conn.execute(
                "UPDATE wisdom_drafts SET status = 'approved', decided_at = ?, decided_by = ?, note = ? "
                "WHERE draft_id = ? AND status = 'draft'",
                (at, actor, notes.get(draft["kind"], "approved"), draft_id))
            if cur.rowcount != 1:
                return {"draft_id": draft_id, "status": draft["status"], "changed": False}
            return {"draft_id": draft_id, "status": "approved", "changed": True}

        if not flags.modelbook_drafts_enabled():
            raise DraftRefused("WISDOM_MODELBOOK_DRAFTS_ENABLED is off; nothing was published")
        cur = conn.execute(
            "UPDATE wisdom_drafts SET status = 'approved', decided_at = ?, decided_by = ? "
            "WHERE draft_id = ? AND status IN ('draft', 'approved') AND published_ref IS NULL",
            (at, actor, draft_id))
        if cur.rowcount != 1:
            # Only reachable if something outside this function's own transaction changed the row
            # (e.g. a direct DB edit) -- the read above already ran inside this same transaction,
            # so a concurrent decide() call cannot be the cause anymore. Refuse rather than guess.
            return {"draft_id": draft_id, "status": draft["status"], "changed": False}

        from api.services import modelbook_service
        from api.services.wisdom.publish.adapters import provenance

        # §8c.3: the row that reaches modelbook.db carries the provenance marker. It rides in
        # `notes` because `modelbook_service._EXAMPLE_FIELDS` filters an insert through its own
        # column allowlist — a marker in a key that consumer drops is a marker that never
        # arrives, and a row nobody can trace back is what made the old audit unfalsifiable.
        citations = common.parse_json(draft["citations_json"], [])
        payload = provenance.stamp(
            common.parse_json(draft["payload_json"], {}), consumer="modelbook",
            subject_ref=draft["subject_ref"], locator=citations[0] if citations else None,
            flag_env="WISDOM_MODELBOOK_DRAFTS_ENABLED", text_field="notes")
        created = modelbook_service.create_setup_example(
            provenance.assert_marked(payload, what=f"modelbook_setup_examples from {draft_id}"))
        ref = f"modelbook_setup_examples:{created.get('id')}"
        conn.execute("UPDATE wisdom_drafts SET status = 'published', published_ref = ?, updated_at = ? "
                     "WHERE draft_id = ?", (ref, at, draft_id))
        common.log_publish(conn, "modelbook", draft["subject_ref"], "published", "WISDOM_MODELBOOK_DRAFTS_ENABLED", True)
    return {"draft_id": draft_id, "status": "published", "changed": True, "published_ref": ref}
