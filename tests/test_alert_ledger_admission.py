"""The ledger door — who may write the Signature receipts ledger, and on what.

⭐ THE CONSTRAINT THIS FILE CLOSES HAS BEEN CARRIED SINCE B1: *nothing enters the
ledger unless it is closed-bar evaluated*. Until now that was an ABSENCE — two
comments in `indicator_alert_evaluator.py` saying the fires "are not
ledger-grade" and no code anywhere that would stop one. An absence stops being a
control the moment it stops being true, and this task is the moment it stops
being true, so the absence becomes a gate:

  * a CENSUS over `ledger.record_signal` callers, by `==` on the derived set and
    never `in` — a `toContain` cannot find a caller nobody thought of; and
  * a behavioural refusal that **RAISES**. `record_signal` already returns False
    for exactly one thing — "already recorded" — and its own docstring calls a
    dropped write reported as a duplicate *"the one lie fire-once cannot
    survive"*. A refusal that returned False would be that lie.

⛔ AND THE REFUSED FIRE IN THIS FILE IS A REAL ONE. `wick_that_unwinds` bar 53 is
the frozen fixture whose HIGH takes RSI to 74.31 and whose CLOSE does not; the
forming lane fires on it at k=4 and Task 2 recorded that fire by index, sample
and value. Every refusal test below asserts that fire EXISTS before asserting it
is refused — a door that admits nothing because nothing knocked is the vacuous
pass this whole phase is written against.
"""

from __future__ import annotations

import ast
import json
import os
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar                                        # noqa: E402
import api.services.alerts as _alerts_mod                        # noqa: E402
from api.services import alert_fired_log as fl                   # noqa: E402
from api.services import alert_user_series as aus                # noqa: E402
from api.services import indicator_alert_evaluator as ev         # noqa: E402
from api.services import indicator_alert_service as ias          # noqa: E402
from api.services import user_definitions as ud                  # noqa: E402
from api.services import watchlist_alert_service as wls          # noqa: E402
from api.services.signature import ledger                        # noqa: E402


# ─── the census scanner ──────────────────────────────────────────────────────
#
# ⛔ RESOLVED, NOT GREPPED. `api/services/ai_search_log.py` defines its OWN
# `record_signal` (a thumbs-up on an AI answer) and `api/routers/ai_search.py`
# calls it. A text scan for `record_signal` names that file as a ledger writer,
# and a text scan for the literal `ledger.record_signal` is blind to
# `from ... import ledger as L`. So the scanner binds names from the file's own
# imports and classifies each CALL by what its callee actually resolves to —
# and `test_the_census_SEES_the_record_signal_that_is_not_the_ledgers` is the
# control proving it does the harder job rather than the easy one.

_LEDGER_MODULE = "api.services.signature.ledger"
_LEDGER_PKG = "api.services.signature"


def _dotted(node) -> str | None:
    """`a.b.c` → "a.b.c" for a Name/Attribute chain, else None."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _bindings(tree: ast.AST) -> tuple[set[str], set[str]]:
    """(names bound to the ledger MODULE, names bound to `record_signal` itself)."""
    module_names: set[str] = set()
    direct_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == _LEDGER_MODULE:
                    module_names.add(a.asname or a.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            # Relative imports keep only their tail here; matching on the tail is
            # what lets `from .signature import ledger` resolve at all.
            if mod == _LEDGER_PKG or mod.endswith(".signature") or mod == "signature":
                for a in node.names:
                    if a.name == "ledger":
                        module_names.add(a.asname or a.name)
            if mod == _LEDGER_MODULE or mod.endswith(".signature.ledger"):
                for a in node.names:
                    if a.name == "record_signal":
                        direct_names.add(a.asname or a.name)
                    elif a.name == "*":
                        direct_names.add("record_signal")
    return module_names, direct_names


def _record_signal_call_sites(scan_root: pathlib.Path,
                              rel_to: pathlib.Path | None = None
                              ) -> tuple[set[str], set[str]]:
    """Every `record_signal(...)` CALL under ``scan_root``, split two ways.

    Returns ``(ledger_callers, other_callers)`` as POSIX paths relative to
    ``rel_to`` (default: ``scan_root``). A file appears in a set once, however
    many calls it holds — the question is *which files may write the ledger*.
    """
    base = rel_to or scan_root
    ledger_callers: set[str] = set()
    other_callers: set[str] = set()
    for path in sorted(scan_root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):        # pragma: no cover
            continue
        module_names, direct_names = _bindings(tree)
        rel = path.relative_to(base).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            if isinstance(fn, ast.Attribute) and fn.attr == "record_signal":
                dotted = _dotted(fn) or ""
                head = dotted.rsplit(".", 1)[0] if "." in dotted else ""
                if head in module_names or dotted.endswith(f"{_LEDGER_MODULE}.record_signal"):
                    ledger_callers.add(rel)
                else:
                    other_callers.add(rel)
            elif isinstance(fn, ast.Name) and fn.id in direct_names:
                ledger_callers.add(rel)
            elif isinstance(fn, ast.Name) and fn.id == "record_signal":
                other_callers.add(rel)
    return ledger_callers, other_callers


# ─── Step 1: the census ──────────────────────────────────────────────────────

def test_only_the_sanctioned_callers_write_the_signal_ledger():
    """⛔ `==` ON THE DERIVED CALLER SET, NEVER `in`.

    B5's `controlDoorCensus.test.js` found door seven's THIRD site on its first
    run — a site no ledger walk and no discovery scan could see. A containment
    check cannot find a caller nobody thought of; an equality on the derived set
    fails the moment a fourth writer appears, and names it.
    """
    callers, _ = _record_signal_call_sites(_ROOT / "api", rel_to=_ROOT)
    assert callers == {
        "api/routers/signature.py",                     # the FCB request path
        "api/services/signature/sweep.py",              # the nightly sweep
        "api/services/indicator_alert_evaluator.py",    # NEW, and gated below
    }


def test_the_census_SEES_the_record_signal_that_is_not_the_ledgers():
    """The control that the census RESOLVES rather than pattern-matches.

    `ai_search_log.record_signal` is a different function with the same name.
    A scanner that reported it as a ledger writer would fail the census above
    for the wrong reason; one that never saw it at all could be matching a
    literal string and would be blind to an aliased import. So: it must be
    SEEN, and it must be classified as NOT the ledger.
    """
    ledger_callers, other = _record_signal_call_sites(_ROOT / "api", rel_to=_ROOT)
    assert "api/routers/ai_search.py" in other, (
        "the scanner did not even see `ai_search_log.record_signal` — it is not "
        "resolving calls, so the census above proves nothing"
    )
    assert "api/routers/ai_search.py" not in ledger_callers


@pytest.mark.parametrize("source,expected", [
    ("from api.services.signature import ledger\n"
     "def f():\n    ledger.record_signal('i','v','S','1D','bull',1,1.0)\n", True),
    ("from api.services.signature import ledger as L\n"
     "def f():\n    L.record_signal('i','v','S','1D','bull',1,1.0)\n", True),
    ("from api.services.signature.ledger import record_signal\n"
     "def f():\n    record_signal('i','v','S','1D','bull',1,1.0)\n", True),
    ("import api.services.signature.ledger\n"
     "def f():\n    api.services.signature.ledger.record_signal("
     "'i','v','S','1D','bull',1,1.0)\n", True),
    ("from api.services import ai_search_log\n"
     "def f():\n    ai_search_log.record_signal('a','save')\n", False),
])
def test_the_census_detects_a_caller_it_has_never_seen(tmp_path, source, expected):
    """The negative fixture, in five spellings.

    Task 1's `namesIndicators` survived a mutation because its fixture used bare
    words the scanner structurally could not match — caught only by the rule
    that a negative fixture must TRIP the raw scan. So the scanner is driven
    against files that do not exist in the tree: four ways of reaching the
    ledger, and one same-named function that is not it.
    """
    (tmp_path / "planted.py").write_text(source, encoding="utf-8")
    ledger_callers, other = _record_signal_call_sites(tmp_path)
    assert ("planted.py" in ledger_callers) is expected
    assert ("planted.py" in other) is (not expected)


# ─── the ledger DB fixture ───────────────────────────────────────────────────

@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))   # BOTH — env AND constant
    monkeypatch.setattr(ledger, "_INITED", False)
    return p


def _rows_on_disk(path) -> int:
    """Read straight off the file, bypassing the module entirely."""
    if not pathlib.Path(path).exists():
        return 0
    with sqlite3.connect(str(path)) as c:
        try:
            return c.execute("SELECT COUNT(*) FROM signature_signals").fetchone()[0]
        except sqlite3.OperationalError:
            return 0


def _all_rows(path) -> list[tuple]:
    """Every column of every row, ordered — for a field-by-field comparison."""
    if not pathlib.Path(path).exists():
        return []
    with sqlite3.connect(str(path)) as c:
        c.row_factory = sqlite3.Row
        return [tuple(r) for r in c.execute(
            "SELECT id, indicator, version, sym, tf, direction, bar_time, price,"
            " first_seen_at, meta_json FROM signature_signals ORDER BY id")]


# ─── the fire that is refused, and the proof it exists ───────────────────────

WICK = ar.load_fixture("wick_that_unwinds")["bars"]
WICK_TF = "5"


def _alert(indicator="rsi", condition="cross_above", threshold=70.0, tf=WICK_TF,
           sym="NVDA", last_value=None):
    return {"id": 42, "user_id": "u", "sym": sym, "tf": tf,
            "indicator": indicator, "condition": condition,
            "threshold": threshold, "params_json": None,
            "last_value": last_value, "alert_key": "k"}


def test_the_forming_bar_fire_this_file_refuses_ACTUALLY_EXISTS():
    """⛔ THE NON-VACUITY OF EVERY REFUSAL BELOW.

    A refusal test whose fixture produced no fire refuses nothing and passes
    anyway. So the fire is measured first, from the committed fixture, through
    the shipped forming lane: exactly ONE, on bar 53, at sample 1 of 4 — i.e.
    mid-bar, on the wick — with the value Task 2 froze.
    """
    fires = ar.replay(WICK, [ar.rsi_cross_above_70()], k=4,
                      evaluate=ar.make_forming_evaluate())
    assert len(fires) == 1, f"expected the one wick fire, got {fires!r}"
    (fire,) = fires
    assert fire["bar_index"] == 53 and fire["sample"] == 1
    assert fire["bar_time"] == WICK[53]["t"] == 1761913500
    assert fire["value"] == pytest.approx(74.31)
    # …and the bar it fired on had NOT closed when it fired: sample 1 of 4 in a
    # 5-minute bar is 75 seconds in.
    assert WICK[53]["c"] == 102.85 and WICK[53]["h"] == 105.55


def _mid_bar_53_epoch() -> float:
    """The instant the wick fire happened: 1/4 of the way into bar 53."""
    return float(WICK[53]["t"]) + 75.0


def test_the_alert_lane_CANNOT_write_the_ledger_while_the_mode_is_forming(
        tmp_ledger, monkeypatch):
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "forming")
    with pytest.raises(RuntimeError, match="forming-bar fires are not ledger-grade"):
        ev.admit_alert_fire(_alert(), 74.31, bar_index=53, bars=WICK,
                            now_epoch=_mid_bar_53_epoch())
    assert _rows_on_disk(tmp_ledger) == 0
    assert ledger.get_signals() == []


def test_the_refusal_is_a_RAISE_and_never_a_False(tmp_ledger, monkeypatch):
    """`False` is spoken for. It means "already recorded" and nothing else.

    A refusal that returned False would be indistinguishable from a duplicate,
    which is precisely the failure `record_signal`'s own docstring calls the one
    lie fire-once cannot survive. So the forming-mode call must raise even when
    every OTHER condition is satisfied — a fully closed bar, a real value.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "forming")
    long_after = float(WICK[-1]["t"]) + 86_400.0
    with pytest.raises(RuntimeError, match="forming-bar fires are not ledger-grade"):
        ev.admit_alert_fire(_alert(condition="above", threshold=60.0), 68.84,
                            bar_index=65, bars=WICK, now_epoch=long_after)
    assert _rows_on_disk(tmp_ledger) == 0


def test_even_in_CLOSED_mode_a_bar_that_has_not_closed_is_refused(
        tmp_ledger, monkeypatch):
    """The second lock, and it is independent of the first.

    The mode is a global; *this bar has closed* is a fact about one bar and one
    clock. Flipping the mode must not be enough to admit the wick fire, because
    at the instant it fired bar 53 still had 225 seconds to run — and it is the
    bar being still open, not the constant, that makes the fire a repaint.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    with pytest.raises(RuntimeError, match="has not closed"):
        ev.admit_alert_fire(_alert(), 74.31, bar_index=53, bars=WICK,
                            now_epoch=_mid_bar_53_epoch())
    assert _rows_on_disk(tmp_ledger) == 0


def test_a_bar_index_outside_the_window_is_refused(tmp_ledger, monkeypatch):
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    long_after = float(WICK[-1]["t"]) + 86_400.0
    for bad in (-1, len(WICK), 10_000, None, True, "53"):
        with pytest.raises(RuntimeError, match="bar_index"):
            ev.admit_alert_fire(_alert(), 68.84, bar_index=bad, bars=WICK,
                                now_epoch=long_after)
    assert _rows_on_disk(tmp_ledger) == 0


def test_a_timeframe_the_product_cannot_spell_is_refused_not_guessed(
        tmp_ledger, monkeypatch):
    """The create path validates nothing, so `tf` can be anything at all.

    Guessing a label for `4h` writes a spelling into an append-only column that
    has no rewrite path. Refusing is the only correction this store has.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    long_after = float(WICK[-1]["t"]) + 86_400.0
    with pytest.raises(RuntimeError, match="no product timeframe label"):
        ev.admit_alert_fire(_alert(tf="4h"), 68.84, bar_index=65, bars=WICK,
                            now_epoch=long_after)
    assert _rows_on_disk(tmp_ledger) == 0


# ─── the positive control: a closed-bar fire DOES land, exactly once ─────────

def _closed_fire(alert, now_epoch):
    value, triggered, idx = ev._evaluate_one_closed(alert, bars=WICK,
                                                    now_epoch=now_epoch)
    assert triggered is True and value is not None and idx is not None, (
        f"the closed lane did not fire — nothing to admit ({value}, {triggered}, {idx})"
    )
    return value, idx


def test_a_closed_bar_fire_lands_exactly_one_row_and_a_re_run_lands_none(
        tmp_ledger, monkeypatch):
    """The Step-4 measurement, and the door's whole purpose.

    One row per `(indicator, version, sym, tf, bar_time, direction)`; running
    the same cycle again produces ZERO new rows because `record_signal` returns
    False for the one thing False means.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    now = float(WICK[-1]["t"]) + 86_400.0
    alert = _alert(condition="above", threshold=60.0)
    value, idx = _closed_fire(alert, now)

    assert ev.admit_alert_fire(alert, value, bar_index=idx, bars=WICK,
                               now_epoch=now) is True
    assert _rows_on_disk(tmp_ledger) == 1

    for _ in range(3):
        assert ev.admit_alert_fire(alert, value, bar_index=idx, bars=WICK,
                                   now_epoch=now) is False
    assert _rows_on_disk(tmp_ledger) == 1


def test_the_row_uses_the_PRODUCT_timeframe_label_never_the_bars_store_key(
        tmp_ledger, monkeypatch):
    """`tf` is "5m". The alert's own `tf` is "5" — the bars-store key it passes
    to `bars_sqlite.get_bars`. Ten rows of real history are keyed in the product
    vocabulary and the store has no rewrite path, so a receipt spelled the other
    way is an orphan forever.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    now = float(WICK[-1]["t"]) + 86_400.0
    alert = _alert(condition="above", threshold=60.0)
    value, idx = _closed_fire(alert, now)
    ev.admit_alert_fire(alert, value, bar_index=idx, bars=WICK, now_epoch=now)

    (row,) = ledger.get_signals("NVDA")
    assert alert["tf"] == "5"
    assert row["tf"] == "5m"
    assert row["bar_time"] == WICK[idx]["t"]
    assert row["price"] == pytest.approx(WICK[idx]["c"])


def test_the_row_names_the_ALERT_LANE_address_not_the_chart_plot_address(
        tmp_ledger, monkeypatch):
    """The subtler one, because `"rsi.rsi"` looks MORE correct.

    The chart engine addresses a plot as `<definitionId>.<plotKey>`; the alert
    lane's own vocabulary is `INDICATOR_FUNCS`' keys, and the two genuinely
    differ (`williams_r` is `williamsR` there, and `price_vs_ma` has no chart
    definition at all). The ledger's `indicator` column is a KEY column — two
    vocabularies in it means the same signal keys two ways.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    now = float(WICK[-1]["t"]) + 86_400.0
    # Stored in a spelling the create path never validated — resolution folds it.
    alert = _alert(indicator="RSI", condition="above", threshold=60.0)
    value, idx = _closed_fire(alert, now)
    ev.admit_alert_fire(alert, value, bar_index=idx, bars=WICK, now_epoch=now)

    (row,) = ledger.get_signals("NVDA")
    assert row["indicator"] == "rsi"
    assert row["indicator"] in ev.INDICATOR_FUNCS or row["indicator"] in ev.EVENT_FUNCS
    assert "." not in row["indicator"] or row["indicator"] in ev.INDICATOR_FUNCS
    assert row["direction"] == "above"
    assert row["version"] == ev.ALERT_LEDGER_VERSION
    assert json.loads(row["meta_json"])["value"] == pytest.approx(value)


# ─── the ledger's own new guard ──────────────────────────────────────────────

def test_the_ledger_itself_refuses_a_bars_store_timeframe_key(tmp_ledger):
    """Enforced INSIDE the store, not in the caller — the wire/store.py
    precedent this module's docstring already states. A future writer that
    bypasses `admit_alert_fire` must still hit this rail."""
    for bad in ("D", "W", "M", "1", "5", "15", "30", "60", "1d", "daily", "4h"):
        with pytest.raises(ValueError, match="product timeframe"):
            ledger.record_signal("fcb", "fcb-v1", "NVDA", bad, "bull", 20260730, 1.0)
    assert _rows_on_disk(tmp_ledger) == 0


def test_the_ledgers_timeframe_guard_accepts_every_label_the_chart_shows(tmp_ledger):
    """The positive control on the guard above — a whitelist that refused a
    legitimate timeframe would silently drop real receipts, which in an
    append-only store is unfixable."""
    for i, good in enumerate(("1m", "5m", "15m", "30m", "1h", "1D", "1W", "1M")):
        assert ledger.record_signal("fcb", "fcb-v1", "NVDA", good, "bull",
                                    20260730 + i, 1.0) is True
    assert _rows_on_disk(tmp_ledger) == 8


# ─── the non-measurement assertion: the existing rows do not move ────────────

_TEN = [("fcb", "fcb-v2", "NVDA", "1D", "bull", 20260721, 178.10),
        ("fcb", "fcb-v2", "AMD", "1D", "bear", 20260722, 151.40),
        ("fcb", "fcb-v2", "SPY", "1D", "bull", 20260723, 611.02),
        ("fcb", "fcb-v2", "QQQ", "1D", "bull", 20260724, 552.77),
        ("fcb", "fcb-v2", "TSLA", "1D", "bear", 20260727, 305.19),
        ("fcb", "fcb-v2", "MSFT", "1D", "bull", 20260728, 512.63),
        ("fcb", "fcb-v2", "AAPL", "1D", "bull", 20260729, 229.44),
        ("fcb", "fcb-v2", "META", "1D", "bear", 20260730, 718.05),
        ("fcb", "fcb-v2", "AVGO", "1D", "bull", 20260731, 305.88),
        ("fcb", "fcb-v2", "NFLX", "1D", "bull", 20260803, 1204.5)]


def test_the_ten_pre_existing_rows_are_byte_identical_after_a_full_cycle(
        tmp_ledger, monkeypatch):
    """⛔ THE NON-MEASUREMENT ASSERTION.

    The store is append-only and has no rewrite path, so a change to a row that
    already exists is unreconstructable. Read out field by field before, run a
    full admit cycle twice over several alerts, read out again.
    """
    for args in _TEN:
        assert ledger.record_signal(*args, meta={"seed": True}) is True
    before = _all_rows(tmp_ledger)
    assert len(before) == 10

    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    now = float(WICK[-1]["t"]) + 86_400.0
    landed = 0
    for spec in (("rsi", "above", 60.0), ("rsi", "below", 90.0),
                 ("mfi", "above", 10.0), ("cci", "above", -200.0)):
        alert = _alert(indicator=spec[0], condition=spec[1], threshold=spec[2])
        value, idx = _closed_fire(alert, now)
        for _ in range(2):                              # the cycle, run twice
            landed += bool(ev.admit_alert_fire(alert, value, bar_index=idx,
                                               bars=WICK, now_epoch=now))
    assert landed == 4, "the cycle must add four NEW rows and re-add none"

    after = _all_rows(tmp_ledger)
    assert len(after) == 14
    assert after[:10] == before, "a pre-existing ledger row MOVED"


# ═══ PHASE D TASK 12 — THE DOOR STAYS SHUT FOR USER-AUTHORED FORMULAS ════════
#
# ⭐ SPEC §12: user publishing is out of scope *until the ledger can hold
# publishers accountable*. Phase D lets a user's own formula reach a path that
# can send a NOTIFICATION; it does not let one accrue a RECEIPT. The receipts
# brand is UCT's own signals (§10), the store is append-only with no rewrite
# path, and a user-authored signal in `signature_signals` cannot be un-published.


def _user_alert(**over):
    """A user-authored alert row — the shape `indicator_alert_service` returns."""
    row = _alert(condition="above", threshold=60.0)
    row["indicator"] = "u_0123456789ab.value"
    row["def_source"] = "user"
    row.update(over)
    return row


def _a_real_closed_bar_fire_from_a_user_definition():
    """A fire that PASSES EVERY OTHER GATE, so only the user gate can refuse it.

    ⛔ THE FIRE MUST EXIST BEFORE IT IS REFUSED. Phase C Task 9's
    `test_the_forming_bar_fire_this_file_refuses_ACTUALLY_EXISTS` was green in
    its own red run and that is what proved the fire predated the door; a refusal
    test whose input produced nothing refuses nothing and passes anyway.

    So the numbers here are taken from the SHIPPED closed lane on the committed
    `wick_that_unwinds` fixture, through a BUILTIN address — a genuinely
    ledger-eligible fire — and only the provenance is then changed. Every other
    gate (`mode == "closed"`, the bar has closed, the timeframe has a label, the
    value is not None) is satisfied by construction.
    """
    now = float(WICK[-1]["t"]) + 86_400.0
    value, triggered, idx = ev._evaluate_one_closed(
        _alert(condition="above", threshold=60.0), bars=WICK, now_epoch=now)
    assert triggered is True and value is not None and idx is not None, (
        f"the closed lane did not fire — there is nothing to refuse "
        f"({value}, {triggered}, {idx})")
    return {"value": value, "bar_index": idx, "now": now}


def test_the_fire_the_user_gate_refuses_ACTUALLY_EXISTS_and_is_LEDGER_GRADE(
        tmp_ledger, monkeypatch):
    """The non-vacuity of every user-gate refusal below, in two halves.

    Half one: the fire exists. Half two — the one that makes the refusal mean
    something — the IDENTICAL fire from a BUILTIN definition LANDS A ROW. Without
    that, "refused" is satisfied by an input every gate refuses.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()
    assert ev.admit_alert_fire(_alert(condition="above", threshold=60.0),
                               fire["value"], bar_index=fire["bar_index"],
                               bars=WICK, now_epoch=fire["now"]) is True
    assert _rows_on_disk(tmp_ledger) == 1


def test_a_user_definition_fire_is_REFUSED_at_the_ledger_door_and_the_refusal_RAISES(
        tmp_ledger, monkeypatch):
    """🔴 THE TASK-12 GATE.

    ⛔ IT RAISES; it does not return False. Phase C Task 9 measured why: a boolean
    refusal is a value a caller can ignore, `record_signal` already uses False for
    exactly one thing ("already recorded"), and fire-once cannot survive one lie.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()
    with pytest.raises(ev.LedgerAdmissionRefused,
                       match="user-authored definitions do not accrue receipts"):
        ev.admit_alert_fire(_user_alert(), fire["value"],
                            bar_index=fire["bar_index"], bars=WICK,
                            now_epoch=fire["now"])
    assert _rows_on_disk(tmp_ledger) == 0
    assert ledger.get_signals() == []


def test_the_user_refusal_is_a_RAISE_and_never_a_False(tmp_ledger, monkeypatch):
    """`False` is spoken for and means "already recorded". A refusal that returned
    it would be indistinguishable from a duplicate — the one lie fire-once cannot
    survive — so the call must RAISE even where every other condition is met."""
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()
    outcome = "not-called"
    try:
        outcome = ev.admit_alert_fire(_user_alert(), fire["value"],
                                      bar_index=fire["bar_index"], bars=WICK,
                                      now_epoch=fire["now"])
    except ev.LedgerAdmissionRefused:
        outcome = "raised"
    assert outcome == "raised", f"the door returned {outcome!r} instead of raising"
    assert _rows_on_disk(tmp_ledger) == 0


def test_NO_ROW_IS_WRITTEN_even_if_a_caller_swallows_the_refusal(
        tmp_ledger, monkeypatch):
    """⛔ THE PROPERTY THE APPEND-ONLY STORE ACTUALLY DEPENDS ON.

    The two tests above assert the door RAISES. This asserts the store is
    untouched even from a caller that ignores everything the door says — which is
    a strictly different claim and the one that separates *"the gate was
    deleted"* (a row LANDS) from *"the gate returns False"* (no row, but a lie).
    Without it those two mutations are indistinguishable: both stop the raise,
    both fail every `pytest.raises`, and neither has a killer the other lacks.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()
    try:
        ev.admit_alert_fire(_user_alert(), fire["value"],
                            bar_index=fire["bar_index"], bars=WICK,
                            now_epoch=fire["now"])
    except Exception:                                   # noqa: BLE001 — the point
        pass
    assert _rows_on_disk(tmp_ledger) == 0, (
        "a user-authored fire reached the append-only ledger; there is no "
        "rewrite path and no way to un-publish it")


def test_the_COLUMN_alone_refuses_and_the_ADDRESS_alone_refuses(
        tmp_ledger, monkeypatch):
    """⛔ TWO SIGNALS, EACH SEPARATELY MEASURED.

    This is not the accidental redundancy the `AlertBell` fix removed (a second
    guard that made the first unkillable); it is Phase C Task 9's deliberate
    kind, where each half answers a question the other cannot:

      * the COLUMN is the durable statement, written at arm time, and it survives
        the definition being deleted afterwards — which is exactly when the
        address stops resolving to anything;
      * the ADDRESS is the structural statement, and it holds for a dict a caller
        assembled by hand. This door takes a mapping, not a row.

    Each case below carries ONE of the two signals and neither carries both, so
    deleting either half makes exactly one of these fail.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()

    column_only = _user_alert(indicator="rsi")            # builtin address
    address_only = _user_alert()
    address_only.pop("def_source")                        # no column at all

    for row in (column_only, address_only):
        with pytest.raises(ev.LedgerAdmissionRefused,
                           match="user-authored definitions do not accrue receipts"):
            ev.admit_alert_fire(row, fire["value"], bar_index=fire["bar_index"],
                                bars=WICK, now_epoch=fire["now"])
    assert _rows_on_disk(tmp_ledger) == 0

    # …and the CASE-FOLDED spelling is refused too, because `resolve_address`
    # lowercases and a fire must not become ledger-eligible by being spelled the
    # way the resolver leaves it.
    folded = _user_alert(indicator="u_0123456789AB.Value")
    folded.pop("def_source")
    with pytest.raises(ev.LedgerAdmissionRefused, match="do not accrue receipts"):
        ev.admit_alert_fire(folded, fire["value"], bar_index=fire["bar_index"],
                            bars=WICK, now_epoch=fire["now"])


def test_the_user_gate_refuses_in_FORMING_MODE_TOO_and_says_so_by_name(
        tmp_ledger, monkeypatch):
    """⛔ THE ORDER IS LOAD-BEARING AND THIS IS WHERE IT IS MEASURED.

    Every other gate in this door is a fact about the LANE or about one bar and
    one clock — conditional, and all of them things Task 8's cutover moves.
    Whether an ACCOUNT wrote the arithmetic is none of those: it is true in every
    mode, on every bar. Placed after the mode gate, a user fire in `"forming"`
    would be refused for the MODE — a true sentence about the wrong thing, which
    is the "refused by a different door" reading this branch has measured five
    times, and which would make this refusal disappear the day Task 8 flips the
    constant.
    """
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "forming")
    with pytest.raises(ev.LedgerAdmissionRefused,
                       match="user-authored definitions do not accrue receipts"):
        ev.admit_alert_fire(_user_alert(), 74.31, bar_index=53, bars=WICK,
                            now_epoch=_mid_bar_53_epoch())
    assert _rows_on_disk(tmp_ledger) == 0


def test_a_BUILTIN_fire_is_untouched_by_the_user_gate(tmp_ledger, monkeypatch):
    """The positive control. A gate that refused everything would satisfy every
    test above; `def_source` absent, `"builtin"`, or `None` must all still land."""
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    fire = _a_real_closed_bar_fire_from_a_user_definition()
    landed = 0
    for i, source in enumerate((None, "builtin", "BUILTIN", "")):
        row = _alert(condition="above", threshold=60.0, sym=f"SYM{i}")
        if source is not None:
            row["def_source"] = source
        landed += bool(ev.admit_alert_fire(row, fire["value"],
                                           bar_index=fire["bar_index"], bars=WICK,
                                           now_epoch=fire["now"]))
    assert landed == 4
    assert _rows_on_disk(tmp_ledger) == 4


# ─── the disjointness rail: no two gates may share a phrase ──────────────────

def _every_ledger_refusal_message(monkeypatch) -> dict:
    """Drive EVERY gate in `admit_alert_fire` for real and collect its message.

    ⛔ DRIVEN, NEVER READ OFF A TABLE OF CONSTANTS. Phase C Task 9's M1 found two
    gates sharing the phrase "forming-bar fires are not ledger-grade", so
    `pytest.raises(match=…)` STILL MATCHED WITH THE MODE LOCK DELETED — the test
    would have passed on a tree with the safety removed. Nineteenth vacuous gate
    on this branch, and only the mutation found it. Comparing the constants to
    each other would prove the constants are distinct and nothing about the
    strings the code raises.
    """
    out: dict[str, str] = {}
    long_after = float(WICK[-1]["t"]) + 86_400.0

    def capture(key, fn):
        with pytest.raises(RuntimeError) as caught:
            fn()
        out[key] = str(caught.value)

    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    capture("user", lambda: ev.admit_alert_fire(
        _user_alert(), 68.84, bar_index=65, bars=WICK, now_epoch=long_after))
    capture("bar_index", lambda: ev.admit_alert_fire(
        _alert(), 68.84, bar_index=10_000, bars=WICK, now_epoch=long_after))
    capture("tf_label", lambda: ev.admit_alert_fire(
        _alert(tf="4h"), 68.84, bar_index=65, bars=WICK, now_epoch=long_after))
    capture("not_closed", lambda: ev.admit_alert_fire(
        _alert(), 74.31, bar_index=53, bars=WICK, now_epoch=_mid_bar_53_epoch()))
    capture("no_value", lambda: ev.admit_alert_fire(
        _alert(), None, bar_index=65, bars=WICK, now_epoch=long_after))

    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "forming")
    capture("mode", lambda: ev.admit_alert_fire(
        _alert(), 68.84, bar_index=65, bars=WICK, now_epoch=long_after))
    return out


#: The fragment each refusal test in this file matches on, by gate. A test that
#: adds a `match=` without adding its fragment here is not covered by the rail.
_LEDGER_FRAGMENTS = {
    "user": "user-authored definitions do not accrue receipts",
    "mode": "forming-bar fires are not ledger-grade",
    "bar_index": "is not a position in the",
    "tf_label": "no product timeframe label for",
    "not_closed": "has not closed as of",
    "no_value": "a fire with no value is not a receipt",
}


def test_every_ledger_refusal_fragment_names_EXACTLY_ONE_gate(tmp_ledger, monkeypatch):
    """🔴 PHASE C TASK 9's M1, NOW A PERMANENT RAIL RATHER THAN A COMMENT."""
    messages = _every_ledger_refusal_message(monkeypatch)
    assert set(messages) == set(_LEDGER_FRAGMENTS), (
        f"a gate was not driven: {sorted(set(_LEDGER_FRAGMENTS) ^ set(messages))}")
    for gate, fragment in _LEDGER_FRAGMENTS.items():
        hits = sorted(k for k, m in messages.items() if fragment in m)
        assert hits == [gate], (
            f"the fragment {fragment!r} appears in {hits} — a test matching on "
            f"it would pass with {gate}'s safety deleted")
    assert _rows_on_disk(tmp_ledger) == 0


def test_every_refusal_this_door_raises_is_a_LedgerAdmissionRefused(
        tmp_ledger, monkeypatch):
    """The named type, and it is still a `RuntimeError` so every existing caller
    and every existing rail catches exactly what it caught before."""
    assert issubclass(ev.LedgerAdmissionRefused, RuntimeError)
    monkeypatch.setattr(ev, "ALERT_EVAL_MODE", "closed")
    long_after = float(WICK[-1]["t"]) + 86_400.0
    for fn in (lambda: ev.admit_alert_fire(_user_alert(), 68.84, bar_index=65,
                                           bars=WICK, now_epoch=long_after),
               lambda: ev.admit_alert_fire(_alert(tf="4h"), 68.84, bar_index=65,
                                           bars=WICK, now_epoch=long_after),
               lambda: ev.ledger_timeframe("4h")):
        with pytest.raises(ev.LedgerAdmissionRefused):
            fn()


# ─── the lock: the evaluator's only ledger write is behind the door ──────────

def test_the_evaluators_only_ledger_write_is_inside_admit_alert_fire():
    """A second write anywhere else in this module would bypass every gate above
    and the census would still pass — it counts FILES, not call sites."""
    src = (_ROOT / "api" / "services" / "indicator_alert_evaluator.py").read_text(
        encoding="utf-8")
    tree = ast.parse(src)
    door = next((n for n in ast.walk(tree)
                 if isinstance(n, ast.FunctionDef) and n.name == "admit_alert_fire"),
                None)
    assert door is not None, "admit_alert_fire is gone"
    inside = {id(n) for n in ast.walk(door)}

    writes = [n for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
              and n.func.attr == "record_signal"]
    assert writes, "the evaluator does not write the ledger at all"
    outside = [n for n in writes if id(n) not in inside]
    assert not outside, (
        "a ledger write outside the door at line(s) "
        f"{[n.lineno for n in outside]}"
    )


def test_the_module_names_the_GATE_rather_than_asserting_an_absence():
    """Step 5's control audit, as a rail.

    Two comments used to say the fires "are not ledger-grade" / "nothing here
    may feed the Signature receipts ledger". Both became conditionally false the
    moment this door opened, and a false comment beside a real gate is worse
    than no comment: the next reader trusts it.
    """
    src = (_ROOT / "api" / "services" / "indicator_alert_evaluator.py").read_text(
        encoding="utf-8")
    for stale in ("nothing here may feed the Signature",
                  "no fire it produces may enter the Signature",
                  "THE FIRES THESE PRODUCE ARE NOT LEDGER-GRADE"):
        assert stale not in src, f"a stale absence-claim survives: {stale!r}"
    assert "admit_alert_fire" in src


# ═══ THE DOOR IS OPEN — THE CYCLE ACCRUES A RECEIPT ══════════════════════════
#
# ⭐ EVERYTHING ABOVE THIS LINE PASSED ON A TREE WHERE NOTHING CALLED THE DOOR.
# 26 test call sites, 0 production ones, and the zero was itself asserted — the
# door was written to be wired and deliberately left shut so the closed-bar
# cutover stayed one revertible line. The flip shipped; spec §12's Phase E row
# needs the ledger to hold public-worthy HISTORY; a door with no caller writes no
# receipts, so that history could never begin. This section is the wiring.
#
# ⛔ SO EVERY TEST BELOW DRIVES `_run_one_cycle` FOR REAL. A door proven only by
# its own unit tests is a door whose CALLER is unmeasured, and the caller is
# where all four of this section's claims live: that a delivered fire lands
# exactly one receipt, that the fire-once guarantee is what makes it exactly one,
# that a user-authored fire lands none, and that a refusal never costs a member
# their alert.

_EVALUATOR_MODULE = "api.services.indicator_alert_evaluator"
_DOOR = "admit_alert_fire"


def _door_bindings(tree: ast.AST, path: pathlib.Path) -> tuple[set[str], set[str]]:
    """(names bound to the EVALUATOR module, names bound to the door itself).

    ⛔ THE DEFINING MODULE IS SEEDED WITH THE BARE NAME, and that is the whole
    difficulty here. `record_signal`'s census only ever had to resolve IMPORTS,
    because no ledger writer lives inside `ledger.py`. The door's one production
    caller lives in the same file as the door, so it reaches it as a bare
    `admit_alert_fire(...)` with no import to resolve — a scanner built on
    imports alone would report ZERO and go on reporting zero after a second
    in-file writer appeared. `test_the_census_SEES_a_second_writer_planted_INSIDE
    _the_evaluator` is the control that this half works.
    """
    module_names: set[str] = set()
    direct_names: set[str] = set()
    if path.name == "indicator_alert_evaluator.py":
        direct_names.add(_DOOR)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == _EVALUATOR_MODULE:
                    module_names.add(a.asname or a.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            # `from api.services import indicator_alert_evaluator as ev`, and the
            # relative spellings (`mod` is "" at level>0 for `from . import x`).
            if mod == "api.services" or mod.endswith(".services") or mod in ("", "services"):
                for a in node.names:
                    if a.name == "indicator_alert_evaluator":
                        module_names.add(a.asname or a.name)
            if mod == _EVALUATOR_MODULE or mod.endswith(".indicator_alert_evaluator"):
                for a in node.names:
                    if a.name == _DOOR:
                        direct_names.add(a.asname or a.name)
                    elif a.name == "*":
                        direct_names.add(_DOOR)
    return module_names, direct_names


def _enclosing_function_names(tree: ast.AST) -> dict:
    """`id(node)` → the name of the OUTERMOST function containing it.

    A call site is reported as `path::function` rather than `path` alone: the
    question this gate answers is *which code writes receipts*, and a file-level
    answer would let a second writer be added to a file that already appears.
    """
    out: dict = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for n in ast.walk(fn):
                out.setdefault(id(n), fn.name)
    return out


def _door_call_sites(scan_roots, rel_to: pathlib.Path) -> set[str]:
    """Every resolved `admit_alert_fire(...)` CALL under ``scan_roots``."""
    sites: set[str] = set()
    for root in scan_roots:
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError):        # pragma: no cover
                continue
            module_names, direct_names = _door_bindings(tree, path)
            enclosing = _enclosing_function_names(tree)
            rel = path.relative_to(rel_to).as_posix()
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                fn = node.func
                hit = False
                if isinstance(fn, ast.Attribute) and fn.attr == _DOOR:
                    dotted = _dotted(fn) or ""
                    head = dotted.rsplit(".", 1)[0] if "." in dotted else ""
                    hit = (head in module_names
                           or dotted.endswith(f"{_EVALUATOR_MODULE}.{_DOOR}"))
                elif isinstance(fn, ast.Name) and fn.id in direct_names:
                    hit = True
                if hit:
                    sites.add(f"{rel}::{enclosing.get(id(node), '<module>')}")
    return sites


def test_the_door_has_EXACTLY_ONE_production_call_site():
    """🔴 THE GATE THAT MOVED FROM ZERO TO ONE — DELIBERATELY, NOT DELETED.

    For eight tasks this number was ZERO and the zero was asserted, because an
    accidental writer into an append-only store with no rewrite path is
    unfixable. Opening the door does not retire that concern, it re-prices it:
    the expected number is now ONE and it is asserted the same way, by `==` on
    the DERIVED set rather than by `in`. A containment check cannot find a caller
    nobody thought of; an equality fails the moment a second one appears, and
    names it.

    ⛔ AN AST, NEVER A GREP, AND THIS NAME IS THE REPO'S OWN WORKED EXAMPLE OF
    WHY. `git grep -c admit_alert_fire` has answered 2, then 3, then 5 on this
    branch and EVERY ONE of those hits was prose in a comment — including the
    comment above the door that explains this very gate.
    """
    tree = ast.parse((_ROOT / "api" / "services"
                      / "indicator_alert_evaluator.py").read_text(encoding="utf-8"))
    defs = [n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name == _DOOR]
    assert len(defs) == 1, (
        f"{len(defs)} definitions of {_DOOR} — a second one would be a second "
        f"door, and every gate above guards only the first")

    sites = _door_call_sites((_ROOT / "api", _ROOT / "tools"), _ROOT)
    assert sites == {
        # ⭐ THE ONE CALLER, wired 2026-08-08. It swallows every refusal and runs
        # AFTER `_dispatch_delivery`, so the ledger can never cost a member an
        # alert; `_run_one_cycle` gates it on `record_trigger`, so the receipt
        # inherits `UNIQUE(alert_id, fire_key)` instead of copying it.
        "api/services/indicator_alert_evaluator.py::_accrue_ledger_receipt",
    }


@pytest.mark.parametrize("relpath,source,expected", [
    # the shipped shape: a bare call inside the defining module
    ("api/services/indicator_alert_evaluator.py",
     "def f():\n    admit_alert_fire(a, v, i, b)\n", True),
    # …and a second in-file writer, which is the thing this gate exists to catch
    ("api/services/indicator_alert_evaluator.py",
     "def g():\n    return admit_alert_fire(a, v, i, b)\n", True),
    ("api/services/other.py",
     "from api.services import indicator_alert_evaluator as ev\n"
     "def f():\n    ev.admit_alert_fire(a, v, i, b)\n", True),
    ("api/services/other.py",
     "from api.services.indicator_alert_evaluator import admit_alert_fire\n"
     "def f():\n    admit_alert_fire(a, v, i, b)\n", True),
    ("api/services/other.py",
     "import api.services.indicator_alert_evaluator\n"
     "def f():\n    api.services.indicator_alert_evaluator.admit_alert_fire("
     "a, v, i, b)\n", True),
    # a bare call in a file that never imported it — a DIFFERENT function
    ("api/services/other.py",
     "def f():\n    admit_alert_fire(a, v, i, b)\n", False),
    # prose only: the three hits a grep has counted on this branch
    ("api/services/other.py",
     "# admit_alert_fire is the ledger door\nX = 'admit_alert_fire'\n", False),
])
def test_the_census_SEES_a_second_writer_planted_INSIDE_the_evaluator(
        tmp_path, relpath, source, expected):
    """⛔ A NEGATIVE FIXTURE MUST TRIP THE RAW SCAN, and a positive one must not.

    Phase C Task 1 measured the failure this prevents: a fixture written in a
    shape the scanner structurally could not match left the scan asserting
    nothing while staying green. So the scanner is driven against files that do
    not exist in the tree — five ways of reaching the door (including the two
    in-file spellings, which no import resolves) and two that are not reaching it
    at all.
    """
    planted = tmp_path / relpath
    planted.parent.mkdir(parents=True, exist_ok=True)
    planted.write_text(source, encoding="utf-8")
    sites = _door_call_sites((tmp_path,), tmp_path)
    assert bool(sites) is expected, sites


# ─── the real cycle ──────────────────────────────────────────────────────────

#: 80 rising 5m bars, every one of them long closed by any wall clock, so the
#: closed lane judges `bars[-1]` and `rsi` pins at its ceiling. A LEVEL condition
#: on purpose: it stays true on every later cycle, which is what makes "exactly
#: one receipt" a measurement rather than an accident of the tape.
_CYCLE_BARS = [{"t": 1_700_000_000 + i * 300, "o": 100.0 + i, "h": 100.6 + i,
                "l": 99.4 + i, "c": 100.0 + i, "v": 100_000} for i in range(80)]

_USER_DEF_ID = "u_1234567890ab"
_USER_ADDRESS = f"{_USER_DEF_ID}.value"


def _user_definition() -> dict:
    """A schema-v1 `ast`-kind definition — arithmetic an ACCOUNT wrote."""
    return {
        "schemaVersion": 1, "id": _USER_DEF_ID, "version": 1,
        "meta": {"name": "My Average", "shortName": "MA"},
        "compute": {"kind": "ast", "ast": {
            "type": "call", "name": "sma", "args": [
                {"type": "series", "name": "close"},
                {"type": "num", "value": 5},
            ]}},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary"}],
        "inputs": [],
    }


@pytest.fixture
def cycle_env(tmp_path, monkeypatch, tmp_ledger):
    """A real alerts store + a real ledger + stubbed bars and channels.

    ⛔ THE SPY SITS AT THE TRANSPORT (`wls.add_alert`), NOT AT
    `deliver_alert_payload`. Phase C Task 11's shape: the claim/release lease and
    the fire-once gate live INSIDE `deliver_alert_payload`, so a spy that
    replaced it would replace the gate and every count below would be measuring
    the stub.
    """
    auth = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(auth))
    monkeypatch.setattr(ias, "_DB_PATH", str(auth))
    ias.init_schema()

    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _CYCLE_BARS])

    delivered: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append(k))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    monkeypatch.setattr(_alerts_mod, "_fire_discord", lambda payload: None)
    return {"ledger": tmp_ledger, "auth": auth, "delivered": delivered}


@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    """A private definitions store, with an EMPTY registry either side.

    `USER_FUNCS` is a module-level dict; a test inheriting a previous
    admission would prove that admission grants access, not that THIS one does
    (`lesson_teardown_must_undo_what_setup_created`).
    """
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


def _the_shipped_lane_is_closed():
    assert ev.eval_mode() == "closed", (
        "the shipped lane is {!r}, so no fire in this file can be ledger-grade "
        "and every receipt assertion below would be vacuous. This is the cutover "
        "having moved, not a defect in the door.".format(ev.eval_mode()))


def test_a_delivered_fire_lands_EXACTLY_ONE_receipt_through_the_REAL_cycle(
        cycle_env):
    """🔴 THE WHOLE POINT OF OPENING THE DOOR, MEASURED END TO END.

    One armed builtin alert, one cycle: the member is told once and the ledger
    holds exactly one row, read field by field off the file.

    Then the hard half — **a second DELIVERY of the SAME fire.** The lease is
    handed back exactly as a 429 does, the next cycle re-delivers (which is
    deliberate: gating the dispatch would delete the retry), and the receipt does
    NOT double. It cannot, because the receipt is gated on `record_trigger` — the
    fire-once guarantee `UNIQUE(alert_id, fire_key)` itself — rather than on a
    second rule beside it that could drift.
    """
    _the_shipped_lane_is_closed()
    aid = ias.create(user_id="u-ledger", sym="TEST", indicator="rsi",
                     condition="above", threshold=10.0, tf="5")
    ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 1, cycle_env["delivered"]
    assert fl.count_fires(aid) == 1

    signals = ledger.get_signals("TEST")
    assert len(signals) == 1, signals
    row = signals[0]
    assert row["indicator"] == "rsi", "the row is not keyed on the ALERT-lane address"
    assert row["version"] == ev.ALERT_LEDGER_VERSION
    assert row["sym"] == "TEST"
    assert row["tf"] == "5m", "the row carries the bars-store key, not the label"
    assert row["direction"] == "above", "the row invented a market opinion"
    assert row["bar_time"] == _CYCLE_BARS[-1]["t"]
    assert row["price"] == pytest.approx(_CYCLE_BARS[-1]["c"])
    meta = json.loads(row["meta_json"])
    assert meta["lane"] == "closed"
    assert meta["address"] == "rsi" and meta["condition"] == "above"
    assert meta["threshold"] == pytest.approx(10.0)
    assert meta["alertId"] == aid
    assert meta["barIndex"] == len(_CYCLE_BARS) - 1
    assert meta["value"] == pytest.approx(ev._evaluate_for_cycle(
        ias.get(aid), [dict(b) for b in _CYCLE_BARS])[0])

    before = _all_rows(cycle_env["ledger"])

    # ── the second DELIVERY of that one fire ──
    fire = fl.fires_for_alert(aid)[0]
    out = fl.release_delivery(fire["id"], error="429 Too Many Requests")
    assert out["released"] is True and out["terminal"] is False, out
    assert ias.record_trigger(aid, last_value=99.0,
                              bar_time=_CYCLE_BARS[-1]["t"]) is False, (
        "the episode key moved, so the next cycle would be a NEW fire and this "
        "would prove nothing about a second DELIVERY of the same one")

    ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 2, (
        "the released lease was never picked up — with no second delivery, "
        "'no duplicate receipt' is satisfied by nothing having happened")
    assert fl.count_fires(aid) == 1, "the retry recorded a SECOND fire"
    assert _all_rows(cycle_env["ledger"]) == before, (
        "the second delivery moved the ledger — `first_seen_at` included")


def test_a_level_condition_accrues_ONE_receipt_for_the_EPISODE_not_one_per_bar(
        cycle_env, monkeypatch):
    """🔴 WHY THE RECEIPT RIDES `record_trigger` AND NOT `triggered`.

    "RSI is above 70" stays true for as long as it stays true. Its fire key is
    the ARMED EPISODE, so the alert lane calls that ONE fire — and a track record
    aimed at burned-vendor customers must say the same thing, or the ledger fills
    with a row per bar restating a level that has not moved. That is not a
    signal; it is a state, and publishing it as a signal would be the kind of
    thing the ledger exists to make impossible.

    ⛔ THE BAR MUST ADVANCE BETWEEN THE TWO CYCLES OR THIS PROVES NOTHING. The
    ledger keys on `(indicator, version, sym, tf, bar_time, direction)`, so a
    second cycle on the SAME window is deduped by the STORE and the guard could
    be deleted with every assertion still green. A new closed bar gives the
    second cycle a genuinely new ledger key — the only state in which the two
    designs differ.
    """
    _the_shipped_lane_is_closed()
    window = [dict(b) for b in _CYCLE_BARS]
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in window])
    aid = ias.create(user_id="u-episode", sym="TEST", indicator="rsi",
                     condition="above", threshold=10.0, tf="5")

    ev._run_one_cycle()
    assert _rows_on_disk(cycle_env["ledger"]) == 1

    nxt = dict(window[-1])
    nxt.update(t=window[-1]["t"] + 300, o=window[-1]["c"], c=window[-1]["c"] + 1,
               h=window[-1]["c"] + 1.6, l=window[-1]["c"] - 0.4)
    window.append(nxt)

    value, triggered, idx = ev._evaluate_for_cycle(ias.get(aid),
                                                   [dict(b) for b in window])
    assert triggered is True and idx == len(window) - 1, (
        f"the condition stopped being true on the new bar ({value}, {triggered}, "
        f"{idx}) — 'one receipt' would mean nothing")
    assert ev._fire_bar_time(window, idx) != _CYCLE_BARS[-1]["t"], (
        "the judged bar did not advance, so the ledger key is unchanged and the "
        "STORE would dedup this even with the guard deleted")

    ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 1, (
        "the member was told twice about one armed episode")
    assert _rows_on_disk(cycle_env["ledger"]) == 1, (
        "a level that merely stayed true accrued a SECOND receipt — the ledger "
        "is recording a state, not a signal")


def test_a_USER_AUTHORED_fire_lands_ZERO_receipts_beside_a_builtin_that_lands_ONE(
        cycle_env, defs_db, caplog):
    """🔴 PHASE D TASK 12's GATE, RE-ASSERTED NOW THAT THE DOOR IS OPEN.

    The door refuses an `ast` fire FIRST, before the mode gate, because whether
    an account authored the arithmetic is true in every mode. That order was
    proven against the door directly; this proves it survives the WIRING — which
    is the only place it could now be lost.

    ⛔ THE ZERO IS NOT VACUOUS, AND THE CONTROL IS IN THE SAME CYCLE. A builtin
    alert on the same bars, in the same pass, lands its row. So "zero" is a
    statement about PROVENANCE and not about a cycle that evaluated nothing: both
    alerts fire, both members are told, one receipt exists and it is the
    builtin's.
    """
    _the_shipped_lane_is_closed()
    ud.save("u-author", _USER_DEF_ID, _user_definition())
    user_aid = ias.create(user_id="u-author", sym="TEST", indicator=_USER_ADDRESS,
                          condition="above", threshold=120.0, tf="5")
    builtin_aid = ias.create(user_id="u-author", sym="TEST", indicator="rsi",
                             condition="above", threshold=10.0, tf="5")
    row = ias.get(user_aid)
    assert row["def_source"] == ias.DEF_SOURCE_USER, (
        "the row does not record that an account authored its arithmetic — the "
        "door would have nothing to refuse")

    # the refused fire is a REAL closed-bar fire, measured before it is refused
    value, triggered, idx = ev._evaluate_for_cycle(
        row, [dict(b) for b in _CYCLE_BARS])
    assert triggered is True and value is not None and idx is not None, (
        f"the user formula did not fire — there is nothing to refuse "
        f"({value}, {triggered}, {idx})")

    with caplog.at_level("INFO", logger="api.services.indicator_alert_evaluator"):
        ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 2, (
        "both alerts must reach their member — refusing a receipt may not "
        "silence an alert")
    assert fl.count_fires(user_aid) == 1, "the user alert did not even fire"
    assert fl.count_fires(builtin_aid) == 1

    signals = ledger.get_signals("TEST")
    assert len(signals) == 1, (
        f"{len(signals)} receipts for one builtin and one user-authored fire: "
        f"{[s['indicator'] for s in signals]}")
    assert signals[0]["indicator"] == "rsi"
    assert json.loads(signals[0]["meta_json"])["alertId"] == builtin_aid

    # …and the cycle REACHED the door and was refused BY NAME — not skipped.
    refusals = [r.getMessage() for r in caplog.records
                if ev._NOT_LEDGER_ELIGIBLE in r.getMessage()]
    assert len(refusals) == 1, (
        f"the user gate did not report a refusal; the cycle may never have "
        f"reached the door at all. Records: {[r.getMessage() for r in caplog.records]}")
    assert str(user_aid) in refusals[0]

    # …and the refusal really is a RAISE of the named type, not a log line the
    # door writes on its way to returning something.
    with pytest.raises(ev.LedgerAdmissionRefused, match=ev._NOT_LEDGER_ELIGIBLE):
        ev.admit_alert_fire(ias.get(user_aid), value, bar_index=idx,
                            bars=[dict(b) for b in _CYCLE_BARS])


def test_the_FORMING_lane_writes_no_receipt_and_still_tells_the_member(
        cycle_env, monkeypatch):
    """⛔ THE ROLLBACK MUST NOT COST ANYBODY AN ALERT.

    `ALERT_EVAL_MODE=forming` is the operator's mitigation, pulled mid-incident
    with no deploy. It stops receipts — that is the mode gate doing its job, and
    a forming-bar fire is a coin toss no track record should carry. What it must
    NOT do is stop notifications, and the shape of the wiring is what guarantees
    that: the door is called AFTER the dispatch, and its refusal is swallowed.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ev.eval_mode() == "forming", "the lever did not move the lane"
    ias.create(user_id="u-rollback", sym="TEST", indicator="rsi",
               condition="above", threshold=10.0, tf="5")

    ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 1, "a rollback silenced the alert"
    assert _rows_on_disk(cycle_env["ledger"]) == 0, (
        "a forming-bar fire accrued a receipt")


def test_a_LEDGER_FAILURE_that_is_not_a_refusal_still_tells_the_member(
        cycle_env, monkeypatch, caplog):
    """⛔ THE OTHER ARM, AND IT IS THE ONE A `except LedgerAdmissionRefused`
    ALONE WOULD MISS.

    The store raises `ValueError` on every data-shaped refusal of its own, and an
    unopenable `/data/signal_ledger.db` raises `sqlite3.OperationalError` — from
    a lock, a read-only volume, a missing mount. None of those is a
    `LedgerAdmissionRefused`, and every one of them is a reason a member must
    still be told. Driven by making the STORE fail, not the door.
    """
    _the_shipped_lane_is_closed()

    def _explode(*a, **k):
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(ledger, "record_signal", _explode)
    ias.create(user_id="u-brokenledger", sym="TEST", indicator="rsi",
               condition="above", threshold=10.0, tf="5")

    with caplog.at_level("ERROR", logger="api.services.indicator_alert_evaluator"):
        ev._run_one_cycle()

    assert len(cycle_env["delivered"]) == 1, (
        "an unwritable ledger silenced the alert — the store is bookkeeping and "
        "must never be upstream of a notification")
    assert _rows_on_disk(cycle_env["ledger"]) == 0
    assert any("REFUSED TO RECORD" in r.getMessage() for r in caplog.records), (
        "the failure was swallowed with no trace — a receipt nobody knows was "
        "lost is worse than one that was refused out loud")


def test_the_receipt_is_accrued_AFTER_the_dispatch_and_the_refusal_is_CAUGHT():
    """⛔ BOTH HALVES, STRUCTURAL, BECAUSE ONE OF THEM CANNOT BE BEHAVIOURAL.

    The try/except is observable (the tests above drive it). The ORDER is not:
    with the except in place, moving the call in front of `_dispatch_delivery`
    changes no assertion anywhere — and it is the half that matters most under
    load, because `ledger.record_signal` takes a process-wide lock and opens
    SQLite with `timeout=10.0` on a file the nightly Signature sweep writes from
    this same process. In front of the notification, that is up to ten seconds
    between a member and their alert, on a path nothing measures.
    """
    tree = ast.parse((_ROOT / "api" / "services"
                      / "indicator_alert_evaluator.py").read_text(encoding="utf-8"))
    fns = {n.name: n for n in ast.walk(tree)
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

    # 1. the door's caller catches the named refusal AND everything else
    caller = fns["_accrue_ledger_receipt"]
    handlers = [h for t in ast.walk(caller) if isinstance(t, ast.Try)
                for h in t.handlers]
    caught = {ast.unparse(h.type) if h.type is not None else "" for h in handlers}
    assert "LedgerAdmissionRefused" in caught, (
        f"the named refusal is not caught here: {caught}")
    assert "Exception" in caught, (
        f"only the named refusal is caught, so a ValueError from the store or an "
        f"unopenable database would propagate into the cycle: {caught}")

    # 2. the cycle calls it AFTER the dispatch, and gates it on record_trigger
    cycle = fns["_run_one_cycle"]
    order = [n for n in ast.walk(cycle) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name)
             and n.func.id in ("_dispatch_delivery", "_accrue_ledger_receipt")]
    assert [n.func.id for n in order] == ["_dispatch_delivery",
                                          "_accrue_ledger_receipt"], (
        "the cycle no longer calls exactly one dispatch and one accrual")
    assert order[0].lineno < order[1].lineno, (
        "the ledger write is in FRONT of the member's notification")

    dispatch, accrual = order
    # ⚠️ THE **INNERMOST** ENCLOSING `if`, NOT THE FIRST ONE `ast.walk` YIELDS.
    # `ast.walk` is breadth-first, so the first hit is `if triggered:` — the
    # branch BOTH calls live in — and a rail that read that one would report
    # "gated" for a tree with the receipt guard deleted.
    enclosing = [n for n in ast.walk(cycle) if isinstance(n, ast.If)
                 and any(c is accrual for c in ast.walk(n))]
    assert enclosing, (
        "the accrual is not gated at all — every triggering cycle would attempt "
        "a receipt, and a level condition would accrue one per bar")
    guard = max(enclosing, key=lambda n: n.lineno)
    assert isinstance(guard.test, ast.Name), (
        f"the accrual is gated on {ast.unparse(guard.test)!r} rather than on a "
        f"plain name — it must ride `record_trigger`'s answer, not a second rule "
        f"beside it that can drift from the fire log")
    assigned = [n for n in ast.walk(cycle) if isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) == guard.test.id for t in n.targets)]
    assert len(assigned) == 1 and "record_trigger" in ast.unparse(assigned[0]), (
        f"the accrual's guard is not `record_trigger`'s return: "
        f"{[ast.unparse(a) for a in assigned]}")

    # …and the dispatch is OUTSIDE that guard — Task 8's ruling, unmoved.
    assert not any(c is dispatch for c in ast.walk(guard)), (
        "the dispatch moved inside the receipt guard. `record_trigger` returns "
        "False on every cycle after the first for a level condition, so a "
        "released delivery lease would never be picked up and the member would "
        "never be told.")


def test_the_suite_wide_ledger_isolation_reaches_the_MODULE_GLOBAL(
        tmp_path_factory):
    """🔴 THE RAIL ON THE CONFTEST FIXTURE THIS WIRING MADE NECESSARY.

    `ledger._DB_PATH` is `os.environ.get(...)` executed ONCE at import and
    `_connect()` closes over that global — the exact class the AUTH_DB_PATH block
    in `tests/conftest.py` documents. Until the door was wired nothing a test
    drove could reach this store; now a dozen tests drive `_run_one_cycle` with a
    builtin alert on a closed bar, and `/data` EXISTS on this box, so without the
    autouse fixture every one of them would append to the REAL append-only
    ledger. A row written there cannot be taken back.

    ⛔ SO THE ASSERTION IS ON THE CONNECTION THE STORE ACTUALLY OPENS, not on the
    environment variable — a `setenv`-only fixture passes an env check and
    reaches nothing. This test takes NO ledger fixture of its own; it is
    measuring the suite-wide one.
    """
    base = pathlib.Path(tmp_path_factory.getbasetemp()).resolve()
    ledger._ensure_init()
    conn = ledger._connect()
    try:
        opened = [r[2] for r in conn.execute("PRAGMA database_list").fetchall()]
    finally:
        conn.close()
    main = [p for p in opened if p]
    assert main, f"the store opened no file at all: {opened}"
    resolved = pathlib.Path(main[0]).resolve()
    assert base in resolved.parents, (
        f"the ledger this test session writes is {resolved} — outside pytest's "
        f"temp tree ({base}). Every cycle-driving test in the repo is appending "
        f"to a real, un-rewritable ledger.")
    assert os.environ.get("SIGNAL_LEDGER_DB_PATH") == ledger._DB_PATH, (
        "the env var and the module global name different files, so which one a "
        "reader gets depends on whether it was imported before the fixture ran")
