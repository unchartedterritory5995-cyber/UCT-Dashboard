"""Wave 6 lane D item 6 -- GET /api/j2/link-preview (api/routers/notebook_link_preview.py).

The route fetches a page a member typed, so most of these rails are about
where it will NOT go and what it will NOT carry. No live network anywhere:
the page is an httpx.MockTransport, and DNS is the shared guard's own seam
(`providers.base._resolve_host`) -- patching THAT seam is also the proof that
the route runs the one shared guard rather than a copy of it.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import notebook_link_preview as lp
from api.services.journal_two.note_connectors.providers import base as guard_base

PUBLIC = ["93.184.216.34"]

PAGE = b"""<!doctype html><html><head>
<meta charset="utf-8">
<title>Fallback title</title>
<meta property="og:title" content="NVDA prints a record quarter">
<meta property="og:description" content="Data-centre revenue beat by   a mile.">
<meta property="og:image" content="/img/card.png">
<meta name="description" content="plain description">
</head><body><p>body text never read</p></body></html>"""


class Recorder:
    def __init__(self, routes):
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.routes.get(str(request.url))
        if answer is None:
            return httpx.Response(404, text="nope")
        return answer(request) if callable(answer) else answer


def html(body: bytes = PAGE, **headers) -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": "text/html; charset=utf-8", **headers})


@pytest.fixture()
def rig(monkeypatch):
    lp._cache.clear()
    state = {"addrs": PUBLIC, "rec": Recorder({})}

    async def fake_resolve(host):
        return list(state["addrs"])

    monkeypatch.setattr(guard_base, "_resolve_host", fake_resolve)
    monkeypatch.setattr(lp, "_transport", lambda: httpx.MockTransport(state["rec"]))
    app = FastAPI()
    app.include_router(lp.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "m@example.com"}
    state["client"] = TestClient(app)
    yield state
    lp._cache.clear()


def get(rig, url):
    return rig["client"].get("/api/j2/link-preview", params={"url": url})


def test_a_page_becomes_four_strings_from_its_open_graph_tags(rig):
    rig["rec"].routes = {"https://news.example.com/a": html()}
    r = get(rig, "https://news.example.com/a")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "url": "https://news.example.com/a",
        "title": "NVDA prints a record quarter",
        "description": "Data-centre revenue beat by a mile.",
        "domain": "news.example.com",
        "image": "https://news.example.com/img/card.png",
    }


def test_without_open_graph_it_reads_the_title_and_the_meta_description(rig):
    page = b"<html><head><title> Plain  page </title><meta name='description' content='Just words.'></head></html>"
    rig["rec"].routes = {"https://www.example.org/p": html(page)}
    body = get(rig, "https://www.example.org/p").json()
    assert (body["title"], body["description"], body["domain"], body["image"]) == \
        ("Plain page", "Just words.", "example.org", None)


def test_a_non_https_image_is_dropped_never_rendered(rig):
    page = b"<html><head><meta property='og:title' content='T'><meta property='og:image' content='http://cdn.example.com/x.png'></head></html>"
    rig["rec"].routes = {"https://example.com/i": html(page)}
    assert get(rig, "https://example.com/i").json()["image"] is None


def test_long_fields_are_clamped(rig):
    page = b"<html><head><meta property='og:title' content='" + b"A" * 900 + b"'></head></html>"
    rig["rec"].routes = {"https://example.com/l": html(page)}
    title = get(rig, "https://example.com/l").json()["title"]
    assert len(title) == lp.TITLE_MAX and title.endswith("…")


# ── where it will not go ────────────────────────────────────────────────────

def test_a_host_resolving_to_a_private_address_is_refused_before_any_request(rig):
    rig["addrs"] = ["10.0.0.5"]
    rig["rec"].routes = {"https://intranet.example.com/": html()}
    r = get(rig, "https://intranet.example.com/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


def test_the_cloud_metadata_address_is_refused(rig):
    r = get(rig, "https://169.254.169.254/latest/meta-data/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


def test_a_redirect_to_a_private_host_is_refused_before_the_second_request(rig, monkeypatch):
    async def resolve(host):
        return ["127.0.0.1"] if host == "evil.internal" else PUBLIC

    monkeypatch.setattr(guard_base, "_resolve_host", resolve)
    rig["rec"].routes = {"https://short.example.com/x": httpx.Response(302, headers={"location": "https://evil.internal/admin"})}
    r = get(rig, "https://short.example.com/x")
    assert r.status_code == 422
    assert [str(q.url) for q in rig["rec"].requests] == ["https://short.example.com/x"]


def test_plain_http_gets_no_preview_and_no_request(rig):
    rig["rec"].routes = {"http://example.com/": html()}
    r = get(rig, "http://example.com/")
    assert r.status_code == 422
    assert r.json()["detail"] == "Only secure (https) links get a preview card."
    assert rig["rec"].requests == []


@pytest.mark.parametrize("bad", ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "not a url",
                                 "data:text/html,<title>x</title>"])
def test_anything_but_a_web_link_is_refused(rig, bad):
    assert get(rig, bad).status_code == 400
    assert rig["rec"].requests == []


def test_a_link_carrying_credentials_is_refused(rig):
    r = get(rig, "https://user:pw@example.com/")
    assert r.status_code == 422
    assert rig["rec"].requests == []


# ── what it will not carry, and how much it will read ───────────────────────

def test_no_cookie_set_by_a_redirect_hop_reaches_the_next_request(rig):
    rig["rec"].routes = {
        "https://a.example.com/": httpx.Response(302, headers={
            "location": "https://a.example.com/final", "set-cookie": "sid=secret; Path=/"}),
        "https://a.example.com/final": html(),
    }
    assert get(rig, "https://a.example.com/").status_code == 200
    assert len(rig["rec"].requests) == 2
    assert all("cookie" not in q.headers for q in rig["rec"].requests)


def test_the_client_neither_trusts_the_environment_nor_follows_redirects_itself():
    client = lp._make_client()
    try:
        assert client.follow_redirects is False
        assert client.timeout.read == lp.TIMEOUT_S
        assert client._trust_env is False
    finally:
        import asyncio
        asyncio.run(client.aclose())


def test_a_body_past_the_cap_is_refused_not_truncated(rig, monkeypatch):
    monkeypatch.setattr(lp, "MAX_BYTES", 256)
    big = b"<html><head><meta property='og:title' content='T'></head><body>" + b"x" * 4096 + b"</body></html>"
    rig["rec"].routes = {"https://example.com/big": html(big)}
    assert get(rig, "https://example.com/big").status_code == 422


def test_a_page_that_times_out_is_a_gateway_answer_not_a_crash(rig):
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    rig["rec"].routes = {"https://example.com/slow": slow}
    assert get(rig, "https://example.com/slow").status_code == 502


def test_not_a_web_page_is_refused_even_when_its_bytes_look_like_one(rig):
    rig["rec"].routes = {"https://example.com/data.json": httpx.Response(
        200, content=b"<html><head><title>Looks like a page</title></head></html>",
        headers={"content-type": "application/json"})}
    r = get(rig, "https://example.com/data.json")
    assert r.status_code == 422
    assert r.json()["detail"] == "That link is not a web page."


def test_a_page_naming_nothing_is_no_preview(rig):
    rig["rec"].routes = {"https://example.com/empty": html(b"<html><head></head><body>hi</body></html>")}
    assert get(rig, "https://example.com/empty").status_code == 422


def test_an_upstream_error_is_a_gateway_answer(rig):
    rig["rec"].routes = {"https://example.com/gone": httpx.Response(500, text="boom")}
    assert get(rig, "https://example.com/gone").status_code == 502


# ── cached, and signed-in only ──────────────────────────────────────────────

def test_the_same_link_twice_costs_one_fetch(rig):
    rig["rec"].routes = {"https://news.example.com/a": html()}
    first = get(rig, "https://news.example.com/a").json()
    second = get(rig, "https://news.example.com/a").json()
    assert first == second
    assert len(rig["rec"].requests) == 1


def test_a_refusal_is_cached_too(rig):
    rig["rec"].routes = {"https://example.com/f.pdf": httpx.Response(
        200, content=b"%PDF", headers={"content-type": "application/pdf"})}
    assert get(rig, "https://example.com/f.pdf").status_code == 422
    assert get(rig, "https://example.com/f.pdf").status_code == 422
    assert len(rig["rec"].requests) == 1


def test_signed_out_is_401(monkeypatch):
    app = FastAPI()
    app.include_router(lp.router)
    r = TestClient(app).get("/api/j2/link-preview", params={"url": "https://example.com/"})
    assert r.status_code == 401


# ── wave 6 D fix round 1: M1 (fixed words), M2 (the untested branches), M3 (one member, not every slot) ──

def test_a_guard_refusal_answers_in_fixed_words_never_the_guards_own(rig):
    # M1: the guard's `reason` ("Media reference points at a private/internal
    # network address") is its own vocabulary; the route answers in one fixed
    # sentence. (The editor shows a fixed sentence of its own regardless.)
    rig["addrs"] = ["10.0.0.5"]
    r = get(rig, "https://intranet.example.com/")
    assert r.status_code == 422
    assert r.json()["detail"] == "No preview for this link."


def test_a_body_past_the_cap_answers_in_fixed_words_too(rig, monkeypatch):
    monkeypatch.setattr(lp, "MAX_BYTES", 256)
    big = b"<html><head><meta property='og:title' content='T'></head><body>" + b"x" * 4096 + b"</body></html>"
    rig["rec"].routes = {"https://example.com/big": html(big)}
    r = get(rig, "https://example.com/big")
    assert (r.status_code, r.json()["detail"]) == (422, "No preview for this link.")


def test_the_whole_fetch_has_a_ceiling_even_when_every_read_is_quick(rig, monkeypatch):
    # M2: a page that keeps each read inside TIMEOUT_S but never finishes (a
    # redirect chain, a trickle) is bounded by TOTAL_S as a whole -- a 504.
    import asyncio

    monkeypatch.setattr(lp, "TOTAL_S", 0.05)

    async def slow(request):
        await asyncio.sleep(1.0)
        return html()

    rig["rec"].routes = {"https://example.com/trickle": slow}
    r = get(rig, "https://example.com/trickle")
    assert r.status_code == 504


def test_a_look_alike_domain_is_shown_as_what_it_really_is(rig):
    # M2: the domain line is the card's only trustworthy field. A host typed in
    # a look-alike script ("apple.com" with U+0430, a Cyrillic a) is shown in the ASCII
    # form the browser actually connects to, never as a convincing "apple.com".
    rig["rec"].routes = {"https://xn--pple-43d.com/x": html()}
    body = get(rig, "https://\u0430pple.com/x").json()   # U+0430, CYRILLIC SMALL LETTER A
    assert body["domain"] == "xn--pple-43d.com"
    assert body["domain"].isascii()


def test_an_ordinary_domain_is_unchanged_by_that(rig):
    rig["rec"].routes = {"https://www.news.example.com/a": html()}
    assert get(rig, "https://www.news.example.com/a").json()["domain"] == "news.example.com"


def test_one_member_cannot_hold_every_fetch_slot(rig):
    # M3: _SEM bounds the whole pod; a member pasting slow links could hold all
    # of it. Each member gets PER_USER_INFLIGHT fetches at once; the next is a
    # 429 (never cached -- it is about the member, not the link), and another
    # member is not turned away.
    import asyncio
    from fastapi import HTTPException

    gate = {}

    async def slow(request):
        await gate["open"].wait()
        return html()

    rig["rec"].routes = {f"https://example.com/{i}": slow for i in range(1, 6)}

    async def main():
        gate["open"] = asyncio.Event()
        mine = [asyncio.create_task(lp.link_preview(url=f"https://example.com/{i}", user={"id": "u1"}))
                for i in range(1, lp.PER_USER_INFLIGHT + 1)]
        await asyncio.sleep(0.05)
        try:
            await lp.link_preview(url="https://example.com/5", user={"id": "u1"})
            refused = None
        except HTTPException as exc:
            refused = exc.status_code
        other = asyncio.create_task(lp.link_preview(url="https://example.com/4", user={"id": "u2"}))
        await asyncio.sleep(0.05)
        other_waiting = not other.done()
        gate["open"].set()
        done = await asyncio.gather(*mine, other)
        return refused, other_waiting, done

    refused, other_waiting, done = asyncio.run(main())
    assert refused == 429
    assert other_waiting, "another member was turned away by the first member's fetches"
    assert all(d["title"] for d in done)
    assert lp._cache.get("lp::https://example.com/5") is None, "a per-member refusal was cached against the link"
    assert lp._inflight == {}, "a finished fetch left its slot held"


def test_a_failed_fetch_gives_its_slot_back(rig):
    import asyncio

    rig["rec"].routes = {"https://example.com/gone": httpx.Response(500, text="boom")}
    for _ in range(lp.PER_USER_INFLIGHT + 1):
        assert get(rig, "https://example.com/gone").status_code == 502
        lp._cache.clear()
    assert lp._inflight == {}


# ── wave 6 whole-branch review I-1: a member cannot exhaust the pod ─────────
# The shared guard read redirect and error bodies whole (and decoded), and the
# parse ran on the one event loop. One member's host answering a 404 that never
# ends, or a gzip bomb, or a huge headless page, was a pod-wide outage. The
# guard's own rails (test_note_connectors_base.py) prove the byte budget at the
# primitive; these prove the route answers through it.

_CHUNK = 64 * 1024


class _Endless(httpx.AsyncByteStream):
    """A body that keeps coming, counting what the route pulled (finite only so
    a regression terminates and reds instead of hanging)."""

    def __init__(self, chunks):
        self._chunks = chunks
        self.sent = 0

    async def __aiter__(self):
        for raw in self._chunks:
            self.sent += len(raw)
            yield raw


def test_a_404_that_never_ends_is_a_gateway_answer_after_a_few_kb(rig):
    stream = _Endless(b"x" * _CHUNK for _ in range(512))       # 32 MB on offer
    rig["rec"].routes = {"https://evil.example.com/": lambda req: httpx.Response(404, stream=stream)}
    r = get(rig, "https://evil.example.com/")
    assert r.status_code == 502
    assert stream.sent <= _CHUNK, f"the route pulled {stream.sent:,} bytes of a 404 body"


def test_a_gzip_bomb_page_is_no_preview_and_is_never_inflated_whole(rig):
    import gzip

    bomb = gzip.compress(b"<html><head><title>x</title></head><body>" + bytes(32 * 1024 * 1024), 9)
    stream = _Endless([bomb])
    rig["rec"].routes = {"https://evil.example.com/b": lambda req: httpx.Response(
        200, stream=stream, headers={"content-type": "text/html", "content-encoding": "gzip"})}
    r = get(rig, "https://evil.example.com/b")
    assert (r.status_code, r.json()["detail"]) == (422, "No preview for this link.")
    assert stream.sent == len(bomb), "non-vacuity: the bomb was delivered"


def test_the_route_asks_every_page_for_an_unencoded_body(rig):
    rig["rec"].routes = {"https://news.example.com/a": html()}
    assert get(rig, "https://news.example.com/a").status_code == 200
    assert [q.headers.get("accept-encoding") for q in rig["rec"].requests] == ["identity"]


def test_a_slow_parse_does_not_block_a_concurrent_request(rig, monkeypatch):
    # ⛔ The parse runs in a worker thread and the route AWAITS it: while one
    # page's parse is stuck, another member's preview is fetched, parsed and
    # answered. On the loop, the second request could not even start until the
    # first parse gave up -- `released` below would read False.
    import asyncio
    import threading

    started, release, outcome = threading.Event(), threading.Event(), {}
    real_parse = lp.parse_preview

    def parse(html_text, *, url, final_url, cancel=None):
        if url.endswith("/slow"):
            started.set()
            outcome["released"] = release.wait(timeout=3)
        return real_parse(html_text, url=url, final_url=final_url, cancel=cancel)

    monkeypatch.setattr(lp, "parse_preview", parse)
    rig["rec"].routes = {"https://example.com/slow": html(), "https://example.com/fast": html()}

    async def main():
        slow = asyncio.create_task(lp.link_preview(url="https://example.com/slow", user={"id": "u1"}))
        for _ in range(300):                 # poll on the loop -- never block it
            if started.is_set():
                break
            await asyncio.sleep(0.01)
        fast = await asyncio.wait_for(
            lp.link_preview(url="https://example.com/fast", user={"id": "u2"}), timeout=2)
        slow_was_still_parsing = not slow.done()
        release.set()
        return fast, slow_was_still_parsing, await slow

    fast, slow_was_still_parsing, slow = asyncio.run(main())
    assert started.is_set(), "non-vacuity: the slow parse ran"
    assert outcome.get("released") is True, (
        "the slow parse was never released by the test: the concurrent request could not run "
        "while it parsed -- the parse is blocking the event loop")
    assert slow_was_still_parsing
    assert fast["title"] == slow["title"] == "NVDA prints a record quarter"


def test_a_parse_past_its_ceiling_is_a_gateway_answer_and_is_CANCELLED(rig, monkeypatch):
    # R4-2: the route answers 504 AND tells the parse to stop. The stand-in parse
    # runs until it is told (or 3 s pass) and records which happened -- a route
    # that only stopped WAITING would leave it running to the 3 s limit.
    import threading
    import time

    monkeypatch.setattr(lp, "PARSE_TIMEOUT_S", 0.05)
    seen = {}
    finished = threading.Event()

    def slow_parse(html_text, *, url, final_url, cancel=None):
        t0 = time.monotonic()
        seen["got_cancel_event"] = cancel is not None
        while cancel is not None and not cancel.is_set() and time.monotonic() - t0 < 3:
            time.sleep(0.01)
        seen["cancelled"] = bool(cancel is not None and cancel.is_set())
        seen["ran_s"] = time.monotonic() - t0
        finished.set()
        return None

    monkeypatch.setattr(lp, "parse_preview", slow_parse)
    rig["rec"].routes = {"https://example.com/heavy": html()}
    r = get(rig, "https://example.com/heavy")
    assert r.status_code == 504
    assert lp._inflight == {}, "a timed-out parse left its member slot held"
    assert finished.wait(timeout=5), "the parse thread never finished"
    assert seen["got_cancel_event"], "the route handed the parse no way to be stopped"
    assert seen["cancelled"], f"the timed-out parse was never told to stop (ran {seen['ran_s']:.2f} s)"
    assert seen["ran_s"] < 1.5


# ── R4-2: the parse is BOUNDED, whatever the page ─────────────────────────────

def _pathological_page():
    # Deeply nested tags, no </head>, no <body>: nothing lets the parser stop
    # early, and it is the full body cap -- the most a fetch can hand the parse.
    return "<html><head>" + ("<div>" * ((lp.MAX_BYTES - 12) // 5))


def test_a_pathological_page_is_parsed_only_to_the_cap(monkeypatch):
    import time
    from html.parser import HTMLParser

    page = _pathological_page()
    assert len(page) > 10 * lp.PARSE_MAX_CHARS            # non-vacuity: the cap has to matter

    # The control: what parsing exactly PARSE_MAX_CHARS of this page costs on
    # this box, right now -- so the bound below moves with the machine's load
    # instead of being a wall-clock guess.
    ctl = lp._HeadParser()
    t0 = time.perf_counter()
    ctl.feed(page[: lp.PARSE_MAX_CHARS])
    control_s = time.perf_counter() - t0

    fed = []
    real_feed = HTMLParser.feed
    monkeypatch.setattr(lp._HeadParser, "feed", lambda self, data: (fed.append(len(data)), real_feed(self, data))[1])
    t0 = time.perf_counter()
    assert lp.parse_preview(page, url="https://x.test/", final_url="https://x.test/") is None
    elapsed = time.perf_counter() - t0

    # ⛔ THE TIME ASSERTION. Uncapped, this page is ~12x the control (3 MB vs 256 KiB).
    assert elapsed < 3 * control_s + 0.05, (
        f"parsing took {elapsed * 1000:.0f} ms against a {control_s * 1000:.0f} ms control -- "
        "the parse is not bounded to PARSE_MAX_CHARS")
    assert elapsed < lp.PARSE_TIMEOUT_S
    assert sum(fed) <= lp.PARSE_MAX_CHARS, f"fed {sum(fed):,} chars past a {lp.PARSE_MAX_CHARS:,}-char cap"


def test_a_parse_that_is_cancelled_stops_at_its_next_chunk(monkeypatch):
    import threading
    from html.parser import HTMLParser

    cancel = threading.Event()
    fed = []
    real_feed = HTMLParser.feed

    def feed(self, data):
        fed.append(len(data))
        cancel.set()                      # the route gives up while the first chunk parses
        return real_feed(self, data)

    monkeypatch.setattr(lp._HeadParser, "feed", feed)
    out = lp.parse_preview(_pathological_page(), url="https://x.test/", final_url="https://x.test/", cancel=cancel)
    assert out is None
    assert len(fed) == 1, f"a cancelled parse kept going for {len(fed)} chunks"


def test_CONTROL_a_normal_page_still_previews_through_the_chunked_bounded_parse():
    # A head split across chunk boundaries (and a body after it) still reads whole.
    filler = "<meta name='x' content='" + ("y" * 40_000) + "'>"
    page = ("<html><head>" + filler + "<meta property='og:title' content='Split across chunks'>"
            "</head><body>" + ("<p>body</p>" * 50_000) + "</body></html>")
    out = lp.parse_preview(page, url="https://x.test/a", final_url="https://x.test/a")
    assert out and out["title"] == "Split across chunks"
