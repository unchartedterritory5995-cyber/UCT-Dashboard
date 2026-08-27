"""THE READ PATH — does the live overlay actually REACH the member?

The tier shipped a sweeper, a side table (`screener_live`) and a receipt, and a
grep of the whole repo on 2026-08-23 found the table named NOWHERE outside its
writer, its own tests and one comment. `query.run_scan` had no join, no
COALESCE and no serve predicate — so the sweeper computed a 10:42 distance to
the 50-day every sixty seconds and the member's screen kept showing the 03:00
one. Built, tested, green and unreachable; this repo has a lesson by that name.

This file covers the half that closes it, and the four claims that make it
honest:

  1. **ONE expression, three clauses.** A column that FILTERS on the nightly
     value while DISPLAYING the live one is this repo's signature defect. The
     marker test pins SELECT, WHERE and ORDER BY to the SAME builder; the
     mutation beside it EXECUTES the divergence and shows exactly what a member
     would have lost.
  2. **The serve predicate is the tier's**, per row: a stale overlay, an
     overlay from a previous session, and no overlay at all each fall back to
     nightly silently and correctly.
  3. **Flag off is the pre-overlay statement**, compared to a frozen literal —
     the rollback guarantee, mechanical rather than asserted in prose.
  4. **The roster is the writer's declaration**, never a copy retyped here.

⭐ EVERY GUARD CARRIES A CONTROL that proves it can fail — in almost every case
the SAME call against the fixture that must produce the opposite answer, which
is why the fixture is built so the live answer and the nightly answer are
DISJOINT (`CROSSER` qualifies live and not nightly; `FADER` qualifies nightly
and not live). A suite whose two branches agreed could not tell a working
overlay from a hard-wired one.

⛔ EVERY FIXTURE IS CONSTRUCTED IN A TMP DB. Nothing reads `C:\\data`.
"""
import ast
import pathlib
import re
import time

import pytest

from api.services.screener import live_tier, query, snapshot_db

# ─── the fixture, built so live and nightly answers are DISJOINT ─────────────
#
# `bars_asof` is the row's anchor session; the overlay claims the NEXT one, so
# the serve predicate (`live_session_ymd > CAST(bars_asof AS INTEGER)`) is
# satisfied. Both are constants — nothing here depends on today's calendar.
_ANCHOR_YMD = "20260822"
_LIVE_YMD = 20260823

_NIGHTLY = [
    # up 0.5% at 03:00, up 6.4% now — a `>= 3% today` filter must FIND it, and
    # must show it the live number it was found by.
    dict(ticker="CROSSER", price=100.0, chg_pct_1d=0.5, pct_vs_sma50=-2.4,
         uct_composite=50),
    # no overlay row at all: nightly, silently and correctly.
    dict(ticker="NOLIVE", price=50.0, chg_pct_1d=0.4, pct_vs_sma50=-1.0,
         uct_composite=40),
    # up 9.0% at 03:00, up 1.0% now — the mirror. A WHERE reading the nightly
    # column returns THIS row instead, which is what makes the mutation visible.
    dict(ticker="FADER", price=70.0, chg_pct_1d=9.0, pct_vs_sma50=5.0,
         uct_composite=30),
]


def _nightly_rows(bars_asof=_ANCHOR_YMD):
    return [{**r, "bars_asof": bars_asof, "snapshot_date": "2026-08-22",
             "built_at": 1} for r in _NIGHTLY]


def _overlay_row(ticker, *, session_ymd=_LIVE_YMD, asof=None,
                 anchor=_ANCHOR_YMD, **values):
    """One overlay row, written through the WRITER's own `upsert_live_rows`.

    ⛔ Only the columns a test is making a claim about are set; the rest stay
    NULL and COALESCE falls through to the nightly value — the same answer the
    writer's copy-forward rule produces, and it lets each test name exactly the
    column it is about instead of restating twenty-two.
    """
    row = {c: None for c in live_tier.LIVE_COLUMNS}
    row.update(values)
    row.update({
        "ticker": ticker,
        "live_session_ymd": int(session_ymd),
        "live_asof": float(time.time() if asof is None else asof),
        "anchor_bars_asof": anchor,
        "src_price": float(values.get("price") or 1.0),
        "anchor_price": 1.0,
        "live_cols": len(values),
    })
    return row


@pytest.fixture
def served(tmp_path, monkeypatch):
    """A screener.db with the three nightly rows, an armed tier, and overlay
    rows for two of the three. `_session` is pinned to `regular` so the
    in-session freshness half of the predicate is the one under test."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "readpath.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_session", lambda: "regular")
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_nightly_rows())
    snapshot_db.upsert_live_rows([
        _overlay_row("CROSSER", price=106.4, chg_pct_1d=6.4, pct_vs_sma50=3.9),
        _overlay_row("FADER", price=70.7, chg_pct_1d=1.0, pct_vs_sma50=0.2),
    ])
    return snapshot_db


def _by_ticker(spec=None):
    res = query.run_scan({"page_size": 50, **(spec or {})})
    return {r["ticker"]: r for r in res["rows"]}, res


_OVER_3_TODAY = {"filters": [{"key": "chg_pct_1d", "op": "gte", "min": 3}],
                 "page_size": 50}


# ═══ 1. the filter and the screen agree, because they are one expression ═════

def test_a_row_the_LIVE_value_qualifies_is_returned_AND_shows_the_live_number(served):
    """⭐ THE WHOLE FEATURE, IN ONE ASSERTION. `CROSSER` is up 0.5% in the 03:00
    snapshot and 6.4% right now. A member screening *"up 3% or more today"* must
    get it back, and must see 6.4 — not get it back and see 0.5 (a row that
    contradicts its own filter), and not miss it entirely (a market that looks
    quiet)."""
    res = query.run_scan(_OVER_3_TODAY)
    assert [r["ticker"] for r in res["rows"]] == ["CROSSER"]
    row = res["rows"][0]
    assert row["chg_pct_1d"] == 6.4          # DISPLAYED live
    assert row["price"] == 106.4
    assert row["live_row"] == 1
    # `total` comes from the description, which must have been run against the
    # SAME join — against `screener_rows` alone this raises `no such column: l.`
    assert res["total"] == 1


def test_the_CONTROL_the_same_filter_returns_the_NIGHTLY_answer_with_the_flag_off(
        served, monkeypatch):
    """The control that makes the test above mean something: flag off, the same
    request returns the OTHER row entirely. The two answers are disjoint, so a
    read path hard-wired to either one cannot pass both."""
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    res = query.run_scan(_OVER_3_TODAY)
    assert [r["ticker"] for r in res["rows"]] == ["FADER"]
    assert res["rows"][0]["chg_pct_1d"] == 9.0
    assert "live_row" not in res["rows"][0]
    assert res["snapshot"]["live"]["state"] == "nightly"


def test_the_MUTATION_a_WHERE_on_the_nightly_column_loses_the_row_it_displays(served):
    """⛔ THE DEFECT, EXECUTED — not described.

    Take the statement the read path builds and point ONLY the WHERE clause at
    `screener_rows.chg_pct_1d`, leaving the SELECT on the overlay. That is the
    divergence `col_expr` exists to make impossible, and this is what it costs:
    the 6.4% mover vanishes from a *"up 3% today"* screen, and the row that DOES
    come back is displayed at 1.0% under a filter that claims every row is above
    3. Both halves are wrong and neither is visible from the other side.
    """
    with snapshot_db.connect() as conn:
        plan = query.build_scan_sql(_OVER_3_TODAY, query._overlay(conn))
        live_expr = 'COALESCE(l."chg_pct_1d", screener_rows."chg_pct_1d") >= ?'
        assert live_expr in plan["sql"]
        mutated = plan["sql"].replace(live_expr, 'screener_rows."chg_pct_1d" >= ?')
        # ⭐ proof the mutation APPLIED — a no-op replace would make the rest of
        # this test a restatement of the passing case.
        assert mutated != plan["sql"]
        rows = [dict(r) for r in conn.execute(mutated, plan["params"]).fetchall()]

    assert [r["ticker"] for r in rows] == ["FADER"]     # CROSSER is GONE
    assert rows[0]["chg_pct_1d"] == 1.0                 # …and this one lies


# ═══ 2. the serve predicate, per row ═════════════════════════════════════════

def test_a_row_with_NO_overlay_entry_serves_nightly_silently(served):
    """A LEFT JOIN with no match IS the nightly row, byte for byte — and the
    sibling in the same result set carrying the overlay is the control."""
    rows, _ = _by_ticker()
    assert rows["NOLIVE"]["chg_pct_1d"] == 0.4
    assert rows["NOLIVE"]["price"] == 50.0
    assert rows["NOLIVE"]["live_row"] == 0
    assert rows["NOLIVE"]["live_asof"] is None
    # control, in the SAME statement: the overlay is genuinely being applied
    assert rows["CROSSER"]["chg_pct_1d"] == 6.4
    assert rows["CROSSER"]["live_row"] == 1


def test_a_STALE_overlay_row_serves_nightly__the_dead_sweeper_contract(served, monkeypatch):
    """⭐ IF THE SWEEPER DIES THE SCREEN REVERTS ON ITS OWN. In-session, an
    overlay older than `SCREENER_LIVE_MAX_AGE_S` is not served — no callback, no
    truncate, no operator.

    Three states, one test, because the middle one is the claim and the other
    two are what prove it is the AGE doing the work:
      * fresh  -> live      (the control)
      * stale  -> nightly   (the contract)
      * stale, but OUTSIDE the regular session -> live again, because the age
        check deliberately does not apply then (the last sweep's values are that
        day's closing prints) — which pins that the read path is asking the
        TIER's `min_serve_asof`, not a cutoff of its own.
    """
    fresh, _ = _by_ticker()
    assert fresh["CROSSER"]["chg_pct_1d"] == 6.4        # control: fresh serves

    stale_at = time.time() - live_tier.max_age_s() * 10
    snapshot_db.upsert_live_rows([
        _overlay_row("CROSSER", asof=stale_at, price=106.4, chg_pct_1d=6.4)])

    rows, res = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5         # the nightly value
    assert rows["CROSSER"]["price"] == 100.0
    assert rows["CROSSER"]["live_row"] == 0
    # ⭐ PER ROW, not per page. `FADER`'s overlay is still fresh, so the page is
    # still `live` and still says so — one dead symbol does not blank a screen,
    # and one fresh symbol does not vouch for a stale one.
    assert res["snapshot"]["live"]["state"] == "live"
    assert res["snapshot"]["live"]["live_rows_on_page"] == 1
    assert rows["FADER"]["chg_pct_1d"] == 1.0

    monkeypatch.setattr(live_tier, "_session", lambda: "closed")
    after_hours, _ = _by_ticker()
    assert after_hours["CROSSER"]["chg_pct_1d"] == 6.4


def test_an_overlay_from_a_PREVIOUS_SESSION_is_never_served(served):
    """The overnight-retirement contract, both ways round.

    An overlay is served only where it describes a session STRICTLY NEWER than
    the row's own anchor. So: an overlay stamped with the anchor's own session
    is refused (it says nothing the row does not already say), and — the same
    predicate, no extra machinery — tonight's build advancing `bars_asof` to the
    overlay's session retires today's overlay with no truncate and no ordering
    requirement between the two jobs.
    """
    snapshot_db.upsert_live_rows([
        _overlay_row("CROSSER", session_ymd=int(_ANCHOR_YMD),
                     price=106.4, chg_pct_1d=6.4)])
    rows, _ = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5
    assert rows["CROSSER"]["live_row"] == 0

    # control: one session newer than the anchor and the very same row serves
    snapshot_db.upsert_live_rows([
        _overlay_row("CROSSER", price=106.4, chg_pct_1d=6.4)])
    rows, _ = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 6.4

    # …and the build rolling forward retires it, with nothing else changing
    snapshot_db.upsert_rows(_nightly_rows(bars_asof=str(_LIVE_YMD)))
    rows, _ = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5
    assert rows["CROSSER"]["live_row"] == 0


def test_a_bars_asof_that_is_not_a_DATE_never_satisfies_the_predicate(served):
    """`CAST('' AS INTEGER)` is 0 in SQLite and `20260823 > 0` is TRUE, so the
    bare session comparison would hang a live price on a row whose anchor
    session is unreadable. The tier's predicate carries a `> 0` half for exactly
    this; the read path takes the predicate whole rather than composing one."""
    snapshot_db.upsert_rows(_nightly_rows(bars_asof="not-a-date"))
    rows, _ = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5
    assert rows["CROSSER"]["live_row"] == 0


# ═══ 3. the sort ranks what the screen shows ═════════════════════════════════

def test_the_ORDER_BY_ranks_the_SERVED_value_not_the_STORED_one(served, monkeypatch):
    """A sort on the nightly column beside a screen showing live values is the
    same defect as a filter on it — the member reads the list top-down and the
    order is about numbers that are not on the page. The two orderings here are
    genuine reversals of each other, so neither can pass for the other."""
    spec = {"sort": {"key": "chg_pct_1d", "dir": "desc"}, "page_size": 50}
    assert [r["ticker"] for r in query.run_scan(spec)["rows"]] == \
        ["CROSSER", "FADER", "NOLIVE"]          # 6.4 · 1.0 · 0.4 — live

    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    assert [r["ticker"] for r in query.run_scan(spec)["rows"]] == \
        ["FADER", "CROSSER", "NOLIVE"]          # 9.0 · 0.5 · 0.4 — nightly


# ═══ 4. one expression builder, three call sites ═════════════════════════════

def test_SELECT_WHERE_and_ORDER_BY_all_ask_the_SAME_builder(monkeypatch):
    """⛔ THE STRUCTURAL RAIL. Replace `col_expr` with a marker and every clause
    that asks it carries the marker; a clause that composed its own SQL would
    carry a real identifier instead and fail BY POSITION.

    This is the guard against the failure the behavioural tests above cannot
    see: they exercise one filter and one sort, and a fourth clause added later
    (a HAVING, a second sort key, a projection) could quietly read the snapshot.
    """
    spec = {"filters": [{"key": "chg_pct_1d", "op": "gte", "min": 3}],
            "columns": ["price"],
            "sort": {"key": "uct_composite", "dir": "desc"}}

    plain = query.build_scan_sql(spec, query.OFF)["sql"]
    # control: unpatched, each position holds real SQL — so the assertions below
    # are not true of any string this function could return.
    assert "<<" not in plain
    assert '"price"' in plain.split(" FROM ")[0]

    monkeypatch.setattr(query._Overlay, "col_expr", lambda self, col: f"<<{col}>>")
    sql = query.build_scan_sql(spec, query.OFF)["sql"]
    select_part = sql.split(" FROM ")[0]
    where_part = sql.split(" WHERE ")[1].split(" ORDER BY ")[0]
    order_part = sql.split(" ORDER BY ")[1]

    assert "<<price>>" in select_part and "<<ticker>>" in select_part
    assert "<<chg_pct_1d>>" in where_part
    assert "<<uct_composite>>" in order_part


# ═══ 5. flag off is the pre-overlay statement ════════════════════════════════

#: 🔴 FROZEN. Exactly what `run_scan` emitted at `d3260685c`, the commit before
#: the overlay's read path landed. ⛔ Do not regenerate these from the current
#: code — a frozen literal regenerated from the thing it is pinning is not a
#: pin. If one of these has to change, the rollback guarantee changed with it.
_PRE_OVERLAY_SQL = {
    "plain": ('SELECT * FROM screener_rows '
              'ORDER BY "uct_composite" DESC NULLS LAST LIMIT ? OFFSET ?'),
    "filtered": ('SELECT * FROM screener_rows WHERE chg_pct_1d >= ? '
                 'ORDER BY "uct_composite" DESC NULLS LAST LIMIT ? OFFSET ?'),
    "columns": ('SELECT "ticker", "price", "uct_composite" FROM screener_rows '
                'ORDER BY "uct_composite" DESC NULLS LAST LIMIT ? OFFSET ?'),
}
_SPECS = {
    "plain": {},
    "filtered": {"filters": [{"key": "chg_pct_1d", "op": "gte", "min": 3}]},
    "columns": {"columns": ["price"]},
}


def _unquoted(sql: str) -> str:
    """Strip identifier quoting — the ONE deliberate textual difference.

    ⚠️ STATED PLAINLY BECAUSE A NORMALISER CAN HIDE A REGRESSION. Routing every
    clause through one builder meant one rendering, and the rendering that keeps
    the SELECT list and the ORDER BY byte-identical is the QUOTED identifier the
    two of them already used — so the WHERE clause's `chg_pct_1d >= ?` became
    `"chg_pct_1d" >= ?`. Same identifier, same bound parameters, same rows. The
    exact-string assertions below run on the UNNORMALISED SQL as well, so this
    helper widens nothing except that.
    """
    return re.sub(r'"([A-Za-z_][A-Za-z0-9_]*)"', r"\1", sql)


def test_with_the_overlay_OFF_the_statement_is_the_PRE_OVERLAY_statement():
    """⭐ THE ROLLBACK GUARANTEE, MECHANICAL. Unset `SCREENER_LIVE_TIER_ENABLED`
    and the read path is the read path that shipped before any of this — no
    join, no COALESCE, `screener_live` never named, `SELECT *` preserved."""
    for name, spec in _SPECS.items():
        plan = query.build_scan_sql(spec, query.OFF)
        assert _unquoted(plan["sql"]) == _unquoted(_PRE_OVERLAY_SQL[name]), name
        assert "JOIN" not in plan["sql"], name
        assert "COALESCE" not in plan["sql"], name
        assert live_tier.LIVE_TABLE not in plan["sql"], name
        assert plan["from_sql"] == "screener_rows", name
        assert plan["describe_params"] == ([3] if name == "filtered" else []), name


def test_the_CONTROL_the_armed_statement_is_NOT_the_pre_overlay_statement(served):
    """The comparison above can fail — here is the fixture that fails it."""
    with snapshot_db.connect() as conn:
        overlay = query._overlay(conn)
    assert overlay.on
    for name, spec in _SPECS.items():
        sql = query.build_scan_sql(spec, overlay)["sql"]
        assert _unquoted(sql) != _unquoted(_PRE_OVERLAY_SQL[name]), name
        assert f"LEFT JOIN {live_tier.LIVE_TABLE} l ON" in sql, name
        assert "COALESCE(" in sql, name
        assert "*" not in sql.split(" FROM ")[0], name   # never `SELECT *` joined


class _SpyConn:
    """A recording proxy over the real connection.

    ⛔ THE WIRE RAIL. Every assertion about `build_scan_sql`'s output would pass
    just as happily if `run_scan` executed something else entirely — the
    built-tested-green-and-unreachable shape, one level down. This records what
    actually reached SQLite.
    """

    def __init__(self, real):
        self._real = real
        self.sql = []

    def execute(self, sql, params=()):
        self.sql.append(sql)
        return self._real.execute(sql, params)

    def __enter__(self):
        self._real.__enter__()
        return self

    def __exit__(self, *exc):
        return self._real.__exit__(*exc)

    def __getattr__(self, name):
        return getattr(self._real, name)


def _spy(monkeypatch):
    seen = []
    real_connect = snapshot_db.connect

    def _connect():
        conn = _SpyConn(real_connect())
        seen.append(conn)
        return conn

    monkeypatch.setattr(snapshot_db, "connect", _connect)
    return seen


def test_run_scan_EXECUTES_what_build_scan_sql_built__and_names_no_overlay_when_off(
        served, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    seen = _spy(monkeypatch)
    res = query.run_scan(_OVER_3_TODAY)

    executed = [s for c in seen for s in c.sql]
    assert executed, "run_scan opened no connection"
    # ⛔ NOT ONE STATEMENT touches the overlay — including the description's.
    assert not any(live_tier.LIVE_TABLE in s for s in executed)
    assert not any("COALESCE" in s for s in executed)
    # the row statement is the one `build_scan_sql` built, character for character
    expected = query.build_scan_sql(_OVER_3_TODAY, query.OFF)["sql"]
    assert expected in executed
    assert res["total"] == 1


def test_the_CONTROL_the_armed_run_scan_DOES_execute_the_join(served, monkeypatch):
    """…and the spy can see it, so the assertion above is not vacuous. Both
    statements — the rows AND the description — carry the join, which is what
    keeps `total` describing the rows it labels."""
    seen = _spy(monkeypatch)
    query.run_scan(_OVER_3_TODAY)
    executed = [s for c in seen for s in c.sql
                if s.lstrip().upper().startswith("SELECT")
                and "sqlite_master" not in s]
    assert len(executed) == 2
    assert all(f"LEFT JOIN {live_tier.LIVE_TABLE} l ON" in s for s in executed)


# ═══ 6. the roster is the WRITER's declaration ═══════════════════════════════

def test_the_overlaid_columns_are_the_TIERS_OWN_LIST_and_nothing_else(served):
    """⛔ A SECOND LIST IS A SECOND AUTHORITY. `live_tier.LIVE_COLUMNS` is the
    one declaration of what the overlay owns; the read path intersects it with
    the snapshot's real columns (so a typo cannot 500 every scan) and overlays
    exactly that, leaving every other column reading the snapshot."""
    with snapshot_db.connect() as conn:
        overlay = query._overlay(conn)
    expected = frozenset(live_tier.LIVE_COLUMNS) & set(snapshot_db.COLUMNS)
    assert overlay.columns == expected
    # R15 in passing: every declared live column IS a real snapshot column, so
    # the intersection above is not quietly dropping one.
    assert len(expected) == len(set(live_tier.LIVE_COLUMNS))

    for col in snapshot_db.COLUMNS:
        expr = overlay.col_expr(col)
        if col in expected:
            assert expr == f'COALESCE(l."{col}", screener_rows."{col}")', col
        else:
            assert expr == f'screener_rows."{col}"', col


def test_a_roster_change_reaches_the_SQL_with_no_edit_in_the_read_path(served, monkeypatch):
    """The derivation, proved by moving the source. Shrink the writer's list and
    the statement follows — which could not happen if these names were retyped
    in `query.py`."""
    monkeypatch.setattr(live_tier, "LIVE_COLUMNS", ("price",))
    with snapshot_db.connect() as conn:
        overlay = query._overlay(conn)
    assert overlay.columns == frozenset({"price"})
    assert overlay.col_expr("price").startswith("COALESCE(")
    assert overlay.col_expr("chg_pct_1d") == 'screener_rows."chg_pct_1d"'


# ═══ 7. the disclosure lights up off the served rows ═════════════════════════

def test_the_scan_response_now_says_LIVE_because_a_served_row_carries_it(served):
    """The surface derives its verdict from `live_row` on the rows it served.
    Until the join landed that flag could never be 1, so the whole disclosure —
    already built, already threaded to the Seal — was permanently dark."""
    res = query.run_scan({"page_size": 50})
    live = res["snapshot"]["live"]
    assert live["state"] == "live"
    assert live["live_rows_on_page"] == 2 and live["rows_on_page"] == 3
    assert live["as_of_source"] == "rows"       # the OVERLAY's clock, not a cycle's
    assert live["anchor_date"] == "2026-08-22"
    assert "2026-08-22 close" in live["anchor_note"]
    assert live["off_reason"] is None


def test_the_CONTROL_the_same_response_says_NIGHTLY_when_nothing_was_overlaid(
        served, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    live = query.run_scan({"page_size": 50})["snapshot"]["live"]
    assert live["state"] == "nightly"
    assert live["live_rows_on_page"] == 0
    assert live["as_of"] is None


def test_the_screen_names_only_the_columns_the_SWEEP_MEASURED_as_live(served, monkeypatch):
    """⛔⛔ THE ROSTER IS THE DISCLOSURE, so it must be the MEASUREMENT.

    `LIVE_COLUMNS` is what the tier aspires to recompute; `live_columns_effective()`
    is what its last writing cycle measured itself recomputing. Four of the
    twenty-two need feed fields the snapshot parse does not yet emit and carry
    their nightly value forward — naming one "live as of 10:42" is an honest
    value under a dishonest label. This mattered the instant the join landed:
    until then no row carried `live_row`, so the list was never a live claim.

    ⛔ AND THE SQL STILL OVERLAYS THE UNCLAIMED COLUMN — not a contradiction.
    An overlay row holds the nightly value verbatim for whatever it could not
    recompute, so COALESCE returns the same number; only the CLAIM narrows.
    """
    monkeypatch.setattr(live_tier, "_EFFECTIVE_COLUMNS",
                        tuple(c for c in live_tier.LIVE_COLUMNS if c != "gap_pct"))
    live = query.run_scan({"page_size": 50})["snapshot"]["live"]

    assert live["state"] == "live"
    assert set(live["columns"]) == set(live_tier.live_columns_effective())
    assert "gap_pct" not in live["columns"]
    assert live["column_count"] == len(live_tier.LIVE_COLUMNS) - 1
    # control: the two lists genuinely DIFFER, so the assertions above are not
    # trivially true of whichever one the surface happened to read.
    assert "gap_pct" in live_tier.LIVE_COLUMNS
    assert live_tier.columns_not_recomputed() == ("gap_pct",)

    with snapshot_db.connect() as conn:
        assert query._overlay(conn).col_expr("gap_pct").startswith("COALESCE(")


def test_the_TOTAL_is_counted_over_the_SAME_join_the_rows_came_from(served, monkeypatch):
    """`total` is the description's row count and the description now runs
    against the overlay too — so a filter that only the overlay satisfies is
    counted, not just displayed. Page size 1 makes the served rows a strict
    subset, so a total counted off the page could not pass."""
    spec = {"filters": [{"key": "chg_pct_1d", "op": "gte", "min": 1}], "page_size": 1}
    res = query.run_scan(spec)
    assert len(res["rows"]) == 1
    assert res["total"] == 2                    # CROSSER 6.4 + FADER 1.0

    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    assert query.run_scan(spec)["total"] == 1   # nightly: FADER 9.0 alone


# ═══ 8. the overlay must never be able to take the screen down ═══════════════

def test_an_ARMED_flag_against_a_database_with_no_overlay_table_serves_nightly(served):
    """A flag flip on a pod whose `screener.db` predates the overlay would
    otherwise raise `no such table` on EVERY member scan. The table's existence
    is read off `sqlite_master`, never assumed."""
    before, _ = _by_ticker()
    assert before["CROSSER"]["chg_pct_1d"] == 6.4       # control: it WAS serving

    with snapshot_db.connect() as conn:
        conn.execute(f"DROP TABLE {live_tier.LIVE_TABLE}")
        conn.commit()

    rows, res = _by_ticker()
    assert res["total"] == 3
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5
    assert res["snapshot"]["live"]["state"] == "nightly"


def test_a_tier_that_names_no_serve_predicate_refuses_to_JOIN(served, monkeypatch):
    """⛔ THE READ PATH NEVER COMPOSES A PREDICATE OF ITS OWN. A tier that cannot
    say when its overlay may be served does not get served — the honest
    direction — rather than the reader inventing a second answer to the one
    question the writer owns."""
    monkeypatch.setattr(live_tier, "serve_predicate_sql", lambda **kw: "")
    with snapshot_db.connect() as conn:
        overlay = query._overlay(conn)
    assert not overlay.on
    assert "serve predicate" in overlay.reason
    rows, _ = _by_ticker()
    assert rows["CROSSER"]["chg_pct_1d"] == 0.5


# ═══ 9. ⛔ THE SCAN EVALUATOR IS NOT OVERLAID ════════════════════════════════

def test_the_evaluators_scalars_stay_NIGHTLY_while_the_members_screen_is_LIVE(served):
    """⛔ A NIGHTLY `scan_hits` RECEIPT MUST NOT SILENTLY BECOME AN INTRADAY ONE.

    `scan_evaluator`'s `cadence_ceiling` is only true because every declared
    scalar is `cadence: nightly` out of `screener_rows` — that is what lets a
    scan swept at 05:00 be re-read at noon and return the same answer. It reads
    through `snapshot_db.get_rows`, which the overlay does not touch.

    Both reads, same database, same armed flag, one assertion apart — so this
    fails the moment somebody "helpfully" overlays the evaluator's reader too.
    """
    served_row = query.run_scan({"page_size": 50})["rows"][0]
    assert served_row["ticker"] == "CROSSER"
    assert served_row["chg_pct_1d"] == 6.4                      # the member's screen

    nightly = snapshot_db.get_rows(["CROSSER"])["CROSSER"]      # the evaluator's read
    assert nightly["chg_pct_1d"] == 0.5
    assert nightly["price"] == 100.0
    assert "live_row" not in nightly


#: ⛔ THE ONLY THINGS THE NIGHTLY SWEEP MAY TAKE FROM THE LIVE TIER: pure
#: rules, never readers. `sanity_reason` is a predicate over a quote and a
#: SYNTHESISED anchor; `SKIP_REASONS` is a vocabulary. Neither touches
#: `screener_live`.
#: ⛔ Do not add a name here to make a red go away. A column resolver or an
#: SQL helper re-opens exactly the hole the test below exists to close.
LIVE_TIER_PURE_REUSE = frozenset({"sanity_reason", "SKIP_REASONS"})


def _live_tier_attrs(tree):
    """Every `live_tier.<attr>` the module reaches for, read off the AST.

    ⚠ `from ... import live_tier` binds the MODULE, so the import statement
    alone cannot say what is used -- the attribute accesses can, and they are
    the question that matters.
    """
    return {n.attr for n in ast.walk(tree)
            if isinstance(n, ast.Attribute)
            and isinstance(n.value, ast.Name)
            and n.value.id == "live_tier"}


def test_the_live_tier_allow_list_BITES_IN_BOTH_DIRECTIONS():
    """⛔ A widening that cannot fail is an exemption wearing a rail's clothes.

    Proven against SYNTHETIC sources rather than by mutating a file another lane
    owns: the pure reuse passes, and a single column-resolving attribute fails.
    """
    allowed = ast.parse(
        "from api.services.screener import live_tier\n"
        "why = live_tier.sanity_reason(anchor, quote, ymd)\n"
        "REASONS = live_tier.SKIP_REASONS\n")
    assert _live_tier_attrs(allowed) <= LIVE_TIER_PURE_REUSE

    for forbidden in ("LIVE_COLUMNS", "col_expr", "LIVE_TABLE",
                      "live_columns_effective", "serve_predicate_sql"):
        src = ast.parse(
            "from api.services.screener import live_tier\n"
            "why = live_tier.sanity_reason(anchor, quote, ymd)\n"
            f"x = live_tier.{forbidden}\n")
        used = _live_tier_attrs(src)
        assert not (used <= LIVE_TIER_PURE_REUSE), forbidden


def test_the_evaluator_never_NAMES_the_overlay__BY_AST():
    """⛔ AN AST, NEVER A GREP (`lesson_probe_names_must_be_derived_not_typed`).

    The behavioural rail above proves today's reader is nightly. This one fails
    the day somebody imports the tier into the sweep, or hand-writes the overlay
    table into one of its statements — and the table name is READ OFF the
    writer, not typed here.
    """
    from api.services.screener import scan_evaluator

    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)

    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[-1] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.update(a.name for a in node.names)
            if node.module:
                imported.add(node.module.split(".")[-1])
    strings = {n.value for n in ast.walk(tree)
               if isinstance(n, ast.Constant) and isinstance(n.value, str)}

    # ⛔⛔ THE MODULE NAME WAS A PROXY; THE TABLE NAME IS THE REQUIREMENT.
    # This assertion used to read `"live_tier" not in imported`, and that is not
    # what the docstring above promises. It promises the sweep never READS THE
    # OVERLAY. Importing the tier to reuse a PURE PREDICATE reads nothing: the
    # sweep calls `live_tier.sanity_reason(anchor, quote, ymd)` with the anchor
    # SYNTHESISED from the bars, and reuses `live_tier.SKIP_REASONS` verbatim
    # rather than keeping a second copy of the vocabulary.
    #
    # Unwinding that reuse to satisfy a module-name check would create a SECOND
    # COPY OF THE SANITY RULES -- this repo's most repeated defect -- and a gate
    # added to `live_tier` would then silently NOT be honoured by the sweep.
    # That is strictly worse than the risk the name check stood in for.
    #
    # ⛔ SO THE WIDENING IS NARROW AND NAMED, NEVER A BLANKET EXEMPTION: the
    # allow-list is a SYMBOL list, and every other attribute of the tier -- the
    # column set, the SQL helpers, the table itself -- still fails here.
    # (Controller ruling on X19, 2026-08-26.)
    assert "query" not in imported, \
        "the sweep imported the SQL builder -- it must not compose overlay SQL"
    used = _live_tier_attrs(tree)
    assert used <= LIVE_TIER_PURE_REUSE, (
        "the sweep reached into the live tier for something other than a pure "
        f"rule: {sorted(used - LIVE_TIER_PURE_REUSE)}. Anything that resolves a "
        "COLUMN or composes SQL reads the overlay, which is the thing this rail "
        "exists to forbid -- reuse the rule, never the reader.")
    # ⭐ AND THE WIDENING ITSELF IS NOT VACUOUS: the sweep really does reach
    # the tier, so an allow-list that admitted nothing would be caught here.
    assert used, "no live_tier attribute used -- the allow-list proves nothing"
    assert not any(live_tier.LIVE_TABLE in s for s in strings), \
        f"scan_evaluator names {live_tier.LIVE_TABLE}"

    # ⭐ CONTROL — the probe can see what it is NOT complaining about. Without
    # this, an import walker that resolved nothing and a string scan that found
    # nothing would both read as a clean bill of health.
    assert "snapshot_db" in imported
    assert any("screener_rows" in s for s in strings)
