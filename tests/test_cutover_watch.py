"""The cutover instrument's own tests -- including the ones that prove it can REFUSE.

`tools/cutover_watch.py` is the thing that authorises a production behaviour
change, so it gets the treatment the thing it authorises would get. Four
assertions here are not what a normal test file would carry:

  * EVERY NO-GO BRANCH IS FORCED AND THE EXIT CODE IS READ
    (`test_every_nogo_branch_fires_and_the_exit_code_follows`), plus TWO GREEN
    CONTROLS -- because nine cases that all expect exit 1 are also passed by a
    tool that returns 1 unconditionally. A verdict function that has never
    returned NO-GO is decoration.
  * THE RTH FILTER IS PROVED TO FILTER
    (`test_after_hours_only_rows_are_never_counted_as_rth`). Today's 8,130
    shadow rows were all recorded after 16:52 ET and a naive total made the soak
    look well-exercised; if the filter stops filtering, this file goes red.
  * `deliverable_now` IS PROVED TO COME FROM THE CLOCK AND NOT FROM THE STATE
    STRING (`test_deliverable_now_reads_the_clock_not_the_state_column`), driven
    by the exact live shape that made `--verify` report 0 while the window was
    already closed.
  * A ZERO IS PROVED TO CARRY ITS DENOMINATOR
    (`test_a_zero_disagreement_count_can_never_read_as_go_on_its_own`): with the
    bar fetch dead, the disagreement counts are 0 and the verdict is still
    NO-GO, because "the lanes agree" and "nothing was evaluated" must not print
    the same thing.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import pathlib
import sqlite3
import sys
import time
from datetime import datetime, timedelta

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import cutover_watch as cw  # noqa: E402
from api.services import alert_shadow_log as shadow  # noqa: E402
from api.services import indicator_alert_evaluator as ev  # noqa: E402
from api.services import indicator_alert_service as ias  # noqa: E402
from api.services import indicator_compute as ic  # noqa: E402


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture()
def store(tmp_path):
    """A real auth.db + alert_shadow.db, built by the MODULES' OWN writers."""
    with cw.Fixture(str(tmp_path)) as fx:
        yield fx


def _bars(n=300, **kw):
    return cw.synthetic_bars(n, **kw)


def _et(hour, minute, days_ago=1):
    return cw.et_instant(ic._et_zone(), days_ago=days_ago, hour=hour,
                         minute=minute)


def _run(fx, bars=None, **kw):
    """Build a report against the fixture with a deterministic bar provider."""
    return cw.build_report(fx.auth, fx.shadow,
                           bars_provider=cw._provider(_bars() if bars is None
                                                      else bars), **kw)


# ─── the names are derived, never typed ──────────────────────────────────────

def test_table_names_are_read_out_of_each_modules_own_schema():
    """Five false alarms in one session came from a typed identifier.

    The point is not that the answers are `indicator_alerts` and
    `alert_shadow_fires` -- it is that they FOLLOW the module. The second half
    proves the derivation is real by feeding it a different schema.
    """
    assert cw.table_from_module_schema(ias._SCHEMA) == "indicator_alerts"
    assert cw.table_from_module_schema(shadow._SCHEMA) == "alert_shadow_fires"
    # ⭐ THE CONTROL: if this were a typed constant wearing a function's name,
    # the derivation would ignore its input and this would still say
    # `alert_shadow_fires`.
    assert cw.table_from_module_schema(
        "CREATE TABLE IF NOT EXISTS renamed_by_a_migration (id INTEGER)"
    ) == "renamed_by_a_migration"


def test_the_alert_column_list_is_the_services_own(store):
    assert cw.module_alert_columns() == [
        c.strip() for c in ias._COLS.split(",") if c.strip()]
    assert "active" in cw.module_alert_columns()
    # The column that a production probe once typed as `is_active`, reaching the
    # right answer (zero rows) for entirely the wrong reason.
    assert "is_active" not in cw.module_alert_columns()


def test_read_active_alerts_equals_the_shipped_list_active(store):
    """An EQUALITY against the accessor, not a re-implementation of it.

    `list_active()` is what the evaluator, the shadow lane and the soak matrix
    all read. If this tool answered "what is armed" its own way there would be
    two answers to one question, which is how `deliverable_now` came to mean
    something different in two files.
    """
    store.arm("rsi", "above", 50.0)
    store.arm("macd", "above", 0.0, snooze_minutes=None)
    store.arm("close", "below", 10.0, sym="QQQ", tf="D")
    assert cw.read_active_alerts(store.auth) == ias.list_active()
    assert len(ias.list_active()) == 3


def test_an_inactive_alert_is_not_read_as_armed(store):
    aid = store.arm("rsi", "above", 50.0)
    ias.set_active(aid, False)
    assert cw.read_active_alerts(store.auth) == []
    assert cw.read_active_alerts(store.auth) == ias.list_active()


# ─── read-only, provably ─────────────────────────────────────────────────────

def test_the_connection_cannot_write(store):
    conn = cw.ro_connect(store.auth)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("UPDATE indicator_alerts SET active=0")
    finally:
        conn.close()


def test_a_missing_store_raises_rather_than_being_created(tmp_path):
    """`mode=ro` refuses to invent an empty database.

    That property is the reason read-only is the right default here and not only
    a safety measure: a typo'd path would otherwise become an empty store that
    reports a perfectly clean zero.
    """
    missing = str(tmp_path / "nope.db")
    with pytest.raises(sqlite3.OperationalError):
        cw.ro_connect(missing)
    assert not os.path.exists(missing)


def _dump(store):
    """Every row of both stores, through a fresh connection.

    ⚠️ NOT A FILE DIGEST, AND THE REASON IS MEASURED. `_conn()` uses
    `with sqlite3.connect(...)`, which COMMITS but never CLOSES, so a lingering
    connection can be garbage-collected mid-test; the resulting WAL checkpoint
    rewrites both files without a single row changing. A byte digest would call
    that a write and this test would be measuring Python's GC, not the tool.
    The ARTIFACT is the rows.
    """
    out = {}
    for path, table in ((store.auth, cw.table_from_module_schema(ias._SCHEMA)),
                        (store.shadow,
                         cw.table_from_module_schema(shadow._SCHEMA))):
        with sqlite3.connect(path) as db:
            out[table] = db.execute(
                "SELECT * FROM {} ORDER BY id".format(table)).fetchall()
    return out


def test_a_full_run_writes_nothing_to_either_store(store):
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(5, when=_et(10, 30))
    before = _dump(store)
    assert before["indicator_alerts"] and before["alert_shadow_fires"]
    report = _run(store)
    assert report["lanes"]["armed"] == 1
    assert report["lanes"]["evaluated_both"] == 1     # it really did work
    assert _dump(store) == before


# ─── 1. the RTH window ───────────────────────────────────────────────────────

def test_session_bucket_boundaries():
    zone = ic._et_zone()
    assert cw.session_bucket(_et(9, 29), zone) == "pre"
    assert cw.session_bucket(_et(9, 30), zone) == "rth"
    assert cw.session_bucket(_et(15, 59), zone) == "rth"
    assert cw.session_bucket(_et(16, 0), zone) == "post"
    assert cw.session_bucket(_et(18, 5), zone) == "post"
    saturday = datetime.now(tz=zone).replace(hour=11, minute=0, second=0,
                                             microsecond=0)
    while saturday.weekday() != 5:
        saturday -= timedelta(days=1)
    assert cw.session_bucket(saturday.timestamp(), zone) == "weekend"


def test_after_hours_only_rows_are_never_counted_as_rth(store):
    """THE MUTATION TARGET. 8,130 rows, all after 16:52 ET, once read as a soak.

    If `session_bucket` stops filtering -- or the verdict starts reading
    `total_rows` -- `rth_rows` becomes 40 and this test fails.
    """
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(40, when=_et(18, 5))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    sh = report["shadow"]
    assert sh["total_rows"] == 41
    assert sh["rth_rows"] == 0
    assert sh["post_rows"] == 41
    assert "no-rth-shadow-rows" in report["verdict"]["codes"]
    assert report["verdict"]["exit_code"] == 1


def test_rth_rows_are_counted_when_they_exist(store):
    """The positive control for the test above -- the filter is not just 'always 0'."""
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(12, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    sh = _run(store)["shadow"]
    assert sh["total_rows"] == 13
    # The 13th row is "now", whose bucket depends on when the suite runs -- so
    # the assertion is on the 12 that were PLACED at 10:30 ET, not on a number
    # that would make this test fail on a Saturday.
    assert sh["rth_rows"] >= 12
    assert sh["partition_holds"] is True


def test_the_buckets_partition_every_row(store):
    """rth + pre + post + weekend == total, asserted rather than assumed."""
    zone = ic._et_zone()
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(3, when=_et(10, 30))
    store.shadow_rows(4, when=_et(7, 0))
    store.shadow_rows(5, when=_et(18, 0))
    sat = datetime.now(tz=zone).replace(hour=11, minute=0, second=0,
                                        microsecond=0)
    while sat.weekday() != 5:
        sat -= timedelta(days=1)
    store.shadow_rows(6, when=sat.timestamp())
    sh = _run(store)["shadow"]
    assert (sh["rth_rows"], sh["pre_rows"], sh["post_rows"],
            sh["weekend_rows"]) == (3, 4, 5, 6)
    assert sh["total_rows"] == 18
    assert sh["partition_holds"] is True


def test_the_total_is_never_the_only_row_count_reported(store):
    """The mistake must be structurally hard to make from this report.

    `rth_rows` is its own field, the per-day table carries a per-day rth column,
    and the verdict message quotes both numbers.
    """
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(30, when=_et(18, 5))
    report = _run(store)
    text = cw.render(report)
    assert "rth rows" in text
    assert "rth_rows" in report["shadow"]
    msg = [r["message"] for r in report["verdict"]["reasons"]
           if r["code"] == "no-rth-shadow-rows"][0]
    assert "0 row(s) inside 09:30-16:00 ET" in msg
    assert "out of 30 total" in msg


# ─── 2 + 3. the two lanes ────────────────────────────────────────────────────

def _tool_ast():
    return ast.parse((_ROOT / "tools" / "cutover_watch.py").read_text(
        encoding="utf-8"))


def test_required_accessors_names_everything_the_report_path_touches():
    """A RAIL, NOT A LIST.

    The first production run of this tool crashed with `AttributeError: module
    'api.services.indicator_alert_service' has no attribute 'snooze_active'` --
    the pod was running code older than the instrument. The preflight turns that
    into a NO-GO instead of a crash, but only if it knows what to check, and a
    hand-kept list of names is exactly how four `dpc` constants rode uncovered
    for the lifetime of the rule they belonged to. So the coverage is DERIVED:
    every module attribute reached from a report-path function must be declared.
    """
    tree = _tool_ast()
    by_name = {n.name: n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef)}
    for fn in cw.REPORT_PATH_FUNCTIONS:
        assert fn in by_name, "{} is named in REPORT_PATH_FUNCTIONS but the " \
                              "tool no longer defines it".format(fn)
    used = set()
    for fn in cw.REPORT_PATH_FUNCTIONS:
        for node in ast.walk(by_name[fn]):
            if (isinstance(node, ast.Attribute)
                    and isinstance(node.value, ast.Name)
                    and node.value.id in cw.MODULE_ALIASES):
                used.add((cw.MODULE_ALIASES[node.value.id], node.attr))
    undeclared = sorted(used - set(cw.REQUIRED_ACCESSORS))
    assert undeclared == [], (
        "the report path calls these without declaring them, so a pod missing "
        "one would crash instead of refusing: {}".format(undeclared))


def test_required_accessors_has_no_dead_entries():
    """The other half: a declared name the tool never touches is noise.

    Without this, `REQUIRED_ACCESSORS` could grow into a wishlist that refuses
    perfectly good deployments.
    """
    tree = _tool_ast()
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    consts = {n.value for n in ast.walk(tree)
              if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    for module, attr in cw.REQUIRED_ACCESSORS:
        assert attr in attrs or attr in consts, \
            "{}.{} is declared required but never touched".format(module, attr)
        assert hasattr(cw._MODULES[module], attr), \
            "{}.{} is declared required but this tree does not have it".format(
                module, attr)


def test_a_pod_missing_an_accessor_refuses_instead_of_crashing(store,
                                                               monkeypatch):
    """The exact production failure, reproduced and converted into a verdict."""
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    monkeypatch.delattr(ias, "snooze_active")
    report = _run(store)
    assert report["preflight"]["missing"] == [
        "indicator_alert_service.snooze_active"]
    assert "pod-code-too-old" in report["verdict"]["codes"]
    assert report["verdict"]["exit_code"] == 1
    # ⛔ AND IT MUST NOT FALL BACK TO THE STATE STRING. `deliverable_now` is
    # UNKNOWN, not 0: a 0 here would be the very proxy that reported everything
    # muzzled right up to the emails.
    assert report["delivery"]["deliverable_now"] is None
    assert "UNAVAILABLE" in report["delivery"]["derived_from"]
    assert "deliverable-now" not in report["verdict"]["codes"]
    cw.render(report)      # must not raise on the None


def test_the_two_lanes_are_driven_explicitly_and_diagnose_is_never_read():
    """`diagnose()` is MODE-BLIND and would call chikou healthy after the flip.

    Verified with an AST rather than a grep: the module docstring NAMES
    `diagnose` in prose, and `git grep -c admit_alert_fire` already lied to this
    project once by counting comments.
    """
    tree = ast.parse((_ROOT / "tools" / "cutover_watch.py").read_text(
        encoding="utf-8"))
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    assert "diagnose" not in attrs and "diagnose" not in names
    assert "_evaluate_one" in attrs
    assert "_evaluate_one_closed" in attrs


def test_the_forming_lane_is_called_with_an_explicit_mode():
    """A call that asked `eval_mode()` would read closed-vs-closed after the flip.

    Asserted structurally: the `_evaluate_one` call must carry a `mode` keyword.
    """
    tree = ast.parse((_ROOT / "tools" / "cutover_watch.py").read_text(
        encoding="utf-8"))
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "_evaluate_one"]
    assert calls, "the tool no longer drives the forming lane at all"
    for call in calls:
        kwargs = {k.arg for k in call.keywords}
        assert "mode" in kwargs


def test_the_default_bars_provider_is_the_shipped_fetch():
    """`lesson_injected_dependency_hides_the_fetch`, closed by identity.

    Every test in this file injects bars, so nothing here would notice the
    default being swapped for a stub. The production run in the report is what
    exercises the real path; this is what stops the default drifting.
    """
    assert cw.BARS_PROVIDER is ev._fetch_bars_for_alert


def test_a_lost_fire_is_seen_when_the_lanes_genuinely_disagree(store):
    """A REAL disagreement out of real bars, not a stub asserting itself.

    The newest bar spikes 40 points and is still OPEN, so the forming lane reads
    it and the closed lane judges the bar before it.
    """
    bars = _bars(300, spike=40.0)
    store.arm("close", "above", bars[-2]["c"] + 5.0)
    store.shadow_rows(3, when=_et(10, 30))
    report = _run(store, bars=bars)
    row = [r for r in report["lanes"]["per_alert"] if r["address"] == "close"][0]
    assert row["kind"] == "lost"
    assert row["forming_triggered"] is True
    assert row["closed_triggered"] is False
    assert report["lanes"]["per_address"]["close"]["lost"] == 1
    assert report["declaration"]["observed"]["close|lost"] == 1
    # `close|lost` IS declared (21,774 fires), so a real disagreement on a
    # declared address must NOT be reported as undeclared.
    assert report["declaration"]["undeclared"] == []


def test_a_live_disagreement_outside_the_declaration_is_named(store, tmp_path):
    bars = _bars(300, spike=40.0)
    store.arm("close", "above", bars[-2]["c"] + 5.0)
    store.shadow_rows(3, when=_et(10, 30))
    empty = tmp_path / "empty_declared.json"
    empty.write_text(json.dumps({"rows": []}), encoding="utf-8")
    prev = shadow.DECLARED_DIFF_PATH
    shadow.DECLARED_DIFF_PATH = str(empty)
    try:
        report = _run(store, bars=bars)
    finally:
        if shadow.DECLARED_DIFF_PATH == str(empty):
            shadow.DECLARED_DIFF_PATH = prev
    assert [u["address"] for u in report["declaration"]["undeclared"]] == ["close"]
    assert "undeclared-disagreement" in report["verdict"]["codes"]
    assert report["verdict"]["exit_code"] == 1


def test_a_zero_disagreement_count_can_never_read_as_go_on_its_own(store):
    """'the lanes agree' and 'nothing was evaluated' must not print the same GO.

    This is the failure mode the project has hit three times, reproduced: the
    bar fetch returns nothing, so every disagreement count is 0 -- and the
    verdict is still NO-GO, naming the missing denominator.
    """
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store, bars=[])
    lanes = report["lanes"]
    assert lanes["armed"] == 1
    assert lanes["would_change"] == 0
    assert lanes["evaluated_both"] == 0
    assert report["declaration"]["observed_groups"] == 0
    assert "no-live-evaluation" in report["verdict"]["codes"]
    assert report["verdict"]["go"] is False


def test_a_comparison_taken_off_a_closed_bar_is_refused_as_vacuous(store):
    """THE VACUITY THE FIRST PRODUCTION RUN EXPOSED, closed as a gate.

    At 22:00 ET the newest SPY 5m bar had long since closed, so
    `closed_bar_index` WAS the newest index and both lanes read the same
    element: the tool printed `identical 30` and `would change 1`. Thirty of
    those zeros could not have been anything else. The positive control below is
    the same store with a bar still forming.
    """
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)

    vacuous = _run(store, bars=_bars(300, last_bar_open=False))
    assert vacuous["lanes"]["groups_with_an_open_bar"] == 0
    assert vacuous["lanes"]["would_change"] == 0
    assert vacuous["lanes"]["kinds"]["identical"] == 1
    assert "lanes-compared-off-a-closed-bar" in vacuous["verdict"]["codes"]
    assert vacuous["verdict"]["exit_code"] == 1

    live = _run(store)
    gs = list(live["lanes"]["group_state"].values())[0]
    assert live["lanes"]["groups_with_an_open_bar"] == 1
    assert gs["judged_index"] == gs["newest_index"] - 1
    assert "lanes-compared-off-a-closed-bar" not in live["verdict"]["codes"]
    assert live["verdict"]["go"] is True


def test_zero_armed_alerts_is_itself_a_refusal(store):
    """An instrument pointed at an empty room reports the same clean sheet."""
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    assert report["lanes"]["armed"] == 0
    assert report["lanes"]["would_change"] == 0
    assert "no-armed-alerts" in report["verdict"]["codes"]


# ─── the chikou discrimination ───────────────────────────────────────────────

def test_chikou_is_reported_as_accounted_for_and_does_not_refuse(store):
    """The owner-accepted casualty must not be able to veto the cutover."""
    store.arm("rsi", "above", -1e9)
    store.arm("ichimoku.chikou", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    sil = report["silence"]
    assert sil["silent_addresses"] == 1
    row = sil["accounted_rows"][0]
    assert row["address"] == "ichimoku.chikou"
    assert row["accounted"] is True
    assert row["expected_shape"] == "trailing_pad"
    assert row["observed_pad"] == 26 == row["expected_pad"]
    assert sil["unexpected"] == []
    assert "unexpected-closed-lane-silence" not in report["verdict"]["codes"]
    assert report["verdict"]["go"] is True


def test_a_second_silent_address_does_refuse(store):
    """A DIFFERENT address going silent is a NO-GO, and it comes from DATA.

    With exactly 50 bars, `price_vs_ma`'s 50-period MA has a value at the last
    index and None at index 48 -- the bar the closed lane judges while the
    newest bar is still open. So the forming lane produces a number and the
    closed lane produces nothing, for a reason that is NOT chikou's trailing
    pad. The classifier names the mechanism (`warmup_boundary`) rather than
    lumping every silence together.
    """
    store.arm("rsi", "above", -1e9)
    store.arm("price_vs_ma", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store, bars=_bars(50))
    sil = report["silence"]
    assert [u["address"] for u in sil["unexpected"]] == ["price_vs_ma"]
    assert sil["accounted_rows"] == []
    assert "unexpected-closed-lane-silence" in report["verdict"]["codes"]
    assert report["verdict"]["exit_code"] == 1


def test_chikou_silent_for_a_different_reason_is_not_forgiven(store):
    """The acceptance is keyed on (address, shape), not on the address.

    Driven by narrowing the accounted table to a shape that does not match what
    is measured: the row must then be reported as unexpected rather than waved
    through because the address happens to be the famous one.
    """
    store.arm("rsi", "above", -1e9)
    store.arm("ichimoku.chikou", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store, accounted={"ichimoku.chikou": {
        "shape": "warmup_boundary", "expected_pad": 0, "reason": "x" * 60}})
    assert [u["address"] for u in report["silence"]["unexpected"]] == [
        "ichimoku.chikou"]
    assert "unexpected-closed-lane-silence" in report["verdict"]["codes"]


def test_the_pad_is_measured_and_not_asserted():
    """26 comes off the series, not out of this file."""
    shape = cw.silence_shape("ichimoku.chikou", _bars(300), {}, 298)
    assert shape["shape"] == "trailing_pad"
    assert shape["trailing_pad"] == 26
    assert shape["series_len"] == 300
    # An IDENTITY over the measured fields rather than a second hand-copied
    # number: the column is [leading warm-up][values][26-element trailing pad].
    assert shape["non_none"] == (shape["series_len"] - shape["trailing_pad"]
                                 - shape["first_value_index"])
    assert shape["non_none"] > 0
    # A healthy column is reported as healthy rather than squeezed into one of
    # the fault shapes -- otherwise every address would look silent to a caller
    # that asked the wrong question.
    other = cw.silence_shape("rsi", _bars(300), {}, 298)
    assert other["shape"] == "value_present_at_judged_bar"
    assert other["trailing_pad"] == 0
    # And the warm-up mechanism is a THIRD, distinct answer.
    warm = cw.silence_shape("price_vs_ma", _bars(50), {}, 48)
    assert warm["shape"] == "warmup_boundary"
    assert warm["trailing_pad"] == 0
    assert warm["first_value_index"] == 49


def test_chikou_is_the_only_trailing_pad_in_the_whole_catalog():
    """The fourth independent confirmation, and it is derived, not quoted.

    If a second address ever grows a trailing pad, the accounted-for table stops
    describing the world and this goes red before a cutover reads it as fine.
    """
    bars = _bars(300)
    padded = []
    for address in ev.all_addresses():
        shape = cw.silence_shape(address, bars, {}, len(bars) - 2)
        if shape["shape"] == "trailing_pad":
            padded.append(address)
    assert padded == ["ichimoku.chikou"]
    assert sorted(cw.ACCOUNTED_CLOSED_LANE_SILENCE) == padded


# ─── 4. deliverability ───────────────────────────────────────────────────────

def test_deliverable_now_reads_the_clock_not_the_state_column(store):
    """THE EXACT LIVE DEFECT, driven both ways.

    A row whose `state` still says `snoozed` while `snooze_until` has PASSED is
    deliverable on the next cycle -- `--verify` used to report it as muzzled and
    printed 0 right up to the emails. A row whose `state` was rewritten to
    `needs_attention` by the 300 s silence sweep while `snooze_until` is still
    in the FUTURE is muzzled -- the state column says the opposite.
    """
    expired = store.arm("rsi", "above", -1e9, snooze_minutes=1)
    rewritten = store.arm("macd", "above", -1e9)
    with sqlite3.connect(store.auth) as db:
        # the window has closed but nothing rewrote the state
        db.execute("UPDATE indicator_alerts SET snooze_until=? WHERE id=?",
                   (int(time.time()) - 10, expired))
        # the silence sweep rewrote the state while the window is still open
        db.execute("UPDATE indicator_alerts SET state=? WHERE id=?",
                   (ias.STATE_NEEDS_ATTENTION, rewritten))

    alerts = cw.read_active_alerts(store.auth)
    d = cw.delivery_report(alerts, time.time())

    assert d["armed"] == 2
    assert d["deliverable_now"] == 1
    assert d["deliverable_ids"] == [expired]
    assert d["muzzled_by_clock"] == 1
    # ⭐ THE PROXY DISAGREES WITH THE CLOCK ON BOTH ROWS, IN OPPOSITE
    # DIRECTIONS. That number is the evidence the state string was the wrong
    # thing to read, printed rather than argued.
    assert d["muzzled_by_state_string"] == 1
    assert d["clock_vs_state_disagreements"] == 2
    assert sorted(d["disagreeing_ids"]) == sorted([expired, rewritten])
    assert d["derived_from"].startswith(
        "indicator_alert_service.snooze_active(row)")


def test_a_deliverable_alert_refuses_the_cutover(store):
    store.arm("rsi", "above", -1e9, snooze_minutes=None)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    assert report["delivery"]["deliverable_now"] == 1
    assert "deliverable-now" in report["verdict"]["codes"]
    assert report["verdict"]["exit_code"] == 1


def test_a_muzzle_about_to_expire_refuses_the_cutover(store):
    """The launch-day time bomb, as a gate rather than as a green light."""
    store.arm("rsi", "above", -1e9)
    store.arm("macd", "above", -1e9, snooze_minutes=60)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    assert report["delivery"]["deliverable_now"] == 0
    assert report["delivery"]["expiring_soon"] == 1
    assert "soak-muzzle-expiring" in report["verdict"]["codes"]


# ─── 5. the verdict ──────────────────────────────────────────────────────────

def test_every_nogo_branch_fires_and_the_exit_code_follows():
    """The gate proved able to refuse, branch by branch, plus green controls."""
    results = cw.run_self_test()
    summary = cw.self_test_summary(results)
    assert summary["never_forced"] == []
    assert summary["forced"] == len(cw.NOGO_REASONS) == 12
    assert summary["all_fired"] is True
    assert summary["all_exit_codes_follow"] is True
    assert summary["controls_green"] is True
    assert summary["messages_disjoint"] is True
    assert summary["ok"] is True
    for r in results:
        if r["expected"]:
            assert r["exit"] == 1, r
            assert r["expected"] in r["codes"], r
        else:
            assert r["exit"] == 0, r
            assert r["codes"] == [], r


def test_the_self_test_covers_every_declared_branch():
    """Totality DERIVED from `NOGO_REASONS`, not from a list somebody extended."""
    cases, _ = cw.selftest_cases()
    forced = {expected for _, expected, _ in cases if expected}
    assert forced == set(cw.NOGO_REASONS)
    assert sum(1 for _, expected, _ in cases if expected is None) >= 2


def _bare_report(**over):
    """The smallest input `verdict()` reads, all checks passing by default."""
    report = {
        "store_errors": [],
        "shadow": {"partition_holds": True, "rth_rows": 10, "pre_rows": 0,
                   "post_rows": 0, "weekend_rows": 0, "total_rows": 10,
                   "newest_age_sec": 5, "enabled_env": True},
        "lanes": {"armed": 1, "evaluated_both": 1, "evaluated_forming": 1,
                  "evaluated_closed": 1, "groups": 1, "bars_fetched": {},
                  "group_state": {}, "groups_with_an_open_bar": 1},
        "delivery": {"deliverable_now": 0, "armed": 1, "deliverable_ids": [],
                     "clock_vs_state_disagreements": 0, "expiring_soon": 0,
                     "muzzle_expires_in_days": 20, "muzzle_expires_at": 0},
        "declaration": {"undeclared": [], "declared_rows": 61,
                        "declared_addresses": 31},
        "silence": {"unexpected": []},
    }
    for section, patch in over.items():
        report[section].update(patch) if isinstance(patch, dict) else None
    return report


def test_the_bare_report_is_itself_green():
    """CONTROL for the two tests below: the baseline must produce NO reasons."""
    assert cw.verdict(_bare_report()) == []


def test_the_verdict_refuses_a_code_outside_the_declared_vocabulary(monkeypatch):
    """A branch that never went through `NOGO_REASONS` is a branch with no case.

    Driven by NARROWING the vocabulary and then tripping the branch that was
    removed from it: the guard has to fire on real emission, not on a string
    this test wrote itself.
    """
    monkeypatch.setattr(
        cw, "NOGO_REASONS",
        tuple(c for c in cw.NOGO_REASONS if c != "no-armed-alerts"))
    with pytest.raises(AssertionError, match="not in NOGO_REASONS"):
        cw.verdict(_bare_report(lanes={"armed": 0}))


def test_min_rth_rows_is_configurable_and_is_the_number_that_gates(store):
    """The verdict reads `rth_rows`, never `total_rows`. Proved by raising it."""
    report = _bare_report(shadow={"rth_rows": 5, "total_rows": 9000})
    assert cw.verdict(report) == []
    codes = [r["code"] for r in cw.verdict(report, min_rth_rows=6)]
    assert codes == ["no-rth-shadow-rows"]


def test_a_healthy_store_reads_go(store):
    """The control for every NO-GO above: this instrument can also say yes."""
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    report = _run(store)
    assert report["verdict"]["reasons"] == []
    assert report["verdict"]["go"] is True
    assert report["verdict"]["exit_code"] == 0
    assert report["shadow"]["rth_rows"] == 20
    assert report["lanes"]["evaluated_both"] == 1
    text = cw.render(report)
    assert "VERDICT: GO" in text
    assert "each one had a non-zero denominator" in text


def test_main_returns_the_verdicts_exit_code(store, capsys):
    store.arm("rsi", "above", -1e9)
    store.shadow_rows(20, when=_et(10, 30))
    store.shadow_rows(1, when=time.time() - 30)
    rc = cw.main(["--auth-db", store.auth, "--shadow-db", store.shadow],
                 bars_provider=cw._provider(_bars()))
    assert rc == 0
    assert "VERDICT: GO" in capsys.readouterr().out

    store.arm("macd", "above", -1e9, snooze_minutes=None)
    rc = cw.main(["--auth-db", store.auth, "--shadow-db", store.shadow,
                  "--json"], bars_provider=cw._provider(_bars()))
    assert rc == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["verdict"]["go"] is False
    assert "deliverable-now" in payload["verdict"]["codes"]


def test_the_report_names_the_EFFECTIVE_lane_and_the_lever_that_set_it(
        store, monkeypatch):
    """The constant and the running lane became two questions.

    `ALERT_EVAL_MODE` can now be overridden from the Railway dashboard without a
    deploy -- the only rollback that exists inside the 09:15-16:20 ET push
    freeze. So the header has to answer BOTH, and the effective lane has to come
    from the evaluator rather than from this tool's own reading of the
    environment.
    """
    store.arm("rsi", "above", -1e9)
    # ⚠️ THE OVERRIDE IS `"forming"` SINCE THE CUTOVER, AND IT HAS TO BE. The
    # committed constant is now `"closed"`, so overriding to `"closed"` would
    # agree with it and this test could not tell the header's two answers apart —
    # exactly the vacuous shape it exists to refuse. `"forming"` is also the only
    # override an operator will ever actually type now: it is the rollback.
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    mode = _run(store)["mode"]
    assert mode["lever_known"] is True
    assert mode["effective"] == "forming" == mode["eval_mode()"]
    assert mode["override_applied"] is True
    assert mode["ALERT_EVAL_MODE"] == "closed", (
        "the committed constant reads something other than the value Task 8's "
        "cutover commit left, or the override edited it")


def test_the_lever_refuses_the_flip_in_all_THREE_of_its_broken_states():
    """One code, three shapes, each of which makes the flip a different lie.

    Driven through `verdict()` on the bare report so each shape is independently
    forceable -- the same reason the verdict collects reasons instead of
    returning the first.
    """
    def codes(**patch):
        mode = {"lever_known": True, "ALERT_EVAL_MODE": "forming",
                "eval_mode()": "forming", "effective": "forming",
                "override_present": False, "override_applied": False,
                "override_refused": False, "env_var": "ALERT_EVAL_MODE",
                "env_value": None, "refusals": 0,
                "modes": ["forming", "closed"]}
        mode.update(patch)
        report = _bare_report()
        report["mode"] = mode
        return [r for r in cw.verdict(report)
                if r["code"] == "eval-mode-lever-misconfigured"]

    assert codes() == [], "the healthy lever state must not refuse"

    refused = codes(override_present=True, override_refused=True,
                    env_value="closd", refusals=4)
    assert len(refused) == 1 and "HAS NOT TAKEN" in refused[0]["message"]

    applied = codes(override_present=True, override_applied=True,
                    env_value="closed", **{"eval_mode()": "closed",
                                           "effective": "closed"})
    assert len(applied) == 1 and "IN PLAY" in applied[0]["message"]

    # …and the tombstone: the two disagree and NOTHING explains it.
    tombstone = codes(**{"eval_mode()": "closed", "effective": "closed"})
    assert len(tombstone) == 1 and "HARD-CODED" in tombstone[0]["message"]


def test_the_report_states_which_resolvers_it_used(store):
    store.arm("rsi", "above", -1e9)
    mode = _run(store)["mode"]
    assert mode["diagnose_used"] is False
    assert "mode='forming'" in mode["forming_resolver"]
    assert "closed_bar_index" in mode["closed_resolver"]
    assert mode["ALERT_EVAL_MODE"] == ev.ALERT_EVAL_MODE
    assert mode["eval_mode()"] == ev.eval_mode()


def test_output_is_ascii_only_so_cp1252_cannot_kill_it(store):
    """cp1252 has killed a harness's stdout on this box twice."""
    store.arm("ichimoku.chikou", "above", -1e9)
    store.shadow_rows(3, when=_et(10, 30))
    text = cw.render(_run(store))
    assert cw._ascii(text) == text
