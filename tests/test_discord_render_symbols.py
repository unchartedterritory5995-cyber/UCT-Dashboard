"""Symbol resolution and the /flow partition (step 2.4a; D-04, OI-01, C-14).

What must hold:
  * an unknown symbol is refused privately inside the ack, with ≤3 suggestions, the job is never
    queued, and a background fetch starts so a real-but-unseen ticker works on the re-run;
  * the refusal happens only on a DEFINITE miss — an authority that errors, a search index that has
    not loaded, or a check that runs past its budget all let the request through;
  * an ETF or index underlying reads the `etfs` flow partition on the V2 path, and the pre-V2 path
    still reads `stocks`.
"""
from __future__ import annotations

import json
import time

import httpx
import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

from api.services import discord_interactions as di
from api.services.discord_render import commands, symbols

KNOWN = symbols.Resolution("NVDA", symbols.KNOWN, authority="universe")


def _checks(**answers):
    return tuple((name, (lambda s, a=answer: a(s) if callable(a) else a)) for name, answer in answers.items())


# ── resolve ─────────────────────────────────────────────────────────────────

def test_the_first_authority_that_knows_a_symbol_answers_and_the_rest_are_not_asked():
    asked = []

    def spy(name, ans):
        return lambda s: asked.append(name) or ans
    r = symbols.resolve("$nvda", checks=(("breadth", spy("breadth", False)), ("universe", spy("universe", True)),
                                         ("bars_store", spy("bars_store", True))), index_ready=lambda: True)
    assert (r.symbol, r.status, r.authority) == ("NVDA", symbols.KNOWN, "universe")
    assert asked == ["breadth", "universe"]


def test_a_definite_miss_is_unknown_with_suggestions():
    r = symbols.resolve("NVDAA", checks=_checks(universe=False, search_index=False), index_ready=lambda: True,
                        confirm=lambda s: "no_data")
    assert r.status == symbols.UNKNOWN and len(r.suggestions) <= symbols.MAX_SUGGESTIONS


@pytest.mark.parametrize("verdict,status,authority", [
    ("bars", symbols.KNOWN, "bars_serve"), ("undetermined", symbols.UNANSWERABLE, None), ("no_data", symbols.UNKNOWN, None)])
def test_a_static_miss_is_refused_only_when_bars_itself_says_not_carried(verdict, status, authority):
    """Production 2026-09-13: BTC-USD, ^GSPC and FNMA are in no static authority and all three chart."""
    r = symbols.resolve("BTC-USD", checks=_checks(universe=False), index_ready=lambda: True, confirm=lambda s: verdict)
    assert (r.status, r.authority) == (status, authority)


def test_a_confirmation_that_raises_never_refuses():
    def boom(s):
        raise TimeoutError("provider")
    assert symbols.resolve("FNMA", checks=_checks(universe=False), index_ready=lambda: True,
                           confirm=boom).status == symbols.UNANSWERABLE


class _Resp:
    def __init__(self, status, body):
        self.status_code, self.body = status, json.dumps(body).encode()


@pytest.mark.parametrize("resp,verdict", [
    (_Resp(200, {"bars": [{"t": 1}]}), "bars"),
    (_Resp(200, {"bars": [], "no_data": True, "reason": "symbol_not_carried"}), "no_data"),
    (_Resp(503, {"bars": [], "warming": True}), "undetermined"),
    (_Resp(200, {"bars": []}), "undetermined"),
])
def test_the_bars_verdict_reads_the_serve_paths_own_answer(resp, verdict):
    assert symbols.bars_verdict("X", serve=lambda *a: resp) == verdict


def test_a_dot_share_class_matches_the_hyphen_spelling_the_universe_uses():
    r = symbols.resolve("BRK.B", checks=(("universe", lambda s: s == "BRK-B"),), index_ready=lambda: True,
                        confirm=lambda s: "no_data")
    assert (r.status, r.authority) == (symbols.KNOWN, "universe")


def test_an_unloaded_index_or_an_erroring_authority_never_refuses():
    assert symbols.resolve("ZZZZQ", checks=_checks(universe=False), index_ready=lambda: False).status == symbols.UNANSWERABLE

    def boom(s):
        raise RuntimeError("bars.db locked")
    r = symbols.resolve("ZZZZQ", checks=(("universe", lambda s: False), ("bars_store", boom)), index_ready=lambda: True)
    assert r.status == symbols.UNANSWERABLE, "an authority that could not answer was read as a 'no'"


def test_the_real_authority_list_is_the_one_bars_serves_by_plus_entity_master_and_the_store():
    names = [n for n, _ in symbols._checks()]
    assert names == ["breadth", "index", "universe", "search_index", "delisted", "entity_master", "bars_store"]
    assert symbols.resolve("UCTA50", index_ready=lambda: True).authority == "breadth"


# ── suggestions ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b,expected", [
    ("NDVA", "NVDA", True),                    # adjacent swap — the only case a substitution check cannot pass
    ("APPL", "AAPL", True),                    # substitution (one position differs), NOT a swap
    ("NVDAA", "NVDA", True), ("NVD", "NVDA", True), ("MSFY", "MSFT", True),
    ("NVDA", "NVDA", False), ("DVNA", "NVDA", False), ("ABCD", "DCBA", False), ("AB", "ABCD", False),
])
def test_one_edit_covers_insert_delete_substitute_and_swap(a, b, expected):
    assert symbols.edit1(a, b) is expected


def test_suggestions_are_capped_ordered_and_never_the_symbol_itself():
    search = lambda s: [{"ticker": "APPLE-X"}, {"ticker": "ZZZ"}, {"ticker": s}]       # noqa: E731
    universe = lambda: frozenset({"AAPL", "APPN", "APPS", "MSFT"})                       # noqa: E731
    got = symbols.suggestions("APPL", search=search, universe=universe)
    assert got == ("APPLE-X", "AAPL", "APPN")
    assert "APPL" not in got and len(got) == symbols.MAX_SUGGESTIONS
    assert symbols.suggestions("QQQQQQ", search=lambda s: [], universe=lambda: frozenset()) == ()


def test_a_symbol_merely_containing_the_input_ranks_after_one_edit_matches():
    """Production 2026-09-13, before this order: APPL suggested MAPPLNCT ahead of AAPL."""
    got = symbols.suggestions("APPL", search=lambda s: [{"ticker": "MAPPLNCT"}],
                              universe=lambda: frozenset({"AAPL", "AMPL"}))
    assert got == ("AAPL", "AMPL", "MAPPLNCT")


def test_the_refusal_names_the_symbol_the_suggestions_and_the_id():
    text = symbols.refusal_text([symbols.Resolution("APPL", symbols.UNKNOWN, suggestions=("AAPL", "APP", "APPN"))],
                                "7f3a9c21")
    assert "**APPL** (did you mean AAPL, APP or APPN?)" in text and text.endswith("· id 7f3a9c21")
    assert "run it again" in text and len(text) <= 2000


# ── the /flow partition ─────────────────────────────────────────────────────

def test_the_flow_partition_follows_flow_ingestions_classifier_then_the_etf_list(monkeypatch):
    from api import massive_processor
    from api.services import cap_universe
    monkeypatch.setattr(massive_processor, "is_index_source", lambda s: s in {"SPY", "SPX"})
    monkeypatch.setattr(cap_universe, "etf_symbols", lambda: frozenset({"SMH"}))
    assert [symbols.flow_source(s) for s in ("spy", "SPX", "SMH", "NVDA")] == ["etfs", "etfs", "etfs", "stocks"]

    def broken(s):
        raise RuntimeError("no class table")
    monkeypatch.setattr(massive_processor, "is_index_source", broken)
    assert symbols.flow_source("SMH") == "etfs" and symbols.flow_source("NVDA") == "stocks"


def test_the_flow_job_reads_the_partition_it_is_given_and_defaults_to_stocks(monkeypatch):
    from api.routers import discord_interactions as router
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    seen = []

    def get(url, params=None, timeout=None):
        seen.append(dict(params))
        return httpx.Response(200, json={"ok": True, "contracts": [], "window": {}}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "get", get)
    edits = []
    router.run_flow_card_job("A", "T", "NVDA", "1", edit_fn=lambda *a, **k: edits.append(k) or True)
    router.run_flow_card_job("A", "T", "SPY", "1", edit_fn=lambda *a, **k: edits.append(k) or True, source="etfs")
    assert [p["source"] for p in seen] == ["stocks", "etfs"]


def test_warm_fetches_once_per_window():
    symbols.clear_for_tests()
    fetched, clock = [], [1000.0]
    assert symbols.warm("zzzq", fetch=fetched.append, now=lambda: clock[0]) is True
    assert symbols.warm("ZZZQ", fetch=fetched.append, now=lambda: clock[0]) is False
    clock[0] += symbols.WARM_TTL_S + 1
    assert symbols.warm("ZZZQ", fetch=fetched.append, now=lambda: clock[0]) is True
    assert fetched == ["ZZZQ", "ZZZQ"]


# ── at the ack, through the real route ──────────────────────────────────────

class FakeRuntime:
    def __init__(self):
        self.offered, self.per_user_max = [], 2

    def offer(self, job):
        self.offered.append(job)
        return ("queued", 1)

    def record_ack(self, cid, ms):
        pass

    def record_refused(self, job, cls):
        pass


@pytest.fixture
def v2(monkeypatch):
    for k in ("DISCORD_RENDER_V2_CHART_ENABLED", "DISCORD_RENDER_V2_FLOW_ENABLED", "DISCORD_RENDER_V2_SYMBOLS_ENABLED",
              "CHART_FLOW_CHANNEL_ID", "FLOW_CMD_CHANNEL_ID", "DISCORD_CHART_ALLOWED_GUILDS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DISCORD_RENDER_V2_ENABLED", "1")
    sk, pub = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    fake = FakeRuntime()
    monkeypatch.setattr(commands, "get_runtime", lambda: fake)
    warmed = []
    monkeypatch.setattr(commands._warm_pool, "submit", lambda fn, sym: warmed.append(sym))
    di.reset_rate_for_tests()
    tc, _ = _app_client()
    yield tc, sk, fake, warmed
    di.reset_rate_for_tests()


def _slash(name="chart", value="NVDA", iid="1618033988749894848"):
    return {"type": 2, "id": iid, "application_id": "APP", "token": "TOK", "guild_id": UT_GUILD, "channel_id": "999",
            "member": {"user": {"id": "u1"}}, "data": {"name": name, "options": [{"name": "ticker", "value": value}]}}


def test_an_unknown_symbol_is_refused_privately_fast_and_never_queued(v2, monkeypatch):
    tc, sk, fake, warmed = v2
    monkeypatch.setattr(symbols, "resolve", lambda t: symbols.Resolution(t, symbols.UNKNOWN, suggestions=("AAPL",))
                        if t == "APPL" else KNOWN)
    t0 = time.perf_counter()
    r = _post(tc, sk, _slash(value="APPL")).json()
    assert time.perf_counter() - t0 < 1.0
    assert r["type"] == 4 and r["data"]["flags"] == di.EPHEMERAL
    assert "**APPL** (did you mean AAPL?)" in r["data"]["content"] and "· id " in r["data"]["content"]
    assert fake.offered == [] and warmed == ["APPL"]


def test_a_known_symbol_is_queued(v2, monkeypatch):
    tc, sk, fake, warmed = v2
    monkeypatch.setattr(symbols, "resolve", lambda t: KNOWN)
    assert _post(tc, sk, _slash()).json() == {"type": 5}
    assert [j.command for j in fake.offered] == ["chart"] and warmed == []


def test_one_unknown_among_several_refuses_the_request_and_names_only_it(v2, monkeypatch):
    tc, sk, fake, _ = v2
    monkeypatch.setattr(symbols, "resolve", lambda t: symbols.Resolution(t, symbols.UNKNOWN) if t == "ZZZQ" else KNOWN)
    content = _post(tc, sk, _slash(value="NVDA ZZZQ AMD")).json()["data"]["content"]
    assert "**ZZZQ**" in content and "NVDA" not in content and fake.offered == []


def test_a_compare_symbol_is_checked_too(v2, monkeypatch):
    tc, sk, fake, _ = v2
    monkeypatch.setattr(symbols, "resolve", lambda t: symbols.Resolution(t, symbols.UNKNOWN) if t == "ZZZQ" else KNOWN)
    inter = _slash(value="NVDA")
    inter["data"]["options"].append({"name": "compare", "value": "ZZZQ"})
    r = _post(tc, sk, inter).json()
    assert r["type"] == 4 and "**ZZZQ**" in r["data"]["content"] and fake.offered == []


@pytest.mark.parametrize("case", ["slow", "unanswerable", "raises"])
def test_the_check_fails_open(v2, monkeypatch, case):
    tc, sk, fake, warmed = v2

    def resolve(t):
        if case == "slow":
            time.sleep(1.5)
        if case == "raises":
            raise RuntimeError("index exploded")
        return symbols.Resolution(t, symbols.UNANSWERABLE)
    monkeypatch.setattr(symbols, "resolve", resolve)
    monkeypatch.setattr(commands, "SYMBOL_BUDGET_S", 0.2)
    t0 = time.perf_counter()
    assert _post(tc, sk, _slash(value="ZZZQ")).json() == {"type": 5}
    assert time.perf_counter() - t0 < 1.0 and len(fake.offered) == 1 and warmed == []


def test_the_symbol_check_runs_on_its_own_pool_not_autocompletes(v2, monkeypatch):
    """The check can reach the bars serve core, which may fetch a cold symbol for seconds after the
    budget has moved on — that must never hold a worker autocomplete answers from."""
    tc, sk, _, _ = v2
    seen = []
    real = commands._bounded

    async def spy(fn, budget_s, default, pool=None):
        seen.append(pool)
        return await real(fn, budget_s, default, pool=pool)
    monkeypatch.setattr(commands, "_bounded", spy)
    monkeypatch.setattr(symbols, "resolve", lambda t: KNOWN)
    _post(tc, sk, _slash())
    assert seen == [commands._symbol_pool] and commands._symbol_pool is not commands._io_pool


def test_the_kill_switch_skips_the_check(v2, monkeypatch):
    tc, sk, fake, _ = v2
    monkeypatch.setenv("DISCORD_RENDER_V2_SYMBOLS_ENABLED", "0")
    # Record, never raise: the check fails open, so an exception inside it would be swallowed and
    # this test would pass with the switch ignored (mutation S9, first run).
    calls = []
    monkeypatch.setattr(symbols, "resolve", lambda t: calls.append(t) or symbols.Resolution(t, symbols.UNKNOWN))
    assert _post(tc, sk, _slash(value="ZZZQ")).json() == {"type": 5} and len(fake.offered) == 1
    assert calls == [], "the symbol check ran with its kill switch off"


def test_flow_refuses_an_unknown_symbol_too(v2, monkeypatch):
    tc, sk, fake, warmed = v2
    monkeypatch.setattr(symbols, "resolve", lambda t: symbols.Resolution(t, symbols.UNKNOWN))
    r = _post(tc, sk, _slash(name="flow", value="ZZZQ")).json()
    assert r["type"] == 4 and "**ZZZQ**" in r["data"]["content"] and fake.offered == [] and warmed == ["ZZZQ"]


def test_the_v2_flow_handler_passes_the_resolved_partition(monkeypatch):
    from api.routers import discord_interactions as router
    seen = {}
    monkeypatch.setattr(router, "run_flow_card_job", lambda app, tok, tkr, days, **kw: seen.update(tkr=tkr, **kw))
    monkeypatch.setattr(symbols, "flow_source", lambda t: "etfs" if t == "SPY" else "stocks")

    class Ctx:
        def __init__(self, job):
            self.job = job

        def edit(self, *a, **k):
            return True

        def fail(self, *a, **k):
            return True
    for ticker, want in (("SPY", "etfs"), ("NVDA", "stocks")):
        job = commands._job(_slash("flow", ticker), "flow", f"/flow {ticker}")
        commands._handle_flow(Ctx(job))
        assert (seen["tkr"], seen["source"]) == (ticker, want)


# ── R53 (D-16): the PRE-V2 dispatch must choose the partition ──────────────────────────────
#
# ⚰️ MEASURED 2026-09-17, twice in one day. `/flow ticker:SPY days:30` in #render-smoke, at
# 07:10 ET and again at 10:00 ET, both times: "⚠️ The flow feed is reconnecting — couldn't read
# SPY right now. Try again in a moment." The pod log carried the real cause and the member never
# saw it: `[flow] fetch failed SPY (30): timed out`, 30.1 s after the ack.
#
# ⛔ THE TEST ABOVE (`..._reads_the_partition_it_is_given...`) PASSES WITH THAT BUG, because it
# hands `run_flow_card_job` an explicit `source=`. The defect was one layer up, at the DISPATCH,
# which passed none — so the signature default `stocks` applied and SPY, an ETF, was searched
# where `flow_source`'s own docstring measured 0 contracts against 182 under `etfs`.
# ⭐ So these drive the REAL ROUTE and assert on the PARAMS FLOW-WORKER RECEIVES. A rail that
# reads the reply text would pass on a card rendered from the wrong partition.


def _flow_route(monkeypatch):
    from tests.discord_harness import _app_client, _keypair
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)   # the pre-V2 path, on purpose
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.test")
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    return client, sk, rt


def _flow_payload(ticker, days="30", uid="42"):
    from tests.discord_harness import UT_GUILD
    return {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD,
            "member": {"user": {"id": uid}},
            "data": {"name": "flow", "options": [{"name": "ticker", "type": 3, "value": ticker},
                                                 {"name": "days", "type": 3, "value": days}]}}


def _drive(monkeypatch, ticker, *, responder=None):
    """Drive the real route and return (params flow-worker saw, member replies)."""
    from tests.discord_harness import _post
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    client, sk, rt = _flow_route(monkeypatch)
    seen, edits = [], []

    def get(url, params=None, timeout=None):
        seen.append(dict(params or {}))
        if responder is not None:
            return responder(url, params, timeout)
        return httpx.Response(200, json={"ok": True, "contracts": [{"c": 1}], "window": {}},
                              request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(rt, "render_ticker_flow_card", lambda d: b"png", raising=False)
    monkeypatch.setattr(rt.di, "edit_original", lambda *a, **k: edits.append(k) or True)
    monkeypatch.setattr(rt, "_post_image_webhook", lambda *a, **k: (True, "ok"), raising=False)
    _post(client, sk, _flow_payload(ticker))
    return seen, edits


def test_the_pre_v2_dispatch_chooses_the_partition_from_the_symbol(monkeypatch):
    """⛔ THE LOAD-BEARING ONE. An ETF must be read from `etfs`; the dispatch, not the caller,
    decides. Reverting the dispatch to pass no source makes this red and nothing else."""
    from api import massive_processor
    monkeypatch.setattr(massive_processor, "is_index_source", lambda s: s in {"SPY"})
    seen, _ = _drive(monkeypatch, "SPY")
    assert seen, "flow-worker was never called — the dispatch did not reach the fetch"
    assert seen[0]["source"] == "etfs", (
        f"the pre-V2 dispatch searched the {seen[0]['source']!r} partition for an ETF — this is "
        f"the 2026-09-17 SPY timeout, and the member is told the feed is reconnecting")
    assert seen[0]["symbol"] == "SPY"


def test_an_equity_still_reads_the_stocks_partition(monkeypatch):
    """⛔ NON-VACUITY. Without this, pinning every symbol to `etfs` passes the test above."""
    from api import massive_processor
    from api.services import cap_universe
    monkeypatch.setattr(massive_processor, "is_index_source", lambda s: s in {"SPY"})
    monkeypatch.setattr(cap_universe, "etf_symbols", lambda: frozenset({"SMH"}))
    seen, _ = _drive(monkeypatch, "NVDA")
    assert seen and seen[0]["source"] == "stocks", (
        "an equity was moved off the stocks partition — /flow NVDA rendered from etfs today")


def test_an_unknown_symbol_takes_flow_sources_documented_default(monkeypatch):
    """A symbol neither classifier knows resolves per `flow_source`'s documented default —
    `stocks` — rather than raising or guessing."""
    from api import massive_processor
    from api.services import cap_universe
    monkeypatch.setattr(massive_processor, "is_index_source", lambda s: False)
    monkeypatch.setattr(cap_universe, "etf_symbols", lambda: frozenset())
    seen, _ = _drive(monkeypatch, "ZZZQ")
    assert seen and seen[0]["source"] == "stocks"


# ── R53 (D-16): the failure SENTENCE names its cause class ─────────────────────────────────


def _reply_text(edits):
    return " ".join(str(e.get("content") or "") for e in edits)


def test_a_timeout_names_the_timeout_and_never_says_reconnecting(monkeypatch):
    """⛔⛔ THE SENTENCE THE CONTRACT EXISTS TO END. `contract.py` records it verbatim: for two
    weeks /flow answered "The flow feed is reconnecting" to a 30 s timeout, to a flow-worker
    restart, and to every other non-ok read. The class was ALREADY computed and thrown away."""
    def boom(url, params, timeout):
        raise httpx.TimeoutException("timed out")
    _, edits = _drive(monkeypatch, "SPY", responder=boom)
    txt = _reply_text(edits)
    assert txt, "the member got no reply at all"
    assert "reconnecting" not in txt.lower(), f"the catch-all came back: {txt!r}"
    assert "didn't answer in time" in txt, f"a timeout did not name itself: {txt!r}"


def test_an_upstream_error_says_something_DIFFERENT_from_a_timeout(monkeypatch):
    """⛔ NON-VACUITY FOR THE SENTENCE. One new sentence replacing one old sentence is not a
    taxonomy — two causes must read differently, or nothing was gained."""
    def err(url, params, timeout):
        return httpx.Response(503, json={}, request=httpx.Request("GET", url))
    _, edits = _drive(monkeypatch, "SPY", responder=err)
    txt = _reply_text(edits)
    assert "reconnecting" not in txt.lower()
    assert "returned an error" in txt, f"an upstream 503 did not name itself: {txt!r}"
    assert "didn't answer in time" not in txt, "an upstream error was reported as a timeout"


def test_an_EMPTY_read_is_still_the_no_significant_flow_sentence(monkeypatch):
    """⛔ An ok-but-empty read is NOT a failure and must not acquire a failure sentence. This is
    the branch the partition fix actually moves SPY out of."""
    def empty(url, params, timeout):
        return httpx.Response(200, json={"ok": True, "contracts": [], "window": {}},
                              request=httpx.Request("GET", url))
    _, edits = _drive(monkeypatch, "SPY", responder=empty)
    txt = _reply_text(edits)
    assert "no significant options flow" in txt, f"an empty read lost its sentence: {txt!r}"
    assert "reconnecting" not in txt.lower()
