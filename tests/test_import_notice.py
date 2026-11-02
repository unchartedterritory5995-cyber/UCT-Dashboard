"""The `importNotice` block (connector fidelity, Plan A Task 5): the in-note marker for anything
an import could not bring over.

Pinned here:
  * the copy table is ONE FACT IN TWO FILES: `import_notice.NOTICE_COPY` and the client's
    `NOTICE_COPY` in lib/importNoticeText.js, read by IMPORTING that module in Node (never a
    regex, never a copy in this file);
  * the retry sentence versus the final one, the name fallback, an unknown reason;
  * a notice is a leaf with no plain text (search, Ask, History read it as nothing);
  * the Markdown and Word exports write the sentence, and a link only for an http(s) address;
  * share, publish and gallery drop it;
  * the attempt map the engine will read across syncs.
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services.journal_two import import_notice
from api.services.journal_two import notes as notes_svc
from api.services.journal_two import notes_export
from api.services.journal_two import public_note_payload as pnp
from api.services.journal_two.import_notice import marker_text, notice_node

ROOT = Path(__file__).resolve().parents[1]
CLIENT_COPY = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importNoticeText.js"


def _client_copy(path: Path = CLIENT_COPY) -> dict:
    """The client's NOTICE_COPY and reason list, read the way the bundle reads them: the module is
    imported by Node and the frozen objects serialised (it has no static imports for this reason)."""
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail reads the client copy table the way the bundle does"
    js = (f"import({json.dumps(path.resolve().as_uri())}).then((m) => process.stdout.write(JSON.stringify({{"
          "copy: m.NOTICE_COPY, reasons: m.NOTICE_REASONS, fallback: m.NAME_FALLBACK, "
          "samples: ["
          "m.importNoticeText({reason: 'fetch_failed', name: 'a.png', attempts: 1}),"
          "m.importNoticeText({reason: 'fetch_failed', name: 'a.png', attempts: 3}),"
          "m.importNoticeText({reason: 'nonsense', name: null}),"
          "m.importNoticeText({reason: 'too-large', name: 'v.mov (31.2 MB)'}),"
          "m.importNoticeText(null)]})))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    err = (r.stderr or b"").decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not import {path}: {err[:2000]}"
    return json.loads((r.stdout or b"").decode("utf-8", errors="replace"))


def _parse_js_copy_table(_js_text: str) -> dict[str, str]:
    """The brief's name for this read. The text argument is the file's own source; the table is
    read by importing the module (a regex over the text is exactly the shape that drifted in the
    schema table's history), and the source is checked to hold the table it was imported from."""
    table = _client_copy()["copy"]
    assert "NOTICE_COPY" in _js_text
    return table


def test_notice_copy_is_one_fact_in_two_files():
    js = CLIENT_COPY.read_text(encoding="utf-8")
    assert _parse_js_copy_table(js) == import_notice.NOTICE_COPY   # parse, never restate


def test_the_reason_union_name_fallback_and_derivation_agree_on_both_sides():
    client = _client_copy()
    assert tuple(client["reasons"]) == import_notice.NOTICE_REASONS
    assert client["fallback"] == import_notice.NAME_FALLBACK
    # the same five derivations on both sides: the rule, not only the table, is one fact
    assert client["samples"] == [
        marker_text("fetch_failed", "a.png", attempts=1),
        marker_text("fetch_failed", "a.png", attempts=3),
        marker_text("nonsense", None),
        marker_text("too-large", "v.mov (31.2 MB)"),
        import_notice.notice_text(None),
    ]


def test_the_reason_union_covers_server_client_and_plugin_codes_and_every_one_has_copy():
    assert import_notice.SERVER_REASONS == ("too_large", "storage_limit", "unsupported", "fetch_failed", "unsafe")
    assert import_notice.CLIENT_REASONS == (
        "upload_failed", "type_refused", "unresolvable_src", "decode_failed", "missing_resource")
    assert import_notice.PLUGIN_REASONS == (
        "obsidian_plugin_outdated", "obsidian_attachments_unavailable", "not_found", "sync_off")
    assert len(set(import_notice.NOTICE_REASONS)) == len(import_notice.NOTICE_REASONS)
    for reason in import_notice.NOTICE_REASONS:
        assert reason in import_notice.NOTICE_COPY, reason
        assert "{name}" in import_notice.NOTICE_COPY[reason], reason
    # every key is a reason, or the one retry variant: nothing in the table is unreachable
    assert set(import_notice.NOTICE_COPY) == set(import_notice.NOTICE_REASONS) | {"fetch_failed_retrying"}


def test_marker_text_retry_vs_final():
    assert marker_text("fetch_failed", "a.png", attempts=1).endswith("retrying on the next sync")
    assert marker_text("fetch_failed", "a.png", attempts=0) == "Couldn't copy a.png — retrying on the next sync"
    assert marker_text("fetch_failed", "a.png", attempts=2).endswith("retrying on the next sync")
    assert marker_text("fetch_failed", "a.png", attempts=3) == "Couldn't copy a.png"
    assert marker_text("fetch_failed", "a.png", attempts=9) == "Couldn't copy a.png"


@pytest.mark.parametrize(("reason", "want"), [
    ("too_large", "a.png is too large to copy (limit 25 MB)"),
    ("storage_limit", "Not copied: storage limit. a.png will be copied once space frees up"),
    ("unsupported", "a.png can't be shown here"),
    ("unsafe", "a.png wasn't copied: its address isn't allowed"),
    ("upload_failed", "Couldn't upload a.png"),
    ("type_refused", "a.png is a file type that can't be stored here"),
    ("unresolvable_src", "Couldn't find the image file for a.png"),
    ("decode_failed", "a.png couldn't be read"),
    ("missing_resource", "a.png was missing from the export"),
    ("not_found", "a.png wasn't found in the vault."),
    ("sync_off", "a.png wasn't synced because image and file sync is turned off in the plugin settings."),
])
def test_each_reason_reads_its_sentence(reason, want):
    assert marker_text(reason, "a.png") == want


def test_the_name_falls_back_and_an_unknown_reason_reads_as_unsupported():
    assert marker_text("too_large", None) == "this item is too large to copy (limit 25 MB)"
    assert marker_text("too_large", "   ") == "this item is too large to copy (limit 25 MB)"
    assert marker_text("too_large", 5) == "this item is too large to copy (limit 25 MB)"
    for unknown in ("not_a_reason", "", None, 7, {"x": 1}):
        assert marker_text(unknown, "a.png") == "a.png can't be shown here", unknown
    # Plan C's hyphenated spelling reads as its snake_case twin
    assert marker_text("storage-limit", "a.png") == marker_text("storage_limit", "a.png")
    # a garbage attempt count is 0 attempts, so a retry is still due
    for junk in (None, "2", -1, True, 1.5):
        assert marker_text("fetch_failed", "a.png", attempts=junk).endswith("retrying on the next sync"), junk


def test_a_safe_source_url_adds_the_link_words_and_an_unsafe_one_never_does():
    assert marker_text("unsupported", "a.png", source_url="https://x/a.png") == (
        "a.png can't be shown here — open the original")
    assert marker_text("unsupported", "a.png", source_url="http://x/a.png").endswith("open the original")
    # `javascript://host/...` and `ftp://host/...` HAVE a host: only the scheme check refuses them.
    for bad in ("javascript:alert(1)", "javascript://example.com/%0Aalert(1)", "ftp://example.com/a.png",
                "data:text/html,x", "vbscript:x", "file:///etc/passwd", "file://server/share/a.png",
                "https://user:pw@x/a", "https:///nohost", "https://x/a b", " ", None, 5):
        assert marker_text("unsupported", "a.png", source_url=bad) == "a.png can't be shown here", bad


def test_notice_node_carries_exactly_the_five_attrs():
    n = notice_node("fetch_failed", name="a.png", source_url="https://x/a.png", ref="r1", attempts=2)
    assert n == {"type": "importNotice", "attrs": {
        "reason": "fetch_failed", "name": "a.png", "sourceUrl": "https://x/a.png", "ref": "r1", "attempts": 2}}
    n = notice_node("unsafe", name="", source_url=None, ref=None, attempts=-4)
    assert n["attrs"] == {"reason": "unsafe", "name": None, "sourceUrl": None, "ref": None, "attempts": 0}


def test_is_retryable():
    assert import_notice.is_retryable({"reason": "fetch_failed", "attempts": 0})
    assert import_notice.is_retryable({"reason": "fetch_failed", "attempts": 2})
    assert not import_notice.is_retryable({"reason": "fetch_failed", "attempts": 3})
    assert not import_notice.is_retryable({"reason": "too_large", "attempts": 0})
    assert not import_notice.is_retryable(None)
    assert import_notice.MEDIA_RETRY_MAX_ATTEMPTS == 3


def test_notice_attempts_by_ref_walks_nesting_and_text_bodies():
    body = {"type": "doc", "content": [
        notice_node("fetch_failed", name="a", source_url=None, ref="r1", attempts=1),
        {"type": "columns", "content": [{"type": "column", "content": [
            notice_node("fetch_failed", name="b", source_url=None, ref="r2", attempts=2),
            notice_node("fetch_failed", name="b", source_url=None, ref="r1", attempts=3)]}]},
        notice_node("unsupported", name="c", source_url=None, ref=None, attempts=0),
        {"type": "paragraph", "attrs": {"ref": "r9", "attempts": 5}},   # not a notice
    ]}
    assert import_notice.notice_attempts_by_ref(body) == {"r1": 3, "r2": 2}
    assert import_notice.notice_attempts_by_ref(json.dumps(body)) == {"r1": 3, "r2": 2}
    for junk in (None, "not json", "[]", 5, {"type": "doc", "content": "x"}):
        assert import_notice.notice_attempts_by_ref(junk) == {}, junk


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


NOTICE = notice_node("fetch_failed", name="a.png", source_url="https://x/a.png", ref="r1", attempts=3)


def test_notice_is_a_leaf_with_no_plain_text():
    assert notes_svc.extract_plain_text(_doc(NOTICE)) == ""
    # beside a paragraph it adds no words and no separator
    para = {"type": "paragraph", "content": [{"type": "text", "text": "before"}]}
    assert notes_svc.extract_plain_text(_doc(para, NOTICE)) == "before"


def test_notice_markdown_export():
    assert notes_export.tiptap_to_markdown(_doc(NOTICE)).strip() == (
        "> Couldn't copy a.png [open the original](<https://x/a.png>)")


def test_notice_markdown_export_without_or_with_an_unsafe_source_is_the_sentence_alone():
    for url in (None, "javascript:alert(1)", "javascript://example.com/%0Aalert(1)",
                "data:image/png;base64,AAAA", "file:///c/a.png", "file://server/a.png"):
        n = notice_node("unsupported", name="a.png", source_url=url, ref=None, attempts=0)
        out = notes_export.tiptap_to_markdown(_doc(n)).strip()
        assert out == "> a.png can't be shown here", (url, out)


def test_notice_markdown_export_keeps_a_hostile_name_as_words():
    n = notice_node("unsupported", name="cost $5 [x](javascript:alert(1))", source_url=None, ref=None, attempts=0)
    out = notes_export.tiptap_to_markdown(_doc(n))
    assert "\\$5" in out          # prose dollars are escaped like every member word
    assert out.startswith("> ")


def _reduce(body, mode):
    return pnp.reduce(copy.deepcopy(body), mode=mode, owner_id="o1", note_id="n1",
                      attachment_base="/api/j2/shared/TOK/att/")


@pytest.mark.parametrize("mode", ["share", "publish", "gallery", "example"])
def test_notice_is_dropped_from_share_publish_and_gallery(mode):
    para = {"type": "paragraph", "content": [{"type": "text", "text": "kept"}]}
    out = _reduce(_doc(para, NOTICE), mode)
    assert "importNotice" not in set(pnp.walk_types(out)), (mode, out)
    assert "a.png" not in json.dumps(out) and "https://x/a.png" not in json.dumps(out)
    assert "kept" in json.dumps(out)   # CONTROL: the reducer ran and kept the member's words


def test_a_note_holding_a_notice_needs_schema_5_and_a_level_4_client_is_refused():
    from api.services.journal_two import notebook_schema as nbs
    body = _doc({"type": "paragraph", "content": [{"type": "text", "text": "x"}]}, NOTICE)
    assert nbs.required_schema(body) == 5
    with pytest.raises(nbs.NotebookSchemaTooOld):
        nbs.check_body_write(json.dumps(body), 4)
    nbs.check_body_write(json.dumps(body), 5)   # CONTROL: a bundle that reads it may write
