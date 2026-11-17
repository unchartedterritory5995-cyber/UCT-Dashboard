"""The recorded Schwab licensing position, held in the places that contradicted it (2026-11-17).

THE FACT. It was ruled by the owner; this file makes NO ruling and only stops the repo
contradicting one. The owner approved showing Schwab-sourced option data to members:

  * licensing register rows T-77 / T-78, scenario LA: "ANSWERED BY THE OWNER 2026-09-19:
    Schwab confirmed" (Commercial/Redistribution tier with display to non-account-holders);
  * ESC-10: "CLOSED AND APPROVED BY THE OWNER 2026-09-26" (owner, verbatim: "consider finnhub
    and schwab closed and approved", docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-26.md);
  * the agreement document itself is not captured in the repo;
  * still restricted: Schwab-derived GEX in PUBLIC recordings (T-79, class R, pending T-18).

WHAT WENT WRONG. Four records lagged that answer, and engineers read them as a refusal:
a comment in api/gex_service.py and the GEX_CHAIN_SOURCE ledger note said the Schwab read was
not licensed for member display; api/services/provider_licensing_class.py had no Schwab row
(so every lookup read "U"); the register's own "Class in force" cells for T-77 / T-78 / X-09
still showed the pre-answer class; and the Flow Scoreboard rows (T-27, X-12) named the OPRA
tape as the source of gains that are computed from Schwab snapshots.

THEN, THE SAME DAY, the owner ruled (verbatim) "Move Flow Record to Massive": the daily price
recording behind the Flow Record reads Massive first and keeps Schwab only as the backup for a
contract Massive has no price for; past results stay as recorded. That ruling moved one job and
nothing else here. The T-27 / X-12 rail below holds the rows to the order the code runs.

Stdlib only, no network, no app import beyond the licensing table (which imports nothing).
"""
from __future__ import annotations

import ast
import json
import pathlib
import re

from api.services import provider_licensing_class as plc

REPO = pathlib.Path(__file__).resolve().parents[1]
REGISTER = REPO / "docs" / "terminal-research" / "09-security-licensing-cost" / "licensing-register.md"
T_HEADER = ["#", "Use", "Provider · data class", "Audience", "Status", "Class in force", "Driver clause",
            "Owner fact that settles it", "Scenario", "Safest design alternative", "Per-user cost?"]
X3B_HEADER = ["#", "Route", "What leaves", "Provider · data", "Production today", "Terminal-Next plan",
              "Evidence", "Class", "§1 home", "Per-user cost bearing"]


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _register_lines() -> list[str]:
    return REGISTER.read_text(encoding="utf-8").splitlines()


def _row(row_id: str, header: list[str]) -> dict[str, str]:
    """The ONE register row with this id, as {column name: cell}."""
    lines = _register_lines()
    hits = [ln for ln in lines if ln.startswith(f"| {row_id} |")]
    assert len(hits) == 1, (row_id, len(hits))
    assert any(_cells(ln) == header for ln in lines), ("the register no longer has this header", header)
    cells = _cells(hits[0])
    assert len(cells) == len(header), (row_id, len(cells), "a `|` inside a cell would shift every column")
    return dict(zip(header, cells))


def _leading_class(cell: str) -> str:
    """'**LA** ⚰️ Was ...' -> 'LA'. The class a cell states is its first bold token."""
    m = re.match(r"\*\*([A-Z]+)\*\*", cell)
    assert m, cell[:80]
    return m.group(1)


def _prose(text: str) -> str:
    """Comment or note text as one line: no `#` gutters, single spaces, lower case."""
    return " ".join(re.sub(r"(?m)^\s*#", " ", text).split()).lower()


# ── the register agrees with its own answered rows ───────────────────────────

def test_t77_and_t78_class_in_force_is_the_answer_their_own_row_records():
    for rid, was in (("T-77", "**U, leaning R**"), ("T-78", "**U**")):
        row = _row(rid, T_HEADER)
        assert row["Scenario"] == "LA", rid
        assert "ANSWERED" in row["Owner fact that settles it"], rid
        assert _leading_class(row["Class in force"]) == "LA", rid
        # history is kept, and the correction is dated and says it is not a ruling
        assert f'Was "{was}"' in row["Class in force"], rid
        assert "2026-11-17" in row["Class in force"] and "not a new ruling" in row["Class in force"], rid
    esc10 = [ln for ln in _register_lines() if ln.startswith("| ESC-10 |")]
    assert len(esc10) == 1
    assert "ANSWERED BY THE OWNER 2026-09-19: Schwab confirmed" in esc10[0]
    assert "CLOSED AND APPROVED BY THE OWNER 2026-09-26" in esc10[0]


def test_the_public_recordings_row_is_still_restricted():
    row = _row("T-79", T_HEADER)
    assert _leading_class(row["Class in force"]) == "R"
    assert row["Scenario"].startswith("R")
    assert "T-18" in row["Use"]


def test_x09_no_longer_calls_schwab_unknown_or_prescribes_the_retired_remedy():
    row = _row("X-09", X3B_HEADER)
    assert _leading_class(row["Class"]) == "LA"
    assert "**R** as a public surface" in row["Class"]          # the route's own question is untouched
    assert 'was "**U leaning R**"' in row["Class"]
    plan = row["Terminal-Next plan"]
    assert "~~Re-source the chain from Massive (T-77 / N-10) **and**~~" in plan    # struck, not deleted
    assert "RETIRED 2026-09-19: ESC-10 answered" in plan and "authenticat" in plan
    retired = [ln for ln in _register_lines() if ln.startswith("| A8.")]
    assert len(retired) == 1 and "RETIRED 2026-09-19: ESC-10 answered" in retired[0]


def _tracker_fn(tree: ast.AST, name: str) -> ast.AsyncFunctionDef:
    return next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == name)


def _named_calls(fn: ast.AST) -> list[tuple[int, str]]:
    return [(n.lineno, n.func.id) for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]


def test_the_flow_scoreboard_rows_name_the_sources_in_the_order_the_code_reads_them():
    """T-27 / X-12 said the gains come "from the OPRA tape"; then, from the code, from Schwab;
    then the owner ruled "Move Flow Record to Massive" (2026-11-17). The tracker now fills each
    pick's daily price and open interest from Massive first and from Schwab only as the backup.
    Read that order from the code, then from the rows. (The behaviour itself is driven with both
    vendors faked in tests/test_top_flow_snapshot_source.py.)"""
    tree = ast.parse((REPO / "api" / "top_flow_tracker.py").read_text(encoding="utf-8"))
    # the declared default is Massive first; Schwab only is the other value (the rollback)
    table = next(n.value for n in tree.body if isinstance(n, ast.Assign)
                 and any(getattr(t, "id", "") == "TOP_FLOW_MODE_FLAGS" for t in n.targets))
    assert ast.literal_eval(table) == {"TOP_FLOW_SNAPSHOT_SOURCE": ("massive", ("massive", "schwab"))}
    # the sweep asks Massive before it asks Schwab ...
    sweep = _tracker_fn(tree, "_snapshot_prices")
    calls = _named_calls(sweep)
    massive_at = min(line for line, name in calls if name == "_massive_entries")
    schwab_at = min(line for line, name in calls if name == "get_batch_option_quotes")
    assert massive_at < schwab_at
    # ... through the two readers the rows name
    massive_fn = _tracker_fn(tree, "_massive_entries")
    imports = {(n.module, a.name) for fn in (sweep, massive_fn) for n in ast.walk(fn)
               if isinstance(n, ast.ImportFrom) for a in n.names}
    assert ("api.massive_oi_snapshots", "_fetch_fields_all_async") in imports
    assert ("api.schwab_service", "get_batch_option_quotes") in imports
    assert "_fetch_fields_all_async" in {name for _, name in _named_calls(massive_fn)}
    assert "get_batch_option_quotes" not in {name for _, name in _named_calls(massive_fn)}
    for rid, header, what, provider in (("T-27", T_HEADER, "Use", "Provider · data class"),
                                        ("X-12", X3B_HEADER, "What leaves", "Provider · data")):
        row = _row(rid, header)
        assert "Massive OPRA" in row[provider] and "Schwab" in row[provider], rid
        assert "Massive `/v3/snapshot/options` (the T-28 data class) first, with Schwab as the backup" in row[provider], rid
        assert "results recorded before the change are Schwab" in row[provider], rid
        use = row[what]
        assert 'owner ruling, verbatim: "Move Flow Record to Massive"' in use, rid
        first = use.index("reads Massive first (`api.massive_oi_snapshots._fetch_fields_all_async`)")
        backup = use.index("(`api.schwab_service.get_batch_option_quotes`) only for a contract Massive has no price for")
        assert first < backup, rid
        assert "`TOP_FLOW_SNAPSHOT_SOURCE=schwab` is the rollback" in use, rid
        # history kept: the OPRA wording, and the note that said Schwab (true of results up to the change)
        assert 'was "contract-price gains from the OPRA tape"' in use, rid
        assert "read from Schwab (`api/top_flow_tracker.py::snapshot_prices`" in use, rid
        assert "those stay as recorded" in use, rid


# ── the licensing table states the register's class, and switches nothing on ──

def test_every_schwab_row_in_the_table_is_the_class_its_register_row_has_in_force():
    schwab = {dc: e for (v, dc), e in plc.all_entries().items() if v == "schwab"}
    assert set(schwab) == {"option_chains", "option_quotes", "open_interest", "gex_public_recordings"}
    for dc, e in schwab.items():
        assert e.register_row in ("T-77", "T-78", "T-79"), dc
        assert _leading_class(_row(e.register_row, T_HEADER)["Class in force"]) == e.licensing_class, dc
    assert schwab["gex_public_recordings"].licensing_class == "R"       # T-79 is not loosened
    # equity quotes have no register row: unregistered, so Unknown -- never inferred from the option rows
    assert plc.licensing_class_for("schwab", "quotes") == "U"
    assert plc.entry_for("schwab", "quotes").register_row == "n/a"


def test_no_running_code_looks_a_schwab_pair_up_so_the_rows_open_no_gate():
    """The rows are a record for the reader. If this fails, a caller now reads a Schwab class:
    check what an "LA" answer turns on there (the asset-kind gate serves on A/LA,
    api/services/uct_agent/marketdata/asset_quotes.py) before changing this test."""
    readers = []
    for path in sorted((REPO / "api").rglob("*.py")):
        if path.name.startswith("test_") or path.name == "provider_licensing_class.py":
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        if "schwab" not in src.lower() or not re.search(r"licensing_class_for|entry_for|SOURCES", src):
            continue
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Call):
                name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
                if name in ("licensing_class_for", "entry_for") and node.args \
                        and isinstance(node.args[0], ast.Constant) and node.args[0].value == "schwab":
                    readers.append(f"{path.relative_to(REPO).as_posix()}:{node.lineno}")
            if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "SOURCES" for t in node.targets):
                for el in ast.walk(node.value):
                    if isinstance(el, ast.Constant) and el.value == "schwab":
                        readers.append(f"{path.relative_to(REPO).as_posix()}:{node.lineno} (SOURCES)")
    assert readers == []


# ── the two GEX notes state the recorded position, and no default moved ───────

_UNLICENSED = re.compile(r"not a licen[cs]e to redisplay|personal retail login")


def _gex_comment() -> str:
    src = (REPO / "api" / "gex_service.py").read_text(encoding="utf-8")
    start = src.index("Chain source (LCQ-02")
    return src[start:src.index("GEX_SOURCE_ENV =", start)]


def _gex_flag() -> dict:
    return json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]["GEX_CHAIN_SOURCE"]


def test_the_gex_notes_state_the_recorded_position_not_the_retired_one():
    for name, text in (("api/gex_service.py", _gex_comment()), ("GEX_CHAIN_SOURCE note", _gex_flag()["note"])):
        prose = _prose(text)
        assert not _UNLICENSED.search(prose), name
        for cite in ("t-77", "t-78", "esc-10", "answered by the owner 2026-09-19: schwab confirmed",
                     "closed and approved by the owner 2026-09-26", "t-79", "not a licence gate"):
            assert cite in prose, (name, cite)
        assert re.search(r"agreement document itself is not captured in (this|the) repo", prose), name


def test_the_note_fix_moved_no_default():
    flag = _gex_flag()
    assert flag["default"] == "schwab" and flag["values"] == ["schwab", "massive", "shadow"]
    assert flag["status"] == "armed" and flag["where"] == ["web"]
    tree = ast.parse((REPO / "api" / "gex_service.py").read_text(encoding="utf-8"))
    table = next(n.value for n in tree.body if isinstance(n, ast.Assign)
                 and any(getattr(t, "id", "") == "GEX_CHAIN_MODE_FLAGS" for t in n.targets))
    assert ast.literal_eval(table) == {"GEX_CHAIN_SOURCE": ("schwab", ("schwab", "massive", "shadow"))}
