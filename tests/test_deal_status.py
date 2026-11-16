"""The ONE deal-status service (api/services/deal_status.py): each source, expiry, the price-pin
detector, the merge, and its fail-safe direction.

Synthetic headlines and prices except the one TECH test, which reads the real daily bars from the
local bars.db strictly read-only (`immutable=1`: nothing is written, not even the -shm index) and
skips when that file is not on the box.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import date, timedelta

import pytest

from api.services import breadth_server_universe as bsu
from api.services import deal_status as ds
from api.services.screener import screener_universe as su

TODAY = date(2026, 10, 23)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    """Every test starts with an empty cache, no stored news, and a fixed 'today'."""
    monkeypatch.setenv("CATALYST_NEWS_DB_PATH", str(tmp_path / "none_catalyst.db"))
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(tmp_path / "none_company.db"))
    monkeypatch.delenv("DEAL_STATUS_ENABLED", raising=False)
    monkeypatch.delenv("DEAL_STATUS_NEWS_MAX_AGE_DAYS", raising=False)
    monkeypatch.setenv("DEAL_STATUS_WARM_NAMES", "0")  # no SEC fetch from a test
    monkeypatch.setattr(ds, "_today", lambda: TODAY)
    monkeypatch.setattr(ds, "_delisted", lambda sym: False)
    ds.reset_cache()
    yield
    ds.reset_cache()


def _names(monkeypatch, **names):
    """Seed company names the way the news ingest leaves them in memory."""
    from api.services.news import subject
    for sym, name in names.items():
        monkeypatch.setitem(subject._NAME_CACHE, sym, name)


# -- synthetic bars ----------------------------------------------------------------------------

def _ymd(i: int) -> int:
    d = date(2026, 1, 2) + timedelta(days=i)
    return int(d.strftime("%Y%m%d"))


def pinned_bars(pre=40, post=30, pre_px=50.0, gap_px=60.0, wiggle=0.05):
    """`pre` noisy sessions near pre_px, then a gap to gap_px and `post` sessions pinned there."""
    out = []
    for i in range(pre):
        c = pre_px + (1.5 if i % 2 else -1.5)
        out.append({"t": _ymd(i), "o": c, "h": c + 1.2, "l": c - 1.2, "c": c})
    for j in range(post):
        c = gap_px + (wiggle if j % 2 else -wiggle)
        out.append({"t": _ymd(pre + j), "o": c, "h": c + wiggle, "l": c - wiggle, "c": c})
    return out


# -- 1. hand lists -----------------------------------------------------------------------------

def _file_list():
    path = os.path.join(os.path.dirname(su.__file__), "..", "..", "data", ds.HAND_FILENAME)
    with open(path, encoding="utf-8") as fh:
        return frozenset(str(t).upper() for t in json.load(fh) if t)


def test_the_hand_list_is_the_file_exactly():
    assert ds.hand_list() == _file_list()
    assert len(ds.hand_list()) >= 10


def test_flag_off_the_screener_reads_exactly_the_file_as_before():
    assert su.buyout_excludes() == _file_list()


def test_flag_on_with_no_news_the_screener_gains_only_the_mirror(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    got = su.buyout_excludes()
    assert got == _file_list() | (bsu.EXCLUDE - bsu.NOT_DEALS)
    assert "TECH" in got
    assert _file_list() <= got          # the file's non-deal excludes stay excluded


def test_the_files_non_deal_excludes_are_never_called_pending():
    nd = _file_list() & bsu.NOT_DEALS
    assert nd, "control: the file carries at least one non-deal exclude"
    for sym in nd:
        assert ds.deal_status(sym, bars=[])["pending"] is False
    assert not (ds.pending_deal_symbols() & bsu.NOT_DEALS)


def test_not_deals_are_named_inside_exclude_and_the_mirror_reads_the_rest():
    assert bsu.NOT_DEALS <= bsu.EXCLUDE
    assert ds.mirror_list() == bsu.EXCLUDE - bsu.NOT_DEALS
    assert "TECH" in ds.mirror_list()


def test_a_hand_listed_name_is_pending_at_full_confidence():
    st = ds.deal_status("OGN", bars=[])
    assert st["pending"] is True and st["confidence"] == ds.CONF_HAND
    assert "hand_list" in st["source"]


# -- 2. news parsing ---------------------------------------------------------------------------

def test_tech_like_target_side_headline_is_definitive_with_its_price():
    t = "Bio-Techne (NASDAQ: TECH) agreed to be acquired by Merck KGaA for $72.50 per share in cash"
    assert ds.parse_headline(t, ["TECH"]) == [("TECH", "definitive", 72.5)]


def test_to_be_acquired_names_only_the_target(monkeypatch):
    _names(monkeypatch, AAA="Alpha Widgets Inc", BBB="Bravo Holdings Corp")
    t = "Alpha Widgets to be acquired by Bravo Holdings for $41.25 a share"
    assert ds.parse_headline(t, ["AAA", "BBB"]) == [("AAA", "definitive", 41.25)]


def test_acquirer_side_headline_names_the_target_after_the_verb(monkeypatch):
    _names(monkeypatch, AAA="Alpha Widgets Inc", BBB="Bravo Holdings Corp")
    t = "Bravo Holdings agrees to acquire Alpha Widgets for $41.25 per share in cash"
    assert ds.parse_headline(t, ["BBB", "AAA"]) == [("AAA", "definitive", 41.25)]


def test_tender_offer_headline_is_definitive():
    t = "Charlie Bio commences tender offer for all outstanding shares of Delta Thera (DLTX) at $77.00 per share"
    assert ds.parse_headline(t, ["DLTX"]) == [("DLTX", "definitive", 77.0)]


def test_acquirer_side_without_a_definitive_word_is_not_a_deal(monkeypatch):
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    got = ds.parse_headline("Bravo to buy Alpha Widgets in takeover push", ["AAA"])
    assert all(kind != "definitive" for _, kind, _ in got)
    # a confirm on its own starts nothing
    assert ds.fold_news([(TODAY, "Bravo to buy Alpha Widgets in takeover push", ["AAA"])]) == {}


@pytest.mark.parametrize("title", [
    "Alpha Widgets explores sale, sources say",
    "Bravo in talks to acquire Alpha Widgets",
    "Bravo makes unsolicited bid for Alpha Widgets at $40 per share",
    "Alpha Widgets reportedly to be acquired by Bravo",
    "Could Alpha Widgets be acquired?",
])
def test_rumours_talks_and_bids_are_live_trades_not_pending(monkeypatch, title):
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    assert ds.parse_headline(title, ["AAA"]) == []


def test_a_deal_value_is_not_a_per_share_price():
    assert ds.parse_price("Merck KGaA to buy Bio-Techne in $11.3 billion deal") is None
    assert ds.parse_price("for $1,234.50 per share") == 1234.5


@pytest.mark.parametrize("title", [
    "Bravo completes acquisition of Alpha Widgets",
    "Alpha Widgets merger agreement terminated",
    "Alpha Widgets to be delisted following merger",
])
def test_completion_termination_and_delisting_end_a_deal(monkeypatch, title):
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    assert ds.parse_headline(title, ["AAA"]) == [("AAA", "end", None)]


def test_expected_to_close_is_not_an_end(monkeypatch):
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    got = ds.parse_headline("Alpha Widgets deal expected to close in Q4", ["AAA"])
    assert got and all(kind != "end" for _, kind, _ in got)


# -- 2b. folding and expiry --------------------------------------------------------------------

DEF = "Alpha Widgets (AAA) agreed to be acquired by Bravo for $41.25 per share"


def test_a_completion_headline_ends_the_deal():
    deals = ds.fold_news([(date(2026, 6, 1), DEF, ["AAA"]),
                          (date(2026, 9, 1), "Bravo completes acquisition of Alpha Widgets (AAA)", ["AAA"])])
    assert deals["AAA"]["active"] is False and deals["AAA"]["ended"] == date(2026, 9, 1)


def test_an_end_headline_older_than_the_deal_does_not_end_it():
    deals = ds.fold_news([(date(2026, 5, 1), "Alpha Widgets (AAA) merger terminated", ["AAA"]),
                          (date(2026, 6, 1), DEF, ["AAA"])])
    assert deals["AAA"]["active"] is True and deals["AAA"]["price"] == 41.25


def _news(monkeypatch, headlines):
    monkeypatch.setattr(ds, "stored_headlines", lambda since: list(headlines))
    ds.reset_cache()


def test_fresh_news_is_pending_and_carries_since_and_price(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=10), DEF, ["AAA"])])
    st = ds.deal_status("AAA", bars=[])
    assert st["pending"] and st["source"] == ["news"] and st["confidence"] == ds.CONF_NEWS
    assert st["since"] == (TODAY - timedelta(days=10)).isoformat() and st["price"] == 41.25


def test_news_older_than_the_limit_expires_without_confirmation(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=200), DEF, ["AAA"])])
    st = ds.deal_status("AAA", bars=[])
    assert st["pending"] is False and st["source"] == [] and st["price"] is None


def test_a_later_confirming_headline_keeps_old_news_alive(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=200), DEF, ["AAA"]),
                        (TODAY - timedelta(days=20), "Alpha Widgets (AAA) shareholders approve merger", ["AAA"])])
    assert ds.deal_status("AAA", bars=[])["pending"] is True


def test_a_price_pin_near_the_deal_price_keeps_old_news_alive(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=200), DEF, ["AAA"])])
    st = ds.deal_status("AAA", bars=pinned_bars(gap_px=41.0))
    assert st["pending"] is True and st["confidence"] == ds.CONF_NEWS_STALE_PRICE
    assert st["source"] == ["news", "price_pinned"]


def test_a_price_pin_far_from_the_deal_price_does_not(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=200), DEF, ["AAA"])])
    assert ds.deal_status("AAA", bars=pinned_bars(gap_px=60.0))["pending"] is False


def test_fresh_news_plus_a_pin_is_the_highest_news_confidence(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=10), DEF, ["AAA"])])
    st = ds.deal_status("AAA", bars=pinned_bars(gap_px=41.0))
    assert st["confidence"] == ds.CONF_NEWS_PRICE and st["source"] == ["news", "price_pinned"]


STRIDE = "Chime Inks $590 Million Deal to Buy Longtime Bank Partner Stride"


def _overrides(monkeypatch, tmp_path, payload):
    p = tmp_path / "deal_not_pending.json"
    p.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(ds, "_not_pending_path", lambda: str(p))
    ds.reset_cache()


def test_a_same_named_private_target_reads_as_the_listed_company_from_the_headline_alone(monkeypatch, tmp_path):
    """The control: with no ruling the headline DOES make LRN pending (it names only "Stride"),
    which is why an owner ruling is the fix and not a parser change."""
    _names(monkeypatch, LRN="Stride, Inc.")
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _overrides(monkeypatch, tmp_path, {})
    _news(monkeypatch, [(TODAY - timedelta(days=10), STRIDE, ["LRN"])])
    assert ds.deal_status("LRN", bars=[])["pending"] is True
    assert "LRN" in ds.screener_excludes()


def test_an_owner_ruling_keeps_a_wrongly_tagged_name_out_of_the_pending_set(monkeypatch, tmp_path):
    _names(monkeypatch, LRN="Stride, Inc.")
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _overrides(monkeypatch, tmp_path, {"lrn": "Stride Bank, not Stride, Inc."})
    _news(monkeypatch, [(TODAY - timedelta(days=10), STRIDE, ["LRN"]),
                        (TODAY - timedelta(days=10), DEF, ["AAA"])])
    st = ds.deal_status("LRN", bars=[])
    assert st["pending"] is False and st["source"] == [] and "completed" not in st
    assert st["since"] is None and st["price"] is None
    assert "LRN" not in ds.screener_excludes() and "LRN" not in ds.consumer_pending()
    # the ruling names one symbol: every other news deal is untouched
    assert ds.deal_status("AAA", bars=[])["pending"] is True
    assert "AAA" in ds.screener_excludes() and "AAA" in ds.consumer_pending()


def test_an_owner_ruling_never_makes_a_ruled_name_a_completed_deal(monkeypatch, tmp_path):
    _names(monkeypatch, LRN="Stride, Inc.")
    _overrides(monkeypatch, tmp_path, {"LRN": "x"})
    _news(monkeypatch, [(TODAY - timedelta(days=10), STRIDE, ["LRN"])])
    monkeypatch.setattr(ds, "_delisted", lambda sym: True)
    assert "completed" not in ds.deal_status("LRN", bars=[])


def test_a_hand_listed_name_stays_pending_whatever_the_ruling_file_says(monkeypatch, tmp_path):
    _overrides(monkeypatch, tmp_path, {"OGN": "x"})
    assert ds.deal_status("OGN", bars=[])["pending"] is True


def test_a_price_pin_on_a_ruled_name_is_still_only_possible(monkeypatch, tmp_path):
    _overrides(monkeypatch, tmp_path, {"AAA": "x"})
    _news(monkeypatch, [(TODAY - timedelta(days=10), DEF, ["AAA"])])
    st = ds.deal_status("AAA", bars=pinned_bars(gap_px=41.0))
    assert st["pending"] is False and st.get("possible") is True


@pytest.mark.parametrize("payload", ["{not json", '["LRN"]'])
def test_a_broken_ruling_file_rules_nothing_and_is_logged(monkeypatch, tmp_path, caplog, payload):
    _overrides(monkeypatch, tmp_path, payload)
    with caplog.at_level("WARNING"):
        assert ds.news_overrides() == frozenset()
    assert "not-pending overrides" in caplog.text


def test_a_real_all_stock_deal_the_owner_ruled_in_stays_in_scans(monkeypatch, tmp_path):
    """LITE: the deal is real and the headline is right; the owner keeps it because it is not pinned."""
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _names(monkeypatch, LITE="Lumentum Holdings Inc.", MRVL="Marvell Technology, Inc.")
    t = "Marvell and Lumentum enter into a definitive agreement for Marvell to acquire Lumentum in an all-stock transaction"
    t2 = "Lumentum (NASDAQ: LITE) agreed to be acquired by Marvell in all-stock deal"
    _overrides(monkeypatch, tmp_path, {})
    _news(monkeypatch, [(TODAY - timedelta(days=10), t, ["MRVL", "LITE"]),
                        (TODAY - timedelta(days=10), t2, ["LITE", "MRVL"])])
    assert "LITE" in ds.screener_excludes(), "control: without the ruling the deal hides it"
    _overrides(monkeypatch, tmp_path, {"LITE": "all stock, not pinned"})
    assert "LITE" not in ds.screener_excludes()
    assert ds.deal_status("LITE", bars=[])["pending"] is False


BY_NAME = "Alpha Widgets to be acquired by Bravo Holdings for $41.25 a share"


def _restart(monkeypatch):
    """What a restart does to the name sources: memory is empty, the disk is not."""
    from api.services.news import subject
    monkeypatch.delitem(subject._NAME_CACHE, "AAA", raising=False)
    ds.reset_cache()


def test_a_target_written_by_name_stays_pending_across_a_restart(monkeypatch):
    """LXFR 2026-11-15: a fresh pod had no company names in memory and dropped the deal."""
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    _news(monkeypatch, [(TODAY - timedelta(days=10), BY_NAME, ["AAA"])])
    assert "AAA" in ds.pending_deal_symbols()          # the build before the restart
    assert os.path.exists(ds._names_path())
    _restart(monkeypatch)
    assert ds._known_name("AAA") == "Alpha Widgets Inc"
    assert "AAA" in ds.pending_deal_symbols() and "AAA" in ds.screener_excludes()
    assert ds.names_cold() is False


def test_without_the_saved_names_a_restart_does_drop_it(monkeypatch):
    """The control: the saved file is what holds the deal, nothing else."""
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    _news(monkeypatch, [(TODAY - timedelta(days=10), BY_NAME, ["AAA"])])
    assert "AAA" in ds.pending_deal_symbols()
    os.remove(ds._names_path())
    _restart(monkeypatch)
    assert "AAA" not in ds.pending_deal_symbols()
    assert ds.names_cold() is True


def test_a_cold_build_never_forgets_a_saved_name(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    _names(monkeypatch, AAA="Alpha Widgets Inc", BBB="Bravo Holdings Corp")
    other = "Bravo Holdings to be acquired by Charlie for $9.00 a share"
    _news(monkeypatch, [(TODAY - timedelta(days=10), BY_NAME, ["AAA"]),
                        (TODAY - timedelta(days=9), other, ["BBB"])])
    ds.pending_deal_symbols()
    _restart(monkeypatch)                                  # AAA cold, BBB still in memory
    ds.pending_deal_symbols()
    with open(ds._names_path(), encoding="utf-8") as fh:
        assert json.load(fh) == {"AAA": "Alpha Widgets Inc", "BBB": "Bravo Holdings Corp"}


def test_names_are_not_saved_with_the_flag_off_and_a_damaged_file_is_not_used(monkeypatch, caplog):
    _names(monkeypatch, AAA="Alpha Widgets Inc")
    _news(monkeypatch, [(TODAY - timedelta(days=10), BY_NAME, ["AAA"])])
    assert ds.deal_status("AAA", bars=[])["pending"] is True
    assert not os.path.exists(ds._names_path())
    with open(ds._names_path(), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    _restart(monkeypatch)
    with caplog.at_level("WARNING"):
        assert ds.deal_status("AAA", bars=[])["pending"] is False
    assert "saved names unreadable" in caplog.text


def test_the_shipped_ruling_file_names_lrn_with_a_reason():
    path = os.path.join(os.path.dirname(ds.__file__), "..", "data", ds.NOT_PENDING_FILENAME)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    assert {"LRN", "LITE"} <= set(data) and all(isinstance(v, str) and len(v) > 20 for v in data.values())
    assert not (set(data) & ds.hand_list()), "a name cannot be both hand-listed and ruled out"


def test_a_delisted_symbol_is_no_longer_pending_on_news(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=10), DEF, ["AAA"])])
    monkeypatch.setattr(ds, "_delisted", lambda sym: sym == "AAA")
    assert ds.deal_status("AAA", bars=[])["pending"] is False


# -- 2c. the stored news, read-only ------------------------------------------------------------

def _catalyst_db(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE news_items (key TEXT PRIMARY KEY, title TEXT, summary TEXT, url TEXT, "
              "source TEXT, time_published TEXT, tickers_json TEXT, first_seen_at INTEGER NOT NULL)")
    for i, (title, tp, tickers) in enumerate(rows):
        c.execute("INSERT INTO news_items VALUES (?,?,?,?,?,?,?,?)",
                  (f"k{i}", title, "", "", "", tp, json.dumps(tickers), 1_790_000_000))
    c.commit()
    c.close()


def _company_db(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE news_items (id INTEGER PRIMARY KEY, headline TEXT, published_at TEXT, "
              "reject_reason TEXT NOT NULL DEFAULT '')")
    c.execute("CREATE TABLE news_tickers (news_id INTEGER, ticker TEXT)")
    for i, (title, pub, tickers, rej) in enumerate(rows, start=1):
        c.execute("INSERT INTO news_items VALUES (?,?,?,?)", (i, title, pub, rej))
        for t in tickers:
            c.execute("INSERT INTO news_tickers VALUES (?,?)", (i, t))
    c.commit()
    c.close()


def _sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def test_both_stores_are_read_and_neither_is_written(monkeypatch, tmp_path):
    cat, comp = tmp_path / "catalyst_news.db", tmp_path / "company_news.db"
    _catalyst_db(cat, [(DEF, "2026-10-20T12:00:00+00:00", ["AAA"]),
                       ("Fed holds rates steady", "2026-10-20T12:00:00+00:00", [])])
    _company_db(comp, [("Echo Corp (ECHO) to be acquired by Foxtrot for $12.00 per share",
                        "2026-08-01T13:00:00+00:00", ["ECHO", "FOXT"], ""),
                       ("Golf Inc (GOLF) to be acquired for $9 per share", "2026-08-01T13:00:00+00:00",
                        ["GOLF"], "junk")])
    before = (_sha(cat), _sha(comp))
    monkeypatch.setenv("CATALYST_NEWS_DB_PATH", str(cat))
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(comp))
    got = ds.stored_headlines(TODAY - timedelta(days=400))
    titles = [t for _, t, _ in got]
    assert DEF in titles and any("Echo Corp" in t for t in titles)
    assert not any("Fed holds" in t for t in titles)          # not deal-worded
    assert not any("Golf Inc" in t for t in titles)           # a rejected row stays out
    assert (_sha(cat), _sha(comp)) == before
    ds.reset_cache()
    assert ds.deal_status("ECHO", bars=[])["price"] == 12.0


def test_a_missing_store_reads_nothing_and_creates_nothing(tmp_path, monkeypatch):
    p = tmp_path / "absent.db"
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(p))
    assert ds.stored_headlines(TODAY - timedelta(days=30)) == []
    assert not p.exists()


# -- 3. price behaviour ------------------------------------------------------------------------

def test_a_gap_then_a_tight_pin_is_detected():
    pin = ds.price_pinned(pinned_bars())
    assert pin is not None and pin["gap_pct"] > 8 and pin["sessions_since_gap"] == 30
    assert pin["range_pct"] < 2 and pin["atr_pct"] < 0.5 and pin["near_deal_price"] is None


def test_near_deal_price_is_judged_against_a_parsed_price():
    assert ds.price_pinned(pinned_bars(), deal_price=61.0)["near_deal_price"] is True
    assert ds.price_pinned(pinned_bars(), deal_price=90.0)["near_deal_price"] is False


def test_fewer_than_the_pin_sessions_after_the_gap_is_not_a_pin():
    assert ds.price_pinned(pinned_bars(post=ds.PIN_SESSIONS - 1)) is None


def test_a_wide_trailing_range_is_not_a_pin():
    assert ds.price_pinned(pinned_bars(wiggle=0.8)) is None


def test_no_gap_is_not_a_pin():
    assert ds.price_pinned(pinned_bars(gap_px=50.5)) is None


def test_a_filled_gap_is_not_a_pin():
    bars = pinned_bars()
    bars[45] = {**bars[45], "l": 49.0}
    assert ds.price_pinned(bars) is None


def test_a_post_gap_drift_wider_than_the_limit_is_not_a_pin():
    bars = pinned_bars()
    bars[45] = {**bars[45], "l": 60.0 / (1 + ds.POST_GAP_RANGE_MAX) - 0.5}   # still far above the fill
    assert ds.price_pinned(bars) is None
    bars[45] = {**bars[45], "l": 60.0 / (1 + ds.POST_GAP_RANGE_MAX) + 0.5}
    assert ds.price_pinned(bars) is not None


def test_the_drift_limit_sits_below_the_gap_so_a_fill_cannot_pass():
    assert ds.POST_GAP_RANGE_MAX < ds.GAP_MIN


def test_price_behaviour_alone_is_possible_never_pending():
    st = ds.deal_status("ZZZQ", bars=pinned_bars())
    assert st["pending"] is False and st["possible"] is True
    assert st["confidence"] == ds.CONF_PRICE_ONLY < ds.PENDING_MIN_CONFIDENCE
    assert st["source"] == ["price_pinned"]


def _tech_bars():
    path = "C:/data/bars.db"
    if not os.path.exists(path):
        pytest.skip("no local bars.db")
    c = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        rows = c.execute("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker='TECH' "
                         "AND tf='D' AND ts <= 20261022 ORDER BY ts DESC LIMIT 300) ORDER BY ts").fetchall()
    finally:
        c.close()
    if len(rows) < 120:
        pytest.skip("TECH bars not on this box")
    return rows


def test_techs_real_bars_read_as_deal_pinned_from_the_june_gap():
    pin = ds.price_pinned(_tech_bars())
    assert pin is not None and pin["gap_date"] == "2026-06-25" and pin["gap_pct"] > 15
    assert pin["range_pct"] < 2 and pin["atr_pct"] < 0.5


# -- merged answer, cache, fail safe -----------------------------------------------------------

def test_pending_symbols_hold_hand_mirror_and_fresh_news_but_not_price_only(monkeypatch):
    _news(monkeypatch, [(TODAY - timedelta(days=5), DEF, ["AAA"])])
    monkeypatch.setattr(ds, "_bars_for", lambda sym: pinned_bars())
    got = ds.pending_deal_symbols()
    assert {"AAA", "TECH", "OGN"} <= got and "SMX" not in got and "ZZZQ" not in got


def test_an_error_is_not_pending_and_is_logged(monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("store exploded")
    monkeypatch.setattr(ds, "_compute", boom)
    st = ds.deal_status("OGN", bars=[])
    assert st["pending"] is False and st["source"] == []
    assert any("treating as not pending" in r.getMessage() for r in caplog.records)


def test_the_chart_marker_is_none_while_the_flag_is_off():
    assert ds.deal_status("OGN", bars=[])["pending"] is True
    assert ds.chart_marker("OGN") is None


def test_the_chart_marker_carries_the_label_when_on(monkeypatch):
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_bars_for", lambda sym: [])
    m = ds.chart_marker("TECH")
    assert m["pending"] is True and m["label"] == ds.CHART_LABEL
    assert "pc_exclude_mirror" in m["source"]
    assert ds.chart_marker("ZZZQ") is None


def test_the_answer_is_cached_for_the_day(monkeypatch):
    calls = []
    monkeypatch.setattr(ds, "_bars_for", lambda sym: calls.append(sym) or [])
    ds.deal_status("AAPL")
    ds.deal_status("AAPL")
    assert calls == ["AAPL"]
