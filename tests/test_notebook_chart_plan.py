"""Wave 13 lane 13H-1 -- the chart plan's foundation: roles drawn by the client's writer flow into
plan_extract (the ONE reader), the export keeps them, sizing asks Compass and labels it, alerts at
a drawn level go through the EXISTING alert pipeline, and the `ta` attr stays on the keep-list.

⛔ The client writer is EXECUTED, never restated: `lib/chartPlan.js` is imported by Node (the
same resolve hook tests/test_public_note_payload.py uses) and the annotations it builds are what
plan_extract reads here. A copy of its output in this file would be a third authority.
"""
from __future__ import annotations

import ast
import functools
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services import watchlist_alert_service
from api.services.journal_two import chart_plan
from api.services.journal_two import notebook_schema as nbs
from api.services.journal_two import plan_extract
from api.services.journal_two.db import ensure_schema as j2_ensure_schema

ROOT = Path(__file__).resolve().parents[1]
CHART_PLAN_JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "chartPlan.js"
ROUTER_PY = ROOT / "api" / "routers" / "notebook_chart_alerts.py"
SERVICE_PY = ROOT / "api" / "services" / "journal_two" / "chart_plan.py"

_HOOK = r"""
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    for (const ext of ['.js', '/index.js']) {
      try { const r = await nextResolve(specifier + ext, context); if (r) return r } catch {}
    }
  }
  return nextResolve(specifier, context)
}
"""
# The client's writer, run on a fixed drawing set: what a member's panel would save.
_DRIVER = r"""
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./hook.mjs', import.meta.url)
const cp = await import(pathToFileURL(process.argv[2]).href)
const line = (id, price, extra = {}) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }], ...extra })
let anns = [line('a', 101.5), line('b', 97.25), line('c', 112), line('d', 120),
  line('e', 30, { pane: 'pane1' }), { id: 't', type: 'text', points: [{ time: 1, price: 99 }], text: 'x' }]
anns = cp.setPlanRole(anns, 'a', 'stop')     // set, then moved below: 'a' must lose it
anns = cp.setPlanRole(anns, 'b', 'stop')
anns = cp.setPlanRole(anns, 'a', 'entry')
anns = cp.setPlanRole(anns, 'c', 'target')
anns = cp.setPlanRole(anns, 'd', 'target')
const moved = anns.map((d) => (d.id === 'b' ? { ...d, points: [{ time: 1758000000, price: 96.8 }] } : d))
process.stdout.write(JSON.stringify({
  sizedBy: cp.SIZED_BY,
  anns,
  moved,
  ta: cp.withSetupTag(cp.withPlanShares(null, 200, cp.SIZED_BY.STARTER), 'High Tight Flag'),
  emptyTa: cp.normalizeTa({ setupTag: ' ' }),
}))
"""


@functools.lru_cache(maxsize=1)
def client_writer() -> dict:
    node = shutil.which("node")
    assert node, "node is not on PATH -- this rail runs the client writer the way the bundle does"
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "hook.mjs").write_text(_HOOK, encoding="utf-8")
        (Path(d) / "driver.mjs").write_text(_DRIVER, encoding="utf-8")
        r = subprocess.run([node, str(Path(d) / "driver.mjs"), str(CHART_PLAN_JS)],
                           capture_output=True, timeout=120)
    err = (r.stderr or b"").decode("utf-8", errors="replace")
    assert r.returncode == 0, f"node could not run lib/chartPlan.js: {err[:2000]}"
    return json.loads(r.stdout.decode("utf-8"))


def chart_attrs(anns, ta=None, symbol="NVDA", embed_id="emb-1"):
    a = {"widgetId": "chart", "params": {"symbol": symbol, "tf": "D"}, "embedId": embed_id,
         "annotations": anns, "searchText": f"{symbol} daily"}
    if ta is not None:
        a["ta"] = ta
    return a


# ── the role round trip: client writer -> plan_extract ───────────────────────────────────────

def test_roles_drawn_by_the_client_writer_are_read_by_plan_extract():
    w = client_writer()
    plan = chart_plan.read_block_plan(chart_attrs(w["anns"], w["ta"]), "NVDA")
    assert plan["entry"] == 101.5 and plan["stop"] == 97.25
    assert plan["target"] == 112.0                     # two targets: the nearest (first scale-out)
    assert plan["shares"] == 200.0                     # from ta.planBlock
    assert plan["setup"] == "High Tight Flag"
    assert plan["side"] == "long"
    assert all(plan["roles"][r]["shape"] == "chart" for r in ("entry", "stop", "target", "shares"))
    # and the full note reader agrees (a chart is the top of the in-note precedence)
    reading = plan_extract.read_note_plan(chart_plan.block_doc(chart_attrs(w["anns"], w["ta"])), symbol="NVDA")
    assert reading.value("entry") == 101.5 and reading.primary_shape == "chart"


def test_moving_a_role_line_moves_the_plan__no_stale_price_copy():
    """The writer stores the role on the drawing and NO `price` copy, so the line's own anchor
    is the level: drag the stop and plan_extract reads the new price."""
    w = client_writer()
    assert all("price" not in d for d in w["anns"]), "the writer must not copy a price onto a drawing"
    assert chart_plan.read_block_plan(chart_attrs(w["moved"]), "NVDA")["stop"] == 96.8


def test_the_writer_never_puts_a_role_on_a_line_in_another_pane_or_a_text():
    w = client_writer()
    roles = {d["id"]: d.get("role") for d in w["anns"]}
    assert roles == {"a": "entry", "b": "stop", "c": "target", "d": "target", "e": None, "t": None}


def test_the_roles_vocabulary_is_13As():
    w = client_writer()
    assert {d.get("role") for d in w["anns"]} - {None} <= set(plan_extract.PRICE_ROLES)


def test_an_empty_ta_is_null_and_a_chart_on_another_ticker_is_not_this_tickers_plan():
    w = client_writer()
    assert w["emptyTa"] is None
    other = chart_plan.read_block_plan(chart_attrs(w["anns"], symbol="AMD"), "NVDA")
    assert other["entry"] is None and other["stop"] is None


def test_sized_by_is_one_fact_in_two_files():
    assert client_writer()["sizedBy"] == {"COMPASS": chart_plan.SIZED_BY_COMPASS,
                                          "STARTER": chart_plan.SIZED_BY_STARTER}


# ── the export line ───────────────────────────────────────────────────────────────────────────

def test_the_plan_levels_line_lists_every_drawn_level():
    w = client_writer()
    line = chart_plan.plan_levels_line(chart_attrs(w["anns"], w["ta"]))
    assert line == "Plan levels: Entry 101.50 · Stop 97.25 · Target 112.00, 120.00 · Shares 200"
    assert chart_plan.plan_levels_line(chart_attrs([])) is None
    assert chart_plan.plan_levels_line({"widgetId": "watchlist", "annotations": w["anns"]}) is None
    for junk in (None, "x", {"annotations": "nope"}, {"annotations": [None, 5, {"role": "stop"}]}):
        assert chart_plan.plan_levels_line(junk) is None


def test_markdown_and_word_exports_carry_the_line():
    from api.services.journal_two import notes_export as nx
    from api.services.journal_two import notes_export_formats as nxf
    w = client_writer()
    body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs(w["anns"], w["ta"])}]}
    md = nx.tiptap_to_markdown(body)
    assert "> [NVDA daily]" in md and "> Plan levels: Entry 101.50" in md
    import io, zipfile
    xml = zipfile.ZipFile(io.BytesIO(nxf.note_docx(body, title="t"))).read("word/document.xml").decode("utf-8")
    assert "Plan levels: Entry 101.50 · Stop 97.25" in xml
    # CONTROL: a chart without roles exports exactly as before -- no empty line
    plain = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs([])}]}
    assert nx.tiptap_to_markdown(plain).strip() == "> [NVDA daily]"


def test_ta_changes_neither_a_citations_text_nor_the_embeds_identity():
    """The citation table reads a widgetEmbed's `searchText` and identifies it by `embedId`;
    `ta` adds no words a citation could point at and must not move a citation's position."""
    from api.services.journal_two import note_citation_text as nct
    w = client_writer()

    def flat(ta):
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "before"}]},
                                           {"type": "widgetEmbed", "attrs": chart_attrs(w["anns"], ta)},
                                           {"type": "paragraph", "content": [{"type": "text", "text": "after"}]}]}
        return nct.flatten(body)

    a, b = flat(None), flat(w["ta"])
    assert nct.member_text(a) == nct.member_text(b) and "after" in nct.member_text(b)
    assert json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def test_a_ta_note_exports_as_schema_level_4():
    w = client_writer()
    body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs(w["anns"], w["ta"])}]}
    assert nbs.required_schema(body) == 4


# ── the routes ────────────────────────────────────────────────────────────────────────────────

PAID = {"plan": "pro"}
FREE = {"plan": "free"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    for uid in ("m1", "m2"):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, f"{uid}@example.com", "x", uid, "member"))
    conn.commit()
    conn.close()
    from api.routers import notebook_chart_alerts
    app = FastAPI()
    app.include_router(notebook_chart_alerts.router)
    c = TestClient(app)
    c.app_ = app
    yield c
    app.dependency_overrides.clear()


def as_user(client, uid, plan=PAID):
    user = {"id": uid, "role": "member", **plan}
    client.app_.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _note(uid, body, deleted=False):
    from api.services.journal_two import notes
    conn = auth_db.get_connection()
    try:
        n = notes.create_note(uid, {"title": "plan", "bodyJson": body}, conn=conn)
        if deleted:
            conn.execute("UPDATE j2_notes SET deleted_at = '2026-10-01T00:00:00Z' WHERE id = ?", (n["id"],))
            conn.commit()
        return n
    finally:
        conn.close()


def test_every_route_is_404_while_the_flag_is_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(chart_plan.FLAG, raising=False)
    assert chart_plan.enabled() is False
    for path in ("/size", "/alerts"):
        assert client.post("/api/j2/chart-plan" + path, json={}).status_code == 404, path
    monkeypatch.setenv(chart_plan.FLAG, "1")
    assert chart_plan.enabled() is True
    # flag on, signed out: the session is now asked for (CONTROL: the 404 above was the gate)
    assert client.post("/api/j2/chart-plan/size", json={}).status_code == 401


def test_size_reads_the_plan_and_asks_compass_for_a_paid_long(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    as_user(client, "m1", PAID)
    monkeypatch.setattr(chart_plan, "account_inputs",
                        lambda uid, aid=None: {"accountId": "a1", "accountSize": 100000.0, "riskPct": 1.0})
    asked = []
    from api.services import brain_service
    monkeypatch.setattr(brain_service, "size_a_trade",
                        lambda e, s, a, risk_pct=1.0: asked.append((e, s, a, risk_pct))
                        or {"ok": True, "shares": 380, "regime": "GREEN", "risk_pct": risk_pct})
    w = client_writer()
    r = client.post("/api/j2/chart-plan/size", json={"annotations": w["anns"], "symbol": "NVDA"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["plan"]["entry"] == 101.5 and out["plan"]["stop"] == 97.25 and out["plan"]["side"] == "long"
    assert out["compass"] == {"ok": True, "shares": 380, "sizedBy": "compass", "regime": "GREEN", "risk_pct": 1.0}
    assert asked == [(101.5, 97.25, 100000.0, 1.0)]
    assert out["account"]["accountSize"] == 100000.0


def test_size_does_not_ask_compass_for_a_free_member_or_a_short(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    monkeypatch.setattr(chart_plan, "account_inputs",
                        lambda uid, aid=None: {"accountId": "a1", "accountSize": 100000.0, "riskPct": 1.0})
    from api.services import brain_service
    monkeypatch.setattr(brain_service, "size_a_trade", lambda *a, **k: pytest.fail("Compass was asked"))
    w = client_writer()
    # Owner ruling 2026-10-02 (security review I-7): the route itself now takes a paid plan,
    # so a free member is refused before any sizing. The service keeps its own refusal too.
    as_user(client, "m1", FREE)
    refused = client.post("/api/j2/chart-plan/size", json={"annotations": w["anns"]})
    assert refused.status_code == 402 and "paid plan" in refused.json()["detail"]
    assert chart_plan.compass_size(50, 48, 1e5, 1, paid=False) == {"ok": False, "reason": chart_plan.COMPASS_PAID_REASON}
    as_user(client, "m1", PAID)
    short = [dict(d) for d in w["anns"]]
    for d in short:                                    # flip: stop above entry
        if d.get("role") == "stop":
            d["points"] = [{"time": 1, "price": 105.0}]
    out = client.post("/api/j2/chart-plan/size", json={"annotations": short}).json()
    assert out["plan"]["side"] == "short"
    assert out["compass"] == {"ok": False, "reason": chart_plan.COMPASS_LONG_ONLY_REASON}


def test_size_refuses_a_body_that_is_not_one(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    as_user(client, "m1")
    assert client.post("/api/j2/chart-plan/size", content=b"[1]").status_code == 422
    assert client.post("/api/j2/chart-plan/size", json={"annotations": "x"}).status_code == 422
    assert client.post("/api/j2/chart-plan/size", content=b"{" + b" " * (300 * 1024) + b"}").status_code == 422


def test_compass_answers_are_labelled_and_never_invented():
    ok = lambda *a, **k: {"ok": True, "shares": 12.9}  # noqa: E731
    assert chart_plan.compass_size(50, 48, 1e5, 1, paid=True, size_fn=ok) == {"ok": True, "shares": 12, "sizedBy": "compass"}
    for res in ({"ok": False, "error": "brain not available"}, {"ok": True}, {"ok": True, "shares": -1},
                {"ok": True, "shares": float("nan")}, None):
        out = chart_plan.compass_size(50, 48, 1e5, 1, paid=True, size_fn=lambda *a, _r=res, **k: _r)
        assert out["ok"] is False and out["reason"], res
    assert chart_plan.compass_size(50, 48, None, 1, paid=True, size_fn=ok)["ok"] is False
    assert chart_plan.compass_size(50, 50, 1e5, 1, paid=True, size_fn=ok)["reason"] == chart_plan.COMPASS_LONG_ONLY_REASON


# ── alerts: through the EXISTING pipeline ─────────────────────────────────────────────────────

ALERT = {"noteId": None, "embedId": "emb-1", "drawingId": "b", "direction": "below",
         "alert_type": "line", "target_price": 97.25}


def test_an_alert_is_armed_through_the_existing_route_with_the_drawing_id(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    as_user(client, "m1")
    w = client_writer()
    note = _note("m1", {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs(w["anns"])}]})
    from api.routers import watchlist_alerts
    seen = []
    real_route = watchlist_alerts.create_alert
    monkeypatch.setattr(watchlist_alerts, "create_alert",
                        lambda body, user: seen.append((body, user["id"])) or real_route(body, user))
    r = client.post("/api/j2/chart-plan/alerts", json={**ALERT, "noteId": note["id"], "symbol": "EVIL"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["symbol"] == "NVDA"                     # from the NOTE, never the client
    assert out["alert"]["drawing_id"] == "b" and out["alert"]["sym"] == "NVDA"
    assert out["alert"]["alert_type"] == "line" and out["alert"]["direction"] == "below"
    assert [(b.sym, b.drawing_id, uid) for b, uid in seen] == [("NVDA", "b", "m1")]
    # the row is the existing table's, listed by the existing service
    rows = watchlist_alert_service.list_user_alerts("m1")
    assert [(a["sym"], a["drawing_id"], a["target_price"]) for a in rows] == [("NVDA", "b", 97.25)]


def test_a_trendline_alert_carries_its_anchors(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    as_user(client, "m1")
    note = _note("m1", {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs([])}]})
    r = client.post("/api/j2/chart-plan/alerts", json={
        **ALERT, "noteId": note["id"], "alert_type": "trendline", "direction": "above", "target_price": 101,
        "anchor_t1": 1758000000, "anchor_p1": 99.0, "anchor_t2": 1758600000, "anchor_p2": 101.0})
    assert r.status_code == 200, r.text
    a = r.json()["alert"]
    assert (a["alert_type"], a["anchor_p1"], a["anchor_p2"]) == ("trendline", 99.0, 101.0)


def test_alerts_answer_one_404_for_another_members_note_a_trashed_note_or_a_missing_chart(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs([])}]}
    theirs = _note("m2", body)
    trashed = _note("m1", body, deleted=True)
    mine = _note("m1", body)
    as_user(client, "m1")
    for note_id, embed in ((theirs["id"], "emb-1"), (trashed["id"], "emb-1"), (mine["id"], "nope"),
                           ("no-such-note", "emb-1")):
        r = client.post("/api/j2/chart-plan/alerts", json={**ALERT, "noteId": note_id, "embedId": embed})
        assert r.status_code == 404, (note_id, embed, r.text)
    assert watchlist_alert_service.list_user_alerts("m1") == []


def test_the_existing_routes_validation_is_the_validation(client, monkeypatch):
    monkeypatch.setenv(chart_plan.FLAG, "1")
    as_user(client, "m1")
    note = _note("m1", {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": chart_attrs([])}]})
    r = client.post("/api/j2/chart-plan/alerts", json={**ALERT, "noteId": note["id"], "direction": "sideways"})
    assert r.status_code == 400 and r.json()["detail"] == "direction must be 'above' or 'below'"
    r = client.post("/api/j2/chart-plan/alerts", json={**ALERT, "noteId": note["id"], "target_price": "abc"})
    assert r.status_code == 422
    r = client.post("/api/j2/chart-plan/alerts", json={**ALERT, "noteId": note["id"], "drawingId": ""})
    assert r.status_code == 422


# ── ⛔ never a second alert pipeline ──────────────────────────────────────────────────────────

_WRITE_SQL = re.compile(r"\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b", re.IGNORECASE)
_FORBIDDEN_NAMES = {"add_alert", "deliver_alert_payload", "send_email", "watchlist_alert_service",
                    "alerts", "chart_health_alerts"}


def _string_constants(tree):
    return [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


@pytest.mark.parametrize("path", [ROUTER_PY, SERVICE_PY])
def test_the_chart_plan_code_writes_no_table_and_imports_no_alert_machinery(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    sql = [s for s in _string_constants(tree) if _WRITE_SQL.search(s) and re.search(r"\b(INTO|SET|TABLE|FROM)\b", s, re.I)]
    assert sql == [], f"{path.name} carries write SQL: {sql}"
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            imported |= {a.name for a in n.names} | {(n.module or "").rsplit(".", 1)[-1]}
        elif isinstance(n, ast.Import):
            imported |= {a.name.rsplit(".", 1)[-1] for a in n.names}
    assert not (imported & _FORBIDDEN_NAMES), f"{path.name} imports {imported & _FORBIDDEN_NAMES}"


def test_the_router_creates_alerts_only_by_calling_the_existing_route():
    tree = ast.parse(ROUTER_PY.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr in {"create_alert", "AlertCreate"}]
    targets = {(c.func.value.id if isinstance(c.func.value, ast.Name) else None, c.func.attr) for c in calls}
    assert targets == {("watchlist_alerts", "create_alert"), ("watchlist_alerts", "AlertCreate")}, targets


def test_exactly_one_module_ever_inserts_an_alert_row():
    """Repo-wide: `watchlist_alerts` rows are written by ONE module. A second writer -- this
    lane's or anyone's -- is a second alert pipeline, and fails here by file name."""
    hits = []
    for py in (ROOT / "api").rglob("*.py"):
        text = py.read_text(encoding="utf-8", errors="replace")
        if re.search(r"INSERT\s+(OR\s+\w+\s+)?INTO\s+watchlist_alerts\b", text, re.IGNORECASE):
            hits.append(py.relative_to(ROOT).as_posix())
    assert hits == ["api/services/watchlist_alert_service.py"], hits


# ── the keep-list ─────────────────────────────────────────────────────────────────────────────

def test_the_ta_row_lives_in_files_the_rollback_keeps_and_the_runbook_names_it():
    import importlib.util
    spec = importlib.util.spec_from_file_location("_rb", ROOT / "tools" / "notebook_rollback_chain.py")
    rb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rb)
    kept = set(rb.KEEP_AT_TIP)
    assert "api/services/journal_two/notebook_schema.py" in kept
    assert "app/src/pages/journal-2-0/lib/notebookSchema.js" in kept
    assert nbs.NOTEBOOK_ATTR_SCHEMA.get("widgetEmbed.ta") == 4
    js = (ROOT / "app/src/pages/journal-2-0/lib/notebookSchema.js").read_text(encoding="utf-8")
    assert "'widgetEmbed.ta': 4" in js
    runbook = (ROOT / "docs/notebook/wave5-rollback.md").read_text(encoding="utf-8")
    level4 = runbook[runbook.index("## Level 4 -- wave 13 lane 13H-1"):]
    assert "NEVER-REVERT" in level4 and "NOTEBOOK_ATTR_SCHEMA" in level4 and "keep-list" in level4
    banner = runbook[:runbook.index("## The procedure")]
    assert "NOTEBOOK_ATTR_SCHEMA" in banner and "widgetEmbed.ta" in banner
