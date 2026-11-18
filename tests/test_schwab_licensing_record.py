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

THEN, THE SAME DAY, the owner ruled (verbatim) "Move Flow Record to Massive", and later that day
(verbatim) "Move it, fix the status and remove schwab from everything". SCHWAB IS RETIRED FROM THE
PRODUCT: no production code reads it (tests/test_no_schwab_in_production_code.py is the standing
rail). What this file holds now:

  * the register keeps every Schwab row and every class it recorded (nothing deleted, no class
    changed), and each row carries a dated note that says Schwab was retired on 2026-11-17, with the
    owner's words;
  * the licensing table keeps its four Schwab rows as the historical record, each marked retired;
  * the Flow Record reads Massive only, in the code and in the T-27 / X-12 rows;
  * the two flags that chose a Schwab source are retired in the ledger, and the code reads neither.

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


OWNER_WORDS = 'Move it, fix the status and remove schwab from everything'


def test_the_register_says_schwab_was_retired_and_deletes_nothing():
    """The dated-note convention: a note is appended, the earlier text and every class stay."""
    for rid, header, cell in (("T-77", T_HEADER, "Use"), ("T-78", T_HEADER, "Use"),
                              ("X-09", X3B_HEADER, "What leaves")):
        text = _row(rid, header)[cell]
        assert "RETIRED 2026-11-17" in text, rid
        assert OWNER_WORDS in text, rid                                   # quoted verbatim
        assert "class is left as recorded" in text, rid
    t77 = _row("T-77", T_HEADER)
    assert "Massive's options snapshot only" in t77["Use"]
    assert "one process-wide OAuth token" in t77["Driver clause"]          # the history is still there
    assert "no new Schwab snapshot is stored" in _row("T-78", T_HEADER)["Use"]
    assert "is the owner's to delete" in _row("T-78", T_HEADER)["Use"]     # the token file, never touched here
    t79 = _row("T-79", T_HEADER)
    assert "2026-11-17 note" in t79["Use"] and "derived from Massive, not Schwab" in t79["Use"]
    assert "**derived from Schwab chains**" in _row("X-09", X3B_HEADER)["What leaves"]   # kept, with the note after it


def test_the_flow_record_reads_massive_only_in_the_code_and_in_its_rows():
    """T-27 / X-12 said the gains come "from the OPRA tape"; then, from the code, from Schwab;
    then Massive first with Schwab as backup; then (same day) Massive only. Read that from the
    code, then from the rows, which keep every earlier sentence. (The behaviour itself is driven
    with Massive faked in tests/test_top_flow_snapshot_source.py.)"""
    src = (REPO / "api" / "top_flow_tracker.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    assert not [n for n in tree.body if isinstance(n, ast.Assign)
                and any(getattr(t, "id", "") == "TOP_FLOW_MODE_FLAGS" for t in n.targets)]
    sweep = _tracker_fn(tree, "_snapshot_prices")
    assert "_massive_chunk" in {name for _, name in _named_calls(sweep)}
    massive_fn = _tracker_fn(tree, "_massive_chunk")
    imports = {(n.module, a.name) for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) for a in n.names}
    assert ("api.massive_oi_snapshots", "_fetch_fields_all_async") in imports
    assert not [m for m, _ in imports if "schwab" in (m or "").lower()]
    assert "_fetch_fields_all_async" in {name for _, name in _named_calls(massive_fn)}
    assert "get_batch_option_quotes" not in src
    for rid, header, what, provider in (("T-27", T_HEADER, "Use", "Provider · data class"),
                                        ("X-12", X3B_HEADER, "What leaves", "Provider · data")):
        row = _row(rid, header)
        assert "Massive OPRA" in row[provider], rid
        assert "Changed again on 2026-11-17" in row[provider] and "Massive only; no Schwab read remains" in row[provider], rid
        use = row[what]
        assert "Changed again on 2026-11-17" in use and OWNER_WORDS in use, rid
        assert "the daily snapshot reads Massive only" in use, rid
        assert "Results recorded from Schwab stay as recorded" in use, rid
        # history kept: the OPRA wording, the Schwab note, the first ruling and its rollback line
        assert 'was "contract-price gains from the OPRA tape"' in use, rid
        assert "read from Schwab (`api/top_flow_tracker.py::snapshot_prices`" in use, rid
        assert 'owner ruling, verbatim: "Move Flow Record to Massive"' in use, rid
        assert "`TOP_FLOW_SNAPSHOT_SOURCE=schwab` is the rollback" in use, rid
        assert use.index("is the rollback") < use.index("Changed again on 2026-11-17"), rid


# ── the licensing table keeps the register's class as a retired record, and switches nothing on ──

def test_every_schwab_row_in_the_table_is_the_class_its_register_row_has_in_force():
    schwab = {dc: e for (v, dc), e in plc.all_entries().items() if v == "schwab"}
    assert set(schwab) == {"option_chains", "option_quotes", "open_interest", "gex_public_recordings"}
    for dc, e in schwab.items():
        assert e.register_row in ("T-77", "T-78", "T-79"), dc
        assert _leading_class(_row(e.register_row, T_HEADER)["Class in force"]) == e.licensing_class, dc
    assert schwab["gex_public_recordings"].licensing_class == "R"       # T-79 is not loosened
    for dc, e in schwab.items():
        assert e.note.startswith("RETIRED 2026-11-17"), dc                # a record, not a live read
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


# ── the two source switches are retired, and nothing reads them ───────────────

def _ledger() -> dict:
    return json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))


def test_the_gex_chain_is_massive_in_the_code_and_the_switch_is_retired_in_the_ledger():
    tree = ast.parse((REPO / "api" / "gex_service.py").read_text(encoding="utf-8"))
    assigned = {getattr(t, "id", "") for n in tree.body if isinstance(n, ast.Assign) for t in n.targets}
    assert not assigned & {"GEX_CHAIN_MODE_FLAGS", "GEX_SOURCE_ENV", "GEX_SOURCES", "GEX_MODES", "CHAINS_URL"}
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "chain_source")
    returns = [n.value.value for n in ast.walk(fn) if isinstance(n, ast.Return)]
    assert returns == ["massive"]                                        # one source, no environment read
    doc = _ledger()
    for name in ("GEX_CHAIN_SOURCE", "TOP_FLOW_SNAPSHOT_SOURCE"):
        assert name not in doc["flags"], name
        row = doc["retired"][name]
        assert row["retired"] == "2026-11-17" and row["state"] == "always massive", name
        assert OWNER_WORDS in row["note"], name
        assert "member_facing" not in row, name
    note = _prose(doc["retired"]["GEX_CHAIN_SOURCE"]["note"])
    assert "since 2026-09-30" in note and "inert" in note               # production's set value, said plainly
    assert "the gex arithmetic is unchanged" in note


def test_the_three_schwab_login_gates_are_retired_as_removed():
    doc = _ledger()
    for name in ("SCHWAB_AUTO_REFRESH_ENABLED", "SCHWAB_TOKEN_PUSH_ENABLED", "SCHWAB_TOKEN_REPLICA_RECEIVE_ENABLED"):
        assert name not in doc["flags"], name
        row = doc["retired"][name]
        assert row["retired"] == "2026-11-17" and row["state"] == "removed" and "inert" in row["note"], name
