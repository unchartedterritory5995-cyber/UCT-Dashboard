import importlib


def _svc(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as adb
    importlib.reload(adb)
    adb.init_db()
    import api.services.screener.saved_screens as ss
    importlib.reload(ss)
    ss.init()
    return ss


def test_create_list_get_delete(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    spec = {"filters": [{"key": "rsi14", "op": "lte", "max": 30}], "view": "overview"}
    rec = ss.create(user_id="u7", name="Oversold", spec=spec)
    assert rec["id"] and rec["name"] == "Oversold"
    assert ss.list_for("u7")[0]["name"] == "Oversold"
    assert ss.get(rec["id"], "u7")["spec"]["view"] == "overview"
    assert ss.get(rec["id"], "other") is None       # not owner
    assert ss.delete(rec["id"], "u7") is True
    assert ss.list_for("u7") == []


def test_public_share(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    rec = ss.create("u7", "Shared", {"filters": [], "view": "overview"}, is_public=True)
    assert rec["share_token"]
    got = ss.get_public(rec["share_token"])
    assert got and got["name"] == "Shared"


def test_starters_present(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    assert len(ss.starters()) >= 3
    assert all("spec" in s for s in ss.starters())


# Operand each op carries, mirroring query.build_where's KeyError surface —
# a starter shipping {"op": "gte", "max": …} would 400 on the member path.
_OPERANDS = {"gte": ("min",), "gt": ("min",), "lte": ("max",), "lt": ("max",),
             "between": ("min", "max"), "eq": ("value",)}


def test_starters_are_valid_specs(tmp_path, monkeypatch):
    """Every starter is a runnable scan spec, derived from starters() ITSELF —
    a seventh starter added tomorrow is covered the day it lands.

    Checks: every filter key exists in filters.FILTERS · every op is valid for
    its control type · every op carries the operand build_where reads · bool
    filters assert presence (eq/1 — a flagship preset names a condition that
    HOLDS; flipping one to 0 is a deliberate rail edit) · every named view
    exists in filters.VIEWS · sort keys are real snapshot columns · ids are
    unique non-empty strings.
    """
    ss = _svc(tmp_path, monkeypatch)
    from api.services.screener import filters as scr_filters
    from api.services.screener import snapshot_db
    starters = ss.starters()
    ids = [s["id"] for s in starters]
    assert all(isinstance(i, str) and i for i in ids), ids
    assert len(ids) == len(set(ids)), f"duplicate starter ids: {ids}"
    sortable = set(snapshot_db.COLUMNS)
    for s in starters:
        spec = s["spec"]
        assert isinstance(s["name"], str) and s["name"], s["id"]
        assert spec["view"] in scr_filters.VIEWS, (s["id"], spec["view"])
        sort = spec.get("sort") or {}
        if sort:
            assert sort["key"] in sortable, (s["id"], sort["key"])
            assert sort["dir"] in ("asc", "desc"), (s["id"], sort["dir"])
        for f in spec["filters"]:
            entry = scr_filters.FILTERS.get(f["key"])
            assert entry is not None, (s["id"], f["key"])
            assert scr_filters.is_valid_op(f["key"], f["op"]), \
                (s["id"], f["key"], f["op"])
            for operand in _OPERANDS[f["op"]]:
                assert operand in f, (s["id"], f["key"], f["op"], operand)
            if entry["type"] == "bool":
                assert f["op"] == "eq" and f["value"] == 1, (s["id"], f["key"])


def test_the_six_flagship_presets_ship_as_starters(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    ids = {s["id"] for s in ss.starters()}
    assert {
        "starter_momentum_leaders",
        "starter_pullback_20ema",
        "starter_tight_base",
        "starter_gap_movers",
        "starter_52w_breakout",
        "starter_earnings_momentum",
    } <= ids, sorted(ids)


def test_flagship_unit_rulings_hold(tmp_path, monkeypatch):
    """The two §7 numbers that were unit-corrected, pinned BY RULING so nobody
    'fixes' them back to the spec's literals.

    - vol_nweek_low stores BAR COUNTS (20/15/10 = 4w/3w/2w volume low; writer
      setup_score.py, renderer columnDefs.js). Spec §7's literal ``>= 2`` would
      pass the whole universe; the ruling is ``gte 10`` — "2-week low or
      drier" (global-constraints.md).
    - dollar_vol_30d holds RAW DOLLARS — measured 2026-08-22 on the sandbox
      snapshot (MU: price 966.78 × avg_volume_30d 40,433,469.5 =
      39,090,269,643.21 = the stored value), corroborated by the filter's
      unit="$" and columnDefs' dollarVol formatter. $20M/$10M pin as 2e7/1e7.
    - Earnings Momentum's third criterion is ``optionable eq 1``. It shipped as
      ``implied_move_pct gte 0`` ("present" — SQL ``>= 0`` excludes NULL, which
      IS presence; controller ruling), and that clause made the preset return
      ZERO forever: see ``_KNOWN_EMPTY_IN_PROD`` below for the measurement.
    """
    ss = _svc(tmp_path, monkeypatch)
    by_id = {s["id"]: s["spec"] for s in ss.starters()}

    def _only(spec, key):
        matches = [f for f in spec["filters"] if f["key"] == key]
        assert len(matches) == 1, (key, matches)
        return matches[0]

    pullback = _only(by_id["starter_pullback_20ema"], "vol_nweek_low")
    assert pullback["op"] == "gte" and pullback["min"] == 10
    leaders = _only(by_id["starter_momentum_leaders"], "dollar_vol_30d")
    assert leaders["op"] == "gte" and leaders["min"] == 20_000_000
    breakout = _only(by_id["starter_52w_breakout"], "dollar_vol_30d")
    assert breakout["op"] == "gte" and breakout["min"] == 10_000_000
    earnings = _only(by_id["starter_earnings_momentum"], "optionable")
    assert earnings["op"] == "eq" and earnings["value"] == 1


# ⛔ COLUMNS THAT ARE NON-NULL ON **ZERO** PROD ROWS. A starter filtering one of
# these is a screen that returns nothing FOREVER, and no validity test above can
# see it: the key exists in FILTERS, the op is legal for its control type, the
# view resolves, the sort column is real, and the AST starter citing it grounds
# cleanly. Every gate is green and the member gets an empty table.
#
# ⭐ EACH ENTRY CARRIES ITS REASON AND THE DATE IT WAS MEASURED, because "empty
# today" and "empty by construction" are different facts and only the second one
# is permanent. Re-measure before treating an entry as either dead or healed —
# and DELETE an entry once its column fills, rather than leaving a stale ban that
# blocks a working criterion.
_KNOWN_EMPTY_IN_PROD = {
    "implied_move_pct": (
        "non-null on 0 of 3,745 prod rows, measured 2026-08-23. `earnings_context`"
        " reads `implied_store`, which captures the pre-report straddle only the"
        " night before a report (first-write-wins per (sym, report_date)), so"
        " coverage is inherently sparse and was zero on that Sunday build."
        " `IMPLIED_STORE_ENABLED` IS set in prod — whether a weekday build carries"
        " a handful of rows is UNMEASURED. Re-measure on a weekday before treating"
        " this as permanent."
    ),
    "earnings_setup_grade": (
        "non-null on 0 of 3,745 prod rows, measured 2026-08-23. A SEPARATE source"
        " from implied move — `earnings_context._latest_grades` — so do not"
        " conflate the two when one of them fills."
    ),
}


def _starters_filtering_an_empty_column(starters, registry):
    """The rail's one decision, shared by the real check and its control.

    Returns ``[(starter_id, key, column), …]`` for every filter whose registry
    COLUMN (not merely its key — the two can differ) is in the ban list.
    """
    hits = []
    for s in starters:
        for f in s["spec"]["filters"]:
            entry = registry.get(f["key"]) or {}
            column = entry.get("column", f["key"])
            if column in _KNOWN_EMPTY_IN_PROD:
                hits.append((s["id"], f["key"], column))
    return hits


def test_no_starter_filters_a_column_that_is_empty_in_prod(tmp_path, monkeypatch):
    """A starter may not filter on a column that holds no values.

    ⭐ THIS IS THE TOOTH FOR A CLASS NO VALIDITY TEST CAN SEE. "Earnings
    Momentum" shipped filtering `implied_move_pct >= 0` and returned 0 rows on
    every prod run from the day it landed; its other two criteria alone yield 38
    names. Nothing above went red, because nothing above asks whether the column
    can answer. Only RUNNING all ten starters against prod found it.
    """
    ss = _svc(tmp_path, monkeypatch)
    from api.services.screener import filters as scr_filters
    hits = _starters_filtering_an_empty_column(ss.starters(), scr_filters.FILTERS)
    assert not hits, (
        "these starters filter on a column that is non-null on ZERO prod rows, so "
        "they return nothing forever: "
        + "; ".join(
            f"{sid} filters {key!r} -> {col} ({_KNOWN_EMPTY_IN_PROD[col]})"
            for sid, key, col in hits))


def test_the_empty_column_rail_can_fail(tmp_path, monkeypatch):
    """NON-VACUITY CONTROL — the rail above passes because the starters are
    clean, not because it looks at nothing.

    Feeds the SAME decision function a starter that filters a banned column and
    proves it is reported. Delete the ban list, stop reading `column`, or return
    an empty list from the helper, and this goes red.
    """
    from api.services.screener import filters as scr_filters
    seeded = sorted(_KNOWN_EMPTY_IN_PROD)
    assert seeded, "the ban list is empty, so the rail above cannot fail"
    # Every seeded column, not just the first — a ban nobody has seen fire is
    # not a ban. (The helper reads `key`, so no `op` is needed to exercise it.)
    for banned in seeded:
        fake = [{"id": "starter_control", "name": "Control",
                 "spec": {"filters": [{"key": banned}], "view": "events"}}]
        assert _starters_filtering_an_empty_column(fake, scr_filters.FILTERS) == [
            ("starter_control", banned, banned)], banned
    # …and a starter on a column that DOES carry values is not flagged, so the
    # helper is not simply reporting everything.
    ok = [{"id": "starter_control_ok", "name": "Control",
           "spec": {"filters": [{"key": "rs_rank", "op": "gte", "min": 70}],
                    "view": "technical"}}]
    assert _starters_filtering_an_empty_column(ok, scr_filters.FILTERS) == []
