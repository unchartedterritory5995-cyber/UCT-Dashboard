"""The advance/decline COUNTS backfill — and the gate that decides what may land.

`breadth_collector.py` computed `adv` and `dec` and stored only `adv - dec`.
Every historical row therefore has `adv_decline` and NEITHER count, the
Monitor's two count columns have always been blank, and the Event Ledger's
Zweig Breadth Thrust refuses outright:

    Advance/decline counts cover 0 of 90 sessions — needs 11

There is no stored `advancing` to validate a recomputation against — that is
the whole problem. So the oracle is the field that WAS collected:
`advancing - declining == adv_decline` is exact arithmetic on the same closes
over the same universe, and it is independent of everything the backfill does.

⭐ THAT IDENTITY IS A PER-ROW PRECONDITION OF EVERY WRITE, not a campaign that
ran once. These rails exist to prove it can REFUSE — a gate nobody has watched
fail is not a gate — and that a passing write touches exactly two keys.

Measured 2026-08-30, which is why the gate matters: the collector's own cached
price frames reproduce `adv_decline` on 91 of 98 graded sessions, and a bars.db
recompute reproduces it on 0 of 96 (median |diff| 8.5, and still 0 of 61 at
>=99% bars coverage). The bars gap is COVERAGE, not basis: bars.db cannot price
0.3-22% of each session's point-in-time universe and the missing names are
distributed like the day, so a count comes back scaled — a proportional error,
against an exact integer identity with no tolerance to spend. Both sources go
through this same gate; only one of them gets to write.

Restated rows — a row the collector's `--backfill` recomputed from a LATER day's
frame — are the seventh case, and they live in
`tests/test_breadth_adv_dec_restated.py`.
"""
import json
import re
import sqlite3
from pathlib import Path

import pytest

from api.services import breadth_history_recon as r
from api.services import breadth_monitor as bm

JS = (Path(__file__).resolve().parents[1]
      / "app" / "src" / "pages" / "breadth" / "views" / "breadthEvents.js")


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db = tmp_path / "breadth.db"
    monkeypatch.setattr(bm, "_db_path", lambda: str(db))
    from api.services.cache import cache
    cache.clear()
    bm.init_db()
    yield db
    cache.clear()


def _seed(rows):
    """rows: {date: metrics-dict}. Written straight to the table, exactly as the
    collector left them — no counts, an `adv_decline`, and neighbours that must
    survive the backfill untouched."""
    with sqlite3.connect(bm._db_path()) as c:
        for d, m in rows.items():
            c.execute("INSERT OR REPLACE INTO breadth_snapshots (date, metrics) "
                      "VALUES (?, ?)", (d, json.dumps(m)))
        c.commit()


def _collector_row(i, adv, dec):
    """A stored row shaped like the collector's: `adv_decline` present, the two
    counts absent, plus a spread of other metrics that must not move."""
    return {
        "adv_decline": adv - dec,
        "universe_count": adv + dec + 40,
        "pct_above_50sma": round(30 + i * 1.7, 1),
        "up_4pct_today": 40 + i,
        "down_4pct_today": 20 + i,
        "new_52w_highs": 30 + i,
        "new_52w_lows": 5 + i,
        "cboe_putcall": round(0.70 + i / 100, 2),
        "qqq_close": 400 + i,
        "spy_close": 500 + i,
        "stage2_count": 900 + i,
        "vix": round(15 + i / 10, 2),
    }


def _raw(date):
    with sqlite3.connect(bm._db_path()) as c:
        row = c.execute("SELECT metrics FROM breadth_snapshots WHERE date = ?",
                        (date,)).fetchone()
    return json.loads(row[0]) if row else None


def _session(i):
    return f"2026-06-{i + 1:02d}"


def _twelve():
    """Twelve collected sessions with varying, non-degenerate counts — one more
    than Zweig's floor, so the backfill visibly crosses it."""
    truth = {_session(i): (1200 + i * 37, 1400 - i * 29) for i in range(12)}
    _seed({d: _collector_row(i, a, dd)
           for i, (d, (a, dd)) in enumerate(sorted(truth.items()))})
    return truth


# ── the constants are the JS file's, not a second copy ──────────────────────

def _js_const(name):
    m = re.search(rf"^const\s+{name}\s*=\s*([0-9.]+)\s*$", JS.read_text(encoding="utf-8"),
                  re.M)
    return None if m is None else float(m.group(1))


def test_the_zweig_constants_are_read_back_out_of_the_lens_that_uses_them():
    """A Python mirror of a JS threshold is a second authority over one value —
    this repo's most repeated defect. So derive it: the number the refusal
    sentence prints must be the number this module gates on."""
    assert _js_const("ZWEIG_PERIOD") == r.ZWEIG_PERIOD
    assert r.ZWEIG_MIN_SESSIONS == r.ZWEIG_PERIOD + 1
    # the refusal sentence itself is built from PERIOD + 1
    assert "ZWEIG_PERIOD + 1" in JS.read_text(encoding="utf-8")


def test_the_constant_reader_can_return_nothing():
    """Non-vacuity control: if `_js_const` silently answered None for everything,
    the rail above would pass on a file that had lost the constant entirely."""
    assert _js_const("NOT_A_CONSTANT_IN_THAT_FILE") is None


# ── coverage arithmetic mirrors scanEvents ──────────────────────────────────

def test_coverage_counts_only_sessions_with_both_counts_and_a_nonzero_sum():
    rows = [
        {"advancing": 1500, "declining": 1100},   # counts
        {"advancing": 1500, "declining": None},   # half a pair is not a reading
        {"advancing": None, "declining": 1100},
        {},                                        # a collector-era row
        {"advancing": 0, "declining": 0},          # a+d == 0 -> no ratio in the JS
        {"advancing": 0, "declining": 900},        # a real zero-advancer session
    ]
    assert r.zweig_ad_coverage(rows) == 2


def test_coverage_is_a_count_of_measurable_sessions_not_a_consecutive_run():
    """`scanEvents` filters nulls out of the ratio array; the EMA skips them
    without resetting. A gap in the middle must not reduce the count."""
    rows = [{"advancing": 10, "declining": 5} for _ in range(6)]
    rows.insert(3, {})
    assert r.zweig_ad_coverage(rows) == 6


# ── the gate ────────────────────────────────────────────────────────────────

def test_a_pair_that_reproduces_the_stored_adv_decline_is_written():
    truth = _twelve()
    rep = r.apply_adv_dec_counts({d: p for d, p in truth.items()}, dry_run=False)
    assert rep["n_written"] == 12, rep
    assert rep["n_refused_identity"] == 0
    for d, (adv, dec) in truth.items():
        row = _raw(d)
        assert row["advancing"] == adv
        assert row["declining"] == dec


@pytest.mark.parametrize("bump_adv,bump_dec", [(1, 0), (0, 1), (-3, 0), (0, -7), (5, 5)])
def test_the_gate_refuses_a_pair_that_does_not_reproduce_adv_decline(bump_adv, bump_dec):
    """⭐ THE MUTATION CONTROL, perturbed ONE side at a time (and once on both,
    where the identity survives — see the next rail). A pair off by a single
    advancer must not land, because `advancing - declining` and `adv_decline`
    would then say two different things about one session."""
    truth = _twelve()
    d0 = sorted(truth)[0]
    adv, dec = truth[d0]
    bad = {d0: (adv + bump_adv, dec + bump_dec)}
    rep = r.apply_adv_dec_counts(bad, dry_run=False)
    if bump_adv == bump_dec:
        # a shift that cancels in the difference is invisible to this oracle,
        # and the rail says so out loud rather than pretending otherwise
        assert rep["n_written"] == 1
    else:
        assert rep["n_written"] == 0, rep
        assert rep["n_refused_identity"] == 1
        bad_row = rep["refused_identity"][0]
        assert bad_row["date"] == d0
        assert bad_row["diff"] == bump_adv - bump_dec
        stored = _raw(d0)
        assert "advancing" not in stored and "declining" not in stored


def test_the_oracle_cannot_see_a_shift_that_cancels_in_the_difference():
    """Stated as its own rail so the limit is documented where it is measured,
    not assumed away: `adv_decline` constrains the DIFFERENCE, so +5/+5 passes.
    That is why the source still has to be the collector's own frame rather
    than anything that merely satisfies the identity."""
    truth = _twelve()
    d0 = sorted(truth)[0]
    adv, dec = truth[d0]
    rep = r.apply_adv_dec_counts({d0: (adv + 5, dec + 5)}, dry_run=False)
    assert rep["n_written"] == 1
    assert _raw(d0)["advancing"] == adv + 5


def test_a_write_touches_only_the_two_count_keys():
    """`adv_decline` and every other collected metric stay exactly as the
    collector left them — compared key by key, including the one the gate read."""
    truth = _twelve()
    before = {d: _raw(d) for d in truth}
    r.apply_adv_dec_counts(truth, dry_run=False)
    for d in truth:
        after = _raw(d)
        assert set(after) - set(before[d]) == {"advancing", "declining"}
        for k, v in before[d].items():
            assert after[k] == v, f"{d}.{k} moved: {v!r} -> {after[k]!r}"


def test_it_is_idempotent_and_never_overwrites_a_collected_count():
    truth = _twelve()
    first = r.apply_adv_dec_counts(truth, dry_run=False)
    assert first["n_written"] == 12
    second = r.apply_adv_dec_counts(truth, dry_run=False)
    assert second["n_written"] == 0
    assert second["n_already_present"] == 12
    # and a later run offering DIFFERENT numbers still cannot overwrite
    d0 = sorted(truth)[0]
    adv, dec = truth[d0]
    third = r.apply_adv_dec_counts({d0: (adv + 100, dec + 100)}, dry_run=False)
    assert third["n_written"] == 0
    assert _raw(d0)["advancing"] == adv


def test_a_dry_run_writes_nothing_and_reports_what_would_land():
    truth = _twelve()
    rep = r.apply_adv_dec_counts(truth, dry_run=True)
    assert rep["dry_run"] is True
    assert rep["n_written"] == 12          # the report says what WOULD land
    for d in truth:
        row = _raw(d)
        assert "advancing" not in row and "declining" not in row


def test_a_dry_run_does_not_drop_the_history_cache():
    """"Writes nothing" includes side effects. A dry run that cleared the cache
    would make every caller pay a cold ~28s history fetch to answer a question
    it did not change the answer to."""
    from api.services.cache import cache
    _twelve()
    bm.get_history(90)
    assert cache.get("breadth_history_90") is not None
    r.apply_adv_dec_counts({}, dry_run=True)
    assert cache.get("breadth_history_90") is not None


def test_a_real_write_invalidates_the_cached_history():
    """`get_history` caches 5 minutes per `days`. Without the drop the Views tab
    would keep serving the pre-backfill rows and the lens would keep refusing
    for five more minutes after the fix landed."""
    from api.services.cache import cache
    truth = _twelve()
    stale = bm.get_history(90)
    assert all(row.get("advancing") is None for row in stale)
    assert cache.get("breadth_history_90") is stale       # warm, and it is the OLD rows

    rep = r.apply_adv_dec_counts(truth, dry_run=False)

    # ⭐ The discriminating read: the report's own `coverage_after` is taken
    # THROUGH `get_history`, so if the drop were removed it would be served the
    # stale rows and report 0 covered — the number this whole exercise is about.
    assert rep["coverage_after"]["covered"] == 12
    assert cache.get("breadth_history_90") is not stale
    assert all(row.get("advancing") is not None for row in bm.get_history(90))


# ── the shapes it must refuse rather than guess at ──────────────────────────

def test_it_refuses_a_date_with_no_stored_row():
    _twelve()
    rep = r.apply_adv_dec_counts({"2031-01-02": (10, 5)}, dry_run=False)
    assert rep["n_written"] == 0 and rep["refused_no_row"] == ["2031-01-02"]


def test_it_refuses_a_row_with_no_stored_adv_decline_to_check_against():
    _seed({"2026-07-01": {"universe_count": 2700}})
    rep = r.apply_adv_dec_counts({"2026-07-01": (10, 5)}, dry_run=False)
    assert rep["n_written"] == 0
    assert rep["refused_no_adv_decline"] == ["2026-07-01"]


@pytest.mark.parametrize("bad", [None, "1500", (1500,), {"advancing": 1500},
                                 (1500.5, 1100), (-1, 0), (1500, None)])
def test_it_refuses_a_malformed_pair(bad):
    truth = _twelve()
    d0 = sorted(truth)[0]
    rep = r.apply_adv_dec_counts({d0: bad}, dry_run=False)
    assert rep["n_written"] == 0 and rep["refused_malformed"] == [d0]


def test_a_half_written_row_is_surfaced_rather_than_healed():
    """One count without the other should be impossible; if it exists, something
    else has written here and that is worth saying rather than papering over."""
    truth = _twelve()
    d0 = sorted(truth)[0]
    bm.patch_field(d0, "advancing", 999)
    rep = r.apply_adv_dec_counts({d0: truth[d0]}, dry_run=False)
    assert rep["n_written"] == 0 and rep["partial_present"] == [d0]
    assert _raw(d0)["advancing"] == 999


# ── the end the whole exercise exists for ───────────────────────────────────

def test_the_backfill_takes_zweig_from_refusing_to_evaluating():
    """`scanEvents`' own arithmetic, over the rows the store actually holds:
    before, coverage is 0 and the lens prints its refusal; after, it clears the
    11-session floor."""
    truth = _twelve()
    before = r.adv_dec_status(90)
    assert before["covered"] == 0
    assert before["zweig_ok"] is False
    assert before["backfillable"] == 12

    r.apply_adv_dec_counts(truth, dry_run=False)

    after = r.adv_dec_status(90)
    assert after["covered"] == 12
    assert after["covered"] >= r.ZWEIG_MIN_SESSIONS
    assert after["zweig_ok"] is True
    # and the count the status reports is the lens's own, off the same rows
    assert after["covered"] == r.zweig_ad_coverage(bm.get_history(90))


def test_ten_backfilled_sessions_are_still_one_short():
    """The floor is load-bearing, so prove it discriminates: one fewer session
    and the lens still refuses. A status that answered `zweig_ok` for any
    non-zero coverage would pass the rail above and be wrong here."""
    truth = _twelve()
    ten = dict(sorted(truth.items())[:10])
    r.apply_adv_dec_counts(ten, dry_run=False)
    st = r.adv_dec_status(90)
    assert st["covered"] == 10
    assert st["zweig_ok"] is False


# ── the wire ────────────────────────────────────────────────────────────────

def test_the_owner_facing_routes_are_actually_mounted():
    """A backfill nobody can trigger is the "built, tested, green and
    unreachable" shape this repo keeps paying for. Read the router's own route
    table, not a grep of the source."""
    from api.routers import breadth_monitor as router_mod
    paths = {r.path for r in router_mod.router.routes}
    for p in ("/api/breadth-monitor/history/adv-dec-coverage",
              "/api/breadth-monitor/history/adv-dec-validate",
              "/api/breadth-monitor/history/adv-dec-apply",
              "/api/breadth-monitor/history/adv-dec-backfill-recon"):
        assert p in paths, f"{p} is not mounted"
    # control: the probe can tell a mounted route from an invented one
    assert "/api/breadth-monitor/history/adv-dec-not-a-route" not in paths


def test_the_apply_route_defaults_to_a_dry_run():
    """The writing endpoint's default must be the harmless one — a bare POST
    from a shell history should measure, not mutate."""
    from api.routers import breadth_monitor as router_mod
    route = next(r for r in router_mod.router.routes
                 if r.path == "/api/breadth-monitor/history/adv-dec-apply")
    import inspect
    dry = inspect.signature(route.endpoint).parameters["dry_run"].default
    assert getattr(dry, "default", dry) is True


# ── the write primitive ─────────────────────────────────────────────────────

def test_patch_fields_lands_both_keys_in_one_transaction():
    _seed({"2026-07-01": {"adv_decline": 7, "vix": 15.0}})
    assert bm.patch_fields("2026-07-01", {"advancing": 100, "declining": 93}) is True
    row = _raw("2026-07-01")
    assert (row["advancing"], row["declining"], row["adv_decline"], row["vix"]) \
        == (100, 93, 7, 15.0)


def test_patch_field_is_patch_fields_with_one_key():
    """One implementation of the read-modify-write, so the two can never drift."""
    _seed({"2026-07-01": {"adv_decline": 7}})
    assert bm.patch_field("2026-07-01", "manual_ftd", True) is True
    assert _raw("2026-07-01")["manual_ftd"] is True
    assert bm.patch_fields("2031-01-01", {"advancing": 1}) is False
    assert bm.patch_fields("2026-07-01", {}) is False
