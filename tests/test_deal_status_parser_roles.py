"""deal_status's news parser names ONLY the TARGET of a definitive agreement or tender offer.

WHY (2026-10-23). With DEAL_STATUS_ENABLED=1 the production pending set held AMZN, PG, QCOM,
UBER, BHP, STE, MGA, NRC and an untradeable tag MET1: companies that were BUYING something, or
whose stake, unit or supply deal was in the headline, or that were merely tagged on a headline
about a private company. They were then excluded from UCT20 leadership, the Top-5 pool, scans and
grades, and labelled "Pending acquisition". The parser's causes, each fixed and railed here:

  1. SOLE-TAG FALLBACK. "<private co> to be acquired by Amazon", tagged [AMZN] by the store,
     made AMZN the target: a single tagged symbol was accepted without being named.
  2. ANY MENTION BEFORE THE VERB. "Procter & Gamble's beauty brand to be acquired" and
     "Uber-backed X to be acquired" named the parent / backer as the target.
  3. STAKES, UNITS, ASSETS. "Amazon to buy a $4 billion stake in Qualcomm" made QCOM pending.
  4. LAW-FIRM ITEMS. "investigates whether the sale ... is fair" carry deal words and tickers.
  5. CONFIRM BY TAG. Any deal-worded headline tagging an active symbol kept it alive, so a busy
     acquirer's own deal news refreshed a false deal forever.
  6. NO DROP-OUT. A completed buyout (ATKR 2026-10-19, TBPH 2026-09-23) stayed pending until a
     completion headline was stored; the stock stopped printing and nothing noticed.

The headlines below are reconstructions of each pattern (public company names, invented private
counterparties), not copies of stored items.
"""
from datetime import date, timedelta

import pytest

from api.services import deal_status as ds

TODAY = date(2026, 10, 23)
_REAL_STALE_REF = ds._stale_ref

NAMES = {
    "AMZN": "Amazon.com, Inc.", "PG": "Procter & Gamble Co", "QCOM": "Qualcomm Inc",
    "UBER": "Uber Technologies, Inc", "BHP": "BHP Group Ltd", "STE": "STERIS plc",
    "MGA": "Magna International Inc", "NRC": "NRC Health, Inc.", "AAPL": "Apple Inc.",
    "MSFT": "Microsoft Corp", "PTC": "PTC Inc.", "CCC": "CCC Intelligent Solutions Holdings Inc.",
    "PAG": "Penske Automotive Group, Inc.", "MG": "MISTRAS GROUP, INC.",
    "SANG": "Sangoma Technologies Corp", "SSTI": "SoundThinking, Inc.",
    "LXFR": "Luxfer Holdings PLC", "SLN": "Silence Therapeutics plc", "ATKR": "Atkore Inc.",
    "TBPH": "Theravance Biopharma, Inc.", "AAA": "Alpha Widgets Inc", "BBB": "Bravo Holdings Corp",
    "CBS": "Cobalt Business Systems Inc",
}

#: (headline, tagged tickers, pattern) — the acquirer / non-target must NOT become pending.
FALSE_POSITIVES = [
    ("Wondery to be acquired by Amazon for $300 million in cash", ["AMZN"], "sole tag, acquirer"),
    ("Arduino to be acquired by Qualcomm", ["QCOM"], "sole tag, acquirer"),
    ("Xodus Medical to be acquired by Steris for $2.1 billion in cash", ["STE"], "sole tag, acquirer"),
    ("Copper project to be acquired by BHP in $2 billion deal", ["BHP"], "sole tag, acquirer"),
    ("Trendyol Go to be acquired by Uber for $700 million in cash", ["UBER"], "sole tag, acquirer"),
    ("Alpha Diagnostics to be acquired by NRC Health for $5.00 per share", ["NRC"], "sole tag, acquirer"),
    ("Alpha Insurance to be acquired by Bravo for $5.00 per share", ["MET1"], "sole tag, untradeable"),
    ("Procter & Gamble's beauty brand to be acquired by Bravo for $2 billion", ["PG"], "parent's unit"),
    ("Magna's seating unit to be acquired by Bravo for $1.5 billion in cash", ["MGA"], "parent's unit"),
    ("Uber-backed Getir agrees to be acquired by Bravo for $10.00 per share", ["UBER"], "backer"),
    ("Amazon agrees to buy $4 billion stake in Qualcomm in chip deal", ["AMZN", "QCOM"], "stake"),
    ("Apple agrees to acquire minority stake in Alpha Widgets for $5.00 per share", ["AAPL", "AAA"], "stake"),
    ("BHP agrees to acquire the copper assets of Alpha Widgets for $1 billion in cash", ["BHP", "AAA"], "assets"),
    ("Microsoft agrees to acquire Alpha Widgets from Uber for $8.00 per share", ["MSFT", "UBER"], "seller"),
    ("Halper Sadeh LLC investigates whether Bravo Holdings (BBB) agreed to be acquired at a fair "
     "price", ["BBB"], "law firm"),
    ("SHAREHOLDER ALERT: law firm investigates Alpha Widgets (AAA), which agreed to be acquired "
     "by Bravo for $10.00 per share", ["AAA", "BBB"], "law firm"),
    ("Are SSTI, MG, CBNK, MGLD Obtaining Fair Deals for their Shareholders?", ["SSTI", "MG"], "law firm"),
    ("Halper Sadeh LLC Investigates Bravo Holdings (BBB) Agreement to be Acquired by Alpha "
     "Widgets for $5.00 per share", ["BBB"], "law firm"),
    ("Amazon explores sale of Alpha Widgets unit, sources say", ["AMZN", "AAA"], "explores sale"),
    ("Bravo in talks to acquire Alpha Widgets for $9.00 per share", ["AAA", "BBB"], "in talks"),
    ("Qualcomm plans to acquire Alpha Widgets for $12.00 per share", ["QCOM", "AAA"], "intent"),
]

#: (headline, tagged tickers, the ONE target that must be pending).
REAL_TARGETS = [
    ("Atkore Inc. to be Acquired by Prysmian for $95.00 per Share in Cash", ["ATKR"], "ATKR"),
    ("Theravance Biopharma Enters into Definitive Agreement to be Acquired by Zymeworks for "
     "$17.00 per share in cash", ["TBPH", "ZYME"], "TBPH"),
    ("PTC to be acquired by Schneider Electric for $205 per share", ["PTC"], "PTC"),
    ("CCC Intelligent Solutions Signs Definitive Agreement to Be Acquired by GTCR and Elliott",
     ["CCC"], "CCC"),
    ("Penske Automotive Group enters into definitive agreement to be taken private by Penske "
     "Corporation and Mitsui for $212 per share", ["PAG"], "PAG"),
    ("H.I.G. Capital to Acquire MISTRAS Group in $866 Million Deal", ["MG"], "MG"),
    ("Sangoma Technologies Corporation Enters into Definitive Agreement to be Acquired by BRC "
     "Group Holdings", ["SANG", "RCG"], "SANG"),
    ("SoundThinking enters into definitive agreement to be acquired by Transom Capital for $8.00 "
     "per share", ["SSTI"], "SSTI"),
    ("Luxfer Enters Into Agreement to Be Acquired for $17.37 Per Share in All-Cash Transaction",
     ["LXFR"], "LXFR"),
    ("Silence Therapeutics announces definitive agreement to be acquired by Merck KGaA",
     ["SLN"], "SLN"),
    ("Uber rival Alpha Widgets (AAA) to be acquired by Bravo for $10.00 per share",
     ["UBER", "AAA"], "AAA"),
    ("Bravo Holdings agrees to acquire Alpha Widgets for $41.25 per share in cash",
     ["BBB", "AAA"], "AAA"),
    ("Bravo commences tender offer for all outstanding shares of Alpha Widgets (AAA) at $77.00 "
     "per share", ["BBB", "AAA"], "AAA"),
]

MEGA_CAPS = frozenset({"AMZN", "PG", "QCOM", "UBER", "BHP", "STE", "MGA", "AAPL", "MSFT", "NRC",
                       "MET1"})


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_NEWS_DB_PATH", str(tmp_path / "none_catalyst.db"))
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(tmp_path / "none_company.db"))
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    monkeypatch.delenv("DEAL_STATUS_NEWS_MAX_AGE_DAYS", raising=False)
    monkeypatch.setenv("DEAL_STATUS_WARM_NAMES", "0")  # no SEC fetch from a test
    monkeypatch.setattr(ds, "_today", lambda: TODAY)
    monkeypatch.setattr(ds, "_delisted", lambda sym: False)
    monkeypatch.setattr(ds, "_stale_ref", lambda: None)
    from api.services.news import subject
    for sym, name in NAMES.items():
        monkeypatch.setitem(subject._NAME_CACHE, sym, name)
    ds.reset_cache()
    yield
    ds.reset_cache()


def _definitive(title, tickers):
    return {s for s, kind, _p in ds.parse_headline(title, tickers) if kind == "definitive"}


@pytest.mark.parametrize("title,tickers,pattern", FALSE_POSITIVES,
                         ids=[f"{p}:{t[:40]}" for t, _k, p in FALSE_POSITIVES])
def test_a_non_target_is_never_definitive(title, tickers, pattern):
    got = _definitive(title, tickers)
    # The only symbol a false-positive fixture may still name is a genuine target it carries
    # (AAA in the stake/talks lines is NOT acquired either), so: nothing at all.
    assert got == set(), f"{pattern}: {got} read as a pending target from {title!r}"


@pytest.mark.parametrize("title,tickers,target", REAL_TARGETS,
                         ids=[t[:50] for t, _k, _x in REAL_TARGETS])
def test_a_real_target_is_definitive_and_alone(title, tickers, target):
    assert _definitive(title, tickers) == {target}


def test_the_fixtures_can_distinguish():
    """Control: the false-positive list really does carry every name the incident reported as
    an acquirer, so the guard below is not passing over symbols it never sees."""
    tagged = {s for _t, ks, _p in FALSE_POSITIVES for s in ks}
    assert {"AMZN", "PG", "QCOM", "UBER", "BHP", "STE", "MGA", "NRC", "MET1"} <= tagged


def test_guard_no_mega_cap_acquirer_lands_in_the_pending_set(monkeypatch):
    """Every fixture headline, folded together as the news store would hand them over: the
    pending set holds the real targets and not one acquirer, parent, backer or stake-holder."""
    rows = [(TODAY - timedelta(days=5), t, ks) for t, ks, _p in FALSE_POSITIVES]
    rows += [(TODAY - timedelta(days=5), t, ks) for t, ks, _x in REAL_TARGETS]
    monkeypatch.setattr(ds, "stored_headlines", lambda since: list(rows))
    pending = ds.pending_deal_symbols()
    assert not (pending & MEGA_CAPS), sorted(pending & MEGA_CAPS)
    assert {x for _t, _k, x in REAL_TARGETS} <= pending        # non-vacuity: the set is real


def test_a_confirm_needs_the_symbol_named_not_just_tagged():
    deals = ds.fold_news([
        (TODAY - timedelta(days=200), "Alpha Widgets (AAA) agreed to be acquired by Bravo for "
                                      "$41.25 per share", ["AAA"]),
        (TODAY - timedelta(days=10), "Merger arbitrage spreads widen across the deal tape",
         ["AAA"]),
    ])
    assert deals["AAA"]["last_confirm"] == TODAY - timedelta(days=200)


def test_the_acquirers_own_deal_news_never_confirms_it():
    got = ds.parse_headline("Amazon to acquire Wondery, deal expected to close in Q4", ["AMZN"])
    assert all(s != "AMZN" for s, _k, _p in got)


# -- drop-out: a deal never outlives the stock it is about ---------------------------------------

def _bars_ending(last: date, n: int = 40) -> list:
    return [{"t": int((last - timedelta(days=n - 1 - i)).strftime("%Y%m%d")),
             "o": 95.0, "h": 95.1, "l": 94.9, "c": 95.0} for i in range(n)]


DEF = "Atkore Inc. to be Acquired by Prysmian for $95.00 per Share in Cash"


def test_a_completed_buyout_drops_out_when_the_stock_stops_printing(monkeypatch):
    monkeypatch.setattr(ds, "stored_headlines",
                        lambda since: [(TODAY - timedelta(days=60), DEF, ["ATKR"])])
    monkeypatch.setattr(ds, "_stale_ref", lambda: 20261020)     # 3rd most recent session
    st = ds.deal_status("ATKR", bars=_bars_ending(date(2026, 10, 16)))
    assert st["pending"] is False and st["source"] == [] and st["price"] is None


def test_a_still_trading_target_stays_pending(monkeypatch):
    monkeypatch.setattr(ds, "stored_headlines",
                        lambda since: [(TODAY - timedelta(days=60), DEF, ["ATKR"])])
    monkeypatch.setattr(ds, "_stale_ref", lambda: 20261020)
    st = ds.deal_status("ATKR", bars=_bars_ending(date(2026, 10, 22)))
    assert st["pending"] is True and "news" in st["source"]


def test_no_calendar_or_no_bars_is_not_read_as_stopped(monkeypatch):
    monkeypatch.setattr(ds, "stored_headlines",
                        lambda since: [(TODAY - timedelta(days=60), DEF, ["ATKR"])])
    assert ds.deal_status("ATKR", bars=_bars_ending(date(2026, 1, 2)))["pending"] is True
    monkeypatch.setattr(ds, "_stale_ref", lambda: 20261020)
    ds.reset_cache()
    assert ds.deal_status("ATKR", bars=[])["pending"] is True


def test_the_stale_ref_is_read_from_the_market_calendar(monkeypatch):
    from api.services import bars_sqlite
    seen = {}

    def fake(n, before):
        seen["n"], seen["before"] = n, before
        return 20261020
    monkeypatch.setattr(bars_sqlite, "nth_recent_trading_date", fake)
    assert _REAL_STALE_REF() == 20261020 and seen == {"n": 3, "before": 99991231}


def test_a_bare_symbol_counts_only_in_capitals(monkeypatch):
    """A case-folded match made the word "sang" name SANG (and "Uber" name UBER when no company
    name was in memory). A ticker written as prose is not a mention of the ticker."""
    from api.services.news import subject
    monkeypatch.delitem(subject._NAME_CACHE, "SANG")
    title = "Karaoke chain where everyone sang to be acquired by Bravo for $2.00 per share"
    assert _definitive(title, ["SANG"]) == set()
    assert _definitive("SANG to be acquired by Bravo for $2.00 per share", ["SANG"]) == {"SANG"}


def test_a_company_whose_own_name_holds_a_carve_out_word_is_still_a_target():
    """The carve-out guards against a UNIT being sold, not against a company called "...
    Business Systems": its own name is blanked before the carve-out is read."""
    title = "Cobalt Business Systems (CBS) to be acquired by Bravo for $12.00 per share"
    assert _definitive(title, ["CBS"]) == {"CBS"}
    assert _definitive("Cobalt's payments business to be acquired by Bravo for $1 billion in cash",
                       ["CBS"]) == set()


# -- review round: modifiers, descriptors, press-release forms ----------------------------------

MORE_NAMES = {"TSLA": "Tesla, Inc.", "NVDA": "NVIDIA CORP", "SMAR": "Smartsheet Inc",
              "HEP": "Holly Energy Partners LP", "AB": "AllianceBernstein Holding L.P."}

MODIFIER_NEGATIVES = [
    ("Tesla battery supplier Alpha to be acquired by Bravo for $5.00 per share", ["TSLA"]),
    ("Apple chip supplier Alpha agrees to be acquired by Bravo for $5.00 per share", ["AAPL"]),
    ("Bravo to acquire Nvidia chip supplier Alpha for $5.00 per share", ["NVDA"]),
    ("Amazon competitor Alpha to be acquired by Bravo for $5.00 per share", ["AMZN"]),
    ("Amazon-founded Alpha to be acquired by Bravo for $5.00 per share", ["AMZN"]),
    ("Former Amazon executives' startup to be acquired by Bravo for $50 million in cash", ["AMZN"]),
    ("In deal with Amazon, Wondery to be acquired for $300 million in cash", ["AMZN"]),
]

PRESS_RELEASE_POSITIVES = [
    ("Business software maker Smartsheet to be taken private by Blackstone for $56.50 per share",
     ["SMAR"], "SMAR"),
    ("Asset manager Alpha Widgets to be acquired by Bravo for $5.00 per share", ["AAA"], "AAA"),
    ("Sneaker brand Alpha Widgets agrees to be acquired by Bravo for $5.00 per share", ["AAA"], "AAA"),
    ("Bravo to acquire all outstanding units of Holly Energy Partners for $20.00 per unit in cash",
     ["HEP"], "HEP"),
    ("Alpha Widgets says it agreed to be acquired by Bravo for $5.00 per share", ["AAA"], "AAA"),
    ("Alpha Widgets Confirms Agreement to be Acquired by Bravo for $5.00 per share", ["AAA"], "AAA"),
    ("Alpha Widgets Reports Q3 Results and Agreement to be Acquired by Bravo", ["AAA"], "AAA"),
    ("Alpha Widgets - a leader in sensors - to be acquired by Bravo for $5.00 per share",
     ["AAA"], "AAA"),
    ("AllianceBernstein (NYSE: AB, TSX: AB) to be acquired by Bravo for $40.00 per share",
     ["AB"], "AB"),
    ("Alpha Widgets to be acquired by Bravo for $5.00 per share following strategic review",
     ["AAA"], "AAA"),
    ("Alpha Widgets Agrees to be Acquired by Bravo, Concluding Strategic Alternatives Review",
     ["AAA"], "AAA"),
    ("Bravo agrees to acquire Alpha Widgets for $5.00 per share as it eyes AI growth",
     ["BBB", "AAA"], "AAA"),
]


@pytest.fixture
def _more_names(monkeypatch):
    from api.services.news import subject
    for sym, name in MORE_NAMES.items():
        monkeypatch.setitem(subject._NAME_CACHE, sym, name)


@pytest.mark.parametrize("title,tickers", MODIFIER_NEGATIVES, ids=[t[:45] for t, _k in MODIFIER_NEGATIVES])
def test_a_company_that_only_modifies_the_subject_is_not_the_target(_more_names, title, tickers):
    assert _definitive(title, tickers) == set()


@pytest.mark.parametrize("title,tickers,target", PRESS_RELEASE_POSITIVES,
                         ids=[t[:45] for t, _k, _x in PRESS_RELEASE_POSITIVES])
def test_common_announcement_forms_still_name_the_target(_more_names, title, tickers, target):
    assert _definitive(title, tickers) == {target}


# -- a cold name cache must not empty the pending set for hours ---------------------------------

def test_a_cold_name_cache_rebuilds_the_snapshot_soon_and_warms_names(monkeypatch):
    """After a restart the names a target is written by may not be in memory yet. That snapshot
    is marked cold, a name warm is started off-thread, and it is rebuilt after
    DEAL_STATUS_COLD_REFRESH_S instead of DEAL_STATUS_REFRESH_S."""
    from api.services.news import subject
    monkeypatch.delitem(subject._NAME_CACHE, "ATKR")
    monkeypatch.setattr(ds, "_known_name", lambda s: subject._NAME_CACHE.get(s, ""))
    warmed = []
    monkeypatch.setattr(ds, "_warm_names_async", lambda: warmed.append(1))
    monkeypatch.setattr(ds, "stored_headlines",
                        lambda since: [(TODAY - timedelta(days=5), DEF, ["ATKR"])])
    clock = [1_000_000.0]
    monkeypatch.setattr(ds.time, "time", lambda: clock[0])
    assert "ATKR" not in ds.pending_deal_symbols()          # cold: not recognisable yet
    assert warmed and ds._STATE["cold"] is True
    subject._NAME_CACHE["ATKR"] = NAMES["ATKR"]              # the warm landed
    clock[0] += ds._cold_refresh_s() + 1
    assert "ATKR" in ds.pending_deal_symbols()
    assert ds._STATE["cold"] is False
    clock[0] += ds._cold_refresh_s() + 1                     # warm snapshot: full TTL again
    built = ds._STATE["built"]
    ds.pending_deal_symbols()
    assert ds._STATE["built"] == built


def test_a_comma_appositive_is_skipped_but_a_lone_comma_lead_in_is_not(_more_names):
    assert _definitive("Alpha Widgets, a leader in sensors, to be acquired by Bravo for $5.00 per "
                       "share", ["AAA"]) == {"AAA"}
    assert _definitive("In deal with Amazon, Wondery to be acquired for $300 million in cash",
                       ["AMZN"]) == set()
