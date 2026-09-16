"""Brain KB adapter (D18) — publish/adapters/brainkb.py.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a KB row that is unsigned, undated, not priority 3, without an explicit epoch,
   or without a resolvable source locator near the top of its content.
2. a guest or non-canonical principle published as UCT's.
3. an export that carries rows while the flag is off (the swap is the owner's flip).
4. a daily step that deletes a staged row instead of superseding it, logs the same
   preview twice in a day, or writes on a dry run.
5. the 36 unsourced voice principles edited or dropped instead of queued for sourcing.
"""
from __future__ import annotations

import hashlib
from types import SimpleNamespace

import pytest

from api.services.wisdom.core import store
from api.services.wisdom.publish import floor
from api.services.wisdom.publish.adapters import brainkb, common, kbrow
from tests.test_wisdom_publish_adapters_store import adapters_db, seeded  # noqa: F401


def _ctx(dry_run=False):
    return SimpleNamespace(dry_run=dry_run, log=lambda m: None)


def test_rows_are_signed_dated_priority_3_explicit_epoch_with_provenance(seeded):
    with store.read() as conn:
        rows = {r["source_ref"]: r for r in brainkb.build_rows(conn)}
    assert set(rows) == {"wisdom:principle:never_add_to_loser", "wisdom:lesson:recCALL_DONE"}
    for ref, row in rows.items():
        assert row["priority"] == 3 and row["regime_context"] == "" and row["source"] == "wisdom", ref
        assert row["knowledge_epoch"] == "2026", ref
        assert row["title"].startswith("TSDR — 2026-09-06 — "), row["title"]
        lines = row["content"].splitlines()
        assert lines[0].startswith("UCT said (confirmed) — TSDR"), lines[0]
        loc = lines[1].removeprefix("Source: ")
        assert common.LOCATOR_RE.match(loc) and loc.startswith("wisdom:srcSCAN#segSCAN1@"), loc
        assert row["content_sha256"] == kbrow.kb_row_sha(row)
        assert kbrow.is_wisdom_ref(ref)
    # guests and non-canonical principles never become UCT's KB rows (D14, W1 §3.4)
    assert not any("guest_bursts" in r or "noncanonical" in r for r in rows)
    # the open call's levels never leave: 131.5 stop, 140.25/142.75 zone, 160 target
    blob = " ".join(r["content"] + r["title"] for r in rows.values())
    for private in ("131.5", "140.25", "142.75", "160.0", "100.0", "95.0"):
        assert private not in blob


def test_export_carries_rows_only_with_the_flag_on(seeded, monkeypatch):
    """⛔ Wave 1.5 item 3 changed this test's answer, and BOTH states are pinned below.

    The seeded corpus stages two rows: one principle and one lesson. Since 2026-09-14 the
    publication floor drops a principle whose `stability` is NULL — which every record is until
    item 2 populates it — so the principle does not leave and the lesson does. Setting stability
    to the floor restores the original two. If only the first half were asserted, a floor that had
    silently stopped filtering would look identical to one working perfectly.
    """
    with store.write() as conn:
        brainkb.stage(conn, brainkb.build_rows(conn))
    monkeypatch.delenv("WISDOM_BRAINKB_PUBLISH_ENABLED", raising=False)

    # A: unmeasured stability — fail-closed, the principle is withheld and SAID to be withheld
    off = brainkb.export_payload()
    assert off["ok"] and off["enabled"] is False and off["rows"] == [] and off["preview_count"] == 1
    assert len(off["below_floor_dropped"]) == 1
    assert off["below_floor_dropped"][0].startswith("wisdom:principle:")
    assert off["stability_floor"] == floor.floor_value()

    # B: at the floor AND over enough runs — the principle publishes again, which is what proves
    # A was the floor. ⛔ Q17 (2026-09-14): stability alone is not enough. A score of 1.0 over one
    # run is unmeasured, not merely weak, so `stability_runs` has to reach MIN_RUNS too.
    with store.write() as conn:
        conn.execute("UPDATE wisdom_principles SET stability = ?, stability_runs = ?",
                     (floor.floor_value(), floor.MIN_RUNS))
    monkeypatch.setenv("WISDOM_BRAINKB_PUBLISH_ENABLED", "1")
    on = brainkb.export_payload()
    assert on["enabled"] is True and len(on["rows"]) == 2 and on["below_floor_dropped"] == []
    assert all(r["source"] == "wisdom" and r["content_sha256"] == kbrow.kb_row_sha(r) for r in on["rows"])


def test_daily_stages_previews_once_and_supersedes_without_deleting(seeded):
    voice_file_sha = hashlib.sha256(brainkb.VOICE_PRINCIPLES_FILE.read_bytes()).hexdigest()
    out = brainkb.daily(_ctx())
    assert out["flag_on"] is False and out["inserted"] == 2
    with store.read() as conn:
        log_rows = conn.execute("SELECT record_ref, action, flag_state FROM wisdom_publish_log "
                                "WHERE consumer = 'brainkb'").fetchall()
    assert {(r["action"], r["flag_state"]) for r in log_rows} == {("would_publish", "off")}
    assert len(log_rows) == 2
    again = brainkb.daily(_ctx())
    assert again["inserted"] == 0 and again["unchanged"] == 2 and again["voice_drafts_new"] == 0
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_publish_log WHERE consumer = 'brainkb'").fetchone()[0] == 2
    with store.write() as conn:
        conn.execute("UPDATE wisdom_principles SET status = 'rejected' WHERE principle_key = 'never_add_to_loser'")
    third = brainkb.daily(_ctx())
    assert third["superseded"] == 1
    with store.read() as conn:
        row = conn.execute("SELECT state, superseded_at FROM wisdom_kb_rows "
                           "WHERE source_ref = 'wisdom:principle:never_add_to_loser'").fetchone()
    assert row is not None and row["state"] == "superseded" and row["superseded_at"]
    assert hashlib.sha256(brainkb.VOICE_PRINCIPLES_FILE.read_bytes()).hexdigest() == voice_file_sha


def test_a_dry_run_writes_nothing(seeded):
    out = brainkb.daily(_ctx(dry_run=True))
    assert out["dry_run"] is True and out["rows"] == 2
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_kb_rows").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM wisdom_drafts").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM wisdom_publish_log").fetchone()[0] == 0


def test_every_unsourced_voice_principle_is_queued_for_sourcing_never_deleted(seeded):
    principles = brainkb.voice_principles()
    # the manifest's measured count; the file is read, never written
    assert len(principles) == 36 and all(p.get("id") for p in principles)
    brainkb.daily(_ctx())
    with store.read() as conn:
        drafts = conn.execute("SELECT subject_ref, status FROM wisdom_drafts "
                              "WHERE kind = 'voice_principle_sourcing'").fetchall()
        queued = conn.execute("SELECT COUNT(*) FROM wisdom_review_queue WHERE tab = 'attribution'").fetchone()[0]
    assert len(drafts) == 36 and queued == 36
    assert {d["subject_ref"] for d in drafts} == {f"voice_kb:{p['id']}" for p in principles}


def test_review_items_are_validated_and_idempotent(adapters_db):
    item = {"tab": "attribution", "subject_ref": "engine_kb:sunday_scans_intake:Bonde",
            "summary": "457 stale rows credited to Bonde", "old": {"count": 457}, "new": {"wisdom_rows": 2}}
    assert brainkb.enqueue_review_items([item]) == {"inserted": 1, "already_queued": 0}
    assert brainkb.enqueue_review_items([item]) == {"inserted": 0, "already_queued": 1}
    with pytest.raises(ValueError):
        brainkb.enqueue_review_items([{**item, "tab": "golden"}])
    with pytest.raises(ValueError):
        brainkb.enqueue_review_items([{**item, "summary": ""}])
