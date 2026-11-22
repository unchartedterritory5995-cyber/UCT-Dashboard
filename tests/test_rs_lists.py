"""Rails for the RS Leaders and RS Emerging lists (UCT RS Phase 4, unit 4-01).

Engineering map docs/superpowers/plans/2026-11-08-uct-rs-phase3-4-engineering-map.md:
§2 unit 4-01, decisions D9-D11, §4 (the `RS_LISTS_ENABLED` flag). Everything runs on a
`screener.db` and an `auth.db` in `tmp_path`: synthetic screener rows, the real
`rs_history.store_rows` for the session's ratings, and injected ETF / theme readers, so
nothing reads the network, bars.db or a real data root.
"""
from __future__ import annotations

import ast
import json
import pathlib
import uuid

import pytest

import api.main as m
from api.services import rs_lists as rl
from api.services import watchlist_prebuilt as wp
from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db

SESSION = "2026-11-06"
YMD = "20261106"
PRIOR = "2026-11-05"
LIQ = {"dollar_vol_30d": 50_000_000, "price": 40.0}


# ───────────────────────────── fixtures ─────────────────────────────────────

@pytest.fixture
def sdb(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    return tmp_path


@pytest.fixture
def auth(tmp_path, monkeypatch):
    """A real auth.db in tmp with one admin user (`ADMIN_EMAILS`)."""
    from api.services import auth_db
    from api.services.auth_service import create_user
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    email = f"rsadmin_{uuid.uuid4().hex[:8]}@example.test"
    uid = create_user(email, "pw-not-used")["id"]
    monkeypatch.setenv("ADMIN_EMAILS", email)
    return uid


def leader(t, rating=95, **kw):
    return {"ticker": t, "bars_asof": YMD, "is_etf": 0, "rs_rating_ibd": rating,
            "rs_nh_bars_ago": 2, "pct_vs_sma200": 12.0, "rs_benchmark_agree": 1,
            "rs_cross_up_bars_ago": None, "rs_line_above_ma": 1, "sector": "Technology",
            "theme": None,
            **LIQ, **kw}


def emerging(t, rating=85, **kw):
    return {"ticker": t, "bars_asof": YMD, "is_etf": 0, "rs_rating_ibd": rating,
            "rs_nh_bars_ago": 40, "pct_vs_sma200": -3.0, "rs_benchmark_agree": 0,
            "rs_cross_up_bars_ago": 2, "rs_line_above_ma": 1, "sector": "Industrials",
            "theme": None,
            **LIQ, **kw}


def seed(rows, ratings=None, session=SESSION):
    """Screener rows, plus that session's rating rows (default: each row's own rating)."""
    snapshot_db.upsert_rows(rows)
    if ratings is None:
        ratings = {r["ticker"]: r["rs_rating_ibd"] for r in rows if r.get("rs_rating_ibd") is not None}
    rh.store_rows(session, {t: {"ibd": v, "bars": 253} for t, v in ratings.items()})


def no_theme(sym):
    return None


def run_build(**kw):
    kw.setdefault("etf_tickers", set())
    kw.setdefault("theme_resolver", no_theme)
    return rl.build(SESSION, **kw)


def syms(items):
    return [i["sym"] for i in items]


# ───────────────────────────── the rule ─────────────────────────────────────

def test_the_rule_on_synthetic_rows(sdb):
    seed([
        leader("LEAD"),
        leader("R89", rating=89),                       # below 90: not a leader
        leader("NH11", rs_nh_bars_ago=11),              # high too old
        leader("FLAT", pct_vs_sma200=0.0),              # not ABOVE the 200-day
        leader("SPLIT", rs_benchmark_agree=0),          # benchmarks disagree
        emerging("EMRG"),
        emerging("X6", rs_cross_up_bars_ago=6),         # cross too old
        emerging("R79", rating=79),                     # below 80
        leader("BOTH", rs_cross_up_bars_ago=1),         # passes both: Leaders only
        leader("THIN", dollar_vol_30d=9_999_999),       # under the $10M floor
        leader("CHEAP", price=4.99),                    # under the $5 floor
        leader("OLD", bars_asof="20261105"),            # another session's row
    ])
    out = run_build()
    assert set(syms(out["leaders"])) == {"LEAD", "BOTH"}
    # R89 / NH11 / FLAT / SPLIT miss Leaders; they have no fresh cross, so not Emerging either
    assert set(syms(out["emerging"])) == {"EMRG"}
    assert "BOTH" not in syms(out["emerging"])
    rec = out["receipt"]
    assert rec["matched"] == {"leaders": 2, "emerging": 1}
    assert rec["judged"] == 9, "the session's liquid non-ETF rows (OLD, THIN, CHEAP excluded)"


def test_a_leader_miss_with_a_fresh_cross_lands_on_emerging(sdb):
    seed([leader("R89X", rating=89, rs_cross_up_bars_ago=3)])
    out = run_build()
    assert syms(out["leaders"]) == [] and syms(out["emerging"]) == ["R89X"]


def test_a_name_that_crossed_up_and_fell_back_is_not_emerging(sdb):
    """The cross age keeps counting after the line gives the cross back, so Emerging also
    needs the RS line above its 21-day average NOW (owner decision 2026-11-07)."""
    seed([emerging("HELD"), emerging("FELLBACK", rs_line_above_ma=0),
          emerging("UNKNOWN", rs_line_above_ma=None)])
    out = run_build()
    assert syms(out["emerging"]) == ["HELD"], "control HELD stays; the other two are out"
    assert out["receipt"]["candidates"] == 1, "the SQL prefilter drops them too"
    assert rl._is_emerging({"rating": 85, "rs_cross_up_bars_ago": 2, "rs_line_above_ma": 0}) is False
    assert rl._is_emerging({"rating": 85, "rs_cross_up_bars_ago": 2, "rs_line_above_ma": 1}) is True


def test_the_rating_is_the_sessions_history_row_and_the_column_only_without_one(sdb):
    """The 03:00 build carries the session-before rating; the 04:15 history row for the
    session itself wins, and a name with no row keeps the screener column."""
    seed([leader("UPGRADED", rating=85), leader("DOWNGRADED", rating=95),
          leader("NOROW", rating=93)],
         ratings={"UPGRADED": 91, "DOWNGRADED": 88})
    out = run_build()
    assert set(syms(out["leaders"])) == {"UPGRADED", "NOROW"}
    assert out["receipt"]["rating_source"] == {"history": 2, "screener": 1, "unrated": 0}
    note = {i["sym"]: i["notes"] for i in out["leaders"]}
    assert "RS 91" in note["UPGRADED"] and "RS 93" in note["NOROW"]


def test_etfs_are_excluded_through_both_sources(sdb):
    seed([leader("STOCK"), leader("FLAGGED", is_etf=1), leader("LISTED")])
    out = run_build(etf_tickers={"LISTED"})
    assert syms(out["leaders"]) == ["STOCK"]
    # control: without the ETF set, LISTED is a leader, so the set is what removed it
    assert set(syms(run_build()["leaders"])) == {"STOCK", "LISTED"}


def test_the_liquidity_floors_are_read_from_saved_screens_not_retyped(sdb, monkeypatch):
    from api.services.screener import saved_screens
    seed([leader("MID", dollar_vol_30d=20_000_000), leader("BIG", dollar_vol_30d=80_000_000)])
    assert set(syms(run_build()["leaders"])) == {"MID", "BIG"}
    monkeypatch.setattr(saved_screens, "_RS_LIQUID",
                        ({"key": "dollar_vol_30d", "op": "gte", "min": 30_000_000},))
    assert syms(run_build()["leaders"]) == ["BIG"]


def test_an_unknown_floor_operator_refuses_rather_than_dropping_the_floor(sdb, monkeypatch):
    from api.services.screener import saved_screens
    monkeypatch.setattr(saved_screens, "_RS_LIQUID",
                        ({"key": "price", "op": "between", "min": 5, "max": 900},))
    with pytest.raises(KeyError):
        rl._liquid_sql()


# ───────────────────────────── cap, order, note ─────────────────────────────

def test_cap_is_30_cut_by_rating_then_laid_out_by_theme(sdb):
    rows = []
    # 20 Semis (ratings 99..80 would fail Leaders under 90, so keep all >= 90 by spreading)
    for i in range(20):
        rows.append(leader(f"S{i:02d}", rating=99 - (i % 9), theme="Semiconductors",
                           rs_nh_bars_ago=i % 5))
    for i in range(12):
        rows.append(leader(f"B{i:02d}", rating=98 - (i % 8), theme="Biotech"))
    for i in range(3):
        rows.append(leader(f"Z{i:02d}", rating=90, theme="Zinc", rs_nh_bars_ago=9))
    seed(rows)
    out = run_build()
    got = syms(out["leaders"])
    assert len(got) == rl.CAP == 30
    assert out["receipt"]["matched"]["leaders"] == 35
    # the five cut are the weakest: rating 90 with the oldest highs (all three Zinc + two more)
    kept = set(got)
    assert not any(s.startswith("Z") for s in kept)
    # theme blocks by member count, then inside a block rating desc, then most recent high
    themes = [i["notes"].split(" · ")[0] for i in out["leaders"]]
    first_b = themes.index("Biotech")
    assert set(themes[:first_b]) == {"Semiconductors"} and set(themes[first_b:]) == {"Biotech"}
    by_sym = {r["ticker"]: r for r in rows}
    semis = [s for s in got if s.startswith("S")]
    keys = [(-by_sym[s]["rs_rating_ibd"], by_sym[s]["rs_nh_bars_ago"], s) for s in semis]
    assert keys == sorted(keys)


def test_the_item_note_reads_theme_rating_and_high_age(sdb):
    seed([leader("NVDA", rating=97, rs_nh_bars_ago=3, theme="AI Chips"),
          leader("ONE", rating=92, rs_nh_bars_ago=1, theme="AI Chips"),
          emerging("NOHI", rs_nh_bars_ago=None, theme="Space")])
    out = run_build()
    notes = {i["sym"]: i["notes"] for i in out["leaders"] + out["emerging"]}
    assert notes["NVDA"] == "AI Chips · RS 97 · high 3 bars ago"
    assert notes["ONE"] == "AI Chips · RS 92 · high 1 bar ago"
    assert notes["NOHI"] == "Space · RS 85 · no RS high in the last year"


def test_theme_falls_back_from_column_to_resolver_to_sector(sdb):
    seed([leader("COL", theme="Lasers", sector="Tech"),
          leader("RES", theme=None, sector="Tech"),
          leader("SEC", theme=None, sector="Utilities"),
          leader("NONE", theme=None, sector=None)])
    asked = []

    def resolver(sym):
        asked.append(sym)
        return "Quantum" if sym == "RES" else None

    out = run_build(theme_resolver=resolver)
    notes = {i["sym"]: i["notes"].split(" · ")[0] for i in out["leaders"]}
    assert notes == {"COL": "Lasers", "RES": "Quantum", "SEC": "Utilities", "NONE": "Other"}
    assert "COL" not in asked, "the screener's own theme column is never second-guessed"


def test_the_default_theme_resolver_reads_resolve_primary_theme(monkeypatch):
    from api.services import groups
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: {"theme_name": " Nuclear "} if s == "CCJ" else None)
    assert rl._default_theme("CCJ") == "Nuclear"
    assert rl._default_theme("XYZ") is None
    monkeypatch.setattr(groups, "resolve_primary_theme",
                        lambda s: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert rl._default_theme("CCJ") is None


# ───────────────────────────── member copy ──────────────────────────────────

def test_the_descriptions_say_the_rule_in_plain_words():
    lead, emer = rl.DESCRIPTIONS[rl.LEADERS_NAME], rl.DESCRIPTIONS[rl.EMERGING_NAME]
    for d in (lead, emer):
        assert "Benchmarks agree means SPY and the equal-weight index RSP" in d
        assert "No ETFs" in d and "$10M+" in d and "$5" in d and "30 names" in d
        low = d.lower()
        assert " buy" not in low and " sell" not in low and "recommend" not in low
        assert all(ord(c) < 128 for c in d), "no emoji or decorative glyphs"
    assert "90 or higher" in lead and "10 sessions" in lead and "200-day" in lead
    assert "80 or higher" in emer and "5 sessions" in emer and "RS Leaders" in emer
    assert "within the last 5 sessions and is still above it" in emer


# ───────────────────────────── the job and its guards ───────────────────────

class _Writes:
    def __init__(self, sizes=None):
        self.calls, self.sizes = [], dict(sizes or {})

    def writer(self, name, desc, items):
        self.calls.append((name, desc, list(items)))
        self.sizes[name] = len(items)
        return {"status": "written"}

    def sizer(self, name):
        return self.sizes.get(name)


def job(w, **kw):
    kw.setdefault("settled", SESSION)
    kw.setdefault("rs_latest", SESSION)
    kw.setdefault("etf_tickers", set())
    kw.setdefault("theme_resolver", no_theme)
    return rl.nightly_job(writer=w.writer, sizer=w.sizer, **kw)


def _runs_table_exists():
    from contextlib import closing
    with closing(snapshot_db.connect()) as conn:
        return rl._table_exists(conn)


@pytest.mark.parametrize("value", [None, "0", "true", "yes", " 1"])
def test_off_it_reads_and_writes_nothing(sdb, monkeypatch, value):
    if value is None:
        monkeypatch.delenv(rl.FLAG, raising=False)
    else:
        monkeypatch.setenv(rl.FLAG, value)
    seed([leader("LEAD")])
    w = _Writes()
    r = job(w)
    assert r == {"enabled": False, "skipped": "not enabled", "wrote": False}
    assert w.calls == [] and not _runs_table_exists()


def test_on_it_writes_both_lists_and_the_receipt_reaches_snapshot_status(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("LEAD"), emerging("EMRG")])
    w = _Writes()
    r = job(w)
    assert r["skipped"] is None and r["wrote"] is True and r["fresh"] is True
    assert [c[0] for c in w.calls] == ["RS Leaders", "RS Emerging"]
    assert syms(w.calls[0][2]) == ["LEAD"] and syms(w.calls[1][2]) == ["EMRG"]
    st = snapshot_db.status()["rs_lists"]
    assert st["session"] == SESSION and st["lists"]["RS Leaders"]["status"] == "written"


def test_the_screener_session_is_the_median_bars_asof(sdb):
    seed([leader(f"T{i}") for i in range(5)] + [leader("LATE", bars_asof="20261109")])
    from contextlib import closing
    with closing(snapshot_db.connect()) as conn:
        assert rl.screener_session(conn) == SESSION


def test_it_skips_when_the_rating_history_is_older_than_the_screener_session(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("LEAD")])
    w = _Writes()
    r = job(w, rs_latest=PRIOR)
    assert w.calls == []
    assert r["skipped"] == ("the rating history's newest session (2026-11-05) is older than "
                            "the screener session (2026-11-06)")
    assert snapshot_db.status()["rs_lists"]["skipped"] == r["skipped"]
    # control: once the history catches up, the same fire writes
    assert job(w)["wrote"] is True and w.calls


def test_it_skips_with_no_screener_session_or_no_history(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    w = _Writes()
    assert job(w)["skipped"] == "the screener has no session yet"
    seed([leader("LEAD")])
    monkeypatch.setattr(rl, "_default_rs_latest", lambda: None)
    assert rl.nightly_job(settled=SESSION, writer=w.writer, sizer=w.sizer,
                          etf_tickers=set())["skipped"] == "the rating history has no session yet"
    assert w.calls == []


def test_a_missing_screener_table_is_the_friendly_skip_not_a_sqlite_error(tmp_path, monkeypatch):
    """A pod whose screener has never written has no `screener_rows` table at all (4-11 check)."""
    monkeypatch.setenv(rl.FLAG, "1")
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "empty_screener.db"))   # no init_db: no table
    from contextlib import closing
    with closing(snapshot_db.connect()) as conn:
        assert rl.screener_session(conn) is None
        assert conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'screener_rows'").fetchone() is None
    w = _Writes()
    r = rl.nightly_job(settled=SESSION, writer=w.writer, sizer=w.sizer, etf_tickers=set())
    assert r["skipped"] == "the screener has no session yet"
    assert w.calls == []


def test_a_missing_rating_history_table_is_the_friendly_skip_not_a_sqlite_error(sdb, monkeypatch):
    """Screener rows, but the 04:15 rating history has never written its table: the default reader says so."""
    monkeypatch.setenv(rl.FLAG, "1")
    snapshot_db.upsert_rows([leader("LEAD")])
    from contextlib import closing
    with closing(snapshot_db.connect()) as conn:
        conn.execute(f"DROP TABLE IF EXISTS {rh.TABLE}")
        conn.commit()
    w = _Writes()
    r = rl.nightly_job(settled=SESSION, writer=w.writer, sizer=w.sizer, etf_tickers=set())   # rs_latest: the default
    assert r["skipped"] == "the rating history has no session yet"
    assert w.calls == []


def test_it_never_goes_back_to_an_older_session_than_the_lists_hold(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("LEAD")])
    rl.record_run({"ran_at": 1.0, "session": "2026-11-09", "wrote": True})
    w = _Writes()
    r = job(w)
    assert w.calls == [] and "already hold session 2026-11-09" in r["skipped"]


def test_an_empty_result_never_replaces_a_full_list_from_a_stale_session(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("R80", rating=80)])                      # the session has rows, no list member
    w = _Writes(sizes={"RS Leaders": 12, "RS Emerging": 7})
    r = job(w, settled="2026-11-09")                      # the screener is behind: not fresh
    assert r["fresh"] is False and w.calls == []
    for name, n in (("RS Leaders", 12), ("RS Emerging", 7)):
        assert r["lists"][name]["status"] == "kept" and r["lists"][name]["names"] == n
        assert "not fresh" in r["lists"][name]["reason"]
    assert r["wrote"] is False


def test_a_fresh_session_that_truly_returned_nothing_does_empty_the_list(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("R80", rating=80)])
    w = _Writes(sizes={"RS Leaders": 12, "RS Emerging": 7})
    r = job(w)                                             # fresh, rows judged, nothing passes
    assert [(c[0], c[2]) for c in w.calls] == [("RS Leaders", []), ("RS Emerging", [])]
    assert r["lists"]["RS Leaders"]["status"] == "written"


def test_an_empty_first_fill_creates_the_empty_list(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("R80", rating=80)])
    w = _Writes()                                          # neither list exists yet
    job(w, settled="2026-11-09")
    assert [c[0] for c in w.calls] == ["RS Leaders", "RS Emerging"]


def test_the_job_never_raises(sdb, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("LEAD")])

    def boom(*a, **k):
        raise RuntimeError("auth.db locked")

    r = rl.nightly_job(settled=SESSION, rs_latest=SESSION, writer=boom, sizer=lambda n: 0,
                       etf_tickers=set(), theme_resolver=no_theme)
    assert r["skipped"].startswith("error: RuntimeError: auth.db locked")


# ───────────────────────────── the real write ───────────────────────────────

def _rs_rows():
    from api.services import watchlist_service as wl
    return {w["name"]: w for w in wl.list_prebuilt_watchlists(500)
            if wp._is_rs_family(w["name"])}


def test_end_to_end_the_lists_land_in_the_prebuilt_store_in_place(sdb, auth, monkeypatch):
    monkeypatch.setenv(rl.FLAG, "1")
    seed([leader("NVDA", rating=97, theme="AI Chips"), leader("AVGO", rating=94, theme="AI Chips"),
          emerging("RKLB", theme="Space")])
    r = rl.nightly_job(settled=SESSION, rs_latest=SESSION, etf_tickers=set(),
                       theme_resolver=no_theme)
    assert r["lists"]["RS Leaders"]["status"] == "written" and r["lists"]["RS Leaders"]["created"]
    rows = _rs_rows()
    lead = rows["RS Leaders"]
    assert lead["is_prebuilt"] == 1 and lead["is_public"] == 1 and lead["user_id"] == auth
    assert lead["description"] == rl.LEADERS_DESC
    assert [(i["sym"], i["notes"]) for i in lead["items"]] == [
        ("NVDA", "AI Chips · RS 97 · high 2 bars ago"),
        ("AVGO", "AI Chips · RS 94 · high 2 bars ago")]
    assert [i["sym"] for i in rows["RS Emerging"]["items"]] == ["RKLB"]

    # next morning: membership changes, the SAME list row is updated in place
    snapshot_db.upsert_rows([leader("AVGO", rating=70, theme="AI Chips"),
                             leader("ANET", rating=96, theme="Networking")])
    rh.store_rows(SESSION, {"AVGO": {"ibd": 70, "bars": 253}, "ANET": {"ibd": 96, "bars": 253}})
    r2 = rl.nightly_job(settled=SESSION, rs_latest=SESSION, etf_tickers=set(),
                        theme_resolver=no_theme)
    assert r2["lists"]["RS Leaders"]["created"] is False
    again = _rs_rows()["RS Leaders"]
    assert again["id"] == lead["id"]
    assert [i["sym"] for i in again["items"]] == ["NVDA", "ANET"]


def test_write_rs_list_removes_duplicates_and_refuses_other_names(auth):
    from api.services import watchlist_service as wl
    for _ in range(2):
        made = wl.create_watchlist(auth, "RS Leaders", "old", is_public=True)
        wl.update_watchlist(auth, made["id"], {"is_prebuilt": 1})
    out = wp.write_rs_list("RS Leaders", rl.LEADERS_DESC, [{"sym": "nvda", "notes": "n"}])
    assert out["status"] == "written" and out["duplicates_removed"] == 1
    rows = [w for w in wl.list_prebuilt_watchlists(500) if w["name"] == "RS Leaders"]
    assert len(rows) == 1 and rows[0]["description"] == rl.LEADERS_DESC
    assert [(i["sym"], i["notes"]) for i in rows[0]["items"]] == [("NVDA", "n")]
    assert wp.rs_list_size("RS Leaders") == 1 and wp.rs_list_size("RS Emerging") is None
    with pytest.raises(ValueError):
        wp.write_rs_list("Liquid Major ETFs", "x", [])


def test_write_rs_list_without_an_admin_writes_nothing(auth, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "")
    assert wp.write_rs_list("RS Emerging", rl.EMERGING_DESC, []) == {"status": "no_admin"}
    assert _rs_rows() == {}


# ───────────────────────────── the prebuilt store ───────────────────────────

def test_the_family_predicate():
    for nm in ("RS Leaders", "rs emerging", "  RS LEADERS "):
        assert wp._is_rs_family(nm)
    for nm in ("RS Leaders 2", "Leadership", "Sunday Scans — August 16, 2026", "", None):
        assert not wp._is_rs_family(nm)
    assert rl.LIST_NAMES == wp.RS_LIST_NAMES and rl.CATEGORY == wp.RS_CATEGORY


def test_the_seeder_never_deletes_the_rs_family_but_still_deletes_a_retired_list(auth, monkeypatch):
    from api.services import watchlist_service as wl
    monkeypatch.setattr(wp, "_load_lists", lambda: [
        {"name": "Kept List", "desc": "", "category": "UCT ETF Lists", "tickers": ["SPY"]}])
    monkeypatch.setattr(wp, "sunday_scans_specs", lambda: [])
    wp.write_rs_list("RS Leaders", rl.LEADERS_DESC, [{"sym": "NVDA", "notes": "x"}])
    retired = wl.create_watchlist(auth, "Retired List", "", is_public=True)
    wl.update_watchlist(auth, retired["id"], {"is_prebuilt": 1})
    wp.seed_prebuilt_watchlists()
    names = {w["name"] for w in wl.list_prebuilt_watchlists(500)}
    assert "RS Leaders" in names and "Kept List" in names
    assert "Retired List" not in names, "control: the delete step still runs"


def test_the_picker_places_the_lists_in_their_own_section(monkeypatch):
    monkeypatch.setattr(wp, "_load_committed", lambda: [
        {"name": "Liquid Major ETFs", "category": "UCT ETF Lists", "tickers": ["SPY"]},
        {"name": "Sunday Scans — August 16, 2026", "category": "UCT Community", "tickers": ["MU"]}])
    cats = wp.category_map()
    assert cats["rs leaders"] == cats["rs emerging"] == "UCT Relative Strength"
    assert wp.category_order() == ["UCT ETF Lists", "UCT Relative Strength", "UCT Community"]


def test_the_prebuilt_route_tags_the_rs_rows_with_their_section(monkeypatch):
    from api.routers import watchlists as r
    from api.services import watchlist_service as wl

    class _Req:
        headers = {}

    rows = [{"id": "lead", "name": "RS Leaders", "items": [], "user_id": "a"},
            {"id": "liq", "name": "Liquid Major ETFs", "items": [], "user_id": "a"}]
    monkeypatch.setattr(wl, "list_prebuilt_watchlists", lambda limit=1000, include_items=True: rows)
    monkeypatch.setattr(wp, "_load_committed", lambda: [
        {"name": "Liquid Major ETFs", "category": "UCT ETF Lists", "tickers": ["SPY"]}])
    out = json.loads(r.list_prebuilt(_Req(), user={"id": "u", "role": "member"}).body)
    assert [(o["id"], o["category"]) for o in out] == [
        ("liq", "UCT ETF Lists"), ("lead", "UCT Relative Strength")]


# ───────────────────────────── the registrar ────────────────────────────────

class _FakeSched:
    def __init__(self):
        self.ids, self.jobs = [], {}

    def add_job(self, fn, **k):
        self.ids.append(k.get("id"))
        self.jobs[k.get("id")] = (fn, k)


def _cron_field(trigger, name) -> str:
    for field in trigger.fields:
        if field.name == name:
            return str(field)
    raise AssertionError(f"the trigger declares no {name}")


JOB = "rs_lists_nightly"


def test_the_job_is_registered_at_0440_ET_with_the_siblings_options(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.delenv(rl.FLAG, raising=False)
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    fn, kw = sched.jobs[JOB]
    assert fn is m._run_rs_lists
    assert _cron_field(kw["trigger"], "hour") == "4" and _cron_field(kw["trigger"], "minute") == "40"
    assert str(kw["trigger"].timezone) == "America/New_York"
    assert kw["max_instances"] == 1 and kw["replace_existing"] is True
    assert kw["coalesce"] is True and kw["misfire_grace_time"] == 3600
    assert sched.ids.index("rs_history_nightly") < sched.ids.index("rs_evidence_pull") \
        < sched.ids.index(JOB) < sched.ids.index("rs_discord_post")


def test_the_add_job_sits_under_NO_flag_test__BY_AST():
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs")
    depth = {}

    def _walk(body, d):
        for stmt in body:
            if isinstance(stmt, ast.If):
                _walk(stmt.body, d + 1)
                _walk(stmt.orelse, d + 1)
                continue
            for node in ast.walk(stmt):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_job":
                    for k in node.keywords:
                        if k.arg == "id" and isinstance(k.value, ast.Constant):
                            depth[k.value.value] = d

    _walk(fn.body, 0)
    assert depth.get(JOB) == 0
    assert depth.get("screener_scan_sweep", 0) >= 1      # control: the probe sees gating


def test_the_registered_function_reads_the_flag_per_call_and_never_raises(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(rl, "nightly_job", lambda: calls.append(1) or {
        "enabled": True, "session": SESSION, "lists": {"RS Leaders": {"status": "written", "names": 3}}})
    m._run_rs_lists()
    assert calls == [1] and "RS_Leaders=written:3" in capsys.readouterr().out
    monkeypatch.setattr(rl, "nightly_job", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert m._run_rs_lists() is None
    assert "rs lists error: boom" in capsys.readouterr().out


def test_the_flag_is_ledgered_dark_on_web():
    ledger = json.loads((pathlib.Path(m.__file__).resolve().parents[1] / "docs" /
                         "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    e = ledger["RS_LISTS_ENABLED"]
    assert e["status"] == "dark" and e["where"] == ["web"]
    assert "PER CALL" in e["note"] and "04:40" in e["note"] and "FIRST FILL" in e["note"]
