"""⭐⭐ THE PRODUCER FOR THE JS CLOCK SEAM — `/api/bars` emits the tri-state.

⚰️ THE SEAM EXISTED AT BOTH ENDS AND NOTHING CROSSED IT. `interpret.js` has read
`opts.newestBarIsForming` since the barstate ruling landed, and `computeClock` has
been a tri-state just as long — but no caller in `app/src` ever set it, so the four
CLOCK_REALTIME columns rendered BLANK in the browser. Not wrong: blank, by the
fail-closed contract. `_augment_with_bar_close_state` is the missing half.

⛔⛔ `None` MUST SERIALISE AS `null`, NEVER AS `false`. `false` means "the newest bar
is settled" and yields a confident `isconfirmed = 1`. "Nobody told me" arriving as
"settled" is the single wrong answer these columns exist to prevent, and it is
invisible downstream because it looks exactly like a correctly-closed bar.

⚠️ THE WIRE FORMAT AND THE CLOCK'S CONTRACT DISAGREE, WHICH IS THE WHOLE REASON THE
ADAPTER EXISTS. `bar_close_state` reads `bars[-1]["t"]` in UNIX SECONDS. Intraday
bars carry that; daily/weekly/monthly are serialised `"YYYY-MM-DD"` for Lightweight
Charts (`bars_fetch`). Both forms are pinned below, because a producer that silently
answered `null` on every daily chart would look exactly like a producer that was
working and merely cautious.
"""
from __future__ import annotations

import datetime
import zoneinfo

import orjson
from fastapi.responses import ORJSONResponse

from api.routers.bars import _augment_with_bar_close_state

ET = zoneinfo.ZoneInfo("America/New_York")


def _resp(bars, status=200):
    return ORJSONResponse(content={"ticker": "SPY", "tf": "D", "bars": bars},
                          status_code=status)


def _state(bars, tf):
    out = _augment_with_bar_close_state(_resp(bars), tf)
    return orjson.loads(out.body)


# ── the two wire formats ─────────────────────────────────────────────────────

def test_a_DAILY_bar_answers_even_though_its_t_is_an_ISO_STRING():
    """⛔ THE CASE A NAIVE PRODUCER GETS WRONG AND NEVER NOTICES. `bar_close_state`
    requires unix seconds; the daily wire format is `"YYYY-MM-DD"`. Without the
    adapter this returns `None` on EVERY daily chart — which is a legal answer, so
    nothing downstream complains and the columns stay blank forever."""
    today = datetime.datetime.now(ET).date()
    got = _state([{"t": today.isoformat(), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "D")
    assert "newest_bar_is_forming" in got, "the producer emitted no field at all"
    assert got["newest_bar_is_forming"] is not None, (
        "a daily bar dated today answered None — the ISO-date adapter is not "
        "converting, so every daily chart in the browser stays blank")


def test_an_INTRADAY_bar_answers_from_its_numeric_t():
    """Intraday already satisfies the clock's contract, so this is the control that
    the adapter did not BREAK the form that always worked."""
    now = datetime.datetime.now(ET)
    got = _state([{"t": now.timestamp(), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "5")
    assert got["newest_bar_is_forming"] is not None


# ── null is an answer, and it is not false ───────────────────────────────────

def test_NO_BARS_answers_null_and_NEVER_false():
    got = _state([], "D")
    assert got.get("newest_bar_is_forming") is None, (
        "an empty series produced a CONFIDENT answer; `false` here would blank "
        "nothing and instead assert the newest bar is settled")


def test_AN_UNKNOWN_TIMEFRAME_answers_null_and_NEVER_false():
    got = _state([{"t": datetime.datetime.now(ET).timestamp()}], "4h")
    assert got.get("newest_bar_is_forming") is None


def test_A_MALFORMED_DATE_answers_null_rather_than_raising():
    """A chart serve must never fail because a decorative field could not be
    computed. The field is simply absent or null; the bars still arrive."""
    got = _state([{"t": "not-a-date"}], "D")
    assert got.get("newest_bar_is_forming") is None
    assert got["bars"] == [{"t": "not-a-date"}], "the bars were disturbed"


# ── the discriminator: it must be able to say BOTH things ────────────────────

def test_THE_PRODUCER_DISCRIMINATES__a_settled_past_day_is_not_forming():
    """⛔⛔ WITHOUT THIS THE SUITE PASSES FOR A PRODUCER THAT ALWAYS SAYS `True`.
    A long-closed session must come back `False`, and today's must not — two
    different answers from one function is the only evidence it reads anything."""
    old = datetime.date(2025, 12, 1)          # an ordinary Monday, long settled
    settled = _state([{"t": old.isoformat()}], "D")["newest_bar_is_forming"]
    assert settled is False, (
        f"a session settled since 2025-12-01 answered {settled!r} — the producer "
        "is not reading the clock")


# ── additive: nothing else moves ─────────────────────────────────────────────

def test_THE_CHANGE_IS_ADDITIVE__bars_and_every_other_key_survive():
    """⛔ THE PRODUCER MAY ADD A FIELD AND NOTHING ELSE. A chart client parses this
    payload; reordering or dropping a key is a member-visible break dressed as a
    feature."""
    rows = [{"t": "2025-12-01", "o": 1, "h": 2, "l": 0, "c": 1, "v": 9}]
    before = orjson.loads(_resp(rows).body)
    after = _state(rows, "D")
    assert after["bars"] == before["bars"], "the bars changed"
    assert after["ticker"] == before["ticker"] and after["tf"] == before["tf"]
    assert set(after) - set(before) == {"newest_bar_is_forming"}, (
        f"the producer changed the key set by more than one field: "
        f"{set(after) ^ set(before)}")


def test_A_NON_200_IS_LEFT_ALONE_by_the_caller_and_the_helper_is_harmless():
    """The call site gates on status 200. Even called directly on an error body the
    helper must not invent a state for bars that were never served."""
    got = orjson.loads(_augment_with_bar_close_state(_resp([], status=503), "D").body)
    assert got.get("newest_bar_is_forming") is None
