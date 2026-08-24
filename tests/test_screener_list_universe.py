"""A member's own lists as a screening universe — and the boundary around them.

Benchmark Tier-1 loss #3: seven of twelve rivals let a member screen a
watchlist and we let them screen none.

⭐ THE SECURITY CASE IS FIRST IN THIS FILE ON PURPOSE. Everything else here is
a feature; `test_a_member_cannot_screen_another_members_watchlist` is the one
that must never go green by accident.
"""
import sqlite3

import pytest

from api.services.screener import list_universe as LU
from api.services.screener import query as Q


@pytest.fixture
def auth_db(tmp_path, monkeypatch):
    """A real auth.db with the three tables this module reads."""
    path = tmp_path / "auth.db"
    c = sqlite3.connect(path)
    c.executescript("""
        -- ⛔ TYPES COPIED FROM api/services/auth_db.py, NOT INVENTED. Ids
        -- are TEXT (production ids look like `4b9b2122-ddc`); an INTEGER
        -- fixture here passed green while the module refused every real list.
        CREATE TABLE watchlists (id TEXT PRIMARY KEY, user_id TEXT,
            name TEXT, is_flagged_list INTEGER DEFAULT 0);
        CREATE TABLE watchlist_items (id TEXT PRIMARY KEY, watchlist_id TEXT,
            sym TEXT, sort_order INTEGER DEFAULT 0, added_at TEXT DEFAULT '');
        CREATE TABLE ticker_tags (id INTEGER PRIMARY KEY, user_id TEXT,
            sym TEXT, color TEXT);
    """)
    # ALICE: a named list, a flagged list, gold tags
    c.execute("INSERT INTO watchlists VALUES ('4b9b2122-ddc','alice','Momentum',0)")
    c.execute("INSERT INTO watchlists VALUES ('b702218a-c0c','alice','Flagged',1)")
    c.execute("INSERT INTO watchlists VALUES ('6b64dbb0-f15','alice','Empty',0)")
    for i, s in enumerate(["nvda", "AMD", "AVGO"]):
        c.execute("INSERT INTO watchlist_items (watchlist_id,sym,sort_order) "
                  "VALUES ('4b9b2122-ddc',?,?)", (s, i))
    c.execute("INSERT INTO watchlist_items (watchlist_id,sym) VALUES ('b702218a-c0c','TSLA')")
    c.execute("INSERT INTO ticker_tags (user_id,sym,color) VALUES ('alice','MSFT','Gold')")
    c.execute("INSERT INTO ticker_tags (user_id,sym,color) VALUES ('alice','AAPL','gold')")
    # BOB: his own private list
    c.execute("INSERT INTO watchlists VALUES ('ff0000aa-bbb','bob','Bobs secrets',0)")
    c.execute("INSERT INTO watchlist_items (watchlist_id,sym) VALUES ('ff0000aa-bbb','SECRET')")
    c.commit()
    c.close()
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    return path


# ── the boundary ─────────────────────────────────────────────────────────────

def test_a_member_cannot_screen_another_members_watchlist(auth_db):
    """⛔ Ownership is enforced IN THE WHERE CLAUSE. Fetching by id and checking
    the owner afterwards would work and would still be wrong — the row would
    already be in this process's memory."""
    with pytest.raises(LU.ListRefusal):
        LU.resolve("wl:ff0000aa-bbb", "alice")


def test_not_yours_and_empty_do_not_look_the_same(auth_db):
    """An empty list is a screening answer; someone else's list is an attempt
    to read another member's data. A silent empty would hide the second from
    the logs as well as from the caller."""
    syms, rc = LU.resolve("wl:6b64dbb0-f15", "alice")
    assert syms == [] and rc["empty"] is True      # empty: answered
    with pytest.raises(LU.ListRefusal):            # not yours: refused
        LU.resolve("wl:ff0000aa-bbb", "alice")


def test_a_signed_out_caller_gets_nothing(auth_db):
    for uid in (None, "", 0):
        with pytest.raises(LU.ListRefusal):
            LU.resolve("wl:4b9b2122-ddc", uid)
    assert LU.available(None) == []


def test_the_scan_route_passes_the_session_user_not_the_body():
    """The spec is client-supplied JSON. If `user_id` were read off it, any
    member could name any other member's list. Asserted at the source, because
    the wire is the whole point."""
    import inspect
    from api.routers import screener as R
    src = inspect.getsource(R.screener_scan)
    assert "user_id=" in src and 'user' in src
    assert "spec.get(\"user_id\")" not in src and "spec['user_id']" not in src


# ── resolution ───────────────────────────────────────────────────────────────

def test_a_watchlist_resolves_uppercased_and_in_order(auth_db):
    """`screener_rows.ticker` is uppercase; a case mismatch would return
    nothing while looking like a working filter."""
    syms, rc = LU.resolve("wl:4b9b2122-ddc", "alice")
    assert syms == ["NVDA", "AMD", "AVGO"]
    assert rc["label"] == "Momentum" and rc["complement"] is False
    assert rc["symbols"] == 3 and rc["empty"] is False


def test_the_flagged_list_and_its_complement(auth_db):
    syms, rc = LU.resolve("flagged", "alice")
    assert syms == ["TSLA"] and rc["complement"] is False
    syms2, rc2 = LU.resolve("unflagged", "alice")
    assert syms2 == ["TSLA"], "the complement resolves the SAME set"
    assert rc2["complement"] is True, "and flags that it must be negated"


def test_a_colour_tag_is_case_insensitive(auth_db):
    """'Gold' and 'gold' are one colour — the store holds both spellings."""
    syms, _ = LU.resolve("tag:gold", "alice")
    assert sorted(syms) == ["AAPL", "MSFT"]


def test_an_unknown_selector_refuses(auth_db):
    for bad in ("", "   ", "nonsense", "wl:", "tag:", None, 7):
        with pytest.raises(LU.ListRefusal):
            LU.resolve(bad, "alice")


def test_the_cap_refuses_rather_than_emitting_unbindable_sql(auth_db, monkeypatch):
    monkeypatch.setattr(LU, "MAX_SYMBOLS", 2)
    with pytest.raises(LU.ListRefusal):
        LU.resolve("wl:4b9b2122-ddc", "alice")


# ── the SQL ──────────────────────────────────────────────────────────────────

def _where(specs, user_id="alice"):
    joins = []
    sql, params = Q.build_where(specs, list_joins=joins, user_id=user_id)
    return sql, params, joins


def test_a_list_filter_becomes_an_IN_over_the_ticker(auth_db):
    sql, params, joins = _where([{"key": "list", "op": "in", "value": "wl:4b9b2122-ddc"}])
    assert "UPPER(ticker) IN (?,?,?)" in sql
    assert params == ["NVDA", "AMD", "AVGO"]
    assert joins[0]["label"] == "Momentum"


def test_the_unflagged_complement_becomes_NOT_IN(auth_db):
    """⛔ A complement rendered as IN is the exact inverse of the requested
    screen and would look entirely plausible on screen."""
    sql, params, _ = _where([{"key": "list", "op": "in", "value": "unflagged"}])
    assert "UPPER(ticker) NOT IN (?)" in sql
    assert params == ["TSLA"]


def test_an_empty_list_screens_to_NOTHING_not_to_everything(auth_db):
    """⛔ K1 from the scan branch, in a new place. The generic in-branch drops
    an empty value list, which would silently widen the screen from 'my six
    names' to all 3,745."""
    sql, params, _ = _where([{"key": "list", "op": "in", "value": "wl:6b64dbb0-f15"}])
    assert "1=0" in sql
    assert params == []


def test_an_empty_flagged_list_makes_unflagged_a_no_op(auth_db):
    """Nothing flagged means 'everything else' really is everything — and the
    receipt still records that the filter ran."""
    import sqlite3 as s3
    c = s3.connect(auth_db); c.execute("DELETE FROM watchlist_items WHERE watchlist_id='b702218a-c0c'")
    c.commit(); c.close()
    sql, params, joins = _where([{"key": "list", "op": "in", "value": "unflagged"}])
    assert sql.strip() in ("", "1=1") or "ticker" not in sql
    assert joins and joins[0]["complement"] is True


def test_several_selectors_in_one_filter_UNION(auth_db):
    """⛔ The opposite of the `scan` branch, deliberately: a scan is a
    CRITERION and ANDs; a list is a UNIVERSE and unions."""
    sql, params, _ = _where([{"key": "list", "op": "in",
                              "value": ["wl:4b9b2122-ddc", "tag:gold"]}])
    assert sql.count("UPPER(ticker) IN") == 1
    assert sorted(params) == ["AAPL", "AMD", "AVGO", "MSFT", "NVDA"]


def test_two_list_filters_INTERSECT(auth_db):
    sql, params, _ = _where([{"key": "list", "op": "in", "value": "wl:4b9b2122-ddc"},
                             {"key": "list", "op": "in", "value": "tag:gold"}])
    assert sql.count("UPPER(ticker) IN") == 2, "two clauses AND together"


def test_a_complement_cannot_be_unioned_with_another_list(auth_db):
    with pytest.raises(ValueError):
        _where([{"key": "list", "op": "in", "value": ["unflagged", "wl:4b9b2122-ddc"]}])


def test_an_unresolvable_selector_refuses_the_whole_query(auth_db):
    """Never 'return the universe because the filter failed'."""
    with pytest.raises(ValueError):
        _where([{"key": "list", "op": "in", "value": "wl:ff0000aa-bbb"}])   # bob's
    with pytest.raises(ValueError):
        _where([{"key": "list", "op": "in", "value": "wl:4b9b2122-ddc"}], user_id=None)


def test_only_the_in_op_is_accepted(auth_db):
    with pytest.raises(ValueError):
        _where([{"key": "list", "op": "gte", "min": 1}])


def test_the_list_filter_composes_with_an_ordinary_one(auth_db):
    sql, params, _ = _where([{"key": "list", "op": "in", "value": "wl:4b9b2122-ddc"},
                             {"key": "pe_ttm", "op": "lte", "max": 20}])
    assert "UPPER(ticker) IN" in sql and "<= ?" in sql
    assert params[-1] == 20


# ── meta ─────────────────────────────────────────────────────────────────────

def test_available_offers_every_list_the_member_owns(auth_db):
    vals = [o["value"] for o in LU.available("alice")]
    assert "flagged" in vals and "unflagged" in vals
    assert "wl:4b9b2122-ddc" in vals and "wl:6b64dbb0-f15" in vals, "an EMPTY list is still offered"
    assert "tag:gold" in vals
    assert "wl:ff0000aa-bbb" not in vals, "bob's list is not alice's business"


def test_available_never_offers_the_flagged_list_twice(auth_db):
    vals = [o["value"] for o in LU.available("alice")]
    assert "wl:b702218a-c0c" not in vals, "the flagged list is reached by its own selector"


def test_the_category_is_absent_when_the_member_has_no_lists(auth_db):
    """No lists means NO CATEGORY, never an empty shell — a control offering
    nothing reads as a broken feature."""
    from api.services.screener import filters as F
    assert F._my_lists_entry("nobody") is None


def test_the_category_appears_with_its_selectors(auth_db):
    from api.services.screener import filters as F
    entry = F._my_lists_entry("alice")
    assert entry["key"] == "list" and entry["category"] == "my_lists"
    assert entry["presets"][0] == {"label": "Any"}
    assert any(p.get("value") == "unflagged" for p in entry["presets"])
    assert entry.get("desc"), "a new control ships with its explanation"


def test_an_unreadable_auth_db_costs_one_category_not_the_screener(monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", "/definitely/not/here.db")
    assert LU.available("alice") == []
    from api.services.screener import filters as F
    assert F._my_lists_entry("alice") is None
