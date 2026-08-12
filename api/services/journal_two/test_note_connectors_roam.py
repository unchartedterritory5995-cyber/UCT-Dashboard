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

from api.services.journal_two.note_connectors.convert import md_to_tiptap
from api.services.journal_two.note_connectors.convert.roam_text import (
    convert_roam_markdown,
    fix_empty_task_items,
)
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers import roam as roam_module
from api.services.journal_two.note_connectors.providers.base import RemoteRef
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
                headers={"location": "https://peer-3.api.roamresearch.com/api/graph/my-graph/q"},
            )
        return httpx.Response(200, json={"result": 3})

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)

    assert info.label == GRAPH
    assert len(calls) == 2
    assert calls[1].url.host == "peer-3.api.roamresearch.com"
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
# Review finding 1: a 308 to an UNTRUSTED host must never leak the Bearer
# token — the redirect target host is validated BEFORE the second request
# is sent, not after.
# ---------------------------------------------------------------------------


async def test_308_redirect_to_an_untrusted_host_is_rejected_and_never_re_sent():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            308, headers={"location": "https://attacker.evil.com/api/graph/my-graph/q"},
        )

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)

    # The critical property: the handler was invoked exactly ONCE — the
    # attacker host never received a second request (and therefore never
    # received the Authorization header).
    assert len(calls) == 1


async def test_308_redirect_to_a_valid_peer_subdomain_is_followed_with_auth():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                308,
                headers={"location": "https://peer-9.api.roamresearch.com/api/graph/my-graph/q"},
            )
        return httpx.Response(200, json={"result": 3})

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)

    assert info.label == GRAPH
    assert len(calls) == 2
    assert calls[1].url.host == "peer-9.api.roamresearch.com"
    assert calls[1].headers["authorization"] == f"Bearer {TOKEN}"


async def test_redirect_to_http_on_the_right_host_is_still_rejected():
    """https-only — a plaintext redirect (even nominally same-host) must
    not be followed, since a downgrade to http would put the Bearer token
    on the wire unencrypted."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            308, headers={"location": "http://api.roamresearch.com/api/graph/my-graph/q"},
        )

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


def test_is_allowed_redirect_target_accepts_only_https_roam_hosts():
    allow = roam_module._is_allowed_redirect_target
    assert allow(httpx.URL("https://api.roamresearch.com/x")) is True
    assert allow(httpx.URL("https://peer-3.api.roamresearch.com/x")) is True
    assert allow(httpx.URL("https://attacker.evil.com/x")) is False
    assert allow(httpx.URL("https://notapi.roamresearch.com.evil.com/x")) is False
    assert allow(httpx.URL("http://api.roamresearch.com/x")) is False


# ---------------------------------------------------------------------------
# Review finding 2: raw httpx transport/JSON exceptions must never escape
# the errors taxonomy — wrapped at their one chokepoint into NoteConnTransient.
# ---------------------------------------------------------------------------


async def test_transport_exception_is_wrapped_as_note_conn_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("simulated connect timeout")

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


async def test_invalid_json_response_is_wrapped_as_transient_with_a_snippet():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not valid json{{{")

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient) as exc_info:
        await provider.validate(CREDS)
    assert "not valid json" in str(exc_info.value)


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
# Review finding 5: fetch()/fetch_many() must refuse to run before
# list_changed() has populated the link-resolution map — a loud RuntimeError
# instead of a quiet content bug (every link silently unresolved).
# ---------------------------------------------------------------------------


async def test_fetch_before_list_changed_raises_runtime_error():
    provider = _make_provider()
    ref = RemoteRef(remote_id=PAGE_1_UID, updated_at="2026-08-11T00:00:00+00:00")
    with pytest.raises(RuntimeError, match="list_changed"):
        await provider.fetch(CREDS, ref)


async def test_fetch_many_before_list_changed_raises_runtime_error():
    provider = _make_provider()
    ref = RemoteRef(remote_id=PAGE_1_UID, updated_at="2026-08-11T00:00:00+00:00")
    with pytest.raises(RuntimeError, match="list_changed"):
        await provider.fetch_many(CREDS, [ref])


async def test_fetch_after_list_changed_works_normally():
    """The positive case — proves the guard doesn't just always raise."""
    provider = _make_provider()
    changed = await provider.list_changed(CREDS)
    ref = next(r for r in changed if r.remote_id == PAGE_1_UID)
    note = await provider.fetch(CREDS, ref)
    assert note.remote_id == PAGE_1_UID


# ---------------------------------------------------------------------------
# Review finding 4: pull-many batching is real — fetch_many() overrides the
# base class's per-ref loop with true ≤40-eid batch calls.
# ---------------------------------------------------------------------------


async def test_fetch_many_batches_into_ceil_n_over_40_pull_many_calls():
    pull_many_calls = {"n": 0}
    total_refs = 81  # ceil(81 / 40) == 3

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content or b"{}")
        if request.url.path.endswith("/q"):
            return httpx.Response(200, json={"result": ENUMERATE_ROWS})
        if request.url.path.endswith("/pull-many"):
            pull_many_calls["n"] += 1
            eids = payload.get("eids", "")
            result = {}
            for i in range(total_refs):
                uid = f"batch-uid-{i}"
                if f'"{uid}"' in eids:
                    result[f'[:block/uid "{uid}"]'] = {
                        ":block/uid": uid, ":node/title": f"Page {i}", ":block/children": [],
                    }
            return httpx.Response(200, json={"result": result})
        return httpx.Response(404)

    provider = _make_provider(handler)
    await provider.list_changed(CREDS)  # satisfies the finding-5 guard

    refs = [
        RemoteRef(remote_id=f"batch-uid-{i}", updated_at="2026-08-11T00:00:00+00:00")
        for i in range(total_refs)
    ]
    notes = await provider.fetch_many(CREDS, refs)

    assert pull_many_calls["n"] == 3
    assert len(notes) == total_refs
    assert {n.remote_id for n in notes} == {r.remote_id for r in refs}


async def test_fetch_many_empty_refs_makes_no_pull_many_call():
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/q"):
            return httpx.Response(200, json={"result": ENUMERATE_ROWS})
        call_count["n"] += 1
        return httpx.Response(200, json={"result": {}})

    provider = _make_provider(handler)
    await provider.list_changed(CREDS)
    notes = await provider.fetch_many(CREDS, [])
    assert notes == []
    assert call_count["n"] == 0


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


# ---------------------------------------------------------------------------
# Review finding 3: a bare {{[[TODO]]}}/{{[[DONE]]}} with NO other text
# degrades to a literal "[ ]"/"[x]" listItem coming out of md_to_tiptap
# (mdit_py_plugins.tasklists needs non-whitespace content after the marker
# to flag task-list-item at all — confirmed empirically). `fix_empty_task_items`
# repairs this POST-conversion, per the review ruling.
# ---------------------------------------------------------------------------


def test_md_to_tiptap_alone_reproduces_the_bug_control():
    """Control: WITHOUT the fix, a bare checkbox is literal text, not a task
    item — proves the test setup actually reproduces the defect the fix
    exists for (a fix with no reproducing control is unverifiable)."""
    raw_doc = md_to_tiptap("- [ ] ")["doc"]
    assert _find_all(raw_doc, "taskItem") == []
    assert "[ ]" in _doc_text(raw_doc)


def test_bare_todo_with_no_trailing_text_becomes_a_real_empty_unchecked_task_item():
    md = convert_roam_markdown("- {{[[TODO]]}}", graph="g")
    raw_doc = md_to_tiptap(md)["doc"]
    fixed = fix_empty_task_items(raw_doc)

    task_items = _find_all(fixed, "taskItem")
    assert len(task_items) == 1
    assert task_items[0]["attrs"]["checked"] is False
    assert task_items[0]["content"] == [{"type": "paragraph", "content": []}]
    assert _plain_text(task_items[0]) == ""
    assert _find_all(fixed, "listItem") == []  # no leftover plain listItem


def test_bare_done_with_no_trailing_text_becomes_a_real_empty_checked_task_item():
    md = convert_roam_markdown("- {{[[DONE]]}}", graph="g")
    fixed = fix_empty_task_items(md_to_tiptap(md)["doc"])

    task_items = _find_all(fixed, "taskItem")
    assert len(task_items) == 1
    assert task_items[0]["attrs"]["checked"] is True
    assert task_items[0]["content"] == [{"type": "paragraph", "content": []}]


def test_bare_empty_todo_mixed_with_text_bearing_siblings_splits_into_runs():
    md = convert_roam_markdown(
        "- {{[[TODO]]}}\n- some other text\n- {{[[DONE]]}}",
        graph="g",
    )
    raw_doc = md_to_tiptap(md)["doc"]
    fixed = fix_empty_task_items(raw_doc)

    # Three sibling runs: taskList([ ]) , bulletList(text), taskList([x])
    top_level_types = [n["type"] for n in fixed["content"]]
    assert top_level_types == ["taskList", "bulletList", "taskList"]

    first_task = fixed["content"][0]["content"][0]
    assert first_task["type"] == "taskItem"
    assert first_task["attrs"]["checked"] is False
    assert _plain_text(first_task) == ""

    middle_item = fixed["content"][1]["content"][0]
    assert middle_item["type"] == "listItem"
    assert _plain_text(middle_item) == "some other text"

    last_task = fixed["content"][2]["content"][0]
    assert last_task["type"] == "taskItem"
    assert last_task["attrs"]["checked"] is True


def test_fix_empty_task_items_is_a_pure_noop_on_a_doc_with_no_bare_checkboxes():
    md = convert_roam_markdown("- {{[[TODO]]}} buy milk\n- plain item", graph="g")
    raw_doc = md_to_tiptap(md)["doc"]
    fixed = fix_empty_task_items(raw_doc)
    assert fixed == raw_doc


def test_fix_empty_task_items_never_mutates_its_input():
    md = convert_roam_markdown("- {{[[TODO]]}}", graph="g")
    raw_doc = md_to_tiptap(md)["doc"]
    import copy
    snapshot = copy.deepcopy(raw_doc)
    fix_empty_task_items(raw_doc)
    assert raw_doc == snapshot


async def test_fetch_end_to_end_repairs_a_bare_todo_block():
    """End-to-end via the real provider fetch path (not just the roam_text/
    mddoc unit level) — proves `_entity_to_remote_note` actually calls the
    fix, not just that the fix works in isolation."""
    uid = "bare-todo-page"

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content or b"{}")
        if request.url.path.endswith("/q"):
            return httpx.Response(
                200, json={"result": [[uid, "Bare Todo Page", 1755000000000]]},
            )
        if request.url.path.endswith("/pull-many"):
            entity = {
                ":block/uid": uid,
                ":node/title": "Bare Todo Page",
                ":block/children": [
                    {":block/uid": "b1", ":block/string": "{{[[TODO]]}}", ":block/order": 0},
                ],
            }
            return httpx.Response(200, json=_pull_many_result(entity))
        return httpx.Response(404)

    provider = _make_provider(handler)
    changed = await provider.list_changed(CREDS)
    ref = next(r for r in changed if r.remote_id == uid)
    note = await provider.fetch(CREDS, ref)

    task_items = _find_all(note.doc, "taskItem")
    assert len(task_items) == 1
    assert task_items[0]["attrs"]["checked"] is False
    assert _find_all(note.doc, "listItem") == []
