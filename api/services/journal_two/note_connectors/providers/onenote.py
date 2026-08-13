"""OneNote provider — a resumable, budget-bounded watermark queue over a
whole account's notebooks (Task 6, the hard problem of this wave: spec
`2026-08-12-note-connectors-msgraph-design.md` §5/§6/§9/§10).

Unlike OneDrive (Task 2, a real delta API), OneNote has **no delta/change
feed** [12] and **undocumented, aggressive per-app-per-user throttling**
[15][16] — so a large notebook cannot be drained in one sync tick. This
module is the queue that makes that safe: cheap, complete ENUMERATION
(ids + `lastModifiedDateTime` only) is separated from expensive, bounded
CONTENT fetch, and progress across ticks is carried entirely in the opaque
watermark cursor `base.py::opaque_cursor` already provides — no third cursor
mode, no new DB table (spec §11).

This module needs NO env vars to import and reads none at import time:
constructing `OneNoteProvider()` with zero arguments never raises and never
builds a real `httpx.AsyncClient` (matches `MSGraphClient`'s own lazy-build
idiom) — dark-until-configured lives entirely at the OAuth layer
(`oauth.configured("onenote")`, Task 1), exactly like `NotionProvider` and
`OneDriveProvider`.

⚠️ CREDENTIAL BOUNDARY (named critical risk class — both wave-1 live
providers had this bug): the Graph bearer, via `MSGraphClient.send`, is
attached ONLY to `graph.microsoft.com` — section/page enumeration, page
content, and `onenote-res://` resource downloads all go through that one
chokepoint. A genuine external `https://` image referenced in a page's own
HTML content is fetched via `providers.base.guarded_media_get`
(SSRF-guarded, literally no `Authorization` header attached, ever) — the
SAME unauthenticated path OneDrive/Notion use for their own content-embedded
external URLs.

── THE WATERMARK QUEUE (the crux — get the boundary math right) ───────────

Cursor JSON (opaque to the engine, owned ENTIRELY by this module — the
engine stores `self.opaque_cursor` verbatim and hands it back unparsed on
the next call, per `base.py::opaque_cursor`'s own docstring):

    {"v": 1, "watermark": "<iso8601>", "at_watermark_ids": ["p1", "p2"]}

  - `watermark` — the `lastModifiedDateTime` of the newest page this source
    has already fetched+imported.
  - `at_watermark_ids` — page ids already processed AT EXACTLY that
    timestamp (a real collision, or two pages truncated to the same
    fractional-second boundary) — the precise-overlap idiom that lets the
    NEXT tick exclude exactly what was already returned without EITHER
    re-looping on those same ids forever OR skipping a distinct page that
    happens to share the boundary instant.

`list_changed(creds, cursor)` per tick:
  1. Parse the watermark (missing/unparseable cursor → the epoch, i.e. a
     full initial sync — every page is "changed").
  2. Enumerate EVERY section's EVERY page (id/title/`lastModifiedDateTime`
     only — no content fetch), `$skip`-paged (see the `$top` gotcha below).
     This is the CHEAP pass (~1 request per 100 pages) and, budget
     permitting, is COMPLETE — every section is walked in full.
  3. Locally filter: `lastModifiedDateTime >= watermark`, excluding any id
     in `at_watermark_ids` at that exact instant.
  4. Sort the survivors ASCENDING by `lastModifiedDateTime`, take the first
     `MSGRAPH_ONENOTE_PAGES_PER_TICK` (K, default 40) as this tick's
     `RemoteRef`s — K bounds *content* fetch (the expensive part: 1 GET per
     page + N resource GETs), which the engine performs afterward via
     `fetch`/`fetch_many` over exactly the refs returned here.
  5. Publish `self.opaque_cursor`: `watermark` = the LAST (i.e. newest)
     selected page's timestamp (the K-th, or the newest of however many
     were found if fewer than K changed); `at_watermark_ids` = the ids of
     every SELECTED page sharing that exact timestamp. Because
     `lastModifiedDateTime` only ever moves forward on an edit, draining
     ascending and advancing the watermark to the last-selected instant
     means the next tick resumes strictly past everything already
     returned — never a re-loop, never a skip — and a page LEFT BEHIND at
     the boundary (same instant, not selected because K was already full)
     is excluded from nothing (it isn't in `at_watermark_ids`) so it is
     picked up on the very next tick.

     ⚠️ ACCUMULATE, don't replace, when the watermark does NOT move this
     tick (every selected page still shares the exact instant the
     watermark was already sitting at — e.g. K=1 draining a boundary group
     of 3 same-instant pages, one per tick, for 3 ticks in a row). The new
     `at_watermark_ids` is the UNION of the incoming cursor's ids at that
     instant with this tick's newly-selected ids at that instant — never
     just this tick's ids alone. A REPLACE here is precisely the
     boundary-reloop bug: a page excluded by an earlier tick at this same
     instant would silently become a candidate again the moment a later
     tick's narrower exclusion set overwrote the earlier one away. Only
     when the watermark genuinely advances to a later instant does the
     exclusion set reset to just that new instant's selected ids — every
     older exclusion is by then strictly in the past and irrelevant.

Timestamps are compared as REAL instants (`_parse_dt`), not raw strings —
Graph's OneNote timestamps commonly carry up to 7 fractional-second digits,
and a naive string compare would misorder `"...:00Z"` against
`"...:00.5Z"` (`.` sorts before `Z` in ASCII, i.e. exactly backwards). A
parse failure on either side falls back to a raw string compare rather than
silently dropping a candidate — this module would rather risk one extra
re-fetch (harmless: `import_confirm`'s content hash no-ops an unchanged
page) than silently skip one.

── $top SUPPRESSES @odata.nextLink (the critical Graph gotcha) ────────────

Per spec §5 [12][14]: when `$top` is supplied to the pages-list endpoint,
OneNote does **NOT** return `@odata.nextLink` — paging MUST be done by hand
via an incrementing `$skip`. `_list_section_pages` below never reads
`@odata.nextLink` from a response at all (even if a test server includes
one) — it pages purely by `$skip`, stopping when a page returns fewer than
`$top` results.

── list_present_refs (the Task-4 engine hook — spec §9) ───────────────────

The bounded K-drain above solves content-fetch pacing but creates a second
problem: the engine's delete detection only runs on a FULL pass, over
`seen_ids = {r.remote_id for r in refs}`, refusing when that set covers
`<50%` of what's tracked. If `list_changed`'s bounded K refs were the ONLY
signal, a large notebook's refuse guard would fire on every full pass and
delete detection would never run. `list_present_refs(creds)` is the fix —
the COMPLETE current page-id set (ids + timestamps, same cheap enumeration
as step 2 above, unfiltered by watermark and NOT bounded by K) — feeding
the engine's optional `getattr(provider, "list_present_refs", None)` hook
(`engine.py::_do_sync`, full passes only) so existence-tracking and delete
detection see everything while `list_changed`'s bounded refs still drive
the actual (paced) content fetch, unchanged.

── Per-tick admission control (spec §10) — COMPLETE-OR-NOTHING enumeration ─

`MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK` (default 500) bounds the number of
Graph requests `list_changed`'s ENUMERATION pass will issue in one tick —
guarding a pathologically large notebook (far more sections/pages than 500
requests × 100 pages/request can enumerate) against an unbounded request
storm.

⚠️ Fix-round-1 Important #1 (Finding A — a real, confirmed skip bug, fixed
here): the watermark MUST be computed over a COMPLETE enumeration of every
section, never a partial one — a partial enumeration is not merely "less
data," it is UNSAFE data, because a section this tick never got to might
hold a page OLDER than the newest page a section it DID reach happened to
have. The earlier design here discarded only the one in-progress section
and still advanced the watermark off whatever fully-enumerated sections it
had — which looks safe (no MID-section slice ever contributes) but is not:
if section A (fully enumerated) has the notebook's NEWEST page and section B
(never reached this tick, budget already spent) has an OLDER page nobody
has ever seen, advancing the watermark to section A's newest instant makes
that older page permanently `< watermark` — filtered out on every future
tick, forever, with no error and no visibility. `repro_budget_skip.py`
(fix-round-1) reproduced exactly this.

The fix: `list_changed` treats its ENTIRE enumeration pass (every section,
every `$skip` page — the same cheap, complete walk `list_present_refs`
already does) as one atomic unit. If `_BudgetExhausted` fires ANYWHERE
during that walk — mid-section or merely before starting the next one — the
WHOLE tick is a no-op: zero refs returned, the cursor republished
UNCHANGED. No partial credit, ever. Only when the complete walk finishes
within budget does `list_changed` proceed to filter/sort/select — and at
that point K only bounds the *returned* refs (i.e. paces **content**
fetch), never the enumeration that computed the watermark, so the watermark
is always correct by construction. Given the default budget (500 requests,
enough for roughly ~499 sections' worth of listing, or many more pages —
each section needs only 1 request per 100 of its own pages), this makes
"the tick makes zero progress" a real but rare, self-correcting outcome
(the identical cheap enumeration just retries in full next tick) reserved
for pathologically large accounts — never the alternative of a silent skip.
`fetch`/`fetch_media` (content, already bounded by K) are not additionally
budget-gated here — K itself already bounds that cost, and Graph's own 429
+ this module's backoff is spec §10's named backstop against a burst of
manual "Sync now" clicks.

The safe-stall crossover point is bound by SECTION COUNT, not page count —
each section costs >=1 cheap enumeration request no matter how many pages
it holds (a section's own pages page via `$skip` at 100/request, so a big
section is nearly free in request terms; a big NOTEBOOK, meaning many
sections, is what actually spends the budget). 500 is sized to cover
realistic multi-notebook power users (several notebooks x dozens of
sections each) without spending a whole tick's budget just walking
structure. `MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK` remains the override for
accounts that still exceed this. A stall from this ceiling is always a safe
no-progress outcome (cursor republished unchanged, next tick retries the
identical walk) — never data loss.

`list_present_refs` deliberately has NO budget ceiling (it must be
COMPLETE, unconditionally, per its own contract above) — only the shared
`AsyncRateLimiter` paces it.

429 handling rides `MSGraphClient.send` entirely (honors `Retry-After` when
present, else a jittered exponential backoff — OneNote 429s do not reliably
carry `Retry-After` [15], so the else-branch is the common case in
practice) — this module adds no 429 handling of its own.

Spec: docs/superpowers/specs/2026-08-12-note-connectors-msgraph-design.md
§5, §6, §9, §10.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from .. import errors
from ..convert import onenote_html_to_tiptap
from . import msgraph_base
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef, guarded_media_get

_ONENOTE_RES_SCHEME = "onenote-res://"

_PAGE_SELECT = "id,title,lastModifiedDateTime"
_PAGE_TOP = 100

_WATERMARK_VERSION = 1
_EPOCH_WATERMARK = "1970-01-01T00:00:00Z"

# Defensive cap on a SINGLE section's $skip paging -- mirrors the
# _MAX_SEARCH_PAGES / _MAX_CHILDREN_PAGES idiom in notion.py: loud-and-named
# beats an infinite loop against a misbehaving server.
_MAX_SECTION_PAGES = 2000

_DEFAULT_RATE_PER_SEC = 3.0


class _BudgetExhausted(Exception):
    """Internal-only signal: the next Graph request would exceed
    `MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK`. Caught inside `list_changed` to
    stop enumeration at the last FULLY-enumerated section -- NEVER escapes
    this module."""


def _pages_per_tick() -> int:
    """`MSGRAPH_ONENOTE_PAGES_PER_TICK` (K), default 40 -- read live on
    every call, never cached at import (spec §13)."""
    raw = os.environ.get("MSGRAPH_ONENOTE_PAGES_PER_TICK")
    if not raw:
        return 40
    try:
        return max(1, int(raw))
    except ValueError:
        return 40


def _max_requests_per_tick() -> int:
    """`MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK`, default 500 -- read live on
    every call (spec §13). Default raised 120->500 2026-08-12: the safe-stall
    crossover is bound by SECTION COUNT (each section costs >=1 cheap
    enumeration request, independent of page count within it), not page
    count, and 500 covers realistic multi-notebook power users. The env var
    remains the override for extreme accounts; exhausting the budget is
    always a safe no-progress stall, never data loss (see module docstring
    "Per-tick admission control" above)."""
    raw = os.environ.get("MSGRAPH_ONENOTE_MAX_REQUESTS_PER_TICK")
    if not raw:
        return 500
    try:
        return max(1, int(raw))
    except ValueError:
        return 500


# ── watermark cursor codec (the ONLY authority on this JSON shape) ─────────


def _parse_watermark(cursor: str | None) -> tuple[str, set[str]]:
    """`cursor=None`, empty, or unparseable -> the epoch watermark with no
    exclusions (a full initial sync -- every page is "changed"). Never
    raises."""
    if cursor:
        try:
            data = json.loads(cursor)
        except (ValueError, TypeError):
            data = None
        if isinstance(data, dict):
            watermark = data.get("watermark")
            at_ids = data.get("at_watermark_ids")
            if isinstance(watermark, str) and watermark:
                ids = {str(i) for i in at_ids} if isinstance(at_ids, list) else set()
                return watermark, ids
    return _EPOCH_WATERMARK, set()


def _encode_watermark(watermark: str, at_ids: list[str]) -> str:
    return json.dumps({"v": _WATERMARK_VERSION, "watermark": watermark, "at_watermark_ids": list(at_ids)})


# ── timestamp comparison (robust to differing fractional-second precision) ─


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _at_or_after(value: str, watermark: str) -> bool:
    """`value >= watermark`, compared as real instants when both parse --
    a naive string compare misorders differing fractional-second precision
    (`"...:00Z"` vs `"...:00.5Z"`, since `.` < `Z` in ASCII, exactly
    backwards). Falls back to a raw string compare when either side is
    unparseable rather than silently dropping a candidate -- an extra
    re-fetch is harmless (the content hash no-ops it); a silently skipped
    page is not."""
    v_dt, w_dt = _parse_dt(value), _parse_dt(watermark)
    if v_dt is not None and w_dt is not None:
        return v_dt >= w_dt
    return value >= watermark


def _same_instant(a: str, b: str) -> bool:
    a_dt, b_dt = _parse_dt(a), _parse_dt(b)
    if a_dt is not None and b_dt is not None:
        return a_dt == b_dt
    return a == b


def _sort_key(value: str) -> tuple[int, Any]:
    """Ascending sort key: every parseable timestamp sorts by its real
    instant (tag 0); unparseable ones sort after, by raw string (tag 1) --
    tags keep a datetime from ever being compared directly against a str
    (which would raise), and put the (rare, malformed) unparseable case
    last rather than crashing the whole drain over one bad value."""
    dt = _parse_dt(value)
    return (0, dt) if dt is not None else (1, value)


def _graph_error_message(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        msg = err.get("message")
        return str(msg) if msg else None
    return None


class OneNoteProvider(NoteProvider):
    name = "onenote"

    def __init__(
        self, *, client: httpx.AsyncClient | None = None,
        sleep_fn: Any = None, rng: Any = None, rate_limiter: Any | None = None,
    ) -> None:
        # Tests inject a `client` built on `httpx.MockTransport` (no live
        # calls), a `sleep_fn` that returns instantly instead of really
        # sleeping through the 429 retry ladder, an `rng` for a
        # deterministic jittered-backoff draw (all three forwarded straight
        # to `MSGraphClient`, mirroring `OneDriveProvider`'s identical
        # constructor shape), and a `rate_limiter` with a fake clock/sleep
        # (mirrors `NotionProvider`'s injection point) so a test with many
        # requests never actually blocks on `asyncio.sleep`.
        self._graph = msgraph_base.MSGraphClient(client=client, sleep_fn=sleep_fn, rng=rng)
        if rate_limiter is None:
            from ...broker.rate_limit import AsyncRateLimiter
            rate_limiter = AsyncRateLimiter(_DEFAULT_RATE_PER_SEC)
        self._limiter = rate_limiter
        # page id -> {"title", "notebook_name", "section_name"} -- populated
        # fresh by EVERY list_changed() call from THAT tick's enumeration
        # only (mirrors NotionProvider._page_meta / OneDriveProvider's own
        # per-round item index), consumed by fetch() for title/folder_path
        # so a plain per-page metadata GET isn't needed at fetch time. Only
        # ever looked up for refs list_changed() itself just returned, so
        # this partial-per-tick population is always sufficient.
        self._page_meta: dict[str, dict[str, str]] = {}

    async def aclose(self) -> None:
        await self._graph.aclose()

    def import_key(self, source_remote_id: str, remote_id: str) -> str:
        # Flat `onenote:{page_id}` -- OneNote page ids are globally unique
        # within the account (base.py's documented exception, same as
        # Notion's `notion:{page_id}`); there is exactly one OneNote source
        # per account (spec §12), so no source-scoping component is needed.
        return f"onenote:{remote_id}"

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        return await self._graph.validate(credentials)

    def _make_req(self, credentials: dict[str, Any], budget: int | None):
        """Returns an async `req(method, path, *, params=None)` closure that
        rate-limits every call and, when `budget` is not None, raises
        `_BudgetExhausted` BEFORE issuing a request that would push the
        running count past it (never after -- so a caller never pays for a
        request it then has to discard). `budget=None` (used by
        `list_present_refs`) never raises -- only enumeration inside
        `list_changed` is budget-gated, per the module docstring."""
        count = 0

        async def req(method: str, path: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
            nonlocal count
            if budget is not None and count >= budget:
                raise _BudgetExhausted()
            await self._limiter.acquire()
            response = await self._graph.send(credentials, method, path, params=params)
            count += 1
            return response

        return req

    async def _list_sections(self, req: Any) -> list[dict[str, str]]:
        """`GET /me/onenote/notebooks?$expand=sections,sectionGroups($expand=
        sections)` -> every section id (+ its owning notebook/section
        display names, for `fetch()`'s `folder_path`). ONE request in the
        common case (a handful of notebooks) -- per spec §5, walking this
        first is required because the global `GET /me/onenote/pages` 400s
        ("maximum number of sections is exceeded") on large accounts."""
        response = await req(
            "GET", "/me/onenote/notebooks",
            params={"$expand": "sections,sectionGroups($expand=sections)"},
        )
        if response.status_code != 200:
            msgraph_base.raise_for_status(response)
        data = response.json()
        sections: list[dict[str, str]] = []
        for notebook in data.get("value") or []:
            notebook_name = notebook.get("displayName") or ""
            for sec in notebook.get("sections") or []:
                sec_id = sec.get("id")
                if sec_id:
                    sections.append({"id": sec_id, "name": sec.get("displayName") or "", "notebook_name": notebook_name})
            for group in notebook.get("sectionGroups") or []:
                for sec in group.get("sections") or []:
                    sec_id = sec.get("id")
                    if sec_id:
                        sections.append({"id": sec_id, "name": sec.get("displayName") or "", "notebook_name": notebook_name})
        return sections

    async def _list_section_pages(self, req: Any, section_id: str) -> list[dict[str, Any]]:
        """PER SECTION: `GET /me/onenote/sections/{id}/pages?$select=
        id,title,lastModifiedDateTime&$top=100`, paged by hand via an
        incrementing `$skip` -- `$top` SUPPRESSES `@odata.nextLink` [12][14],
        so this NEVER reads that field from a response, even if a
        misbehaving/test server includes one. Stops when a page returns
        fewer than `$top` results (the standard short-page-means-last-page
        signal); bounded by `_MAX_SECTION_PAGES` against an endless loop."""
        items: list[dict[str, Any]] = []
        skip = 0
        for _ in range(_MAX_SECTION_PAGES):
            params = {"$select": _PAGE_SELECT, "$top": str(_PAGE_TOP), "$skip": str(skip)}
            response = await req("GET", f"/me/onenote/sections/{section_id}/pages", params=params)
            if response.status_code != 200:
                msgraph_base.raise_for_status(response)
            data = response.json()
            values = data.get("value") or []
            items.extend(values)
            if len(values) < _PAGE_TOP:
                break
            skip += _PAGE_TOP
        else:
            raise errors.NoteConnTransient(
                f"OneNote section {section_id!r} page listing exceeded {_MAX_SECTION_PAGES} "
                f"$skip pages without finishing ({len(items)} pages collected so far) -- "
                "aborting rather than silently truncating the section",
            )
        return items

    async def _enumerate_candidates(
        self, req: Any, watermark: str, at_watermark_ids: set[str],
    ) -> list[RemoteRef]:
        """The COMPLETE candidate walk backing `list_changed` -- every
        section, every `$skip` page (identical cost/shape to
        `list_present_refs`'s own walk), filtered by watermark + populating
        `self._page_meta` as it goes. Deliberately raises `_BudgetExhausted`
        (never catches it) the instant ANY request within this walk would
        exceed the tick's budget -- fix-round-1 Important #1 (Finding A):
        the caller (`list_changed`) treats that as "this WHOLE enumeration
        is incomplete," discarding every candidate found so far, rather than
        advancing the watermark off a partial view that might be hiding an
        older, not-yet-seen page in a section this walk never reached."""
        sections = await self._list_sections(req)
        candidates: list[RemoteRef] = []
        for section in sections:
            items = await self._list_section_pages(req, section["id"])
            for item in items:
                page_id = item.get("id")
                updated_at = item.get("lastModifiedDateTime") or ""
                if not page_id or not updated_at:
                    continue
                if not _at_or_after(updated_at, watermark):
                    continue
                if _same_instant(updated_at, watermark) and page_id in at_watermark_ids:
                    continue
                self._page_meta[page_id] = {
                    "title": item.get("title") or "",
                    "notebook_name": section["notebook_name"],
                    "section_name": section["name"],
                }
                candidates.append(RemoteRef(remote_id=page_id, updated_at=updated_at))
        return candidates

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        watermark, at_watermark_ids = _parse_watermark(cursor)
        self._page_meta = {}
        budget = _max_requests_per_tick()
        req = self._make_req(credentials, budget)

        try:
            candidates = await self._enumerate_candidates(req, watermark, at_watermark_ids)
        except _BudgetExhausted:
            # The COMPLETE enumeration (cheap: id+timestamp only, same cost
            # as list_present_refs) could not finish within this tick's
            # request budget -- a pathologically large account (more
            # sections/pages than the budget can even LIST, independent of
            # content fetch entirely). Advancing the watermark here would
            # necessarily be computed over an INCOMPLETE view and risks
            # silently skipping an older page in a section never reached
            # (fix-round-1 Important #1 -- see module docstring's "Per-tick
            # admission control" section). Make NO progress this tick
            # instead: republish the cursor UNCHANGED; the next tick simply
            # retries the identical (cheap) enumeration from scratch.
            self._page_meta = {}
            self.opaque_cursor = _encode_watermark(watermark, sorted(at_watermark_ids))
            return []

        candidates.sort(key=lambda r: _sort_key(r.updated_at))
        selected = candidates[:_pages_per_tick()]

        if not selected:
            # Enumeration completed (COMPLETE, not partial) and found
            # nothing new -- republish the cursor UNCHANGED so the next
            # tick resumes from exactly the same point.
            self.opaque_cursor = _encode_watermark(watermark, sorted(at_watermark_ids))
            return []

        new_watermark = selected[-1].updated_at
        ids_at_new_watermark = {r.remote_id for r in selected if _same_instant(r.updated_at, new_watermark)}
        if _same_instant(new_watermark, watermark):
            # The watermark did NOT advance this tick -- every selected page
            # still shares the exact instant the watermark was already
            # sitting at (a boundary group wider than K: e.g. K=1 draining
            # two same-instant pages one per tick). The exclusion set must
            # ACCUMULATE onto whatever was already excluded at this same
            # instant, never REPLACE it -- replacing here is exactly the
            # boundary-reloop bug the watermark design exists to prevent: a
            # page excluded on an earlier tick at this instant would become
            # a candidate again the moment a later tick's narrower exclusion
            # set overwrote it away (it would pass `_at_or_after` again and
            # `page_id in at_watermark_ids` would now be false for it).
            combined_ids = set(at_watermark_ids) | ids_at_new_watermark
        else:
            # The watermark moved forward to a genuinely later instant --
            # every exclusion that applied to the OLD (now strictly past)
            # instant is irrelevant; start a fresh exclusion set for the
            # new instant.
            combined_ids = ids_at_new_watermark
        self.opaque_cursor = _encode_watermark(new_watermark, sorted(combined_ids))
        return selected

    async def list_present_refs(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        """The COMPLETE present page-id set (ids + timestamps, no content,
        no watermark filter, NOT bounded by K) -- feeds the engine's
        Task-4 `list_present_refs` hook (`engine.py::_do_sync`, full passes
        only) so delete detection and existence-tracking see every page
        that still exists remotely while `list_changed`'s bounded refs
        still drive the paced content fetch. Rate-limited but NOT
        budget-gated (see module docstring) -- this must be complete."""
        req = self._make_req(credentials, None)
        sections = await self._list_sections(req)
        refs: list[RemoteRef] = []
        for section in sections:
            items = await self._list_section_pages(req, section["id"])
            for item in items:
                page_id = item.get("id")
                if not page_id:
                    continue
                refs.append(RemoteRef(remote_id=page_id, updated_at=item.get("lastModifiedDateTime") or ""))
        return refs

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        page_id = ref.remote_id
        meta = self._page_meta.get(page_id) or {}
        title = meta.get("title") or page_id
        folder_path = [n for n in (meta.get("notebook_name"), meta.get("section_name")) if n]

        response = await self._graph.send(
            credentials, "GET", f"/me/onenote/pages/{page_id}/content",
            params={"includeIDs": "true"}, extra_headers={"Accept": "text/html"},
        )
        if response.status_code == 403:
            # An encrypted or otherwise inaccessible page -- Graph's
            # documented shape for this is a 403 with an error body. A
            # NAMED per-item failure (the engine's `_fetch_remote_notes`
            # catches this per-ref), never a crash of the whole drain. Not
            # routed through `msgraph_base.raise_for_status` (which would
            # raise `NoteConnAuthError` for ANY 403, correct for a bad
            # token on `/me` but wrong here -- the token already proved
            # itself valid for every enumeration call this same tick made).
            message = _graph_error_message(response) or "the page is encrypted or otherwise inaccessible"
            raise errors.NoteConnUnsupported(
                f"OneNote page {page_id!r} could not be read: {message}", reason=message,
            )
        if response.status_code != 200:
            msgraph_base.raise_for_status(response)

        converted = onenote_html_to_tiptap(response.text)
        return RemoteNote(
            remote_id=page_id,
            title=title,
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=folder_path,
            created_at=None,
            updated_at=ref.updated_at,
        )

    # ── fetch_media (credential-boundary critical path) ─────────────────

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        if ref.startswith(_ONENOTE_RES_SCHEME):
            resource_id = ref[len(_ONENOTE_RES_SCHEME):]
            response = await self._graph.send(
                credentials, "GET", f"/me/onenote/resources/{resource_id}/$value",
            )
            if response.status_code != 200:
                msgraph_base.raise_for_status(response)
            content_type = response.headers.get("content-type", "application/octet-stream")
            return response.content, content_type

        # NOT a OneNote resource id -- a genuine external URL taken from
        # DOCUMENT CONTENT (an image hot-linked from elsewhere). The Graph
        # bearer is NEVER attached here (credential-boundary rule): only
        # `MSGraphClient.send` ever carries it, and this branch never calls
        # it -- mirrors OneDrive/Notion/Dropbox's identical precedent.
        parsed = urlsplit(ref)
        if (parsed.scheme or "").lower() != "https":
            raise errors.NoteConnUnsupported(
                f"Cannot fetch media over a non-OneNote, non-https reference ({ref!r})",
                reason="Media reference did not resolve to a OneNote resource and is "
                       "not a secure (https) URL",
            )
        client = await self._graph.get_client()
        response = await guarded_media_get(client, ref, what="OneNote media")
        if response.status_code >= 400:
            raise errors.NoteConnTransient(
                f"Failed to download media ({response.status_code})", status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type
