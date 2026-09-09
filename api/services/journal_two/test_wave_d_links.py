"""Wave D (Internal Links / Backlinks / Knowledge Relationships) — the
j2_note_links sidecar, extraction/sync, and the two reverse-lookup read
paths (get_note_backlinks, resolve_note_link_targets). Same in-memory-schema
fixture pattern as test_wave_c_versions.py.
"""
import sqlite3

import pytest

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import (
    create_note,
    get_note,
    get_note_backlinks,
    resolve_note_link_targets,
    restore_note_version,
    update_note,
)


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _create(c, user_id, title, body_json, **extra):
    payload = {"title": title, "bodyJson": body_json, **extra}
    return create_note(user_id, payload, conn=c)


def _link_node(target_id):
    return {"type": "noteLink", "attrs": {"noteId": target_id}}


def _para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _text(s):
    return {"type": "text", "text": s}


# ── Schema ───────────────────────────────────────────────────────────────────

def test_links_table_and_index_exist():
    c = _conn()
    tables = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "j2_note_links" in tables
    idx = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_j2_note_links_target" in idx


def test_hard_delete_cascades_both_directions():
    """A hard delete of note A must clean up BOTH A's own outgoing link rows
    AND any other note's now-dangling row pointing INTO A."""
    c = _conn()
    a = _create(c, "u1", "A", {"type": "doc", "content": []})
    b = _create(c, "u1", "B", {"type": "doc", "content": [_para(_link_node(a["id"]))]})
    c.commit()
    remaining_from_a = c.execute("SELECT COUNT(*) n FROM j2_note_links WHERE note_id=?", (a["id"],)).fetchone()["n"]
    remaining_into_a = c.execute("SELECT COUNT(*) n FROM j2_note_links WHERE target_note_id=?", (a["id"],)).fetchone()["n"]
    assert remaining_from_a == 0  # A has no outgoing links itself
    assert remaining_into_a == 1  # B -> A exists before delete

    c.execute("DELETE FROM j2_notes WHERE id=?", (a["id"],))
    c.commit()
    remaining_into_a_after = c.execute("SELECT COUNT(*) n FROM j2_note_links WHERE target_note_id=?", (a["id"],)).fetchone()["n"]
    assert remaining_into_a_after == 0


# ── Extraction / sync on save ────────────────────────────────────────────────

def test_a_note_with_no_links_creates_no_rows():
    c = _conn()
    n = _create(c, "u1", "Plain", {"type": "doc", "content": [_para(_text("no links here"))]})
    rows = c.execute("SELECT * FROM j2_note_links WHERE note_id=?", (n["id"],)).fetchall()
    assert rows == []


def test_create_note_with_a_link_creates_one_row():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    rows = c.execute(
        "SELECT target_note_id, position FROM j2_note_links WHERE note_id=?", (source["id"],)
    ).fetchall()
    assert len(rows) == 1
    assert rows[0]["target_note_id"] == target["id"]


def test_duplicate_links_to_the_same_target_are_both_stored():
    """Extraction preserves every occurrence -- dedup for display is the
    read path's job (get_note_backlinks), not the sync's."""
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [
        _para(_link_node(target["id"])), _para(_link_node(target["id"])),
    ]})
    rows = c.execute("SELECT * FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()
    assert len(rows) == 2


def test_updating_a_note_rebuilds_its_links():
    c = _conn()
    t1 = _create(c, "u1", "T1", {"type": "doc", "content": []})
    t2 = _create(c, "u1", "T2", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(t1["id"]))]})

    update_note("u1", source["id"], {"bodyJson": {"type": "doc", "content": [_para(_link_node(t2["id"]))]}}, conn=c)

    rows = c.execute("SELECT target_note_id FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()
    assert [r["target_note_id"] for r in rows] == [t2["id"]]


def test_removing_the_link_from_the_body_removes_the_sidecar_row():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})

    update_note("u1", source["id"], {"bodyJson": {"type": "doc", "content": [_para(_text("no more link"))]}}, conn=c)

    rows = c.execute("SELECT * FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()
    assert rows == []


def test_a_link_to_a_nonexistent_id_still_saves_without_error():
    """The sync must never reject a save because a target looks unresolvable
    -- resolving validity is the READ path's job."""
    c = _conn()
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node("does-not-exist"))]})
    rows = c.execute("SELECT target_note_id FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()
    assert [r["target_note_id"] for r in rows] == ["does-not-exist"]


def test_metadata_only_update_never_touches_links():
    """folder/ticker/tags saves don't carry bodyJson -- _sync_note_links is
    gated the same way _sync_note_embeds already is (`if "bodyJson" in
    patch`), so a links rebuild must never fire on those."""
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    before = c.execute("SELECT rowid FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()

    update_note("u1", source["id"], {"ticker": "NVDA"}, conn=c)

    after = c.execute("SELECT rowid FROM j2_note_links WHERE note_id=?", (source["id"],)).fetchall()
    assert before == after


# ── get_note_backlinks ───────────────────────────────────────────────────────

def test_backlinks_empty_for_a_note_nothing_links_to():
    c = _conn()
    n = _create(c, "u1", "Lonely", {"type": "doc", "content": []})
    out = get_note_backlinks("u1", n["id"], conn=c)
    assert out == {"count": 0, "notes": []}


def test_backlinks_lists_the_linking_note():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    out = get_note_backlinks("u1", target["id"], conn=c)
    assert out["count"] == 1
    assert out["notes"][0]["id"] == source["id"]
    assert out["notes"][0]["title"] == "Source"


def test_backlinks_dedups_multiple_links_from_the_same_source_into_one_row_with_a_ref_count():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [
        _para(_link_node(target["id"])), _para(_link_node(target["id"])), _para(_link_node(target["id"])),
    ]})
    out = get_note_backlinks("u1", target["id"], conn=c)
    assert out["count"] == 1
    assert out["notes"][0]["id"] == source["id"]
    assert out["notes"][0]["refs"] == 3


def test_backlinks_excludes_a_trashed_source_note():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?", ("2026-09-01T00:00:00Z", source["id"]))
    c.commit()
    out = get_note_backlinks("u1", target["id"], conn=c)
    assert out == {"count": 0, "notes": []}


def test_backlinks_do_not_care_whether_the_target_itself_is_trashed():
    """Trash status of the note being VIEWED never affects who links to it
    -- that's a fact about the linking (source) notes, not the target."""
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?", ("2026-09-01T00:00:00Z", target["id"]))
    c.commit()
    out = get_note_backlinks("u1", target["id"], conn=c)
    assert out["count"] == 1
    assert out["notes"][0]["id"] == source["id"]


def test_backlinks_are_tenant_isolated():
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    out = get_note_backlinks("u2", target["id"], conn=c)
    assert out == {"count": 0, "notes": []}


def test_backlinks_empty_for_an_empty_note_id():
    c = _conn()
    assert get_note_backlinks("u1", "", conn=c) == {"count": 0, "notes": []}


# ── resolve_note_link_targets ────────────────────────────────────────────────

def test_resolve_targets_returns_title_and_active_status():
    c = _conn()
    target = _create(c, "u1", "My Thesis", {"type": "doc", "content": []})
    out = resolve_note_link_targets("u1", [target["id"]], conn=c)
    assert out == {target["id"]: {"title": "My Thesis", "status": "active"}}


def test_resolve_targets_reports_trashed_status():
    c = _conn()
    target = _create(c, "u1", "Trashed One", {"type": "doc", "content": []})
    c.execute("UPDATE j2_notes SET deleted_at = ? WHERE id = ?", ("2026-09-01T00:00:00Z", target["id"]))
    c.commit()
    out = resolve_note_link_targets("u1", [target["id"]], conn=c)
    assert out[target["id"]]["status"] == "trashed"


def test_resolve_targets_omits_a_nonexistent_id():
    c = _conn()
    out = resolve_note_link_targets("u1", ["ghost-id"], conn=c)
    assert out == {}


def test_resolve_targets_omits_a_foreign_users_note_identically_to_nonexistent():
    """A foreign-tenant id and a made-up id must be indistinguishable to the
    caller -- both simply absent, never a different signal."""
    c = _conn()
    foreign = _create(c, "u2", "Not Yours", {"type": "doc", "content": []})
    out = resolve_note_link_targets("u1", [foreign["id"]], conn=c)
    assert out == {}


def test_resolve_targets_batches_multiple_ids_in_one_call():
    c = _conn()
    a = _create(c, "u1", "A", {"type": "doc", "content": []})
    b = _create(c, "u1", "B", {"type": "doc", "content": []})
    out = resolve_note_link_targets("u1", [a["id"], b["id"], "ghost"], conn=c)
    assert set(out.keys()) == {a["id"], b["id"]}


def test_resolve_targets_dedups_a_repeated_id_in_the_input():
    c = _conn()
    a = _create(c, "u1", "A", {"type": "doc", "content": []})
    out = resolve_note_link_targets("u1", [a["id"], a["id"], a["id"]], conn=c)
    assert list(out.keys()) == [a["id"]]


def test_resolve_targets_empty_list_returns_empty_dict():
    c = _conn()
    assert resolve_note_link_targets("u1", [], conn=c) == {}


# ── Restore integration (Wave C <-> Wave D) ──────────────────────────────────

def test_restoring_an_older_version_correctly_rebuilds_current_backlinks():
    """directive §51: removing a link, then restoring the version that HAD
    it, must bring the backlink back -- restore reuses update_note, which
    calls _sync_note_links on whatever content the restore actually applies,
    so this should work with zero special-casing."""
    c = _conn()
    target = _create(c, "u1", "Target", {"type": "doc", "content": []})
    source = _create(c, "u1", "Source", {"type": "doc", "content": [_para(_link_node(target["id"]))]})
    # Force a version checkpoint of the "has the link" state before removing it.
    from api.services.journal_two.notes import _maybe_capture_version
    existing = c.execute("SELECT * FROM j2_notes WHERE id=?", (source["id"],)).fetchone()
    _maybe_capture_version(c, source["id"], "u1", existing, force=True)

    update_note("u1", source["id"], {"bodyJson": {"type": "doc", "content": [_para(_text("no link now"))]}}, conn=c)
    assert get_note_backlinks("u1", target["id"], conn=c)["count"] == 0

    version_id = c.execute(
        "SELECT id FROM j2_note_versions WHERE note_id=? ORDER BY created_at DESC LIMIT 1", (source["id"],)
    ).fetchone()["id"]
    restore_note_version("u1", source["id"], version_id, conn=c)

    out = get_note_backlinks("u1", target["id"], conn=c)
    assert out["count"] == 1
    assert out["notes"][0]["id"] == source["id"]


# ── Adversarial: self-links, cycles ──────────────────────────────────────────

def test_a_note_can_link_to_itself_without_crashing_and_shows_up_in_its_own_backlinks():
    """directive §63: allow or gracefully ignore -- no infinite loop either
    way, since resolution is a single, non-recursive lookup per link."""
    c = _conn()
    n = _create(c, "u1", "Self", {"type": "doc", "content": []})
    update_note("u1", n["id"], {"bodyJson": {"type": "doc", "content": [_para(_link_node(n["id"]))]}}, conn=c)
    out = get_note_backlinks("u1", n["id"], conn=c)
    assert out["count"] == 1
    assert out["notes"][0]["id"] == n["id"]
    resolved = resolve_note_link_targets("u1", [n["id"]], conn=c)
    assert resolved[n["id"]]["status"] == "active"


def test_a_link_cycle_a_to_b_to_a_does_not_crash_either_read_path():
    """directive §62: A<->B and A->B->C->A cycles must never crash or
    infinite-loop -- each note's own backlinks/target-resolution is a single
    bounded query, never a graph traversal."""
    c = _conn()
    a = _create(c, "u1", "A", {"type": "doc", "content": []})
    b = _create(c, "u1", "B", {"type": "doc", "content": [_para(_link_node(a["id"]))]})
    update_note("u1", a["id"], {"bodyJson": {"type": "doc", "content": [_para(_link_node(b["id"]))]}}, conn=c)

    assert get_note_backlinks("u1", a["id"], conn=c)["count"] == 1
    assert get_note_backlinks("u1", b["id"], conn=c)["count"] == 1
    resolved = resolve_note_link_targets("u1", [a["id"], b["id"]], conn=c)
    assert resolved[a["id"]]["status"] == "active"
    assert resolved[b["id"]]["status"] == "active"


# ── Wave D closure pass: mixed financial relationships in ONE note ──────────
# directive: internal note link + cashtag entity + typed trade relationship
# must all save/reload/render distinctly, without collision, in a single
# realistic financial note.

def _widget_embed(trade_ref, symbol="NVDA"):
    return {
        "type": "widgetEmbed",
        "attrs": {
            "widgetId": "chart-1", "params": {"symbol": symbol, "tf": "D"},
            "tradeRef": trade_ref, "tradeRefType": "equity_trade",
            "mode": "snapshot", "capturedAt": "2026-09-06T00:00:00Z",
            "searchText": f"{symbol} chart",
        },
    }


def test_one_note_with_a_note_link_a_cashtag_and_a_trade_ref_all_coexist():
    from api.services.journal_two.test_note_trade_links import _seed_trade

    c = _conn()
    _seed_trade(c, "u1", "trade-nvda-1", symbol="NVDA")
    research = _create(c, "u1", "Earnings Prep", {"type": "doc", "content": []})

    note = _create(c, "u1", "NVDA Q3 Thesis", {
        "type": "doc",
        "content": [
            _para(_text("See "), _link_node(research["id"]), _text(" for background.")),
            _para(_text("Watching $NVDA closely into earnings.")),
            _widget_embed("trade-nvda-1"),
        ],
    })

    # All three sidecars populated, none clobbering another.
    links = c.execute("SELECT target_note_id FROM j2_note_links WHERE note_id=?", (note["id"],)).fetchall()
    assert [r["target_note_id"] for r in links] == [research["id"]]

    mentions = c.execute("SELECT symbol FROM j2_note_mentions WHERE note_id=?", (note["id"],)).fetchall()
    assert [r["symbol"] for r in mentions] == ["NVDA"]

    embeds = c.execute(
        "SELECT symbol, trade_ref, trade_ref_type FROM j2_note_embeds WHERE note_id=?", (note["id"],)
    ).fetchall()
    assert len(embeds) == 1
    assert embeds[0]["symbol"] == "NVDA"
    assert embeds[0]["trade_ref"] == "trade-nvda-1"
    assert embeds[0]["trade_ref_type"] == "equity_trade"

    # Reload via the normal read path -- nothing lost, nothing merged/misparsed.
    reloaded = get_note("u1", note["id"], conn=c)
    kids = reloaded["bodyJson"]["content"]
    assert kids[0]["content"][1]["type"] == "noteLink"
    assert kids[0]["content"][1]["attrs"]["noteId"] == research["id"]
    assert kids[2]["type"] == "widgetEmbed"
    assert kids[2]["attrs"]["tradeRef"] == "trade-nvda-1"

    # Each relationship resolves independently and correctly.
    assert get_note_backlinks("u1", research["id"], conn=c)["count"] == 1
    backlink_syms = c.execute(
        "SELECT symbol FROM j2_note_embeds WHERE user_id=? AND trade_ref=?", ("u1", "trade-nvda-1")
    ).fetchall()
    assert backlink_syms[0]["symbol"] == "NVDA"


def test_export_of_the_mixed_relationship_note_renders_all_three_distinctly():
    from api.services.journal_two.test_note_trade_links import _seed_trade
    from api.services.journal_two.notes_export import build_export_zip
    import io, zipfile

    c = _conn()
    _seed_trade(c, "u1", "trade-nvda-1", symbol="NVDA")
    research = _create(c, "u1", "Earnings Prep", {"type": "doc", "content": []})
    _create(c, "u1", "NVDA Q3 Thesis", {
        "type": "doc",
        "content": [
            _para(_link_node(research["id"])),
            _para(_text("Watching $NVDA closely.")),
            _widget_embed("trade-nvda-1"),
        ],
    })
    blob, _ = build_export_zip("u1", conn=c)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    body = zf.read("NVDA Q3 Thesis.md").decode("utf-8")
    assert "[Earnings Prep](Earnings Prep.md)" in body  # the note link
    assert "$NVDA" in body                              # the cashtag, untouched
    assert "NVDA chart" in body                          # the widget embed's search line
    assert "linked_trades: [NVDA (equity trade)]" in body  # the trade-ref front matter
