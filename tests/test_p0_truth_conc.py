"""P0 truth corpus -- slice "conc": the concierge / image door on `sym`, `tf`, `textop`.

Every case states ASKED / CLAIMED / DID and classifies the expected outcome as
one of VALUE, UNKNOWN, REFUSAL, EXACT, DISCLOSED DIFFERENCE, PARTIAL,
UNSUPPORTED, CONTROLLED ERROR.

BEFORE (base a92b96de2, reproduced 2026-10-05 with a stub client, no paid call):
  * propose + a model tree holding `sym` / `tf` / `textop`
      -> `_assert_within_schema` did `names[kind]` for a type it has no names for
      -> KeyError 'sym' / 'tf' / 'textop' escaped `propose`
      -> HTTP 500 at POST /api/user-definitions/propose, AFTER the model call was
         billed, with no repair turn. ConciergeBox showed "could not be reached".
  * formula_for(tree) on the same trees -> KeyError (same gate, then `render`).
  * image door: the same KeyError swallowed by a bare `except Exception` and
    filed as `vision:no-candidate` ("nothing in that picture could be turned
    into a formula") -- a bug reported as a verdict on the member's picture.

AFTER: schema-valid trees of those shapes refuse BY NAME at `unsupported:node`
(terminal, one model call), schema-invalid ones at `schema:*`, any unexpected
exception after the model call is a logged `internal:error` / `vision:internal`,
and `formula_for` spells all three shapes the way `parse.js` reads them back.

No live model calls: the stubbed boundary is the CLIENT
(`engine._get_anthropic_client`), the same seam `test_definition_concierge.py`
uses, so the real request, tool extraction and spend accounting all run.
"""
from __future__ import annotations

import importlib
import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import ast_table
from api.services import indicator_from_image as vision
from api.services.catalyst import cost_guard

ROOT = Path(__file__).resolve().parents[1]
PARSE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "parse.js"
PARITY_BARS = ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json"
ENDPOINT = "/api/user-definitions/propose"

RS_PROMPT = ("Put a blue dot below the candle whenever relative strength versus "
             "SPY makes a new 3-month high")

# ═══ trees ════════════════════════════════════════════════════════════════

CLOSE = {"type": "series", "name": "close"}
_RS = {"type": "op", "name": "/", "args": [
    CLOSE, {"type": "sym", "value": "SPY", "args": [CLOSE]}]}
#: The faithful RS-vs-SPY tree (63 bars ~ 3 months of daily bars).
RS_NEW_HIGH = {"type": "op", "name": ">=", "args": [
    _RS, {"type": "call", "name": "highest", "args": [_RS, {"type": "num", "value": 63}]}]}
TF_TREE = {"type": "op", "name": ">", "args": [
    CLOSE, {"type": "tf", "value": "W", "args": [CLOSE]}]}
TEXTOP_TREE = {"type": "op", "name": "*", "args": [CLOSE, {
    "type": "textop", "name": "contains",
    "args": [{"type": "symtext", "name": "ticker"}, {"type": "str", "value": "/"}]}]}
PLAIN = {"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 20}]}


def _bars() -> List[dict]:
    return [dict(b) for b in json.loads(PARITY_BARS.read_text(encoding="utf-8"))["bars"]][:200]


# ═══ the stub model ═══════════════════════════════════════════════════════

class _B:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeClient:
    """Scripted answers; an unarmed call FAILS rather than looping."""

    def __init__(self, answers: List[Any]) -> None:
        self.answers = list(answers)
        self.calls: List[dict] = []
        self.messages = self

    def with_options(self, **_):
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.answers:
            raise AssertionError(f"model called {len(self.calls)} times; armed fewer")
        return self.answers.pop(0)


def tool_use(tree):
    from api.services import definition_concierge as mod
    return _B(content=[_B(type="tool_use", id="tu_1", name=mod.TOOL_NAME,
                          input={"ast": tree, "unresolved": []})],
              stop_reason="tool_use", usage=_B(input_tokens=120, output_tokens=40))


@pytest.fixture
def concierge(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()
    from api.services import definition_concierge as mod
    mod.reset_spend()
    yield mod
    mod.reset_spend()
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


@pytest.fixture
def model(monkeypatch):
    def arm(answers):
        client = FakeClient(answers)
        monkeypatch.setattr("api.services.engine._get_anthropic_client",
                            lambda: client, raising=True)
        return client
    return arm


@pytest.fixture
def http(concierge):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": "u1", "role": "user", "plan": "premium"}
    # ⛔ raise_server_exceptions=False: the BEFORE state was a 500, and a test
    # client that re-raised would report a Python exception instead of the
    # status a member's browser received.
    return TestClient(app, raise_server_exceptions=False)


# ═══ 1. the representative request, end to end through the route ══════════

def test_RS_vs_SPY_new_3mo_high__ASKED_rs_new_high__CLAIMED_nothing__DID_unsupported_refusal(
        http, concierge, model):
    """ASKED: "blue dot when RS vs SPY makes a new 3-month high".
    CLAIMED (before): nothing -- HTTP 500 after the billed call.
    DID (after): 200, ok:false, gate `unsupported:node`, reason names SPY and
    why; NO ast/source/sentence; exactly ONE model call (terminal, no repair
    turn that could invite a different question). OUTCOME: UNSUPPORTED."""
    client = model([tool_use(RS_NEW_HIGH), tool_use(RS_NEW_HIGH)])
    res = http.post(ENDPOINT, json={"prompt": RS_PROMPT, "bars": _bars()})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["gate"] == "unsupported:node"
    assert "another instrument (SPY)" in body["reason"]
    for leaked in ("ast", "source", "sentence"):
        assert leaked not in body, f"a refusal carried `{leaked}`"
    assert len(client.calls) == 1, "an unsupported shape must not buy a repair turn"


@pytest.mark.parametrize("label,tree,needle", [
    ("tf", TF_TREE, "higher timeframe (W)"),
    ("textop", TEXTOP_TREE, "symbol's text"),
])
def test_tf_and_textop_trees__CLAIMED_500__DID_unsupported_refusal(
        http, concierge, model, label, tree, needle):
    """ASKED: a weekly read / a ticker-text question. CLAIMED (before): 500.
    DID (after): 200 + `unsupported:node` naming the shape. OUTCOME: UNSUPPORTED."""
    client = model([tool_use(tree), tool_use(tree)])
    res = http.post(ENDPOINT, json={"prompt": "close above last week's close",
                                    "bars": _bars()})
    assert res.status_code == 200, f"{label}: {res.status_code} {res.text[:200]}"
    body = res.json()
    assert body["ok"] is False and body["gate"] == "unsupported:node"
    assert needle in body["reason"]
    assert "ast" not in body
    assert len(client.calls) == 1


# ═══ 2. the schema boundary: shapes the schema DOESN'T allow are schema:* ══

@pytest.mark.parametrize("label,tree,gate", [
    ("sym ticker outside the benchmark roster",
     {"type": "sym", "value": "AAPL", "args": [CLOSE]}, "schema:name"),
    ("sym with two children",
     {"type": "sym", "value": "SPY", "args": [CLOSE, CLOSE]}, "schema:node"),
    ("tf code the engine cannot resample",
     {"type": "tf", "value": "D", "args": [CLOSE]}, "schema:name"),
    ("textop predicate not declared",
     {"type": "textop", "name": "regex", "args": [{"type": "str", "value": "x"}]}, "schema:name"),
    ("textop with an expression operand",
     {"type": "textop", "name": "length", "args": [CLOSE]}, "schema:node"),
    ("textop with the wrong operand count",
     {"type": "textop", "name": "contains", "args": [{"type": "str", "value": "x"}]}, "schema:node"),
    ("tf_live is translated-only",
     {"type": "tf_live", "value": "W", "args": [CLOSE]}, "schema:node"),
    ("ltf is translated-only",
     {"type": "ltf", "value": "60", "args": [CLOSE]}, "schema:node"),
    ("a bare text operand outside a textop",
     {"type": "str", "value": "x"}, "schema:node"),
])
def test_out_of_schema_shapes__CLAIMED_KeyError__DID_named_schema_refusal(
        concierge, label, tree, gate):
    """ASKED: n/a (malformed model output). CLAIMED (before): KeyError for
    every one of these. DID (after): `_Refused` at the named schema gate, from
    both `_validate` and `formula_for`. OUTCOME: REFUSAL."""
    for door in (lambda t: concierge._validate(t, _bars(), concierge.INDICATOR_KIND),
                 concierge.formula_for):
        with pytest.raises(concierge._Refused) as exc:
            door(tree)
        assert exc.value.gate == gate, f"{label}: {exc.value.gate}"


# ═══ 3. formula_for spells all three shapes -- and parse.js reads them back ═

_JS_HOOK = r"""
import { readFile } from 'node:fs/promises'
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try { const r = await nextResolve(specifier + ext, context); if (r) return r } catch {}
    }
  }
  return nextResolve(specifier, context)
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${source}\n` }
  }
  return nextLoad(url, context)
}
"""

_JS_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./hook.mjs', import.meta.url)
let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk
const payload = JSON.parse(raw)
const parse = await import(pathToFileURL(payload.parse).href)
const rows = {}
for (const c of payload.cases) {
  const parsed = parse.parseFormula(c.source)
  rows[c.id] = parsed.ok
    ? { same: parse.astHash(parsed.ast) === parse.astHash(c.ast) }
    : { parseError: parsed.error }
}
process.stdout.write(JSON.stringify(rows))
"""


def _parse_back(cases: dict) -> dict:
    exe = shutil.which("node")
    assert exe, "node is not on PATH -- the round-trip lane cannot run (not a skip)"
    tmp = tempfile.mkdtemp(prefix="p0conc_js_")
    try:
        for name, src in (("hook.mjs", _JS_HOOK), ("driver.mjs", _JS_DRIVER)):
            with io.open(os.path.join(tmp, name), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(src)
        proc = subprocess.run([exe, os.path.join(tmp, "driver.mjs")], cwd=str(ROOT),
                              input=json.dumps({"parse": str(PARSE_JS), "cases": [
                                  {"id": k, "ast": t, "source": s}
                                  for k, (t, s) in cases.items()]}),
                              capture_output=True, text=True, encoding="utf-8")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    assert proc.returncode == 0, proc.stderr[-1500:]
    return json.loads(proc.stdout)


def test_formula_for_spells_sym_tf_textop_EXACT_and_they_parse_back(concierge):
    """ASKED: the source text of a schema-valid tree. CLAIMED (before): KeyError.
    DID (after): the spelling `pine.js::printFormula` uses, and the ONE parser
    reads each back to the same `astHash`. OUTCOME: EXACT."""
    quoted = {"type": "textop", "name": "eq", "args": [
        {"type": "symtext", "name": "ticker"}, {"type": "str", "value": "it's \\ \"x\"\n"}]}
    cases = {
        "sym": (RS_NEW_HIGH, "((close / sym('SPY', close)) >= highest((close / sym('SPY', close)), 63))"),
        "tf": (TF_TREE, "(close > tf(close, 'W'))"),
        "textop": (TEXTOP_TREE, "(close * text_contains(syminfo('ticker'), '/'))"),
        "textop-escaped": (quoted, None),
        "tf-of-sym": ({"type": "tf", "value": "M", "args": [
            {"type": "sym", "value": "QQQ", "args": [PLAIN]}]},
            "tf(sym('QQQ', sma(close, 20)), 'M')"),
    }
    spelled = {}
    for cid, (tree, want) in cases.items():
        got = concierge.formula_for(tree)
        if want is not None:
            assert got == want, cid
        spelled[cid] = (tree, got)
    rows = _parse_back(spelled)
    bad = {k: v for k, v in rows.items() if not v.get("same")}
    assert bad == {}, f"sources that do not parse back to their tree: {bad}"


# ═══ 4. the general boundary: a genuine bug is LOGGED and CONTROLLED ═══════

def test_an_unexpected_exception_after_the_model_call__DID_logged_internal_error_not_500(
        http, concierge, model, monkeypatch, caplog):
    """ASKED: anything. CLAIMED (before): any non-`_Refused` exception after the
    billed call escaped as a 500. DID (after): 200, gate `internal:error`, no
    formula, and the traceback is logged at ERROR (not swallowed).
    OUTCOME: CONTROLLED ERROR."""
    def boom(*_a, **_k):
        raise RuntimeError("synthetic validator bug")
    monkeypatch.setattr(concierge, "_validate", boom)
    model([tool_use(PLAIN)])
    with caplog.at_level(logging.ERROR, logger=concierge.logger.name):
        res = http.post(ENDPOINT, json={"prompt": "average the close", "bars": _bars()})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False and body["gate"] == "internal:error"
    assert "ast" not in body and "source" not in body
    logged = [r for r in caplog.records if r.levelno >= logging.ERROR and r.exc_info
              and r.name == concierge.logger.name]
    assert logged and "synthetic validator bug" in str(logged[0].exc_info[1])


def test_the_read_back_stage_failing_unexpectedly_is_also_controlled(
        concierge, model, monkeypatch):
    """Same boundary, one stage later (sentence/source). OUTCOME: CONTROLLED ERROR."""
    def boom(*_a, **_k):
        raise KeyError("synthetic")
    monkeypatch.setattr(concierge, "formula_for", boom)
    model([tool_use(PLAIN)])
    out = concierge.propose("average the close", user_id="u1", bars=_bars())
    assert out["ok"] is False and out["gate"] == "internal:error"


def test_a_plain_valid_tree_still_succeeds(concierge, model):
    """Non-regression: the boundary changes nothing for a supported tree.
    OUTCOME: VALUE (an ok proposal with its read-back)."""
    model([tool_use(PLAIN)])
    out = concierge.propose("average the close over twenty bars", user_id="u1", bars=_bars())
    assert out["ok"] is True and out["ast"] == PLAIN
    assert out["source"] == "sma(close, 20)"


# ═══ 5. the image door ════════════════════════════════════════════════════

class _VisionStub:
    def __init__(self, payload):
        self.payload = payload
        self.messages = self

    def create(self, **_):
        return _B(content=[_B(type="tool_use", name=vision.TOOL_NAME, input=self.payload)],
                  usage=_B(input_tokens=1, output_tokens=1))


@pytest.fixture
def vision_ledger(monkeypatch):
    monkeypatch.setattr(cost_guard, "may_member_spend", lambda d: True)
    monkeypatch.setattr(cost_guard, "record", lambda *a, **k: 0.01)


def _candidates(*trees):
    return {"saw": "a ratio line", "candidates": [
        {"ast": t, "label": f"c{i}", "saw": "x", "confidence": 50} for i, t in enumerate(trees)]}


@pytest.mark.parametrize("tree", [RS_NEW_HIGH, TF_TREE, TEXTOP_TREE], ids=["sym", "tf", "textop"])
def test_vision_candidate_with_sym_tf_textop__CLAIMED_no_candidate__DID_named_refusal(
        vision_ledger, tree):
    """ASKED: a screenshot of an RS line / weekly read / ticker test.
    CLAIMED (before): `vision:no-candidate` -- "nothing in that picture could be
    turned into a formula", hiding a KeyError. DID (after): the candidate row
    carries `unsupported:node` and its reason, no formula. OUTCOME: UNSUPPORTED."""
    out = vision.candidates_from_image(image_bytes=b"\x89PNG", media_type="image/png",
                                       user_id="u1", client=_VisionStub(_candidates(tree)),
                                       bars=_bars())
    assert out["ok"] is False and "candidates" not in out
    assert [r["gate"] for r in out["refused"]] == ["unsupported:node"]
    assert "ast" not in out["refused"][0]


def test_vision_unexpected_exception__DID_logged_vision_internal_not_silent(
        vision_ledger, monkeypatch, caplog):
    """CLAIMED (before): a bug filed as `vision:no-candidate` with a warning and
    no traceback. DID (after): row gate `vision:internal`, traceback logged at
    ERROR, the other candidate still served. OUTCOME: CONTROLLED ERROR."""
    from api.services import definition_concierge as dc
    real = dc._validate

    def flaky(tree, bars, kind):
        if tree is TF_TREE:
            raise RuntimeError("synthetic candidate bug")
        return real(tree, bars, kind)
    monkeypatch.setattr(dc, "_validate", flaky)
    with caplog.at_level(logging.ERROR, logger=vision.logger.name):
        out = vision.candidates_from_image(
            image_bytes=b"\x89PNG", media_type="image/png", user_id="u1",
            client=_VisionStub(_candidates(TF_TREE, PLAIN)), bars=_bars())
    assert out["ok"] is True and [c["source"] for c in out["candidates"]] == ["sma(close, 20)"]
    assert [r["gate"] for r in out["refused"]] == ["vision:internal"]
    assert any(r.exc_info for r in caplog.records
               if r.levelno >= logging.ERROR and r.name == vision.logger.name)


def test_the_new_gates_stay_disjoint_and_member_safe():
    """The vision door's rail requires disjoint gate names/phrases."""
    from api.services import definition_concierge as dc
    assert not (set(vision.REFUSALS) & set(dc.REFUSALS))
    assert not (set(vision.REFUSALS.values()) & set(dc.REFUSALS.values()))
    assert ast_table.benchmarks(), "benchmark roster empty -- the sym cases prove nothing"
