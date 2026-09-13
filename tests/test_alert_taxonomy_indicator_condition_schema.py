"""GATE-S7-INDICATOR-CONDITION Checkpoint 1 — registration, schema, and THE
CADENCE GATE (clause 3 of the completion plan's §2b three-clause gate).

⛔ The type must be DARK BY CONSTRUCTION, not by intention: no delivery import,
no read of the legacy alert row, no change to the two INERT STRANDS, and nothing
calling `register()` yet. Each is asserted FROM THE SOURCE rather than promised.

⛔ AND THE GATE MUST BE ABLE TO SAY BOTH WORDS. A gate that refuses everything is
indistinguishable from a gate that is broken, so the admission control
(`test_a_nightly_screener_metric_on_a_daily_bar_is_ADMITTED`) is not decoration —
it is what makes every refusal below mean something.
"""
from __future__ import annotations

import ast
import pathlib
import re

from api.services.alert_taxonomy import db as _db
from api.services.alert_taxonomy import indicator_condition as ic
from api.services.alert_taxonomy import registry as _registry
from api.services.canonical import address_book as _book

_REPO = pathlib.Path(__file__).resolve().parents[1]
_PKG = _REPO / "api" / "services" / "alert_taxonomy"
_MODULE = _PKG / "indicator_condition.py"
_HARNESS = _PKG / "indicator_condition_compare.py"
_LEGACY_SERVICE = _REPO / "api" / "services" / "indicator_alert_service.py"
_LEGACY_FIRES = _REPO / "api" / "services" / "alert_fired_log.py"


# ══════════════════════════════════════════════════════════════════════════
# CODE, NEVER PROSE — and the control that proves the stripper still sees code
# ══════════════════════════════════════════════════════════════════════════

#: ⛔⛔ DOCUMENTATION IS NOT ALWAYS A DOCSTRING IN THIS PACKAGE. `PARAMS_SCHEMA`
#: and `BLIND_SPOTS` are prose stored in string LITERALS, so a docstring-only
#: stripper hands them back as "code" — and this module's schema DESCRIBES the
#: legacy tables it must never touch.
_PROSE_CONSTANTS = ("PARAMS_SCHEMA", "BLIND_SPOTS")


def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE. This module discusses the legacy alert row, the
    evaluator and the inert strands at length — a naive substring search matches
    its own explanation and every absence assertion below would be red on the
    documentation that exists to prevent the thing being asserted."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _PROSE_CONSTANTS for t in node.targets):
            node.value = ast.Constant(value="<prose>")
    return ast.unparse(ast.fix_missing_locations(tree))


def test_the_stripper_sees_code_and_not_prose():
    """⛔ THE CONTROL FOR EVERY ABSENCE ASSERTION BELOW. Without it, a stripper
    that returned '' would make all of them pass over nothing."""
    code = _code_only(_MODULE)
    raw = _MODULE.read_text(encoding="utf-8")
    # (a) both needles ARE in the prose
    assert "indicator_alert_service" in raw
    assert "bars_sqlite" in raw
    # (b) and NEITHER is in the code
    assert "indicator_alert_service" not in code
    assert "bars_sqlite" not in code
    # (c) and the stripper still sees real code
    assert "def registration_refusal" in code
    assert "def cadence_for" in code
    assert "TYPE_ID = 'indicator-condition'" in code or 'TYPE_ID = "indicator-condition"' in code
    assert "register_trigger_type" in code
    assert len(code) > 500


# ══════════════════════════════════════════════════════════════════════════
# THE LEGACY SHAPES — derived by AST from the DDL, never retyped
# ══════════════════════════════════════════════════════════════════════════

def _module_constant(path: pathlib.Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return ast.literal_eval(node.value)
        if (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
                and node.target.id == name and node.value is not None):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} not found in {path.name} — the derivation is broken, not green")


_TABLE_CONSTRAINTS = ("UNIQUE", "PRIMARY", "FOREIGN", "CHECK", "CONSTRAINT")


def _create_table_columns(schema_sql: str, table: str) -> list[str]:
    """The column names of one `CREATE TABLE`, split at depth 0 so a typed
    default containing a comma cannot shear a column in half."""
    m = re.search(r"CREATE TABLE IF NOT EXISTS\s+%s\s*\((.*?)\n\)\s*;" % re.escape(table),
                  schema_sql, re.S)
    assert m, f"no CREATE TABLE for {table} — the regex missed, the table did not vanish"
    body, cols, depth, cur = m.group(1), [], 0, ""
    for ch in body:
        if ch == "(":
            depth += 1
        if ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            cols.append(cur)
            cur = ""
        else:
            cur += ch
    cols.append(cur)
    out = []
    for c in cols:
        c = c.strip()
        if not c:
            continue
        first = re.split(r"[\s(]", c)[0]
        if first.upper() in _TABLE_CONSTRAINTS:
            continue
        out.append(first)
    return out


def _alter_added_columns(path: pathlib.Path, name: str) -> list[str]:
    return [pair[0] for pair in _module_constant(path, name)]


def _derived_columns(path: pathlib.Path, table: str) -> list[str]:
    created = _create_table_columns(_module_constant(path, "_SCHEMA"), table)
    altered = _alter_added_columns(path, "_MIGRATIONS")
    return list(dict.fromkeys(created + altered))


_NUMBER_WORDS = {
    8: "EIGHT", 9: "NINE", 10: "TEN", 11: "ELEVEN", 12: "TWELVE",
    13: "THIRTEEN", 14: "FOURTEEN", 15: "FIFTEEN", 16: "SIXTEEN",
    17: "SEVENTEEN", 18: "EIGHTEEN", 19: "NINETEEN", 20: "TWENTY",
    21: "TWENTY-ONE", 22: "TWENTY-TWO", 23: "TWENTY-THREE",
    24: "TWENTY-FOUR", 25: "TWENTY-FIVE",
}


def test_the_derivation_actually_reads_the_ddl():
    """⛔ NON-VACUITY CONTROL — an empty result satisfies every assertion below.
    Named members, never a count: a derivation that returned `[]` and one that
    returned the wrong table both fail here by name."""
    fires = _derived_columns(_LEGACY_FIRES, "indicator_alert_fires")
    alerts = _derived_columns(_LEGACY_SERVICE, "indicator_alerts")
    assert "fire_key" in fires and "alert_id" in fires and "channels_failed" in fires
    assert "def_source" in alerts and "params_json" in alerts and "arm_epoch" in alerts
    # the two tables are genuinely different shapes, so the reader is not
    # accidentally deriving one of them twice
    assert "fire_key" not in alerts
    assert "def_source" not in fires


def test_the_docstring_reports_the_legacy_columns_as_derived_by_AST():
    """⛔ REPORTED BEFORE THE SCHEMA IS PINNED, and the report cannot drift.

    Every column the AST finds must appear in the module docstring, and the
    docstring's stated COUNT must equal the derived count — so a column added to
    either legacy table tomorrow turns this red instead of leaving a stale list
    in the file a reader trusts.
    """
    doc = ic.__doc__ or ""
    fires = _derived_columns(_LEGACY_FIRES, "indicator_alert_fires")
    alerts = _derived_columns(_LEGACY_SERVICE, "indicator_alerts")

    for col in fires:
        assert col in doc, f"{col} is an indicator_alert_fires column the docstring does not report"
    for col in alerts:
        assert col in doc, f"{col} is an indicator_alerts column the docstring does not report"

    assert _NUMBER_WORDS[len(fires)] in doc, (
        f"the docstring's count for indicator_alert_fires is not "
        f"{_NUMBER_WORDS[len(fires)]} ({len(fires)} columns derived)")
    assert _NUMBER_WORDS[len(alerts)] in doc, (
        f"the docstring's count for indicator_alerts is not "
        f"{_NUMBER_WORDS[len(alerts)]} ({len(alerts)} columns derived)")


def test_the_packets_eight_are_indicator_alerts_columns_and_the_divergence_is_recorded():
    """⚠️ The build packet asks for *"the eight `indicator_alert_fires`
    columns"*. Measured, that table has eighteen and only four of the eight are
    in it. The divergence is RECORDED in the module rather than quietly
    resolved."""
    fires = set(_derived_columns(_LEGACY_FIRES, "indicator_alert_fires"))
    alerts = set(_derived_columns(_LEGACY_SERVICE, "indicator_alerts"))
    eight = set(ic.PARAMS_SCHEMA)

    assert len(eight) == 8
    assert eight <= alerts, f"pinned keys that are not legacy columns: {sorted(eight - alerts)}"
    assert eight & fires == {"indicator", "condition", "threshold", "tf"}
    assert "DIVERGENCES FROM THE PACKET" in (ic.__doc__ or "")


def test_PARAMS_SCHEMA_pins_exactly_the_eight_the_gate_names():
    assert set(ic.PARAMS_SCHEMA) == {
        "indicator", "condition", "threshold", "tf",
        "params_json", "instance_id", "scope", "def_source"}


def test_sym_and_user_id_are_absent_because_the_predicate_row_owns_them():
    """⛔ Not an omission. `alert_predicates` carries `user_id` and
    `entity_scope` as COLUMNS; pinning them in `params` too would be a second
    authority over one value."""
    assert "sym" not in ic.PARAMS_SCHEMA
    assert "user_id" not in ic.PARAMS_SCHEMA
    ddl = _module_constant(_PKG / "db.py", "_SCHEMA")
    predicate_cols = _create_table_columns(ddl, "alert_predicates")
    assert "user_id" in predicate_cols and "entity_scope" in predicate_cols


def test_instance_missing_at_is_recorded_but_NOT_pinned_and_the_module_says_why():
    """It is a real column, it is deliberately NOT a `state`, and no member ever
    sends one — so it is documented rather than declared."""
    alerts = _derived_columns(_LEGACY_SERVICE, "indicator_alerts")
    assert "instance_missing_at" in alerts
    assert "instance_missing_at" not in ic.PARAMS_SCHEMA
    assert "instance_missing_at" in ic.PARAMS_SCHEMA["instance_id"]


def test_the_five_states_are_the_legacy_tuple():
    """⛔ A MIRROR IS ONLY HONEST WITH A RAIL ON IT."""
    from api.services import indicator_alert_service as svc
    assert ic.ALERT_STATES == svc.ALERT_STATES
    assert len(ic.ALERT_STATES) == 5


# ══════════════════════════════════════════════════════════════════════════
# REGISTRATION
# ══════════════════════════════════════════════════════════════════════════

def test_the_type_id_is_the_spec_s_id():
    assert ic.TYPE_ID == "indicator-condition"


def test_registration_round_trips_the_schema(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ic.register(db_path=p)
    types = {t["type_id"]: t for t in _registry.list_trigger_types(db_path=p)}
    assert "indicator-condition" in types
    assert types["indicator-condition"]["module"] == "api.services.alert_taxonomy.indicator_condition"
    assert types["indicator-condition"]["params_schema"] == ic.PARAMS_SCHEMA


def test_register_is_idempotent(tmp_path):
    p = str(tmp_path / "at.db")
    _db.init_db(db_path=p)
    ic.register(db_path=p)
    ic.register(db_path=p)
    rows = [t for t in _registry.list_trigger_types(db_path=p)
            if t["type_id"] == "indicator-condition"]
    assert len(rows) == 1, "a second boot must upsert, never duplicate"


# ══════════════════════════════════════════════════════════════════════════
# THE ADDRESS — the gate resolves one, never a bare metric name
# ══════════════════════════════════════════════════════════════════════════

def test_the_address_round_trips_the_books_own_grammar():
    addr = ic.build_address("ohlcv.c", "AAPL", "D", as_of="2026-09-12T20:00:00Z")
    assert addr == "uct://ohlcv.c@AAPL/D?as_of=2026-09-12T20:00:00Z"
    parsed = ic.parse_address(addr)
    assert parsed == {"metric": "ohlcv.c", "entity": "AAPL", "timeframe": "D",
                      "as_of": "2026-09-12T20:00:00Z", "provider": None}
    grammar = _book.book().get("address_grammar")
    assert grammar and grammar.startswith("uct://<metric>@<entity>/<timeframe>")


def test_a_malformed_address_is_None_and_never_a_partial_dict():
    """⛔ A caller handed `{"metric": ""}` would look the empty metric up, miss,
    and be told a store declares no cadence for it — a sentence about a store
    nobody found."""
    for bad in ("", "ohlcv.c@AAPL/D", "uct://ohlcv.c/D", "uct://ohlcv.c@AAPL",
                "uct://@AAPL/D", "uct://ohlcv.c@/D", None, 7):
        assert ic.parse_address(bad) is None, f"{bad!r} parsed as an address"


def test_the_timeframe_split_is_derived_from_the_book_and_agrees_with_the_lane():
    """⛔ NOT A FOURTH HAND-TYPED COPY of the (D, W, M) split. Derived from the
    book's own timeframe axis and cross-checked against the alert lane's own
    two maps — derive one from the other and prove it by MOVING the source."""
    from api.services import indicator_alert_evaluator as ev
    labels = ic.timeframe_labels()
    # NON-VACUITY: the axis is really there
    assert len(labels) >= 8, f"the book's timeframe axis is empty or short: {labels}"
    intraday = {c for c in labels if ic.timeframe_class(c) == ic.TF_INTRADAY}
    calendar = {c for c in labels if ic.timeframe_class(c) == ic.TF_CALENDAR}
    assert intraday == set(ev._TF_MINUTES), (
        f"the derived intraday set {sorted(intraday)} disagrees with the alert "
        f"lane's own {sorted(ev._TF_MINUTES)}")
    assert calendar == set(ev._CALENDAR_TFS), (
        f"the derived calendar set {sorted(calendar)} disagrees with the alert "
        f"lane's own {sorted(ev._CALENDAR_TFS)}")
    assert intraday and calendar and not (intraday & calendar)


def test_1m_and_1M_are_not_confused():
    """The entire hazard in a single-letter timeframe vocabulary, asserted."""
    assert ic.timeframe_class("1") == ic.TF_INTRADAY      # label "1m"
    assert ic.timeframe_class("M") == ic.TF_CALENDAR      # label "1M"


def test_an_undeclared_timeframe_is_never_guessed_into_a_class():
    for code in ("", "4H", "d", "1D", "Q", None):
        assert ic.timeframe_class(code) is None, f"{code!r} was classified"


# ══════════════════════════════════════════════════════════════════════════
# THE CADENCE GATE — clause 3
# ══════════════════════════════════════════════════════════════════════════

def _ohlcv_metrics() -> list[str]:
    metrics = _book.book().get("metrics") or {}
    return sorted(k for k, v in metrics.items() if v.get("store") == "bars_sqlite")


def _nightly_screener_metric() -> str:
    metrics = _book.book().get("metrics") or {}
    for name in sorted(metrics):
        m = metrics[name]
        if m.get("store") == "screener_rows" and m.get("cadence") == "nightly":
            return name
    raise AssertionError("the book declares no nightly screener metric — the fixture is gone")


def test_the_two_derivations_of_the_cadence_vocabulary_agree():
    """The metric population and the book's own `axis_report` summary must say
    the same thing — a summary that drifted from its own population is the
    defect this repo keeps re-committing."""
    declared = ic.declared_cadences()
    report = (_book.book().get("axis_report") or {}).get("cadences") or {}
    assert declared == {k for k in report if k != ic.UNDECLARED_LABEL}
    assert declared, "the book declares no cadence at all — the derivation is broken"


def test_the_book_declares_no_cadence_this_gate_has_no_ruling_for():
    """⛔ TOTALITY, ASSERTED RATHER THAN ASSUMED. If D2 adds a cadence tomorrow
    this goes red and forces a ruling, instead of letting an unknown refresh rate
    fall through a branch nobody wrote."""
    missing = ic.declared_cadences() - set(ic.CADENCE_MIN_BAR_CLASS)
    assert not missing, (
        f"the book declares {sorted(missing)} and this gate has no ruling for "
        f"them — decide, do not default")


def test_EVERY_ohlcv_predicate_REFUSES_ON_EVERY_TIMEFRAME_and_says_why():
    """⚠️ THE ACCEPTED CONSEQUENCE, ASSERTED. The bars store declares no cadence
    (D2's F-D2-2 — it varies by timeframe and is declared nowhere) and the
    declaration cannot ship here because `bars_sqlite.py` is
    reachable-but-unwatched by flow-worker, which is exactly why D2 CP2 refused
    the same edit. **This is the correct dark state, not a gap**, and the message
    has to name the axis so it reads as a missing declaration rather than as a
    quiet market."""
    metrics = _ohlcv_metrics()
    assert set(metrics) == {"ohlcv.o", "ohlcv.h", "ohlcv.l", "ohlcv.c", "ohlcv.v"}, (
        f"the bars store's metric set moved: {metrics}")
    codes = sorted(ic.timeframe_labels())
    assert codes, "no timeframes to test against — the control is vacuous"
    for metric in metrics:
        for code in codes:
            addr = ic.build_address(metric, "AAPL", code)
            assert ic.cadence_for(addr) is None, (
                f"{addr} resolved a cadence — the bars store declares none")
            refusal = ic.registration_refusal(
                {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": code},
                entity_ref="AAPL")
            assert refusal is not None, f"{addr} was ADMITTED"
            assert ic.REFUSAL_CADENCE_UNDECLARED in refusal, (
                f"{addr} refused for the wrong reason: {refusal}")
            assert "undeclared_by_this_store" in refusal
            assert "bars_sqlite" in refusal


def test_a_nightly_screener_metric_on_a_daily_bar_is_ADMITTED():
    """⛔⛔ THE NON-VACUITY CONTROL, AND IT IS THE LOAD-BEARING TEST IN THIS FILE.
    A gate that refuses everything is indistinguishable from a gate that is
    broken. Named member, never a count."""
    metric = _nightly_screener_metric()
    addr = ic.build_address(metric, "AAPL", "D")
    assert ic.cadence_for(addr) == "nightly"
    refusal = ic.registration_refusal(
        {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": "D"},
        entity_ref="AAPL")
    assert refusal is None, f"the gate refuses a metric it must admit ({metric} on D): {refusal}"


def test_a_nightly_metric_on_an_intraday_bar_is_REFUSED_as_the_2b_defect():
    """§2b's own words: it *"registers cleanly, evaluates cleanly, and never
    fires — and nothing distinguishes it from a condition that simply has not
    been met."*"""
    metric = _nightly_screener_metric()
    for code in ("1", "5", "15", "30", "60"):
        refusal = ic.registration_refusal(
            {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": code},
            entity_ref="AAPL")
        assert refusal is not None, f"{metric} on {code} was ADMITTED"
        assert ic.REFUSAL_CADENCE_SLOWER_THAN_BAR in refusal, refusal


def test_a_nightly_metric_is_admitted_on_EVERY_calendar_bar():
    metric = _nightly_screener_metric()
    for code in ("D", "W", "M"):
        assert ic.registration_refusal(
            {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": code},
            entity_ref="AAPL") is None, f"{metric} on {code} was refused"


def test_cadence_for_never_defaults_and_says_None_four_different_ways():
    """⛔ `None` for an unparseable address, an unknown metric, an undeclared
    timeframe and a store with no cadence — and NEVER 'nightly', NEVER
    'intraday'. A fallback here would be a second authority over a metric's
    refresh rate at the alert layer."""
    metric = _nightly_screener_metric()
    assert ic.cadence_for("not-an-address") is None
    assert ic.cadence_for(ic.build_address("no_such_metric_xyz", "AAPL", "D")) is None
    assert ic.cadence_for(ic.build_address(metric, "AAPL", "4H")) is None
    assert ic.cadence_for(ic.build_address("ohlcv.c", "AAPL", "5")) is None
    # ...and the one address that DOES resolve still resolves, so the four
    # `None`s above are not a broken reader
    assert ic.cadence_for(ic.build_address(metric, "AAPL", "D")) == "nightly"


def test_an_unresolved_address_is_a_DIFFERENT_refusal_from_an_undeclared_cadence():
    """⛔ Two facts, two sentences. Collapsing them would print a claim about a
    store this gate never found."""
    unknown = ic.registration_refusal(
        {"indicator": "no_such_metric_xyz", "condition": "above", "threshold": 1.0, "tf": "D"},
        entity_ref="AAPL")
    undeclared = ic.registration_refusal(
        {"indicator": "ohlcv.c", "condition": "above", "threshold": 1.0, "tf": "D"},
        entity_ref="AAPL")
    assert unknown and undeclared
    assert ic.REFUSAL_ADDRESS_UNRESOLVED in unknown
    assert ic.REFUSAL_CADENCE_UNDECLARED not in unknown
    assert ic.REFUSAL_CADENCE_UNDECLARED in undeclared
    assert ic.REFUSAL_ADDRESS_UNRESOLVED not in undeclared


def test_an_undeclared_timeframe_is_refused_by_the_address_gate():
    metric = _nightly_screener_metric()
    refusal = ic.registration_refusal(
        {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": "4H"},
        entity_ref="AAPL")
    assert refusal is not None and ic.REFUSAL_ADDRESS_UNRESOLVED in refusal


def test_cadence_can_answer_says_None_rather_than_False_when_it_has_no_ruling():
    """*"We have no ruling"* and *"no"* are different facts."""
    assert ic.cadence_can_answer("hourly", "D") is None
    assert ic.cadence_can_answer("nightly", "4H") is None
    assert ic.cadence_can_answer("nightly", "D") is True
    assert ic.cadence_can_answer("nightly", "5") is False


# ══════════════════════════════════════════════════════════════════════════
# THE REFUSAL FRAGMENTS — pairwise distinct, including from the legacy four
# ══════════════════════════════════════════════════════════════════════════

def _legacy_anchors() -> dict[str, str]:
    """Read from the module that owns them — never copied into this file."""
    from api.services import indicator_alert_service as svc
    return {
        "REFUSAL_UNJUDGEABLE_CONDITION": svc.REFUSAL_UNJUDGEABLE_CONDITION,
        "REFUSAL_INTRADAY_ONLY": svc.REFUSAL_INTRADAY_ONLY,
        "REFUSAL_NO_LEVEL": svc.REFUSAL_NO_LEVEL,
        "CLOSED_LANE_TRAILING_PAD": svc.CLOSED_LANE_TRAILING_PAD,
    }


def test_the_refusal_fragments_are_pairwise_distinct_including_from_the_legacy_four():
    """⛔ §3 item 2. Two gates once shared the phrase *"forming-bar fires are not
    ledger-grade"*, so a `pytest.raises(match=…)` STILL MATCHED with the mode
    lock deleted — a test that would have passed on a tree with the safety
    removed. Substring, not equality: a fragment contained in another is just as
    fatal to a `match=`."""
    anchors = dict(_legacy_anchors())
    for i, frag in enumerate(ic.REFUSAL_ANCHORS):
        anchors[f"new_{i}"] = frag
    assert len(anchors) == 8, "the anchor roster is short — the derivation is broken"
    names = sorted(anchors)
    for a in names:
        for b in names:
            if a == b:
                continue
            assert anchors[a] not in anchors[b], (
                f"{a} is a substring of {b} — a `match=` on {a} would be "
                f"satisfied by {b}'s gate, which is how a deleted safety passes")


def test_each_anchor_matches_its_own_message_and_no_other():
    """The distinctness above is about the CONSTANTS. This is about the
    SENTENCES the gate actually emits."""
    metric = _nightly_screener_metric()
    messages = {
        ic.REFUSAL_ADDRESS_UNRESOLVED: ic.registration_refusal(
            {"indicator": "no_such_metric_xyz", "condition": "above", "tf": "D"},
            entity_ref="AAPL"),
        ic.REFUSAL_CADENCE_UNDECLARED: ic.registration_refusal(
            {"indicator": "ohlcv.c", "condition": "above", "tf": "D"}, entity_ref="AAPL"),
        ic.REFUSAL_CADENCE_SLOWER_THAN_BAR: ic.registration_refusal(
            {"indicator": metric, "condition": "above", "tf": "5"}, entity_ref="AAPL"),
    }
    assert all(m for m in messages.values()), "a fixture stopped refusing"
    every_anchor = list(ic.REFUSAL_ANCHORS) + list(_legacy_anchors().values())
    for own, message in messages.items():
        for anchor in every_anchor:
            if anchor == own:
                assert anchor in message
            else:
                assert anchor not in message, (
                    f"the message anchored on {own!r} also contains {anchor!r}")


def test_the_unjudgeable_cadence_anchor_is_REACHABLE_and_not_dead_code(monkeypatch):
    """⛔ A branch nothing can reach is not a safety, it is decoration. The book
    declares only `nightly` today, so the branch is driven by removing that
    ruling — which is precisely the state the totality rail above exists to
    prevent, and the refusal is what happens if it ever arrives."""
    metric = _nightly_screener_metric()
    assert ic.cadence_can_answer("weekly-ish", "D") is None
    monkeypatch.setattr(ic, "CADENCE_MIN_BAR_CLASS", {})
    refusal = ic.registration_refusal(
        {"indicator": metric, "condition": "above", "threshold": 1.0, "tf": "D"},
        entity_ref="AAPL")
    assert refusal is not None and ic.REFUSAL_CADENCE_UNJUDGEABLE in refusal, refusal
    assert "nightly" in refusal, "the refusal must name the cadence it cannot judge"


# ══════════════════════════════════════════════════════════════════════════
# F-S7-IC-1 — the measured finding the packet does not contain
# ══════════════════════════════════════════════════════════════════════════

def test_the_legacy_alert_lane_and_the_book_share_NO_metric_names():
    """⛔⛔ MEASURED, AND IT MAKES THE ACCEPTED CONSEQUENCE LARGER THAN STATED.
    Named members, never a count: `close` and `ohlcv.c` are the same quantity
    under two names and nothing joins them."""
    from api.services import indicator_alert_evaluator as ev
    lane = set(ev.all_addresses())
    book_metrics = set((_book.book().get("metrics") or {}))
    assert lane and book_metrics, "one of the two vocabularies is empty — broken, not green"
    assert "close" in lane and "rsi" in lane
    assert "ohlcv.c" in book_metrics
    assert not (lane & book_metrics), (
        f"the two vocabularies now overlap on {sorted(lane & book_metrics)} — "
        f"F-S7-IC-1 has changed and the module docstring must be re-measured")
    assert "F-S7-IC-1" in (ic.__doc__ or "")


def test_every_legacy_address_refuses_today_and_the_anchor_is_the_ADDRESS_one():
    from api.services import indicator_alert_evaluator as ev
    for address in sorted(ev.all_addresses()):
        refusal = ic.registration_refusal(
            {"indicator": address, "condition": "above", "threshold": 1.0, "tf": "D"},
            entity_ref="AAPL")
        assert refusal is not None, f"{address} was ADMITTED by the cadence gate"
        assert ic.REFUSAL_ADDRESS_UNRESOLVED in refusal, (
            f"{address} refused for a reason other than the missing join: {refusal}")


# ══════════════════════════════════════════════════════════════════════════
# CP2 — a refusal, an absent value, a quiet bar and a fire are FOUR facts
# ══════════════════════════════════════════════════════════════════════════

def _admitted_params(**over):
    params = {"indicator": _nightly_screener_metric(), "condition": "above",
              "threshold": 10.0, "tf": "D"}
    params.update(over)
    return params


def test_would_fire_keeps_refused_no_value_quiet_and_fired_APART():
    """⛔⛔ THIS CHECKPOINT'S WHOLE THESIS. A boolean collapses three of these
    into `False`, which is exactly the state §2b says a member cannot tell apart
    — reproduced inside the instrument built to measure it."""
    ok = _admitted_params()
    assert ic.would_fire({"indicator": "ohlcv.c", "condition": "above",
                          "threshold": 10.0, "tf": "D"},
                         entity_ref="AAPL", value=99.0)["outcome"] == ic.OUTCOME_REFUSED
    assert ic.would_fire(ok, entity_ref="AAPL", value=None)["outcome"] == ic.OUTCOME_NO_VALUE
    assert ic.would_fire(ok, entity_ref="AAPL", value=1.0)["outcome"] == ic.OUTCOME_QUIET
    assert ic.would_fire(ok, entity_ref="AAPL", value=99.0)["outcome"] == ic.OUTCOME_FIRED
    assert len(set(ic.OUTCOMES)) == 4


def test_a_refused_predicate_carries_the_reason_and_a_quiet_one_carries_none():
    ok = _admitted_params()
    refused = ic.would_fire({"indicator": "ohlcv.c", "condition": "above",
                             "threshold": 10.0, "tf": "D"}, entity_ref="AAPL", value=99.0)
    quiet = ic.would_fire(ok, entity_ref="AAPL", value=1.0)
    assert refused["refusal"] and refused["triggered"] is None and refused["fire_key"] is None
    assert quiet["refusal"] is None and quiet["triggered"] is False


def test_the_dark_rule_DRIVES_check_condition_rather_than_restating_it():
    """⛔ Not a mirror. If the real decider changes its mind, so does this — the
    only way a migration measures two RULES rather than two implementations."""
    from api.services.alert_conditions import check_condition
    ok = _admitted_params(condition="below", threshold=5.0)
    for value in (1.0, 5.0, 9.0):
        expected = check_condition("below", value, None, 5.0)
        got = ic.would_fire(ok, entity_ref="AAPL", value=value)["triggered"]
        assert got is expected, f"value={value}: dark={got} real={expected}"


def test_the_fire_key_is_the_REAL_one_and_the_two_families_differ():
    from api.services import alert_fired_log as fl
    level = ic.would_fire(_admitted_params(condition="above", threshold=1.0),
                          entity_ref="AAPL", value=9.0, bar_time=20260912, arm_epoch=7)
    assert level["fire_key"] == fl.fire_key("above", 20260912, 7) == "ep:7"
    cross = ic.would_fire(_admitted_params(condition="cross_above", threshold=5.0),
                          entity_ref="AAPL", value=9.0, prev_value=1.0,
                          bar_time=20260912, arm_epoch=7)
    assert cross["fire_key"] == fl.fire_key("cross_above", 20260912, 7) == "bar:20260912"


def test_the_fingerprint_moves_on_what_changes_firing_and_not_on_what_does_not():
    base = _admitted_params()
    same = dict(base, scope="chart-42", def_source="user", instance_id="i-9")
    assert ic.predicate_fingerprint(base) == ic.predicate_fingerprint(same), (
        "scope / def_source / instance_id are not firing identity — closing a "
        "span for one silently converts real observations into not_comparable")
    for field, value in (("indicator", "other"), ("condition", "below"),
                         ("threshold", 11.0), ("tf", "W"),
                         ("params_json", '{"period": 50}')):
        assert ic.predicate_fingerprint(dict(base, **{field: value})) != \
            ic.predicate_fingerprint(base), f"{field} left the fingerprint unchanged"


# ══════════════════════════════════════════════════════════════════════════
# DARK BY CONSTRUCTION
# ══════════════════════════════════════════════════════════════════════════

def test_the_type_module_imports_NO_delivery():
    code = _code_only(_MODULE)
    for forbidden in ("deliver_alert_payload", "watchlist_alert_service",
                      "send_email", "discord", "receipts"):
        assert forbidden not in code, f"{forbidden} reached the type module's CODE"


def test_the_type_module_never_reads_the_legacy_alert_row():
    code = _code_only(_MODULE)
    assert "indicator_alerts" not in code, (
        "the type module names the legacy alert table in CODE — CP1 reads no "
        "member row, and CP3 is the line that changes that")
    assert "list_active" not in code


def test_the_gate_does_NOT_live_in_the_inert_strand():
    """⛔ §6 item 1. `indicator_alert_service.py` is reachable-but-unwatched by
    flow-worker: flow-worker RUNS it and would run a stale copy of any guard
    added there. Asserted from the legacy file's own source, both ways."""
    legacy = _code_only(_LEGACY_SERVICE)
    for anchor in ic.REFUSAL_ANCHORS:
        assert anchor not in legacy
    assert "cadence" not in legacy, (
        "a cadence gate has appeared in the INERT STRAND — flow-worker runs that "
        "file and does not watch it")
    # ...and the new module does not import it either
    assert "indicator_alert_service" not in _code_only(_MODULE)


def test_the_type_module_does_not_declare_a_cadence_anywhere():
    """⛔ CP1 SHIPS THE GATE AND MUST NOT SHIP THE DECLARATION (§4.4). A cadence
    written here would be the second authority the book exists to end."""
    code = _code_only(_MODULE)
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
            if "CADENCE_MIN_BAR_CLASS" in names or "CADENCE_NIGHTLY" in names:
                continue
            src = ast.unparse(node.value)
            assert "nightly" not in src, f"a cadence is declared at {names}: {src}"
    book_src = _code_only(_REPO / "api" / "services" / "canonical" / "address_book.py")
    assert "nightly" not in book_src, "the accessor gained a cadence default"


def test_neither_module_opens_the_books_json_file():
    """⛔ D2's own rail (`test_exactly_the_named_module_reads_the_address_book`)
    fails any module under `api/` whose STRIPPED CODE carries the manifest's file
    name, and it approved exactly ONE reader. This type reads the book THROUGH
    that reader, which is allowed — but a helpful error message naming the
    builder file tripped the rail on the first draft, so the absence is pinned
    here too rather than rediscovered by a red in someone else's suite.

    ⚠️ §5.1 of the gate packet: the rail constrains WHO OPENS THE JSON FILE, not
    who reads the book. An S7 evaluator reading through `address_book.metric()`
    is NOT announced by it, and this test does not pretend otherwise."""
    for path in (_MODULE, _HARNESS):
        assert "canonical_address_book" not in _code_only(path), path.name
    # NON-VACUITY — the type module really does read the book, through the one
    # module D2 named.
    assert "address_book" in _code_only(_MODULE)


def test_there_is_no_replay_fn_and_both_modules_say_why():
    for path in (_MODULE, _HARNESS):
        code = _code_only(path)
        assert "replay_fn" not in code
        raw = path.read_text(encoding="utf-8")
        assert "FORWARD-ONLY" in raw or "NO REPLAY" in raw


def test_this_type_is_wired_in_main_because_CP3_IS_SIGNED_and_nowhere_else():
    """⛔ REGISTRATION IS NOT ACTIVATION, AND CP3 IS THE LINE THAT ASKS FOR IT.

    ⚰️ UPDATED BY NAMING, 2026-09-13. This asserted `"indicator_condition" not in
    main` and was CORRECT for CP1-CP2: registration was deliberately withheld
    until its own approval line. CP3 is now signed (GATE-S7-INDICATOR-CONDITION
    approval line 3, fingerprint `4e8d3af5d`, its D2 §9.5 dependency discharged
    by GATE-D2 CP4 `3257cc319`/`404b808c5`), so the assertion is INVERTED rather
    than deleted — a boundary that stops being checked in either direction is a
    boundary nobody is holding.

    ⛔ `alerts.py` STAYS CLEAN. Registration belongs in `main.py`; the S7 feed
    bridge is not this type's door and wiring it there would put the module into
    a second import path nobody classified."""
    main = _code_only(_REPO / "api" / "main.py")
    assert "indicator_condition" in main, "CP3 is signed and register() is not wired"
    assert "_at_indicator_cond.register()" in main
    alerts = _code_only(_REPO / "api" / "services" / "alerts.py")
    assert "indicator_condition" not in alerts, "it leaked into the feed bridge"


def _modules_naming(needle: str) -> set:
    """Every module under `api/` whose STRIPPED code names `needle`."""
    out = set()
    for path in sorted((_REPO / "api").rglob("*.py")):
        try:
            code = _code_only(path)
        except SyntaxError:                                  # pragma: no cover
            continue
        if needle in code:
            out.add(path.name)
    return out


def test_the_callers_of_the_type_module_are_exactly_the_declared_three():
    """§2a item 3: *what calls this, and which test fails if that wire is cut?*

    ⚰️ UPDATED BY NAMING, 2026-09-13. This asserted the harness was the ONLY
    caller, which was true and load-bearing at CP1-CP2. CP3 adds exactly two
    more by design — the projection, and `main.py`'s registration — so the set
    is WIDENED TO A DECLARED ONE rather than loosened to a `>=`. A membership
    test that only ever grows is not a test.

    ⭐ The projection is what the sweep calls; `main.py` is where `register()`
    lives. A FOURTH name appearing here is a wire nobody classified, and that is
    exactly what this fails on.
    """
    naming = _modules_naming("indicator_condition")
    # ⚠️ The type module does NOT appear here and that is correct: it names
    # itself only through `__name__`, which carries no literal.
    assert naming == {"indicator_condition_compare.py",
                      "indicator_condition_projection.py",
                      "main.py"}, (
        f"the caller set changed: {sorted(naming)}")
    # NON-VACUITY CONTROL — the same scan finds a sibling it is not looking for,
    # so an empty answer above cannot be a broken walk.
    control = _modules_naming("catalyst_match")
    assert "catalyst_match_compare.py" in control, (
        f"the source walk is broken, not green: {sorted(control)}")
