"""`engine.candidate_rows` is the ONE reader that knows the candidate envelope.

⛔ THE DEFECT CLASS THIS CLOSES. `get_candidates()` answers with an ENVELOPE —
`{generated_at, market_date, counts, candidates: {pullback_ma: [{ticker: ...}]}}`
— and four readers each re-derived that shape by hand. Three were wrong, and
every one of them failed to an EMPTY LIST rather than an exception:

    ai_search._ctx_candidates   read the top level  ⇒ "" on every call
    bars_prewarm      L446      read the top level  ⇒ warmed 0 tickers
    bars_seeder       L123      read the top level  ⇒ seeded 0 tickers, and
                                asked for `gappers` (never a bucket; it is
                                `gapper_news`) — two wrong keys on one line
    voice_market_tools          the one that was right

⛔⛔ AN EMPTY CANDIDATE LIST IS THE SAME OBSERVATION AS A QUIET MARKET. That is
why three separate bugs survived: there is no tape on which the wrong answer
looks wrong. So the rail cannot be "does it return rows on a good payload" —
that passes against a reader shaped to agree with its own fixture. It has to be
"does it return rows FROM THE SHAPE THE PRODUCER WRITES", and the fixture below
is built from `scanner_candidates.run_scanner`'s output envelope, not from what
any reader expects.
"""
import pytest

from api.services import engine


def _envelope(pullback=(), remount=(), gappers=()):
    """The real payload: buckets NESTED under `candidates`, rows keyed `ticker`."""
    return {
        "generated_at": "2026-08-28 06:40:51 CT",
        "market_date": "2026-08-28",
        "candidates": {
            "pullback_ma": [{"ticker": t, "candle_score": 70} for t in pullback],
            "gapper_news": [{"ticker": t} for t in gappers],
            "remount": [{"ticker": t} for t in remount],
        },
        "counts": {"total": len(pullback) + len(remount) + len(gappers)},
    }


@pytest.fixture
def payload(monkeypatch):
    def _set(p):
        monkeypatch.setattr(engine, "get_candidates", lambda: p)
    return _set


def test_every_bucket_is_read(payload):
    payload(_envelope(pullback=["ANGX", "BCRX"], remount=["CCXI"], gappers=["GME"]))
    assert engine.candidate_tickers() == ["ANGX", "BCRX", "GME", "CCXI"]


def test_the_gapper_bucket_is_named_gapper_news(payload):
    """`bars_seeder` asked for `gappers` and got nothing, forever. Pin the name."""
    payload(_envelope(gappers=["GME"]))
    assert "GME" in engine.candidate_tickers()
    assert engine.candidate_rows("gappers") == [], "there is no `gappers` bucket"


def test_a_bucket_added_later_is_included_without_touching_this_code(payload):
    """The bucket names are READ OFF the payload, never typed — so a fourth
    setup in `scanner_candidates.py` arrives here on the day it ships."""
    env = _envelope(pullback=["ANGX"])
    env["candidates"]["some_new_setup_2027"] = [{"ticker": "NEW"}]
    payload(env)
    assert "NEW" in engine.candidate_tickers()


def test_a_named_subset_returns_only_that_bucket(payload):
    payload(_envelope(pullback=["ANGX"], remount=["CCXI"]))
    assert engine.candidate_tickers("remount") == ["CCXI"]


def test_symbols_are_deduplicated_and_upper_cased(payload):
    env = _envelope(pullback=["angx"])
    env["candidates"]["remount"] = [{"ticker": "ANGX"}]
    payload(env)
    assert engine.candidate_tickers() == ["ANGX"]


def test_the_legacy_sym_key_is_honoured(payload):
    env = _envelope()
    env["candidates"]["pullback_ma"] = [{"sym": "OLD"}]
    payload(env)
    assert engine.candidate_tickers() == ["OLD"]


@pytest.mark.parametrize("bad", [
    {},                                   # nothing pushed yet
    {"candidates": None},                 # key present, no payload
    {"candidates": []},                   # wrong type
    {"pullback_ma": [{"ticker": "X"}]},   # THE BUG: buckets at the top level
])
def test_a_shape_that_is_not_the_envelope_yields_nothing(payload, bad):
    payload(bad)
    assert engine.candidate_tickers() == []


def test_rows_carry_the_analysis_fields_not_just_symbols(payload):
    """Callers that want more than a ticker (scores, alert_state) get the row."""
    payload(_envelope(pullback=["ANGX"]))
    rows = engine.candidate_rows()
    assert rows and rows[0]["candle_score"] == 70


# ── the two warmers must go through the accessor ────────────────────────────

def test_bars_prewarm_and_bars_seeder_do_not_re_derive_the_shape():
    """⛔ A GREP, DELIBERATELY. The defect was never a wrong VALUE — it was a
    reader knowing the shape at all. Pinning the behaviour of each warmer would
    let a third one reintroduce the same line; pinning that neither names the
    bucket keys is what actually closes the class."""
    import inspect
    from api.services import bars_prewarm, bars_seeder

    for mod in (bars_prewarm, bars_seeder):
        src = inspect.getsource(mod)
        body = "\n".join(
            line for line in src.splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "candidate_tickers" in body, f"{mod.__name__} must use the accessor"
        for typed in ('cands.get("pullback_ma")', 'cands.get("gappers")',
                      'cands.get("remount")', 'cands.get("gapper_news")'):
            assert typed not in body, (
                f"{mod.__name__} re-derives the candidate envelope ({typed}) — "
                "use engine.candidate_tickers() instead"
            )
