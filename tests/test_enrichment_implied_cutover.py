from unittest.mock import patch

from api.routers import calendar as cal


def test_cutover_is_off_by_default(monkeypatch):
    monkeypatch.delenv("IMPLIED_ENRICHMENT_CUTOVER", raising=False)
    assert cal._cutover_on() is False
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "1")
    assert cal._cutover_on() is True
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "0")
    assert cal._cutover_on() is False


def test_inhouse_move_rounds_pct_and_dollar_for_the_calendar_ui():
    raw = {"pct": 6.234567891, "dollar": 12.3456789, "expiry": "2026-08-07",
           "strike": 185.0, "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2,
           "iv_atm": 0.6, "horizon": "through 2026-08-07", "source": "massive-chain"}
    with patch("api.services.implied_move.get_expected_move", return_value=raw):
        out = cal._inhouse_move("TST", "2026-08-06")
    # pages/calendar/CalendarDayTable.jsx:87 prints `±${pct}%` with NO formatter,
    # so an unrounded float renders ±6.234567891%.
    assert out["pct"] == 6.2 and out["dollar"] == 12.35
    assert out["expiry"] == "2026-08-07" and out["horizon"] == "through 2026-08-07"


def test_inhouse_move_returns_none_when_the_chain_read_fails():
    with patch("api.services.implied_move.get_expected_move", return_value=None):
        assert cal._inhouse_move("TST", "2026-08-06") is None
