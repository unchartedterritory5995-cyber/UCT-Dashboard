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
    - implied_move_pct "present" = ``gte 0`` — SQL ``>= 0`` excludes NULL,
      which IS presence; no new operator this wave (controller ruling).
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
    earnings = _only(by_id["starter_earnings_momentum"], "implied_move_pct")
    assert earnings["op"] == "gte" and earnings["min"] == 0
