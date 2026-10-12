"""IR-S10 / R-P2-5: app/src/constants/houseSizing.json is the ONE in-repo copy of the house sizing table.
This rail PARSES uct-intelligence's _SIZING_TABLE (an ast read, never an import) and compares every cell.
⛔ ONLY `ceilingPct` IS ENGINE-CHECKED. `maxAccountRiskPct` (2) and `preferredAccountRiskPct` (1) are PINNED
house values from spec P2 item 5 ("max 2%, prefer under 1%"): the engine has no named authority for either
(calculate_position_size takes risk_pct as an argument; its only 1% is a function-local default), so they
are pinned here as literals and are NOT compared against uct-intelligence.
⛔ When uct-intelligence is not on this box the comparison SKIPS, visibly, naming where it looked.
A SKIP IS NOT A PASS: the PR body says which of the two this run was."""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path

import pytest

TABLE = Path(__file__).resolve().parent.parent / "app" / "src" / "constants" / "houseSizing.json"
CANDIDATES = [p for p in (os.environ.get("UCT_INTEL_PATH"), "external/uct-intelligence",
                          r"C:\Users\Patrick\uct-intelligence") if p]


def _engine_api() -> Path | None:
    for root in CANDIDATES:
        p = Path(root) / "uct_intelligence" / "api.py"
        if p.is_file():
            return p
    return None


def _sizing_table(src: str) -> dict[tuple[str, str], float]:
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_SIZING_TABLE" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("no `_SIZING_TABLE = {...}` assignment in uct_intelligence/api.py")


def test_the_in_repo_table_is_whole():
    t = json.loads(TABLE.read_text(encoding="utf-8"))
    assert t["maxAccountRiskPct"] == 2
    assert t["preferredAccountRiskPct"] == 1          # the house rule: max 2%, prefer under 1%
    assert set(t["ceilingPct"]) == {"GREEN", "YELLOW", "ORANGE", "RED"}
    assert all(set(row) == {"A+", "A", "B"} for row in t["ceilingPct"].values())
    assert t["regimeWords"] == {"green": "GREEN", "amber": "YELLOW", "orange": "ORANGE", "red": "RED"}


def test_the_regime_words_cover_every_id_the_server_classifier_answers():
    """The client maps the server's regime ids through this table; an id it lacks would read as
    'regime not known'. trader_blocks.REGIME_IDS is the server's list."""
    from api.services.journal_two import trader_blocks
    t = json.loads(TABLE.read_text(encoding="utf-8"))
    assert set(t["regimeWords"]) == set(trader_blocks.REGIME_IDS)
    assert set(t["regimeWords"].values()) == set(t["ceilingPct"])


def test_the_placeholder_is_the_servers_default_account_size():
    """IR-S9: the client treats this number as 'not set'; it must BE the server's default."""
    from api.services.journal_two import accounts
    assert json.loads(TABLE.read_text(encoding="utf-8"))["placeholderAccountSize"] == accounts._DEFAULT_ACCOUNT_SIZE


def test_the_table_equals_uct_intelligences_sizing_table():
    api = _engine_api()
    if api is None:
        pytest.skip(f"SKIP, NOT A PASS: uct-intelligence not found (looked in {CANDIDATES}); "
                    "the house table was NOT compared against _SIZING_TABLE")
    engine = _sizing_table(api.read_text(encoding="utf-8"))
    assert engine, "the parsed engine table is empty"                     # non-vacuity
    ours = json.loads(TABLE.read_text(encoding="utf-8"))["ceilingPct"]
    flat = {(r, g): v / 100 for r, row in ours.items() for g, v in row.items()}
    assert set(flat) == set(engine), (sorted(flat), sorted(engine))
    for key, frac in engine.items():
        assert abs(flat[key] - frac) < 1e-9, (key, flat[key], frac)


def test_control_the_parser_reads_a_planted_table_and_sees_a_changed_cell():
    src = '_SIZING_TABLE = {("GREEN", "A+"): 0.25, ("RED", "B"): 0.00}\nother = 1\n'
    assert _sizing_table(src) == {("GREEN", "A+"): 0.25, ("RED", "B"): 0.0}
    assert _sizing_table(src.replace("0.25", "0.20"))[("GREEN", "A+")] != 0.25


# R-M2-1 (e): the regime DISPLAY words (app/src/pages/journal-2-0/lib/blocks/regimeWords.js) are railed against
# builtin:regime_at_write by tests/test_journal_two_properties_router.py, the ONE rail on the ONE map (M2).
