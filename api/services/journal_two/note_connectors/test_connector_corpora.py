"""The messy connector corpora, asserted on the STORED documents -- Plan A Task 14 (spec §10).

`corpora/corpora_gen.py` runs the real engine over a messy Notion workspace and a messy
Obsidian vault (no network: `httpx.MockTransport`, `base._resolve_host` patched). This module
runs it ONCE (module fixture, a few seconds), then:

  * `test_corpus_fixtures_are_current` compares the run's output with the committed
    `__fixtures__/connector_corpora/*.json` byte for byte (raw bytes; `.gitattributes` keeps
    both sides LF), so any converter/engine change that moves a stored document is red here
    until the fixtures are regenerated and the change is looked at;
  * every other test is ONE construct, asserted on the stored document as the engine wrote
    it (and, for media, on the stored file with Pillow -- jsdom decodes no image). Nothing is
    normalised before it is compared.

The DOM half is `app/src/pages/journal-2-0/lib/connectorCorpora.dom.test.js`.

The corpora exposed two REAL defects (Task 14), recorded as strict xfails and fixed by Task 15:
the member-edited note's edit time (D1) and the Obsidian unsafe-link markdown source (D2). Both
are now ordinary assertions. A future strict xfail here must pin `raises=` so it can only pass
for the reason it names.

Regenerate after a deliberate change:
    python -m api.services.journal_two.note_connectors.corpora.corpora_gen
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest
from PIL import Image

from api.services.journal_two import import_notice
from api.services.journal_two.note_connectors.corpora import corpora_gen as gen

NOTE_HREF = "/journal?j2tab=notebook&note={}"
ATTACHMENTS = "/api/j2/notes/attachments/"

HUB, Q3, CHILD, MEMBER, LATER = (
    "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555")
TRASHED, UNSHARED = "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"
VAULT = "vault-messy"


# ── the one run ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def work(tmp_path_factory) -> pathlib.Path:
    return tmp_path_factory.mktemp("corpora")


@pytest.fixture(scope="module")
def run(work) -> dict[str, dict[str, Any]]:
    return gen.build(work)


def _notes(run, corpus: str, user: str) -> dict[str, dict[str, Any]]:
    return {n["importKey"]: n for n in run[corpus]["members"][user]["notes"]}


@pytest.fixture(scope="module")
def notion(run):
    return _notes(run, "notion_messy", "u-notion")


@pytest.fixture(scope="module")
def obsidian(run):
    return _notes(run, "obsidian_messy", "u-obsidian")


def _n(notes, page_id: str) -> dict[str, Any]:
    return notes[f"notion:{page_id}"]


def _o(notes, path: str) -> dict[str, Any]:
    return notes[f"obsidian:{VAULT}/{path}"]


# ── walking a stored body (no normalising: raw attrs and text) ────────────────────

def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for child in node.get("content") or []:
            yield from _walk(child)


def _nodes(body, node_type: str) -> list[dict[str, Any]]:
    return [n for n in _walk(body) if n.get("type") == node_type]


def _links(body) -> list[tuple[str, str]]:
    """(text, href) for every text run carrying a link mark, in document order."""
    return [(n["text"], m["attrs"]["href"]) for n in _nodes(body, "text")
            for m in n.get("marks") or [] if m.get("type") == "link"]


def _href(body, text: str) -> str:
    hits = [href for t, href in _links(body) if t == text]
    assert len(hits) == 1, f"expected exactly one link reading {text!r}, got {hits}"
    return hits[0]


def _run_marks(body, text: str) -> list[dict[str, Any]]:
    hits = [n.get("marks") or [] for n in _nodes(body, "text") if n["text"] == text]
    assert len(hits) == 1, f"expected exactly one text run {text!r}, got {len(hits)}"
    return hits[0]


def _para_runs(body, starts: str) -> list[tuple[str, str | None]]:
    """The runs of the one paragraph whose text starts with `starts`, as (text, href)."""
    paras = [p for p in _nodes(body, "paragraph")
             if "".join(n.get("text", "") for n in _nodes(p, "text")).startswith(starts)]
    assert len(paras) == 1, f"expected one paragraph starting {starts!r}, got {len(paras)}"
    return [(n["text"], next((m["attrs"]["href"] for m in n.get("marks") or [] if m["type"] == "link"), None))
            for n in _nodes(paras[0], "text")]


def _notices(body) -> dict[str, dict[str, Any]]:
    out = {}
    for n in _nodes(body, "importNotice"):
        assert n["attrs"]["name"] not in out, f"two notices named {n['attrs']['name']!r}"
        out[n["attrs"]["name"]] = n["attrs"]
    return out


def _chips(body) -> dict[str, dict[str, Any]]:
    return {n["attrs"]["name"]: n["attrs"] for n in _nodes(body, "attachmentChip")}


def _file(work: pathlib.Path, corpus: str, url: str) -> pathlib.Path:
    assert url.startswith(ATTACHMENTS), url
    user, note_id, sub, name = url[len(ATTACHMENTS):].split("/")
    path = work / corpus / "att" / user / "notes" / note_id / sub / name
    assert path.is_file(), f"{url} has no stored file"
    return path


def _images_by_size(work, corpus: str, body) -> dict[tuple[int, int], dict[str, Any]]:
    """Every stored inline image of `body`, keyed by its natural size read from the STORED
    bytes with Pillow (jsdom decodes nothing)."""
    out: dict[tuple[int, int], dict[str, Any]] = {}
    for node in _nodes(body, "image"):
        path = _file(work, corpus, node["attrs"]["src"])
        with Image.open(path) as im:
            # Task 15: two images of one size would silently overwrite each other here, and a
            # construct test would then assert on whichever came last.
            assert im.size not in out, f"two images of size {im.size}: key by something else"
            out[im.size] = {"node": node, "path": path, "format": im.format,
                            "orientation": im.getexif().get(0x0112)}
    return out


# ── the drift rail ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("corpus", gen.CORPORA)
def test_corpus_fixtures_are_current(run, corpus):
    """Raw bytes, both sides LF (`.gitattributes`). A difference means the engine or a
    converter changed what a member's note STORES: look at the diff, then regenerate."""
    committed = (gen.FIXTURES_OUT_DIR / f"{corpus}.json").read_bytes()
    assert gen.render(run[corpus]).encode("utf-8") == committed, (
        f"{corpus}: the engine's stored output differs from the committed fixture. Review the "
        "change, then run `python -m api.services.journal_two.note_connectors.corpora.corpora_gen`.")


# ── the rail's own guards (Task 15) ─────────────────────────────────────────────────

def test_corpus_run_reached_no_network(run):
    """`gen.PUBLIC_TEST_ADDRESS` is a real Google address: the run must never have tried
    any outbound door (recorded, because the engine turns most failures into a notice)."""
    assert gen.LAST_RUN_REFUSED == []


def test_corpus_network_guard_refuses_every_outbound_door():
    import asyncio
    import socket

    import httpx

    original = socket.create_connection
    refused: list[str] = []
    with gen.no_network(refused):
        with pytest.raises(gen.NetworkRefused):
            socket.create_connection(("192.0.2.1", 443), timeout=0.2)
        with socket.socket() as s, pytest.raises(gen.NetworkRefused):
            s.settimeout(0.2)
            s.connect((gen.PUBLIC_TEST_ADDRESS, 443))
        with socket.socket() as s, pytest.raises(gen.NetworkRefused):
            s.settimeout(0.2)
            s.connect_ex(("192.0.2.1", 443))
        with pytest.raises(gen.NetworkRefused):
            socket.getaddrinfo("corpus-guard.invalid", 443)
        with httpx.Client(timeout=0.2) as client, pytest.raises(gen.NetworkRefused):
            client.get(f"https://{gen.PUBLIC_TEST_ADDRESS}/")

        async def async_get() -> None:
            async with httpx.AsyncClient(timeout=0.2) as client:
                await client.get(f"https://{gen.PUBLIC_TEST_ADDRESS}/")
        with pytest.raises(gen.NetworkRefused):
            asyncio.run(async_get())
        # CONTROL: loopback stays open (asyncio's self-pipe on Windows is a loopback socketpair).
        a, b = socket.socketpair()
        a.close(), b.close()
    assert len(refused) == 6, refused
    assert socket.create_connection is original  # restored on the way out


def test_corpus_build_runs_inside_the_network_guard(tmp_path, monkeypatch):
    """`build()` itself enters the guard (so `python -m ...corpora_gen` is guarded too), and a
    refusal the code under test SWALLOWS is still recorded."""
    import socket

    async def swallowing_run_all(_work_dir):
        try:
            socket.create_connection(("192.0.2.1", 443), timeout=0.2)
        except Exception:  # noqa: BLE001 -- the engine's own shape: a failure becomes a notice
            pass
        return {}

    saved = list(gen.LAST_RUN_REFUSED)
    monkeypatch.setattr(gen, "_run_all", swallowing_run_all)
    try:
        assert gen.build(tmp_path) == {}
        assert gen.LAST_RUN_REFUSED == ["socket.create_connection ('192.0.2.1', 443)"]
    finally:
        gen.LAST_RUN_REFUSED[:] = saved


def test_corpus_fixture_write_is_atomic(tmp_path, monkeypatch):
    """`generate()` writes through `_write_atomically`: a failed write leaves the committed
    fixture byte for byte and no stray temp file."""
    path = tmp_path / "corpus.json"
    path.write_bytes(b'{"committed": true}\n')
    with pytest.raises(UnicodeEncodeError):
        gen._write_atomically(path, '{"half": "\ud800"}\n')   # fails while encoding
    monkeypatch.setattr(gen.os, "replace", lambda *_a: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(OSError):
        gen._write_atomically(path, '{"new": true}\n')        # fails at the swap
    assert path.read_bytes() == b'{"committed": true}\n'
    assert sorted(p.name for p in tmp_path.iterdir()) == ["corpus.json"]
    monkeypatch.undo()
    gen._write_atomically(path, '{"new": true}\n')
    assert path.read_bytes() == b'{"new": true}\n'


def test_corpus_generate_writes_through_the_atomic_writer(tmp_path, monkeypatch):
    """...and `generate()` refuses to write anything after a run that tried the network."""
    written: list[str] = []
    monkeypatch.setattr(gen, "build", lambda _work: {"c": {"x": 1}})
    monkeypatch.setattr(gen, "_write_atomically", lambda path, text: written.append(path.name))
    assert [p.name for p in gen.generate(tmp_path)] == ["c.json"] and written == ["c.json"]
    saved = list(gen.LAST_RUN_REFUSED)
    gen.LAST_RUN_REFUSED[:] = ["socket.connect x"]
    try:
        with pytest.raises(gen.NetworkRefused):
            gen.generate(tmp_path)
    finally:
        gen.LAST_RUN_REFUSED[:] = saved
    assert written == ["c.json"]


def test_corpus_every_xfail_here_pins_what_it_expects():
    """A strict xfail with no `raises=` passes on ANY exception -- a typo'd fixture name, a
    KeyError -- so it can stay "expected" for a reason it never named (Task 15)."""
    import ast
    tree = ast.parse(pathlib.Path(__file__).read_text(encoding="utf-8"))
    loose = [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == "xfail"
             and not any(k.arg == "raises" for k in node.keywords)]
    assert loose == [], f"xfail without raises= at lines {loose}"


def test_images_by_size_refuses_two_images_of_one_size(work, wall):
    image = _nodes(wall, "image")[0]
    with pytest.raises(AssertionError, match="two images of size"):
        _images_by_size(work, "notion_messy", {"type": "doc", "content": [image, image]})


def test_corpus_nothing_is_left_as_an_import_placeholder(run):
    for corpus, result in run.items():
        for user, member in result["members"].items():
            for note in member["notes"]:
                assert "import-ref://" not in json.dumps(note["bodyJson"]), (corpus, user, note["title"])


def test_corpus_every_pass_completed(run):
    assert run["notion_messy"]["members"]["u-notion"]["passes"] == [
        {"status": "ok", "created": 61, "updated": 0, "skipped": 0, "mediaUploaded": 32, "conflicts": 0},
        {"status": "ok", "created": 2, "updated": 1, "skipped": 59, "mediaUploaded": 0, "conflicts": 1}]
    assert run["obsidian_messy"]["members"]["u-obsidian"]["passes"] == [
        {"status": "ok", "created": 9, "updated": 0, "skipped": 0, "mediaUploaded": 9, "conflicts": 0},
        {"status": "ok", "created": 2, "updated": 0, "skipped": 0, "mediaUploaded": 0, "conflicts": 1}]


# ── Notion: links ──────────────────────────────────────────────────────────────────

def test_corpus_notion_in_workspace_link_is_a_note_link(notion):
    assert _href(_n(notion, HUB)["bodyJson"], "Q3 plan (mention)") == NOTE_HREF.format(_n(notion, Q3)["id"])
    assert [h for t, h in _links(_n(notion, HUB)["bodyJson"]) if t == "Q3 plan"] == [
        NOTE_HREF.format(_n(notion, Q3)["id"])] * 2       # the relative link and the link_to_page


def test_corpus_notion_every_workspace_url_form_is_a_note_link(notion):
    body = _n(notion, HUB)["bodyJson"]
    forms = [(t, h) for t, h in _links(body) if t.startswith("Form ")]
    assert [t for t, _ in forms] == [
        "Form relative", "Form relative dashed", "Form relative slug", "Form relative anchor",
        "Form notion.so", "Form notion.so bare", "Form notion.so workspace", "Form notion.so upper",
        "Form notion.site", "Form notion.com", "Form notion deep link"]
    assert {h for _, h in forms} == {NOTE_HREF.format(_n(notion, Q3)["id"])}


def test_corpus_notion_unshared_target_is_pending(notion):
    assert _href(_n(notion, HUB)["bodyJson"], "Secret") == f"import-link://notion:{UNSHARED}"


def test_corpus_notion_trashed_target_is_pending(notion):
    assert _href(_n(notion, HUB)["bodyJson"], "Old idea") == f"import-link://notion:{TRASHED}"
    assert f"notion:{TRASHED}" not in notion
    assert _n(notion, HUB)["importLinksPending"] == 1


def test_corpus_notion_later_target_heals_without_touching_the_linking_note(notion):
    q3 = _n(notion, Q3)
    assert _href(q3["bodyJson"], "Later page") == NOTE_HREF.format(_n(notion, LATER)["id"])
    assert q3["importLinksPending"] == 0
    assert q3["updatedInLastPass"] is False, "a heal is timestamp-neutral"


def test_corpus_notion_link_mention_and_link_preview_stay_links(notion):
    body = _n(notion, HUB)["bodyJson"]
    assert _href(body, "Example Domain") == "https://example.com/article"
    assert _href(body, "https://github.com/octo/repo/pull/7") == "https://github.com/octo/repo/pull/7"


def test_corpus_notion_database_mention_keeps_its_notion_url(notion):
    assert _href(_n(notion, HUB)["bodyJson"], "Trades DB") == "https://www.notion.so/cccccccccccc4ccc8ccccccccccccccc"


def test_corpus_notion_user_and_date_mentions_are_text(notion):
    assert _para_runs(_n(notion, HUB)["bodyJson"], "@Patrick") == [
        ("@Patrick", None), (" on ", None), ("November 1, 2026", None)]


def test_corpus_notion_bare_urls_link_without_their_trailing_punctuation(notion):
    assert _para_runs(_n(notion, HUB)["bodyJson"], "See ") == [
        ("See ", None), ("https://example.com/a", "https://example.com/a"), (", and (", None),
        ("https://example.com/b", "https://example.com/b"), ("). Also ", None),
        ("www.example.org", "https://www.example.org"),
        ("! Ticker NVDA.US and BRK.B closed up; mail ", None),     # tickers are never links
        ("desk@example.com", "mailto:desk@example.com"), (".", None)]


def test_corpus_notion_urls_in_code_and_math_are_untouched(notion):
    body = _n(notion, HUB)["bodyJson"]
    assert _run_marks(body, "https://example.com/in-code") == [{"type": "code"}]
    assert _run_marks(body, "https://example.com/in-math") == [{"type": "code"}]
    blocks = {n["content"][0]["text"]: n for n in _nodes(body, "codeBlock")}
    assert set(blocks) == {"fetch('https://example.com/in-codeblock')", "https://example.com/in-block-math"}
    assert all("marks" not in n["content"][0] for n in blocks.values())


def test_corpus_notion_unsafe_schemes_become_text(notion):
    assert _para_runs(_n(notion, HUB)["bodyJson"], "script") == [
        ("script", None), (" | ", None), ("data page", None), (" | ", None),
        ("protocol-relative", "https://evil.example/x"), (" | ", None),
        ("call", "tel:+15550100"), (" | ", None), ("mail", "mailto:desk@example.com"), (" | ", None),
        ("relative path", None)]


def test_corpus_notion_link_to_page_carries_the_target_title(notion):
    links = _links(_n(notion, HUB)["bodyJson"])
    assert links[-3:] == [("Q3 plan", NOTE_HREF.format(_n(notion, Q3)["id"])),
                          ("Child page", NOTE_HREF.format(_n(notion, CHILD)["id"])),
                          ("https://example.com/bookmark", "https://example.com/bookmark")]


# ── Notion: media ──────────────────────────────────────────────────────────────────

MEDIA_WALL = "99999999-9999-4999-8999-999999999999"


@pytest.fixture(scope="module")
def wall(notion):
    return _n(notion, MEDIA_WALL)["bodyJson"]


@pytest.fixture(scope="module")
def wall_images(work, wall):
    return _images_by_size(work, "notion_messy", wall)


def test_corpus_notion_media_wall_keeps_every_item_in_place(wall):
    assert [n["type"] for n in wall["content"]] == [
        "image", "paragraph", "image", "image", "attachmentChip", "image", "attachmentChip", "image",
        "importNotice", "importNotice", "importNotice", "importNotice",
        "webEmbed", "paragraph", "attachmentChip", "paragraph", "webEmbed", "paragraph",
        "attachmentChip", "attachmentChip", "attachmentChip"]


def test_corpus_notion_expired_signed_url_is_refreshed_and_copied(wall_images, wall):
    expired = wall_images[(40, 20)]
    assert expired["format"] == "PNG"
    assert wall["content"][0] is expired["node"] and wall["content"][1]["content"][0]["text"] == "expired link, refreshed"


def test_corpus_notion_octet_stream_png_is_an_inline_image(wall_images):
    assert wall_images[(24, 12)]["format"] == "PNG"


def test_corpus_notion_heic_renders_and_keeps_original(work, wall, wall_images):
    heic = wall_images[(16, 32)]           # the 32x16 HEIC, its EXIF turn applied
    assert heic["format"] == "JPEG"
    at = wall["content"].index(heic["node"])
    original = wall["content"][at + 1]
    assert original["type"] == "attachmentChip" and original["attrs"]["name"] == "IMG_0412.heic"
    assert _file(work, "notion_messy", original["attrs"]["href"]).read_bytes() == gen.HEIC_FIXTURE.read_bytes()


def test_corpus_notion_oversize_photo_is_downscaled(wall_images):
    big = wall_images[(360, 270)]          # a 640x480 photo over the run's inline cap
    assert big["format"] == "JPEG"
    assert big["path"].stat().st_size <= gen.IMAGE_MAX_BYTES_FOR_RUN


def test_corpus_notion_svg_is_a_file_never_inline(work, wall):
    chip = _chips(wall)["logo.svg"]
    assert _file(work, "notion_messy", chip["href"]).suffix == ".svg"
    assert not [n for n in _nodes(wall, "image") if n["attrs"]["src"].endswith(".svg")]


def test_corpus_notion_redirecting_image_is_copied(wall_images):
    assert wall_images[(16, 16)]["format"] == "PNG"


def test_corpus_notion_dead_image_has_a_notice_with_its_url(wall):
    assert _notices(wall)["dead.png"] == {
        "reason": "fetch_failed", "name": "dead.png", "sourceUrl": "https://cdn.example.com/dead.png",
        "ref": "https://cdn.example.com/dead.png", "attempts": 2}


def test_corpus_notion_gone_file_is_a_final_missing_notice(wall):
    assert _notices(wall)["gone.png"] == {
        "reason": "missing_resource", "name": "gone.png", "sourceUrl": None, "ref": None, "attempts": 0}


def test_corpus_notion_link_that_stays_expired_is_retried_and_counted(notion, wall):
    assert _notices(wall)["stale.png"] == {
        "reason": "fetch_failed", "name": "stale.png", "sourceUrl": None, "ref": "notion:m-stale", "attempts": 2}
    assert import_notice.is_retryable(_notices(wall)["stale.png"])
    assert _n(notion, MEDIA_WALL)["importMediaPending"] == 1


def test_corpus_notion_media_retry_is_timestamp_neutral(notion):
    assert _n(notion, MEDIA_WALL)["updatedInLastPass"] is False


def test_corpus_notion_oversize_file_is_too_large(wall):
    assert _notices(wall)["huge_scan.pdf"] == {
        "reason": "too_large", "name": "huge_scan.pdf", "sourceUrl": None, "ref": None, "attempts": 0}


def test_corpus_notion_youtube_is_an_embed(wall):
    embeds = _nodes(wall, "webEmbed")
    assert embeds[0]["attrs"] == {"provider": "youtube", "ref": "dQw4w9WgXcQ", "url": "https://youtu.be/dQw4w9WgXcQ"}
    caption = wall["content"][wall["content"].index(embeds[0]) + 1]
    assert caption["content"] == [{"type": "text", "text": "The setup", "marks": [{"type": "italic"}]}]


def test_corpus_notion_allow_listed_embed_plays_and_others_are_links(wall):
    assert [n["attrs"]["provider"] for n in _nodes(wall, "webEmbed")] == ["youtube", "tradingview"]
    assert _href(wall, "https://vimeo.com/76979871") == "https://vimeo.com/76979871"
    assert _href(wall, "https://www.loom.com/share/abc") == "https://www.loom.com/share/abc"


def test_corpus_notion_video_pdf_audio_and_file_blocks_are_chips(work, wall):
    chips = _chips(wall)
    for name, suffix, size in [("clip.mp4", ".mp4", 2048), ("report.pdf", ".pdf", 1024),
                               ("memo.mp3", ".mp3", 1024), ("notes.txt", ".txt", 12)]:
        assert chips[name]["size"] == size
        assert _file(work, "notion_messy", chips[name]["href"]).suffix == suffix


# ── Notion: databases ──────────────────────────────────────────────────────────────

DATABASES = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


@pytest.fixture(scope="module")
def trades(notion):
    table = _nodes(_n(notion, DATABASES)["bodyJson"], "table")[0]
    header = ["".join(t["text"] for t in _nodes(c, "text")) for c in table["content"][0]["content"]]
    return [dict(zip(header, row["content"])) for row in table["content"][1:]]


def test_corpus_notion_database_cells_keep_links(notion, trades):
    row = trades[0]
    assert _links(row["Link"]) == [("https://example.com/chart", "https://example.com/chart")]
    assert _links(row["Mail"]) == [("desk@example.com", "mailto:desk@example.com")]
    assert _links(row["Phone"]) == [("+1 555 0100", "tel:+15550100")]
    assert _links(row["Notes"]) == [("post", "https://x.com/p/1"), ("Q3", NOTE_HREF.format(_n(notion, Q3)["id"]))]
    # a ≤50-row database's rows are not notes: the title link stays pending, opening notion.so
    assert _links(row["Name"]) == [("AAPL breakout", "import-link://notion:dddddddd-0000-4ddd-8ddd-000000000001")]


def test_corpus_notion_database_labels_stay_text(trades):
    text = lambda cell: "".join(t["text"] for t in _nodes(cell, "text"))
    assert (text(trades[0]["Status"]), text(trades[0]["Tags"])) == ("In progress", "earnings, A+")
    assert _links(trades[1]["Name"]) == [("Untitled", "import-link://notion:dddddddd-0000-4ddd-8ddd-000000000002")]


def test_corpus_notion_database_files_cell_copies_images_and_files(work, trades):
    cell = trades[0]["Shots"]
    assert [n["type"] for n in cell["content"]] == ["image", "attachmentChip", "importNotice"]
    with Image.open(_file(work, "notion_messy", cell["content"][0]["attrs"]["src"])) as im:
        assert im.size == (20, 10)
    assert cell["content"][1]["attrs"]["name"] == "deck.pdf"
    assert cell["content"][2]["attrs"] == {
        "reason": "missing_resource", "name": "lost.pdf", "sourceUrl": None, "ref": None, "attempts": 0}


def test_corpus_notion_database_files_cell_is_capped(trades):
    cell = trades[1]["Shots"]
    assert len(_nodes(cell, "image")) == 20
    assert _notices(cell) == {"the first 20 of 22 files in Shots": {
        "reason": "truncated", "name": "the first 20 of 22 files in Shots", "sourceUrl": None, "ref": None,
        "attempts": 0}}


def test_corpus_notion_big_database_becomes_linked_row_notes(notion):
    links = [(t, h) for t, h in _links(_n(notion, DATABASES)["bodyJson"]) if t.startswith("Log entry ")]
    assert len(links) == 55
    for n, (text, href) in enumerate(links, start=1):
        assert text == f"Log entry {n}"
        assert href == NOTE_HREF.format(notion[f"notion:eeeeeeee-0000-4eee-8eee-{n:012d}"]["id"])


def test_corpus_notion_database_past_its_query_cap_says_so(notion):
    body = _n(notion, DATABASES)["bodyJson"]
    assert _notices(body)["the first 2 rows of Endless"]["reason"] == "truncated"


# ── Notion: the cap, and the member's own note ────────────────────────────────────

def test_corpus_notion_media_cap_reached_mid_note(run, work):
    cap = _notes(run, "notion_messy", "u-capped")["notion:88888888-8888-4888-8888-888888888888"]
    body = cap["bodyJson"]
    assert [n["type"] for n in body["content"]] == ["image", "importNotice", "importNotice"]
    _file(work, "notion_messy", body["content"][0]["attrs"]["src"])
    assert [(a["reason"], a["name"], a["ref"]) for a in _notices(body).values()] == [
        ("storage_limit", "cap_b.png", "notion:cap-2"), ("storage_limit", "cap_c.png", "notion:cap-3")]
    assert cap["importMediaPending"] == 2         # waiting for space, never re-downloaded each pass


def test_corpus_notion_member_edited_note_is_never_rewritten(notion):
    mine, theirs = _n(notion, MEMBER), notion[f"notion:{MEMBER}#remote"]
    assert mine["bodyJson"] == {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "My own notes, written in UCT. Do not overwrite."}]}]}
    assert mine["title"] == "Member edited"
    assert theirs["title"] == "Member edited (synced copy)"
    assert _nodes(theirs["bodyJson"], "text")[0]["text"] == "Remote text, version two."
    assert "sync-conflict" in mine["tags"] and "sync-conflict" in theirs["tags"]


def test_corpus_notion_member_edited_note_keeps_its_edit_time(notion):
    """Task 14 found it, Task 15 D1 fixed it: the engine's `sync-conflict` tag is written
    timestamp-neutral, so the member's own edit time survives the pass byte for byte
    (`updatedInLastPass` compares the raw `updated_at` strings before and after)."""
    mine = _n(notion, MEMBER)
    assert "sync-conflict" in mine["tags"]
    assert mine["updatedInLastPass"] is False


# ── Obsidian: links ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def hub(obsidian):
    return _o(obsidian, "Notes/Hub.md")["bodyJson"]


def _to(obsidian, path: str) -> str:
    return NOTE_HREF.format(_o(obsidian, path)["id"])


def test_corpus_obsidian_space_named_link_resolves(obsidian, hub):
    assert [h for t, h in _links(hub) if t == "Target Note"] == [_to(obsidian, "Notes/Target Note.md")] * 3


def test_corpus_obsidian_alias_keeps_its_text(obsidian, hub):
    assert _href(hub, "aliased target") == _to(obsidian, "Notes/Target Note.md")


def test_corpus_obsidian_heading_and_block_anchors_link_to_the_note(obsidian, hub):
    assert _href(hub, "Other note > Risk") == _to(obsidian, "Notes/Other note.md")
    # the block anchor and the note embed both read "Other note"
    assert [h for t, h in _links(hub) if t == "Other note"] == [_to(obsidian, "Notes/Other note.md")] * 2


def test_corpus_obsidian_duplicate_basename_prefers_the_same_folder(obsidian, hub):
    assert _href(hub, "Plan") == _to(obsidian, "Notes/Plan.md")
    assert _href(hub, "the A plan") == _to(obsidian, "A/Plan.md")


def test_corpus_obsidian_unresolvable_wikilink_waits_under_a_name_key(hub):
    # `|notes`: Hub's folder, so the heal applies conversion's same-folder rule (Task 13 M-1).
    assert _href(hub, "Ghost Note") == f"import-link://name:obsidian:{VAULT}/ghost note|notes"


def test_corpus_obsidian_literal_percent_name_resolves(obsidian, hub):
    assert _href(hub, "100%20club") == _to(obsidian, "100%20club.md")


def test_corpus_obsidian_relative_links_resolve(obsidian, hub):
    assert _para_runs(hub, "Relative:") == [
        ("Relative: ", None), ("space encoded", _to(obsidian, "Notes/Other note.md")), (" ", None),
        ("angle", _to(obsidian, "Notes/Other note.md")), (" ", None),
        ("up a folder", _to(obsidian, "Archive/Deep.md")), (" ", None),
        ("dot", _to(obsidian, "Notes/Plan.md")), (" ", None),
        # As written, Hub's folder, relative: the heal reruns the relative rule (M-1).
        ("missing", f"import-link://name:obsidian:{VAULT}/missing.md|notes|rel"), (".", None)]


def test_corpus_obsidian_deep_link_resolves_in_its_own_vault_only(obsidian, hub):
    assert _para_runs(hub, "Deep links:") == [
        ("Deep links: ", None), ("this vault", _to(obsidian, "Notes/Other note.md")),
        (" and another vault.", None)]


def test_corpus_obsidian_escaped_pipe_in_a_table_cell_resolves(obsidian, hub):
    assert _href(hub, "table alias") == _to(obsidian, "Notes/Other note.md")
    assert len(_nodes(_nodes(hub, "table")[0], "tableRow")) == 3


def test_corpus_obsidian_callout_is_a_native_callout(obsidian, hub):
    callout = _nodes(hub, "callout")[0]
    assert callout["attrs"] == {"variant": "warning"}
    assert _links(callout) == [("Target Note", _to(obsidian, "Notes/Target Note.md"))]


def test_corpus_obsidian_raw_html_links_keep_safe_targets_only(hub):
    assert _para_runs(hub, "Raw HTML:") == [
        ("Raw HTML: ", None), ("site", "https://example.com/x"), (" and bad.", None)]


def test_corpus_obsidian_local_attachments_are_text_or_a_notice(hub):
    assert _para_runs(hub, "Attachment embed:") == [("Attachment embed: chart one.png", None)]
    assert _notices(hub)["chart one.png"] == {
        "reason": "unsupported", "name": "chart one.png", "sourceUrl": None,
        "ref": "attachments/chart one.png", "attempts": 0}


def test_corpus_obsidian_bare_urls_link_without_their_trailing_punctuation(hub):
    assert _para_runs(hub, "Bare URLs:") == [
        ("Bare URLs: See ", None), ("https://example.com/a", "https://example.com/a"), (", and (", None),
        ("https://example.com/b", "https://example.com/b"), ("). Also ", None),
        ("www.example.org", "https://www.example.org"),
        ("! Ticker NVDA.US and BRK.B closed up; mail ", None),
        ("desk@example.com", "mailto:desk@example.com"), (".", None)]


def test_corpus_obsidian_urls_in_code_and_math_are_untouched(hub):
    assert _run_marks(hub, "https://example.com/in-code") == [{"type": "code"}]
    assert _para_runs(hub, "In code:")[-1] == (" and math: $https://example.com/in-math$", None)
    block = _nodes(hub, "codeBlock")[0]
    assert block["content"] == [{"type": "text", "text": "fetch('https://example.com/in-codeblock')"}]


def test_corpus_obsidian_schemes_are_kept_upgraded_or_text(hub):
    runs = _para_runs(hub, "Schemes:")
    assert runs[1:] == [
        ("protocol-relative", "https://evil.example/x"), (" | ", None), ("call", "tel:+15550100"),
        (" | ", None), ("mail", "mailto:desk@example.com"), (" | ", None), ("relative path", None)]
    assert not [h for _, h in _links(hub) if h.lower().startswith(("javascript:", "data:"))]


def test_corpus_obsidian_unsafe_markdown_link_keeps_only_its_text(hub):
    """Task 14 found it, Task 15 D2 fixed it: `[script](javascript:...)` and
    `[data page](data:text/html,...)` keep only their visible text, never the raw markdown
    source (markdown-it's gate used to refuse to parse them; `mddoc._validate_link`)."""
    assert _para_runs(hub, "Schemes:")[0] == ("Schemes: script | data page | ", None)


def test_corpus_obsidian_task_list_keeps_its_checkboxes(hub):
    assert [n["attrs"]["checked"] for n in _nodes(hub, "taskItem")] == [False, True]


def test_corpus_obsidian_later_target_heals(obsidian):
    other = _o(obsidian, "Notes/Other note.md")
    assert _href(other["bodyJson"], "Later") == _to(obsidian, "Later.md")
    assert other["importLinksPending"] == 0
    assert other["updatedInLastPass"] is False, "a heal is timestamp-neutral"


# ── Obsidian: media ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def o_wall(obsidian):
    return _o(obsidian, "Media wall.md")["bodyJson"]


@pytest.fixture(scope="module")
def o_images(work, o_wall):
    return _images_by_size(work, "obsidian_messy", o_wall)


def test_corpus_obsidian_exif_rotated_jpeg_keeps_its_orientation(o_images):
    rotated = o_images[(40, 20)]
    assert (rotated["format"], rotated["orientation"]) == ("JPEG", 6), "stored as sent: the browser turns it"


def test_corpus_obsidian_tiff_bmp_avif_are_converted(o_images):
    assert {size: o_images[size]["format"] for size in [(30, 10), (12, 6), (32, 24)]} == {
        (30, 10): "JPEG", (12, 6): "JPEG", (32, 24): "JPEG"}


def test_corpus_obsidian_http_hotlink_is_copied(o_images):
    assert o_images[(10, 10)]["format"] == "PNG"


def test_corpus_obsidian_data_png_and_raw_img_are_copied(o_images):
    assert o_images[(2, 2)]["format"] == "PNG" and o_images[(6, 6)]["format"] == "PNG"


def test_corpus_obsidian_svg_is_a_file_never_inline(work, o_wall):
    chips = _chips(o_wall)
    assert set(chips) == {"md-img-1.svg", "logo.svg"}          # the data: SVG and the hotlinked one
    for chip in chips.values():
        assert _file(work, "obsidian_messy", chip["href"]).read_bytes().lstrip().startswith((b"<svg", b"<?xml"))
    assert not [n for n in _nodes(o_wall, "image") if n["attrs"]["src"].endswith(".svg")]


def test_corpus_obsidian_refused_media_have_notices_with_reasons(o_wall):
    notices = _notices(o_wall)
    assert {name: (a["reason"], a["attempts"]) for name, a in notices.items()} == {
        "bomb.png": ("too_large", 0),            # a decompression bomb: refused from its header
        "page.png": ("unsupported", 0),          # an HTML page called .png
        "moved-private.png": ("unsafe", 0),      # a hotlink that redirects to a private address
        "huge.zip": ("too_large", 0),            # over the source cap
        "dead.png": ("fetch_failed", 1),         # retried next sync
        "script image": ("unsafe", 0),           # Task 15 fix round 1: see the test below
    }
    assert all(a["sourceUrl"] == f"https://img.example.com/{name}" for name, a in notices.items()
               if name != "script image")


def test_corpus_obsidian_unsafe_image_src_is_an_unsafe_notice_never_media(o_wall):
    """Task 15 fix round 1 (controller ruling): `![script image](javascript%3Aalert(1))` --
    percent-encoded, so only the DECODED src reads as javascript: -- is an importNotice
    `unsafe` through the real engine, carrying no ref and no sourceUrl (the address is what
    must not be stored or offered), and nothing was fetched for it."""
    assert _notices(o_wall)["script image"] == {
        "reason": "unsafe", "name": "script image", "sourceUrl": None, "ref": None, "attempts": 0}
    assert "javascript" not in json.dumps(o_wall)


def test_corpus_obsidian_data_image_as_a_link_is_text(o_wall):
    assert _para_runs(o_wall, "png as a link") == [("png as a link", None)]


def test_corpus_obsidian_member_edited_note_is_never_rewritten(obsidian):
    mine = _o(obsidian, "Member edited.md")
    theirs = obsidian[f"obsidian:{VAULT}/Member edited.md#remote"]
    assert mine["bodyJson"] == {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "My own notes, written in UCT. Do not overwrite."}]}]}
    assert "Remote text, version two." in [t["text"] for t in _nodes(theirs["bodyJson"], "text")]
    assert "sync-conflict" in mine["tags"] and "sync-conflict" in theirs["tags"]


def test_corpus_obsidian_member_edited_note_keeps_its_edit_time(obsidian):
    """Task 15 D1, as for Notion above."""
    mine = _o(obsidian, "Member edited.md")
    assert "sync-conflict" in mine["tags"]
    assert mine["updatedInLastPass"] is False
