"""Chart-UX Task 7 — the notification names the INSTANCE and the BAR.

🔴 THE DEFECT, MEASURED ON THE UNMODIFIED TREE BEFORE A LINE WAS CHANGED.
`_dispatch_delivery` built its message from `(alert.get("indicator") or "").upper()`:

    RSI(7)  title  : 'SPY RSI alert'
    RSI(7)  message: 'SPY RSI cross above 70.00 (now: 71.34) on 5'
    RSI(14) title  : 'SPY RSI alert'
    RSI(14) message: 'SPY RSI cross above 70.00 (now: 71.34) on 5'
    messages identical: True   (byte-for-byte)

    plot alert message: 'SPY ADX.PLUSDI cross above 25.00 (now: 27.50) on 5'

…while `_with_instance_label` already rendered `RSI(7)` / `RSI(14)` on the
popover row from `instance_label`, which lives in the evaluator's own module. Two
alerts one keystroke apart were indistinguishable in a member's inbox.

🔴 AND `indicator_alert_fires.bar_time` WAS NULL ON EVERY ROW — measured through
the real cycle: `[(1, 1, 'ep:0', None, 100.0)]`, 1 of 1 rows NULL, while the bar
under judgement was `t=1761935700`. Every other column a fired-alert receipt
needs was already there; the missing one was the bar the number came from.

⚠️ THE STAMP IS APPLIED WHILE `ALERT_EVAL_MODE` IS STILL `"forming"`, so the bar
it names is `bars[-1]` — the bar the forming lane actually judges. Task 8's flip
changes WHICH bar, not whether one is named; see the seam comment in
`_run_one_cycle`.
"""
from __future__ import annotations

import ast
import datetime as dt
import re
import sqlite3
from pathlib import Path

import pytest

from api.services import alert_fired_log as fl
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import indicator_compute as ic
from api.services import watchlist_alert_service as wls

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "nativeRegistry.js"
READOUT_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "readout.js"


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    return db_path


@pytest.fixture
def sent(monkeypatch):
    """Every payload the evaluator handed to the delivery hook.

    ⚠️ THIS ONE DELIBERATELY REPLACES `deliver_alert_payload`, unlike
    `test_alert_fired_log.channels`. Nothing in this file asserts anything about
    the fire-once GATE — it asserts what the message SAYS — and the gate lives
    inside the real hook, so wrapping it would only make every message test
    depend on claim state it does not care about. The two tests here that DO
    care about delivery counts use the real hook instead.
    """
    out: list = []
    monkeypatch.setattr(wls, "deliver_alert_payload", lambda **kw: out.append(kw))
    return out


def _bars(closes, start_t=1_761_913_500, step=300):
    out = []
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"t": start_t + i * step, "o": c, "h": c * 1.002,
                    "l": c * 0.998, "c": c, "v": 100_000})
    return out


_RISING = _bars([100.0 + i for i in range(80)])
_FALLING = _bars([100.0 + i for i in range(40)] + [140.0 - 2.0 * i for i in range(1, 41)])


def _alert(**over) -> dict:
    base = {"id": 1, "user_id": "u9", "sym": "SPY", "indicator": "rsi",
            "condition": "cross_above", "threshold": 70.0, "tf": "5",
            "params_json": None}
    base.update(over)
    return base


# ─── ⭐ THE DEFECT, AS AN INEQUALITY ─────────────────────────────────────────

def test_two_rsi_alerts_one_keystroke_apart_do_not_send_the_same_message(sent):
    """The defect stated as an inequality — the assertion that kills the revert.

    Before the fix BOTH rendered `SPY RSI cross above 70.00 (now: 71.34) on 5`,
    byte for byte. An assertion on the NEW format alone would pass on a tree
    where every alert is still called `RSI`, because `RSI(7)` never appears in
    it either.
    """
    fast = _alert(id=1, params_json='{"period": 7}')
    slow = _alert(id=2, params_json='{"period": 14}')
    ev._dispatch_delivery(fast, 71.34)
    ev._dispatch_delivery(slow, 71.34)

    assert len(sent) == 2
    assert sent[0]["message"] != sent[1]["message"], (
        "two RSI alerts one keystroke apart still send byte-identical mail")
    assert sent[0]["title"] != sent[1]["title"]
    assert "RSI(7)" in sent[0]["message"] and "RSI(7)" in sent[0]["title"]
    assert "RSI(14)" in sent[1]["message"] and "RSI(14)" in sent[1]["title"]


def test_a_plot_alert_names_the_plot_in_english_not_the_raw_address(sent):
    """`ADX.PLUSDI` is an address, not a sentence. It was the whole message."""
    ev._dispatch_delivery(
        _alert(indicator="adx.plusDI", threshold=25.0), 27.5)
    msg = sent[0]["message"]
    assert "ADX.PLUSDI" not in msg and "adx.plusDI" not in msg, msg
    assert "+DI" in msg, msg
    assert "+DI" in sent[0]["title"], sent[0]["title"]


def test_the_notification_and_the_alert_ROW_name_the_instance_with_ONE_function():
    """⭐ SPEC §6/§8 — ONE naming pipeline, proved by IDENTITY.

    `indicator_alert_service._with_instance_label` is what puts `instance_label`
    on the row `IndicatorAlertPopover.jsx:464` renders. This asserts the
    notification carries THAT EXACT STRING for every offered address, so the two
    surfaces cannot describe one alert two ways.
    """
    rows = []
    for address in ev.all_addresses():
        row = _alert(indicator=address, params_json='{"period": 7}')
        rows.append((address, ias._with_instance_label(dict(row))["instance_label"]))

    assert len(rows) >= 30, f"only {len(rows)} addresses walked — nothing measured"
    labels = {label for _a, label in rows}
    assert len(labels) >= 25, (
        f"only {len(labels)} distinct labels across {len(rows)} addresses — the "
        "corpus is not discriminating")

    for address, row_label in rows:
        out: list = []
        real = wls.deliver_alert_payload
        try:
            wls.deliver_alert_payload = lambda **kw: out.append(kw)
            ev._dispatch_delivery(_alert(indicator=address,
                                         params_json='{"period": 7}'), 1.5)
        finally:
            wls.deliver_alert_payload = real
        assert out, f"{address} delivered nothing"
        assert row_label in out[0]["message"], (
            f"{address}: the popover row says {row_label!r} and the notification "
            f"says {out[0]['message']!r} — that is two spellings of one alert")
        assert out[0]["title"] == f"SPY {row_label} alert"


def test_the_notification_calls_instance_label_ITSELF_not_a_copy_of_it():
    """The structural half: an AST scan of the shipped function.

    The identity test above would still pass if `_dispatch_delivery` grew its own
    `f"{LABELS[a]}({period})"` that happened to agree today.
    """
    module = ast.parse(Path(ev.__file__).read_text(encoding="utf-8"))
    fns = [n for n in module.body
           if isinstance(n, ast.FunctionDef) and n.name == "_dispatch_delivery"]
    assert len(fns) == 1
    src = ast.unparse(fns[0])
    assert "instance_label" in src, "_dispatch_delivery no longer names instance_label"
    assert ".upper()" not in src, (
        "_dispatch_delivery is upper-casing something again — that WAS the defect")

    # The control: a sibling function in the same module does NOT name it, so
    # the scan is reading this body and not the whole file.
    others = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "_delivery_failed"]
    assert len(others) == 1
    assert "instance_label" not in ast.unparse(others[0])


# ─── ⭐ THE BAR ──────────────────────────────────────────────────────────────

def _et_close_text(bar_t: int, minutes: int) -> str:
    """The expected ET close text, DERIVED — never a typed wall-clock string.

    A hard-coded `"09:35"` is a time bomb that goes red on a DST boundary
    (`lesson_weekday_only_test_time_bombs` is the recorded version of the class
    in this tree). Computed through the same zone resolver the evaluator uses.
    """
    return dt.datetime.fromtimestamp(
        bar_t + minutes * 60, ic._et_zone()).strftime("%H:%M:%S") + " ET"


def test_the_message_states_the_bar_that_caused_it_and_when_that_bar_CLOSED(sent):
    """A notification without a bar identity answers "something happened at
    09:41:03", never "can I trust this number now the bar has closed"."""
    bar_t = 1_761_913_500
    ev._dispatch_delivery(_alert(), 71.34, bar_time=bar_t)
    msg = sent[0]["message"]
    expected = _et_close_text(bar_t, 5)
    assert expected in msg, f"{expected!r} not in {msg!r}"
    assert "(5m bar)" in msg, msg
    assert sent[0]["extra_data"]["bar_time"] == bar_t


def test_a_DAILY_bar_names_its_DATE_and_not_the_midnight_it_closes_at(sent):
    """`bar_close_epoch` puts a daily bar's close at the NEXT ET midnight —
    correct for "can this row still move", useless as an answer to "which bar".
    """
    ev._dispatch_delivery(_alert(tf="D"), 71.34, bar_time=20260805)
    msg = sent[0]["message"]
    assert "2026-08-05 ET" in msg, msg
    assert "2026-08-06" not in msg, msg
    assert "(1D bar)" in msg, msg


def test_the_ET_offset_is_resolved_PER_INSTANT_and_not_at_module_load(sent):
    """⛔ The trap `_et_midnight_epoch` and `closed_bar_index` already document.

    Two bars the same wall-clock distance apart, one either side of the 2026
    US DST change. A module-load offset prints the same clock face for both;
    a per-instant zone prints faces one hour apart. The expectation is DERIVED,
    so this test states a RELATIONSHIP and cannot itself be the bomb.
    """
    zone = ic._et_zone()
    before = int(dt.datetime(2026, 10, 30, 13, 35, tzinfo=zone).timestamp())
    after = int(dt.datetime(2026, 11, 6, 13, 35, tzinfo=zone).timestamp())
    assert (after - before) % 86400 == 3600, (
        "the two instants are not an hour off a whole number of days — the "
        "fixture does not straddle the DST change and this test measures nothing")

    ev._dispatch_delivery(_alert(id=1), 71.34, bar_time=before)
    ev._dispatch_delivery(_alert(id=2), 71.34, bar_time=after)
    assert _et_close_text(before, 5) in sent[0]["message"]
    assert _et_close_text(after, 5) in sent[1]["message"]
    # Both read 13:40 ET on the clock face despite being an hour apart in UTC.
    assert "13:40:00 ET" in sent[0]["message"] and "13:40:00 ET" in sent[1]["message"]


def test_a_MISSING_bar_time_degrades_to_the_old_shape_rather_than_crashing(sent):
    """`bar_time` is not always identifiable. An alert that raises here is an
    alert the member never receives — strictly worse than one without a bar."""
    ev._dispatch_delivery(_alert(params_json='{"period": 7}'), 71.34, bar_time=None)
    assert sent, "a missing bar time cost the member the whole alert"
    msg = sent[0]["message"]
    assert "RSI(7)" in msg and "(5m bar)" in msg
    assert " at " not in msg, f"a bar was named out of nothing: {msg!r}"


def test_an_UNREADABLE_bar_time_costs_the_message_its_bar_and_not_the_alert(sent):
    """A `t` the fired log's own normaliser cannot key on."""
    ev._dispatch_delivery(_alert(), 71.34, bar_time="not-a-timestamp")
    assert sent, "an unreadable bar time cost the member the whole alert"
    assert " at " not in sent[0]["message"]


def test_the_timeframe_label_comes_from_the_LEDGERS_table_not_a_second_one():
    """One bar, one name. `_LEDGER_TIMEFRAME` is that table."""
    for code, label in ev._LEDGER_TIMEFRAME.items():
        assert ev._tf_label(code) == label
    assert ev._tf_label("d") == "1D", "the lookup stopped folding case"
    # The ledger door RAISES on an unknown code; a notification may not.
    with pytest.raises(RuntimeError):
        ev.ledger_timeframe("zzz")
    assert ev._tf_label("zzz") == "zzz"
    assert ev._tf_label(None) == "?"


# ─── ⭐ ONE FORMATTING PIPELINE — the number, across the language boundary ────

def _js_plot_decimals() -> dict[tuple[str, str], int]:
    """(defId, plotKey) → the `legend.decimals` the CHIP prints, from the source.

    Derived from `nativeRegistry.js` itself. A hand-written expectation here
    would be a LIST, not a rail — which is exactly how four `dpc` constants rode
    uncovered for the entire life of the constants rule.
    """
    src = REGISTRY_JS.read_text(encoding="utf-8")
    starts = [(m.start(), m.group(1))
              for m in re.finditer(r"nativeDef\('([A-Za-z0-9_]+)',", src)]
    assert len(starts) >= 15, f"only {len(starts)} definitions parsed — vacuous"
    starts.append((len(src), None))
    out: dict[tuple[str, str], int] = {}
    for i in range(len(starts) - 1):
        begin, def_id = starts[i]
        block = src[begin:starts[i + 1][0]]
        for m in re.finditer(r"key:\s*'([A-Za-z0-9_]+)'", block):
            open_at = block.rfind("{", 0, m.start())
            depth, k = 0, open_at
            while k < len(block):
                if block[k] == "{":
                    depth += 1
                elif block[k] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            obj = "\n".join(line.split("//")[0]
                            for line in block[open_at:k + 1].split("\n"))
            leg = re.search(r"legend:\s*\{([^}]*)\}", obj)
            if not leg:
                continue
            dec = re.search(r"decimals:\s*(\d+)", leg.group(1))
            if dec:
                out[(def_id, m.group(1))] = int(dec.group(1))
    return out


# Every alert address → the chart plot whose chip shows the same number, or the
# declared reason there is no such plot. TOTALITY is asserted below, so a new
# address lands here exactly once and names itself.
_ADDRESS_PLOT: dict[str, tuple[str, str]] = {
    "rsi": ("rsi", "rsi"),
    "macd": ("macd", "macd"),
    "stoch": ("stoch", "k"),
    "williams_r": ("williamsR", "williams_r"),
    "cci": ("cci", "cci"),
    "mfi": ("mfi", "mfi"),
    "macd.signal": ("macd", "signal"),
    "macd.histogram": ("macd", "histogram"),
    "bb.upper": ("bb", "upper"),
    "bb.middle": ("bb", "middle"),
    "bb.lower": ("bb", "lower"),
    "stoch.d": ("stoch", "d"),
    "vwap": ("vwap", "vwap"),
    "atr": ("atr", "atr"),
    "adx.adx": ("adx", "adx"),
    "adx.plusDI": ("adx", "plusDI"),
    "adx.minusDI": ("adx", "minusDI"),
    "obv": ("obv", "obv"),
    "donchian.upper": ("donchian", "upper"),
    "donchian.middle": ("donchian", "middle"),
    "donchian.lower": ("donchian", "lower"),
    "ichimoku.tenkan": ("ichimoku", "tenkan"),
    "ichimoku.kijun": ("ichimoku", "kijun"),
    "ichimoku.spanA": ("ichimoku", "spanA"),
    "ichimoku.spanB": ("ichimoku", "spanB"),
    "ichimoku.chikou": ("ichimoku", "chikou"),
    "sar.priceCrossedSar": ("sar", "priceCrossedSar"),
    "sar.trendFlipped": ("sar", "trendFlipped"),
}

# ⛔ THESE THREE HAVE NO CHART PLOT AT ALL, and it is not an omission.
# `bb` reports the CLOSE (`alert_series._series_bb`), `price_vs_ma` is a spread
# this module synthesises and `close` is the bar's own close — all three are
# prices on the candles' scale, which is what `DEFAULT_DECIMALS` is FOR.
_NO_CHART_PLOT = {"bb", "price_vs_ma", "close"}


def test_the_address_to_plot_map_covers_every_address_that_exists():
    """Totality, derived from the evaluator's own enumeration."""
    declared = set(_ADDRESS_PLOT) | _NO_CHART_PLOT
    addresses = set(ev.all_addresses())
    assert declared == addresses, (
        f"unmapped addresses: {sorted(addresses - declared)}; "
        f"mapped but not offered: {sorted(declared - addresses)}")


def test_the_python_decimals_table_matches_the_JS_registry():
    """⭐ ONE PIPELINE ACROSS TWO LANGUAGES — as a rail, not a habit.

    `legend.decimals` is authored in `nativeRegistry.js`; this lane keeps a table
    beside it, exactly as `alert_rev_migration.ADDRESS_REVS` mirrors
    `compute.rev`. A precision edit in the registry must land RED here, because
    the moment somebody comes to fix it is the moment they decide whether the
    number in a member's inbox moves with the number on the chart.
    """
    js = _js_plot_decimals()
    assert len(js) >= 15, f"only {len(js)} declaring plots parsed — vacuous"
    assert set(js.values()) >= {0, 1, 2, 4}, (
        f"the parse found only precisions {sorted(set(js.values()))} — it is not "
        "reading the file it thinks it is")

    # `readout.DEFAULT_DECIMALS` is the OTHER half of the contract: an address
    # with no declaring plot must print what the legend's own fallback prints.
    readout = READOUT_JS.read_text(encoding="utf-8")
    m = re.search(r"const DEFAULT_DECIMALS\s*=\s*(\d+)", readout)
    assert m, "readout.js no longer declares DEFAULT_DECIMALS — the parse is vacuous"
    assert ev.NOTIFICATION_DEFAULT_DECIMALS == int(m.group(1))

    covered = []
    for address, plot in sorted(_ADDRESS_PLOT.items()):
        if plot not in js:
            continue                      # that plot declares no visible chip
        covered.append(address)
        assert ev.value_decimals(address) == js[plot], (
            f"{address}: the chip prints {js[plot]} decimals and the "
            f"notification prints {ev.value_decimals(address)} — that is the "
            "second formatting pipeline spec §6 forbids")
    assert len(covered) >= 15, f"only {covered} compared — the rail is vacuous"

    # …and no dead weight: a table entry equal to the default is a line nobody
    # can tell from its absence, and one naming no address is a typo.
    assert set(ev.ALERT_VALUE_DECIMALS) <= set(ev.all_addresses())
    assert all(v != ev.NOTIFICATION_DEFAULT_DECIMALS
               for v in ev.ALERT_VALUE_DECIMALS.values())


@pytest.mark.parametrize("address,value,expected", [
    ("rsi", 71.34, "71.3"),               # the oscillator family: 1
    ("mfi", 71.34, "71.3"),
    ("adx.adx", 27.55, "27.6"),
    ("obv", 1234567.4, "1234567"),        # a cumulative share count: 0
    ("macd", 0.12345, "0.1235"),          # small magnitudes: 4
    ("atr", 1.23456, "1.2346"),
    ("vwap", 431.204, "431.20"),          # a price on the candles' scale: 2
    ("close", 431.204, "431.20"),
])
def test_the_number_is_printed_to_the_precision_the_CHIP_declares(
        address, value, expected, sent):
    assert ev.format_alert_value(address, value) == expected
    ev._dispatch_delivery(_alert(indicator=address, threshold=None), value)
    assert f" — {expected}" in sent[0]["message"], sent[0]["message"]


def test_the_threshold_and_the_value_print_at_the_SAME_precision(sent):
    """Two numbers on one scale in one sentence. `70.00 — 71.3` is the tell."""
    ev._dispatch_delivery(_alert(threshold=70.0), 71.34)
    msg = sent[0]["message"]
    assert "70.0 — 71.3" in msg, msg
    assert "70.00" not in msg, msg


def test_a_value_the_formatter_cannot_read_still_reaches_the_member(sent):
    """`format_alert_value` returns None rather than raising on a non-number."""
    assert ev.format_alert_value("rsi", None) is None
    assert ev.format_alert_value("rsi", True) is None, "a bool is not a level"
    ev._dispatch_delivery(_alert(threshold=None), "n/a")
    assert sent and "n/a" in sent[0]["message"]


# ─── ⭐ THE RECEIPT: bar_time through the REAL cycle ─────────────────────────

def _fires(db_path) -> list[tuple]:
    con = sqlite3.connect(str(db_path))
    try:
        return con.execute(
            "SELECT alert_id, fire_key, bar_time, value FROM indicator_alert_fires "
            "ORDER BY id").fetchall()
    finally:
        con.close()


def test_the_cycle_STAMPS_the_bar_it_judged_and_the_column_is_no_longer_NULL(
        tmp_db, sent, monkeypatch):
    """🔴 THE RECEIPT BLOCKER. Measured NULL on every row before this change.

    The forming lane judges `bars[-1]`, so that is the `t` the row must carry —
    asserted against the LAST bar specifically, with the second-to-last bar's `t`
    named as the wrong answer, so "it stored a number" is not enough.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    aid = ias.create(user_id="u9", sym="SPY", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    summary = ev._run_one_cycle()
    assert summary["triggered"] == 1, summary

    rows = _fires(tmp_db)
    assert len(rows) == 1, rows
    assert rows[0][2] is not None, "bar_time is still NULL — the receipt is a log"
    assert rows[0][2] == _RISING[-1]["t"], (
        f"the row names bar {rows[0][2]} and the lane judged {_RISING[-1]['t']}")
    assert rows[0][2] != _RISING[-2]["t"], "the fixture cannot tell the two apart"
    assert fl.fires_for_alert(aid)[0]["bar_time"] == _RISING[-1]["t"]

    # …and the member's message names the same bar the row does.
    assert sent, "the cycle delivered nothing"
    assert _et_close_text(_RISING[-1]["t"], 5) in sent[0]["message"]


def test_a_SNOOZED_alert_records_NOTHING_and_delivers_NOTHING(tmp_db, monkeypatch):
    """⛔ THE 31 SOAK ROWS ARMED ON PRODUCTION MUST STAY NON-DELIVERABLE.

    They are `active=1` (so `list_active()` and the shadow lane see them) and
    SNOOZED (so `record_trigger` returns False BEFORE the fired log is touched).
    Naming the bar happens strictly AFTER that refusal, so it cannot reach them —
    asserted here rather than argued, through the REAL delivery hook so the
    claim covers the gate and not a spy that replaced it.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    delivered: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append((a, k)))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)

    aid = ias.create(user_id="u9", sym="SPY", indicator="rsi",
                     condition="above", threshold=70.0, tf="5",
                     params_json={"_soak": "phase-c-shadow-matrix"})
    ias.snooze(aid, 30 * 24 * 60)
    assert ias.snooze_active(ias.get(aid)) is True

    for _ in range(6):
        ev._run_one_cycle()

    assert _fires(tmp_db) == [], "a snoozed alert recorded a fire"
    assert delivered == [], "a snoozed alert reached a member"

    # NON-VACUITY: the very same alert, un-snoozed, DOES both. Without this the
    # two assertions above would pass on a cycle that never evaluated anything.
    ias.rearm(aid)
    assert ias.snooze_active(ias.get(aid)) is False
    ev._run_one_cycle()
    rows = _fires(tmp_db)
    assert len(rows) == 1 and rows[0][2] == _RISING[-1]["t"], rows
    assert len(delivered) == 1


def test_a_released_delivery_lease_is_RETRIED_on_a_later_cycle(tmp_db,
                                                               monkeypatch):
    """🔴 WHY `_dispatch_delivery` IS CALLED UNCONDITIONALLY, AS A MEASUREMENT.

    `record_trigger`'s docstring used to claim the cycle calls `_dispatch_
    delivery` only when it returns True, and `claim_delivery`'s comment recorded
    the "one-line fix" `if ias.record_trigger(...): _dispatch_delivery(...)` as
    still owed. Task 8 RULED AGAINST IT and this is the reason, executable:

      * a level condition keys on its ARMED EPISODE, so after the first fire
        `record_trigger` returns False on every subsequent cycle;
      * a delivery that failed hands its lease back (`release_delivery`) so the
        row is undelivered again and a later cycle can re-send it;
      * gating the call site would mean no later cycle ever calls the dispatch,
        so the released lease is never picked up and the member is NEVER TOLD —
        trading a snooze leak (already closed at `claim_delivery`, which is what
        every channel is downstream of) for a permanent silent drop.

    ⚠️ THE REAL `deliver_alert_payload` RUNS HERE — only the channels are
    stubbed — because the claim/release contract lives inside it and a spy that
    replaced it would assert nothing about the gate.
    """
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in _RISING])
    delivered: list = []
    monkeypatch.setattr(wls, "add_alert", lambda *a, **k: delivered.append(k))
    monkeypatch.setattr(wls, "send_email", lambda *a, **k: None)
    monkeypatch.setattr(wls, "_get_user_email", lambda uid: None)
    import api.services.alerts as _alerts
    monkeypatch.setattr(_alerts, "_fire_discord", lambda payload: None)

    aid = ias.create(user_id="u9", sym="SPY", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")

    ev._run_one_cycle()
    first = fl.fires_for_alert(aid)
    assert len(first) == 1 and first[0]["delivered_at"] is not None, first
    assert len(delivered) == 1
    fire_id = first[0]["id"]

    # The provider refused: the lease is handed back, exactly as a 429 does.
    out = fl.release_delivery(fire_id, error="429 Too Many Requests")
    assert out["released"] is True and out["terminal"] is False, out
    assert fl.fires_for_alert(aid)[0]["delivered_at"] is None

    # ⭐ THE MEASUREMENT: on the next cycle `record_trigger` says False — there is
    # nothing NEW — and the member is told anyway, because the undelivered row
    # is still there.
    assert ias.record_trigger(aid, last_value=99.0,
                              bar_time=_RISING[-1]["t"]) is False, (
        "the episode key moved; this test would prove nothing about the retry")
    ev._run_one_cycle()

    assert fl.count_fires(aid) == 1, "the retry recorded a SECOND fire"
    assert fl.fires_for_alert(aid)[0]["delivered_at"] is not None, (
        "the released lease was never picked up — a failed delivery is a "
        "permanent silent drop")
    assert len(delivered) == 2, delivered


def test_naming_the_bar_moves_a_CROSS_conditions_key_from_the_EPISODE_to_the_BAR(
        tmp_db, sent, monkeypatch):
    """⚠️ THE ONE BEHAVIOURAL CONSEQUENCE OF THE STAMP, MEASURED NOT ARGUED.

    `fire_key` is `bar:<t>` for an EDGE condition that knows its bar and
    `ep:<arm_epoch>` otherwise, so passing `bar_time` changes the dedup key for
    `cross_*`. The direction is the one `alert_fired_log`'s own docstring calls
    correct and it is strictly QUIETER: two genuine crossings inside ONE bar used
    to be two emails (the first fire re-arms on the intervening false cycle, so
    the episode key moves) and are now one. A LEVEL condition is untouched.
    """
    holder = {"bars": _RISING}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in holder["bars"]])
    # Both fixtures END on the same bar `t`, so "the same bar" is a fact about
    # the key and not about the clock.
    assert _RISING[-1]["t"] == _FALLING[-1]["t"]
    assert ev.address_value("rsi", _RISING, {}) > 70
    assert ev.address_value("rsi", _FALLING, {}) < 70

    cross = ias.create(user_id="u9", sym="SPY", indicator="rsi",
                       condition="cross_above", threshold=70.0, tf="5")
    level = ias.create(user_id="u9", sym="SPY", indicator="rsi",
                       condition="above", threshold=70.0, tf="5")

    holder["bars"] = _FALLING
    ev._run_one_cycle()                 # seeds last_value BELOW the threshold
    holder["bars"] = _RISING
    ev._run_one_cycle()                 # the crossing
    holder["bars"] = _FALLING
    ev._run_one_cycle()                 # false: both re-arm, arm_epoch moves
    holder["bars"] = _RISING
    ev._run_one_cycle()                 # a SECOND crossing, on the SAME bar

    assert ias.get(cross)["arm_epoch"] > 0, (
        "the alert never re-armed — the episode key never moved and this test "
        "would pass with the stamp deleted")

    cross_keys = [k for a, k, _b, _v in _fires(tmp_db) if a == cross]
    level_keys = [k for a, k, _b, _v in _fires(tmp_db) if a == level]
    assert cross_keys == [f"bar:{_RISING[-1]['t']}"], (
        f"a cross condition recorded {cross_keys} — on the episode key that "
        "would be two fires on one bar")
    assert all(k.startswith("ep:") for k in level_keys) and level_keys, level_keys


def test_a_bar_whose_timestamp_cannot_be_keyed_does_not_cost_the_alert(
        tmp_db, sent, monkeypatch):
    """⛔ `fire_key` RAISES on a `t` it cannot normalise, and that exception
    would propagate through `record_trigger` into the cycle's per-alert handler:
    the member loses the alert because one bar carried a bad timestamp.
    `_fire_bar_time` asks the log's own normaliser first."""
    bars = [dict(b) for b in _RISING]
    bars[-1]["t"] = "not-a-timestamp"
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=200: [dict(b) for b in bars])
    assert ev._fire_bar_time(bars, len(bars) - 1) is None
    with pytest.raises(ValueError):
        fl._norm_bar_time("not-a-timestamp")

    ias.create(user_id="u9", sym="SPY", indicator="rsi",
               condition="above", threshold=70.0, tf="5")
    summary = ev._run_one_cycle()
    assert summary["errors"] == 0, summary
    rows = _fires(tmp_db)
    assert len(rows) == 1 and rows[0][2] is None, rows
    assert sent and " at " not in sent[0]["message"]


def test_the_cycle_names_the_bar_at_the_seam_TASK_8_will_move(tmp_db):
    """The structural half of the receipt, so a refactor that drops the stamp
    fails even if every behavioural test above were somehow satisfied.

    ⚠️ THIS IS ALSO THE HANDOFF. Task 8 replaces `_evaluate_one` with
    `_evaluate_one_closed`, which RETURNS the index it judged; when it does,
    `judged_index` stops being `len(bars) - 1` and this assertion is the thing
    that says so out loud.
    """
    module = ast.parse(Path(ev.__file__).read_text(encoding="utf-8"))
    cycles = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "_run_one_cycle"]
    assert len(cycles) == 1
    src = ast.unparse(cycles[0])
    assert "bar_time" in src, "_run_one_cycle no longer names bar_time"
    assert "_fire_bar_time" in src, (
        "_run_one_cycle no longer validates the bar it stamps")
    assert "record_trigger" in src and "bar_time=bar_time" in src, (
        "the fired log is being written without the bar again — every row NULL")

    others = [n for n in module.body
              if isinstance(n, ast.FunctionDef) and n.name == "_evaluate_one"]
    assert len(others) == 1
    assert "_fire_bar_time" not in ast.unparse(others[0]), (
        "the scan is reading more than the cycle's own body")


def test_ALERT_EVAL_MODE_is_still_forming_so_the_named_bar_is_the_NEWEST_one():
    """The premise every bar assertion in this file rests on.

    Task 8 flips this constant. When it does, `bars[-1]` stops being the judged
    bar and this test names the file that has to move with it — deliberately,
    because a stamp that silently kept naming the forming bar after the cutover
    would be a WRONG receipt rather than a missing one.
    """
    assert ev.eval_mode() == "forming"
    assert ev.ALERT_EVAL_MODE == "forming"
