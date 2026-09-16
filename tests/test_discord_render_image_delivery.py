"""OI-29 — the chart IMAGE goes through the delivery layer, and C-04 is closed by construction.

⛔⛔ WHY THIS FILE EXISTS AND WHY IT IS SEPARATE FROM `test_discord_render_delivery.py`.
Step 2.6 built `delivery.py` and hardened the text PATCH: budget, retry, 429/5xx policy, a class
table, pre-flight component validation. **Every byte of `01-failure-forensics.md`'s evidence for
this class is on the IMAGE patch** — 23 `ATTACHMENT_NOT_FOUND` refusals and 23 `10015` finals, all
multipart chart edits built by `discord_interactions.edit_original` with its own client, its own
4xx handling and no retry policy at all. A hardening layer is only as wide as the call sites routed
through it, and "2.6 is done" was true of the module and false of the class (owner ruling OI-29).

⭐ THE LOAD-BEARING TEST IN HERE IS `test_c04_*`, AND IT IS WRITTEN AS A *DIFFERENTIAL*. The same
fake Discord — one that refuses any PATCH declaring an attachment id it is not being handed the
bytes for, which is exactly what the real 400 says — is driven twice: once through the pre-V2 shape
(reproduces the 23 failures) and once through the V2 path (does not). A test that only ran the
fixed path would pass just as happily against a fake Discord that refuses nothing, and would be
evidence of nothing at all.
"""
from __future__ import annotations

import json

import pytest

from api.services.discord_render import delivery
from api.services.discord_render.adapters import bindings

PNG = b"\x89PNG\r\n\x1a\n" + b"chart-bytes"


# ── a Discord that behaves the way the forensics say it behaved ─────────────

class Resp:
    def __init__(self, status: int, body=None, headers=None):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body) if body is not None else ""
        self.headers = headers or {}

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


ATTACHMENT_400 = {"code": 50035, "errors": {"attachments": {"0": {"_errors": [
    {"code": "ATTACHMENT_NOT_FOUND", "message": "Attachment data not found"}]}}}}
UNKNOWN_WEBHOOK_404 = {"code": 10015, "message": "Unknown Webhook"}


class FakeDiscord:
    """Records every request and answers the way the tape says Discord answered.

    ⛔ THE REFUSAL RULE IS THE MEASURED ONE, NOT A CONVENIENT ONE: a PATCH that declares
    `attachments[i]` without a `files[i]` part in the SAME request is refused with the real 50035 /
    ATTACHMENT_NOT_FOUND body. That is the only rule that makes the differential meaningful — it is
    what `01` §E observed, and it is what the fold is designed to make unreachable."""

    def __init__(self, *, script=None, strict_attachments=True):
        self.requests: list[dict] = []
        self.script = list(script or [])
        self.strict = strict_attachments
        self.closed = False

    # httpx.Client surface -------------------------------------------------
    def __call__(self, *a, **kw):        # httpx.Client(timeout=…)
        return self

    def close(self):
        self.closed = True

    def patch(self, url, **kw):
        return self._record("patch", url, **kw)

    def post(self, url, **kw):
        return self._record("post", url, **kw)

    def _record(self, method, url, *, data=None, files=None, json=None, content=None,
                headers=None, timeout=None):
        payload = None
        if data and "payload_json" in data:
            payload = _loads(data["payload_json"])
        elif content is not None:
            payload = _loads(content)
        elif json is not None:
            payload = json
        rec = {"method": method, "url": url, "payload": payload or {},
               "files": dict(files or {}), "headers": dict(headers or {}), "timeout": timeout}
        self.requests.append(rec)
        if self.script:
            return self.script.pop(0)
        if self.strict and _declares_an_id_it_is_not_uploading(rec):
            return Resp(400, ATTACHMENT_400)
        return Resp(200, {"id": "m1", "attachments": [
            {"id": i, "filename": f"f{i}.png"} for i in range(len(rec["files"]))]})


def _loads(raw):
    try:
        return json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _declares_an_id_it_is_not_uploading(rec: dict) -> bool:
    declared = [a.get("id") for a in (rec["payload"].get("attachments") or [])]
    uploaded = {int(k[len("files["):-1]) for k in rec["files"] if k.startswith("files[")}
    return any(str(d) not in {str(u) for u in uploaded} for d in declared)


@pytest.fixture(autouse=True)
def _fake_httpx(monkeypatch):
    """Replace `httpx.Client` for the whole module.

    ⛔ NOT a stub of `delivery.edit_image`. Stubbing the function under test would leave the
    multipart body — the thing that actually decides whether Discord refuses — unexercised, and
    that body is the entire subject of this file."""
    import httpx
    fake = FakeDiscord()
    monkeypatch.setattr(httpx, "Client", fake)
    monkeypatch.setattr(bindings._LOCAL, "delivery_failure", None, raising=False)
    return fake


@pytest.fixture(autouse=True)
def _adapters_on(monkeypatch):
    monkeypatch.setenv("DISCORD_RENDER_V2_ADAPTERS_ENABLED", "1")


# ── a context the bindings can bind to ──────────────────────────────────────

class Job:
    corr_id = "c0ffee01"
    command = "chart"


class Ctx:
    """The `JobContext` surface `bindings.edit_fn` uses, and nothing more."""

    def __init__(self, budget_s: float = 12.0):
        self.job = Job()
        self._budget = budget_s
        self.edits: list[dict] = []

    def remaining_s(self):
        return self._budget

    def edit(self, app_id, token, **kw):
        self.edits.append(kw)
        return bindings.delivery_edit_fn()(app_id, token, **kw)


# ════════════════════════════════════════════════════════════════════════════
# C-04 — the class the programme was opened for
# ════════════════════════════════════════════════════════════════════════════

def _two_patch_sequence(edit, *, sent_first=None):
    """The exact shape `run_chart_job` produces: the image PATCH, then the context line.

    `_context_follow_up` reads the attachment ids off the FIRST edit's response and re-declares
    them on the SECOND, carrying no file bytes. That second request is C-04."""
    sent = edit("APP", "TOK", content="NVDA · Daily", png=PNG, filename="NVDA_D.png")
    reply = sent if isinstance(sent, dict) else (sent_first or {})
    keep = [a.get("id") for a in (reply.get("attachments") or []) if a.get("id") is not None]
    kw = {"keep_attachments": keep} if keep else {}
    edit("APP", "TOK", content="NVDA · Daily\nEarnings in 4 days · IM 6.2%", **kw)
    return sent


def test_c04_the_prev2_two_patch_sequence_still_reproduces_the_measured_400(_fake_httpx):
    """THE CONTROL. Without it the test below proves nothing.

    ⛔ A differential needs a leg that FAILS. `01` §E measured 23 double-failed
    ATTACHMENT_NOT_FOUND edits and named exactly one code path capable of producing them; if this
    leg came back clean, the fake Discord would be refusing nothing and the V2 leg's success would
    be a statement about the fixture, not about the fix."""
    from api.services import discord_interactions as di
    di.edit_original("APP", "TOK", content="NVDA · Daily", png=PNG, filename="NVDA_D.png")
    di.edit_original("APP", "TOK", content="NVDA · Daily\nEarnings in 4 days", keep_attachments=[0])

    second = _fake_httpx.requests[1]
    assert _declares_an_id_it_is_not_uploading(second), (
        "the pre-V2 follow-up no longer re-declares ids — if that is deliberate the differential "
        "below is measuring nothing and this control must be re-aimed, not deleted")
    refused = [r for r in _fake_httpx.requests if _declares_an_id_it_is_not_uploading(r)]
    assert refused, "the fixture refused nothing; it cannot witness the class"


def test_c04_the_v2_path_never_declares_an_attachment_id_it_is_not_uploading(_fake_httpx):
    """THE CLOSURE. Same fake Discord, same two-PATCH sequence, through the V2 wrapper.

    ⛔ THE ASSERTION IS THE INVARIANT, NOT THE 400. "No request declares an id without the bytes"
    is a property of every request the job makes, so a NEW second edit added later for some other
    reason — a footer, a badge, a late stats strip — that re-declares ids fails here too. Asserting
    "no 400 came back" would instead pass the day somebody made the fixture lenient."""
    ctx = Ctx()
    edit = bindings.edit_fn(ctx)
    _two_patch_sequence(edit)

    assert len(_fake_httpx.requests) == 2, "the job made a different number of edits than expected"
    for i, rec in enumerate(_fake_httpx.requests):
        assert not _declares_an_id_it_is_not_uploading(rec), (
            f"edit {i} re-declared an attachment id without uploading it — C-04 is back")
    assert all(r["files"] for r in _fake_httpx.requests), (
        "the context edit dropped the chart instead of re-uploading it")
    assert "Earnings in 4 days" in _fake_httpx.requests[1]["payload"]["content"]


def test_c04_every_edit_in_the_sequence_is_accepted_by_the_discord_that_refused_the_old_one(_fake_httpx):
    """The member-visible half: the chart AND its context line both land."""
    ctx = Ctx()
    sent = _two_patch_sequence(bindings.edit_fn(ctx))
    assert sent, "the image PATCH failed"
    assert bindings.last_delivery_failure() is None, "a delivery failed on the fixed path"


def test_the_fold_is_recorded_when_it_cannot_happen_rather_than_silently_skipped(_fake_httpx, monkeypatch):
    """⛔ A FOLD THAT QUIETLY DID NOTHING IS C-04 BACK WITH NO EVIDENCE THAT IT RETURNED.

    The bytes are held on the context; a context that never delivered an image has none. That case
    must pass the ids through AND say so, because the alternative — dropping them — would make a
    text edit silently delete the chart (`attachments_payload`'s own ⛔)."""
    events: list[tuple] = []
    monkeypatch.setattr(bindings.observe, "event", lambda name, **kw: events.append((name, kw)))
    ctx = Ctx()
    bindings.edit_fn(ctx)("APP", "TOK", content="just text", keep_attachments=[0])
    assert any(n == "fold_unavailable" for n, _ in events), "the skipped fold left no trace"
    assert _fake_httpx.requests[0]["payload"]["attachments"] == [{"id": "0"}]


def test_an_image_too_large_to_fold_is_named_and_not_held(_fake_httpx, monkeypatch):
    events: list[tuple] = []
    monkeypatch.setattr(bindings.observe, "event", lambda name, **kw: events.append((name, kw)))
    monkeypatch.setattr(bindings, "FOLD_MAX_BYTES", 16)
    ctx = Ctx()
    edit = bindings.edit_fn(ctx)
    edit("APP", "TOK", content="NVDA", png=b"x" * 64, filename="a.png")
    assert any(n == "fold_skipped_too_large" for n, _ in events)
    assert getattr(ctx, bindings._IMAGES, "unset") is None


# ════════════════════════════════════════════════════════════════════════════
# the image PATCH now has the text path's policy
# ════════════════════════════════════════════════════════════════════════════

def test_the_image_patch_is_multipart_and_does_not_set_its_own_content_type(_fake_httpx):
    """⛔ THE BOUNDARY IS HTTPX'S TO WRITE. A hand-written `multipart/form-data` header omits the
    boundary parameter and Discord answers 400 on a body that is otherwise perfectly correct —
    a failure that reads exactly like a payload fault."""
    delivery.edit_image("APP", "TOK", content="x", images=[(PNG, "a.png")])
    rec = _fake_httpx.requests[0]
    assert rec["files"] == {"files[0]": ("a.png", PNG, "image/png")}
    assert "Content-Type" not in rec["headers"]
    assert rec["payload"]["attachments"] == [{"id": 0, "filename": "a.png"}]


def test_a_server_error_on_the_image_patch_is_retried_within_the_budget(_fake_httpx):
    _fake_httpx.script = [Resp(500, {"message": "oops"}), Resp(200, {"id": "m1", "attachments": []})]
    res = delivery.edit_image("APP", "TOK", content="x", images=[(PNG, "a.png")],
                              deadline_s=5.0, sleep=lambda s: None)
    assert res.ok and res.attempts == 2, "the image PATCH did not inherit the retry policy"
    assert all(r["files"] for r in _fake_httpx.requests), "the retry dropped the file"


def test_a_429_on_the_image_patch_honours_discords_own_wait(_fake_httpx):
    slept: list[float] = []
    _fake_httpx.script = [Resp(429, {"retry_after": 0.4}, {"Retry-After": "0.4"}),
                          Resp(200, {"id": "m1", "attachments": []})]
    res = delivery.edit_image("APP", "TOK", content="x", images=[(PNG, "a.png")],
                              deadline_s=5.0, sleep=slept.append, rand=lambda: 0.0)
    assert res.ok and slept and slept[0] >= 0.4


def test_a_dead_token_is_not_followed_by_a_second_attempt_or_a_text_fallback(_fake_httpx):
    """⛔ 10015 IS TERMINAL AND SO IS ITS FALLBACK. `01` §C measured 23 of these. Retrying a dead
    interaction token spends the job's remaining budget to be told the same thing, and sending the
    text version through the same dead token spends one more."""
    _fake_httpx.script = [Resp(404, UNKNOWN_WEBHOOK_404)]
    res = delivery.edit_image("APP", "TOK", content="x", images=[(PNG, "a.png")], deadline_s=5.0)
    assert not res.ok and res.token_dead and res.attempts == 1
    assert len(_fake_httpx.requests) == 1, "a dead token was spoken to twice"


def test_an_oversize_image_is_refused_before_the_round_trip_and_the_member_is_still_told(_fake_httpx):
    big = b"x" * (delivery.ATTACHMENT_MAX_BYTES + 1)
    res = delivery.edit_image("APP", "TOK", content="NVDA · Daily", images=[(big, "a.png")])
    assert not any(r["files"] for r in _fake_httpx.requests), "the oversize upload was attempted"
    assert len(_fake_httpx.requests) == 1
    assert delivery.NO_IMAGE_NOTE in _fake_httpx.requests[0]["payload"]["content"]
    assert res.reason == delivery.TOO_LARGE and "image" in res.dropped


def test_a_refused_image_still_ends_in_a_sentence(_fake_httpx):
    """C-11: 46 measured failures produced no member message at all."""
    _fake_httpx.script = [Resp(403, {"code": 50013, "message": "Missing Permissions"}),
                          Resp(200, {"id": "m1"})]
    res = delivery.edit_image("APP", "TOK", content="NVDA · Daily", images=[(PNG, "a.png")])
    assert len(_fake_httpx.requests) == 2
    assert delivery.NO_IMAGE_NOTE in _fake_httpx.requests[1]["payload"]["content"]
    assert res.ok is True and res.reason == delivery.FORBIDDEN and "image" in res.dropped


def test_the_note_survives_a_full_length_reply_and_the_content_is_what_gets_trimmed():
    out = delivery._no_image_text("A" * 2000)
    assert out.endswith(delivery.NO_IMAGE_NOTE) and len(out) <= 2000


def test_a_2xx_with_an_unreadable_body_is_a_success_not_a_failed_delivery(_fake_httpx):
    """⛔ `res.message or True`. Returning `res.message` would hand `JobContext.edit` a `None` for
    a chart that arrived, and the member would get a failure sentence under their own chart."""
    _fake_httpx.script = [Resp(204, None)]
    out = bindings.delivery_edit_fn()("APP", "TOK", content="x", png=PNG, filename="a.png")
    assert out is True


def test_the_kill_switch_routes_back_to_the_raw_function_and_is_read_per_call(monkeypatch, _fake_httpx):
    """⛔ READ PER CALL. `get_runtime()` builds one runtime and keeps it for the life of the pod;
    a switch captured at construction makes `DISCORD_RENDER_V2_ADAPTERS_ENABLED=0` a lie."""
    from api.services import discord_interactions as di
    seen: list[dict] = []
    monkeypatch.setattr(di, "edit_original", lambda *a, **kw: seen.append(kw) or {"id": "raw"})
    fn = bindings.delivery_edit_fn()                      # built while the switch is ON
    monkeypatch.setenv("DISCORD_RENDER_V2_ADAPTERS_ENABLED", "0")
    assert fn("APP", "TOK", content="x", png=PNG, filename="a.png") == {"id": "raw"}
    assert seen and not _fake_httpx.requests, "the kill switch did not reach the delivery layer"


def test_a_failed_image_delivery_is_readable_by_the_runtime_that_has_to_explain_it(_fake_httpx):
    """Since OI-29 the image failure is a `DeliveryResult`, not a `di` record — so
    `commands._last_edit_failure` has to ask the delivery layer first or answer `None` forever."""
    from api.services.discord_render import commands
    _fake_httpx.script = [Resp(404, UNKNOWN_WEBHOOK_404), Resp(404, UNKNOWN_WEBHOOK_404)]
    out = bindings.delivery_edit_fn()("APP", "TOK", content="x", png=PNG, filename="a.png")
    assert out is False
    res = commands._last_edit_failure()
    assert res is not None and res.token_dead and res.cls == "ack_late"


def test_one_members_delivery_failure_never_lands_on_another_members_job(_fake_httpx):
    """⛔ THE FAILURE SLOT IS PER-THREAD, AND A SINGLE-THREADED TEST CANNOT SEE THAT.

    The runtime runs jobs on a worker pool. A shared slot would make `_last_edit_failure()` answer
    with whichever job failed most recently anywhere in the process — so a member whose chart
    arrived would be told about a stranger's dead token. That is C-12 (a failure that cannot be
    tied to a request) manufactured by the fix for C-04, and it passes every assertion in this file
    that runs on one thread. Found by mutation M19, which was GREEN until this test existed.
    """
    import threading

    edit = bindings.delivery_edit_fn()
    failed_b = threading.Event()
    read_a: list = []
    ready_a = threading.Event()

    def thread_a():
        edit("APP", "TOK-A", content="a", png=PNG, filename="a.png")   # succeeds
        ready_a.set()
        failed_b.wait(timeout=5)
        read_a.append(bindings.last_delivery_failure())

    def thread_b():
        ready_a.wait(timeout=5)
        _fake_httpx.script = [Resp(404, UNKNOWN_WEBHOOK_404), Resp(404, UNKNOWN_WEBHOOK_404)]
        edit("APP", "TOK-B", content="b", png=PNG, filename="b.png")   # fails
        assert bindings.last_delivery_failure() is not None, "B lost its own failure"
        failed_b.set()

    a = threading.Thread(target=thread_a, name="job-a")
    b = threading.Thread(target=thread_b, name="job-b")
    a.start(); b.start(); a.join(timeout=10); b.join(timeout=10)

    assert read_a == [None], (
        "job A was handed job B's delivery failure — the slot is shared across threads")


def test_the_v2_runtime_is_actually_handed_the_delivery_backed_edit(_fake_httpx):
    """⛔ BUILT, TESTED, GREEN AND WIRED TO NOTHING is this repo's most-repeated defect, and every
    behavioural test in this file passes while `get_runtime()` still hands the runtime the raw
    `di.edit_original`. Found by mutation M20, which was GREEN until this test existed.

    ⭐ AN AST, NEVER A GREP. A substring check would match this docstring, and a comment saying the
    wiring is there is a record that nobody wired it."""
    import ast
    import pathlib

    src = pathlib.Path("api/services/discord_render/commands.py").read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "get_runtime")
    call = next(n for n in ast.walk(fn)
                if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "JobRuntime")
    edit_kw = next(k for k in call.keywords if k.arg == "edit_fn")
    assert isinstance(edit_kw.value, ast.Call), (
        "get_runtime passes a bare name as edit_fn; the delivery-backed edit is not wired")
    assert getattr(edit_kw.value.func, "id", None) == "delivery_edit_fn", (
        f"get_runtime wires {ast.dump(edit_kw.value)[:80]} as edit_fn, not delivery_edit_fn — "
        "the image PATCH is back outside the delivery layer and OI-29 is undone")

    # ⛔ NON-VACUITY: prove the probe can see a different answer, or it passes by finding nothing.
    other = src.replace("edit_fn=delivery_edit_fn()", "edit_fn=di.edit_original")
    fn2 = next(n for n in ast.walk(ast.parse(other))
               if isinstance(n, ast.FunctionDef) and n.name == "get_runtime")
    call2 = next(n for n in ast.walk(fn2)
                 if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "JobRuntime")
    assert not isinstance(next(k for k in call2.keywords if k.arg == "edit_fn").value, ast.Call), (
        "the probe reports the same answer for the wired and the unwired form")


def test_the_multi_chart_path_uploads_every_image_and_declares_exactly_those_ids(_fake_httpx):
    ctx = Ctx()
    bindings.edit_fn(ctx)("APP", "TOK", content="4 charts",
                          pngs=[(PNG, "a.png"), (PNG + b"2", "b.png")])
    rec = _fake_httpx.requests[0]
    assert sorted(rec["files"]) == ["files[0]", "files[1]"]
    assert rec["payload"]["attachments"] == [{"id": 0, "filename": "a.png"},
                                             {"id": 1, "filename": "b.png"}]
    assert not _declares_an_id_it_is_not_uploading(rec)
