"""The server-built UCT breadth universe (`api/services/breadth_server_universe.py`).

It must make the SAME decision the PC collector makes (`breadth_collector._get_universe`):
CS/ADRC, close >= $2, volume >= 200k, market cap >= $300M (no cap on record = excluded),
minus the manual exclude set — over the session BEFORE the one being measured.
"""
from __future__ import annotations

import pytest

from api.services import breadth_server_universe as bsu

REF = {
    "AAA": [{"type": "CS", "primary_exchange": "XNYS"}],
    "BBB": [{"type": "ADRC", "primary_exchange": "XNAS"}],
    "ETF1": [{"type": "ETF", "primary_exchange": "ARCX"}],
    "PEN": [{"type": "CS", "primary_exchange": "XNAS"}],
    "THIN": [{"type": "CS", "primary_exchange": "XNAS"}],
    "SMALL": [{"type": "CS", "primary_exchange": "XNAS"}],
    "NOCAP": [{"type": "CS", "primary_exchange": "XNAS"}],
    "SMX": [{"type": "CS", "primary_exchange": "XNAS"}],
    "GONE": [{"type": "CS", "primary_exchange": "XNAS", "delisted_utc": "2020-01-01"}],
}
FRAME = {
    "AAA": {"c": 50.0, "v": 1_000_000},
    "BBB": {"c": 10.0, "v": 300_000},
    "ETF1": {"c": 100.0, "v": 5_000_000},
    "PEN": {"c": 1.99, "v": 9_000_000},
    "THIN": {"c": 20.0, "v": 199_999},
    "SMALL": {"c": 20.0, "v": 1_000_000},
    "NOCAP": {"c": 20.0, "v": 1_000_000},
    "SMX": {"c": 20.0, "v": 1_000_000},
    "GONE": {"c": 20.0, "v": 1_000_000},
    "UNKNOWN": {"c": 20.0, "v": 1_000_000},
}
CAPS = {"AAA": 5e9, "BBB": 3e8, "ETF1": 9e9, "PEN": 1e9, "THIN": 1e9,
        "SMALL": 299_999_999, "SMX": 1e9, "GONE": 1e9, "UNKNOWN": 1e9}


def test_the_collectors_filter_name_by_name():
    tickers, counts = bsu.select(FRAME, REF, CAPS, "2026-10-08")
    assert tickers == ["AAA", "BBB"]                     # $300M exactly passes (>=)
    assert counts == {"frame": 10, "not_common": 1, "unresolved": 2, "fail_price": 1,
                      "fail_volume": 1, "no_cap": 1, "fail_cap": 1, "excluded": 1,
                      "eligible": 2}


def test_the_floors_are_the_collectors():
    assert (bsu.PRICE_FLOOR, bsu.VOLUME_FLOOR, bsu.CAP_FLOOR) == (2.0, 200_000, 300_000_000)
    assert bsu.TYPES == {"CS", "ADRC"} and "SMX" in bsu.EXCLUDE


def test_a_thin_list_is_refused_never_used(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_SERVER_UNIVERSE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setattr(bsu, "previous_session", lambda d: "2026-10-08")
    from api.services import massive, breadth_pit_frame as bpf
    monkeypatch.setattr(massive, "get_grouped_daily_frame", lambda d, adjusted=False: {"rows": FRAME})
    monkeypatch.setattr(bpf, "reference_map", lambda: REF)
    monkeypatch.setattr(bsu, "market_caps", lambda: {f"X{i}": 1e9 for i in range(2000)} | CAPS)
    out = bsu.build("2026-10-09")
    assert not out["ok"] and "floor" in out["reason"]
    assert not (tmp_path / "u.json").exists()


def test_a_built_list_is_kept_per_session(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_SERVER_UNIVERSE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setattr(bsu, "MIN_SIZE", 2)
    monkeypatch.setattr(bsu, "previous_session", lambda d: "2026-10-08")
    from api.services import massive, breadth_pit_frame as bpf
    frames = []
    monkeypatch.setattr(massive, "get_grouped_daily_frame",
                        lambda d, adjusted=False: frames.append((d, adjusted)) or {"rows": FRAME})
    monkeypatch.setattr(bpf, "reference_map", lambda: REF)
    monkeypatch.setattr(bsu, "market_caps", lambda: CAPS)
    out = bsu.build("2026-10-09")
    assert out["ok"] and out["tickers"] == ["AAA", "BBB"] and out["basis_date"] == "2026-10-08"
    assert frames == [("2026-10-08", False)]              # the RAW frame of the prior session
    again = bsu.build("2026-10-09")                       # persisted: no second fetch
    assert again["tickers"] == ["AAA", "BBB"] and len(frames) == 1


def test_no_frame_or_no_caps_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_SERVER_UNIVERSE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setattr(bsu, "previous_session", lambda d: "2026-10-08")
    from api.services import massive, breadth_pit_frame as bpf
    monkeypatch.setattr(massive, "get_grouped_daily_frame", lambda d, adjusted=False: {"rows": {}})
    monkeypatch.setattr(bpf, "reference_map", lambda: REF)
    monkeypatch.setattr(bsu, "market_caps", lambda: CAPS)
    assert "no grouped-daily frame" in bsu.build("2026-10-09")["reason"]


def test_compare_names_both_sides():
    c = bsu.compare(["A", "B", "C"], ["B", "C", "D"])
    assert c["both"] == 2 and c["only_server"] == ["A"] and c["only_collector"] == ["D"]
    assert c["jaccard"] == 0.5
