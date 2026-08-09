"""A symbol we do not carry answers "no data", not "we are broken".

⛔ THE STATUS AND THE BODY ARE WHAT IS ASSERTED, because the defect was a status
code, not a code path. `SQ` (Block, after the rename to `XYZ`) answered **503
`transient`** — `bars_fetch`'s no-blank guard classifies "found nothing anywhere"
as transient whenever the `massive` breaker is open, and it has no way to know
the symbol is retired. To a member that reads as an outage; to an error-rate
monitor it *is* one; and the frontend retries a symbol that will never answer.

⚠️ EVERY CASE DRIVES THE REAL HANDLER. A test that asserted `_is_carried("SQ") is
False` would stay green with the downgrade deleted from `get_bars`.
"""
import pytest

from api.routers import bars
from api.services import source_circuit_breaker as scb


def _resp(status, content):
    from fastapi.responses import ORJSONResponse
    r = ORJSONResponse(status_code=status, content=content)
    if status == 503:
        r.headers["Retry-After"] = "5"
    return r


@pytest.fixture(autouse=True)
def carried(monkeypatch):
    """The universe is planted, not read off disk — the fix must be judged on the
    membership question, not on today's `cap_universe.json`."""
    monkeypatch.setattr(bars, "_CARRIED", frozenset({"XYZ", "AAPL"}))
    monkeypatch.setattr(scb, "_attempts", {}, raising=False)
    yield


@pytest.fixture
def nothing_anywhere(monkeypatch):
    """`bars_fetch` found nothing and the breaker is open — the exact 503 the
    audit captured, returned (not raised) by the inner call."""
    monkeypatch.setattr(bars, "_get_bars_inner", lambda t, tf, n: _resp(
        503, {"ticker": t.upper(), "tf": tf, "bars": [], "error": "transient"}))


def _get(ticker, tf="5"):
    return bars.get_bars(ticker, tf=tf, bars=600, since="", to="")


def test_a_symbol_we_DO_NOT_CARRY_answers_200_no_data_not_503(nothing_anywhere):
    r = _get("SQ")
    assert r.status_code == 200, (
        "a retired ticker still reads as a server outage to members and to "
        "every error-rate monitor")
    body = r.body.decode()
    assert '"bars":[]' in body, body
    assert '"no_data":true' in body and "symbol_not_carried" in body, body
    # ⛔ never a fabricated series: the payload carries an EMPTY list, and the
    # honesty marker is what distinguishes it from a quiet live symbol.
    assert "transient" not in body, body
    assert r.headers.get("Retry-After") is None, (
        "a symbol that will never answer must not ask the client to retry")


def test_a_symbol_we_DO_CARRY_keeps_its_transient_503(nothing_anywhere):
    """⭐ THE NARROWNESS IS THE POINT. `XYZ` is the live successor to `SQ`. A
    downgrade that reached it would turn a real provider outage into "this
    ticker has no data" on 3,742 tradable symbols."""
    r = _get("XYZ")
    assert r.status_code == 503, "the transient signal was lost for a live symbol"
    assert r.headers.get("Retry-After") == "5"
    assert "transient" in r.body.decode()


def test_a_CRASH_stays_transient_even_for_a_symbol_we_do_not_carry(monkeypatch):
    """The SQLite inode swap during `force_resync` throws for ~30s and is
    genuinely transient for ANY symbol. Only the "looked everywhere, found
    nothing" 503 may be downgraded."""
    def boom(t, tf, n):
        raise RuntimeError("no such table: ohlcv")
    monkeypatch.setattr(bars, "_get_bars_inner", boom)
    r = _get("SQ")
    assert r.status_code == 503, (
        "a real crash was reported as 'this symbol has no data'")
    assert r.headers.get("Retry-After") == "5"


def test_an_UNREADABLE_universe_abstains_and_leaves_the_503_alone(
        monkeypatch, nothing_anywhere):
    """⚠️ A derived reference needs a sanity bound. An empty universe would make
    EVERY symbol look uncarried and silently convert every transient 503 into
    "no data" — the loudest possible failure, dressed as calm."""
    monkeypatch.setattr(bars, "_CARRIED", frozenset())
    assert _get("SQ").status_code == 503


def test_a_REGISTERED_delisted_entity_is_carried(monkeypatch, nothing_anywhere):
    """Dead names are deliberately kept OUT of `cap_universe` while we DO hold
    their frozen bars, so universe membership alone would misread them."""
    from api.services import bars_fetch, delisted_registry
    monkeypatch.setattr(delisted_registry, "resolve",
                        lambda s: {"ticker": "LEH"} if s.upper() == "LEH" else None)
    # A registered entity is served by the frozen-bars path, so that is the call
    # made to fail here — same "found nothing anywhere" 503, different door.
    monkeypatch.setattr(bars_fetch, "_get_delisted_bars_response",
                        lambda rec, tf, n, serve_as=None: _resp(
                            503, {"ticker": "LEH", "tf": tf, "bars": [],
                                  "error": "transient"}))
    assert _get("LEH").status_code == 503
    assert _get("SQ").status_code == 200


def test_the_membership_answer_comes_from_the_ONE_universe_loader():
    """⛔ Never a second read of `cap_universe.json`. The set is derived from the
    loader that already owns it — `ticker_search._UNIVERSE`, the same list the
    autocomplete offers — so the two can never disagree about what we carry."""
    import ast
    import inspect
    src = inspect.getsource(bars._carried_symbols)
    names = {n.module for n in ast.walk(ast.parse(src.strip()))
             if isinstance(n, ast.ImportFrom)}
    assert names == {"api.routers.ticker_search"}, names
    assert "cap_universe" not in src

    bars._CARRIED = None
    try:
        from api.routers.ticker_search import _UNIVERSE
        assert bars._carried_symbols() == frozenset(_UNIVERSE)
    finally:
        bars._CARRIED = None
