"""Shadow mode, and the DECLARED diff — what changes for an armed alert, per address.

Task 5 proved the closed lane is internally consistent: 0 keyed / 0 identity
repaint disagreement at every k, on four frozen real-bar fixtures, while firing
2,012,025 times. That is "the answer does not depend on when you looked". It is
NOT "the answer is the same as yesterday's", and it must not be — the whole point
of the phase is that a fire on a wick STOPS happening.

🔴 AND THE REPAINT ORACLE CANNOT ANSWER THE SECOND QUESTION — MEASURED, NOT
ARGUED. Task 5's M1 (restore `prev = last_value`, i.e. the defect itself) and M4
(shift a whole column by one bar) **both repaint ZERO and both are wrong**,
because `replay` writes `last_value` back after every sample and a closed value is
identical at every sample of one bar. So nothing here treats "0 repaints" as a
proxy for correctness. This file measures a SET DIFFERENCE between the two lanes,
keyed with the value inside the key, and demands that every element of it be
DECLARED with a reason.

⚠️ SPEED. `lane_diff` over all four fixtures is a ~15-minute two-lane replay and
belongs to `python tools/alert_replay.py --diff`, whose exit code is the gate.
These tests measure the same thing on `wick_that_unwinds` (66 bars × 295 alerts,
seconds) by default, which still exercises 28 of the 30 addresses in both
directions. `ALERT_DIFF_FULL=1` runs all four here too.
"""

from __future__ import annotations

import ast
import copy
import json
import os
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar  # noqa: E402
from api.services import alert_shadow_log as shadow  # noqa: E402
from api.services import indicator_alert_evaluator as ev  # noqa: E402
from api.services import indicator_alert_service as ias  # noqa: E402

_FULL = os.environ.get("ALERT_DIFF_FULL") == "1"
# ⛔ "FULL" MEANS THE DECLARATION'S OWN SCOPE, NOT THE WHOLE CORPUS. The frozen
# corpus grew from four fixtures to eleven (`tools/alert_corpus_extend.py`, real
# tape for gap opens, high-volatility sessions, a thin ticker, a warmup window, a
# half day, an hourly grid and a volatile daily series). Every `count` in
# `fire_diff_declared.json` is a bound measured over the FOUR series it names, so
# driving the other seven through the same bounds over-budgets rows for a reason
# that has nothing to do with the lane — and a gate that goes red for a reason it
# does not guard is a gate people learn to ignore. `ar.diff_scope` is the single
# place that decision lives; this reads it rather than restating it.
_FIXTURES = (ar.diff_scope(shadow.declared_diff(), None)[0] if _FULL
             else ["wick_that_unwinds"])


@pytest.fixture(scope="module")
def declared() -> dict:
    return shadow.declared_diff()


@pytest.fixture(scope="module")
def measured() -> dict:
    """The live two-lane diff. Module-scoped: it is the expensive thing here."""
    return ar.lane_diff(_FIXTURES, k=ar.DIFF_K, progress=False)


# ─── THE DECLARED DIFF ───────────────────────────────────────────────────────

def test_every_difference_between_the_two_lanes_is_DECLARED(measured, declared):
    """The closed-bar rebuild CHANGES which alerts fire. That is the point, and it
    is also the thing that reaches a real inbox, so it is declared per address
    rather than discovered on cutover day.

    ⛔ UNDECLARED IS A FAILURE WHETHER IT IS AN EXTRA FIRE OR A MISSING ONE.
    B5 measured that half a gate is no gate: its `expect` had to be an EQUALITY
    because a regression SMALLER than an allowance passed a `<=`.
    """
    report = shadow.diff_report(measured, declared)
    assert report["undeclared"] == [], (
        f"{len(report['undeclared'])} group(s) changed with no declaration. Each "
        f"needs an entry in fire_diff_declared.json naming the ADDRESS, the "
        f"DIRECTION and the REASON. First: {report['undeclared'][0]}")
    assert report["over_budget"] == [], (
        f"{len(report['over_budget'])} declaration(s) under-count what actually "
        f"changed. First: {report['over_budget'][0]}")


def test_a_declared_difference_that_does_not_OCCUR_is_recorded_not_failed(measured, declared):
    """B5's `provenance_unmet` ruling, verbatim in shape: the same fixtures run in
    several configurations, and gating an absent-but-declared difference turns
    every configuration but one red. It is REPORTED, never failed.

    This run is one fixture of four (or all four under `ALERT_DIFF_FULL=1`), so
    rows declared from the four-fixture measurement are legitimately unmet here.
    They land in `unmet`, they are printed, and they fail nothing.
    """
    report = shadow.diff_report(measured, declared)
    for row in report["unmet"]:
        assert row["observed"] < row["declared"]
        assert (row["address"], row["direction"]) in shadow.declaration_index(declared)
    if not _FULL:
        assert report["unmet"], (
            "a one-fixture run met EVERY four-fixture declaration exactly — either "
            "the declaration was recorded from this subset (in which case it is "
            "not the diff the cutover faces) or `unmet` is not being computed")
    # …and the reporting path is not a failing path.
    assert report["undeclared"] == [] and report["over_budget"] == []


def test_the_declaration_cannot_wave_through_a_WHOLE_ADDRESS(declared):
    """⭐ THE MR2b LESSON. B5 found that widening the declarable field set by ONE
    geometry field was invisible to every pre-existing rail — only a case that
    DECLARED that field could separate them. So: a declaration names an address
    AND a direction AND a bounded count; a wildcard, a missing count, or a count
    larger than the recorded one is refused HERE.
    """
    assert shadow.validate_declaration(declared) == [], (
        "the committed declaration does not validate: "
        f"{shadow.validate_declaration(declared)}")

    def _mutate(fn):
        doc = copy.deepcopy(declared)
        fn(doc)
        return shadow.validate_declaration(doc)

    wildcard = _mutate(lambda d: d["rows"][0].__setitem__("address", "ichimoku.*"))
    assert any("WILDCARD" in p for p in wildcard), wildcard

    missing = _mutate(lambda d: d["rows"][0].pop("count"))
    assert any("MISSING count" in p for p in missing), missing

    inflated = _mutate(lambda d: d["rows"][0].__setitem__("count", 9999))
    assert inflated, "a count of 9999 was accepted — the declaration is unbounded"
    assert any("sum" in p for p in inflated), inflated

    unreasoned = _mutate(lambda d: d["rows"][0].__setitem__("reason", "expected"))
    assert any("reason" in p for p in unreasoned), unreasoned

    unknown = _mutate(lambda d: d["rows"][0].__setitem__("address", "rsi_typo"))
    assert any("not an address in the catalog" in p for p in unknown), unknown

    duped = _mutate(lambda d: d["rows"].append(dict(d["rows"][0])))
    assert any("declared twice" in p for p in duped), duped


def test_declared_covers_REFUSES_an_address_it_has_never_heard_of(declared):
    """⛔ THE CONTROL WITHOUT WHICH THE WHOLE GATE IS A TAUTOLOGY (B5's MR4).

    `declared_covers` returning True unconditionally makes every difference
    covered and the diff reports nothing forever. No POSITIVE case can see that.
    Only a fire whose address the declaration has never heard of can.
    """
    fake = ("wick_that_unwinds|__no_such_address__|above|1.0", 5, 1, "1.0", True)
    assert shadow.declared_covers(declared, fake, "gained") is False
    assert shadow.declared_covers(declared, fake, "lost") is False
    # …and a real declared row IS covered, so the refusal is not "it refuses
    # everything", which is the other way a gate stops working.
    row = declared["rows"][0]
    real = (f"wick_that_unwinds|{row['address']}|above|1.0", 5, 1, "1.0", True)
    assert shadow.declared_covers(declared, real, row["direction"]) is True
    # a direction nobody declared is not a direction
    assert shadow.declared_covers(declared, real, "sideways") is False


def test_ichimoku_chikou_is_a_named_REASONED_lost_row(measured, declared):
    """🔴 THE HAND-OFF FROM TASK 5, AND THE DIFF'S KNOWN-NONZERO ROW.

    `ichimoku.chikou`'s column back-shifts bar `i`'s close to index `i - 26`, so
    the newest 26 slots are `None`. The forming lane never noticed —
    `_last_non_none` walks backwards until it finds a number and returns one from
    26 bars ago. The closed lane reads `series[i]` and reports "no value at this
    bar", which is the honest answer. **A chikou alert therefore stops firing at
    the cutover**, and to a user that reads as "my Chikou alert broke".

    It is here, with a count and a reason, rather than in a support ticket. It is
    also this file's positive control: a diff that reports "nothing changes" is
    worthless, and this row proves the instrument would have seen a change.
    """
    obs = shadow.observed_index(measured)
    lost = obs.get(("ichimoku.chikou", "lost"), 0)
    assert lost > 0, (
        "ichimoku.chikou lost NOTHING — either the trailing-pad behaviour changed "
        "or this diff is not measuring the closed lane at all")
    assert obs.get(("ichimoku.chikou", "gained"), 0) == 0, (
        "the closed lane fired a chikou alert. It cannot: the newest 26 slots of "
        "that column are None by construction")

    index = shadow.declaration_index(declared)
    row = index.get(("ichimoku.chikou", "lost"))
    assert row is not None, "ichimoku.chikou's disappearance is UNDECLARED"
    assert "chikou" in row["reason"].lower() and "26" in row["reason"], (
        "the chikou row's reason does not name the mechanism (a 26-bar trailing "
        f"pad): {row['reason']!r}")


def test_the_diff_is_NON_VACUOUS_in_both_directions(measured):
    """⛔ A DIFF THAT REPORTS 'NOTHING CHANGES' WITHOUT A POSITIVE CONTROL IS
    WORTHLESS, and a diff that can only see EXTRA fires is worse: a MISSING alert
    is the failure a user cannot see and cannot report.

    So both lanes must fire, and the difference must be non-empty in BOTH
    directions, or the measurement is refused.
    """
    t = measured["totals"]
    assert t["forming_fires"] > 0 and t["closed_fires"] > 0
    assert t["lost"] > 0, "the diff found nothing the closed lane STOPS firing"
    assert t["gained"] > 0, "the diff found nothing the closed lane STARTS firing"
    assert t["identity_lost"] > 0, (
        "every 'lost' fire has a same-bar counterpart — the diff is only seeing "
        "moved numbers, not fires that stopped existing")
    assert measured["addresses_that_change"] > 20, (
        f"only {measured['addresses_that_change']} addresses changed at all — "
        "that is too few to be the cutover this phase is planning")


def test_the_diff_covers_EVERY_address_in_the_catalog(measured):
    """The address count the diff covers, asserted rather than described.

    31 = 28 `INDICATOR_FUNCS` + 2 `EVENT_FUNCS` + 1 `PRICE_FUNCS`. The fire
    log's grid is the 28 (it was frozen from `INDICATOR_FUNCS` before either of
    the other two partitions existed); the diff adds the rest on top via
    `build_event_alerts` and `build_price_alerts`, because "what changes for an
    armed alert" has to mean every address a user can actually arm.

    ⭐ 30 → 31 AT PHASE C TASK 15, AND THE ONE THAT ARRIVED IS `close`. Task 10
    made price a LEFT operand by putting it in a THIRD partition so that doing
    so could not grow `INDICATOR_FUNCS` and destroy the frozen replay grid — and
    the cost of that (correct) choice was that the declared diff drove 30 of the
    31 armable addresses, bounded by an assertion in `test_alert_fired_log.py`
    that the difference was exactly `{"close"}`. It is now the empty set.
    """
    catalog = (list(ev.INDICATOR_FUNCS) + list(ev.EVENT_FUNCS)
               + list(ev.PRICE_FUNCS))
    assert measured["addresses_in_catalog"] == len(catalog) == 31
    assert measured["addresses_covered"] == len(catalog), (
        f"the diff drove {measured['addresses_covered']} of {len(catalog)} "
        "addresses — an address nobody drove is an address whose cutover "
        "behaviour is undeclared by omission rather than by decision")


def test_the_sar_EVENT_addresses_are_in_the_diff_and_one_of_them_moves(measured, declared):
    """`sar` was deliberately excluded from fixed-threshold alerting (its value
    jumps sides at every trend flip); Task 3's operand grammar is what made the
    two EVENT addresses expressible. They are armable, so the diff drives them.

    ⚠️ AND THEY DO CHANGE, so the answer is "yes, the diff touches sar", said on
    purpose rather than by omission. The event column is {0, 1, None}; the forming
    lane reads `_last_non_none`, which walks backwards past a `None` and can
    re-report an OLDER bar's crossing, and it reads it off a bar that is still
    moving. The closed lane reads `series[i]` on the finished bar.
    """
    index = shadow.declaration_index(declared)
    declared_sar = [k for k in index if k[0].startswith("sar.")]
    assert declared_sar, (
        "neither sar event address is declared to change. sar was deliberately "
        "excluded from FIXED-THRESHOLD alerting and Task 3 made the two EVENT "
        "addresses expressible — whether the cutover moves them is a question this "
        "diff has to answer out loud.")
    obs = shadow.observed_index(measured)
    for key in [k for k in obs if k[0].startswith("sar.")]:
        assert key in index, f"{key[0]} {key[1]} is undeclared"


def test_the_frozen_28_address_grid_did_NOT_move(measured):
    """⛔ THE RAIL UNDER `build_event_alerts`. The diff needed the two event
    addresses; the fire log's 691,195 fires are measured against a grid generated
    from `INDICATOR_FUNCS` alone. So the extension is a SEPARATE builder, and this
    asserts `build_alert_grid` still produces exactly the alert keys the frozen
    log recorded — because if it does not, `--check` is measuring a different grid
    and its equality means nothing.
    """
    with open(_ROOT / "tests" / "fixtures" / "alerts" / "fire_log_forming.json",
              encoding="utf-8") as fh:
        log = json.load(fh)
    names = _FIXTURES or list(log["fixtures"])
    evaluate = ar.make_forming_evaluate()
    for name in names:
        fx = ar.load_fixture(name)
        alerts, _ = ar.build_alert_grid(name, fx["bars"], fx.get("tf", "?"), evaluate)
        assert [a["alert_key"] for a in alerts] == log["fixtures"][name]["alert_keys"], (
            f"{name}: build_alert_grid no longer reproduces the frozen grid")
    assert log["address_count"] == len(ev.INDICATOR_FUNCS) == 28


def test_the_above_below_REPEAT_shape_is_priced_as_a_count(measured, declared):
    """⚠️ THE BEHAVIOUR CHANGE MOST LIKELY TO SURPRISE A USER, AS A NUMBER.

    `above` and `below` are LEVEL conditions with no reference to `prev`, so the
    forming lane re-delivers bell + email + Discord on EVERY poll for as long as
    the condition holds — at a slightly different running value each time. The
    closed lane evaluates one bar at a time, so the same condition produces ONE
    fire per bar at the closed value. In this diff that shows up as the
    `value_moved` shape, and it is the bulk of it.

    The owner record carries it as a count, not as a sentence.
    """
    shapes = measured["shapes"]
    assert shapes["lost"].get("value_moved", 0) > 0
    assert shapes["gained"].get("value_moved", 0) > 0
    assert shapes["lost"]["value_moved"] > shapes["gained"]["value_moved"], (
        "the forming lane did not lose more same-bar fires than the closed lane "
        "gained — the per-poll re-delivery shape is not what this diff is seeing")
    # the level conditions dominate the difference, which is the claim above
    level = sum(v["lost"] for k, v in measured["per_condition"].items()
                if k.rsplit("|", 1)[-1] in ("above", "below"))
    assert level > measured["totals"]["lost"] * 0.5, (
        f"only {level} of {measured['totals']['lost']} lost fires are `above`/"
        "`below` — the claim in the decision record is not what was measured")
    assert declared["measured"]["shapes"]["lost"]["value_moved"] > 0


def test_the_declaration_records_the_measurement_it_was_taken_from(declared):
    """A declaration whose numbers came from nowhere is prose. This one names the
    commit, the k, the fixtures and the two lane totals it was measured at."""
    m = declared["measured"]
    assert m["k"] == ar.DIFF_K
    # ⛔ THE DECLARATION NAMES ITS SCOPE, AND THE CORPUS IS ALLOWED TO BE BIGGER.
    # This used to demand `== ar.fixture_names()`, which was the same statement
    # only while the corpus happened to be exactly the four series the
    # declaration was measured over. Seven real-tape fixtures were added
    # afterwards and their per-address behaviour is a CENSUS, not a budget — so
    # what has to hold is that the declaration names exactly the fixtures the
    # gate drives, and that all of them are real.
    assert m["fixtures"] == ar.diff_scope(declared, None)[0]
    assert set(m["fixtures"]) <= set(ar.fixture_names())
    assert m["addresses_covered"] == 31
    assert m["forming_fires"] > 0 and m["closed_fires"] > 0
    assert m["gained"] > 0 and m["lost"] > 0
    assert isinstance(m.get("head"), str) and len(m["head"]) >= 8
    assert m["command"].startswith("python tools/alert_replay.py --diff")


# ─── THE SHADOW LANE: BOTH LANES RUN, ONE LANE DELIVERS ──────────────────────

@pytest.fixture
def shadow_env(tmp_path, monkeypatch):
    """A live-lane DB, a SEPARATE shadow DB, bars, and no delivery anywhere."""
    auth_db = tmp_path / "auth.db"
    shadow_db = tmp_path / "alert_shadow.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(auth_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(auth_db))
    monkeypatch.setenv("ALERT_SHADOW_DB_PATH", str(shadow_db))
    monkeypatch.setattr(shadow, "_DB_PATH", str(shadow_db))
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    ias.init_schema()
    shadow.init_schema()

    bars = ar.load_fixture("wick_that_unwinds")["bars"]
    calls = {"fetch": 0, "deliver": 0}

    def _fetch(sym, tf, count=200):
        calls["fetch"] += 1
        return [dict(b) for b in bars]

    monkeypatch.setattr(ev, "_fetch_bars_for_alert", _fetch)
    # ⚠️ `**_kw` IS LOAD-BEARING, NOT TIDINESS. `_dispatch_delivery` gained a
    # keyword-only `bar_time` (chart-UX Task 7 — the notification names the bar),
    # and a stub with the old arity raises `TypeError` INSIDE `_run_one_cycle`'s
    # per-alert `except Exception`, which logs it and counts an error. Every
    # assertion in this file still passed while the delivery counter silently
    # stopped moving — measured, 2026-08-06.
    monkeypatch.setattr(
        ev, "_dispatch_delivery",
        lambda alert, value, **_kw: calls.__setitem__("deliver", calls["deliver"] + 1))

    for address, condition, threshold in (("rsi", "above", 50.0),
                                          ("rsi", "cross_above", 70.0),
                                          ("macd", "cross_zero", None),
                                          ("obv", "below", 1e12)):
        ias.create(user_id="u1", sym="WICK", indicator=address,
                   condition=condition, threshold=threshold, tf="5")
    return {"auth_db": auth_db, "shadow_db": shadow_db, "calls": calls}


def _dump_indicator_alerts(path) -> list[tuple]:
    """The WHOLE table, every column, every row — not a sample."""
    con = sqlite3.connect(str(path))
    try:
        return con.execute("SELECT * FROM indicator_alerts ORDER BY id").fetchall()
    finally:
        con.close()


def test_a_shadow_cycle_leaves_indicator_alerts_BYTE_IDENTICAL(shadow_env):
    """⛔ THE OBSERVER MAY NOT CHANGE THE OBSERVED.

    The shadow lane reads the same rows the live lane reads, and `last_value` on
    those rows is not bookkeeping — under `ALERT_EVAL_MODE == "forming"` it IS the
    `prev` a crossing is measured against. A shadow write there would change what
    the LIVE lane fires, on production, silently.

    Dumped before and after and compared AS A WHOLE, not sampled.
    """
    before = _dump_indicator_alerts(shadow_env["auth_db"])
    assert before, "no alerts were created — this test would pass on an empty table"
    summary = shadow.run_shadow_cycle()
    after = _dump_indicator_alerts(shadow_env["auth_db"])
    assert after == before, (
        "the shadow cycle CHANGED indicator_alerts. The live lane reads "
        "last_value as `prev`; a shadow write there changes what a real user's "
        "alert fires.")
    assert summary["skipped"] is False
    assert summary["evaluated"] > 0, (
        "the shadow cycle evaluated nothing — an unchanged table is then a "
        "statement about a cycle that did not happen")
    assert shadow_env["calls"]["deliver"] == 0, "the shadow lane DELIVERED"


def test_the_live_lane_DOES_change_that_table_which_is_why_the_shadow_may_not(shadow_env):
    """The control for the test above. If `indicator_alerts` were somehow
    unwritable in this fixture, "unchanged" would be true of everything and the
    assertion would be a tautology. One live cycle, and the table moves.
    """
    before = _dump_indicator_alerts(shadow_env["auth_db"])
    ev._run_one_cycle()
    after = _dump_indicator_alerts(shadow_env["auth_db"])
    assert after != before, (
        "a full live cycle left indicator_alerts unchanged — the byte-identity "
        "assertion above is measuring nothing")


def test_the_VWAP_UNIT_FIX_cannot_make_the_shadow_lane_write_MORE(shadow_env):
    """⛔ THE SHADOW LANE IS LIVE ON PRODUCTION RIGHT NOW, SO THE FIX OWES THIS.

    `run_shadow_cycle` calls `_fetch_bars_for_alert` too, against 31 armed soak
    alerts. The VWAP unit gate can only ever turn a VALUE into `None` — never the
    other way — and `run_shadow_cycle` `continue`s on `value is None` BEFORE
    `shadow_record`. So the fix's effect on this lane is bounded to writing
    strictly FEWER rows, which is asserted here rather than argued:

      * a DAILY vwap alert (the encoding that carried the defect) contributes
        ZERO shadow rows — not a row with a 1970-derived value;
      * the intraday alerts around it still write theirs, so "zero" is a
        statement about that alert and not about a cycle that did not run.

    (The 31 rows actually armed on production are `tf="5"` —
    `alert_soak_matrix.DEFAULT_TF` — so on real tape this fix changes nothing
    they observe. This test covers the row that WOULD have been affected.)
    """
    daily_id = ias.create(user_id="u1", sym="WICK", indicator="vwap",
                          condition="above", threshold=1.0, tf="D")
    intraday_id = ias.create(user_id="u1", sym="WICK", indicator="vwap",
                             condition="above", threshold=1.0, tf="5")
    shadow.run_shadow_cycle()
    rows = shadow.shadow_rows()
    by_alert = {}
    for r in rows:
        by_alert.setdefault(r["alert_id"], []).append(r)

    assert daily_id not in by_alert, (
        "the daily vwap alert wrote a shadow row. Its bars carry YYYYMMDD `t`, "
        "so any value it produced came from a 1970-anchored session.")
    assert by_alert.get(intraday_id), (
        "the INTRADAY vwap alert wrote nothing either — then 'the daily one "
        "wrote nothing' is a statement about the fixture, not about the fix")
    assert all(r["value"] is not None for r in by_alert[intraday_id])


def test_the_shadow_lane_writes_ITS_OWN_store_and_it_is_not_auth_db(shadow_env):
    """The other half of "wrote nothing to the live table": it wrote SOMEWHERE."""
    assert shadow.db_path() != ias._DB_PATH
    shadow.run_shadow_cycle()
    rows = shadow.shadow_rows()
    assert rows, "the shadow lane recorded nothing at all"
    assert {r["alert_id"] for r in rows} == {a["id"] for a in ias.list_active()}
    assert any(r["triggered"] for r in rows), (
        "no shadow row is a WOULD-FIRE — the log records evaluations but never a "
        "fire, so the soak could not detect a difference in firing")
    assert all(r["bar_index"] is not None for r in rows), (
        "a shadow row has no bar_index — that is the field Task 11's fire-once "
        "needs and the reason `_evaluate_one_closed` returns it")
    # the live table still has no shadow table in it
    con = sqlite3.connect(str(shadow_env["auth_db"]))
    try:
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        con.close()
    assert "alert_shadow_fires" not in names


def test_the_shadow_lane_is_OFF_by_default(monkeypatch, tmp_path):
    """Default off, and the self-gate is what makes a manual call obey it too."""
    monkeypatch.delenv("ALERT_SHADOW_ENABLED", raising=False)
    assert shadow.shadow_enabled() is False
    monkeypatch.setattr(shadow, "_DB_PATH", str(tmp_path / "s.db"))
    summary = shadow.run_shadow_cycle()
    assert summary["skipped"] is True and summary["evaluated"] == 0
    monkeypatch.setenv("ALERT_SHADOW_ENABLED", "1")
    assert shadow.shadow_enabled() is True


def test_the_shadow_module_NAMES_no_write_or_delivery_function():
    """An AST scan, because "it does not call record_trigger" is a claim about
    every line of the file, not about the three I happened to read."""
    src = (_ROOT / "api" / "services" / "alert_shadow_log.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    forbidden = {"record_trigger", "record_evaluation", "deliver_alert_payload",
                 "_dispatch_delivery", "record_signal"}
    hits = []
    for node in ast.walk(tree):
        name = None
        if isinstance(node, ast.Attribute):
            name = node.attr
        elif isinstance(node, ast.Name):
            name = node.id
        if name in forbidden:
            hits.append(f"{name} at line {getattr(node, 'lineno', '?')}")
    assert hits == [], f"the shadow lane names a write/delivery function: {hits}"
    # …and the control: those names ARE reachable from the tree, so the scan is
    # looking for something that exists.
    live = (_ROOT / "api" / "services" / "indicator_alert_evaluator.py").read_text(
        encoding="utf-8")
    assert "record_trigger" in live and "_dispatch_delivery" in live


def test_the_delivery_cycle_NAMES_nothing_from_the_shadow_lane():
    """⛔ ITS OWN JOB, NOT A BRANCH INSIDE `_run_one_cycle`.

    Two jobs can be disabled independently; a branch cannot — switching the shadow
    off would mean editing the code path that DELIVERS, which is the one thing a
    soak must never be able to touch. The dependency runs shadow → evaluator and
    never back.
    """
    src = (_ROOT / "api" / "services" / "indicator_alert_evaluator.py").read_text(
        encoding="utf-8")
    tree = ast.parse(src)
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = [a.name for a in node.names]
            if getattr(node, "module", None):
                mods.append(node.module)
            if any("alert_shadow" in m for m in mods):
                hits.append(f"import at line {node.lineno}")
        if isinstance(node, ast.Name) and "shadow" in node.id.lower():
            hits.append(f"{node.id} at line {node.lineno}")
        if isinstance(node, ast.Attribute) and "shadow" in node.attr.lower():
            hits.append(f".{node.attr} at line {node.lineno}")
    assert hits == [], (
        f"the live evaluator reaches the shadow lane: {hits}. That makes the "
        "shadow a branch of delivery, and it can no longer be disabled alone.")


def test_the_shadow_job_is_registered_as_its_OWN_scheduler_job():
    """The other half of M5: the job has to EXIST, with its own id and its own flag.

    Parsed out of `api/main.py` rather than grepped, so a mention in a comment
    cannot satisfy it.
    """
    src = (_ROOT / "api" / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "add_job"):
            continue
        for kw in node.keywords:
            if kw.arg == "id" and isinstance(kw.value, ast.Constant) \
                    and kw.value.value == "indicator_alert_shadow_cycle":
                found.append(node.lineno)
    assert len(found) == 1, (
        f"expected exactly one add_job(id='indicator_alert_shadow_cycle'), got "
        f"{len(found)} at {found}. Without its own job the shadow lane cannot be "
        "turned off without turning off delivery.")
    assert "ALERT_SHADOW_ENABLED" in src, (
        "the shadow job is registered but nothing gates it — it would soak on "
        "every deploy whether anyone asked for it or not")
    # and the evaluator's own thread start is still a SEPARATE mechanism
    assert "indicator_alert_evaluator.start_evaluator" in src


def test_ALERT_EVAL_MODE_is_the_CLOSED_lane_and_is_assigned_exactly_once():
    """⛔ TASK 8 IS THE ONLY COMMIT PERMITTED TO CHANGE WHEN A LIVE ALERT FIRES.

    Shadow mode exists precisely so that day was a decision and not a side
    effect. It has now happened, in one commit, and this pins the value it left
    behind — a SECOND assignment would import with the second value and an
    equality check against the module attribute would happily agree with it.

    ⚠️ THE SHADOW LANE OUTLIVED ITS OWN PURPOSE HERE AND THAT IS A SEPARATE
    DECISION. `ALERT_SHADOW_ENABLED` is still an environment flag on production
    and `alert_shadow_fires` still grows at ~30 rows/minute, 24/7, with no
    retention. Turning it off is an operational step, not a code one, so it is
    named in the cutover record rather than silently assumed done.
    """
    assert ev.ALERT_EVAL_MODE == "closed"
    assert ev.eval_mode() == "closed"
    src = (_ROOT / "api" / "services" / "indicator_alert_evaluator.py").read_text(
        encoding="utf-8")
    assigns = [n for n in ast.walk(ast.parse(src))
               if isinstance(n, ast.Assign)
               and any(isinstance(t, ast.Name) and t.id == "ALERT_EVAL_MODE"
                       for t in n.targets)]
    assert len(assigns) == 1 and assigns[0].value.value == "closed"
