"""Tests for `providers/obsidian.py` — the push-transport provider that
reads Task 3's staging tables (`j2_obsidian_staging`/`j2_obsidian_manifest`)
and satisfies the ordinary `NoteProvider` contract over them, so the sync
engine's convert -> upsert -> conflict -> media path and its delete
detection are INHERITED, never re-implemented.

Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-4-brief.md
"""

from __future__ import annotations

import httpx
import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors
from api.services.journal_two.note_connectors.convert import md_to_tiptap
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider


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


def _stage(user_id, vault_id, vault_path, body_md, updated_at, *, content_hash=None):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO j2_obsidian_staging "
            "(user_id, vault_id, vault_path, content_hash, body_md, updated_at, received_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                user_id, vault_id, vault_path,
                content_hash or f"h-{vault_path}-{updated_at}",
                body_md, updated_at, updated_at,
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


async def test_an_unresolvable_wikilink_degrades_to_plain_text(db):
    _stage("user-a", "vault-1", "a.md", "see [[Ghost Note]] over there", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    paragraph = note.doc["content"][0]
    joined = "".join(n.get("text", "") for n in paragraph["content"])
    assert "Ghost Note" in joined
    assert note.links == []
    assert not any("link" in (n.get("marks") or [{}])[0].get("type", "") for n in paragraph["content"] if n.get("marks"))


# ---------------------------------------------------------------------------
# Obsidian wiki-syntax pre-pass — highlights
# ---------------------------------------------------------------------------

async def test_a_highlight_marker_is_stripped_but_the_text_survives(db):
    _stage("user-a", "vault-1", "a.md", "this is ==very important== to note", T1)
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    note = await provider.fetch({}, RemoteRef(remote_id="a.md", updated_at=T1))
    paragraph = note.doc["content"][0]
    joined = "".join(n.get("text", "") for n in paragraph["content"])
    assert joined == "this is very important to note"
    assert "==" not in joined
    assert "<mark>" not in joined  # never degrade to literal, visible HTML


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
# Embeds — a local image is registered as media but honestly unfetchable
# ---------------------------------------------------------------------------

async def test_a_local_image_embed_registers_media_but_is_not_a_broken_link(db):
    _stage("user-a", "vault-1", "files/chart.png", "", T1)
    _stage("user-a", "vault-1", "a.md", "![[chart.png]]", T2)
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


async def test_an_unresolvable_embed_renders_as_plain_text_not_a_broken_image(db):
    _stage("user-a", "vault-1", "a.md", "before ![[missing.png]] after", T1)
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


async def test_fetch_media_refuses_a_non_https_reference(db):
    provider = ObsidianProvider(user_id="user-a", vault_id="vault-1")
    with pytest.raises(errors.NoteConnUnsupported):
        await provider.fetch_media({}, "Notes/attachments/file.pdf")
