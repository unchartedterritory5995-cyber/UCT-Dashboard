"""analyst_pass job: actives() (union + coalesce + a dead leg costs only its
own members), tail rotation (whole tail covered, no overlap, across 7
consecutive day-indices), and run_pass (deadline-bounded, stalest-first,
receipt arithmetic closes). Every seam is monkeypatched; the clock is
frozen via ap._now_et — no real FMP calls, no real sleeping, no real
wall-clock dependency."""
import datetime

import api.services.screener.analyst_pass as ap


def _use_tmp_db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "analyst.db"))
    monkeypatch.setenv("SCREENER_ANALYST_GAP_SECONDS", "0")   # no real sleeping
    ap.init_db()


# ── actives() ────────────────────────────────────────────────────────────

class _FakeConn:
    """A tiny stand-in for sqlite3.Connection: .execute() returns whatever
    rows it was built with; .close() is a no-op so contextlib.closing is
    happy either way."""
    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql, *params):
        return self._rows

    def close(self):
        pass


def test_actives_unions_coalesces_and_intersects_the_universe(monkeypatch):
    import api.services.auth_db as auth_db_mod
    import api.services.engine as engine_mod

    monkeypatch.setattr(
        auth_db_mod, "get_connection",
        lambda: _FakeConn([{"sym": "AAA"}, {"sym": "ZZZ"}]))  # ZZZ is off-universe
    monkeypatch.setattr(
        engine_mod, "get_leadership",
        lambda: [{"ticker": "BBB"}, {"sym": "CCC"}, {"symbol": "DDD"}])  # coalesce
    monkeypatch.setattr(
        engine_mod, "get_candidates", lambda: {
            "candidates": {
                "pullback_ma": [{"ticker": "EEE"}],
                "gapper_news": [{"sym": "FFF"}],
                "remount": [{"symbol": "GGG"}],
            }})
    monkeypatch.setattr(ap, "_actives_top_dollar_vol", lambda failures=None: {"HHH"})
    monkeypatch.setattr(
        ap, "_cap_universe",
        lambda: {"AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III"})

    out = ap.actives()
    assert out == {"AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"}
    assert "ZZZ" not in out   # outside the cap universe
    assert "III" not in out  # in the universe, but no leg surfaced it


def test_actives_a_dead_leg_costs_only_its_own_members_and_is_counted(monkeypatch):
    import api.services.auth_db as auth_db_mod
    import api.services.engine as engine_mod

    def boom():
        raise RuntimeError("watchlists unreachable")
    monkeypatch.setattr(auth_db_mod, "get_connection", boom)
    monkeypatch.setattr(engine_mod, "get_leadership", lambda: [{"ticker": "BBB"}])
    monkeypatch.setattr(engine_mod, "get_candidates", lambda: {"candidates": {}})
    monkeypatch.setattr(ap, "_actives_top_dollar_vol", lambda failures=None: set())
    monkeypatch.setattr(ap, "_cap_universe", lambda: {"AAA", "BBB"})

    fails = {}
    out = ap.actives(failures=fails)
    assert out == {"BBB"}                 # only the dead leg's members are missing
    assert "watchlists" in fails
    assert "RuntimeError" in fails["watchlists"]


def test_actives_survives_a_missing_universe_without_zeroing_out(monkeypatch):
    import api.services.auth_db as auth_db_mod
    import api.services.engine as engine_mod

    monkeypatch.setattr(auth_db_mod, "get_connection",
                        lambda: _FakeConn([{"sym": "AAA"}]))
    monkeypatch.setattr(engine_mod, "get_leadership", lambda: [])
    monkeypatch.setattr(engine_mod, "get_candidates", lambda: {"candidates": {}})
    monkeypatch.setattr(ap, "_actives_top_dollar_vol", lambda failures=None: set())
    monkeypatch.setattr(ap, "_cap_universe", lambda: set())   # universe failed to load

    out = ap.actives()
    assert out == {"AAA"}    # union survives unfiltered rather than being emptied


# ── tail rotation ───────────────────────────────────────────────────────

def test_tail_rotation_covers_the_whole_tail_with_no_overlap_across_7_nights():
    tail = sorted(f"T{i:03d}" for i in range(70))
    slices = [set(ap._tail_slice(tail, day_index)) for day_index in range(7)]
    union = set().union(*slices)
    assert union == set(tail)
    for a in range(7):
        for b in range(a + 1, 7):
            assert slices[a].isdisjoint(slices[b])


def test_tail_rotation_is_stable_across_a_repeated_day_index():
    tail = sorted(f"T{i:03d}" for i in range(23))
    assert ap._tail_slice(tail, 3) == ap._tail_slice(tail, 3)
    assert ap._tail_slice(tail, 3) == ap._tail_slice(tail, 3 + 7)  # same weekday


# ── run_pass ─────────────────────────────────────────────────────────────

def test_run_pass_stops_at_the_deadline_and_the_receipt_closes(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    started = datetime.datetime(2026, 8, 22, 2, 0, tzinfo=ap._ET)
    deadline = ap._deadline_et(started)

    monkeypatch.setattr(ap, "actives", lambda failures=None: {"AAA", "BBB", "CCC"})
    monkeypatch.setattr(ap, "_cap_universe", lambda: {"AAA", "BBB", "CCC"})  # no tail

    # Seed staleness so the stalest-first order is AAA (never fetched),
    # CCC (oldest), BBB (most recent) — not merely alphabetical.
    row = {"consensus": "Buy", "pt_target": None, "upgrades_30d": None,
           "downgrades_30d": None, "eps_next_y_growth": None}
    ap.upsert("CCC", row, now=started.timestamp() - 5 * 86400)
    ap.upsert("BBB", row, now=started.timestamp() - 1 * 86400)

    calls = {"n": 0}

    def fake_now_et():
        calls["n"] += 1
        # First two between-ticker checks land before the deadline; the
        # third (BBB, the last stalest-ordered target) lands after it.
        return started if calls["n"] <= 2 else deadline + datetime.timedelta(minutes=1)
    monkeypatch.setattr(ap, "_now_et", fake_now_et)

    fetched_order = []

    def fake_fetch_one(ticker):
        fetched_order.append(ticker)
        return {"consensus": "Buy", "pt_target": 100.0, "upgrades_30d": 0,
                "downgrades_30d": 0, "eps_next_y_growth": None}
    monkeypatch.setattr(ap, "fetch_one", fake_fetch_one)

    receipt = ap.run_pass(now=started)

    assert fetched_order == ["AAA", "CCC"]     # stalest-first order observed
    assert receipt["fetched"] == 2
    assert receipt["errors"] == 0
    assert receipt["budget_stop"] == 1          # BBB never started
    assert receipt["actives"] == 3
    assert receipt["tail_slice"] == 0
    assert receipt["fetched"] + receipt["errors"] + receipt["budget_stop"] == 3

    # BBB's pre-seeded row is untouched — it was never started, not merely
    # fetched-and-failed.
    stored = ap.read_analyst_fields(["BBB"])
    assert stored["BBB"]["pt_target"] is None

    # AAA/CCC did get freshly upserted.
    fresh = ap.read_analyst_fields(["AAA", "CCC"])
    assert fresh["AAA"]["pt_target"] == 100.0
    assert fresh["CCC"]["pt_target"] == 100.0


def test_run_pass_counts_a_failed_fetch_as_error_not_budget_stop(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    started = datetime.datetime(2026, 8, 22, 2, 0, tzinfo=ap._ET)

    monkeypatch.setattr(ap, "actives", lambda failures=None: {"AAA", "BBB"})
    monkeypatch.setattr(ap, "_cap_universe", lambda: {"AAA", "BBB"})
    monkeypatch.setattr(ap, "_now_et", lambda: started)   # always well before deadline

    def fake_fetch_one(ticker):
        return None if ticker == "BBB" else {
            "consensus": "Buy", "pt_target": None, "upgrades_30d": None,
            "downgrades_30d": None, "eps_next_y_growth": None}
    monkeypatch.setattr(ap, "fetch_one", fake_fetch_one)

    receipt = ap.run_pass(now=started)
    assert receipt["fetched"] == 1
    assert receipt["errors"] == 1
    assert receipt["budget_stop"] == 0
    assert receipt["fetched"] + receipt["errors"] + receipt["budget_stop"] == 2


def test_run_pass_targets_actives_plus_tonights_tail_slice(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    started = datetime.datetime(2026, 8, 22, 2, 0, tzinfo=ap._ET)

    monkeypatch.setattr(ap, "actives", lambda failures=None: {"AAA"})
    monkeypatch.setattr(ap, "_cap_universe", lambda: {"AAA", "TAIL1", "TAIL2"})
    monkeypatch.setattr(ap, "_now_et", lambda: started)   # never trips the deadline

    seen = []

    def fake_fetch_one(ticker):
        seen.append(ticker)
        return {"consensus": None, "pt_target": None, "upgrades_30d": None,
                "downgrades_30d": None, "eps_next_y_growth": None}
    monkeypatch.setattr(ap, "fetch_one", fake_fetch_one)

    receipt = ap.run_pass(now=started)
    # AAA (active) plus whatever this day's tail slice picked from {TAIL1, TAIL2}
    assert "AAA" in seen
    assert receipt["actives"] == 1
    assert receipt["tail_slice"] == len(seen) - 1
    assert receipt["fetched"] == len(seen)


def test_run_pass_writes_one_analyst_runs_receipt_row(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    started = datetime.datetime(2026, 8, 22, 2, 0, tzinfo=ap._ET)
    monkeypatch.setattr(ap, "actives", lambda failures=None: set())
    monkeypatch.setattr(ap, "_cap_universe", lambda: set())
    monkeypatch.setattr(ap, "_now_et", lambda: started)

    ap.run_pass(now=started)

    import contextlib
    with contextlib.closing(ap.connect()) as conn:
        rows = conn.execute("SELECT * FROM analyst_runs").fetchall()
    assert len(rows) == 1
    assert rows[0]["actives"] == 0


def test_deadline_et_is_0445_on_the_given_days_date():
    day = datetime.datetime(2026, 8, 22, 13, 30, tzinfo=ap._ET)
    d = ap._deadline_et(day)
    assert (d.hour, d.minute) == (4, 45)
    assert d.date() == day.date()


def test_enabled_defaults_off(monkeypatch):
    monkeypatch.delenv("SCREENER_ANALYST_PASS_ENABLED", raising=False)
    assert ap.enabled() is False
    monkeypatch.setenv("SCREENER_ANALYST_PASS_ENABLED", "1")
    assert ap.enabled() is True
