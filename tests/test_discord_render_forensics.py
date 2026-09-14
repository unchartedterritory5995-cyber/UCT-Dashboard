"""One regression per forensic failure class — `docs/discord-render/01-failure-forensics.md`.

Step 2.8. Every class C-01…C-14 gets a test that **reproduces the class**, not the symptom that
happened to be observed. Where the fix has landed the test is a standing guard; where it has not,
the test is `xfail(strict=True)` naming what must land.

⛔ WHY `strict=True` AND NOT A RED TEST. A plain red test blocks every merge in the queue, so it
gets deleted or skipped inside a week. A NON-strict xfail swallows the fix: the day someone closes
the class the suite stays green and nobody learns that the gap is gone. `strict=True` is the only
setting that keeps the gate green today **and** fails loudly the moment the class is closed — or
the moment the test starts passing for the wrong reason, which is the failure mode that matters
more (a test that passes because its seam moved is indistinguishable from a fix).

⛔ EVERY TEST NAMES ITS CLASS (`test_c07_…`) so a red line says which forensic class regressed
without anyone opening this file.

⛔ AND EVERY TEST'S DOCSTRING ANSWERS ONE QUESTION: *if this class were re-introduced tomorrow in a
slightly different way, would this test see it?* A rail that can only recognise the exact shape of
the incident it was written from is a fixture, not a rail
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
"""
from __future__ import annotations

import ast
import datetime as dt
import inspect
import logging
import pathlib
import threading
import time
from zoneinfo import ZoneInfo

import pytest

from api.services import discord_interactions as di
from api.services.discord_render import breakers, contract, freshness, ids, observe, symbols
from api.services.discord_render.adapters import _call, bars as bars_ad, classes, flow as flow_ad
from api.services.discord_render.adapters import renderer as renderer_ad
from api.services.discord_render.adapters import result as R
from api.services.discord_render.delivery import DeliveryResult
from api.services.discord_render.jobs_store import JobsStore
from api.services.discord_render.runtime import BACKGROUND, INTERACTIVE, Job, JobRuntime

REPO = pathlib.Path(__file__).resolve().parents[1]
ET = ZoneInfo("America/New_York")
PNG = b"\x89PNG\r\n\x1a\n"


# ── shared doubles ──────────────────────────────────────────────────────────


def _renderer_module():
    """Load `services/chart_renderer/app.py` the way its own image does.

    The renderer image has `WORKDIR /app` and copies its modules FLAT, so `app.py` does
    `from edge_scope import ...` with no package. Importing it from the repo therefore needs that
    directory on `sys.path` — without it every renderer test dies at import with
    `ModuleNotFoundError: No module named 'edge_scope'`.

    ⚠️ THIS IS ALSO AN INHERITED BREAKAGE, NOT A LOCAL WORKAROUND. `tests/test_chart_renderer_*.py`
    fail the same way on a clean checkout of origin/master (6 failed, reproduced), because the flat
    import was added without a path entry. Recorded as an OI; this helper keeps Lane E's two tests
    honest in the meantime rather than skipping them, because a skip here would hide the C-13 token
    scrub — the one property that must never regress."""
    import importlib.util
    import sys
    here = pathlib.Path(__file__).resolve().parents[1] / "services" / "chart_renderer"
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))
    spec = importlib.util.spec_from_file_location("chart_renderer_app", here / "app.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("chart_renderer_app", mod)
    spec.loader.exec_module(mod)
    return mod


class FakeDelivery:
    """Records what a member would have been sent. `edit_text`/`followup` are the only two ways
    anything reaches Discord from the runtime, so capturing both is capturing the member."""

    def __init__(self, ok: bool = True):
        self.ok = ok
        self.sent: list[tuple[str, str, list | None]] = []

    # ⛔ The double must track the REAL signature, not restate it. `send_failure` passes
    # `deadline_s` (the interaction TOKEN's remaining life, never the job's remaining time — see
    # `JobRuntime._failure_budget`) and `cid`. A double that omits them fails with
    # `unexpected keyword argument`, which is the contract-arity defect in miniature: it reads as a
    # product failure and is a test-fixture failure.
    def edit_text(self, app_id, token, *, content, components=None, client=None,
                  deadline_s=None, cid=None):
        self.sent.append(("edit_text", content, components))
        return DeliveryResult(self.ok, 200 if self.ok else 500)

    def followup(self, app_id, token, *, content, components=None, ephemeral=True, client=None,
                 deadline_s=None, cid=None):
        self.sent.append(("followup", content, components))
        return DeliveryResult(self.ok, 200 if self.ok else 500)

    def contents(self) -> str:
        return "\n".join(c for _, c, _ in self.sent)


class Edits:
    """The pre-V2 `edit_fn` seam: `(app_id, token, content=…, png=…, filename=…, **extra)`."""

    def __init__(self, reply_id: str = "m1", attachment_ids=(0,)):
        self.calls: list[dict] = []
        self._reply = {"id": reply_id,
                       "attachments": [{"id": i, "filename": "c.png"} for i in attachment_ids]}

    def __call__(self, app_id, token, *, content, png=None, filename=None, **extra):
        self.calls.append({"content": content, "png": png, "filename": filename, **extra})
        return dict(self._reply)


def _job(cid="aaaaaaa1", **kw) -> Job:
    base = dict(corr_id=cid, command="chart", app_id="APP", token="TOK-" + cid,
                args={"ticker": "NVDA", "tf": "D"}, label="/chart NVDA", user_id="u1",
                interaction_id="i-" + cid)
    base.update(kw)
    return Job(**base)


def _runtime(store, handlers, *, delivery=None, owner="pod-A", **kw) -> JobRuntime:
    edits: list[dict] = []

    def edit_fn(app_id, token, **k):
        edits.append(k)
        return {"id": "m", "attachments": [{"id": 0}]}

    rt = JobRuntime(store=store, handlers=handlers, edit_fn=edit_fn,
                    delivery=delivery or FakeDelivery(), owner=owner, **kw)
    rt.edits = edits
    return rt


@pytest.fixture
def store(tmp_path):
    s = JobsStore(str(tmp_path / "forensics.db"))
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _clean_process_state(monkeypatch):
    """Breakers, adapter pools and the chart PNG cache are module state. A class-reproduction test
    that inherits another test's open breaker measures that test, not this class."""
    breakers.reset_all_for_tests()
    _call.reset_for_tests()
    symbols.clear_for_tests()
    monkeypatch.setenv("DISCORD_CHART_SELF_HEAL", "0")   # no daemon heal thread outliving the test
    monkeypatch.setattr(di, "BARS_RETRY_DELAY_S", 0, raising=False)
    try:
        from api.services import discord_chart_cache as cc
        cc.clear()
        yield
        cc.clear()
    except ImportError:
        yield
    breakers.reset_all_for_tests()
    _call.reset_for_tests()


# ════════════════════════════════════════════════════════════════════════════
# C-01 — a `web` restart kills in-flight replies
# ════════════════════════════════════════════════════════════════════════════

def test_c01_a_restart_mid_job_is_resumed_by_the_next_pod_and_the_dead_pod_cannot_double_post():
    """REGRESSION GUARD (the fix landed: 2.1 durable jobs + lease resume).

    Reproduces the class rather than the incident: a pod takes a job, dies holding it, a second pod
    boots. The class is "the member's reply dies with the pod", so the test asserts (a) the next pod
    re-queues the job and (b) the *first* pod, waking up late, is refused the PATCH.

    ⛔ Would it see a re-introduction in a different shape? Yes, in both directions, and that is
    why both halves are here. Drop the durable row or the lease-expiry claim and (a) goes red.
    Keep resume but drop the `held_by` re-read before sending — the shape where the member gets the
    chart twice, or an old pod overwrites a fresh chart with a stale one — and (b) goes red. A test
    that only asserted "the job ran" would pass on a design that double-posts.
    """
    path = None
    try:
        import tempfile
        path = tempfile.mktemp(suffix=".db")
        s1 = JobsStore(path)
        job = _job("c01aaaa1")
        s1.insert(job.row())
        assert s1.claim(job.corr_id, "pod-A", lease_s=20.0) is True
        # pod A dies without releasing: simulate the lease simply lapsing (the SIGKILL case, which
        # is strictly harder than the graceful `release_all` path the shutdown hook takes).
        s1._conn.execute("UPDATE discord_render_jobs SET lease_until=? WHERE corr_id=?",
                         (time.time() - 1, job.corr_id))
        s1._conn.commit()
        s1.close()

        s2 = JobsStore(path)
        ran: list[str] = []
        rt = _runtime(s2, {"chart": lambda ctx: ran.append(ctx.job.corr_id) or "ok"}, owner="pod-B")
        out = rt.resume_pending()
        assert out["resumed"] == 1, "a young job left by a dead pod must be re-queued, not lost"

        resumed = rt._inter.get_nowait()
        assert resumed.resumed is True and resumed.token == job.token
        rt.run_job(resumed)
        assert ran == [job.corr_id]
        assert s2.get(job.corr_id)["state"] in ("delivered", "messaged")

        # …and now pod A wakes up. It must not send.
        assert s2.held_by(job.corr_id, "pod-A") is False, (
            "the double-delivery guard: a worker re-reads its lease before any PATCH, so the pod "
            "that was reclaimed cannot post over the pod that answered")
        s2.close()
    finally:
        if path:
            pathlib.Path(path).unlink(missing_ok=True)


# ════════════════════════════════════════════════════════════════════════════
# C-02 — `web` saturation → Discord acks miss 3 s
# ════════════════════════════════════════════════════════════════════════════

def test_c02_the_ack_path_never_waits_on_the_work_and_a_full_queue_answers_instead_of_blocking(store):
    """REGRESSION GUARD (the fix landed: 2.1 bounded queue + dedicated executor).

    The class is "the acknowledgement is behind the work". Reproduced by making the handler block
    forever and asserting the ack-path call (`offer`) still returns immediately — and that a queue
    with no room answers `full` rather than waiting for one.

    ⛔ A different re-introduction — `offer` growing an I/O call, the queue becoming unbounded so a
    saturated pod silently accumulates, or the dedicated pool being swapped back for the shared
    anyio one — is caught by the three assertions below: the wall-clock bound on `offer`, the
    `full` verdict at `maxsize`, and the per-dependency pool identity. A test that only asserted
    "the handler eventually ran" would pass on every one of those regressions.
    """
    gate = threading.Event()
    rt = _runtime(store, {"chart": lambda ctx: gate.wait(5) or "ok"}, queue_max=2, workers=1)

    t0 = time.perf_counter()
    assert rt.offer(_job("c02aaa01"))[0] == "queued"
    assert rt.offer(_job("c02aaa02", user_id="u2"))[0] == "queued"
    verdict, pos = rt.offer(_job("c02aaa03", user_id="u3"))
    elapsed = time.perf_counter() - t0
    gate.set()

    assert verdict == "full" and pos is None, (
        "a full queue must be answered now — a deferred spinner behind a full queue is the 3 s "
        "miss this class is made of")
    assert elapsed < 0.5, f"the ack path blocked for {elapsed:.3f}s; it must be an in-memory put"

    # …and the work does not run on the caller's threads. Each dependency owns a bounded pool, so a
    # wedged upstream can exhaust its own and nothing else (C-02's lesson, one layer down).
    pools = {name: _call.pool(name) for name in ("bars", "flow", "renderer", "quote", "entity")}
    assert len({id(p) for p in pools.values()}) == len(pools), (
        "every dependency shares one pool again — a wedged upstream would drain the others")


# ════════════════════════════════════════════════════════════════════════════
# C-03 — Discord rejects the whole component tree
# ════════════════════════════════════════════════════════════════════════════

VS16 = "️"
ZWJ = "‍"
CUSTOM_ID_MAX = 100
LABEL_MAX = 80


def _emoji_is_acceptable(name: str) -> tuple[bool, str]:
    """Discord accepts a real unicode emoji as a component emoji and refuses a text symbol.

    The rule, stated as a property rather than as a blocklist of the one character that bit us: a
    codepoint outside the emoji planes is only an emoji when it carries the emoji-presentation
    selector U+FE0F. `▲` U+25B2 is BMP text with no selector → refused (COMPONENT_INVALID_EMOJI,
    33 times). `⚙️` U+2699 U+FE0F is the same kind of character WITH the selector → accepted.
    `🔼` U+1F53C is in the emoji plane → accepted.
    """
    cps = [c for c in name if c not in (VS16, ZWJ)]
    if not cps:
        return False, "empty emoji name"
    i = 0
    for ch in name:
        if ch in (VS16, ZWJ):
            continue
        i = name.index(ch, i)
        nxt = name[i + 1] if i + 1 < len(name) else ""
        if ord(ch) < 0x1F000 and nxt != VS16:
            return False, (f"U+{ord(ch):04X} is a text symbol without U+FE0F — Discord refuses the "
                           "WHOLE component tree for it (COMPONENT_INVALID_EMOJI)")
        i += 1
    return True, ""


def validate_component_tree(rows: list) -> list[str]:
    """Discord's documented limits, applied locally. This validator is TEST-OWNED on purpose: the
    production pre-flight validator is step 2.6 and has not landed, and writing it here is what
    lets this test reproduce the class today instead of waiting for it."""
    problems: list[str] = []
    if len(rows) > 5:
        problems.append(f"{len(rows)} action rows (max 5)")
    seen: set[str] = set()
    for ri, row in enumerate(rows):
        comps = row.get("components") or []
        buttons = [c for c in comps if c.get("type") == 2]
        if len(buttons) > 5:
            problems.append(f"row {ri}: {len(buttons)} buttons (max 5)")
        if any(c.get("type") == 3 for c in comps) and len(comps) != 1:
            problems.append(f"row {ri}: a select menu must be alone in its row")
        for ci, c in enumerate(comps):
            where = f"components.{ri}.components.{ci}"
            cid = c.get("custom_id")
            if c.get("type") in (2, 3) and not c.get("url"):
                if not cid:
                    problems.append(f"{where}: no custom_id")
                else:
                    if len(cid) > CUSTOM_ID_MAX:
                        problems.append(f"{where}: custom_id {len(cid)} chars (max {CUSTOM_ID_MAX})")
                    if cid in seen:
                        problems.append(f"{where}: duplicate custom_id {cid!r}")
                    seen.add(cid)
            label = c.get("label")
            if label is not None and len(label) > LABEL_MAX:
                problems.append(f"{where}: label {len(label)} chars (max {LABEL_MAX})")
            emoji = (c.get("emoji") or {}).get("name")
            if emoji:
                ok, why = _emoji_is_acceptable(emoji)
                if not ok:
                    problems.append(f"{where}: {why}")
            opts = c.get("options") or []
            if len(opts) > 25:
                problems.append(f"{where}: {len(opts)} select options (max 25)")
            if sum(1 for o in opts if o.get("default")) > 1:
                problems.append(f"{where}: more than one default option")
            for oi, o in enumerate(opts):
                ov = o.get("value") or ""
                if len(ov) > CUSTOM_ID_MAX:
                    problems.append(f"{where}.options.{oi}: value {len(ov)} chars")
                ov_emoji = (o.get("emoji") or {}).get("name")
                if ov_emoji:
                    ok, why = _emoji_is_acceptable(ov_emoji)
                    if not ok:
                        problems.append(f"{where}.options.{oi}: {why}")
    return problems


def test_c03_the_component_validator_can_actually_fail():
    """THE CONTROL. A validator nobody has watched fail is not a validator
    (`lesson_gate_that_cannot_fail`). This plants the exact tree Discord refused 33 times — the
    collapse button carrying `▲` U+25B2 — and asserts the check below would have caught it."""
    bad = [{"type": 1, "components": [
        {"type": 2, "style": 2, "label": "Collapse", "custom_id": "x", "emoji": {"name": "▲"}}]}]
    problems = validate_component_tree(bad)
    assert problems and "U+25B2" in problems[0]
    # …and it is not simply refusing everything: the shipped replacement passes.
    good = [{"type": 1, "components": [
        {"type": 2, "style": 2, "label": "Collapse", "custom_id": "x", "emoji": {"name": "\U0001f53c"}}]}]
    assert validate_component_tree(good) == []
    assert validate_component_tree(
        [{"type": 1, "components": [{"type": 2, "style": 2, "label": "S", "custom_id": "y",
                                     "emoji": {"name": "⚙️"}}]}]) == [], (
        "a BMP symbol WITH U+FE0F is a real emoji — a blocklist of one character would refuse it")


def test_c03_every_component_tree_the_bot_builds_survives_discords_own_rules():
    """REGRESSION GUARD (the ▲ fix landed in `9d38e5d8e`; the production pre-flight validator is
    2.6 and has not, so the validator here is the test's own).

    Reproduces the class — *Discord refuses the whole tree* — by running every component tree the
    bot actually builds through the full rule set, not by asserting the absence of one character.

    ⛔ A re-introduction in a slightly different way is exactly what this is for: a second text
    symbol, a `custom_id` grown past 100 by a longer ticker or a new state field, a duplicated id
    across two rows, a sixth button. Each is a different way to get the identical member outcome
    (the chart arrives with no controls at all), and each fails here by name and path.
    """
    reqs = [
        di.ChartRequest("NVDA", "D"),
        di.ChartRequest("BRK.B", "W"),
        di.ChartRequest("A" * 12, "5"),                       # the longest ticker the parser allows
        di.ChartRequest("SPY", "60", compare=("QQQ", "IWM", "DIA")),
    ]
    trees = []
    for req in reqs:
        for prefs in ({}, {"ma": "10,20,50,200", "volume": True, "ext": True}):
            trees.append((f"chart_components({req.ticker},{req.tf},prefs={bool(prefs)})",
                          di.chart_components(req, prefs, guild_id="1")))
    trees.append(("multi_components", di.multi_components([di.ChartRequest("NVDA", "D"),
                                                           di.ChartRequest("AMD", "D"),
                                                           di.ChartRequest("AVGO", "D")])))
    trees.append(("flow_components", di.flow_components("SPY")))
    trees.append(("contract.failure_components", contract.failure_components("7f3a9c21")))

    assert any(rows for _, rows in trees), "no tree was built — the walk measured nothing"
    failures = {name: validate_component_tree(rows) for name, rows in trees if validate_component_tree(rows)}
    assert not failures, f"Discord would refuse these whole trees: {failures}"


# ════════════════════════════════════════════════════════════════════════════
# C-04 — a follow-up edit re-declares attachments Discord no longer has
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.xfail(strict=True, reason=(
    "C-04: OI-04 has not landed. The context line is still a SECOND PATCH that re-declares the "
    "attachment ids off the first edit's response (`discord_interactions.py::_context_follow_up` → "
    "`keep_attachments`), which is the only code path that can produce the 23 double-failed "
    "ATTACHMENT_NOT_FOUND edits. Step 2.6 folds the context line into the image PATCH."))
def test_c04_the_context_line_never_arrives_as_a_second_edit_that_redeclares_attachment_ids():
    """XFAIL-STRICT — the fix is step 2.6 / OI-04 and has not landed.

    Reproduces the class at the member-visible seam: run a real chart job with a context line
    available and count the edits that carry the image. The class is "a later PATCH re-declares
    attachment ids the message may no longer hold", so the assertion is about the SHAPE of the
    traffic (one image PATCH, no `keep_attachments` anywhere), not about the 400 that shape caused.

    ⛔ Re-introduced in a different way? The assertion is over every edit the job makes, so a new
    second edit for some other reason — a footer, a badge, a late stats strip — that re-declares
    ids fails here too. It does NOT constrain how the context line is delivered, only that nothing
    re-declares an attachment it did not upload, which is the property that closes the class.
    """
    bars = _daily_bars(180)
    edits = Edits()
    out = di.run_chart_job("APP", "TOK", di.ChartRequest("NVDA", "D"),
                           bars_fn=lambda t, tf, n: bars,
                           render_fn=lambda t, tf, b, **k: PNG + b"chart",
                           edit_fn=edits,
                           context_fn=lambda ticker: "Earnings in 4 days · IM 6.2%")
    assert out == "ok"
    assert edits.calls, "nothing was sent — the job measured nothing and cannot answer this class"
    assert not any("keep_attachments" in c for c in edits.calls), (
        "an edit re-declared attachment ids it did not upload — that is C-04's only code path")
    assert sum(1 for c in edits.calls if c.get("png")) == 1
    assert len(edits.calls) == 1, (
        "the context line arrived as a second PATCH; OI-04 folds it into the image PATCH")


# ════════════════════════════════════════════════════════════════════════════
# C-05 — a FastAPI route function called in-process leaks a `Query()` default
# ════════════════════════════════════════════════════════════════════════════

def _route_endpoints_by_module(pkg: pathlib.Path) -> dict[str, set[str]]:
    """`api.routers.<module>` → the names in it decorated as HTTP endpoints.

    ⛔ AN AST, NEVER A GREP. A grep for `@router.get` matches this docstring, the comments in
    `ticker_search.py` that describe the very bug, and any prose that names a decorator. The parse
    tree cannot be tripped by prose."""
    found: dict[str, set[str]] = {}
    methods = {"get", "post", "put", "patch", "delete", "head", "options", "api_route", "websocket"}
    for path in sorted(pkg.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a file that will not parse is a different problem
            continue
        names = set()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                call = dec.func if isinstance(dec, ast.Call) else dec
                if isinstance(call, ast.Attribute) and call.attr in methods:
                    names.add(node.name)
        if names:
            found[path.stem] = names
    return found


def _router_endpoint_calls(tree: ast.AST, endpoints: dict[str, set[str]]) -> set[str]:
    """Calls in `tree` that resolve to a FastAPI endpoint in `api/routers/**`.

    ⛔ THE RESOLUTION IS WHAT MAKES THIS A RAIL RATHER THAN A NAME COLLISION. A bare
    `name in endpoints` check flags `threading.Thread.join`, `Semaphore.acquire` and
    `breakers.snapshot` because some router happens to define an endpoint of that name — which is
    a rail that cannot distinguish the thing it is looking for from ordinary Python
    (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). So the alias is resolved back to
    the router module first, both for `import api.routers.x as y` / `from api.routers import x` and
    for `from api.routers.x import endpoint`, at module level and inside a function (the deferred
    import is exactly the shape this is hunting).
    """
    alias_to_module: dict[str, str] = {}
    direct: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.startswith("api.routers."):
                    alias_to_module[a.asname or a.name.split(".")[-1]] = a.name.split(".")[-1]
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if mod == "api.routers":
                for a in node.names:
                    alias_to_module[a.asname or a.name] = a.name
            elif mod.startswith("api.routers."):
                leaf = mod.split(".")[-1]
                for a in node.names:
                    if a.name in endpoints.get(leaf, ()):  # the endpoint itself, bound by name
                        direct[a.asname or a.name] = leaf

    hits: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
            mod = alias_to_module.get(fn.value.id)
            if mod and fn.attr in endpoints.get(mod, ()):
                hits.add(f"{fn.value.id}.{fn.attr} → api.routers.{mod}")
        elif isinstance(fn, ast.Name) and fn.id in direct:
            hits.add(f"{fn.id}() → api.routers.{direct[fn.id]}")
    return hits


def test_c05_the_endpoint_walk_and_the_call_walk_both_see_what_they_are_looking_for():
    """THE CONTROL, and it is the whole test's licence to make a claim.

    Both halves read a parse tree; an empty result from either would make the guard below pass over
    nothing (`an empty result is a failed invocation until proven otherwise`). So: the endpoint walk
    must find a known endpoint, the call walk must see a planted call in each of the three shapes a
    real caller uses, and prose naming an endpoint must NOT read as one."""
    endpoints = _route_endpoints_by_module(REPO / "api" / "routers")
    assert len(endpoints) > 20, f"the endpoint walk found {len(endpoints)} modules — it measured nothing"
    assert "ticker_search" in endpoints.get("ticker_search", set()), (
        "the walk missed the endpoint this class is named after")

    planted = ast.parse(
        "from api.routers import ticker_search as ts\n"
        "from api.routers.ticker_search import ticker_search\n"
        "def h():\n"
        "    import api.routers.ticker_search as later\n"
        "    a = ts.ticker_search('nv')\n"
        "    b = ticker_search('nv')\n"
        "    c = later.ticker_search('nv')\n"
        "    return a, b, c\n")
    assert len(_router_endpoint_calls(planted, endpoints)) == 3, "the call walk missed a real call"

    safe = ast.parse(
        '"""Never call router.ticker_search in process."""\n'
        "# router.ticker_search(q)\n"
        "import threading\n"
        "from api.routers import discord_interactions as router\n"
        "def h(t):\n"
        "    t.join()\n"                       # a router DOES define an endpoint named `join`
        "    return router.fetch_ticker_choices('nv')\n")   # a plain helper that lives in a router
    assert _router_endpoint_calls(safe, endpoints) == set(), (
        "prose, a comment, an unrelated `.join()` or a plain helper read as an endpoint call — a "
        "rail that fires on the safe case is one nobody will keep")


def test_c05_a_route_function_called_in_process_really_does_hand_back_a_Query_object():
    """THE CLASS ITSELF, demonstrated on the real endpoint, so the guard below is not defended by
    a story. Calling `ticker_search(q)` in process — the exact two-argument shape `fetch_ticker_choices`
    used — leaves FastAPI's `Query()` default sitting in `type`, and `'Query' object has no
    attribute 'strip'` is what 178 autocomplete failures over six days looked like."""
    from api.routers.ticker_search import ticker_search
    sig = inspect.signature(ticker_search)
    leaky = [n for n, p in sig.parameters.items()
             if p.default is not inspect.Parameter.empty
             and type(p.default).__name__ in ("Query", "Path", "Header", "Cookie", "Body", "Form")]
    assert leaky, ("this endpoint no longer carries a `Query()` default, so this demonstration is "
                   "stale — re-point it at an endpoint that does before trusting the guard below")


def test_c05_no_discord_render_module_calls_a_fastapi_route_function_in_process():
    """REGRESSION GUARD (the fix landed: `7d85bed1e` plus the service-function rule, 03 §3.1).

    The class is not "autocomplete broke" — it is "an in-process caller invoked a *route* function,
    so FastAPI's parameter defaults arrived as objects". So the guard is over every endpoint in the
    app, not over `ticker_search`, and over every V2 module plus the interactions service.

    ⛔ A re-introduction in a different way is the point: a new endpoint called from a handler, a
    different router, a different leaked default (`Header()`, `Cookie()`). Each fails here by
    module and name. ⚠️ It deliberately does NOT ban importing a router module — `symbols.py` calls
    `router.fetch_bars` and `commands.py` calls `router.fetch_ticker_choices`, both plain helpers
    that happen to live in a router file. Banning the import would flag the safe case and teach
    everyone to silence the rail.
    """
    endpoints = _route_endpoints_by_module(REPO / "api" / "routers")
    targets = sorted((REPO / "api" / "services" / "discord_render").rglob("*.py"))
    targets.append(REPO / "api" / "services" / "discord_interactions.py")
    assert len(targets) > 10, "the target list is empty — this guard would pass over nothing"

    offenders: dict[str, list[str]] = {}
    for path in targets:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        hits = sorted(_router_endpoint_calls(tree, endpoints))
        if hits:
            offenders[str(path.relative_to(REPO))] = hits
    assert not offenders, (
        f"a FastAPI route function is being called in process: {offenders}. Call the service "
        "function instead — a route function's `Query()`/`Header()` defaults arrive as objects "
        "(C-05: 178 autocomplete failures over six days, swallowed to an empty list).")


# ════════════════════════════════════════════════════════════════════════════
# C-06 — a render that drew nothing costs 40 s of retries, then an unlabelled stand-in
# ════════════════════════════════════════════════════════════════════════════

def test_c06_a_render_that_draws_nothing_is_bounded_by_the_jobs_remaining_time():
    """REGRESSION GUARD (the fix landed: 2.4b adapters, OI-21).

    Half one of the class is the COST: a render that yields nothing used to run a 15 s + 25 s
    ladder — and, measured on the live pod, `discord_chart_house.RENDER_TIMEOUT_S` was 60 s over two
    attempts behind a 15 s deadline. The property that closes it is `min(dependency ceiling, the
    job's remaining time)`, so the test asserts the arithmetic, not the constant 20.

    ⛔ Re-introduced differently — a new retry wrapped around the adapter, a ceiling raised, a
    second attempt added — and the `budget()` assertions below still hold the line, because they
    fix the RELATIONSHIP between the two numbers rather than either number.
    """
    assert renderer_ad.TIMEOUT_S <= 20.0
    assert renderer_ad.ATTEMPTS == 1, (
        "a second renderer attempt re-creates the 105-second overrun in a different shape")
    assert _call.budget(renderer_ad.TIMEOUT_S, remaining_s=3.0) == 3.0, (
        "the dependency ceiling won over the job's remaining time — the OI-21 defect exactly")
    assert _call.budget(renderer_ad.TIMEOUT_S, remaining_s=None) == renderer_ad.TIMEOUT_S

    # …and a call with nothing left does not start at all (it would outlive the member's answer).
    called: list[float] = []
    out = _call.guarded("renderer", lambda t: called.append(t) or PNG,
                        dep_timeout_s=renderer_ad.TIMEOUT_S, remaining_s=0.01)
    assert called == [], "a call with no useful time left was started anyway"
    assert _call.is_result(out) and out.reason() == R.DEADLINE


@pytest.mark.xfail(strict=True, reason=(
    "C-06: the stand-in is still unlabelled. `04-visual-spec.md` §3 requires the label in the "
    "MESSAGE CONTENT (an image label is invisible on a phone thumbnail); `run_chart_job` sends the "
    "bare headline for a `fallback` outcome. Step 2.6/2.7 owns the copy."))
def test_c06_a_delivered_standin_says_so_in_the_message_a_member_reads():
    """XFAIL-STRICT — the fix is 2.6/2.7 and has not landed.

    Half two of the class, and the member-visible half: three stand-ins went out, two never healed,
    and none was labelled, so a member read a lower-quality chart as the product. Reproduced by
    making the house renderer return nothing and reading what the member is actually told.

    ⛔ Would it see a different re-introduction? It asserts on the delivered CONTENT, not on a flag
    or a log line, so a label that exists in the payload but never reaches the message — the exact
    way this would be "fixed" and still be broken — still fails. It accepts any wording that names
    the degradation, so it does not pin copy that 2.7 has not written yet.
    """
    bars = _daily_bars(180)
    edits = Edits()
    out = di.run_chart_job("APP", "TOK", di.ChartRequest("NVDA", "D"),
                           bars_fn=lambda t, tf, n: bars,
                           render_fn=lambda t, tf, b, **k: PNG + b"standin",
                           house_fn=lambda *a, **k: None,          # the house renderer drew nothing
                           edit_fn=edits)
    assert out == "ok" and edits.calls, "no chart was delivered — nothing to judge"
    delivered = [c for c in edits.calls if c.get("png")]
    assert delivered, "no image reached the member"
    said = " ".join(str(c.get("content") or "") for c in delivered).lower()
    assert any(w in said for w in ("simplified", "stand-in", "standin", "unavailable", "degraded")), (
        f"a stand-in was delivered with no label a member can see: {said!r}")


# ════════════════════════════════════════════════════════════════════════════
# C-07 — data or wall clock shown as current when it is not
# ════════════════════════════════════════════════════════════════════════════

def test_c07_a_weekend_daily_bar_is_judged_by_the_SESSION_not_by_its_age():
    """REGRESSION GUARD (the fix landed: 2.4b `freshness.py`, owner ruling R-1).

    The class is "shown as current when it is not" — and its mirror, which the first implementation
    committed: shown as STALE when it is perfectly current. Friday's 16:00 close is the right newest
    bar all weekend; a 26-hour age budget called it stale, and a badge that shows every weekend is a
    badge everybody learns to ignore.

    ⛔ A re-introduction in a different shape — a 48-hour budget, a "2 sessions" budget, an age rule
    quietly applied to daily bars during RTH — is caught because the test asserts the RULE the
    envelope reports (`"session"` vs `"age"`) and asserts `budget_s is None` under it, so no number
    can be smuggled back in. The unknown-vintage case is here for the same reason: `stale=None` must
    never normalise to a cheerful `False`.
    """
    sunday = dt.datetime(2026, 9, 13, 11, 0, tzinfo=ET)          # a Sunday
    env = freshness.envelope("2026-09-11", tf="D", provider="disk", now=sunday)
    assert env.session_state == freshness.WEEKEND
    assert env.rule == "session" and env.budget_s is None, (
        "an age budget outside RTH-intraday is back; Friday's close is 65 h old and fresh")
    assert env.stale is False, "Friday's close called stale on a Sunday — R-1's exact defect"
    assert env.badge is None

    # …and the same clock, with a session genuinely missing, does say so.
    stale = freshness.envelope("2026-09-04", tf="D", provider="disk", now=sunday)
    assert stale.stale is True and stale.badge, "a genuinely missed session no longer badges"

    # …while an RTH intraday bar IS judged by age, because a bar really should arrive per interval.
    rth = dt.datetime(2026, 9, 10, 14, 0, tzinfo=ET)
    assert freshness.envelope(rth - dt.timedelta(minutes=40), tf="5", now=rth).rule == "age"

    # …and an unknown vintage is unknown, never "fine".
    unknown = freshness.envelope(None, tf="D", now=sunday)
    assert unknown.stale is None and unknown.badge is None, (
        "unknown vintage rendered as fresh — the bug the tri-state exists to prevent")


@pytest.mark.xfail(strict=True, reason=(
    "C-07: the house page cannot draw the STALE badge because nothing tells it. 03 §3.8 specifies "
    "`?stale=<as_of>` on `/r/chart`; `discord_chart_house.build_render_url` emits no vintage "
    "parameter, so the image still carries only a wall-clock footer. Step 2.6/2.7."))
def test_c07_the_house_render_url_carries_the_data_vintage_so_the_image_can_say_it_is_stale():
    """XFAIL-STRICT — the member-visible half of C-07 has not landed.

    The forensic evidence for this class is 27 of 85 closed-market cases differing run to run, the
    footer wall clock named as a cause. The structural fix is *vintage, not wall clock*: the page is
    told the data's `as_of` and stamps that. Reproduced at the one seam that decides it — the URL
    the renderer is pointed at.

    ⛔ It asserts that the vintage REACHES the page, not how the page draws it, so a fix that
    stamps the badge from a second source inside the page (a second authority over one value)
    would still fail here — correctly, because that is how the footer and the stats strip came to
    disagree on 2026-08-31.
    """
    from api.services.discord_chart_house import build_render_url
    url = build_render_url("NVDA", "D", {"as_of": "2026-09-11"}, base_url="https://x", token="T",
                           options={"stale": True, "as_of": "2026-09-11"})
    assert "stale=" in url or "as_of=" in url, (
        "the render URL carries no vintage; the page can only stamp the wall clock")


# ════════════════════════════════════════════════════════════════════════════
# C-08 — `/flow` failures misreported, and no time budget
# ════════════════════════════════════════════════════════════════════════════

def test_c08_the_flow_causes_do_not_collapse_into_one_sentence_and_the_budget_fits_the_deadline():
    """REGRESSION GUARD (the fix landed: 2.1a per-class contract + 2.4b flow adapter).

    Nineteen `/flow` failures — 18 timeouts, 1 connection refused, 1 upstream 500 — every one of
    them told the member "The flow feed is reconnecting", which was true of none of them. The class
    is "distinct causes rendered as one sentence", so the test asserts the three MEASURED causes
    reach the member as three different sentences.

    ⚠️ It does not demand four sentences for four reasons: `breaker_open` and `unreachable` are
    deliberately one sentence ("we could not use it"), which is 03 §3.5's table, and a test that
    forbade that would be pinning a design decision it was not written to hold.

    ⛔ A re-introduction by a different route — a new `except` upstream of the mapping, a fifth
    cause added without copy, the mapping quietly defaulting — is caught: `for_reason` raises on an
    unmapped pair (so a new cause fails the suite rather than rendering as a generic apology), and
    the distinctness assertion is over the rendered sentences, not over the class names, so
    renaming classes while leaving one sentence behind them still fails.

    The budget half: web's timeout was 30 s behind a member who had already given up. The property
    is that the ceiling is far inside the deadline AND that the effective ceiling collapses to the
    job's remaining time — the relationship, not either literal.
    """
    measured = {"timed out": R.TIMEOUT, "connection refused": R.UNREACHABLE, "500": R.UPSTREAM_ERROR}
    sentences = {seen: contract.plain(classes.for_reason("flow", r)) for seen, r in measured.items()}
    assert len(set(sentences.values())) == 3, (
        f"the three measured /flow causes render as the same sentence again: {sentences}")
    assert not any("reconnect" in s.lower() for s in sentences.values()), (
        "'the flow feed is reconnecting' is back as the answer to something it does not describe")
    # `breaker_open` shares `unreachable`'s sentence on purpose; it must not share the timeout's.
    assert (contract.plain(classes.for_reason("flow", R.BREAKER_OPEN))
            != contract.plain(classes.for_reason("flow", R.TIMEOUT)))

    with pytest.raises(KeyError):
        classes.for_reason("flow", "a_cause_nobody_wrote_copy_for")

    deadline = Job(corr_id="x", command="flow", app_id="", token="", args={}, label="").deadline_s
    assert flow_ad.TIMEOUT_S <= 10.0 and flow_ad.CONNECT_TIMEOUT_S <= 2.0
    assert flow_ad.TIMEOUT_S < deadline, (
        "the flow ceiling is at or past the job deadline — the member is told it failed while the "
        "call runs on, which is the 30-s-behind-a-15-s-answer shape of C-08")
    assert _call.budget(flow_ad.TIMEOUT_S, remaining_s=4.0) == 4.0

    # …and an EMPTY tape is not a failure. A quiet session is a true answer, and classing it as a
    # failure would put a correct answer in the failure counters (the C-08 mistake, inverted).
    empty = R.ok({"contracts": []}, provider="flow-worker")
    assert empty.ok and empty.reason() is None
    assert classes.flow_empty_is_not_a_failure() == "no significant options flow"


# ════════════════════════════════════════════════════════════════════════════
# C-09 — the warm cycle competes with members for the renderer
# ════════════════════════════════════════════════════════════════════════════

def test_c09_background_work_yields_to_members_in_the_queue_and_is_capped_at_the_renderer(store):
    """REGRESSION GUARD (the fix landed: 2.1 two lanes + 2.3 renderer background slots).

    4,785 over-budget warm cycles in 14 days, ~3,300 renders a day, through the same slots members
    use. The class is "background work is indistinguishable from a member's", so the test asserts
    the two places the distinction has to survive: the queue (a worker takes a background job only
    when the interactive lane is empty) and the wire (a background render is labelled as such, so
    the renderer can cap it).

    ⛔ Re-introduced differently — the warm cycle enqueued on the interactive lane, the priority
    header dropped somewhere in the call chain, the background cap raised to the pool size — and
    the three assertions below each fail separately. Asserting only "there are two lanes" would
    pass on a design where nothing ever uses the second one.
    """
    rt = _runtime(store, {"chart": lambda ctx: "ok"}, queue_max=8, workers=1)
    rt.offer(_job("c09bbbb1", lane=BACKGROUND, user_id=""))
    rt.offer(_job("c09aaaa1", lane=INTERACTIVE, user_id="u1"))
    first = rt._next_job()
    assert first is not None and first.lane == INTERACTIVE, (
        "a warm job was served before a member who was already waiting")

    with ids.bind("abcd1234", background=True):
        assert ids.render_headers().get("X-Render-Priority") == "background", (
            "the renderer cannot tell warm work from a member's chart")
        assert ids.render_headers().get("X-Correlation-Id") == "abcd1234"
    with ids.bind("abcd1234", background=False):
        assert ids.render_headers().get("X-Render-Priority") != "background"

    # …and the renderer holds the line even when the header IS set: a background render takes a
    # background token BEFORE a render slot, so warm work cannot occupy every slot members use.
    import asyncio

    renderer_app = _renderer_module()

    async def probe():
        renderer_app._slots = asyncio.Semaphore(2)
        renderer_app._bg_slots = asyncio.Semaphore(1)
        await asyncio.wait_for(renderer_app._acquire("background"), 0.5)
        with pytest.raises((asyncio.TimeoutError, TimeoutError)):
            await asyncio.wait_for(renderer_app._acquire("background"), 0.05)
        # a member still walks in on the second slot the warm cycle could not take
        await asyncio.wait_for(renderer_app._acquire("interactive"), 0.5)
        renderer_app._release("interactive")
        renderer_app._release("background")

    try:
        asyncio.run(probe())
    finally:
        renderer_app._slots = None
        renderer_app._bg_slots = None


# ════════════════════════════════════════════════════════════════════════════
# C-10 — cold bars storms hold the bars gate for 30 s
# ════════════════════════════════════════════════════════════════════════════

def test_c10_the_bars_hop_is_bounded_and_its_retry_is_jittered_not_a_fixed_wait():
    """REGRESSION GUARD (the fix landed: 2.4b adapters, per-hop timeouts + jitter).

    42 `bars warm gate timed out after 30s` lines. The class is "one slow dependency holds a gate
    long enough to fail the whole job, and every retry lands at the same instant". Both halves are
    asserted: a per-hop ceiling far inside the 30 s gate whose EFFECTIVE value collapses to the
    job's remaining time, and a retry delay that is actually spread.

    ⚠️ The ladder's nominal worst case (8 s × 2 attempts) exceeds the 15 s deadline on paper, and
    asserting otherwise would be pinning the wrong number: what bounds a storm is not the product
    of the constants but `min(ceiling, remaining)` re-evaluated per attempt. That is the property
    under test, because it is the property that holds however many attempts a future change adds.

    ⛔ A different re-introduction — the fixed 1.5 s wait restored under another name, the spread
    collapsed to zero, the ceiling raised back toward 30 s, the remaining-time clamp dropped so a
    hop can outlive the answer — fails here. The jitter half is measured over many draws rather
    than by reading a constant, so a `spread` that is passed but ignored (a parameter nothing
    consumes) still fails.
    """
    deadline = Job(corr_id="x", command="chart", app_id="", token="", args={}, label="").deadline_s
    assert bars_ad.TIMEOUT_S <= 8.0 and bars_ad.ATTEMPTS == 2
    assert bars_ad.TIMEOUT_S < deadline / 1.5, (
        f"the bars hop is back toward the 30 s gate: {bars_ad.TIMEOUT_S}s under a {deadline}s deadline")
    assert _call.budget(bars_ad.TIMEOUT_S, remaining_s=2.0) == 2.0, (
        "a bars attempt can outlive the member's answer — the 30 s gate in a new shape")
    assert _call.budget(bars_ad.TIMEOUT_S, remaining_s=0.0) == 0.0

    draws = {round(breakers.retry_delay(1), 4) for _ in range(200)}
    assert len(draws) > 20, f"the bars retry is not jittered — {len(draws)} distinct delays in 200 draws"
    assert min(draws) >= 0.0 and max(draws) < 1.5, (
        f"the retry spread is unbounded or back to a fixed 1.5 s: {min(draws)}..{max(draws)}")

    # …and the two retry layers must not multiply. `produce_chart._fetch` already loops twice
    # around `bars_fn`, so the V2 wiring passes `attempts=1` (OI-25). Read from the parse tree,
    # never from the text: `attempts=1` also appears in prose in this very repo.
    bindings = ast.parse((REPO / "api" / "services" / "discord_render" / "adapters"
                          / "bindings.py").read_text(encoding="utf-8"))
    passed = [kw.value.value for node in ast.walk(bindings) if isinstance(node, ast.Call)
              for kw in node.keywords
              if kw.arg == "attempts" and isinstance(kw.value, ast.Constant)]
    assert passed and all(v == 1 for v in passed), (
        f"the V2 bars wiring passes attempts={passed}; with `produce_chart`'s own loop that is "
        "four fetches and ~2.9 s of sleeping inside a 15 s deadline (OI-25)")


def test_c10_the_budget_is_re_evaluated_per_attempt_not_once_per_call():
    """✅ WAS XFAIL-STRICT, NOW A REGRESSION GUARD — and the promotion is the mechanism working.

    Lane E measured this gap and could not fix it (it ships no `api/` change), so it marked the
    test `xfail(strict=True)`. The fix landed in `_call.guarded` at integration, the strict marker
    turned the pass into an `XPASS(strict)` **failure**, and that is exactly what it is for: a plain
    red test would have blocked every merge in the queue, and a non-strict xfail would have
    swallowed the fix in silence. Measured after the fix: attempts of 1, 2 and 3 against a 2 s
    budget all spend ~2.0 s, where three attempts previously spent ~6 s.

    The class is "a hop outlives the answer the member was already given". A per-call budget makes
    the ceiling a per-ATTEMPT ceiling, so two attempts behind a 2 s deadline spend 4 s — the same
    arithmetic as the 60-s-over-two-attempts-behind-15-s defect OI-21 closed one layer up, in the
    layer that was built to close it.

    ⛔ It asserts the whole call's wall-clock against the deadline, not the number of attempts, so
    a fix by any route — re-deriving `eff` per attempt, deriving remaining time from a monotonic
    start, capping the retry ladder — flips it. A fix that merely lowers `ATTEMPTS` to 1 does NOT
    flip it, and should not: that hides the arithmetic behind a constant somebody will raise again.
    """
    deadline_s = 2.0
    t0 = time.perf_counter()
    out = _call.guarded("bars", lambda timeout_s: time.sleep(30), dep_timeout_s=8.0,
                        remaining_s=deadline_s, attempts=2, sleep=lambda _s: None)
    elapsed = time.perf_counter() - t0
    assert _call.is_result(out) and out.reason() == R.TIMEOUT
    assert elapsed <= deadline_s + 0.5, (
        f"a 2-attempt hop spent {elapsed:.1f}s against a {deadline_s:.0f}s remaining budget — the "
        "member was answered at the deadline and the call ran on past it")


# ════════════════════════════════════════════════════════════════════════════
# C-11 — a delivery failure or crash ends with nothing said
# ════════════════════════════════════════════════════════════════════════════

def test_c11_a_handler_that_crashes_still_ends_in_a_terminal_row_and_a_message_the_member_reads(store):
    """REGRESSION GUARD (the fix landed: 2.1 runtime terminal-state guarantee, S3/S7).

    23 `10015` finals and 23 `ATTACHMENT_NOT_FOUND` finals produced no member message at all, and
    the crash path edited nothing (0 `job crashed` lines — not because it never happened, but
    because it leaves no trace by construction). The class is "the job ends and nobody is told".

    ⛔ It is written over the *worst* handler, one that raises, rather than over a handler that
    reports a failure politely — so a re-introduction where some new early-exit path forgets to
    report is caught too, because the guarantee under test is the runtime's, not the handler's.
    The row assertion and the message assertion are separate: a design that records `abandoned`
    correctly but says nothing, and a design that says something but leaves the row non-terminal
    (S7's "0 non-terminal at 60 s"), each fail on their own line.
    """
    delivery = FakeDelivery()

    def boom(ctx):
        raise RuntimeError("upstream exploded")

    rt = _runtime(store, {"chart": boom}, delivery=delivery)
    job = _job("c11aaaa1")
    summary = rt.run_job(job)

    assert summary["state"] in ("messaged", "abandoned")
    row = store.get(job.corr_id)
    assert row["state"] in ("delivered", "messaged", "abandoned"), "the row is not terminal (S7)"
    assert row["failure_class"] == "internal"

    said = delivery.contents()
    assert said, "the handler crashed and the member was told nothing — C-11 exactly"
    assert job.corr_id in said, "the message carries no id, so the member cannot report it"
    assert "RuntimeError" not in said and "exploded" not in said, (
        "the exception text reached a member (03 §3.5: no stack trace, exception text or URL)")


# ════════════════════════════════════════════════════════════════════════════
# C-12 — failures cannot be tied to a command, symbol, member or request
# ════════════════════════════════════════════════════════════════════════════

def test_c12_a_failure_is_tied_to_its_command_symbol_member_and_request(store, caplog):
    """REGRESSION GUARD (the fix landed: 2.2 correlation ids + structured events + jobs table).

    Finding #1: 122 `edit_original HTTP` lines, **0** carrying a ticker. The class is "the record
    of a failure cannot be joined to what a member asked for".

    ⛔ It asserts the join on BOTH sides, because they fail independently: the durable row (which
    survives the 8-minute pod) and the log line (which is what a Railway search reaches). A test
    that only read the row would pass on a design whose logs are still anonymous, and vice versa.
    The searchable-token assertion is here because a bracketed prefix is unmatchable in Railway's
    search — measured — so a correctly-structured line nobody can find is still C-12.
    """
    delivery = FakeDelivery()
    rt = _runtime(store, {"chart": lambda ctx: ctx.fail("data_unavailable", "bars empty") and "fail"},
                  delivery=delivery)
    job = _job("c12aaaa1", user_id="member-77", args={"ticker": "AXTI", "tf": "30"})

    with caplog.at_level(logging.INFO, logger="discord_render"):
        rt.run_job(job)

    row = store.get(job.corr_id)
    assert row["user_id"] == "member-77" and row["command"] == "chart"
    assert "AXTI" in (row["args_json"] or ""), "the row cannot say which symbol failed"
    assert row["failure_class"] == "data_unavailable"
    assert row["interaction_id"] == job.interaction_id

    lines = [r.getMessage() for r in caplog.records if r.name == "discord_render"]
    assert lines, "the job produced no structured event at all"
    assert all(line.startswith(observe.EVENT_TOKEN) for line in lines), (
        "an event line lost its searchable token; a bracketed prefix cannot be matched by Railway "
        "log search (measured) and the line becomes unfindable")
    assert any(job.corr_id in line and '"cmd":"chart"' in line for line in lines), (
        "no event ties the correlation id to the command")

    evt = observe.event("render", cid=job.corr_id, cmd="chart", sym="AXTI", tf="30")
    assert evt["cid"] == job.corr_id and evt["sym"] == "AXTI" and evt["tf"] == "30"


# ════════════════════════════════════════════════════════════════════════════
# C-13 — a credential in logs
# ════════════════════════════════════════════════════════════════════════════

def test_c13_a_playwright_call_log_carrying_the_render_token_is_scrubbed_before_it_is_logged():
    """REGRESSION GUARD (the fix landed: 2.3 renderer log hygiene, unconditional).

    142 renderer call logs printed the full navigation URL, token included, on every `Page.goto`
    timeout. The class is "a credential reaches a log", and the mechanism is that the credential
    arrives inside somebody ELSE's error text — which is why an audit of our own log calls could
    never have found it.

    ⛔ A re-introduction in a different shape is what the second half covers: a `secret=`, a
    `key=`, a token in an ordinary query string on a different upstream. The scrub is asserted as a
    property over several spellings, and the control asserts it is not simply deleting everything —
    a scrubber that returned "" would pass a naive "the token is absent" check.
    """
    _r = _renderer_module()
    scrub, url_path = _r.scrub, _r.url_path
    from api.services.discord_render.observe import scrub as observe_scrub

    playwright_error = (
        "TimeoutError: Page.goto: Timeout 21000ms exceeded.\n"
        "=========================== logs ===========================\n"
        'navigating to "https://uctintelligence.com/r/chart?sym=IOT&tf=D&token=s3cr3t-RENDER-TOKEN"\n'
        "============================================================")
    cleaned = scrub(playwright_error)
    assert "s3cr3t-RENDER-TOKEN" not in cleaned and "token=" not in cleaned
    assert "Timeout 21000ms" in cleaned, "the scrubber ate the diagnosis along with the secret"
    assert url_path("https://x/r/chart?sym=IOT&token=s3cr3t") == "/r/chart"

    for spelling in ("?secret=abc", "&key=abc", "?sig=abc", "&signature=abc", "?token=abc"):
        assert "abc" not in scrub(f"failed https://x/r/chart{spelling}"), spelling

    assert "s3cr3t" not in observe_scrub("edit failed https://discord.com/x?token=s3cr3t"), (
        "the web side logs the secret the renderer no longer does")


# ════════════════════════════════════════════════════════════════════════════
# C-14 — `/flow` queries the wrong partition: ETFs report no flow
# ════════════════════════════════════════════════════════════════════════════

def test_c14_flow_for_an_index_or_etf_underlying_reads_the_etfs_partition():
    """REGRESSION GUARD (the fix landed: 2.4a `symbols.flow_source`, V2 path).

    Not an error — a confident, wrong answer. `/flow SPY` said "no significant options flow" while
    182 contracts sat under `source=etfs`; QQQ 0/136, SMH 0/83. No log line exists for it, because
    the reply is a normal text edit, which is why this class can only ever be caught by a test.

    ⛔ Re-introduced differently? The resolver is asked about the whole production class table
    (index underlyings AND ETFs AND ordinary stocks), so a fix that special-cases SPY, or one that
    sends everything to `etfs` and breaks single names in the other direction, both fail. The
    negative cases are the load-bearing half: a rule that cannot say `stocks` is not a rule.
    """
    for sym in ("SPY", "QQQ", "SMH", "IWM"):
        assert symbols.flow_source(sym) == "etfs", f"{sym} would report no flow again"
    for sym in ("NVDA", "AAPL", "AXTI"):
        assert symbols.flow_source(sym) == "stocks", (
            f"{sym} routed to the ETF partition — the same defect pointing the other way")


# ── local fixtures ──────────────────────────────────────────────────────────

def _daily_bars(n: int = 180) -> list[dict]:
    day = dt.date(2026, 1, 2)
    out = []
    px = 100.0
    for i in range(n):
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        o = px
        c = px * (1 + ((i % 7) - 3) / 100.0)
        out.append({"t": day.isoformat(), "o": o, "h": max(o, c) * 1.01,
                    "l": min(o, c) * 0.99, "c": c, "v": 1_000_000 + i})
        px = c
        day += dt.timedelta(days=1)
    return out
