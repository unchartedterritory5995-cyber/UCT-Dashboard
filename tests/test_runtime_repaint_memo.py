"""The repaint memo (2026-11-13, "memoise the repaint lex per source hash").

`runtime_repaint.runtime_repaint_of` lexes a runtime script once per distinct source per process
and keeps the answer in one bounded LRU keyed by ``(sha256, CLASSIFIER_VERSION, RULES fingerprint)``.
Before it, a list of 50 near-cap runtime rows lexed every row three times (150 lexes, 7-16.8 s):
the hard precondition before `PINE_RUNTIME_SAVE_ENABLED` may be armed.

Rails (each mutation-proved, `docs/pine/evidence/2026-11-13-capability-admission/EVIDENCE.md`):
  M1 one lex per distinct source across every server consumer of the classifier, none warm
  M2 a version change (the classifier's or the table's) recomputes
  M3 the LRU is bounded, and evicts the least recently USED
  M4 a caller cannot mutate the cache
  M5 the memoised answer is the classifier's, byte for byte, over every corpus script, cold and warm
  M6 one authority: nothing else in `api/` lexes a runtime script or bypasses the memo
"""
from __future__ import annotations

import ast
import copy
import json
import pathlib
import re
import time

import pytest

from api.services import runtime_definitions as rt
from api.services import runtime_repaint as rr
from api.services import user_definitions as ud

REPO = pathlib.Path(__file__).resolve().parents[1]
DOCS = {d["slug"]: d for d in json.loads(
    (REPO / "tests" / "fixtures" / "runtime_documents" / "documents.json").read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
CORPUS = json.loads((REPO / "tests" / "fixtures" / "runtime_repaint" / "corpus.json").read_text(encoding="utf-8"))["rows"]
REQUEST_LINE = '\nother = request.security("AAPL", "D", close)\n'


@pytest.fixture(autouse=True)
def _cold(monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_ADMISSION_ENV,
              rt.SERVER_STAGE_ENV, rt.SERVICE_URL_ENV, rt.SERVICE_SECRET_ENV):
        monkeypatch.delenv(k, raising=False)
    rr._reset_repaint_memo()
    yield
    rr._reset_repaint_memo()


@pytest.fixture
def lexes(monkeypatch) -> list:
    calls: list = []
    real = rr.lex

    def counted(src):
        calls.append(1)
        return real(src)
    monkeypatch.setattr(rr, "lex", counted)
    return calls


def _near_cap(tag: str, kb: int = 100) -> str:
    base = ADX["compute"]["source"] + f"\n// {tag}\n"
    lines, i = [], 0
    while len(base) + sum(map(len, lines)) < kb * 1024:
        lines.append(f"x{i} = ta.sma(close, {2 + i % 50}) + (close > open ? 1 : 0)\n")
        i += 1
    return base + "".join(lines)


def _row(source: str, k: int = 0) -> dict:
    d = copy.deepcopy(ADX)
    d["compute"]["source"] = source
    return {"def_id": f"memo-{k}", "definition": d}


def _serve(rows) -> None:
    """Every server question a served / saved runtime row asks of the classifier."""
    for r in rows:
        rt.stamp_served(r)
        ud.server_lanes_stamp(r)           # the three lanes: `request_reads` three times
        rt.repaint_stamp(r["definition"])
        rt.request_reads(r["definition"])


# ── M1 ─────────────────────────────────────────────────────────────────────────

def test_M1_fifty_near_cap_rows_lex_once_each_cold_and_never_warm(lexes):
    rows = [_row(_near_cap(f"row {k}"), k) for k in range(50)]
    t0 = time.perf_counter()
    _serve(rows)
    cold = time.perf_counter() - t0
    assert len(lexes) == 50, len(lexes)                 # one per distinct source (was 150+)
    lexes.clear()
    t0 = time.perf_counter()
    _serve(rows)
    warm = time.perf_counter() - t0
    assert lexes == []                                   # warm: no lex at all
    # generous wall-clock bounds (the call counts above are the exact rail): the warm pass is
    # hashing and small copies only, measured ~0.03 s here
    assert warm < 1.0, warm
    assert cold < 30.0, cold


def test_M1_the_same_source_in_many_rows_is_lexed_once(lexes):
    src = ADX["compute"]["source"] + REQUEST_LINE
    _serve([_row(src, k) for k in range(10)])
    assert len(lexes) == 1
    assert rt.request_reads(_row(src)["definition"]) == ["request.security"]


# ── M2 ─────────────────────────────────────────────────────────────────────────

def test_M2_a_classifier_version_bump_recomputes(lexes, monkeypatch):
    src = ADX["compute"]["source"]
    rr.runtime_repaint_of(src)
    rr.runtime_repaint_of(src)
    assert len(lexes) == 1
    monkeypatch.setattr(rr, "CLASSIFIER_VERSION", rr.CLASSIFIER_VERSION + 1)
    rr.runtime_repaint_of(src)
    assert len(lexes) == 2


def test_M2_a_different_rule_table_recomputes_and_answers_by_the_new_table(lexes, monkeypatch):
    src = ADX["compute"]["source"] + REQUEST_LINE
    before = rr.runtime_repaint_of(src)
    assert "request.security" in [r["name"] for r in before["reads"]]
    moved = copy.deepcopy(rr.RULES)
    moved["requests"]["calls"] = [c for c in moved["requests"]["calls"] if c != "request.security"]
    moved["requests"]["prefix"] = "request.never."
    monkeypatch.setattr(rr, "RULES", moved)
    after = rr.runtime_repaint_of(src)
    assert len(lexes) == 2                               # recomputed, not served stale
    assert "request.security" not in [r["name"] for r in after["reads"]]


# ── M3 ─────────────────────────────────────────────────────────────────────────

def test_M3_the_memo_is_bounded_and_evicts_the_least_recently_used(lexes, monkeypatch):
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX", 3)
    srcs = [ADX["compute"]["source"] + f"\n// v{k}\n" for k in range(5)]
    for s in srcs[:3]:
        rr.runtime_repaint_of(s)
    rr.runtime_repaint_of(srcs[0])                       # touch the oldest: now the newest
    rr.runtime_repaint_of(srcs[3])                       # evicts srcs[1], the least recently used
    assert len(rr._MEMO) == 3
    assert len(lexes) == 4
    rr.runtime_repaint_of(srcs[0])
    assert len(lexes) == 4                               # still held
    rr.runtime_repaint_of(srcs[1])
    assert len(lexes) == 5                               # was evicted: recomputed
    for s in srcs:
        rr.runtime_repaint_of(s)
    assert len(rr._MEMO) <= 3


def test_M3_the_memo_holds_no_source_text():
    src = _near_cap("held?", 20)
    rr.runtime_repaint_of(src)
    assert all(len(json.dumps(v)) < 4096 for v in rr._MEMO.values())
    assert all(src not in k for k in rr._MEMO)


# ── M4 ─────────────────────────────────────────────────────────────────────────

def test_M4_a_caller_cannot_mutate_the_cache():
    src = ADX["compute"]["source"] + REQUEST_LINE
    first = rr.runtime_repaint_of(src)
    want = json.dumps(first, sort_keys=True)
    first["mode"] = "tampered"
    first["reads"].append({"name": "x", "forward": 9, "why": "x"})
    first["reads"][0]["name"] = "tampered"
    second = rr.runtime_repaint_of(src)
    assert json.dumps(second, sort_keys=True) == want
    assert second is not first and second["reads"] is not first["reads"]


# ── M5 ─────────────────────────────────────────────────────────────────────────

def test_M5_the_memoised_answer_is_the_classifiers_for_every_corpus_script():
    assert len(CORPUS) > 200
    texts = [(REPO / row["file"]).read_bytes().decode("utf-8") for row in CORPUS]
    want = [json.dumps(rr._classify(t), sort_keys=True) for t in texts]
    cold = [json.dumps(rr.runtime_repaint_of(t), sort_keys=True) for t in texts]
    warm = [json.dumps(rr.runtime_repaint_of(t), sort_keys=True) for t in texts]
    assert cold == want
    assert warm == want
    assert len(set(want)) > 20                           # non-vacuous: the answers differ by script


def test_M5_an_unreadable_source_is_answered_the_same_cold_and_warm(lexes):
    bad = 'indicator("t")\nx = "never closed\n'
    a = rr.runtime_repaint_of(bad)
    b = rr.runtime_repaint_of(bad)
    assert a == b == rr._classify(bad) and a["ok"] is False
    assert len(lexes) == 2                               # one memo miss + the direct _classify
    assert rr.runtime_repaint_of(None) == rr._classify("")


# ── M6 ─────────────────────────────────────────────────────────────────────────

_PRIVATE = {"lex", "_classify"}


def _bypasses(tree: ast.AST) -> list:
    """Every use of `runtime_repaint.lex` / `_classify` outside the module: an import of either name
    (`from ...runtime_repaint import lex as L`), or an attribute of any name bound to the module
    (`import api.services.runtime_repaint as R`, `from api.services import runtime_repaint as R`)."""
    aliases, found = set(), []
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            mod = n.module or ""
            if mod.endswith("runtime_repaint"):
                found += [a.name for a in n.names if a.name in _PRIVATE or a.name == "*"]
            for a in n.names:
                if a.name == "runtime_repaint":
                    aliases.add(a.asname or a.name)
        elif isinstance(n, ast.Import):
            for a in n.names:
                if a.name.endswith("runtime_repaint"):
                    aliases.add(a.asname or a.name.split(".")[0])
    for n in ast.walk(tree):
        if isinstance(n, ast.Attribute) and n.attr in _PRIVATE:
            base = n.value
            while isinstance(base, ast.Attribute) and base.attr != "runtime_repaint":
                base = base.value
            if (isinstance(base, ast.Attribute) and base.attr == "runtime_repaint") or \
                    (isinstance(base, ast.Name) and base.id in aliases):
                found.append(n.attr)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "getattr" and \
                len(n.args) >= 2 and isinstance(n.args[1], ast.Constant) and n.args[1].value in _PRIVATE:
            found.append("getattr:" + n.args[1].value)
    return found


def test_M6_nothing_else_lexes_a_runtime_script_or_bypasses_the_memo():
    offenders = []
    for root in ("api", "tools", "scripts"):
        for path in (REPO / root).rglob("*.py"):
            text = path.read_text(encoding="utf-8", errors="replace")
            if path.name == "runtime_repaint.py":
                # inside the module only `runtime_repaint_of` calls `_classify`, and only `_classify` lexes
                assert len(re.findall(r"\b_classify\(", text)) == 2, "def + the one call in runtime_repaint_of"
                assert len(re.findall(r"(?<![\w.])lex\(", text)) == 2, "def + the one call in _classify"
                continue
            try:
                tree = ast.parse(text)
            except SyntaxError:
                continue
            hit = _bypasses(tree)
            if hit:
                offenders.append((str(path.relative_to(REPO)), hit))
    assert offenders == []


NL = chr(10)


@pytest.mark.parametrize("src", [
    "from api.services.runtime_repaint import lex" + NL,
    "from api.services.runtime_repaint import _classify as c" + NL,
    "import api.services.runtime_repaint as R" + NL + "R.lex('x')" + NL,
    "from api.services import runtime_repaint as rp" + NL + "rp._classify('x')" + NL,
    "import api.services.runtime_repaint" + NL + "api.services.runtime_repaint.lex('x')" + NL,
    "from api.services import runtime_repaint" + NL + "getattr(runtime_repaint, 'lex')('x')" + NL,
])
def test_M6_the_scan_sees_every_spelling_of_a_bypass(src):
    assert _bypasses(ast.parse(src))


def test_M6_the_scan_passes_the_memoised_door():
    src = "from api.services import runtime_repaint" + NL + "runtime_repaint.runtime_repaint_of('x')" + NL
    assert _bypasses(ast.parse(src)) == []


# -- M3 (review of #1226): hostile sources never enter the memo ----------------------------------

def test_M3_a_script_with_many_identifiers_is_answered_but_never_memoised(lexes):
    src = '//@version=6' + NL + 'indicator("t")' + NL + "".join(f"x{i} = request.q{i}" + NL for i in range(3000))
    a = rr.runtime_repaint_of(src)
    assert len(a["reads"]) == 3000                      # the answer is whole (the JS module's)
    assert len(rr._MEMO) == 0 and rr._MEMO_BYTES[0] == 0
    assert rr.runtime_repaint_of(src) == a and len(lexes) == 2   # recomputed, never held


def test_M3_a_giant_identifier_is_answered_but_never_memoised(lexes):
    src = '//@version=6' + NL + 'indicator("t")' + NL + "x = request." + "a" * 130000 + NL
    a = rr.runtime_repaint_of(src)
    assert len(a["reads"]) == 1 and len(a["reads"][0]["name"]) > 130000
    assert len(rr._MEMO) == 0 and rr._MEMO_BYTES[0] == 0


def test_M3_the_answer_caps_hold_at_their_edges(monkeypatch):
    src = ADX["compute"]["source"] + REQUEST_LINE
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX_READS", 0)
    rr.runtime_repaint_of(src)
    assert len(rr._MEMO) == 0
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX_READS", 64)
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX_ANSWER_BYTES", 10)
    rr.runtime_repaint_of(src)
    assert len(rr._MEMO) == 0
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX_ANSWER_BYTES", 4096)
    rr.runtime_repaint_of(src)
    assert len(rr._MEMO) == 1                           # CONTROL: a real answer is memoised


def test_M3_the_memo_is_bounded_in_bytes(monkeypatch):
    srcs = [ADX["compute"]["source"] + REQUEST_LINE + f"{NL}// v{k}{NL}" for k in range(6)]
    one = rr._memoisable(rr._classify(srcs[0]))
    assert one > 0
    monkeypatch.setattr(rr, "REPAINT_MEMO_MAX_BYTES", one * 2 + 1)
    for s_ in srcs:
        rr.runtime_repaint_of(s_)
    assert len(rr._MEMO) == 2 and rr._MEMO_BYTES[0] <= one * 2 + 1
    assert rr._MEMO_BYTES[0] == sum(size for _a, size in rr._MEMO.values())


def test_the_rules_fingerprint_is_whole_at_import():
    held = rr._RULES_FP
    assert isinstance(held, tuple) and held[0] is rr.RULES and re.fullmatch(r"[0-9a-f]{64}", held[1])
    assert rr._rules_fingerprint() == held[1]
