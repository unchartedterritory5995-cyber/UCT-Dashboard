"""The 2026-11-19 restatement of `api/services/provider_licensing_class.py` to the licensing register's 2026-09-19
note ("Class in force for every FMP-gated row below is now the DDLA column" / "... every Massive-gated row below is
now the Bus column"), and the census that keeps a member-display class from becoming an AI-use or
external-publication gate.

What these rails hold:
  * the fourteen restated pairs read LA, cite their register row, and carry two sentences in the same words: the
    citation and the scope (`CITATION`, `SCOPE` below; the literals live HERE, not imported from the module);
  * the held pair (FMP `transcripts`) still reads R and names the owner question;
  * Massive `derived_analytics` (T-11), held until ESC-03 was ANSWERED BY THE OWNER 2026-11-22, reads LA in the same
    member-display scope, cites the answer (not the 2026-09-19 note), and the register records the answer quoted and
    dated with the AI-processing rows (T-14, N-16) NOT moved;
  * per endpoint, read from `fmp_client.py`'s own source: the restated `analyst_grades` covers grades, consensus and
    history only, and the two TheFly-origin grade NEWS feeds stamp the unregistered `analyst_actions_news` (U, T-45);
  * the census: exactly which modules import the table and which read a stamped class; outside the two declared
    gates every read sits in an ECHO position (a dict value, a keyword, an assignment, a message), never a test;
  * the two gates: the UCT Agent's asset-quote kinds (values that can reach a model) read no member-display row, and
    the fundamentals snapshot archive's retention does not follow the class at all;
  * nothing under app/src reads a class off a response.

⚠️ The echo-position rule sees the DIRECT form only (`if r.licensing_class == ...`). A class copied into a local
first and tested later escapes it; the module censuses are what catch that: a new reader must be classified here by a
person before CI goes green.
"""
from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path

import pytest

from api.services import fmp_client as fc
from api.services import provider_licensing_class as plc
from api.services.fundamentals_pit import snapshot_archive as SA
from api.services.fundamentals_pit import store as S

REPO = Path(__file__).resolve().parents[1]

CITATION = "register 2026-09-19 note: Bus/DDLA column in force"
SCOPE = "member display; AI use, external publication and attribution are their own rows"

RESTATED = {
    ("massive", "quotes"): "T-01",
    ("massive", "bars"): "T-03/T-04",
    ("massive", "movers"): "T-05",
    ("massive", "news"): "T-06",
    ("massive", "reference"): "T-07",
    ("fmp", "fundamentals"): "T-33",
    ("fmp", "estimates"): "T-34",
    ("fmp", "earnings"): "T-35/T-36",
    ("fmp", "economic"): "T-37",
    ("fmp", "news"): "T-38",
    ("fmp", "insider"): "T-39",
    ("fmp", "ownership"): "T-39",
    ("fmp", "indices"): "T-40",
    ("fmp", "analyst_grades"): "T-34",
}
HELD = {("fmp", "transcripts"): ("T-43", "ESC-11")}
#: answered by the owner after the restatement: pair -> (register row, the question, the citation its note carries)
ANSWERED = {("massive", "derived_analytics"): ("T-11", "ESC-03", "register 2026-11-22: ESC-03 answered by the owner")}
OWNER_WORDS_ESC03 = '"the license we are good on and fully approved and verified. DO it all"'
REGISTER = REPO / "docs" / "terminal-research" / "09-security-licensing-cost" / "licensing-register.md"


# ── the restated rows ─────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("pair", sorted(RESTATED))
def test_a_restated_row_reads_LA_cites_its_row_and_scopes_itself_to_member_display(pair):
    e = plc.entry_for(*pair)
    assert e.licensing_class == "LA", pair
    assert e.register_row == RESTATED[pair], pair
    assert CITATION in e.note, pair
    assert SCOPE in e.note, pair
    assert RESTATED[pair] in e.note, (pair, "the note names its own row")


def test_the_restated_set_is_exactly_the_rows_that_cite_the_note():
    """A row cannot claim the citation without being in the restated set, and the reverse."""
    citing = {pair for pair, e in plc.all_entries().items() if CITATION in e.note}
    assert citing == set(RESTATED)


def test_no_A3_row_survives():
    """The register retired A3 (assume no FMP DDLA) on 2026-09-19; a row still citing it would be the stale cell."""
    assert [pair for pair, e in plc.all_entries().items() if "A3" in e.register_row.split("/")] == []


@pytest.mark.parametrize("pair", sorted(HELD))
def test_a_held_row_stays_R_and_names_the_open_owner_question(pair):
    row, question = HELD[pair]
    e = plc.entry_for(*pair)
    assert (e.licensing_class, e.register_row) == ("R", row)
    assert "HELD" in e.note and question in e.note
    assert CITATION not in e.note


@pytest.mark.parametrize("pair", sorted(ANSWERED))
def test_an_answered_row_reads_LA_in_the_member_display_scope_and_cites_the_answer(pair):
    row, question, citation = ANSWERED[pair]
    e = plc.entry_for(*pair)
    assert (e.licensing_class, e.register_row) == ("LA", row)
    assert SCOPE in e.note, "the same member-display scope sentence as every restated row"
    assert citation in e.note and question in e.note
    assert CITATION not in e.note, "it moved on the owner's answer, not on the 2026-09-19 note"
    assert "HELD" not in e.note


def _register_row(row_id: str) -> str:
    rows = [ln for ln in REGISTER.read_text(encoding="utf-8").splitlines() if ln.startswith(f"| {row_id} |")]
    assert len(rows) == 1, (row_id, len(rows))
    return rows[0]


def test_the_register_records_esc03_as_the_owners_answer_quoted_and_dated():
    """The ESC-03 row carries the owner's words verbatim and the date, and says what was (not) seen."""
    esc = _register_row("ESC-03")
    assert "ANSWERED BY THE OWNER 2026-11-22" in esc
    assert OWNER_WORDS_ESC03.strip('"') in esc
    assert "no contract text" in esc
    # the rows it moves, and the AI rows it releases without moving
    assert "T-11, N-22, N-25 (**now LA**" in esc
    assert "T-14, N-16 (**released from ESC-03, classes NOT moved by this answer**" in esc


@pytest.mark.parametrize("row_id", ["T-14", "N-16"])
def test_the_ai_processing_rows_esc03_held_are_not_moved_by_its_answer(row_id):
    """AI use is its own gate (coordinator scope 2026-11-22): the answer releases T-14 / N-16 from ESC-03 and moves
    neither, and no row of the licensing table names either as its own (nothing in code reads an AI-processing row)."""
    assert "its class is NOT moved by that answer" in _register_row(row_id)
    assert [pair for pair, e in plc.all_entries().items() if row_id in e.register_row.split("/")] == []


# ── the analyst_grades split, per endpoint ───────────────────────────────────────────────────────────────────────

def _fmp_endpoint_classes() -> dict[str, str]:
    """`{path: data_class}` for every `_fetch("<literal path>", ..., data_class="<literal>")` in fmp_client.py."""
    tree = ast.parse((REPO / "api" / "services" / "fmp_client.py").read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_fetch"):
            continue
        if not (node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            continue
        kw = {k.arg: k.value for k in node.keywords}
        if isinstance(kw.get("data_class"), ast.Constant):
            out.setdefault(node.args[0].value, kw["data_class"].value)
    return out


GRADES = {"/stable/grades", "/stable/grades-consensus", "/stable/grades-historical"}
GRADE_NEWS = {"/stable/grades-news", "/stable/grades-latest-news"}


def test_analyst_grades_reaches_grades_consensus_and_history_only():
    classes = _fmp_endpoint_classes()
    assert {p for p, dc in classes.items() if dc == "analyst_grades"} == GRADES
    assert {p for p, dc in classes.items() if dc == "analyst_actions_news"} == GRADE_NEWS


def test_analyst_actions_news_is_unregistered_and_reads_U():
    assert ("fmp", "analyst_actions_news") not in plc.all_entries()
    assert plc.entry_for("fmp", "analyst_actions_news").register_row == "n/a"
    assert plc.licensing_class_for("fmp", "analyst_actions_news") == "U"


@pytest.mark.parametrize("call,cls", [
    (lambda: fc.get_analyst_grades("AAPL"), "LA"),
    (lambda: fc.get_grades_consensus("AAPL"), "LA"),
    (lambda: fc.get_grades_historical("AAPL"), "LA"),
    (lambda: fc.get_grades_news("AAPL"), "U"),
    (lambda: fc.get_grades_latest_news(), "U"),
], ids=["grades", "grades-consensus", "grades-historical", "grades-news", "grades-latest-news"])
def test_each_grades_endpoint_stamps_its_own_class(monkeypatch, call, cls):
    """The stamp a reader of each endpoint gets (analyst_grades.py:162/193 echo the consensus and grades legs)."""
    from unittest.mock import MagicMock

    resp = MagicMock(status_code=200)
    resp.json.return_value = [{"symbol": "AAPL"}]
    resp.raise_for_status.return_value = None
    monkeypatch.setenv("FMP_API_KEY", "test-key")
    monkeypatch.setattr(fc._session, "get", MagicMock(return_value=resp))
    monkeypatch.setattr(fc, "_take_token", lambda: True)
    from api.services import fmp_response_cache
    monkeypatch.setattr(fmp_response_cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(fmp_response_cache, "put", lambda *a, **k: None)
    assert call().licensing_class == cls


# ── the census ────────────────────────────────────────────────────────────────────────────────────────────────────

TABLE = "api/services/provider_licensing_class.py"
GATES = {
    "api/services/pine_data_catalog.py": "member display: a member's own Pine script on the member's own chart",
    "api/services/uct_agent/marketdata/asset_quotes.py": "UCT Agent asset-quote kinds: values can reach a model",
}
IMPORTERS = {
    "api/services/fmp_client.py": "stamp",
    "api/services/massive.py": "stamp",
    "api/services/massive_adapter.py": "stamp",
    "api/services/edgar_ownership.py": "stamp",
    "api/services/short_interest.py": "stamp",
    "api/services/fundamentals_pit/snapshot_archive.py": "retention report: decides by RETENTION_ALLOWED",
    **{path: "gate" for path in GATES},
}
CLASS_READERS = {   # read `.licensing_class` off a ProviderResult / an entry
    "api/routers/calendar.py": "echo: JSON meta",
    "api/services/analyst_grades.py": "echo: JSON meta",
    "api/services/econ_calendar_fmp.py": "echo: JSON meta",
    "api/services/research/news.py": "echo: JSON meta",
    "api/services/research/ownership.py": "echo: JSON meta",
    "api/services/edgar_ownership.py": "echo: JSON payload",
    "api/services/short_interest.py": "echo: JSON payload",
    "api/services/provider_errors.py": "echo: ProviderResult.to_dict (/api/provenance/quote)",
    "api/services/fundamentals_pit/snapshot_archive.py": "echo: the BLOCKED reason string",
    "api/services/pine_data_catalog.py": "gate (via licence_of)",
}
ECHO_PARENTS = (ast.Dict, ast.keyword, ast.Assign, ast.FormattedValue)
JSON_KEYS = {"licensingClass", "licensing_class"}
_SCAN_DIRS = ("api", "tools", "scripts", "services")


def _is_test(p: Path) -> bool:
    n = p.name
    return (n.startswith("test_") or n.endswith("_test.py") or n == "conftest.py"
            or "tests" in p.parts or "__tests__" in p.parts)


def _python_sources():
    for d in _SCAN_DIRS:
        for p in sorted((REPO / d).rglob("*.py")):
            if _is_test(p):
                continue
            rel = p.relative_to(REPO).as_posix()
            src = p.read_text(encoding="utf-8", errors="replace")
            if "licensing_class" in src or "licensingClass" in src:
                yield rel, src


def _census():
    importers, readers, positions, key_reads = set(), set(), [], []
    for rel, src in _python_sources():
        tree = ast.parse(src)
        parent = {ch: node for node in ast.walk(tree) for ch in ast.iter_child_nodes(node)}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and (
                    node.module == "api.services.provider_licensing_class"
                    or (node.module == "api.services" and any(a.name == "provider_licensing_class" for a in node.names))):
                importers.add(rel)
            elif isinstance(node, ast.Import) and any(a.name == "api.services.provider_licensing_class" for a in node.names):
                importers.add(rel)
            if rel == TABLE:
                continue
            read = None
            if isinstance(node, ast.Attribute) and node.attr == "licensing_class" and isinstance(node.ctx, ast.Load):
                readers.add(rel)
                read = node
            elif isinstance(node, ast.Call):
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
                if name in ("licensing_class_for", "entry_for"):
                    read = node
                elif (name == "get" and node.args and isinstance(node.args[0], ast.Constant)
                      and node.args[0].value in JSON_KEYS):
                    key_reads.append((rel, node.lineno))
            elif (isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Load)
                  and isinstance(node.slice, ast.Constant) and node.slice.value in JSON_KEYS):
                key_reads.append((rel, node.lineno))
            if read is not None:
                positions.append((rel, read.lineno, type(parent.get(read)).__name__))
    return importers, readers, positions, key_reads


def test_every_module_that_imports_the_table_is_classified():
    importers, _, _, _ = _census()
    assert importers == set(IMPORTERS), (
        "a module started (or stopped) importing provider_licensing_class: classify it in IMPORTERS as a stamp, an "
        "echo or a gate, and if it is a gate say which audience it decides for")


def test_every_module_that_reads_a_stamped_class_is_classified():
    _, readers, _, _ = _census()
    assert readers == set(CLASS_READERS)


def test_outside_the_two_gates_a_class_is_only_ever_echoed_never_tested():
    """No reader of the table uses the class as an AI-use or external-publication gate (nor as any other gate): every
    read outside GATES sits in a dict value, a keyword, an assignment or a message."""
    _, _, positions, _ = _census()
    tested = [(rel, line, kind) for rel, line, kind in positions
              if rel not in GATES and kind not in {t.__name__ for t in ECHO_PARENTS}]
    assert tested == []
    assert positions, "the scan found no reads at all: it is looking in the wrong place"


def test_no_python_module_reads_the_class_back_off_a_json_payload():
    _, _, _, key_reads = _census()
    assert key_reads == []


def test_the_agent_gate_reads_no_member_display_row():
    """`asset_quotes.licensed_source` serves a value when a source's class is A or LA, and the kinds it backs are not
    model-isolated, so what it serves can reach a model. A restated row is member display only (its own note says
    so), so no agent source may name one. Sources are discovered, not listed: every marketdata module that hands a
    SOURCES list to `asset_quotes`."""
    root = REPO / "api" / "services" / "uct_agent" / "marketdata"
    pairs = []
    for p in sorted(root.glob("*.py")):
        src = p.read_text(encoding="utf-8")
        if p.name == "asset_quotes.py" or "asset_quotes." not in src or "SOURCES" not in src:
            continue
        mod = importlib.import_module(f"api.services.uct_agent.marketdata.{p.stem}")
        pairs += [(vendor, dc) for vendor, dc, _fetch in mod.SOURCES]
    assert pairs, "found no agent sources: the discovery is broken"
    display_only = {pair for pair, e in plc.all_entries().items() if SCOPE in e.note}
    assert display_only >= set(RESTATED)
    assert [pair for pair in pairs if pair in display_only] == []


def test_snapshot_retention_does_not_follow_the_class(tmp_path, monkeypatch):
    """The archive's decision is RETENTION_ALLOWED (empty), never the class: with every candidate pair forced to A it
    still keeps nothing. Storage is T-42 / T-09, its own row with its own obligations."""
    for m in SA.CANDIDATES:
        monkeypatch.setitem(plc._TABLE, (m.vendor, m.data_class), plc.LicensingClassEntry("A", "test", "T-TEST"))
    c = S.connect(str(tmp_path / "pit.db"))
    r = SA.capture(c, "2026-11-19", {"AAPL": {"pe_fwd": 30.1, "peg": 2.2, "eps_next_y_growth": 0.1}})
    assert r["written"] == 0 and set(r["blocked"]) == {m.id for m in SA.CANDIDATES}


_JS_READ = re.compile(r"(?<![A-Za-z0-9_])(licensingClass|licensing_class)(?![A-Za-z0-9_])")


def test_nothing_under_app_src_reads_the_class_off_a_response():
    hits = []
    for p in sorted((REPO / "app" / "src").rglob("*")):
        if p.suffix not in {".js", ".jsx", ".ts", ".tsx"} or not p.is_file():
            continue
        if ".test." in p.name or "__tests__" in p.parts or "__fixtures__" in p.parts:
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        if "licensing" not in text:
            continue
        hits += [f"{p.relative_to(REPO).as_posix()}:{i}" for i, line in enumerate(text.splitlines(), 1)
                 if _JS_READ.search(line)]
    assert hits == []
