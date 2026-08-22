# tests/api/test_cot_prewarm.py
"""`api/services/cot_prewarm.py` + `api/services/cot_weekly_post.py`, the
`/api/cot/narratives/*` + `/api/cot/{symbol}/narratives` routes, and the
scheduler wiring in `api/main.py`.

The facts bundle is a Node CLI this box has not built, so `subprocess.run` is
replaced by a fake that answers `proxies` and `facts` with canned JSON and can
be told to fail a symbol. `fetch_proxy_bars` and `cot_narrative.get_or_create`
are patched to record their calls. The DB goes through `COT_DB_PATH` -> tmp (the
root conftest TRIPWIRE fails the run on any write under `/data`).
"""
from __future__ import annotations

import ast
import importlib
import json
import pathlib
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.services import cot_narrative as cn
from api.services import cot_prewarm as cp
from api.services import cot_weekly_post as cwp
# The archive route is `require_paid`; the gate is owned by
# tests/test_exposed_routes_gated.py. Every request here is a PAID member.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)

REPORT_DATE = "2026-08-18"
PROXIES = {"ES": {"ticker": "SPY", "note": "via SPY"}, "NQ": {"ticker": "QQQ", "note": "via QQQ"},
           "GC": {"ticker": "GLD", "note": "via GLD"}, "ZR": None}
MOST_WATCHED = ["ES", "NQ", "YM", "QR", "EW", "VI", "NK"]
BIAS = {"label": "contrarian bearish", "strength": "strong", "tone": "bear"}
SECRET = "test-push-secret"


# -- fixtures -----------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    """COT DB -> tmp, service reloaded, tables created."""
    path = tmp_path / "cot_test.db"
    monkeypatch.setenv("COT_DB_PATH", str(path))
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()
    assert cn.cot_service.DB_PATH == str(path)
    assert cp.cot_service is svc and cwp.cot_service is svc
    return path


@pytest.fixture
def prewarm_env(db, tmp_path, monkeypatch):
    """A bundle file that exists and a node binary that exists (python itself --
    nothing ever executes because subprocess.run is faked), caches reset, the
    webhook unset, the enable flag at its default."""
    bundle = tmp_path / "cot-facts.cjs"
    bundle.write_text("// fake bundle", encoding="utf-8")
    monkeypatch.setenv(cp.BUNDLE_ENV, str(bundle))
    monkeypatch.setenv(cp.NODE_ENV, sys.executable)
    monkeypatch.delenv(cp.ENABLED_ENV, raising=False)
    monkeypatch.delenv(cwp.WEBHOOK_ENV, raising=False)
    monkeypatch.setattr(cp, "_PROXIES", None)
    monkeypatch.setattr(cp, "_LAST", {"ran": False})
    monkeypatch.setattr(cp, "_RUNNING", False)
    return bundle


class FakeNode:
    """Stands in for `subprocess.run`. `proxies` answers `proxies`; `facts`
    answers from `report_date`; symbols in `fail` exit 1; symbols in `garbage`
    print non-JSON."""

    def __init__(self, proxies=PROXIES, fail=(), garbage=(), report_date=REPORT_DATE):
        self.proxies, self.report_date = proxies, report_date
        self.fail, self.garbage = set(fail), set(garbage)
        self.calls: list[tuple[str, dict | None]] = []

    def __call__(self, argv, input=None, **kw):
        cmd = argv[-1]
        payload = json.loads(input) if input else None
        self.calls.append((cmd, payload))
        if cmd == "proxies":
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(self.proxies), stderr="")
        assert cmd == "facts", cmd
        sym = payload["symbol"]
        if sym in self.fail:
            return subprocess.CompletedProcess(argv, 1, stdout="", stderr=f"bad input for {sym}")
        if sym in self.garbage:
            return subprocess.CompletedProcess(argv, 0, stdout="not json at all", stderr="")
        out = {
            "report_date": self.report_date,
            "facts": {"symbol": sym, "rows": len(payload["rows"]),
                      "has_bars": payload["bars"] is not None},
            "read": {"headline": f"{sym} headline", "bias": dict(BIAS),
                     "crowding": {"label": "crowded", "index": 91},
                     "watch": f"Watch {sym} this week."},
        }
        return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(out), stderr="")


@pytest.fixture
def fake_node(prewarm_env, monkeypatch):
    def _install(**kw):
        fake = FakeNode(**kw)
        monkeypatch.setattr(subprocess, "run", fake)
        return fake
    return _install


@pytest.fixture
def fake_narrative(monkeypatch):
    """Record `get_or_create` calls; answer per symbol from `replies` (an
    Exception raises; the default is a fresh ok)."""
    def _install(replies=None):
        calls: list[dict] = []
        replies = replies or {}

        def _goc(symbol, name, report_date, facts):
            calls.append({"symbol": symbol, "name": name, "report_date": report_date, "facts": facts})
            r = replies.get(symbol)
            if isinstance(r, Exception):
                raise r
            return dict(r or {"status": "ok", "cached": False, "text": "..."})

        monkeypatch.setattr(cn, "get_or_create", _goc)
        return calls
    return _install


@pytest.fixture
def fake_bars(monkeypatch):
    calls: list[str] = []

    def _fetch(ticker):
        calls.append(ticker)
        return [{"t": 1, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}]

    monkeypatch.setattr(cp, "fetch_proxy_bars", _fetch)
    return calls


@pytest.fixture
def most_watched(db, monkeypatch):
    """Pin the MOST WATCHED roster on the service (it is read at call time)."""
    groups = dict(cp.cot_service.SYMBOL_GROUPS)
    groups["MOST WATCHED"] = list(MOST_WATCHED)
    monkeypatch.setattr(cp.cot_service, "SYMBOL_GROUPS", groups)
    return MOST_WATCHED


@pytest.fixture
def client(db):
    from api.main import app
    return TestClient(app)


def _seed(symbols, n=3):
    recs = []
    for sym in symbols:
        for i in range(n):
            recs.append({"symbol": sym, "date": f"2026-08-{4 + 7 * i:02d}",
                         "large_spec_net": 100 + i, "commercial_net": -100 - i,
                         "small_spec_net": i, "open_interest": 1000 + i})
    cp.cot_service._upsert_records(recs)


def _store(sym, text, report_date=REPORT_DATE, model="m"):
    h = cn.facts_hash(sym, report_date, {"k": text})
    return cn._store(sym, report_date, h, text, model)


def _summary(symbols, report_date=REPORT_DATE, watch=True):
    return {"report_date": report_date, "results": {
        s: {"status": "ok", "cached": False, "report_date": report_date,
            "headline": f"{s} headline", "bias": dict(BIAS),
            "watch": f"Watch {s}." if watch else None}
        for s in symbols}}


def _bearer():
    return {"Authorization": f"Bearer {SECRET}"}


# -- run_prewarm --------------------------------------------------------------

def test_full_run_tallies_generated_cached_skipped_and_errors(fake_node, fake_narrative, fake_bars):
    svc = cp.cot_service
    _seed(["ES", "NQ", "GC"])
    _seed(["ZR"], n=1)                      # one row: nothing to read, skipped
    node = fake_node(fail={"GC"})           # the bundle rejects GC
    calls = fake_narrative({"NQ": {"status": "ok", "cached": True, "text": "..."}})

    out = cp.run_prewarm(["ES", "NQ", "GC", "ZR"])

    assert (out["generated"], out["cached"], out["skipped"]) == (1, 1, 1)
    assert out["errors"] == [{"symbol": "GC", "error": "facts"}]
    assert out["report_date"] == REPORT_DATE and out["symbols"] == 4 and out["ran"] is True
    assert out["results"]["ES"] == {
        "status": "ok", "cached": False, "report_date": REPORT_DATE,
        "headline": "ES headline", "bias": BIAS, "watch": "Watch ES this week.", "reason": None}
    assert out["results"]["NQ"]["cached"] is True
    assert out["results"]["GC"]["status"] == "error"
    assert out["results"]["ZR"] == {"status": "skipped", "cached": False, "report_date": None,
                                    "headline": None, "bias": None, "watch": None, "reason": "1 rows"}
    # The bundle saw every symbol with rows -- ascending records, the display
    # name, and its proxy's bars.
    facts = {p["symbol"]: p for c, p in node.calls if c == "facts"}
    assert set(facts) == {"ES", "NQ", "GC"}
    assert facts["ES"]["name"] == svc.SYMBOL_NAMES["ES"]
    assert [r["date"] for r in facts["ES"]["rows"]] == ["2026-08-04", "2026-08-11", "2026-08-18"]
    assert facts["ES"]["bars"] and facts["ES"]["bars"][0]["c"] == 1.5
    assert fake_bars == ["SPY", "QQQ", "GLD"]
    # get_or_create was asked for exactly the symbols whose facts came back,
    # with the bundle's facts verbatim.
    assert [c["symbol"] for c in calls] == ["ES", "NQ"]
    assert calls[0] == {"symbol": "ES", "name": svc.SYMBOL_NAMES["ES"], "report_date": REPORT_DATE,
                        "facts": {"symbol": "ES", "rows": 3, "has_bars": True}}
    # No webhook -> the post is the recorded no-op, and the run is the last status.
    assert out["post"] == {"posted": 0, "skipped": "no-webhook"}
    assert cp.last_status()["generated"] == 1 and cp.last_status()["running"] is False


def test_a_symbol_without_a_proxy_gets_null_bars(fake_node, fake_narrative, fake_bars):
    _seed(["ZR"])
    node = fake_node()
    fake_narrative()
    out = cp.run_prewarm(["ZR"])
    assert out["generated"] == 1
    assert fake_bars == []
    facts = [p for c, p in node.calls if c == "facts"]
    assert facts[0]["bars"] is None


def test_a_symbol_that_raises_is_tallied_and_the_loop_continues(fake_node, fake_narrative, fake_bars):
    _seed(["ES", "NQ"])
    fake_node()
    fake_narrative({"ES": RuntimeError("boom")})
    out = cp.run_prewarm(["ES", "NQ"])
    assert out["generated"] == 1
    assert out["errors"] == [{"symbol": "ES", "error": "RuntimeError: boom"}]
    assert out["results"]["ES"]["status"] == "error"
    assert out["results"]["NQ"]["status"] == "ok"


def test_a_degraded_narrative_status_is_an_error_not_a_generation(fake_node, fake_narrative, fake_bars):
    _seed(["ES", "NQ"])
    fake_node()
    fake_narrative({"ES": {"status": "capped", "cached": False, "text": None, "reason": "daily cap"},
                    "NQ": {"status": "disabled", "cached": False, "text": None, "reason": "off"}})
    out = cp.run_prewarm(["ES", "NQ"])
    assert out["generated"] == 0 and out["cached"] == 0
    assert out["errors"] == [{"symbol": "ES", "error": "daily cap"}, {"symbol": "NQ", "error": "off"}]


def test_the_default_roster_is_every_symbol_in_symbol_map(fake_node, fake_narrative, fake_bars):
    fake_node()
    fake_narrative()
    out = cp.run_prewarm()
    assert out["symbols"] == len(cp.cot_service.SYMBOL_MAP)
    assert set(out["results"]) == set(cp.cot_service.SYMBOL_MAP)
    assert out["skipped"] == len(cp.cot_service.SYMBOL_MAP)     # empty DB: all skipped


def test_disabled_env_skips_without_touching_the_bundle(fake_node, monkeypatch):
    node = fake_node()
    monkeypatch.setenv(cp.ENABLED_ENV, "0")
    assert cp.run_prewarm() == {"skipped": "disabled"}
    assert node.calls == []
    assert cp.last_status()["skipped"] == "disabled"


def test_missing_bundle_returns_no_bundle_without_raising(prewarm_env, monkeypatch, tmp_path):
    monkeypatch.setenv(cp.BUNDLE_ENV, str(tmp_path / "does-not-exist.cjs"))
    assert cp.run_prewarm() == {"skipped": "no-bundle"}
    assert cp.last_status()["skipped"] == "no-bundle"


def test_missing_node_returns_no_bundle_without_raising(prewarm_env, monkeypatch):
    monkeypatch.setenv(cp.NODE_ENV, "no-such-node-binary-xyz")
    assert cp.run_prewarm() == {"skipped": "no-bundle"}


def test_a_second_caller_while_a_run_is_in_flight_gets_busy(fake_node):
    fake_node()
    assert cp._LOCK.acquire(blocking=False)
    try:
        assert cp.run_prewarm() == {"skipped": "busy"}
    finally:
        cp._LOCK.release()
    # and the lock is released again after a real run
    assert cp.run_prewarm([])["ran"] is True
    assert cp._LOCK.acquire(blocking=False)
    cp._LOCK.release()


def test_a_weekly_post_that_blows_up_never_escapes_the_run(fake_node, fake_narrative, fake_bars, monkeypatch):
    _seed(["ES"])
    fake_node()
    fake_narrative()

    def _boom(summary):
        raise RuntimeError("discord down")
    monkeypatch.setattr(cwp, "post_most_watched", _boom)
    out = cp.run_prewarm(["ES"])
    assert out["generated"] == 1
    assert out["post"] == {"posted": 0, "error": "RuntimeError: discord down"}


def test_last_status_before_any_run(monkeypatch):
    monkeypatch.setattr(cp, "_LAST", {"ran": False})
    monkeypatch.setattr(cp, "_RUNNING", False)
    assert cp.last_status() == {"ran": False, "running": False}


# -- the bundle pieces --------------------------------------------------------

def test_proxies_are_cached_after_the_first_success(fake_node):
    node = fake_node()
    assert cp.proxies()["ES"] == {"ticker": "SPY", "note": "via SPY"}
    assert cp.proxies()["ZR"] is None
    assert [c for c, _ in node.calls] == ["proxies"]


def test_proxies_failure_is_empty_and_not_cached(prewarm_env, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda argv, **kw: subprocess.CompletedProcess(
        argv, 2, stdout="", stderr="nope"))
    assert cp.proxies() == {}
    assert cp._PROXIES is None


def test_facts_for_returns_none_on_a_nonzero_exit_or_garbage(fake_node):
    fake_node(fail={"ES"}, garbage={"NQ"})
    assert cp.facts_for("ES", "S&P", [], None) is None
    assert cp.facts_for("NQ", "Nasdaq", [], None) is None
    good = cp.facts_for("GC", "Gold", [{"date": "2026-08-18"}], None)
    assert good["report_date"] == REPORT_DATE and good["read"]["bias"] == BIAS


def test_facts_for_when_node_itself_cannot_start_is_none_not_a_raise(prewarm_env, monkeypatch):
    def _boom(argv, **kw):
        raise FileNotFoundError("node")
    monkeypatch.setattr(subprocess, "run", _boom)
    assert cp.facts_for("ES", "x", [], None) is None


def test_the_bundle_is_invoked_as_node_bundle_command(prewarm_env, monkeypatch):
    seen = {}

    def _run(argv, input=None, **kw):
        seen.update(argv=argv, input=input, kw=kw)
        return subprocess.CompletedProcess(argv, 0, stdout="{}", stderr="")
    monkeypatch.setattr(subprocess, "run", _run)
    cp.proxies()
    assert seen["argv"] == [sys.executable, str(prewarm_env), "proxies"]
    assert seen["input"] is None
    assert seen["kw"]["capture_output"] is True and seen["kw"]["timeout"] == cp.BUNDLE_TIMEOUT_S


# -- proxy bars ---------------------------------------------------------------

def test_fetch_proxy_bars_reads_the_in_process_bars_response(monkeypatch):
    from fastapi.responses import ORJSONResponse
    from api.routers import bars as bars_router
    seen = {}
    series = [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]

    def _get_bars(ticker, **kw):
        seen.update(ticker=ticker, **kw)
        return ORJSONResponse(content={"ticker": ticker, "tf": kw["tf"], "bars": series})
    monkeypatch.setattr(bars_router, "get_bars", _get_bars)
    assert cp.fetch_proxy_bars("spy") == series
    # every query param explicit -- an omitted one is a truthy Query() object
    assert seen == {"ticker": "SPY", "tf": "W", "bars": cp.BARS_COUNT, "since": "", "to": "", "warm": 0}


def test_fetch_proxy_bars_is_empty_on_a_503_and_on_a_double_failure(monkeypatch):
    import requests
    from fastapi.responses import ORJSONResponse
    from api.routers import bars as bars_router
    monkeypatch.setattr(bars_router, "get_bars", lambda ticker, **kw: ORJSONResponse(
        status_code=503, content={"ticker": ticker, "tf": "W", "bars": [], "error": "transient"}))
    assert cp.fetch_proxy_bars("SPY") == []

    def _crash(ticker, **kw):
        raise RuntimeError("store gone")
    http = []

    def _get(url, timeout=None):
        http.append((url, timeout))
        raise ConnectionError("refused")
    monkeypatch.setattr(bars_router, "get_bars", _crash)
    monkeypatch.setattr(requests, "get", _get)
    monkeypatch.setenv("PORT", "8123")
    assert cp.fetch_proxy_bars("SPY") == []
    assert http == [(f"http://127.0.0.1:8123/api/bars/SPY?tf=W&bars={cp.BARS_COUNT}", cp.HTTP_TIMEOUT_S)]
    assert cp.fetch_proxy_bars("") == []


# -- the weekly post ----------------------------------------------------------

def test_no_webhook_means_nothing_posts(most_watched, monkeypatch):
    monkeypatch.delenv(cwp.WEBHOOK_ENV, raising=False)
    posts = []
    monkeypatch.setattr(cwp.requests, "post", lambda *a, **k: posts.append(1))
    _store("ES", "prose")
    assert cwp.post_most_watched(_summary(["ES"])) == {"posted": 0, "skipped": "no-webhook"}
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "   ")
    assert cwp.post_most_watched(_summary(["ES"])) == {"posted": 0, "skipped": "no-webhook"}
    assert posts == []


def test_posts_one_embed_per_most_watched_symbol_in_batches_of_five(most_watched, monkeypatch):
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "https://discord.test/hook")
    posts = []

    def _post(url, json=None, timeout=None):
        posts.append((url, json, timeout))
        return SimpleNamespace(status_code=204, text="")
    monkeypatch.setattr(cwp.requests, "post", _post)
    for s in MOST_WATCHED:
        _store(s, f"{s} prose")
    _store("GC", "gold prose")          # stored, but not most-watched: never posted

    out = cwp.post_most_watched(_summary(MOST_WATCHED + ["GC"]))

    assert out == {"posted": 7, "messages": 2, "embeds": 7}
    assert [len(j["embeds"]) for _, j, _ in posts] == [5, 2]
    assert all(u == "https://discord.test/hook" and t == 10 for u, _, t in posts)
    titles = [e["title"] for _, j, _ in posts for e in j["embeds"]]
    assert titles[0] == "ES · S&P 500 E-Mini — contrarian bearish (strong)"
    assert [t.split(" ")[0] for t in titles] == MOST_WATCHED
    e = posts[0][1]["embeds"][0]
    assert e["description"] == "ES prose"
    assert e["fields"] == [{"name": "What to watch", "value": "Watch ES.", "inline": False}]
    assert e["footer"] == {"text": f"CFTC report {REPORT_DATE} · UCT Intelligence"}
    assert e["color"] == 0xE74C3C


def test_a_most_watched_symbol_without_a_stored_read_is_left_out(most_watched, monkeypatch):
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "https://discord.test/hook")
    posts = []
    monkeypatch.setattr(cwp.requests, "post", lambda url, json=None, timeout=None: (
        posts.append(json), SimpleNamespace(status_code=200, text=""))[1])
    _store("ES", "es prose")
    _store("NQ", "nq prose")
    _store("YM", "last week", report_date="2026-08-11")     # another week: not this post
    out = cwp.post_most_watched(_summary(MOST_WATCHED))
    assert out == {"posted": 2, "messages": 1, "embeds": 2}
    assert [e["title"].split(" ")[0] for e in posts[0]["embeds"]] == ["ES", "NQ"]


def test_nothing_stored_for_the_week_is_a_recorded_no_op(most_watched, monkeypatch):
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "https://discord.test/hook")
    posts = []
    monkeypatch.setattr(cwp.requests, "post", lambda *a, **k: posts.append(1))
    assert cwp.post_most_watched(_summary([]))["skipped"] == "no-narratives"
    assert cwp.post_most_watched({"report_date": None, "results": {}})["skipped"] == "no-narratives"
    assert posts == []


def test_without_a_most_watched_group_on_the_service_the_post_is_a_recorded_no_op(db, monkeypatch):
    groups = {k: v for k, v in cp.cot_service.SYMBOL_GROUPS.items() if k != "MOST WATCHED"}
    monkeypatch.setattr(cp.cot_service, "SYMBOL_GROUPS", groups)
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "https://discord.test/hook")
    posts = []
    monkeypatch.setattr(cwp.requests, "post", lambda *a, **k: posts.append(1))
    _store("ES", "prose")
    assert cwp.post_most_watched(_summary(["ES"]))["skipped"] == "no-most-watched-group"
    assert posts == []


def test_a_failed_post_is_counted_as_not_posted_and_never_raises(most_watched, monkeypatch):
    monkeypatch.setenv(cwp.WEBHOOK_ENV, "https://discord.test/hook")
    answers = [ConnectionError("refused"), SimpleNamespace(status_code=429, text="slow down")]

    def _post(url, json=None, timeout=None):
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(cwp.requests, "post", _post)
    for s in MOST_WATCHED:
        _store(s, f"{s} prose")
    # 7 embeds -> [5, 2]: the first message raises, the second is rate-limited.
    assert cwp.post_most_watched(_summary(MOST_WATCHED)) == {"posted": 0, "messages": 0, "embeds": 7}
    # Fresh run: first message 429 -> not counted; second 204 -> counted.
    answers[:] = [SimpleNamespace(status_code=429, text=""), SimpleNamespace(status_code=204, text="")]
    assert cwp.post_most_watched(_summary(MOST_WATCHED)) == {"posted": 2, "messages": 1, "embeds": 7}


def test_colors_follow_the_tone_and_the_title_drops_a_missing_strength(db):
    row = {"text": "x"}
    bull = cwp.build_embed("ES", row, {"bias": {"label": "bullish lean", "strength": "", "tone": "bull"}},
                           REPORT_DATE)
    assert bull["color"] == 0x3CB868
    assert bull["title"] == "ES · S&P 500 E-Mini — bullish lean"
    neutral = cwp.build_embed("ES", row, {}, REPORT_DATE)
    assert neutral["color"] == 0xC9A84C
    assert neutral["title"] == "ES · S&P 500 E-Mini"
    assert "fields" not in neutral
    assert cwp.color_for("Bearish") == 0xE74C3C and cwp.color_for(None) == 0xC9A84C


def test_truncation_lands_on_a_word_boundary_with_an_ellipsis():
    words = " ".join(f"word{i}" for i in range(400))        # ~2.8K chars
    out = cwp.truncate(words, 1000)
    assert len(out) <= 1000 and out.endswith("…")
    body = out[:-1]
    assert body == words[:len(body)]                        # a prefix of the original
    assert not body.endswith(" ") and words[len(body)] == " "   # cut exactly between words
    assert cwp.truncate("short", 1000) == "short"
    assert cwp.truncate("", 10) == ""
    assert cwp.truncate(None, 10) == ""
    two = "first paragraph.\n\nsecond paragraph that runs on and on"
    assert cwp.truncate(two, 30) == "first paragraph.\n\nsecond…"


def test_embeds_are_truncated_to_the_discord_caps(most_watched):
    _store("ES", "para " * 400)
    summary = _summary(["ES"])
    summary["results"]["ES"]["watch"] = "watch " * 400
    [e] = cwp.build_embeds(summary)
    assert len(e["description"]) <= 1000 and e["description"].endswith("…")
    assert len(e["fields"][0]["value"]) <= 1024 and e["fields"][0]["value"].endswith("…")


def test_batches_also_respect_the_per_message_character_budget():
    big = {"title": "t", "description": "x" * 3000, "footer": {"text": "f"}}
    assert [len(b) for b in cwp.batches([big] * 3)] == [1, 1, 1]
    small = {"title": "t", "description": "x" * 10, "footer": {"text": "f"}}
    assert [len(b) for b in cwp.batches([small] * 12)] == [5, 5, 2]


# -- routes -------------------------------------------------------------------

def test_the_operator_routes_refuse_without_the_bearer(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    assert client.post("/api/cot/narratives/prewarm").status_code == 401
    assert client.post("/api/cot/narratives/prewarm",
                       headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/cot/narratives/prewarm-status").status_code == 401
    assert client.get("/api/cot/narratives/recent").status_code == 401


def test_a_blank_push_secret_refuses_everyone(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "")
    assert client.post("/api/cot/narratives/prewarm",
                       headers={"Authorization": "Bearer "}).status_code == 401
    assert client.get("/api/cot/narratives/recent",
                      headers={"Authorization": "Bearer "}).status_code == 401


def test_prewarm_route_starts_the_run_in_a_daemon_thread_and_returns_at_once(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    seen, done = [], threading.Event()

    def _run(symbols=None):
        t = threading.current_thread()
        seen.append((t.name, t.daemon, symbols))
        done.set()
        return {}
    monkeypatch.setattr(cp, "run_prewarm", _run)

    r = client.post("/api/cot/narratives/prewarm", headers=_bearer())
    assert r.status_code == 200 and r.json() == {"started": True, "symbols": "all"}
    assert done.wait(5)
    assert seen == [("cot-prewarm", True, None)]

    done.clear()
    r = client.post("/api/cot/narratives/prewarm?symbols=es,%20gc,", headers=_bearer())
    assert r.json() == {"started": True, "symbols": 2}
    assert done.wait(5) and seen[-1][2] == ["ES", "GC"]


def test_prewarm_status_reports_the_last_run(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setattr(cp, "_LAST", {"ran": True, "generated": 3})
    monkeypatch.setattr(cp, "_RUNNING", False)
    r = client.get("/api/cot/narratives/prewarm-status", headers=_bearer())
    assert r.status_code == 200 and r.json() == {"ran": True, "generated": 3, "running": False}


def test_recent_lists_newest_first_with_a_clamped_limit(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    for sym, rd in [("ES", "2026-08-04"), ("NQ", "2026-08-11"), ("GC", "2026-08-18")]:
        _store(sym, f"{sym} text", rd)
    r = client.get("/api/cot/narratives/recent?limit=2", headers=_bearer())
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert [x["symbol"] for x in rows] == ["GC", "NQ"]
    assert set(rows[0]) == {"symbol", "report_date", "model", "created_at", "text"}
    assert rows[0]["text"] == "GC text" and rows[0]["model"] == "m"
    assert len(client.get("/api/cot/narratives/recent?limit=0", headers=_bearer()).json()["rows"]) == 1
    assert len(client.get("/api/cot/narratives/recent", headers=_bearer()).json()["rows"]) == 3
    assert cn._clamp(9999, 1, 100) == 100 and cn._clamp("x", 1, 100) == 1


def test_symbol_archive_returns_one_row_per_week_newest_first(client):
    _store("ES", "week1 v1", "2026-08-04")
    _store("ES", "week1 v2", "2026-08-04")     # a re-hash of the same week: newest wins
    _store("ES", "week2", "2026-08-11")
    _store("NQ", "other symbol", "2026-08-11")
    r = client.get("/api/cot/ES/narratives")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "ES"
    assert [(x["report_date"], x["text"]) for x in body["rows"]] == [
        ("2026-08-11", "week2"), ("2026-08-04", "week1 v2")]
    assert set(body["rows"][0]) == {"report_date", "text", "created_at"}
    one = client.get("/api/cot/es/narratives?limit=1").json()
    assert [x["report_date"] for x in one["rows"]] == ["2026-08-11"]
    assert cn._clamp(9999, 1, 260) == 260
    assert cn.get_for("ES", "2026-08-04")["text"] == "week1 v2"
    assert cn.get_for("ES", "2026-01-01") is None


def test_symbol_archive_404s_an_unknown_symbol(client):
    assert client.get("/api/cot/FAKESYMBOL/narratives").status_code == 404


def test_literal_narrative_routes_are_declared_before_the_symbol_catch_all():
    from api.routers import cot as cot_router
    paths = [getattr(r, "path", "") for r in cot_router.router.routes]
    catch_all = paths.index("/api/cot/{symbol}")
    for p in ("/api/cot/narratives/prewarm", "/api/cot/narratives/prewarm-status",
              "/api/cot/narratives/recent"):
        assert paths.index(p) < catch_all, f"{p} is declared after GET /{{symbol}}, which would swallow it"
    assert "/api/cot/{symbol}/narratives" in paths


# -- scheduler wiring (an AST over api/main.py, never a grep) ------------------

REPO = pathlib.Path(__file__).resolve().parents[2]
MAIN = REPO / "api" / "main.py"


def _add_jobs(tree) -> dict[str, ast.Call]:
    """job id -> the `add_job(...)` call, for every literal `id=`."""
    out = {}
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            continue
        for kw in n.keywords:
            if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                out[kw.value.value] = n
    return out


def _trigger_of(call: ast.Call) -> dict:
    """The literal keywords of the `trigger=CronTrigger(...)` on an add_job call."""
    for kw in call.keywords:
        if kw.arg == "trigger" and isinstance(kw.value, ast.Call):
            return {k.arg: (k.value.value if isinstance(k.value, ast.Constant) else ast.unparse(k.value))
                    for k in kw.value.keywords}
    return {}


def test_both_prewarm_jobs_are_registered_on_the_scheduler_in_main():
    jobs = _add_jobs(ast.parse(MAIN.read_text(encoding="utf-8")))
    # NON-VACUITY: the probe must see the sibling it is not looking for.
    assert "cot_weekly_refresh" in jobs, (
        "the add_job AST scan found no sibling COT job -- the probe is broken, "
        "so its verdict on the prewarm jobs means nothing")
    assert "cot_narrative_prewarm" in jobs, f"registered cot ids: {[i for i in jobs if 'cot' in i]}"
    assert "cot_narrative_prewarm_retry" in jobs
    fri = _trigger_of(jobs["cot_narrative_prewarm"])
    assert (fri["day_of_week"], fri["hour"], fri["minute"], fri["timezone"]) == ("fri", 17, 5, "_ET")
    sat = _trigger_of(jobs["cot_narrative_prewarm_retry"])
    assert (sat["day_of_week"], sat["hour"], sat["minute"], sat["timezone"]) == ("sat", 9, 0, "_ET")
    for jid in ("cot_narrative_prewarm", "cot_narrative_prewarm_retry"):
        kws = {k.arg: getattr(k.value, "value", None) for k in jobs[jid].keywords}
        assert kws.get("max_instances") == 1 and kws.get("replace_existing") is True
