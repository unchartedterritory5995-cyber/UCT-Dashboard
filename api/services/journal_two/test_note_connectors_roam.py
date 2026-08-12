"""Tests for the Roam Research provider — `note_connectors.providers.roam`
+ its markdown pre-passes (`note_connectors.convert.roam_text`).

No live calls anywhere: every provider test builds an `httpx.AsyncClient` on
`httpx.MockTransport`, so a request only ever reaches the in-process handler
function defined in each test. `pytest.ini`'s `asyncio_mode = auto` means the
`async def test_*` functions below need no explicit marker.

The five required cases from the task brief:
  1. enumeration + pull-many fixture -> a correct `RemoteNote` (taskItem from
     `{{[[TODO]]}}`, resolved `[[link]]` placeholder, image ref from a bare
     Firebase URL, block-ref resolution, code-protected `[[..]]`).
  2. 308 redirect re-auth — the manual re-send preserves BOTH the POST body
     and the Authorization header to the peer host.
  3. 503 cold-start retry ladder — succeeds after N retries, and raises
     `NoteConnTransient` once the ladder is exhausted.
  4. Encrypted-graph read failure -> `NoteConnUnsupported` with a clear,
     user-facing message.
  5. Incremental `list_changed` — only items newer than `cursor` come back.

Plus this file's own tests for the `roam_text.py` pre-pass ORDER (code
protection first; `{{[[TODO]]}}`/`{{[[DONE]]}}` consumed before the generic
`[[link]]` pass can mistake their contents for a page-link target) and the
enumeration-map instance-scoping self-review point.
"""

from __future__ import annotations

import json

import httpx
import pytest

from api.services.journal_two.note_connectors.convert.roam_text import convert_roam_markdown
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers import roam as roam_module
from api.services.journal_two.note_connectors.providers.roam import RoamProvider

GRAPH = "my-graph"
TOKEN = "roam-graph-token-abc123"
CREDS = {"graphName": GRAPH, "graphToken": TOKEN}

PAGE_1_UID = "page-1-uid"
PAGE_2_UID = "page-2-uid"  # "Setup Library" — the [[link]] target
DAILY_UID = "daily-1-uid"

BLOCK_A = "block-a-uid"
BLOCK_A1 = "block-a1-uid"
BLOCK_B = "block-b-uid"
BLOCK_C = "block-c-uid"
BLOCK_D = "block-d-uid"
BLOCK_E = "block-e-uid"
BLOCK_F = "block-f-uid"

FIREBASE_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/img.png?alt=media"

ENUMERATE_ROWS = [
    [PAGE_1_UID, "Trading Notes", 1755000000000],
    [PAGE_2_UID, "Setup Library", 1754900000000],
    [DAILY_UID, "August 12th, 2026", 1755100000000],
]

PAGE_1_ENTITY = {
    ":block/uid": PAGE_1_UID,
    ":node/title": "Trading Notes",
    ":block/children": [
        {
            ":block/uid": BLOCK_A,
            ":block/string": "{{[[TODO]]}} Review [[Setup Library]] before open",
            ":block/order": 0,
            ":block/children": [
                {
                    ":block/uid": BLOCK_A1,
                    ":block/string": f"See (({BLOCK_B})) for details",
                    ":block/order": 0,
                },
            ],
        },
        {
            ":block/uid": BLOCK_B,
            ":block/string": "Key Levels",
            ":block/order": 1,
            ":block/heading": 2,
        },
        {
            ":block/uid": BLOCK_C,
            ":block/string": f"Chart: {FIREBASE_URL}",
            ":block/order": 2,
        },
        {
            ":block/uid": BLOCK_D,
            ":block/string": "^^Important^^ note here",
            ":block/order": 3,
        },
        {
            ":block/uid": BLOCK_E,
            ":block/string": "Status:: In Progress",
            ":block/order": 4,
        },
        {
            ":block/uid": BLOCK_F,
            ":block/string": "Use `[[not a link]]` as an example",
            ":block/order": 5,
        },
    ],
}


DAILY_ENTITY = {
    ":block/uid": DAILY_UID,
    ":node/title": "August 12th, 2026",
    ":block/children": [
        {":block/uid": "daily-block-1", ":block/string": "Market open at 9:30", ":block/order": 0},
    ],
}


def _pull_many_result(entity: dict) -> dict:
    return {"result": {f'[:block/uid "{entity[":block/uid"]}"]': entity}}


def _default_handler(request: httpx.Request) -> httpx.Response:
    payload = json.loads(request.content or b"{}")
    if request.url.path.endswith("/q"):
        if payload.get("query") == roam_module._ENUMERATE_QUERY:
            return httpx.Response(200, json={"result": ENUMERATE_ROWS})
        if payload.get("query") == roam_module._VALIDATE_QUERY:
            return httpx.Response(200, json={"result": 3})
        return httpx.Response(400, json={"error": "unknown query"})
    if request.url.path.endswith("/pull-many"):
        eids = payload.get("eids", "")
        if f'"{PAGE_1_UID}"' in eids:
            return httpx.Response(200, json=_pull_many_result(PAGE_1_ENTITY))
        if f'"{DAILY_UID}"' in eids:
            return httpx.Response(200, json=_pull_many_result(DAILY_ENTITY))
        return httpx.Response(200, json={"result": {}})
    return httpx.Response(404)


def _make_provider(handler=_default_handler, sleep_fn=None) -> RoamProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)
    return RoamProvider(client=client, sleep_fn=sleep_fn)


def _find_all(doc, node_type: str) -> list[dict]:
    out = []

    def walk(node):
        if not isinstance(node, dict):
            return
        if node.get("type") == node_type:
            out.append(node)
        for child in node.get("content") or []:
            walk(child)

    walk(doc)
    return out


def _plain_text(node) -> str:
    out = []

    def walk(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "text":
            out.append(n.get("text", ""))
        for child in n.get("content") or []:
            walk(child)

    walk(node)
    return "".join(out)


def _doc_text(doc) -> str:
    return "".join(_plain_text(n) for n in doc.get("content", []))


def _marks_of_type(doc, mark_type: str) -> list[dict]:
    out = []

    def walk(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "text":
            for m in n.get("marks") or []:
                if m.get("type") == mark_type:
                    out.append({"text": n.get("text"), **m})
        for child in n.get("content") or []:
            walk(child)

    walk(doc)
    return out


# ---------------------------------------------------------------------------
# 1. Enumeration + pull-many fixture -> a correct RemoteNote
# ---------------------------------------------------------------------------


async def test_fetch_produces_a_remote_note_with_the_full_expected_shape():
    provider = _make_provider()
    changed = await provider.list_changed(CREDS)  # populates title->uid map
    ref = next(r for r in changed if r.remote_id == PAGE_1_UID)

    note = await provider.fetch(CREDS, ref)

    assert note.remote_id == PAGE_1_UID
    assert note.title == "Trading Notes"
    assert note.folder_path == []  # not a daily-note title
    assert note.updated_at == ref.updated_at

    doc = note.doc

    # {{[[TODO]]}} -> an unchecked taskItem
    task_items = _find_all(doc, "taskItem")
    assert len(task_items) == 1
    assert task_items[0]["attrs"]["checked"] is False
    assert "Review" in _plain_text(task_items[0])
    assert "before open" in _plain_text(task_items[0])

    # [[Setup Library]] -> a resolved import-link placeholder
    link_marks = _marks_of_type(doc, "link")
    setup_link = next(m for m in link_marks if m["text"] == "Setup Library")
    assert setup_link["attrs"]["href"] == f"import-link://roam:{GRAPH}/{PAGE_2_UID}"
    assert note.links == [f"roam:{GRAPH}/{PAGE_2_UID}"]

    # ((block-b-uid)) -> the referenced block's own text, inlined
    assert "See Key Levels for details" in _doc_text(doc)

    # the heading block became a real heading node
    headings = _find_all(doc, "heading")
    assert any(h["attrs"]["level"] == 2 and _plain_text(h) == "Key Levels" for h in headings)

    # the bare Firebase URL became an image + a registered media entry
    images = _find_all(doc, "image")
    assert any(img["attrs"]["src"] == f"import-ref://{FIREBASE_URL}" for img in images)
    assert note.media == [{"ref": FIREBASE_URL, "kind": "image", "name": "img.png"}]

    # ^^Important^^ -> literal ==Important== text (no highlight mark exists
    # in mddoc's declared vocabulary yet — see roam_text.py's module doc)
    assert "==Important== note here" in _doc_text(doc)

    # Status:: In Progress -> plain text, no special node
    assert "Status: In Progress" in _doc_text(doc)

    # code-protected [[not a link]] stayed literal, BRACKETS INTACT, as a
    # `code` mark — if code protection had failed, the generic [[link]] pass
    # would have stripped the brackets (unresolved -> plain "not a link"),
    # so an exact bracket-preserving match here is the load-bearing proof.
    code_marks = _marks_of_type(doc, "code")
    assert any(m["text"] == "[[not a link]]" for m in code_marks)
    assert not any(m["text"] == "not a link" for m in code_marks)


async def test_daily_note_title_gets_the_daily_notes_folder():
    provider = _make_provider()
    changed = await provider.list_changed(CREDS)
    ref = next(r for r in changed if r.remote_id == DAILY_UID)

    note = await provider.fetch(CREDS, ref)

    assert note.title == "August 12th, 2026"
    assert note.folder_path == ["Daily Notes"]


def test_import_key_matches_roam_graph_uid_format():
    provider = RoamProvider()
    assert provider.import_key(GRAPH, PAGE_1_UID) == f"roam:{GRAPH}/{PAGE_1_UID}"


async def test_fetch_media_downloads_bytes_and_content_type():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == FIREBASE_URL
        return httpx.Response(200, content=b"\x89PNG\r\n", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, FIREBASE_URL)
    assert data == b"\x89PNG\r\n"
    assert content_type == "image/png"


# ---------------------------------------------------------------------------
# 2. 308 redirect re-auth
# ---------------------------------------------------------------------------


async def test_308_redirect_resends_same_body_and_authorization_to_peer_host():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            assert request.url.host == "api.roamresearch.com"
            return httpx.Response(
                308,
                headers={"location": "https://peer-3.roamresearch.com/api/graph/my-graph/q"},
            )
        return httpx.Response(200, json={"result": 3})

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)

    assert info.label == GRAPH
    assert len(calls) == 2
    assert calls[1].url.host == "peer-3.roamresearch.com"
    # the redirected request carried the SAME body...
    assert calls[1].content == calls[0].content
    assert json.loads(calls[1].content) == {"query": roam_module._VALIDATE_QUERY, "args": []}
    # ...and the SAME Authorization header (a redirect-following client would
    # drop this on the cross-host hop — this is the property under test).
    assert calls[1].headers["authorization"] == calls[0].headers["authorization"] == f"Bearer {TOKEN}"


async def test_redirect_loop_is_bounded_not_infinite():
    def handler(request: httpx.Request) -> httpx.Response:
        # Always redirects — must not hang forever.
        return httpx.Response(308, headers={"location": str(request.url)})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# 3. 503 cold-start retry ladder
# ---------------------------------------------------------------------------


async def test_503_cold_start_retries_with_backoff_then_succeeds():
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] <= 2:
            return httpx.Response(503)
        return httpx.Response(200, json={"result": 3})

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    info = await provider.validate(CREDS)

    assert info.label == GRAPH
    assert call_count["n"] == 3
    assert sleeps == [2.0, 5.0]


async def test_503_cold_start_retries_exhausted_raises_transient():
    async def fake_sleep(seconds: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# 4. Encrypted-graph read failure
# ---------------------------------------------------------------------------


async def test_encrypted_graph_raises_unsupported_with_a_clear_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500, json={"error": "This graph is end-to-end encrypted and cannot be read."},
        )

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported) as exc_info:
        await provider.validate(CREDS)
    assert "encrypt" in str(exc_info.value).lower()
    assert "encrypt" in exc_info.value.reason.lower()


async def test_bad_token_raises_auth_error_not_unsupported():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


# ---------------------------------------------------------------------------
# 5. Incremental list_changed — only items newer than cursor
# ---------------------------------------------------------------------------


async def test_list_changed_full_enumeration_returns_everything_sorted_ascending():
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    assert {r.remote_id for r in refs} == {PAGE_1_UID, PAGE_2_UID, DAILY_UID}
    assert [r.updated_at for r in refs] == sorted(r.updated_at for r in refs)


async def test_list_changed_incremental_only_returns_items_newer_than_cursor():
    provider = _make_provider()
    full = await provider.list_changed(CREDS)
    assert len(full) == 3

    # Derive the cursor from the system's own output (the oldest item's own
    # timestamp) rather than hand-computing an epoch->ISO conversion here.
    cursor = full[0].updated_at
    partial = await provider.list_changed(CREDS, cursor=cursor)

    assert full[0].remote_id not in {r.remote_id for r in partial}
    assert len(partial) == len(full) - 1
    assert all(r.updated_at > cursor for r in partial)


async def test_list_changed_still_builds_the_full_title_map_even_when_filtered():
    """The title->uid map used for [[link]] resolution must cover the WHOLE
    graph, not just the incrementally-changed subset — a link to an
    unchanged page still has to resolve."""
    provider = _make_provider()
    full = await provider.list_changed(CREDS)
    cursor = full[0].updated_at
    await provider.list_changed(CREDS, cursor=cursor)  # filtered call

    assert provider._title_to_uid.get("Setup Library") == PAGE_2_UID
    assert provider._title_to_uid.get("Trading Notes") == PAGE_1_UID


# ---------------------------------------------------------------------------
# Self-review: the enumeration map is instance-scoped, never a module global
# ---------------------------------------------------------------------------


async def test_title_to_uid_map_is_instance_scoped_not_shared_globally():
    provider_one = _make_provider()
    await provider_one.list_changed(CREDS)
    assert provider_one._title_to_uid  # populated

    def _fail_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("a fresh provider must not need to call anything to prove isolation")

    provider_two = RoamProvider(
        client=httpx.AsyncClient(transport=httpx.MockTransport(_fail_handler), follow_redirects=False),
    )
    assert provider_two._title_to_uid == {}


def test_module_has_no_mutable_module_level_state():
    """Cheap structural guard against reintroducing a module-level cache:
    every name bound at `roam.py` module scope is either a function/class or
    an immutable constant (str/tuple/int/re.Pattern) — never a dict/list."""
    import types

    for name, value in vars(roam_module).items():
        if name.startswith("__") and name.endswith("__"):
            continue  # dunders (__builtins__ etc.) are the interpreter's, not ours
        if not name.startswith("_"):
            continue  # public re-exports (imported classes/functions), not our state
        if isinstance(value, (types.FunctionType, type, types.ModuleType)):
            continue
        assert not isinstance(value, (dict, list, set)), (
            f"{name!r} is mutable module-level state: {value!r}"
        )


# ---------------------------------------------------------------------------
# roam_text.py — pre-pass ORDER (module-owned, direct unit tests)
# ---------------------------------------------------------------------------


def test_todo_and_done_are_consumed_before_the_wikilink_pass_can_see_them():
    # Adversarial: "TODO"/"DONE" are themselves resolvable page titles. If
    # the wikilink pass ran first (or the {{[[..]]}} token weren't fully
    # consumed), this would produce import-link placeholders instead of
    # checkboxes.
    title_to_uid = {"TODO": "todo-page-uid", "DONE": "done-page-uid"}
    out = convert_roam_markdown(
        "- {{[[TODO]]}} buy milk\n- {{[[DONE]]}} walk the dog",
        graph="g", title_to_uid=title_to_uid,
    )
    assert out == "- [ ] buy milk\n- [x] walk the dog"
    assert "import-link" not in out


def test_code_protection_survives_an_inline_code_span():
    out = convert_roam_markdown(
        "- see `[[not a link]]` here",
        graph="g", title_to_uid={"not a link": "some-uid"},
    )
    assert out == "- see `[[not a link]]` here"


def test_code_protection_survives_a_fenced_code_block():
    text = "- intro\n```\n[[not a link]]\n((not-a-ref))\n```\n- outro"
    out = convert_roam_markdown(
        text, graph="g",
        title_to_uid={"not a link": "some-uid"},
        uid_to_string={"not-a-ref": "resolved text"},
    )
    assert out == text  # entirely unchanged — both wiki constructs are fenced


def test_unresolved_wikilink_falls_back_to_plain_text():
    out = convert_roam_markdown("- [[Nonexistent Page]]", graph="g", title_to_uid={})
    assert out == "- Nonexistent Page"


def test_resolved_wikilink_becomes_import_link_placeholder():
    out = convert_roam_markdown(
        "- [[Real Page]]", graph="my-graph", title_to_uid={"Real Page": "uid-1"},
    )
    assert out == "- [Real Page](import-link://roam:my-graph/uid-1)"


def test_unresolved_blockref_falls_back_to_the_literal_uid_text():
    out = convert_roam_markdown("- see ((missing-uid))", graph="g")
    assert out == "- see ((missing-uid))"


def test_resolved_blockref_substitutes_the_referenced_block_text():
    out = convert_roam_markdown(
        "- see ((ref-1))", graph="g", uid_to_string={"ref-1": "the answer"},
    )
    assert out == "- see the answer"


def test_highlight_maps_to_double_equals_literal_text():
    out = convert_roam_markdown("- ^^important^^ text", graph="g")
    assert out == "- ==important== text"


def test_attr_line_becomes_plain_single_colon_text():
    out = convert_roam_markdown("- Status:: In Progress", graph="g")
    assert out == "- Status: In Progress"


def test_bare_firebase_url_becomes_a_markdown_image():
    out = convert_roam_markdown(f"- chart {FIREBASE_URL}", graph="g")
    assert out == f"- chart ![]({FIREBASE_URL})"


def test_already_wrapped_firebase_image_is_not_double_wrapped():
    out = convert_roam_markdown(f"- ![]({FIREBASE_URL})", graph="g")
    assert out == f"- ![]({FIREBASE_URL})"


def test_missing_maps_default_to_empty_without_raising():
    out = convert_roam_markdown("- [[Some Page]] and ((some-uid))", graph="g")
    assert out == "- Some Page and ((some-uid))"


def test_two_calls_with_different_maps_produce_different_output():
    """Proves there's no caching/stale state carried between calls — the
    function is pure over its explicit parameters."""
    first = convert_roam_markdown("- [[X]]", graph="g", title_to_uid={"X": "uid-a"})
    second = convert_roam_markdown("- [[X]]", graph="g", title_to_uid={"X": "uid-b"})
    assert first != second
    assert "uid-a" in first
    assert "uid-b" in second
