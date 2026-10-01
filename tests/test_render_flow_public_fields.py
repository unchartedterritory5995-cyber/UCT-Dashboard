"""/api/r/flow passes through every field the flow panel reads.

The whitelist and FlowRender.jsx were two lists nobody wired together: the panel
read trade_type / oi_state / streak and the endpoint dropped them, so the
letter's flow image printed a blank Type column for weeks. The needle list is
DERIVED from the renderer (comments stripped), never restated here."""
from __future__ import annotations

import re
from pathlib import Path

from api.routers import render_panels as rp

_JSX = Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "FlowRender.jsx"


def _fields_the_panel_reads() -> set:
    src = _JSX.read_text(encoding="utf-8")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)          # block comments
    src = re.sub(r"(?m)//.*$", "", src)                       # line comments
    return set(re.findall(r"\bo\.([A-Za-z_]\w*)", src))


def test_the_instrument_sees_the_panels_fields():
    got = _fields_the_panel_reads()
    assert {"sym", "strike_label", "trade_type"} <= got       # control: it can see a field
    assert "orders" not in got                               # control: not every dotted name


def test_every_field_the_panel_reads_is_public():
    missing = _fields_the_panel_reads() - set(rp._FLOW_PUBLIC)
    assert not missing, f"FlowRender.jsx reads fields /r/flow drops: {sorted(missing)}"


def test_the_endpoint_passes_them_through(monkeypatch):
    from api.services import engine as eng
    monkeypatch.setattr(rp, "_check_token", lambda token: None)
    monkeypatch.setattr(eng, "_load_wire_data", lambda: {"options_flow": {"session": "2026-09-29", "orders": [
        {"sym": "META", "call_put": "CALL", "trade_type": "SWEEP+BLOCK", "oi_state": "NEW",
         "streak": 7, "raw_source": "internal"}]}})
    out = rp.render_flow(token="x")
    row = out["orders"][0]
    assert (row["trade_type"], row["oi_state"], row["streak"]) == ("SWEEP+BLOCK", "NEW", 7)
    assert "raw_source" not in row                           # still a whitelist
