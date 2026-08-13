"""Tests for the OneNote resumable-watermark-queue provider —
`note_connectors.providers.onenote` (+ its shared base,
`note_connectors.providers.msgraph_base`).

No live calls anywhere: every test builds an `httpx.AsyncClient` on
`httpx.MockTransport`, so a request only ever reaches the in-process handler
function defined in each test/fixture. `pytest.ini`'s `asyncio_mode = auto`
means the `async def test_*` functions below need no explicit marker.

The task-6 brief's required areas (the watermark boundary + budget-resume +
credential-boundary cases are the must-prove ones):
  1. per-section enumeration pages via `$skip`, never relying on
     `@odata.nextLink` (which OneNote SUPPRESSES whenever `$top` is
     supplied — the critical Graph gotcha).
  2. section GROUPS are walked too (`sectionGroups($expand=sections)`).
  3. the watermark drain returns <=K refs, ascending, and advances the
     cursor to the K-th page's timestamp + the ids sharing it.
  4. a second call resumes strictly past the watermark, excluding
     `at_watermark_ids` (no re-loop at the boundary).
  5. two (or more) pages sharing the exact boundary timestamp are each
     eventually returned EXACTLY once, even when the watermark itself
     doesn't move for several ticks in a row (the ACCUMULATE-not-replace
     exclusion-set rule).
  6. `list_present_refs` returns the COMPLETE set regardless of K.
  7. resource media is AUTHENTICATED (Bearer on `/resources/{id}/$value`);
     a genuine external URL is NOT.
  8. 429 without `Retry-After` backs off (rides `MSGraphClient.send`,
     proven the same way `test_note_connectors_onedrive.py` proves it).
  9. a per-tick request-BUDGET bail leaves a resumable cursor: the next
     call continues from exactly where enumeration stopped, never
     dropping or duplicating a page.
  10. an encrypted/inaccessible page -> a NAMED per-item failure
      (`NoteConnUnsupported`), never a crash.
  11. a rejected token -> `NoteConnAuthError`.

Plus: `fetch()`'s HTML->TipTap delegation + title/folder_path, `import_key`'s
flat `onenote:{page_id}` shape, and import-inert construction.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest

from api.services.journal_two.note_connectors.convert import onenote_html_to_tiptap
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnRateLimited,
    NoteConnTokenExpired,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers.base import AccountInfo
from api.services.journal_two.note_connectors.providers.msgraph_base import GRAPH_API_BASE
from api.services.journal_two.note_connectors.providers.onenote import OneNoteProvider

ACCESS_TOKEN = "graph-access-token-onenote"
CREDS = {"accessToken": ACCESS_TOKEN}


def _ts(offset_seconds: int) -> str:
    """A clean (no fractional seconds) ISO-8601 UTC timestamp, offset from a
    fixed base -- deterministic, monotonic, easy-to-read fixture data."""
    dt = datetime(2026, 8, 1, tzinfo=timezone.utc) + timedelta(seconds=offset_seconds)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _make_provider(handler, *, sleep_fn=None, rng=None, rate_limiter=None) -> OneNoteProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    if rate_limiter is None:
        from api.services.journal_two.broker.rate_limit import AsyncRateLimiter
        rate_limiter = AsyncRateLimiter(1000.0)  # fast -- never actually blocks a test
    return OneNoteProvider(client=client, sleep_fn=sleep_fn, rng=rng, rate_limiter=rate_limiter)


# ---------------------------------------------------------------------------
# General-purpose Graph mock: notebooks tree + per-section $skip-paged page
# listings + page content + resource downloads + a genuine external host.
# ---------------------------------------------------------------------------


def _notebooks_payload(section_specs: list[dict[str, str]]) -> dict[str, Any]:
    by_notebook: dict[str, list[dict[str, str]]] = {}
    for spec in section_specs:
        by_notebook.setdefault(spec["notebook_name"], []).append(
            {"id": spec["id"], "displayName": spec["name"]},
        )
    return {
        "value": [
            {"displayName": name, "sections": secs, "sectionGroups": []}
            for name, secs in by_notebook.items()
        ],
    }


def _make_graph_handler(
    section_specs: list[dict[str, str]],
    pages_by_section: dict[str, list[dict[str, Any]]],
    *, page_content: dict[str, Any] | None = None,
    resources: dict[str, tuple[bytes, str]] | None = None,
):
    """Returns `(handler, auth_seen, section_skip_calls)`.

    `auth_seen` records the `Authorization` header seen on every
    content/resource/external request -- the credential-boundary check.
    `section_skip_calls` records every `($skip)` value requested per
    section -- the paging-mechanism check. Every `graph.microsoft.com`
    request is asserted INLINE to carry the bearer (never silently
    skipped)."""
    page_content = page_content or {}
    resources = resources or {}
    notebooks_json = _notebooks_payload(section_specs)
    auth_seen: list[tuple[str, str | None]] = []
    section_skip_calls: list[tuple[str, int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        path = request.url.path

        if host == "graph.microsoft.com":
            assert request.headers.get("authorization") == f"Bearer {ACCESS_TOKEN}", (
                "every graph.microsoft.com request must carry the bearer"
            )

            if path == "/v1.0/me/onenote/notebooks":
                return httpx.Response(200, json=notebooks_json)

            if path.startswith("/v1.0/me/onenote/sections/") and path.endswith("/pages"):
                section_id = path[len("/v1.0/me/onenote/sections/"):-len("/pages")]
                skip = int(request.url.params.get("$skip", "0"))
                top = int(request.url.params.get("$top", "100"))
                section_skip_calls.append((section_id, skip))
                all_pages = pages_by_section.get(section_id, [])
                page_slice = all_pages[skip:skip + top]
                body: dict[str, Any] = {"value": page_slice}
                if len(page_slice) == top:
                    # Deliberately included on a full page -- the provider
                    # must NEVER follow this ($top suppresses nextLink).
                    body["@odata.nextLink"] = f"{GRAPH_API_BASE}/BOGUS-NEXTLINK-NEVER-FOLLOWED"
                return httpx.Response(200, json=body)

            if path.startswith("/v1.0/me/onenote/pages/") and path.endswith("/content"):
                page_id = path[len("/v1.0/me/onenote/pages/"):-len("/content")]
                auth_seen.append((f"content:{page_id}", request.headers.get("authorization")))
                entry = page_content.get(page_id)
                if entry is None:
                    return httpx.Response(404)
                if isinstance(entry, tuple):
                    status, body = entry
                    return httpx.Response(status, json=body)
                return httpx.Response(200, text=entry, headers={"content-type": "text/html"})

            if path.startswith("/v1.0/me/onenote/resources/") and path.endswith("/$value"):
                resource_id = path[len("/v1.0/me/onenote/resources/"):-len("/$value")]
                auth_seen.append((f"resource:{resource_id}", request.headers.get("authorization")))
                entry = resources.get(resource_id)
                if entry is None:
                    return httpx.Response(404)
                content, content_type = entry
                return httpx.Response(200, content=content, headers={"content-type": content_type})

            if path == "/BOGUS-NEXTLINK-NEVER-FOLLOWED":
                raise AssertionError("must never follow @odata.nextLink when $top is supplied")

            return httpx.Response(404)

        if host == "1.1.1.1":
            auth_seen.append(("external", request.headers.get("authorization")))
            return httpx.Response(200, content=b"external-bytes", headers={"content-type": "image/jpeg"})

        return httpx.Response(404)

    return handler, auth_seen, section_skip_calls


# ---------------------------------------------------------------------------
# Import-inert / construction / import_key.
# ---------------------------------------------------------------------------


def test_import_and_bare_construction_never_raises(monkeypatch):
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", raising=False)
    monkeypatch.delenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", raising=False)
    from api.services.journal_two.note_connectors.providers import onenote as onenote_module

    provider = onenote_module.OneNoteProvider()  # zero args -- must not raise, no client built
    assert provider.name == "onenote"


def test_import_key_flat_shape():
    provider = OneNoteProvider()
    # Flat onenote:{page_id} -- NOT the default source-scoped
    # {provider}:{source}/{id} form (Notion precedent; a page id is already
    # globally unique within the account).
    assert provider.import_key("some-source-remote-id", "page-xyz") == "onenote:page-xyz"


# ---------------------------------------------------------------------------
# 1. Per-section enumeration via $skip; NEVER relies on @odata.nextLink.
# ---------------------------------------------------------------------------

SKIP_SECTION_ID = "sec-many"
SKIP_SECTION_SPECS = [{"id": SKIP_SECTION_ID, "name": "Big Section", "notebook_name": "Big Notebook"}]
SKIP_PAGES = [
    {"id": f"skip-page-{i}", "title": f"Skip Page {i}", "lastModifiedDateTime": _ts(i)}
    for i in range(150)
]


async def test_skip_paging_used_not_nextlink_under_top(monkeypatch):
    monkeypatch.delenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", raising=False)  # default K=40
    handler, _auth, skip_calls = _make_graph_handler(
        SKIP_SECTION_SPECS, {SKIP_SECTION_ID: SKIP_PAGES},
    )
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)

    # Two $skip pages (0 then 100) cover all 150 -- proves manual $skip
    # paging is used, and the bogus nextLink (asserted-unreachable in the
    # handler) was never followed.
    assert skip_calls == [(SKIP_SECTION_ID, 0), (SKIP_SECTION_ID, 100)]
    # Default K=40 bounds the RETURNED refs (enumeration itself saw all 150) --
    # ascending, so the 40 oldest.
    assert [r.remote_id for r in refs] == [f"skip-page-{i}" for i in range(40)]


# ---------------------------------------------------------------------------
# 2. Section GROUPS are walked too (nested sectionGroups($expand=sections)).
# ---------------------------------------------------------------------------


async def test_section_groups_are_walked_too():
    notebooks_json = {
        "value": [
            {
                "displayName": "Notebook With Groups",
                "sections": [],
                "sectionGroups": [
                    {
                        "displayName": "A Group",
                        "sections": [{"id": "sec-nested", "displayName": "Nested Section"}],
                    },
                ],
            },
        ],
    }
    nested_pages = [{"id": "page-nested", "title": "Nested Page", "lastModifiedDateTime": _ts(0)}]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me/onenote/notebooks":
            return httpx.Response(200, json=notebooks_json)
        if request.url.path == "/v1.0/me/onenote/sections/sec-nested/pages":
            skip = int(request.url.params.get("$skip", "0"))
            return httpx.Response(200, json={"value": nested_pages if skip == 0 else []})
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    assert [r.remote_id for r in refs] == ["page-nested"]


# ---------------------------------------------------------------------------
# 3-5. The watermark boundary math -- the crux.
# ---------------------------------------------------------------------------

BOUNDARY_SECTION_ID = "sec-boundary"
BOUNDARY_SECTION_SPECS = [
    {"id": BOUNDARY_SECTION_ID, "name": "Section One", "notebook_name": "Notebook One"},
]
T1, T2, T3 = _ts(0), _ts(100), _ts(200)
# page-a and page-b deliberately SHARE T2 -- the boundary-collision fixture.
BOUNDARY_PAGES = {
    BOUNDARY_SECTION_ID: [
        {"id": "page-1", "title": "Page 1", "lastModifiedDateTime": T1},
        {"id": "page-a", "title": "Page A", "lastModifiedDateTime": T2},
        {"id": "page-b", "title": "Page B", "lastModifiedDateTime": T2},
        {"id": "page-3", "title": "Page 3", "lastModifiedDateTime": T3},
    ],
}


async def test_watermark_drain_returns_at_most_k_ascending_and_advances_cursor(monkeypatch):
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "2")
    handler, _auth, _skip = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler)

    refs = await provider.list_changed(CREDS)
    assert [r.remote_id for r in refs] == ["page-1", "page-a"]  # ascending, first K=2

    cursor = json.loads(provider.opaque_cursor)
    # Advances to the K-th (2nd) selected page's timestamp (T2), with the
    # ids at that exact timestamp among the SELECTED set (just page-a --
    # page-b shares T2 but wasn't selected, so it stays a future candidate).
    assert cursor == {"v": 1, "watermark": T2, "at_watermark_ids": ["page-a"]}


async def test_second_call_resumes_strictly_past_watermark_excluding_at_ids(monkeypatch):
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "2")
    handler, _auth, _skip = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler)

    await provider.list_changed(CREDS)
    cursor1 = provider.opaque_cursor

    refs2 = await provider.list_changed(CREDS, cursor=cursor1)
    # page-1 and page-a (already returned) are NOT repeated; page-b (T2,
    # NOT excluded -- it was never selected/processed) IS picked up, then
    # page-3. No skip, no boundary re-loop.
    assert [r.remote_id for r in refs2] == ["page-b", "page-3"]

    cursor2 = json.loads(provider.opaque_cursor)
    assert cursor2 == {"v": 1, "watermark": T3, "at_watermark_ids": ["page-3"]}


async def test_boundary_shared_timestamp_pages_each_returned_exactly_once(monkeypatch):
    """K=1 forces page-a and page-b (both at T2) to be drained one PER
    TICK, across THREE consecutive ticks where the watermark stays pinned
    at T2 -- the exact scenario the ACCUMULATE-not-replace exclusion-set
    rule exists for. A naive REPLACE (this tick's ids only, discarding the
    incoming cursor's own at_watermark_ids) would let page-a become a
    candidate again on the tick after page-b is drained -- re-imported, in
    violation of "each returned exactly once.\""""
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "1")
    handler, _auth, _skip = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler)

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(8):  # generous bound -- 4 pages total via K=1
        refs = await provider.list_changed(CREDS, cursor=cursor)
        if not refs:
            break
        seen.extend(r.remote_id for r in refs)
        cursor = provider.opaque_cursor

    assert seen == ["page-1", "page-a", "page-b", "page-3"]  # each exactly once, in this order
    assert len(seen) == len(set(seen))  # extra belt-and-suspenders: no duplicates anywhere


async def test_no_cursor_and_unparseable_cursor_both_mean_full_initial_sync(monkeypatch):
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "10")
    handler, _auth, _skip = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler)
    refs_none = await provider.list_changed(CREDS, cursor=None)
    assert {r.remote_id for r in refs_none} == {"page-1", "page-a", "page-b", "page-3"}

    handler2, _auth2, _skip2 = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider2 = _make_provider(handler2)
    refs_garbage = await provider2.list_changed(CREDS, cursor="not-json-at-all")
    assert {r.remote_id for r in refs_garbage} == {"page-1", "page-a", "page-b", "page-3"}


# ---------------------------------------------------------------------------
# Minor (fix-round-1): fractional/mixed-precision timestamp ordering.
# `_parse_dt`/`_at_or_after`/`_same_instant` exist specifically so OneNote's
# up-to-7-digit fractional-second timestamps compare as REAL instants rather
# than raw strings -- a naive string compare misorders `"...:00Z"` against
# `"...:00.5Z"` (`.` < `Z` in ASCII, exactly backwards: the fractional value
# is LATER but would sort as EARLIER). Every fixture elsewhere in this file
# is whole-second by construction, so that robustness code was previously
# unexercised by any test -- pinned here directly against the helpers, and
# end-to-end through `list_changed`'s sort/filter.
# ---------------------------------------------------------------------------


def test_fractional_second_timestamps_compare_as_real_instants_not_strings():
    from api.services.journal_two.note_connectors.providers.onenote import (
        _at_or_after, _same_instant, _sort_key,
    )

    whole = "2026-08-01T00:00:00Z"          # real instant: +0.0s (earliest)
    half = "2026-08-01T00:00:00.5Z"          # real instant: +0.5s
    micros = "2026-08-01T00:00:00.9999999Z"  # real instant: +0.9999999s (latest)

    # A naive string compare gets `whole` backwards -- it has no fractional
    # part, so its char right after "00" is 'Z' (ASCII 90), which sorts
    # AFTER '.' (ASCII 46) that starts every fractional string, regardless
    # of the fractional value. So `whole` (chronologically EARLIEST) sorts
    # LAST as a raw string; `half`/`micros` (which both start with '.')
    # still compare correctly against each other.
    assert half < micros < whole  # sanity: the naive string trap really exists
    # `_at_or_after`/`_same_instant`/`_sort_key` must recover the OPPOSITE
    # (real, chronological) ordering: whole < half < micros.
    assert _at_or_after(half, whole) and not _at_or_after(whole, half)
    assert _at_or_after(micros, half) and not _at_or_after(half, micros)
    assert not _same_instant(whole, half)
    assert not _same_instant(half, micros)

    # A real collision at DIFFERENT fractional precision (a page truncated
    # to whole seconds by one code path, sub-second by another) still
    # compares equal as an instant even though the strings differ.
    whole_exact = "2026-08-01T00:00:05Z"
    zero_fraction = "2026-08-01T00:00:05.0000000Z"
    assert whole_exact != zero_fraction  # different strings
    assert _same_instant(whole_exact, zero_fraction)  # same real instant

    ordered = sorted([micros, whole, half], key=_sort_key)
    assert ordered == [whole, half, micros]


async def test_fractional_second_watermark_drain_orders_and_advances_correctly(monkeypatch):
    """End-to-end: three pages sharing the same WHOLE second but differing
    only in fractional precision must drain oldest-instant-first and the
    watermark must land on the correct (newest-instant) boundary -- proving
    the helper-level guarantee above actually reaches `list_changed`."""
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "2")
    frac_section = [{"id": "sec-frac", "name": "Frac Section", "notebook_name": "NB"}]
    t_whole = "2026-08-01T00:00:00Z"
    t_half = "2026-08-01T00:00:00.5000000Z"
    t_micros = "2026-08-01T00:00:00.9999999Z"
    frac_pages = {
        "sec-frac": [
            {"id": "page-micros", "title": "Micros", "lastModifiedDateTime": t_micros},
            {"id": "page-whole", "title": "Whole", "lastModifiedDateTime": t_whole},
            {"id": "page-half", "title": "Half", "lastModifiedDateTime": t_half},
        ],
    }
    handler, _auth, _skip = _make_graph_handler(frac_section, frac_pages)
    provider = _make_provider(handler)

    refs = await provider.list_changed(CREDS)
    # Real-instant ascending order, NOT source/string order.
    assert [r.remote_id for r in refs] == ["page-whole", "page-half"]
    cursor = json.loads(provider.opaque_cursor)
    assert cursor["watermark"] == t_half
    assert cursor["at_watermark_ids"] == ["page-half"]

    refs2 = await provider.list_changed(CREDS, cursor=provider.opaque_cursor)
    assert [r.remote_id for r in refs2] == ["page-micros"]


# ---------------------------------------------------------------------------
# 6. list_present_refs is COMPLETE, regardless of K.
# ---------------------------------------------------------------------------


async def test_list_present_refs_returns_complete_set_regardless_of_k(monkeypatch):
    monkeypatch.setenv("MSGRAPH_ONENOTE_PAGES_PER_TICK", "1")  # K=1 -- must not bound this
    handler, _auth, skip_calls = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler)

    refs = await provider.list_present_refs(CREDS)
    assert {r.remote_id for r in refs} == {"page-1", "page-a", "page-b", "page-3"}
    # Unfiltered by any watermark, unbounded by K -- all 4 come back in ONE call.
    assert len(refs) == 4


async def test_list_present_refs_walks_all_pages_of_a_multi_skip_section():
    handler, _auth, skip_calls = _make_graph_handler(
        SKIP_SECTION_SPECS, {SKIP_SECTION_ID: SKIP_PAGES},
    )
    provider = _make_provider(handler)
    refs = await provider.list_present_refs(CREDS)
    assert len(refs) == 150  # NOT bounded by K=40 the way list_changed would be
    assert skip_calls == [(SKIP_SECTION_ID, 0), (SKIP_SECTION_ID, 100)]


# ---------------------------------------------------------------------------
# 9. Per-tick request-budget bail leaves a resumable cursor -- COMPLETE-OR-
#    NOTHING enumeration (fix-round-1 Important #1 / Finding A). An earlier
#    design advanced the watermark off whatever sections it DID fully
#    enumerate even when other sections were never reached -- which silently
#    skipped an older page sitting in a deferred section forever
#    (`repro_budget_skip.py`). The fix: the watermark only ever advances
#    over a COMPLETE enumeration; a budget bail anywhere makes the WHOLE
#    tick a no-op (empty refs, cursor unchanged), never a partial advance.
# ---------------------------------------------------------------------------

BUDGET_SECTION_A = {"id": "sec-a", "name": "Section A", "notebook_name": "NB"}
BUDGET_SECTION_B = {"id": "sec-b", "name": "Section B", "notebook_name": "NB"}
BUDGET_SPECS = [BUDGET_SECTION_A, BUDGET_SECTION_B]
BUDGET_TA, BUDGET_TB = _ts(0), _ts(100)
BUDGET_PAGES = {
    "sec-a": [{"id": "page-a", "title": "A", "lastModifiedDateTime": BUDGET_TA}],
    "sec-b": [{"id": "page-b", "title": "B", "lastModifiedDateTime": BUDGET_TB}],
}


async def test_budget_bail_before_full_enumeration_makes_no_progress_then_resumes(monkeypatch):
    """Budget = 2 covers exactly [notebooks-list, section-A's one page-list
    request] -- section B is never reached. The ENTIRE tick must be a
    no-op: zero refs, cursor unchanged (NOT an advance to section A's
    page, which was the pre-fix bug's exact shape). Once the budget is
    lifted, the next tick's COMPLETE enumeration finds both pages and
    returns them together, ascending, each exactly once."""
    handler, _auth, _skip = _make_graph_handler(BUDGET_SPECS, BUDGET_PAGES)
    provider = _make_provider(handler)

    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "2")
    refs1 = await provider.list_changed(CREDS)
    assert refs1 == []
    cursor1 = provider.opaque_cursor
    assert json.loads(cursor1) == {"v": 1, "watermark": "1970-01-01T00:00:00Z", "at_watermark_ids": []}

    # Next tick, budget lifted (mirrors a fresh hourly tick under the
    # production default) -- resumes from the UNCHANGED cursor, a complete
    # enumeration now fits, both pages return together in one tick.
    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "10")
    refs2 = await provider.list_changed(CREDS, cursor=cursor1)
    assert [r.remote_id for r in refs2] == ["page-a", "page-b"]


# The Finding-A repro scenario itself: the section enumerated FIRST (and
# fully, within budget) holds the NEWEST page; the section deferred by the
# budget holds an OLDER page nobody has ever seen. The pre-fix bug advanced
# the watermark to the newest-seen instant anyway, which then permanently
# filtered the older, never-seen page out (`updated_at < watermark` forever).
SKIP_BUG_SPECS = [
    {"id": "sec-new", "name": "New Section", "notebook_name": "NB"},
    {"id": "sec-old", "name": "Old Section (deferred)", "notebook_name": "NB"},
]
SKIP_BUG_T_OLD, SKIP_BUG_T_NEW = _ts(50), _ts(100)
SKIP_BUG_PAGES = {
    "sec-new": [{"id": "page-new", "title": "New", "lastModifiedDateTime": SKIP_BUG_T_NEW}],
    "sec-old": [{"id": "page-old", "title": "Old", "lastModifiedDateTime": SKIP_BUG_T_OLD}],
}


async def test_budget_bail_never_permanently_skips_an_older_page_in_a_deferred_section(monkeypatch):
    handler, _auth, _skip = _make_graph_handler(SKIP_BUG_SPECS, SKIP_BUG_PAGES)
    provider = _make_provider(handler)

    # Budget = 2: notebooks-list + sec-new's one page-list request fit;
    # sec-old (holding the OLDER page) is deferred. Pre-fix, this tick
    # would have advanced the watermark to page-new's instant (T_NEW),
    # permanently filtering page-old out on every future tick. Post-fix:
    # zero progress, cursor unchanged.
    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "2")
    refs1 = await provider.list_changed(CREDS)
    assert refs1 == []
    cursor1 = provider.opaque_cursor
    assert json.loads(cursor1)["watermark"] == "1970-01-01T00:00:00Z"

    # Budget lifted -- a complete enumeration now fits in one tick. Both
    # pages return, ascending (page-old FIRST, since it's genuinely older),
    # each exactly once. page-old is NOT permanently lost.
    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "10")
    refs2 = await provider.list_changed(CREDS, cursor=cursor1)
    assert [r.remote_id for r in refs2] == ["page-old", "page-new"]

    # A further tick finds nothing new -- both were genuinely drained once.
    refs3 = await provider.list_changed(CREDS, cursor=provider.opaque_cursor)
    assert refs3 == []


async def test_budget_bail_mid_section_page_listing_also_makes_no_progress(monkeypatch):
    """Budget = 2 covers [notebooks-list, the section's FIRST `$skip` page]
    but NOT the second `$skip` page a 150-page section needs -- proving
    "complete or nothing" holds even when the bail happens MID-SECTION
    (not just between two whole sections): the second `$skip` page is
    never even requested, and the tick returns nothing rather than the
    first 100 (newest-of-them-all-so-far, but still an incomplete view)."""
    handler, _auth, skip_calls = _make_graph_handler(SKIP_SECTION_SPECS, {SKIP_SECTION_ID: SKIP_PAGES})
    provider = _make_provider(handler)
    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "2")

    refs = await provider.list_changed(CREDS)
    assert refs == []
    assert skip_calls == [(SKIP_SECTION_ID, 0)]  # the 2nd $skip page was never attempted
    cursor = json.loads(provider.opaque_cursor)
    assert cursor == {"v": 1, "watermark": "1970-01-01T00:00:00Z", "at_watermark_ids": []}


async def test_budget_exhausted_before_any_section_completes_makes_no_progress_safely(monkeypatch):
    """Budget=1 covers ONLY the notebooks-list request -- not even section
    A's first page-list request fits. No section is ever touched, so
    list_changed must return nothing and leave the cursor UNCHANGED (never
    guess/advance without complete information)."""
    handler, _auth, _skip = _make_graph_handler(BUDGET_SPECS, BUDGET_PAGES)
    provider = _make_provider(handler)
    monkeypatch.setenv("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK", "1")

    refs = await provider.list_changed(CREDS)
    assert refs == []
    cursor = json.loads(provider.opaque_cursor)
    assert cursor == {"v": 1, "watermark": "1970-01-01T00:00:00Z", "at_watermark_ids": []}


# ---------------------------------------------------------------------------
# fetch() -- HTML -> TipTap delegation, title/folder_path from enumeration.
# ---------------------------------------------------------------------------

FETCH_SECTION_ID = "sec-fetch"
FETCH_SECTION_SPECS = [
    {"id": FETCH_SECTION_ID, "name": "Meeting Notes", "notebook_name": "Work Notebook"},
]
FETCH_PAGE_HTML = "<p>Hello <b>World</b></p>"
FETCH_PAGES = {
    FETCH_SECTION_ID: [
        {"id": "fetch-page-1", "title": "Kickoff", "lastModifiedDateTime": T1},
    ],
}


async def test_fetch_converts_html_and_sets_title_folder_path():
    handler, _auth, _skip = _make_graph_handler(
        FETCH_SECTION_SPECS, FETCH_PAGES, page_content={"fetch-page-1": FETCH_PAGE_HTML},
    )
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == "fetch-page-1")

    note = await provider.fetch(CREDS, ref)
    assert note.doc == onenote_html_to_tiptap(FETCH_PAGE_HTML)["doc"]
    assert note.title == "Kickoff"
    assert note.folder_path == ["Work Notebook", "Meeting Notes"]
    assert note.updated_at == T1


# ---------------------------------------------------------------------------
# 7. fetch_media: resource id -> AUTHENTICATED; external URL -> NOT.
# ---------------------------------------------------------------------------


async def test_fetch_media_resource_is_authenticated():
    handler, auth_seen, _skip = _make_graph_handler(
        [], {}, resources={"res-1": (b"\x89PNG-bytes", "image/png")},
    )
    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, "onenote-res://res-1")
    assert data == b"\x89PNG-bytes"
    assert content_type == "image/png"
    seen = dict(auth_seen)
    assert seen["resource:res-1"] == f"Bearer {ACCESS_TOKEN}"  # Graph resource hop IS authenticated


async def test_fetch_media_external_url_is_unauthenticated():
    handler, auth_seen, _skip = _make_graph_handler([], {})
    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, "https://1.1.1.1/some/image.jpg")
    assert data == b"external-bytes"
    assert content_type == "image/jpeg"
    seen = dict(auth_seen)
    assert seen["external"] is None  # NOT authenticated -- credential-boundary rule


async def test_fetch_media_refuses_non_https_external_ref():
    provider = _make_provider(lambda r: httpx.Response(404))
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch_media(CREDS, "http://example.com/insecure.png")


# ---------------------------------------------------------------------------
# 10. Encrypted/inaccessible page -> named per-item failure, not a crash.
# ---------------------------------------------------------------------------


async def test_encrypted_page_raises_named_unsupported_not_a_crash():
    handler, _auth, _skip = _make_graph_handler(
        FETCH_SECTION_SPECS, FETCH_PAGES,
        page_content={
            "fetch-page-1": (403, {"error": {"code": "20117", "message": "The page is password protected."}}),
        },
    )
    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == "fetch-page-1")

    with pytest.raises(NoteConnUnsupported) as exc_info:
        await provider.fetch(CREDS, ref)
    assert "password protected" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 8. 429 without/with Retry-After backs off then succeeds (rides
#    MSGraphClient.send -- proven via validate(), mirrors OneDrive's tests).
# ---------------------------------------------------------------------------


def _me_success_response() -> httpx.Response:
    return httpx.Response(
        200, json={"displayName": "Alex Trader", "userPrincipalName": "alex@example.com", "id": "user-9"},
    )


def _make_429_then_success_handler(*, with_retry_after: bool, fail_times: int):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            calls["n"] += 1
            if calls["n"] <= fail_times:
                headers = {"retry-after": "2"} if with_retry_after else {}
                return httpx.Response(429, headers=headers)
            return _me_success_response()
        return httpx.Response(404)

    return handler, calls


async def test_429_without_retry_after_backs_off_then_succeeds():
    handler, calls = _make_429_then_success_handler(with_retry_after=False, fail_times=2)
    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn, rng=lambda: 1.0)  # deterministic full-jitter draw
    info = await provider.validate(CREDS)

    assert isinstance(info, AccountInfo)
    assert info.label == "Alex Trader"
    # attempt 0: capped = min(20, 1*2**0) = 1 -> delay = 1.0*1 = 1.0
    # attempt 1: capped = min(20, 1*2**1) = 2 -> delay = 1.0*2 = 2.0
    assert sleeps == [1.0, 2.0]
    assert calls["n"] == 3


async def test_429_with_retry_after_honors_header_verbatim():
    handler, calls = _make_429_then_success_handler(with_retry_after=True, fail_times=1)
    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn)
    info = await provider.validate(CREDS)
    assert info.label == "Alex Trader"
    assert sleeps == [2.0]


async def test_429_retries_are_bounded_then_raises_rate_limited():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    sleeps: list[float] = []

    async def sleep_fn(seconds):
        sleeps.append(seconds)

    provider = _make_provider(handler, sleep_fn=sleep_fn, rng=lambda: 0.5)
    with pytest.raises(NoteConnRateLimited):
        await provider.validate(CREDS)
    assert len(sleeps) == 4  # _RATE_LIMIT_MAX_RETRIES, then gives up


# ---------------------------------------------------------------------------
# 11. Bad token -> NoteConnAuthError (or its TokenExpired subclass).
# ---------------------------------------------------------------------------


async def test_bad_token_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            return httpx.Response(
                401, json={"error": {"code": "InvalidAuthenticationToken", "message": "Access token is empty."}},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


async def test_expired_token_raises_token_expired_subclass():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me":
            return httpx.Response(
                401,
                json={"error": {"code": "InvalidAuthenticationToken", "message": "Access token has expired."}},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTokenExpired):
        await provider.validate(CREDS)
    # NoteConnTokenExpired subclasses NoteConnAuthError -- existing `except
    # NoteConnAuthError` handling must still catch this.
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


async def test_bad_token_during_enumeration_also_raises_auth_error():
    """`list_changed` itself must surface a rejected token, not swallow it
    as "nothing enumerated" -- only `_BudgetExhausted` is caught internally;
    every other exception (including the taxonomy's own auth error) must
    propagate."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1.0/me/onenote/notebooks":
            return httpx.Response(
                401, json={"error": {"code": "InvalidAuthenticationToken", "message": "Access token is empty."}},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.list_changed(CREDS)


# ---------------------------------------------------------------------------
# Rate limiter is actually invoked (mirrors NotionProvider's own proof that
# throttling engages, not just that the injection point exists).
# ---------------------------------------------------------------------------


async def test_rate_limiter_is_invoked_during_enumeration():
    from api.services.journal_two.broker.rate_limit import AsyncRateLimiter

    clock = {"t": 0.0}

    def fake_clock() -> float:
        return clock["t"]

    async def advancing_sleep(seconds: float) -> None:
        clock["t"] += seconds

    limiter = AsyncRateLimiter(3.0, capacity=1.0, clock=fake_clock, sleep=advancing_sleep)
    handler, _auth, _skip = _make_graph_handler(BOUNDARY_SECTION_SPECS, BOUNDARY_PAGES)
    provider = _make_provider(handler, rate_limiter=limiter)

    await provider.list_changed(CREDS)
    # Two requests (notebooks list + one section page-list) against a
    # capacity-1 bucket that refills at 3/sec -- the second acquire had to
    # wait, advancing the fake clock past 0.
    assert clock["t"] > 0.0


# ---------------------------------------------------------------------------
# Change 2: _graph_error_field extracts error message (deduped helper).
# ---------------------------------------------------------------------------


def test_graph_error_field_extracts_message_from_graph_error_body():
    """Verify that _graph_error_field correctly extracts the message field
    from a Graph error body, and that the deduped helper works as expected."""
    from api.services.journal_two.note_connectors.providers.msgraph_base import _graph_error_field

    # Test with a valid error body
    response = httpx.Response(403, json={"error": {"code": "20117", "message": "The page is password protected."}})
    message = _graph_error_field(response, "message")
    assert message == "The page is password protected."

    # Test with no message field
    response_no_msg = httpx.Response(403, json={"error": {"code": "20117"}})
    message_missing = _graph_error_field(response_no_msg, "message")
    assert message_missing is None

    # Test with non-JSON body
    response_non_json = httpx.Response(403, text="<html>error</html>")
    message_non_json = _graph_error_field(response_non_json, "message")
    assert message_non_json is None
