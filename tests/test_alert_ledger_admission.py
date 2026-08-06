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
import pathlib
import sqlite3
import sys

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(_ROOT / "tools"))

import alert_replay as ar                                        # noqa: E402
from api.services import indicator_alert_evaluator as ev         # noqa: E402
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
