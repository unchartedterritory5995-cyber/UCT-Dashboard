"""Build api/services/uct_agent/marketdata/eval/freshness.json, the MD-1 freshness regression corpus (agent-md).

Every envelope is built with envelope.make_envelope, so it conforms to MD-1 by construction, and quotes the
adapters' own note constants, so the corpus cannot drift from the code. fetched_at is pinned so the output
is deterministic. tests/test_uct_agent_data_freshness_corpus.py regenerates it and fails on any byte
difference.

    python -m api.services.uct_agent.marketdata.eval.build_freshness
"""
import json
import pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env                    # noqa: E402
from api.services.uct_agent.marketdata import (breadth as br, earnings as ern,    # noqa: E402
                                              news_company as nc, quotes as q, ratings as rt,
                                              statements as stm, themes as th)

ET = ZoneInfo("America/New_York")
FETCHED = "2026-11-02T16:55:00Z"          # Mon 2026-11-02 11:55 ET — the fixed "now" of every question


def renderings(as_of):
    """Ways an answer may state as_of: ISO date, 'Nov 2', 'November 2', and the ET clock time for intraday."""
    if as_of is None:
        return []
    d = datetime.fromisoformat(as_of.replace("Z", "+00:00")).astimezone(ET)
    out = [d.date().isoformat(), f"{d:%b} {d.day}", f"{d:%B} {d.day}"]
    if not (d.hour == 16 and d.minute == 0) and not (d.hour == 0 and d.minute == 0):
        out.append(f"{d.hour % 12 or 12}:{d.minute:02d}")
    return out


def E(kind, **kw):
    e = env.make_envelope(kind, kw.pop("params", {}), **kw)
    e["fetched_at"] = FETCHED
    assert env.validate_envelope(e) == [], (kind, env.validate_envelope(e))
    return e


def U(kind, note, params=None):
    e = env.unavailable(kind, params or {}, "fixture", note)
    e["fetched_at"] = FETCHED
    return e


Q = []


def add(id_, question, envelope, *, category, disclose=(), purpose="answer", refused=False, flags=None):
    st, fr = envelope["status"], envelope["freshness"]
    expect = {
        "freshness_class": fr,
        # an answer must state the data's time when it has one (any listed rendering counts)
        "as_of_renderings": renderings(envelope["as_of"]),
        # live/now wording is allowed ONLY for a live read that is not stale
        "may_claim_live": fr == "live" and not envelope["stale"],
        "must_disclose_stale": bool(envelope["stale"]) and st in ("ok", "partial"),
        "must_say_unavailable": st in ("unavailable", "refused"),
        # a no-data answer must not invent a figure
        "must_not_state_a_value": st in ("unavailable", "refused"),
        # further facts the answer must carry, as phrases from the envelope's own notes/data
        "must_disclose": list(disclose),
        "as_of_null_reason_required": envelope["as_of"] is None and st in ("ok", "partial"),
    }
    # `flags`: the gateway flags (beyond UCT_AGENT_DATA) under which this question is asked. Model-isolated
    # kinds are DORMANT unless UCT_AGENT_ISOLATED=1 (ADR-005), so their questions say which state they test.
    Q.append({"id": id_, "category": category, "kind": envelope["kind"], "purpose": purpose,
              "question": question, "envelope": envelope, "expect": expect, "expect_refusal": refused,
              "flags": dict(flags or {})})


# ── quotes ────────────────────────────────────────────────────────────────────────────────────────────
row = lambda s, last, src="trade", t="2026-11-02T16:54:58Z": {  # noqa: E731
    "symbol": s, "last": last, "last_source": src, "change": 1.2, "change_pct": 0.65, "open": 185.0,
    "high": 188.0, "low": 184.1, "day_close": last, "volume": 41_000_000, "prev_close": 185.9, "as_of": t}
add("q-live", "What is AAPL trading at right now?",
    E("quote", status="ok", freshness="live", as_of="2026-11-02T16:54:58Z", source="massive",
      data={"quote": row("AAPL", 187.12), "session": "regular"}, provider_calls=1),
    category="live")
add("q-live-stale", "What's NVDA's price now?",
    E("quote", status="ok", freshness="live", as_of="2026-11-02T16:51:40Z", source="massive", stale=True,
      data={"quote": row("NVDA", 141.3, t="2026-11-02T16:51:40Z"), "session": "regular"}, provider_calls=1),
    category="live-stale")
add("q-closed", "What is TSLA at right now?",
    E("quote", status="ok", freshness="historical", as_of="2026-10-31T00:59:12Z", source="massive",
      data={"quote": row("TSLA", 251.0, t="2026-10-31T00:59:12Z"), "session": "closed"},
      notes=[q.NOTE_CLOSED], provider_calls=1),
    category="closed", disclose=["not live"])
add("q-extended", "Where is SHOP trading premarket?",
    E("quote", status="ok", freshness="live", as_of="2026-11-02T13:01:00Z", source="massive",
      data={"quote": row("SHOP", 101.2, t="2026-11-02T13:01:00Z"), "session": "extended"},
      notes=[q.NOTE_EXTENDED], provider_calls=1),
    category="extended", disclose=["extended-hours"])
add("q-partial-close-row", "Give me current prices for AAPL and HALT.",
    E("quotes", status="partial", freshness="live", as_of="2026-11-02T16:54:58Z", source="massive",
      data={"quotes": [row("AAPL", 187.12), row("HALT", 9.1, src="day_close", t="2026-11-02T14:00:00Z")],
            "session": "regular"},
      notes=["no current trade for HALT — showing day_close", q.NOTE_SET_AS_OF_LIVE], provider_calls=1,
      coverage={"evaluated": 2, "answered": 2, "dropped": 0, "not_computable": 0}),
    category="partial", disclose=["HALT"])
add("q-unavailable", "What's ZZZZ at now?", U("quote", "the quote provider returned no price for ZZZZ"),
    category="unavailable")


# ── quotes, one fixture CLOCK per session state (MD-1 v1.5 §4.5) ──────────────────────────────────────
# These envelopes are not hand-built: the REAL `quote` adapter runs at a frozen clock against a fake snapshot, so
# session_detail, freshness, stale, notes and as_of are exactly what the code produces at that instant. The only
# inputs are the clock, whether that ET day trades (weekend/holiday = no), and the vendor's own print time.
def _quote_at(clock_et: str, trading: bool, sym: str, last: float, printed_et: str) -> dict:
    """Run quotes.read_quote at `clock_et` ("YYYY-MM-DD HH:MM", ET) with one print at `printed_et`."""
    from types import SimpleNamespace
    from api.services import massive
    now = datetime.strptime(clock_et, "%Y-%m-%d %H:%M").replace(tzinfo=ET)
    printed = datetime.strptime(printed_et, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ET).timestamp()
    tick = {"lastTrade": {"p": last}, "min": {"c": last}, "day": {"o": last - 1, "h": last + 1, "l": last - 2,
            "c": last, "v": 1_200_000}, "prevDay": {"c": round(last - 1.25, 2)}, "todaysChange": 1.25,
            "todaysChangePerc": round(1.25 / (last - 1.25) * 100, 2), "_observed_at": printed}

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: D102 — the adapter's only wall-clock read
            return now if tz is None else now.astimezone(tz)

    class _Client:
        def get_batch_quotes(self, symbols):  # noqa: D102
            return SimpleNamespace(value={s: tick for s in symbols if s == sym}, degraded=None)

    saved = (q.datetime, q.time, massive._today_et_is_a_trading_day, massive._get_client)
    try:
        q.datetime = _Clock
        q.time = SimpleNamespace(time=lambda: now.timestamp())
        massive._today_et_is_a_trading_day = lambda: trading
        massive._get_client = lambda: _Client()
        e = q.read_quote({"symbol": sym}, {})
    finally:
        q.datetime, q.time, massive._today_et_is_a_trading_day, massive._get_client = saved
    e["fetched_at"] = env.utc_iso(now)
    assert env.validate_envelope(e) == [], env.validate_envelope(e)
    return e


SESSION_CLOCKS = [
    # id, question, clock (ET), trades that day?, symbol, last, vendor print time (ET), category, disclose
    ("qs-regular", "What's AMZN trading at right now?", "2026-11-02 11:55", True, "AMZN", 228.4,
     "2026-11-02 11:54:58", "session-regular", ()),
    ("qs-premarket", "What's NVDA trading at premarket?", "2026-11-02 07:45", True, "NVDA", 142.1,
     "2026-11-02 07:44:30", "session-premarket", ("extended-hours",)),
    ("qs-premarket-quiet", "Where is CRWD premarket right now?", "2026-11-02 06:10", True, "CRWD", 377.0,
     "2026-11-02 05:40:00", "session-premarket-quiet", ("not live",)),
    ("qs-after-hours", "What is META at after hours now?", "2026-11-02 16:30", True, "META", 611.2,
     "2026-11-02 16:29:00", "session-after-hours", ("extended-hours",)),
    ("qs-overnight", "What's TSLA trading at right now?", "2026-11-02 22:30", True, "TSLA", 251.0,
     "2026-11-02 19:59:40", "session-overnight", ("not live",)),
    ("qs-weekend", "What is AAPL at right now?", "2026-10-31 12:00", False, "AAPL", 187.1,
     "2026-10-30 19:58:10", "session-weekend", ("not live",)),
    ("qs-holiday", "What's MSFT trading at today?", "2026-11-26 11:00", False, "MSFT", 512.3,
     "2026-11-25 19:59:00", "session-holiday", ("not live",)),
    ("qs-early-close-regular", "What's GOOGL at right now?", "2026-11-27 12:50", True, "GOOGL", 198.7,
     "2026-11-27 12:49:59", "session-early-close-regular", ()),
    ("qs-early-close-after", "Where is AMD trading now? (half day)", "2026-11-27 13:30", True, "AMD", 160.5,
     "2026-11-27 13:29:15", "session-early-close-after", ("extended-hours",)),
]
for id_, question, clock, trading, sym, last, printed, category, disclose in SESSION_CLOCKS:
    add(id_, question, _quote_at(clock, trading, sym, last, printed), category=category, disclose=disclose)
    Q[-1]["clock"] = {"et": clock, "trading_day": trading}

# ── bars.daily ────────────────────────────────────────────────────────────────────────────────────────
bars = {"symbol": "AAPL", "bars": [{"date": "2026-10-30", "open": 1, "high": 2, "low": 0.5, "close": 1.5,
                                    "volume": 10}], "through": "2026-10-30", "latest_completed_session": "2026-10-30"}
add("b-today", "How did AAPL close today?",
    E("bars.daily", status="ok", freshness="historical", as_of="2026-10-30T20:00:00Z", source="uct-bars",
      data=bars, notes=["completed sessions only — the current session's developing bar is never included"]),
    category="historical", disclose=["completed"])
add("b-stale", "What was MSFT's last daily close?",
    E("bars.daily", status="ok", freshness="historical", as_of="2026-10-28T20:00:00Z", source="uct-bars",
      stale=True, data={**bars, "through": "2026-10-28"},
      notes=["the newest bar held is 2026-10-28; the newest completed session is 2026-10-30"]),
    category="historical-stale")

# ── fundamentals / earnings / news ────────────────────────────────────────────────────────────────────
add("f-current", "What's AAPL's revenue now?",
    E("fundamentals", status="ok", freshness="periodic", as_of="2026-09-27T00:00:00Z", source="yahoo-finance",
      data={"symbol": "AAPL", "period": "quarterly", "statements": {}}, notes=[stm.NOTE_PERIODIC, stm.NOTE_NO_FILING_DATE]),
    category="periodic", disclose=["period"])
add("f-stale", "What is XYZ's current debt?",
    E("fundamentals", status="ok", freshness="periodic", as_of="2026-03-31T00:00:00Z", source="yahoo-finance",
      stale=True, data={"symbol": "XYZ", "period": "quarterly", "statements": {}},
      notes=[stm.NOTE_PERIODIC, "the newest quarterly statement is for the period ending 2026-03-31 (216 days ago)"]),
    category="periodic-stale")
add("e-latest", "Did AAPL beat earnings this quarter?",
    E("earnings", status="ok", freshness="periodic", as_of=None, source="uct-earnings",
      data={"symbol": "AAPL", "reported": [], "reported_through": "2026 Q3", "quarters_behind": 0,
            "next_report": {"report_date": "2027-01-29", "quarter": "2026 Q4", "kind": "scheduled"}},
      notes=[ern.NOTE_NO_DATE.format(label="2026 Q3"), ern.NOTE_EVENT]),
    category="as_of-null", disclose=["2026 Q3"])
add("e-next", "When is AAPL's next earnings report?",
    E("earnings", status="ok", freshness="periodic", as_of=None, source="uct-earnings",
      data={"symbol": "AAPL", "reported": [], "reported_through": "2026 Q3", "quarters_behind": 0,
            "next_report": {"report_date": "2027-01-29", "quarter": "2026 Q4", "kind": "scheduled"}},
      notes=[ern.NOTE_NO_DATE.format(label="2026 Q3"), ern.NOTE_EVENT]),
    category="scheduled-event", disclose=["2027-01-29", "scheduled"])
add("n-latest", "What's the latest news on NVDA?",
    E("news.company", status="ok", freshness="periodic", as_of="2026-11-02T15:40:00Z", source="uct-news",
      data={"symbol": "NVDA", "items": [{"headline": "h", "as_of": "2026-11-02T15:40:00Z"}], "has_more": False},
      notes=[nc.NOTE_PUBLISHED]),
    category="periodic", disclose=["published"])
add("n-quiet", "Any news on QUIET today?",
    E("news.company", status="ok", freshness="periodic", as_of=None, source="uct-news",
      data={"symbol": "QUIET", "items": [], "has_more": False}, notes=[nc.NOTE_NO_ITEMS.format(sym="QUIET")]),
    category="empty-not-stale", disclose=["no news"])
add("n-stale-ingest", "What's new on AMD right now?",
    E("news.company", status="ok", freshness="periodic", as_of="2026-11-02T13:10:00Z", source="uct-news",
      stale=True, data={"symbol": "AMD", "items": [{"headline": "h", "as_of": "2026-11-02T13:10:00Z"}]},
      notes=[nc.NOTE_INGEST_STALE, nc.NOTE_PUBLISHED]),
    category="periodic-stale", disclose=["missing"])

# ── themes ────────────────────────────────────────────────────────────────────────────────────────────
add("t-moving", "Which themes are leading right now?",
    E("themes", status="ok", freshness="periodic", as_of=None, source="uct-themes",
      data={"period": "1d", "order": "leaders", "themes": [{"name": "Semis", "return_pct": 2.4}],
            "live_applied_at": "2026-11-02T16:50:00Z"},
      notes=[th.NOTE_EQUAL_WEIGHT, th.NOTE_LIVE_APPLIED.format(at="2026-11-02T16:50:00Z")],
      coverage={"evaluated": 1, "answered": 1, "dropped": 0, "not_computable": 0}),
    category="as_of-null", disclose=["applied", "not a live feed"])
add("t-closed", "What were the best themes this week?",
    E("themes", status="ok", freshness="periodic", as_of="2026-10-30T20:00:00Z", source="uct-themes",
      data={"period": "1w", "order": "leaders", "themes": [{"name": "Semis", "return_pct": 5.1}], "live_applied_at": None},
      notes=[th.NOTE_EQUAL_WEIGHT, th.NOTE_CLOSED],
      coverage={"evaluated": 1, "answered": 1, "dropped": 0, "not_computable": 0}),
    category="periodic", disclose=["last completed session"])
add("t-warming", "What themes are hot now?", U("themes", th.NOTE_WARMING), category="unavailable")

# ── breadth / ratings (model-isolated: answer only) ───────────────────────────────────────────────────
bdata = lambda **k: {"universe": "us", "metric": "pct_above_50sma", "value": 61.4, "status": "intraday",  # noqa: E731
                     "session": "2026-11-02", "label": "Intraday · 11:52 AM ET", "accuracy_tier": "validated",
                     "current": True, "finalized_session": "2026-10-29", "market_open": True,
                     "population_drift": 0.01, **k}
add("br-intraday", "What percent of stocks are above their 50-day right now?",
    E("breadth.current", status="ok", freshness="periodic", as_of="2026-11-02T16:52:03Z", source="uct-breadth",
      data=bdata(), notes=["Intraday · 11:52 AM ET"]),
    category="periodic", disclose=["Intraday"])
add("br-not-current", "What's market breadth today?",
    E("breadth.current", status="ok", freshness="historical", as_of="2026-10-29T20:00:00Z", source="uct-breadth",
      stale=True, data=bdata(status="finalized", current=False, label="Finalized close · Oct 29"),
      notes=["Finalized close · Oct 29", br.NOTE_NOT_CURRENT.format(label="Finalized close · Oct 29")]),
    category="historical-stale", disclose=["Finalized close"])
add("br-nhnl", "How many new 52-week highs are there today?",
    E("breadth.current", status="ok", freshness="historical", as_of="2026-10-29T20:00:00Z", source="uct-breadth",
      stale=True, data=bdata(metric="new_52w_highs", value=212, status="finalized", current=False,
                             accuracy_tier="finalized_only", label="Finalized close · Oct 29"),
      notes=["Finalized close · Oct 29", br.NOTE_NOT_CURRENT.format(label="Finalized close · Oct 29"),
             br.NOTE_FINALIZED_ONLY]),
    category="historical-stale", disclose=["Finalized close"])
add("rt-current", "What's AAPL's UCT rating now?",
    E("ratings", status="ok", freshness="periodic", as_of="2026-10-30T20:00:00Z", source="uct-ratings",
      data={"symbol": "AAPL", "composite": 82, "price_as_of": "2026-10-30", "complete": True},
      notes=[rt.NOTE_UCT_DERIVED, rt.NOTE_UNDATED_LEGS], provider_calls=3),
    category="periodic", disclose=["UCT"])
add("rt-partial", "What's JAZZ's composite rating?",
    E("ratings", status="partial", freshness="periodic", as_of="2026-10-30T20:00:00Z", source="uct-ratings",
      data={"symbol": "JAZZ", "composite": 70, "price_as_of": "2026-10-30", "complete": False},
      notes=[rt.NOTE_UCT_DERIVED, rt.NOTE_UNDATED_LEGS, rt.NOTE_INCOMPLETE], provider_calls=3),
    category="partial", disclose=["could not be read"])
r = env.refused("breadth.current", {"metric": "pct_above_50sma"},
                "this data is shown to the member only and is never used for research")
r["fetched_at"] = FETCHED
add("br-research-refused", "(research) Use current breadth to plan a scan.", r, category="isolation",
    purpose="research", refused=True, flags={"UCT_AGENT_ISOLATED": "1"})
d = env.refused("breadth.current", {"metric": "pct_above_50sma"}, "this data is not available to UCT Agent yet")
d["fetched_at"] = FETCHED
add("br-dormant-refused", "What percent of stocks are above their 50-day right now?", d, category="isolation-dormant",
    refused=True)


def _corpus() -> dict:
    return {"version": "1.1", "contract": "MD-1.5", "now": FETCHED,
            "live_words": ["live", "real-time", "real time", "right now", "currently trading", "this second"],
            "stale_words": ["stale", "not current", "older", "out of date", "behind", "missing", "may be outdated"],
            "unavailable_words": ["unavailable", "not available", "couldn't", "could not", "no data", "warming"],
            "questions": Q}


def build() -> str:
    """The corpus JSON text (deterministic)."""
    return json.dumps(_corpus(), indent=2, ensure_ascii=False) + "\n"


PATH = pathlib.Path(__file__).resolve().parent / "freshness.json"

if __name__ == "__main__":
    PATH.write_text(build(), encoding="utf-8", newline="\n")
    print(len(Q), "questions ->", PATH)
