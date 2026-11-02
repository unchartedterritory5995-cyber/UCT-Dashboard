"""Tests for `providers/obsidian.py` — the push-transport provider that
reads Task 3's staging tables (`j2_obsidian_staging`/`j2_obsidian_manifest`)
and satisfies the ordinary `NoteProvider` contract over them, so the sync
engine's convert -> upsert -> conflict -> media path and its delete
detection are INHERITED, never re-implemented.

Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-4-brief.md
"""

from __future__ import annotations

import json

import httpx
import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors
from api.services.journal_two.note_connectors.convert import md_to_tiptap
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.note_connectors.providers.obsidian import (
    NO_ATTACHMENT_PASS, ObsidianProvider, _apply_attachment_refs, _build_basename_map,
    _resolve_target, resolve_pending_target,
)
from api.services.journal_two.notes import extract_plain_text


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    return auth_db


def _stage(user_id, vault_id, vault_path, body_md, updated_at, *, content_hash=None, received_at=None,
           attachments=None):
    """`received_at` defaults to `updated_at` (every pre-existing caller in
    this file relies on that -- it's how those tests can drive the cursor
    via a single timestamp) -- pass it explicitly to stage a row whose
    CLIENT-supplied `updated_at` and SERVER-assigned `received_at` diverge,
    which is exactly what the C1 cursor-poisoning test below needs: it
    writes straight to the table, bypassing `obsidian_staging.ingest_batch`'s
    own ingest-time clamp entirely, to prove the cursor fix holds even when
    that OTHER layer is out of the picture.
    `attachments` (Plan C Task 3): the row's attachment refs, stored as `attachments_json`;
    None (the default) is a row from a plugin that sent no list."""
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO j2_obsidian_staging "
            "(user_id, vault_id, vault_path, content_hash, body_md, updated_at, received_at,"
            " attachments_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id, vault_id, vault_path,
                content_hash or f"h-{vault_path}-{updated_at}",
                body_md, updated_at, received_at if received_at is not None else updated_at,
                None if attachments is None else json.dumps(attachments),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _manifest(user_id, vault_id, paths, recorded_at="2026-09-02T00:00:00Z"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "DELETE FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        )
        conn.executemany(
            "INSERT INTO j2_obsidian_manifest (user_id, vault_id, vault_path, recorded_at) "
            "VALUES (?, ?, ?, ?)",
            [(user_id, vault_id, p, recorded_at) for p in paths],
        )
        conn.commit()
    finally:
        conn.close()


def _device(user_id, vault_id, label="My Vault"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_obsidian_devices (id, user_id, vault_id, token_enc, label, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (f"dev-{user_id}-{vault_id}", user_id, vault_id, "enc", label, "2026-09-02T00:00:00Z"),
        )
        conn.commit()
    finally:
        conn.close()


T1 = "2026-09-01T00:00:00Z"
T2 = "2026-09-02T00:00:00Z"
T3 = "2026-09-03T00:00:00Z"


# ---------------------------------------------------------------------------
# validate()
# ---------------------------------------------------------------------------

async def test_validate_returns_the_real_device_label(db):
    _device("user-a", "vault-1", label="Trading Vault")
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    info = await provider.validate({})
    assert info.label == "Trading Vault"
    assert info.raw == {"vaultId": "vault-1"}


async def test_validate_falls_back_when_no_device_row_or_label(db):
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    info = await provider.validate({})
    assert "vault-1" in info.label


# ---------------------------------------------------------------------------
# list_changed — cursor semantics
# ---------------------------------------------------------------------------

async def test_list_changed_returns_only_rows_newer_than_cursor_and_cursor_advances(db):
    _stage("user-a", "vault-1", "a.md", "# A", T1)
    _stage("user-a", "vault-1", "b.md", "# B", T2)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    full = await provider.list_changed({}, cursor=None)
    assert {r.remote_id for r in full} == {"a.md", "b.md"}

    # Advance the cursor to T1 (as the engine would, deriving
    # max(ref.updated_at) from a round that only saw "a.md") -- only "b.md"
    # (strictly newer) must come back.
    delta = await provider.list_changed({}, cursor=T1)
    assert [r.remote_id for r in delta] == ["b.md"]

    # A cursor at the newest seen value returns nothing further...
    delta2 = await provider.list_changed({}, cursor=T2)
    assert delta2 == []

    # ...until a genuinely newer push lands, which the SAME advanced cursor
    # then picks up -- proving the cursor is actually honoured, not just
    # accepted and ignored.
    _stage("user-a", "vault-1", "c.md", "# C", T3)
    delta3 = await provider.list_changed({}, cursor=T2)
    assert [r.remote_id for r in delta3] == ["c.md"]


async def test_list_changed_cursors_on_received_at_not_the_client_supplied_updated_at(db):
    """C1 (2026-09-02 security review): a client-supplied `updated_at` must
    never become the sync cursor -- `list_changed` filters/orders on
    `received_at` (server-assigned) and publishes it via `opaque_cursor`
    (`base.py`'s Dropbox-precedent extension point), which the engine
    persists VERBATIM in place of its default `max(ref.updated_at)`
    derivation. This stages the poisoned row directly (bypassing
    `obsidian_staging.ingest_batch`'s own ingest-time clamp -- see
    `test_obsidian_ingest.py` for that layer) so this test proves the
    cursor mechanism itself holds independent of that other layer."""
    _stage("user-a", "vault-1", "poison.md", "# Poison", "9999-12-31T23:59:59Z",
           received_at=T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    refs = await provider.list_changed({}, cursor=None)
    assert {r.remote_id for r in refs} == {"poison.md"}
    assert provider.opaque_cursor == T1, \
        "the published cursor must be received_at, never the poisoned updated_at"

    _stage("user-a", "vault-1", "later.md", "# Later", T2, received_at=T2)
    delta = await provider.list_changed({}, cursor=provider.opaque_cursor)
    assert {r.remote_id for r in delta} == {"later.md"}, (
        "the poisoned row's absurd updated_at must not have poisoned the "
        "cursor and hidden this genuinely later note"
    )
    assert provider.opaque_cursor == T2


async def test_list_changed_republishes_the_same_cursor_when_nothing_is_newer(db):
    """When no row is newer than `cursor`, `opaque_cursor` must still equal
    `cursor` (not fall back to the class-level `None` default) -- otherwise
    the engine's unconditional `update_cursor` call would silently revert
    the source to "no sync has ever completed," re-triggering a full
    re-list on the provider's next pass."""
    _stage("user-a", "vault-1", "a.md", "# A", T1, received_at=T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    delta = await provider.list_changed({}, cursor=T2)  # nothing newer than T2
    assert delta == []
    assert provider.opaque_cursor == T2


# ---------------------------------------------------------------------------
# fetch() — produced via the REAL converter, asserted on structure
# ---------------------------------------------------------------------------

async def test_fetch_produces_a_remote_note_from_the_existing_converter(db):
    body = "# Trade Idea\n\nLong **NVDA** above the prior day high."
    _stage("user-a", "vault-1", "Notes/idea.md", body, T1)
    _manifest("user-a", "vault-1", ["Notes/idea.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    note = await provider.fetch({}, RemoteRef(remote_id="Notes/idea.md", updated_at=T1))

    # This is the load-bearing assertion: the doc/media/links this provider
    # returns must be BYTE-IDENTICAL to calling the shared converter
    # directly on the same (wikilink/highlight-free) body -- proving no
    # second, hand-rolled converter exists in this file.
    expected = md_to_tiptap(body)
    assert note.doc == expected["doc"]
    assert note.media == expected["media"]
    assert note.links == expected["links"]

    assert note.remote_id == "Notes/idea.md"
    assert note.title == "Trade Idea"  # from the real H1 heading node
    assert note.folder_path == ["Notes"]
    assert note.updated_at == T1
    assert note.created_at is None


async def test_fetch_turns_an_unsafe_image_into_an_unsafe_notice(db):
    """Plan A Task 15 fix round 1 (controller ruling): the Obsidian connector passes
    `unsafe_image_notice=True`, so a javascript:/vbscript: image -- raw or percent-encoded --
    is an importNotice `unsafe` where it stood, never media and never `[unsupported image]`."""
    body = "Look ![chart](javascript%3Aalert(1)) here\n\n![](vbscript:msgbox(1))\n"
    _stage("user-a", "vault-1", "Notes/bad.md", body, T1)
    _manifest("user-a", "vault-1", ["Notes/bad.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="Notes/bad.md", updated_at=T1))
    notice = lambda name: {"type": "importNotice", "attrs": {  # noqa: E731
        "reason": "unsafe", "name": name, "sourceUrl": None, "ref": None, "attempts": 0}}
    assert note.media == []
    assert note.doc["content"] == [
        {"type": "paragraph", "content": [{"type": "text", "text": "Look "}]},
        notice("chart"),
        {"type": "paragraph", "content": [{"type": "text", "text": " here"}]},
        notice(None)]


async def test_fetch_title_falls_back_to_filename_when_no_h1(db):
    _stage("user-a", "vault-1", "Notes/plain.md", "just a paragraph", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="Notes/plain.md", updated_at=T1))
    assert note.title == "plain"


async def test_fetch_raises_named_error_for_a_vault_path_no_longer_staged(db):
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch({}, RemoteRef(remote_id="ghost.md", updated_at=T1))


# ---------------------------------------------------------------------------
# fetch_many — batched, order-preserving
# ---------------------------------------------------------------------------

async def test_fetch_many_preserves_ref_order_and_batches_in_one_query(db):
    _stage("user-a", "vault-1", "a.md", "# A", T1)
    _stage("user-a", "vault-1", "b.md", "# B", T2)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    refs = [
        RemoteRef(remote_id="b.md", updated_at=T2),
        RemoteRef(remote_id="a.md", updated_at=T1),
    ]
    notes = await provider.fetch_many({}, refs)
    assert [n.remote_id for n in notes] == ["b.md", "a.md"]
    assert [n.title for n in notes] == ["B", "A"]


async def test_fetch_many_raises_on_a_missing_row_so_the_engine_can_fall_back(db):
    _stage("user-a", "vault-1", "a.md", "# A", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    refs = [
        RemoteRef(remote_id="a.md", updated_at=T1),
        RemoteRef(remote_id="missing.md", updated_at=T1),
    ]
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_many({}, refs)


# ---------------------------------------------------------------------------
# list_present_refs — the manifest's complete set, and delete detection
# ---------------------------------------------------------------------------

async def test_list_present_refs_returns_exactly_the_manifest_set(db):
    _manifest("user-a", "vault-1", ["a.md", "b.md", "Notes/c.md"], recorded_at=T2)
    # Staging can disagree with the manifest (a file changed since the last
    # full push, or one that was never re-staged) -- list_present_refs must
    # answer from the MANIFEST alone, not staging.
    _stage("user-a", "vault-1", "a.md", "# A", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    refs = await provider.list_present_refs({})
    assert {r.remote_id for r in refs} == {"a.md", "b.md", "Notes/c.md"}
    assert all(r.updated_at == T2 for r in refs)


async def test_a_vault_path_removed_from_the_manifest_is_absent_from_list_present_refs(db):
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    _manifest("user-a", "vault-1", ["a.md", "b.md"], recorded_at=T1)
    refs1 = await provider.list_present_refs({})
    assert {r.remote_id for r in refs1} == {"a.md", "b.md"}

    # A new full push's manifest no longer lists "b.md" -- ingest_batch's
    # own atomic DELETE+INSERT replaces the whole set for (user, vault).
    _manifest("user-a", "vault-1", ["a.md"], recorded_at=T2)
    refs2 = await provider.list_present_refs({})
    assert {r.remote_id for r in refs2} == {"a.md"}
    assert "b.md" not in {r.remote_id for r in refs2}


# ---------------------------------------------------------------------------
# Cross-tenant isolation — the test that matters most
# ---------------------------------------------------------------------------

async def test_a_note_staged_for_user_a_is_never_returned_for_user_b(db):
    # SAME vault_id on purpose -- nothing about vault_id alone should be
    # relied on for isolation; user_id must always be part of the filter.
    _stage("user-a", "vault-1", "secret.md", "# A's secret", T1)
    _stage("user-b", "vault-1", "other.md", "# B's note", T1)
    _manifest("user-a", "vault-1", ["secret.md"])
    _manifest("user-b", "vault-1", ["other.md"])

    provider_b = ObsidianProvider(user_id="user-b", vault_id="vault-1")

    changed = await provider_b.list_changed({}, cursor=None)
    assert "secret.md" not in {r.remote_id for r in changed}
    assert {r.remote_id for r in changed} == {"other.md"}

    present = await provider_b.list_present_refs({})
    assert {r.remote_id for r in present} == {"other.md"}

    with pytest.raises(errors.NoteConnUnsupported):
        # user-b's provider must not be able to fetch user-a's row, even
        # when asked for it by exact vault_path.
        await provider_b.fetch({}, RemoteRef(remote_id="secret.md", updated_at=T1))

    # And the reverse direction holds too.
    provider_a = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider_a.fetch({}, RemoteRef(remote_id="secret.md", updated_at=T1))
    assert note.remote_id == "secret.md"


# ---------------------------------------------------------------------------
# Obsidian wiki-syntax pre-pass — wikilinks
# ---------------------------------------------------------------------------

async def test_a_resolvable_wikilink_becomes_a_real_link_mark_to_the_right_import_key(db):
    _stage("user-a", "vault-1", "Setups/VCP.md", "# VCP", T1)
    _stage("user-a", "vault-1", "a.md", "see [[Setups/VCP|the setup]]", T2)
    _manifest("user-a", "vault-1", ["Setups/VCP.md", "a.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T2))
    paragraph = note.doc["content"][0]
    text_node = next(n for n in paragraph["content"] if n.get("text") == "the setup")
    link_mark = next(m for m in text_node["marks"] if m["type"] == "link")
    assert link_mark["attrs"]["href"] == "import-link://obsidian:vault-1/Setups/VCP.md"
    assert note.links == ["obsidian:vault-1/Setups/VCP.md"]


async def test_a_bare_wikilink_with_no_alias_resolves_by_basename(db):
    _stage("user-a", "vault-1", "Deep/Nested/Target.md", "# Target", T1)
    _stage("user-a", "vault-1", "a.md", "[[Target]]", T2)
    _manifest("user-a", "vault-1", ["Deep/Nested/Target.md", "a.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T2))
    html_text = note.doc["content"][0]["content"][0]
    assert html_text["text"] == "Target"
    link_mark = next(m for m in html_text["marks"] if m["type"] == "link")
    assert link_mark["attrs"]["href"] == "import-link://obsidian:vault-1/Deep/Nested/Target.md"


async def test_an_unresolvable_wikilink_keeps_its_text_and_waits_under_a_name_key(db):
    # Plan A Task 13 (O-4): it used to degrade to plain text, so a note created later
    # could never heal it. It is now a pending `name:obsidian:` mark (see the
    # pure-conversion tests at the end of this file).
    _stage("user-a", "vault-1", "a.md", "see [[Ghost Note]] over there", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    paragraph = note.doc["content"][0]
    joined = "".join(n.get("text", "") for n in paragraph["content"])
    assert joined == "see Ghost Note over there"
    assert note.links == ["name:obsidian:vault-1/ghost note"]


# ---------------------------------------------------------------------------
# Obsidian wiki-syntax pre-pass — highlights
# ---------------------------------------------------------------------------

async def test_a_highlight_becomes_a_highlight_mark_like_the_file_importer(db):
    # N5 (wave 5 review): the schema has a highlight mark now, and the FILE
    # importer (adapters/obsidian.js) keeps `==x==` as one. The sync lane used
    # to strip it to bare text, so the same vault read differently by lane.
    _stage("user-a", "vault-1", "a.md", "this is ==very important== to note", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    paragraph = note.doc["content"][0]
    joined = "".join(n.get("text", "") for n in paragraph["content"])
    assert joined == "this is very important to note"
    assert "==" not in joined
    assert "<mark>" not in joined  # never degrade to literal, visible HTML
    marked = [n["text"] for n in paragraph["content"]
              if any(m.get("type") == "highlight" for m in n.get("marks") or [])]
    assert marked == ["very important"]


async def test_a_highlight_keeps_the_marks_inside_it(db):
    _stage("user-a", "vault-1", "a.md", "the ==**key** level== holds", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    runs = [(n["text"], sorted(m["type"] for m in n.get("marks") or []))
            for n in note.doc["content"][0]["content"]]
    assert runs == [("the ", []), ("key", ["bold", "highlight"]), (" level", ["highlight"]), (" holds", [])]


async def test_a_comparison_is_never_read_as_a_highlight(db):
    body = "If rsi == 30 and macd == 0 then buy. close==open stays. The ==key level== holds."
    _stage("user-a", "vault-1", "a.md", body, T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    joined = "".join(n.get("text", "") for n in note.doc["content"][0]["content"])
    assert joined == "If rsi == 30 and macd == 0 then buy. close==open stays. The key level holds."


# ---------------------------------------------------------------------------
# Code fences protect wiki-syntax inside them (mirrors the JS adapter rail)
# ---------------------------------------------------------------------------

async def test_wiki_syntax_inside_a_code_fence_is_left_untouched(db):
    body = "before [[Real Link]]\n\n```\n[[Fake Link]] ==fake==\n```\n\nafter ==real=="
    _stage("user-a", "vault-1", "a.md", body, T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    code_block = next(n for n in note.doc["content"] if n["type"] == "codeBlock")
    code_text = code_block["content"][0]["text"]
    assert "[[Fake Link]]" in code_text
    assert "==fake==" in code_text


# ---------------------------------------------------------------------------
# Task lists — already handled by the existing converter; this proves it
# survives unmodified all the way through THIS provider.
# ---------------------------------------------------------------------------

async def test_task_list_checkbox_state_survives_the_provider_pipeline(db):
    body = "- [ ] todo\n- [x] done"
    _stage("user-a", "vault-1", "a.md", body, T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    task_list = next(n for n in note.doc["content"] if n["type"] == "taskList")
    checked_states = [item["attrs"]["checked"] for item in task_list["content"]]
    assert checked_states == [False, True]


# ---------------------------------------------------------------------------
# Embeds — a local image the plugin sent no ref for is registered as media but
# honestly unfetchable. Plan C Task 3: these rows carry an attachment LIST (`[]`, a
# 0.2.0 plugin whose list does not name the file); a row with NO list is the
# old-plugin case and gets a visible notice instead (tests further down).
# ---------------------------------------------------------------------------

async def test_a_local_image_embed_registers_media_but_is_not_a_broken_link(db):
    _stage("user-a", "vault-1", "files/chart.png", "", T1)
    _stage("user-a", "vault-1", "a.md", "![[chart.png]]", T2, attachments=[])
    _manifest("user-a", "vault-1", ["files/chart.png", "a.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T2))
    assert len(note.media) == 1
    assert note.media[0]["ref"] == "files/chart.png"
    # A lone image is hoisted to a block-level node by the real converter
    # (not wrapped in a paragraph) -- asserted here exactly as md_to_tiptap
    # itself produces it, not as a shape this test invents.
    image_node = note.doc["content"][0]
    assert image_node["type"] == "image"
    assert image_node["attrs"]["src"] == "import-ref://files/chart.png"

    # And fetching that media ref is an honest, named refusal -- not a crash.
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media({}, "files/chart.png")


async def test_a_local_image_embed_on_a_row_without_a_list_is_an_outdated_notice(db):
    """The same note from a 0.1.x plugin (no attachment list, no recorded version): a
    visible notice telling the member to update the plugin, never media."""
    _stage("user-a", "vault-1", "a.md", "![[chart.png]]", T2)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T2))
    assert note.media == []
    assert note.doc["content"][0]["type"] == "importNotice"
    assert note.doc["content"][0]["attrs"]["reason"] == "obsidian-plugin-outdated"
    assert note.doc["content"][0]["attrs"]["name"] == "chart.png"


async def test_an_unresolvable_embed_renders_as_plain_text_not_a_broken_image(db):
    _stage("user-a", "vault-1", "a.md", "before ![[missing.png]] after", T1, attachments=[])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    assert note.media == []
    paragraph = note.doc["content"][0]
    assert not any(n["type"] == "image" for n in paragraph["content"])
    joined = "".join(n.get("text", "") for n in paragraph["content"])
    assert "missing.png" in joined


# ---------------------------------------------------------------------------
# fetch_media — no remote to fetch a local attachment from, but a genuine
# external https reference still works via the shared SSRF-guarded fetch.
# ---------------------------------------------------------------------------

async def test_fetch_media_downloads_a_genuine_external_https_reference(db):
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://example.com/chart.png"
        return httpx.Response(200, content=b"bytes", headers={"content-type": "image/png"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1", client=client)
    content, content_type = await provider.fetch_media({}, "https://example.com/chart.png")
    assert content == b"bytes"
    assert content_type == "image/png"
    await provider.aclose()


async def test_http_hotlink_is_downloaded(db):
    """Plan A Task 9 (I-5): an http hotlink in a vault note is copied in (download only)."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, content=b"bytes", headers={"content-type": "image/png"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1", client=client)
    assert await provider.fetch_media({}, "http://1.1.1.1/chart.png") == (b"bytes", "image/png")
    assert seen == ["http://1.1.1.1/chart.png"]
    await provider.aclose()


async def test_fetch_media_refuses_a_non_https_reference(db):
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media({}, "Notes/attachments/file.pdf")


# ---------------------------------------------------------------------------
# ⛔⛔ session-audit.md A1 — the honest markdown-side boundary. Nothing
# anywhere previously synced/imported a note bigger than a few KB; note
# size is the one property that broke this feature. `notes.MAX_BODY_JSON_
# CHARS_ESTIMATE` derives the ingest-side ceiling from the STORAGE-side
# `notes.MAX_BODY_JSON_BYTES` and the measured worst-case md->TipTap
# blowup (4.7x) -- these two tests prove that derivation is honest AND
# that it is only an ESTIMATE, not a proof, which is exactly why
# `import_confirm`'s per-note isolation stays as the real backstop.
# ---------------------------------------------------------------------------

def _checkbox_markdown(n_items: int) -> str:
    """A real Obsidian task-list shape (checkbox items), same family the
    audit measured at 4.08x-4.27x blowup -- close to the 4.7x worst case
    `MAX_BODY_MD_CHARS_ESTIMATE` is derived from, so a note built from this
    shape right at the boundary is a meaningful, non-cherry-picked proof."""
    return "\n".join(
        f"- [{'x' if i % 2 else ' '}] Task item number {i} for today"
        for i in range(n_items)
    )


async def test_a_note_right_at_the_derived_markdown_boundary_round_trips(db):
    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import obsidian_staging

    # Binary-search the largest checkbox-shaped note that still clears the
    # real ingest-side `_MAX_BODY_MD_LEN` (derived from `MAX_BODY_JSON_
    # BYTES` -- session-audit.md A1) -- this is the boundary a real member's
    # daily-notes/checklist file would actually sit at, not an arbitrary
    # round number.
    lo, hi, best_n = 1, 20_000, 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(_checkbox_markdown(mid)) <= obsidian_staging._MAX_BODY_MD_LEN:
            best_n, lo = mid, mid + 1
        else:
            hi = mid - 1
    body_md = _checkbox_markdown(best_n)
    assert len(body_md) <= obsidian_staging._MAX_BODY_MD_LEN  # clears the ingest door

    _stage("user-a", "vault-1", "Daily/checklist.md", body_md, T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="Daily/checklist.md", updated_at=T1))

    body_json_bytes = len(json.dumps(note.doc).encode("utf-8"))
    assert body_json_bytes < notes_svc.MAX_BODY_JSON_BYTES  # clears the storage door

    # And the round trip actually completes through the real storage layer
    # -- not just a byte-count check against the converter's output.
    entry = {
        "importKey": "obsidian:vault-1:Daily/checklist.md",
        "title": note.title, "bodyJson": note.doc, "tags": [], "folderPath": [],
    }
    r = notes_svc.import_confirm(
        "user-a", {"source": "obsidian", "destFolderId": None, "notes": [entry]},
    )
    assert [n["importKey"] for n in r["created"]] == [entry["importKey"]]
    assert r["failed"] == []


def test_the_worst_case_blowup_estimate_is_not_a_guarantee(db):
    """The 4.7x figure `MAX_BODY_MD_CHARS_ESTIMATE` is derived from is the
    WORST of three measured shapes (session-audit.md A1), not a proven
    ceiling. A different real shape (many short headings, each followed by
    a one-line note) blows up FAR past it -- proving the estimate alone is
    not sufficient, and `import_confirm`'s per-note isolation (not a bigger
    safety margin here) is the real backstop for a shape nobody measured."""
    from api.services.journal_two import notes as notes_svc

    md = "\n".join(f"## {i}\nnote {i}" for i in range(2000))
    doc = md_to_tiptap(md)["doc"]
    blowup = len(json.dumps(doc).encode("utf-8")) / len(md.encode("utf-8"))
    assert blowup > notes_svc._MD_TO_JSON_WORST_CASE_BLOWUP, (
        "this shape must exceed the constant's own 'worst case' label, or "
        "the test proves nothing about the estimate's limits"
    )


# ---------------------------------------------------------------------------
# Names with spaces, escaped pipes, literal percent signs (O-1, O-8)
# ---------------------------------------------------------------------------

async def _fetch_a(body, paths, *, attachments=None):
    for path in paths:
        _stage("user-a", "vault-1", path, "", T1)
    _stage("user-a", "vault-1", "a.md", body, T2, attachments=attachments)
    _manifest("user-a", "vault-1", [*paths, "a.md"])
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    return await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T2))


def _link_marks(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        for m in node.get("marks") or []:
            if m.get("type") == "link":
                out.append((node.get("text"), m["attrs"]["href"]))
        for c in node.get("content") or []:
            _link_marks(c, out)
    return out


async def test_wikilink_to_a_name_with_spaces_resolves_to_the_import_key(db):
    note = await _fetch_a("[[Target Note]]", ["Notes/Target Note.md"])
    assert note.links == ["obsidian:vault-1/Notes/Target Note.md"]


async def test_aliased_link_with_spaces_keeps_the_alias_text(db):
    note = await _fetch_a("[[Target Note|alias]]", ["Notes/Target Note.md"])
    assert _link_marks(note.doc) == [
        ("alias", "import-link://obsidian:vault-1/Notes/Target Note.md")
    ]


async def test_escaped_pipe_in_a_table_cell_resolves(db):
    body = "| h |\n|---|\n| [[Other note\\|alias]] |\n"
    note = await _fetch_a(body, ["Other note.md"])
    assert note.links == ["obsidian:vault-1/Other note.md"]
    assert _link_marks(note.doc) == [
        ("alias", "import-link://obsidian:vault-1/Other note.md")
    ]


async def test_embedded_image_with_space_registers_the_raw_vault_path(db):
    # A list that does not name the file (Plan C Task 3): the pre-plan-C path, unchanged.
    note = await _fetch_a("![[My Img.png]]", ["attachments/My Img.png"], attachments=[])
    assert [m["ref"] for m in note.media] == ["attachments/My Img.png"]
    assert note.doc["content"][0]["attrs"]["src"] == "import-ref://attachments/My Img.png"


async def test_a_literal_percent_twenty_in_a_name_survives(db):
    note = await _fetch_a("[[100%20club]]", ["100%20club.md"])
    assert note.links == ["obsidian:vault-1/100%20club.md"]


# ---------------------------------------------------------------------------
# Plan A Task 13 (O-4, O-5, §5.2 polish): links that heal later, relative links,
# deep links, anchors, note embeds, callouts, duplicate names, raw HTML.
# Pure conversion -- `_convert_row` is what `fetch`/`fetch_many` run, minus the DB.
# ---------------------------------------------------------------------------

_V = "vault-1"


def _convert(body, paths=(), *, self_path="Notes/Src.md", label=None,
             refs=NO_ATTACHMENT_PASS, supports=False):
    paths = sorted({*paths, self_path})
    provider = ObsidianProvider(user_id="user-a", vault_id=_V)
    return provider._convert_row(self_path, body, paths, _build_basename_map(paths),
                                 vault_label=label, refs=refs, plugin_supports=supports)


def _key(path):
    return f"import-link://obsidian:{_V}/{path}"


def test_unresolved_wikilink_keeps_display_text_and_a_pending_key():
    out = _convert("see [[Ghost Note]] and [[Ghost Note#Risk|the risk]].", [])
    # `|notes`: the linking note's folder, so the heal applies the same-folder rule too.
    pending = f"import-link://name:obsidian:{_V}/ghost note|notes"
    assert _link_marks(out["doc"]) == [("Ghost Note", pending), ("the risk", pending)]
    assert out["links"] == [f"name:obsidian:{_V}/ghost note|notes"] * 2
    assert extract_plain_text(out["doc"]) == "see Ghost Note and the risk."


def test_relative_markdown_links_resolve():
    paths = ["Notes/Other note.md", "Notes/Other.md", "Archive/Deep.md"]
    body = ("[a](Other%20note.md) [b](../Notes/Other.md) [c](<Other note.md#Heading>) "
            "[d](Archive/Deep.md) [e](https://example.com/x.md) [f](#local) [g](Missing.md) "
            "[h](./Other.md)")
    out = _convert(body, paths)
    assert _link_marks(out["doc"]) == [
        ("a", _key("Notes/Other note.md")),
        ("b", _key("Notes/Other.md")),
        ("c", _key("Notes/Other note.md")),
        ("d", _key("Archive/Deep.md")),          # not beside the note: the vault root
        ("e", "https://example.com/x.md"),       # a scheme is never the vault's business
        ("f", "#local"),                         # left to the one link policy (Task 10)
        # May arrive later: as written, with the linking note's folder, marked relative.
        ("g", f"import-link://name:obsidian:{_V}/missing.md|notes|rel"),
        ("h", _key("Notes/Other.md")),
    ]


def test_obsidian_deep_link_resolves_within_the_vault():
    body = ("[o](obsidian://open?vault=Trading&file=Notes%2FOther) "
            "[x](obsidian://open?vault=Elsewhere&file=Notes%2FOther)")
    out = _convert(body, ["Notes/Other.md"], label="Trading")
    # Another vault's link is not this vault's note: it stays text (Task 10's policy).
    assert _link_marks(out["doc"]) == [("o", _key("Notes/Other.md"))]
    assert out["links"] == [f"obsidian:{_V}/Notes/Other.md"]
    assert extract_plain_text(out["doc"]) == "o x"


def test_heading_anchor_display_reads_note_then_heading():
    body = "[[Other note#Risk]] [[Other note#^abc123]] [[Other note#Risk|r]]"
    out = _convert(body, ["Notes/Other note.md"])
    assert _link_marks(out["doc"]) == [
        ("Other note > Risk", _key("Notes/Other note.md")),
        ("Other note", _key("Notes/Other note.md")),   # a block id is not a heading
        ("r", _key("Notes/Other note.md")),
    ]


def test_note_embed_text_has_no_md_extension():
    out = _convert("![[Other note]]", ["Notes/Other note.md"])
    assert _link_marks(out["doc"]) == [("Other note", _key("Notes/Other note.md"))]


def test_callout_becomes_a_native_callout():
    out = _convert("> [!warning] Size\n> text", [])
    assert out["doc"]["content"] == [{
        "type": "callout", "attrs": {"variant": "warning"},
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Size", "marks": [{"type": "bold"}]}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "text"}]},
        ],
    }]
    for written, variant, title in [
        ("note", "note", "Note"), ("INFO", "info", "INFO"), ("success", "success", "Success"),
        ("danger", "danger", "Danger"), ("tip", "success", "Tip"), ("caution", "warning", "Caution"),
        ("important", "warning", "Important"), ("bug", "danger", "Bug"),
        ("failure", "danger", "Failure"), ("zebra", "note", "Zebra"),
    ]:
        got = _convert(f"> [!{written}]-\n> body", [])["doc"]["content"][0]
        assert (got["type"], got["attrs"], got["content"][0]["content"][0]["text"]) == \
            ("callout", {"variant": variant}, title), written
    # A quote that is not a callout stays a quote; a marker mid-quote is just text.
    plain = _convert("> just a quote\n> [!note] later", [])["doc"]["content"][0]
    assert plain["type"] == "blockquote"


def test_duplicate_basenames_prefer_same_folder_then_shortest():
    paths = ["A/Deep/Plan.md", "B/Plan.md", "Notes/Sub/Plan.md", "C/Plan.md"]
    bmap = _build_basename_map(paths)
    assert _resolve_target("Plan", paths, bmap, from_path="Notes/Sub/Src.md") == "Notes/Sub/Plan.md"
    assert _resolve_target("Plan", paths, bmap, from_path="Other/Src.md") == "B/Plan.md"
    assert _resolve_target("Plan", paths, bmap) == "B/Plan.md"
    out = _convert("[[Plan]]", paths, self_path="Notes/Sub/Src.md")
    assert out["links"] == [f"obsidian:{_V}/Notes/Sub/Plan.md"]


def test_raw_img_and_a_html_become_image_and_link():
    body = ('Before <a href="https://example.com/x">site</a> after.\n\n'
            '<img src="https://example.com/c.png" alt="c">\n\n'
            'Inline <img src="files/d.png"> here, <a href="Other%20note.md">o</a> and '
            '<a href="javascript:alert(1)">bad</a>.')
    out = _convert(body, ["Notes/Other note.md"])
    assert _link_marks(out["doc"]) == [
        ("site", "https://example.com/x"), ("o", _key("Notes/Other note.md"))]
    images = [n["attrs"]["src"] for n in out["doc"]["content"] if n["type"] == "image"]
    assert images == ["import-ref://https://example.com/c.png", "import-ref://files/d.png"]
    assert [m["ref"] for m in out["media"]] == ["https://example.com/c.png", "files/d.png"]
    text = extract_plain_text(out["doc"])
    assert "<" not in text and "bad" in text


# ── Fix round 1 ──────────────────────────────────────────────────────────────

async def test_one_vault_index_per_fetch_batch_not_one_per_note(db, monkeypatch):
    """I-1: the vault's path index is built ONCE per `fetch_many` and shared by every
    note's link resolution. ⚰️ The relative resolver rebuilt a path dict per note
    (O(notes x paths) on a first sync, on the event loop)."""
    from api.services.journal_two.note_connectors.providers import obsidian as obs

    built: list[int] = []
    real_init = obs._VaultIndex.__init__

    def counting_init(self, paths):
        built.append(len(paths))
        real_init(self, paths)

    monkeypatch.setattr(obs._VaultIndex, "__init__", counting_init)
    names = [f"Notes/n{i}.md" for i in range(6)]
    for i, path in enumerate(names):
        _stage("user-a", "vault-1", path,
               f"[next](n{(i + 1) % 6}.md) [[Ghost {i}]] [up](../Notes/n0.md)", T1)
    _manifest("user-a", "vault-1", names)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    notes = await provider.fetch_many({}, [RemoteRef(remote_id=p, updated_at=T1) for p in names])
    assert len(notes) == 6
    assert all(n.links[0].startswith("obsidian:vault-1/Notes/n") for n in notes)
    assert built == [6]


def test_an_image_whose_src_is_a_deep_link_is_left_alone():
    """M-2: only a LINK to `obsidian://open` is this vault's business. An image with
    that src is never rewritten into an `import-link://` image; it stays a media ref
    the provider refuses by name (a visible notice), and joins no `links`."""
    body = ("![pic](obsidian://open?vault=Trading&file=Plan) "
            "[see [the] plan](obsidian://open?vault=Trading&file=Plan)")
    out = _convert(body, ["Plan.md"], label="Trading")
    images = [n["attrs"]["src"] for n in out["doc"]["content"] if n["type"] == "image"]
    assert images == ["import-ref://obsidian://open?vault=Trading&file=Plan"]
    assert out["links"] == [f"obsidian:{_V}/Plan.md"]
    assert _link_marks(out["doc"]) == [("see [the] plan", _key("Plan.md"))]


def test_tilde_fences_are_code_for_every_obsidian_pass():
    """M-4: a `~~~` fence is code: no wikilink, highlight, deep link or callout inside it
    is rewritten."""
    fenced = ("> [!note] Title\n> body\n[[Plan]] ==hi== "
              "[d](obsidian://open?vault=Trading&file=Plan)")
    out = _convert(f"~~~\n{fenced}\n~~~\n\n[[Plan]]", ["Plan.md"], label="Trading")
    code = next(n for n in out["doc"]["content"] if n["type"] == "codeBlock")
    assert code["content"][0]["text"] == fenced
    assert out["links"] == [f"obsidian:{_V}/Plan.md"]  # the one OUTSIDE the fence


# ── Fix round 2 ──────────────────────────────────────────────────────────────

def _cells(doc):
    table = next(n for n in doc["content"] if n["type"] == "table")
    return [["".join(t.get("text", "") for p in cell["content"] for t in p.get("content") or [])
             for cell in row["content"]] for row in table["content"]]


def test_a_pending_link_in_a_sub_folder_note_survives_a_table_cell():
    """The `|<folder>` field of a pending key is written into the markdown BEFORE it is
    parsed, and a GFM table splits a cell on a bare `|`. ⚰️ `| [[Ghost]] | x |` in
    `Notes/Src.md` became three cells and `links == []`. `_pct` writes `|` as `%7C`; the
    one decode in mddoc turns it back, so the key stored equals the key the heal matches."""
    body = ("| a | b |\n|---|---|\n| [[Ghost]] | x |\n"
            "| [d](obsidian://open?vault=Trading&file=Later) | y |\n")
    out = _convert(body, [], self_path="Notes/Src.md", label="Trading")
    assert _cells(out["doc"]) == [["a", "b"], ["Ghost", "x"], ["d", "y"]]
    ghost = f"name:obsidian:{_V}/ghost|notes"
    later = f"name:obsidian:{_V}/later|notes"
    assert out["links"] == [ghost, later]
    assert _link_marks(out["doc"]) == [
        ("Ghost", f"import-link://{ghost}"), ("d", f"import-link://{later}")]


# ---------------------------------------------------------------------------
# Plan C Task 3: attachment refs become images, file chips and visible notices;
# `fetch_media` serves the staged bytes.
# ---------------------------------------------------------------------------

_SHA = "a" * 64


def REF(**k):
    return {"original": "![[chart.png]]", "embed": True, "path": "attachments/chart.png",
            "size": 10, "sha256": _SHA, "status": "ok", **k}


def _nodes(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        out.append(node)
        for c in node.get("content") or []:
            _nodes(c, out)
    return out


def _all(doc, type_):
    return [n for n in _nodes(doc) if n.get("type") == type_]


def _only(doc, type_):
    found = _all(doc, type_)
    assert len(found) == 1, (type_, found)
    return found[0]


def _plain(doc):
    return " ".join(n.get("text", "") for n in _nodes(doc) if n.get("type") == "text")


def test_wiki_embed_with_ref_becomes_an_image_not_literal_text():
    conv = _convert("Above\n\n![[chart.png]]\n", refs=[REF()])
    img = _only(conv["doc"], "image")
    assert img["attrs"]["src"] == "import-ref://obsidian-att:" + _SHA + "/chart.png"
    assert "chart.png" not in _plain(conv["doc"])
    assert conv["media"] == [{"ref": "obsidian-att:" + _SHA + "/chart.png", "kind": "image",
                              "name": "chart.png"}]


def test_width_suffix_and_markdown_image_relative_path_resolve_via_original():
    sha2 = "b" * 64
    refs = [REF(original="![[chart.png|300]]"),
            REF(original="![](attachments/chart%20one.png)", path="attachments/chart one.png",
                sha256=sha2)]
    conv = _convert("![[chart.png|300]]\n\n![](attachments/chart%20one.png)\n", refs=refs)
    srcs = [n["attrs"]["src"] for n in _all(conv["doc"], "image")]
    assert srcs == ["import-ref://obsidian-att:" + _SHA + "/chart.png",
                    "import-ref://obsidian-att:" + sha2 + "/chart%20one.png"]
    assert [m["name"] for m in conv["media"]] == ["chart.png", "chart one.png"]
    assert "300" not in _plain(conv["doc"])


def test_pdf_embed_and_markdown_file_link_become_attachment_chips():
    sha2 = "c" * 64
    refs = [REF(original="![[report.pdf]]", path="docs/report.pdf"),
            REF(original="[report](report.pdf)", embed=False, path="report.pdf", sha256=sha2)]
    conv = _convert("![[report.pdf]]\n\nsee [report](report.pdf) here\n", refs=refs)
    chips = _all(conv["doc"], "attachmentChip")
    assert [c["attrs"] for c in chips] == [
        {"href": "import-ref://obsidian-file:" + _SHA + "/report.pdf", "name": "report.pdf"},
        {"href": "import-ref://obsidian-file:" + sha2 + "/report.pdf", "name": "report.pdf"},
    ]
    assert _all(conv["doc"], "image") == []
    assert conv["media"] == [
        {"ref": "obsidian-file:" + _SHA + "/report.pdf", "kind": "file", "name": "report.pdf"},
        {"ref": "obsidian-file:" + sha2 + "/report.pdf", "kind": "file", "name": "report.pdf"},
    ]
    assert "see" in _plain(conv["doc"]) and "here" in _plain(conv["doc"])


def test_an_image_linked_not_embedded_is_a_file_chip():
    conv = _convert("[[chart.png]]", refs=[REF(original="[[chart.png]]", embed=False)])
    assert _only(conv["doc"], "attachmentChip")["attrs"]["name"] == "chart.png"
    assert conv["media"][0]["kind"] == "file"


@pytest.mark.parametrize("status,size,reason,name", [
    ("too-large", 32715571, "too-large", "big.mov (31.2 MB)"),
    ("missing", 0, "not-found", "big.mov"),
    ("off", 5, "sync-off", "big.mov"),
    ("storage-limit", 5, "storage-limit", "big.mov"),
])
def test_each_non_ok_status_becomes_an_import_notice_with_the_right_reason(status, size, reason, name):
    sha = _SHA if status == "storage-limit" else None
    ref = REF(original="![[big.mov]]", path="att/big.mov", size=size, sha256=sha, status=status)
    conv = _convert("Before\n\n![[big.mov]]\n\nAfter", refs=[ref])
    notice = _only(conv["doc"], "importNotice")
    assert notice["attrs"] == {"reason": reason, "name": name, "sourceUrl": None, "ref": None,
                               "attempts": 0}
    assert conv["media"] == []
    assert _all(conv["doc"], "image") == []
    assert "Before" in _plain(conv["doc"]) and "After" in _plain(conv["doc"])


def test_old_plugin_row_marks_local_attachments_outdated_and_leaves_note_links_and_urls():
    body = ("![[x.png]]\n\n![](a/x.png)\n\n[f](f.pdf)\n\n[[Other note]]\n\n"
            "![](https://e.x/i.png)\n")
    conv = _convert(body, ["Other note.md"], refs=None, supports=False)
    notices = _all(conv["doc"], "importNotice")
    assert [(n["attrs"]["reason"], n["attrs"]["name"]) for n in notices] == [
        ("obsidian-plugin-outdated", "x.png"), ("obsidian-plugin-outdated", "x.png"),
        ("obsidian-plugin-outdated", "f.pdf")]
    assert conv["links"] == [f"obsidian:{_V}/Other note.md"]
    assert [m["ref"] for m in conv["media"]] == ["https://e.x/i.png"]
    assert [n["attrs"]["src"] for n in _all(conv["doc"], "image")] == ["import-ref://https://e.x/i.png"]


def test_old_plugin_row_leaves_note_names_with_dots_alone():
    conv = _convert("[[Plan v1.2]] and [x](Call%202026.01.05)", refs=None)
    assert _all(conv["doc"], "importNotice") == []


def test_a_hash_in_an_attachment_name_is_the_file_not_a_note_in_the_fallbacks():
    """Task 4 review M2: a `#`-holding target whose own extension is an attachment's is a
    FILE name in the fallbacks too, as in `_resolve_in` (ruling 1). Old plugin: the update
    notice for the whole name. New plugin, no ref: the name as text. Never a pending note
    link reading `my chart`."""
    body = "![[my chart #1 (v2).png]]\n\n[[report #2.pdf]]"
    old = _convert(body, refs=None, supports=False)
    assert [(n["attrs"]["reason"], n["attrs"]["name"]) for n in _all(old["doc"], "importNotice")] == [
        ("obsidian-plugin-outdated", "my chart #1 (v2).png"),
        ("obsidian-plugin-outdated", "report #2.pdf")]
    assert old["links"] == []
    new = _convert("![[my chart #1 (v2).png]]", refs=[])
    assert new["links"] == []
    assert _all(new["doc"], "importNotice") == []
    assert "my chart #1 (v2).png" in _plain(new["doc"])
    # R3: the LINK form too (not only the embed), as the client shows it: the name as
    # text, never a pending link `report > 2.pdf` to a note `report`.
    link = _convert("see [[report #2.pdf]] and [[q3 #4.xlsx|the sheet]] now", refs=[])
    assert link["links"] == []
    assert _link_marks(link["doc"]) == []
    assert _plain(link["doc"]) == "see report #2.pdf and the sheet now"
    # An anchor on a NOTE still splits: `[[Ghost#Risk]]` waits for `Ghost`, both ways.
    for refs in (None, []):
        conv = _convert("[[Ghost#Risk]] ![[Ghost#Risk]]", refs=refs)
        assert _all(conv["doc"], "importNotice") == []
        assert conv["links"] == [f"name:obsidian:{_V}/ghost|notes"] * 2


def test_new_plugin_row_without_list_says_unavailable_not_outdated():
    conv = _convert("![[x.png]]", refs=None, supports=True)
    assert _only(conv["doc"], "importNotice")["attrs"]["reason"] == "obsidian-attachments-unavailable"


def test_original_inside_code_is_not_rewritten():
    conv = _convert("`![[chart.png]]`\n\n```\n![[chart.png]]\n```\n", refs=[REF()])
    assert _all(conv["doc"], "image") == []
    assert conv["media"] == []
    assert "![[chart.png]]" in _plain(conv["doc"])


def test_attachment_names_round_trip_exactly():  # Review Focus 1
    for name in ["my chart #1 (v2).png", "Ünïcode.png", "100% done.png"]:
        conv = _convert(f"![[{name}]]", refs=[REF(original=f"![[{name}]]", path=f"att/{name}")])
        assert conv["media"][0]["name"] == name
        assert conv["media"][0]["ref"].startswith("obsidian-att:" + _SHA + "/")
        assert _only(conv["doc"], "image")["attrs"]["src"] == "import-ref://" + conv["media"][0]["ref"]
    for name in ["my chart #1 (v2).pdf", "100% done.pdf"]:
        conv = _convert(f"![[{name}]]", refs=[REF(original=f"![[{name}]]", path=f"att/{name}")])
        assert _only(conv["doc"], "attachmentChip")["attrs"]["name"] == name
        assert conv["media"][0]["name"] == name
    conv = _convert("![[my #1 (v2).mov]]", refs=[REF(original="![[my #1 (v2).mov]]",
                                                    path="att/my #1 (v2).mov", status="missing",
                                                    sha256=None, size=0)])
    assert _only(conv["doc"], "importNotice")["attrs"]["name"] == "my #1 (v2).mov"


def test_overlapping_originals_rewrite_longest_first():
    """`[[a.png]]` (a link: a file chip) is a substring of `![[a.png]]` (an embed: an image).
    Written shortest-first, the embed would become `!` plus a chip. The refs list puts the
    short one FIRST on purpose: only the longest-first order gets this right."""
    sha2 = "d" * 64
    refs = [REF(original="[[a.png]]", embed=False, path="a.png", sha256=sha2),
            REF(original="![[a.png]]", path="a.png"),
            REF(original="![[a.png|300]]", path="a.png")]
    conv = _convert("![[a.png]]\n\n[[a.png]]\n\n![[a.png|300]]\n", refs=refs)
    assert [n["type"] for n in conv["doc"]["content"]] == ["image", "attachmentChip", "image"]
    assert "!" not in _plain(conv["doc"])
    assert conv["media"] == [
        {"ref": "obsidian-att:" + _SHA + "/a.png", "kind": "image", "name": "a.png"},
        {"ref": "obsidian-file:" + sha2 + "/a.png", "kind": "file", "name": "a.png"},
    ]


def test_every_occurrence_of_an_original_is_rewritten():
    conv = _convert("![[chart.png]] and again ![[chart.png]]", refs=[REF()])
    assert len(_all(conv["doc"], "image")) == 2
    assert len(conv["media"]) == 1


def test_an_empty_list_rewrites_nothing_and_raises_no_notice():
    conv = _convert("![[x.png]]", ["att/x.png"], refs=[])
    assert _all(conv["doc"], "importNotice") == []


async def test_a_row_without_a_list_reads_the_device_plugin_version(db):
    _stage("user-a", "vault-1", "a.md", "![[x.png]]", T1)
    _device("user-a", "vault-1")
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    async def reason():
        note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
        return _only(note.doc, "importNotice")["attrs"]["reason"]

    assert await reason() == "obsidian-plugin-outdated"   # plugin_version NULL
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_obsidian_devices SET plugin_version = '0.2.0'")
    conn.commit()
    conn.close()
    assert await reason() == "obsidian-attachments-unavailable"


async def test_fetch_and_fetch_many_read_the_rows_attachment_list(db):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_obsidian_staging (user_id, vault_id, vault_path, content_hash, body_md,"
        " updated_at, received_at, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("user-a", "vault-1", "a.md", "h", "![[chart.png]]", T1, T1, json.dumps([REF()])))
    conn.commit()
    conn.close()
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    one = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    many = await provider.fetch_many({}, [RemoteRef(remote_id="a.md", updated_at=T1)])
    for note in (one, many[0]):
        assert note.media == [{"ref": "obsidian-att:" + _SHA + "/chart.png", "kind": "image",
                               "name": "chart.png"}]


@pytest.fixture
def env(db, tmp_path, monkeypatch):
    monkeypatch.setenv("J2_OBSIDIAN_BLOB_ROOT", str(tmp_path / "blobs"))
    _device("user-a", "vault-1")
    return tmp_path


async def test_fetch_media_serves_staged_blob_and_transient_when_missing(env):
    import hashlib

    from api.services.journal_two.note_connectors import obsidian_attachments

    data = b"\x89PNG staged bytes"
    sha = hashlib.sha256(data).hexdigest()

    async def chunks():
        yield data

    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    with pytest.raises(errors.NoteConnTransient) as exc:
        await provider.fetch_media({}, f"obsidian-att:{sha}/chart.png")
    assert exc.value.status == 404
    assert await obsidian_attachments.stage_blob_stream(
        user_id="user-a", vault_id="vault-1", sha256=sha, declared_mime="image/png",
        name="chart.png", chunks=chunks(), declared_length=len(data))
    assert await provider.fetch_media({}, f"obsidian-att:{sha}/chart.png") == (data, "image/png")
    assert await provider.fetch_media({}, f"obsidian-file:{sha}/x.pdf") == (data, "image/png")
    # Scoped to (member, vault): another vault of the same member cannot read it.
    other = ObsidianProvider(user_id="user-a", vault_id="vault-2")
    with pytest.raises(errors.NoteConnTransient):
        await other.fetch_media({}, f"obsidian-file:{sha}/x.pdf")
    # A blob staged with no declared type is served as octet-stream.
    data2 = b"no type"
    sha2 = hashlib.sha256(data2).hexdigest()

    async def chunks2():
        yield data2

    await obsidian_attachments.stage_blob_stream(
        user_id="user-a", vault_id="vault-1", sha256=sha2, declared_mime=None, name="x.bin",
        chunks=chunks2(), declared_length=len(data2))
    assert await provider.fetch_media({}, f"obsidian-file:{sha2}/x.bin") == (
        data2, "application/octet-stream")
    # Anything else is still today's honest refusal.
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media({}, "attachments/chart.png")


def test_dropbox_attachment_promotion_unchanged():
    """The Dropbox tree walk moved into `convert/placeholders.py::map_image_nodes`. Its output
    must be byte-identical to the walk it replaced (copied here verbatim as the reference)
    over the inputs the Dropbox md-attachment tests use: a relative file link, a relative
    image, a nested list, a table cell and an external image."""
    from api.services.journal_two.note_connectors.convert import REF_PREFIX
    from api.services.journal_two.note_connectors.providers import dropbox as dbx

    def reference(converted):
        marker = f"{REF_PREFIX}{dbx._MD_ATTACH_SCHEME}"

        def walk(node):
            if not isinstance(node, dict):
                return node
            if node.get("type") == "image":
                src = (node.get("attrs") or {}).get("src", "")
                if src.startswith(marker):
                    ref = src[len(REF_PREFIX):]
                    return {"type": "attachmentChip",
                            "attrs": {"href": src, "name": dbx._basename_of_ref(ref)}}
                return node
            if isinstance(node.get("content"), list):
                new_node = dict(node)
                new_node["content"] = [walk(c) for c in node["content"]]
                return new_node
            return node

        doc = walk(converted["doc"])
        media = [{**m, "kind": "file"} if m.get("ref", "").startswith(dbx._MD_ATTACH_SCHEME) else m
                 for m in converted["media"]]
        return {"doc": doc, "media": media, "links": converted["links"]}

    inputs = [
        "See ![q3 report](<dbx-md-attach:/notes/q3%20report.pdf>) for detail.\n",
        "![chart](<dbx-md-media:/notes/chart.png>)\n\n![](https://example.com/x.png)\n",
        "- item\n  - ![f](<dbx-md-attach:/notes/a.zip>)\n",
        "| a | b |\n|---|---|\n| ![f](<dbx-md-attach:/x.pdf>) | y |\n",
        "plain text only\n",
    ]
    provider = dbx.DropboxProvider.__new__(dbx.DropboxProvider)
    for text in inputs:
        converted = md_to_tiptap(text, unsafe_image_notice=True)
        assert json.dumps(provider._promote_md_attachments(converted), sort_keys=False) == \
            json.dumps(reference(converted), sort_keys=False), text


_STAGED_SHA = "e" * 64
_MISSING_SHA = "f" * 64


def _retrying_body(sha=_STAGED_SHA, *, attempts=1):
    """A stored body holding one "retrying" notice for an Obsidian blob ref (what the engine
    writes when `fetch_media` raised Transient)."""
    return {"type": "doc", "content": [{"type": "importNotice", "attrs": {
        "reason": "fetch_failed", "name": "chart.png", "sourceUrl": None,
        "ref": f"obsidian-att:{sha}/chart.png", "attempts": attempts}}]}


def _staged_blob(sha=_STAGED_SHA, *, vault="vault-1", user="user-a"):
    conn = auth_db.get_connection()
    conn.execute("INSERT INTO j2_obsidian_attachments (user_id, vault_id, sha256, size,"
                 " received_at) VALUES (?, ?, ?, 1, ?)", (user, vault, sha, T1))
    conn.commit()
    conn.close()


def _synced_note(path, *, pending, updated_at=T1, imported_at=T1, vault="vault-1", user="user-a",
                 body=None, key_suffix=""):
    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, import_key, import_media_pending, created_at,"
        " updated_at, imported_at, body_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (f"n-{user}-{vault}-{path}{key_suffix}", user, path, f"obsidian:{vault}/{path}{key_suffix}",
         pending, T1, updated_at, imported_at,
         json.dumps(body if body is not None else _retrying_body())))
    conn.commit()
    conn.close()


async def test_list_changed_relists_a_note_still_waiting_on_media_without_moving_the_cursor(db):
    """Plan C Task 3: a note whose media retry can succeed NOW (its blob has been staged since)
    comes back even though nothing new was pushed; the cursor still moves only on pushed rows."""
    _stage("user-a", "vault-1", "waiting.md", "x", T1)
    _stage("user-a", "vault-1", "done.md", "x", T1)
    _stage("user-a", "vault-1", "edited.md", "x", T1)
    _stage("user-a", "vault-1", "new.md", "x", T3)
    _staged_blob()
    _synced_note("waiting.md", pending=1)
    _synced_note("done.md", pending=0)
    _synced_note("edited.md", pending=1, updated_at=T3, imported_at=T1)   # the member's now
    _synced_note("waiting.md", pending=1, vault="vault-2")                # another vault
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")

    refs = await provider.list_changed({}, cursor=T2)
    assert [r.remote_id for r in refs] == ["new.md", "waiting.md"]
    assert provider.opaque_cursor == T3

    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    refs = await provider.list_changed({}, cursor=T3)
    assert [r.remote_id for r in refs] == ["waiting.md"]
    assert provider.opaque_cursor == T3   # never regressed to the waiting row's received_at


def test_every_reason_this_provider_writes_has_its_own_sentence():
    """The six reason codes are in plan A's closed notice vocabulary (an unknown code would
    read as `unsupported`). The server table is pinned equal to the client's by
    `tests/test_import_notice.py`, so this covers both renderers."""
    from api.services.journal_two import import_notice
    from api.services.journal_two.note_connectors.providers import obsidian as obs

    written = {obs.OUTDATED_REASON, obs.UNAVAILABLE_REASON, *obs._STATUS_REASONS.values()}
    assert written == {"obsidian-plugin-outdated", "obsidian-attachments-unavailable", "not-found",
                       "too-large", "sync-off", "storage-limit"}
    for reason in written:
        assert import_notice._reason(reason) != "unsupported", reason
    assert import_notice.marker_text("obsidian-plugin-outdated", "x.png") == (
        "x.png wasn't synced. Update the UCT Notebook Sync plugin in Obsidian to bring images and files over.")
    assert import_notice.marker_text("obsidian-attachments-unavailable", "x.png") == (
        "x.png wasn't synced yet. It will be retried on the next sync.")
    assert import_notice.marker_text("not-found", "x.png") == "x.png wasn't found in the vault."
    assert import_notice.marker_text("sync-off", "x.png") == (
        "x.png wasn't synced because image and file sync is turned off in the plugin settings.")


# ── Plan C Task 3, fix round 1 ───────────────────────────────────────────────

def test_old_plugin_row_keeps_links_to_dotted_note_names():
    """I1: a row with no attachment list must not read a NOTE whose name has a dot as a file.
    `[[Dr.Smith]]`, `[[Q3.Review|alias]]` and `[[Drawing.excalidraw]]` (with those notes
    staged) stay note links, alias text and all."""
    paths = ["People/Dr.Smith.md", "Q3.Review.md", "Drawing.excalidraw.md"]
    body = "[[Dr.Smith]] then [[Q3.Review|alias]] then [[Drawing.excalidraw]]\n\n![[Drawing.excalidraw]]\n"
    conv = _convert(body, paths, refs=None, supports=False)
    without_pass = _convert(body, paths)
    assert _all(conv["doc"], "importNotice") == []
    # Exactly what the same note converts to with no attachment pass at all: the link keys
    # and the member's text, alias included. D1: the dotted names now RESOLVE to their notes
    # (they used to stay pending), and the note embed reads as a link to that note.
    assert conv["links"] == without_pass["links"] == [
        f"obsidian:{_V}/People/Dr.Smith.md", f"obsidian:{_V}/Q3.Review.md",
        f"obsidian:{_V}/Drawing.excalidraw.md", f"obsidian:{_V}/Drawing.excalidraw.md"]
    assert [t for t, _h in _link_marks(conv["doc"])] == [
        "Dr.Smith", "alias", "Drawing.excalidraw", "Drawing.excalidraw"]
    assert conv["doc"] == without_pass["doc"]


def test_old_plugin_row_only_marks_known_attachment_extensions():
    """I1: an unresolved dotted name that is not a known file type (`[[Mr.Jones]]`,
    `[[notes.final]]`) is a pending note link, never an "update your plugin" notice."""
    conv = _convert("[[Mr.Jones]] and [[notes.final]] and ![[clip.mp4]] and [d](deck.pptx)",
                    refs=None)
    assert [n["attrs"]["name"] for n in _all(conv["doc"], "importNotice")] == ["clip.mp4", "deck.pptx"]
    assert [t for t, _h in _link_marks(conv["doc"])] == ["Mr.Jones", "notes.final"]


def test_a_ref_whose_path_has_no_file_name_is_left_as_written():
    """M4: `path` ending in `/` names no file. The ref is ignored (its original stays as the
    member wrote it), never a chip with an empty name."""
    ref = REF(original="[[att/]]", path="att/", embed=False)
    conv = _convert("see [[att/]]", refs=[ref])
    assert _all(conv["doc"], "attachmentChip") == [] and conv["media"] == []
    assert all(m["name"] for m in conv["media"])


def test_original_text_inside_a_replacement_is_never_rewritten_again():
    """N4: an `original` (`chart.png`) that occurs inside another ref's written replacement
    must not be re-matched: matching by position in the member's text (D2 item 2; a token
    indirection before it) is what keeps the image intact."""
    refs = [REF(), REF(original="chart.png", embed=False, sha256="b" * 64)]
    conv = _convert("![[chart.png]]", refs=refs)
    assert _only(conv["doc"], "image")["attrs"]["src"] == "import-ref://obsidian-att:" + _SHA + "/chart.png"


def test_member_text_in_the_old_token_form_is_never_swapped_for_an_attachment():
    """D2 item 2: the pass used to write `\\x00obsidian-ref-N\\x00` tokens and then replace
    every occurrence, so a note that already held that text (NUL characters and all) got an
    attachment where the member wrote words. Each `original` is now matched against the
    member's text once, by position, and nothing else is ever replaced."""
    member = "\x00obsidian-ref-0\x00 \x00obsidian-ref-1\x00 \x00\x00obsidian-ref-0\x00\x00"
    sha2 = "b" * 64
    refs = [REF(), REF(original="[[q.pdf]]", embed=False, path="q.pdf", sha256=sha2)]
    seg = f"![[chart.png]] {member} [[q.pdf]] {member}"
    out = _apply_attachment_refs(seg, refs, True)
    image = f"![](<obsidian-att:{_SHA}/chart.png>)"
    chip = f"![](<obsidian-file:{sha2}/q.pdf>)"
    assert out == f"{image} {member} {chip} {member}"
    conv = _convert(f"Above {member}\n\n![[chart.png]]\n\n{member} [[q.pdf]]\n", refs=refs)
    assert len(_all(conv["doc"], "image")) == 1
    assert len(_all(conv["doc"], "attachmentChip")) == 1
    assert _plain(conv["doc"]).count("obsidian-ref-") == 6


def test_overlapping_originals_still_rewrite_longest_first_by_position():
    """D2 item 2: the positional pass keeps the old order. A longer original claims its text
    first; a shorter one is matched only outside it, and never across it."""
    sha2 = "d" * 64
    refs = [REF(original="[[a.png]]", embed=False, path="a.png", sha256=sha2),
            REF(original="![[a.png]]", path="a.png")]
    out = _apply_attachment_refs("[[a.png]]![[a.png]][[a.png]]", refs, True)
    chip = f"![](<obsidian-file:{sha2}/a.png>)"
    assert out == f"{chip}![](<obsidian-att:{_SHA}/a.png>){chip}"


async def test_fetch_media_refuses_a_malformed_sha_at_once(db):
    """N1: `obsidian-att:zzz/x` (only reachable by typing it) is a final refusal, never three
    "retrying" passes."""
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media({}, "obsidian-att:zzz/x.png")


async def test_a_note_waiting_on_a_blob_not_staged_yet_is_not_relisted(db):
    """I2: re-listing a note whose blob is still absent would only spend a retry attempt on a
    try that cannot succeed. It waits, untouched, until the blob is staged."""
    _stage("user-a", "vault-1", "waiting.md", "x", T1)
    _synced_note("waiting.md", pending=1, body=_retrying_body(_MISSING_SHA))
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert await provider.list_changed({}, cursor=T3) == []
    _staged_blob(_MISSING_SHA)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert [r.remote_id for r in await provider.list_changed({}, cursor=T3)] == ["waiting.md"]


async def test_a_staged_blob_of_another_vault_does_not_relist(db):
    _stage("user-a", "vault-1", "waiting.md", "x", T1)
    _synced_note("waiting.md", pending=1)
    _staged_blob(vault="vault-2")
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert await provider.list_changed({}, cursor=T3) == []


async def test_a_plugin_storage_limit_notice_is_never_relisted(db):
    """M1: a `storage-limit` notice the PLUGIN decided carries no ref; only the plugin's own
    re-push can clear it. Re-listing it after the engine's storage flip re-wrote the same
    notice on every other pass."""
    _stage("user-a", "vault-1", "full.md", "x", T1)
    _staged_blob()
    body = {"type": "doc", "content": [{"type": "importNotice", "attrs": {
        "reason": "storage-limit", "name": "chart.png", "sourceUrl": None, "ref": None,
        "attempts": 0}}]}
    _synced_note("full.md", pending=1, body=body)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert await provider.list_changed({}, cursor=T3) == []


async def test_an_engine_storage_wait_on_a_staged_blob_is_relisted_once_flipped(db):
    """The other storage case: the ENGINE's own `storage_limit` notice (it carries the ref)
    on a staged blob, flipped back to 1 once space freed, is retried."""
    _stage("user-a", "vault-1", "full.md", "x", T1)
    _staged_blob()
    body = {"type": "doc", "content": [{"type": "importNotice", "attrs": {
        "reason": "storage_limit", "name": "chart.png", "sourceUrl": None,
        "ref": f"obsidian-att:{_STAGED_SHA}/chart.png", "attempts": 0}}]}
    _synced_note("full.md", pending=1, body=body)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert [r.remote_id for r in await provider.list_changed({}, cursor=T3)] == ["full.md"]


async def test_literal_import_ref_text_does_not_relist_a_note(db):
    """M3: `import-ref://` typed as TEXT makes the stored body read as pending, but it is no
    placeholder; nothing can be retried, so the note is not re-listed."""
    _stage("user-a", "vault-1", "prose.md", "x", T1)
    _staged_blob()
    body = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": f"I wrote import-ref://obsidian-att:{_STAGED_SHA}/chart.png here"}]}]}
    _synced_note("prose.md", pending=1, body=body)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert await provider.list_changed({}, cursor=T3) == []


async def test_a_conflict_sibling_does_not_relist_its_edited_original(db):
    """M2: the `#remote` sibling of a member-edited note is never touched by the engine while
    the remote is unchanged, so its pending media must not re-list the original's path."""
    _stage("user-a", "vault-1", "plan.md", "x", T1)
    _staged_blob()
    _synced_note("plan.md", pending=0, updated_at=T3, imported_at=T1)       # edited original
    _synced_note("plan.md", pending=1, key_suffix="#remote")                # its sibling
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert await provider.list_changed({}, cursor=T3) == []


async def test_an_https_hotlink_retry_is_still_relisted(db):
    _stage("user-a", "vault-1", "web.md", "x", T1)
    body = {"type": "doc", "content": [{"type": "importNotice", "attrs": {
        "reason": "fetch_failed", "name": "i.png", "sourceUrl": "https://e.x/i.png",
        "ref": "https://e.x/i.png", "attempts": 1}}]}
    _synced_note("web.md", pending=1, body=body)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    assert [r.remote_id for r in await provider.list_changed({}, cursor=T3)] == ["web.md"]


def test_old_plugin_row_keeps_a_link_to_a_staged_note_named_like_a_file():
    """I1: a NOTE whose name ends in a file extension (`Brief.txt.md`, linked as
    `[[Brief.txt]]`) is a staged note, so the link stays a link; the same name with no such
    note is a file and gets the notice."""
    conv = _convert("[[Brief.txt|the brief]]", ["Brief.txt.md"], refs=None)
    assert _all(conv["doc"], "importNotice") == []
    assert [t for t, _h in _link_marks(conv["doc"])] == ["the brief"]
    conv = _convert("[[Brief.txt|the brief]]", [], refs=None)
    assert _only(conv["doc"], "importNotice")["attrs"]["name"] == "Brief.txt"


# ---------------------------------------------------------------------------
# D1: a dot in a note's NAME is not an extension. `[[Dr.Smith]]` names `Dr.Smith.md`
# (Obsidian's rule); only a known attachment extension makes the target a file.
# ---------------------------------------------------------------------------


def test_a_wikilink_to_a_note_with_a_dot_in_its_name_resolves_to_the_note():
    paths = ["People/Dr.Smith.md", "Notes/v1.2 notes.md"]
    bmap = _build_basename_map(paths)
    assert _resolve_target("Dr.Smith", paths, bmap) == "People/Dr.Smith.md"
    assert _resolve_target("v1.2 notes", paths, bmap) == "Notes/v1.2 notes.md"
    assert _resolve_target("Dr.Smith.md", paths, bmap) == "People/Dr.Smith.md"
    out = _convert("[[Dr.Smith]] and [[v1.2 notes]]", paths)
    assert _link_marks(out["doc"]) == [
        ("Dr.Smith", _key("People/Dr.Smith.md")),
        ("v1.2 notes", _key("Notes/v1.2 notes.md")),
    ]
    assert out["links"] == [f"obsidian:{_V}/People/Dr.Smith.md", f"obsidian:{_V}/Notes/v1.2 notes.md"]


def test_a_dotted_note_name_with_an_alias_resolves_and_keeps_the_alias():
    out = _convert("[[Q3.Review|the review]]", ["Reviews/Q3.Review.md"])
    assert _link_marks(out["doc"]) == [("the review", _key("Reviews/Q3.Review.md"))]


def test_a_dotted_note_name_with_a_heading_or_block_resolves_to_the_note():
    out = _convert("[[Dr.Smith#Intro]] [[Dr.Smith#^abc123]]", ["People/Dr.Smith.md"])
    assert _link_marks(out["doc"]) == [
        ("Dr.Smith > Intro", _key("People/Dr.Smith.md")),
        ("Dr.Smith", _key("People/Dr.Smith.md")),
    ]


def test_the_note_wins_over_a_file_sharing_its_dotted_stem():
    # `Dr.Smith.csv` sorts before `Dr.Smith.md`: the note is what `[[Dr.Smith]]` names.
    paths = ["People/Dr.Smith.csv", "People/Dr.Smith.md"]
    bmap = _build_basename_map(paths)
    assert _resolve_target("Dr.Smith", paths, bmap) == "People/Dr.Smith.md"
    assert _resolve_target("People/Dr.Smith", paths, bmap) == "People/Dr.Smith.md"


def test_the_exact_note_wins_even_when_the_target_ends_in_an_attachment_extension():
    # Follow-up ruling 2: `<target>.md`, when staged, always wins; only without it does an
    # attachment extension mean the file.
    def resolve(target, paths):
        return _resolve_target(target, paths, _build_basename_map(paths))
    assert resolve("report.pdf", ["report.pdf.md"]) == "report.pdf.md"
    assert resolve("report.pdf", ["Files/report.pdf", "report.pdf.md"]) == "report.pdf.md"
    assert resolve("Files/report.pdf", ["Files/report.pdf", "Files/report.pdf.md"]) == "Files/report.pdf.md"
    assert resolve("report.pdf", ["Files/report.pdf"]) == "Files/report.pdf"
    assert resolve("Files/report.pdf", ["Files/report.pdf"]) == "Files/report.pdf"
    out = _convert("[[Brief.txt|the brief]]", ["Brief.txt.md"], refs=None)
    assert _link_marks(out["doc"]) == [("the brief", _key("Brief.txt.md"))]


def test_an_unknown_dot_suffix_is_never_stripped_to_open_another_note():
    # Follow-up ruling 1: a wrong note is worse than a visible pending link.
    def resolve(target, paths):
        return _resolve_target(target, paths, _build_basename_map(paths))
    assert resolve("Dr.Smith", ["People/Dr.md"]) is None
    assert resolve("People/Dr.Smith", ["People/Dr.md"]) is None
    assert resolve("report.pdf", ["report.png"]) is None
    # Plan C Task 4 fix round 1: no stem match at all. `[[chart]]` names `chart.md` only.
    assert resolve("chart", ["Files/chart.png"]) is None
    out = _convert("[[Dr.Smith]]", ["Dr.md"])
    assert out["links"] == [f"name:obsidian:{_V}/dr.smith|notes"]


def test_a_missing_dotted_note_stays_pending_and_heals_when_it_arrives():
    out = _convert("[[Dr.Smith]]", [])
    pending = f"name:obsidian:{_V}/dr.smith|notes"
    assert _link_marks(out["doc"]) == [("Dr.Smith", f"import-link://{pending}")]
    assert out["links"] == [pending]
    assert resolve_pending_target("dr.smith|notes", _build_basename_map([])) is None
    arrived = _build_basename_map(["Notes/Src.md", "People/Dr.Smith.md"])
    assert resolve_pending_target("dr.smith|notes", arrived) == "People/Dr.Smith.md"


# ── D1 fix round 2 ───────────────────────────────────────────────────────────


def _r(target, paths, from_path=None):
    return _resolve_target(target, paths, _build_basename_map(paths), from_path=from_path)


def test_a_dotted_target_never_reaches_a_file_by_its_stem():
    """I1: the stem match is for a dot-less name only. A dotted name opens its note or the
    file of exactly that name, never `<name>.<ext>`."""
    assert _r("Dr.Smith", ["People/Dr.Smith.csv"]) is None
    assert _r("Dr.Smith", ["People/Dr.Smith.csv", "People/Dr.md"]) is None
    assert _r("People/Dr.Smith", ["People/Dr.Smith.csv"]) is None
    assert _r("Q3.Review", ["Q3.Review.xlsx", "Reviews/Q3.md"]) is None
    assert _r("report.pdf", ["report.pdf.png"]) is None
    assert _r("archive.tar", ["archive.tar.gz"]) is None
    assert _r("v1.2 notes", ["v1.2 notes.pdf"]) is None
    assert _r("Plan.md", ["Notes/Plan.md.bak"]) is None
    # Plan C Task 4 fix round 1: a dot-less name has no stem match either. Obsidian
    # assumes `.md` for a link with no extension: `[[chart]]` names `chart.md` only.
    assert _r("chart", ["img/chart.png"]) is None
    assert _r("img/chart", ["img/chart.png"]) is None
    assert _r("v1.2/chart", ["v1.2/chart.png"]) is None
    assert _r("chart", ["img/chart.png", "Notes/chart.md"]) == "Notes/chart.md"
    assert _r("img/chart", ["img/chart.png", "img/chart.md"]) == "img/chart.md"


def test_a_target_holding_a_hash_that_exactly_names_a_file_opens_that_file():
    """Plan C Task 4 fix round 1: the FULL target, anchor text included, is checked
    against the vault's file names first; only otherwise is the anchor split off."""
    name = "attachments/my chart #1 (v2).png"
    assert _r("my chart #1 (v2).png", [name]) == name
    assert _r("attachments/my chart #1 (v2).png", [name]) == name
    assert _r("MY CHART #1 (V2).PNG", [name]) == name
    # No file of that full name: the anchor splits as before.
    assert _r("Other note#Risk", ["Other note.md"]) == "Other note.md"
    assert _r("Other note#^abc123", ["Other note.md"]) == "Other note.md"
    assert _r("my chart #1 (v2).png", ["my chart.md"]) == "my chart.md"
    out = _convert("![[my chart #1 (v2).png]]", [name])
    assert out["media"] and out["media"][0]["ref"] == name


def test_the_exact_note_step_takes_only_the_note_never_a_note_with_a_second_extension():
    """I2: `<target>.md` exactly. A `Plan.md.bak` listed first never wins, and alone it is
    not the note."""
    for order in (["Notes/Plan.md.bak", "Notes/Plan.md"], ["Notes/Plan.md", "Notes/Plan.md.bak"]):
        assert _r("Notes/Plan", order) == "Notes/Plan.md"
        assert _r("Plan", order) == "Notes/Plan.md"
    assert _r("Notes/Plan", ["Notes/Plan.md.bak"]) is None
    assert _r("Files/report.pdf", ["Files/report.pdf.md.zip", "Files/report.pdf.md"]) == "Files/report.pdf.md"


def test_same_named_candidates_break_ties_the_same_way_whatever_the_listing_order():
    """M1: same folder as the linking note, then fewest folders, then sort order."""
    paths = ["Z/Setup.md", "B/Setup.md", "A/Deep/Setup.md"]
    assert _r("Setup", paths) == "B/Setup.md"
    assert _r("Setup", list(reversed(paths))) == "B/Setup.md"
    assert _r("Setup", paths, from_path="Z/Src.md") == "Z/Setup.md"
    assert _r("Setup", paths, from_path="A/Deep/Src.md") == "A/Deep/Setup.md"
    assert _r("Dr.Smith", ["A/B/Dr.Smith.md", "Dr.Smith.md"], from_path="Src.md") == "Dr.Smith.md"
    assert _r("report.pdf", ["Y/report.pdf", "X/report.pdf"]) == "X/report.pdf"


def test_a_missing_dotted_note_embed_waits_like_a_wikilink_and_a_missing_file_is_text():
    """M3: `![[Dr.Smith]]` before its note arrives is the same pending link `[[Dr.Smith]]` is,
    so it heals; `![[report.pdf]]` (a known attachment extension) stays plain text."""
    out = _convert("![[Dr.Smith]]\n\n![[report.pdf]]", [])
    pending = f"name:obsidian:{_V}/dr.smith|notes"
    assert _link_marks(out["doc"]) == [("Dr.Smith", f"import-link://{pending}")]
    assert out["links"] == [pending]
    assert extract_plain_text(out["doc"]) == "Dr.Smith report.pdf"


# ── D1 fix round 3 ───────────────────────────────────────────────────────────


def _runs(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            marks = node.get("marks") or []
            href = next((m["attrs"]["href"] for m in marks if m.get("type") == "link"), None)
            out.append((node.get("text"), "+".join(sorted(m["type"] for m in marks)), href))
        for c in node.get("content") or []:
            _runs(c, out)
    return out


def test_a_wikilink_inside_a_highlight_keeps_its_link_and_its_highlight():
    """N2: `==[[Plan]]==` is a highlighted LINK. The highlight pass used to escape the
    `<import-link://...>` destination, and the link was lost."""
    out = _convert("a ==[[Plan]]== b and ==see [[Plan|the plan]] & <more>== c", ["Plan.md"])
    assert _runs(out["doc"]) == [
        ("a ", "", None),
        ("Plan", "highlight+link", _key("Plan.md")),
        (" b and ", "", None),
        ("see ", "highlight", None),
        ("the plan", "highlight+link", _key("Plan.md")),
        (" & <more>", "highlight", None),
        (" c", "", None),
    ]
    assert out["links"] == [f"obsidian:{_V}/Plan.md"] * 2


def test_a_missing_dotted_note_inside_a_highlight_is_a_highlighted_pending_link():
    out = _convert("a ==[[Ghost.Name]]== b", [])
    pending = f"import-link://name:obsidian:{_V}/ghost.name|notes"
    assert _runs(out["doc"]) == [("a ", "", None), ("Ghost.Name", "highlight+link", pending), (" b", "", None)]
    assert extract_plain_text(out["doc"]) == "a Ghost.Name b"


def test_a_wikilink_in_a_callout_title_stays_a_link_in_the_bold_title():
    out = _convert("> [!note] See [[Plan]]\n> body", ["Plan.md"])
    callout = out["doc"]["content"][0]
    assert callout["type"] == "callout"
    assert _runs(callout["content"][0]) == [("See ", "bold", None), ("Plan", "bold+link", _key("Plan.md"))]
    assert extract_plain_text(out["doc"]) == "See Plan body"
