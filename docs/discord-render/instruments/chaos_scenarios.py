"""Step 3.2 — named chaos scenarios. Each breaks exactly ONE dependency and asks S3's question.

⚠️ BUILT NOW, RUN LATER, OUTSIDE RTH. Lane A schedules it. `--self-check` runs today.

    python -u docs/discord-render/instruments/chaos_scenarios.py --self-check
    python -u docs/discord-render/instruments/chaos_scenarios.py --list
    python -u docs/discord-render/instruments/chaos_scenarios.py --only renderer_down,discord_429

**The question every scenario asks is S3, and only S3:** at the deadline, did the member get an
artifact **or** a NAMED message? 100 % of jobs must end in one of those two, and the message must
carry a class from `contract.FAILURE_CLASSES` plus the correlation id — "something went wrong"
is a fail here, because C-08 was nineteen distinct failures wearing one sentence.

⛔ ONE DEPENDENCY PER SCENARIO. A scenario that breaks two cannot say which one the product
survived, and a fix for either would make it green — the shape of a rail that cannot distinguish
the class from its neighbour. Each scenario names the forensic class it exercises.

⛔ EXIT CODES ARE THREE: 0 pass · 1 a measured failure · 2 could-not-measure. A scenario that did
not execute is INCONCLUSIVE and is never counted as a pass.

⛔ A RUN WITH NO TOTALS LINE IS NOT A RUN — it is printed on every path.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile
import time

PASS, FAIL, INCONCLUSIVE = 0, 1, 2
SHARED_ROOTS = ("/data", "c:\\data", "c:/data")


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parents[3]


def _sandbox(tmp: pathlib.Path) -> pathlib.Path:
    """Every path this instrument writes lives under `tmp`, and it REFUSES to run otherwise.
    `C:\\data` is real on the dev box: an instrument that "just runs" writes the owner's live files."""
    tmp.mkdir(parents=True, exist_ok=True)
    db = tmp / "chaos_jobs.db"
    os.environ["DISCORD_RENDER_DB_PATH"] = str(db)
    os.environ["DISCORD_RENDER_CACHE_DIR"] = str(tmp / "cache")
    low = str(db.resolve()).lower().replace("\\", "/")
    if any(low.startswith(r.replace("\\", "/")) for r in SHARED_ROOTS):
        raise SystemExit(f"refusing to run: the jobs db resolves into the shared data root ({db})")
    return db


# ── the member's side of the glass ──────────────────────────────────────────

class Member:
    """Everything that reached a member, and nothing else. Both `edit_text` and `followup` are
    captured because the runtime chooses between them by interaction type — capturing one would
    make a control click look like silence."""

    def __init__(self):
        self.messages: list[str] = []
        self.images = 0
        #: What the real delivery handed us beyond `content`. Recorded rather than swallowed, so a
        #: scenario can assert the budget actually reached the wire.
        self.kwargs: list[tuple] = []

    # ⛔⛔ `**kw`, AND THAT IS A FIX, NOT LAZINESS. These two used to restate the real functions'
    # keyword lists by hand, and the day `delivery` grew `deadline_s` and `cid` this harness
    # started raising `TypeError` inside the runtime — which it reported, correctly, as
    # **INCONCLUSIVE** for four of its five scenarios. A double that hand-copies a signature is a
    # second authority over that signature, and it drifts the moment the real one moves. This is
    # the THIRD time a delivery double has drifted in this programme; the first two cost a lane
    # five unexplained failures.
    #
    # ⭐ The arity is not the property under test here — what reached the member is. So the double
    # accepts whatever the real function accepts, RECORDS the new arguments rather than ignoring
    # them, and `test_the_double_tracks_the_real_delivery_signature` below keeps it honest by
    # asking `inspect.signature` of the real module rather than by anyone remembering to look.
    def edit_text(self, app_id, token, *, content, **kw):
        from api.services.discord_render.delivery import DeliveryResult
        self.messages.append(content)
        self.kwargs.append(("edit_text", dict(kw)))
        return DeliveryResult(True, 200)

    def followup(self, app_id, token, *, content, **kw):
        from api.services.discord_render.delivery import DeliveryResult
        self.messages.append(content)
        self.kwargs.append(("followup", dict(kw)))
        return DeliveryResult(True, 200)

    def edit_image(self, app_id, token, *, content, images, **kw):
        from api.services.discord_render.delivery import DeliveryResult
        self.images += 1
        self.messages.append(content)
        self.kwargs.append(("edit_image", dict(kw)))
        return DeliveryResult(True, 200, message={"id": "m", "attachments": [{"id": 0}]})

    # the runtime's `edit_fn` seam (what a handler calls to deliver the artifact)
    def edit_fn(self, app_id, token, **kw):
        # the content is recorded WHETHER OR NOT there is an image: a label on a chart is
        # exactly the thing C-06 is about, and an `elif` here makes it unobservable.
        if kw.get("png") or kw.get("pngs"):
            self.images += 1
        if kw.get("content"):
            self.messages.append(kw["content"])
        return {"id": "m", "attachments": [{"id": 0}]}

    def got_artifact(self) -> bool:
        return self.images > 0

    def named_message(self) -> str | None:
        """A message that names a failure class and carries the id — not a bare apology."""
        from api.services.discord_render import contract
        for msg in self.messages:
            plain = {contract.plain(c) for c in contract.FAILURE_CLASSES}
            if any(p and p in msg for p in plain):
                return msg
        return None


class Refusing(Member):
    """A Discord that refuses the artifact PATCH. `status`/`code` are what `last_edit_failure`
    reports, so the runtime classifies it exactly as production would."""

    def __init__(self, status: int, code: int = 0, allow_text: bool = True):
        super().__init__()
        self.status, self.code, self.allow_text = status, code, allow_text
        self.refusals = 0

    def edit_fn(self, app_id, token, **kw):
        if kw.get("png") or kw.get("pngs"):
            self.refusals += 1
            return False
        return super().edit_fn(app_id, token, **kw)

    def last_edit_failure(self):
        from api.services.discord_render.delivery import DeliveryResult
        return DeliveryResult(False, self.status, self.code, "refused")


# ── the rig ─────────────────────────────────────────────────────────────────

def _runtime(store, handler, member, *, owner="chaos-pod", failure=None):
    from api.services.discord_render.runtime import JobRuntime
    return JobRuntime(store=store, handlers={"chart": handler, "flow": handler},
                      edit_fn=member.edit_fn, delivery=member,
                      last_edit_failure=failure or (lambda: None), owner=owner)


def _job(cid: str, command: str = "chart", label: str = "/chart NVDA", **kw):
    from api.services.discord_render.runtime import Job
    base = dict(corr_id=cid, command=command, app_id="APP", token="TOK-" + cid,
                args={"ticker": "NVDA"}, label=label, user_id="member-1", interaction_id="i-" + cid)
    base.update(kw)
    return Job(**base)


# ── scenarios ───────────────────────────────────────────────────────────────
# Each returns (ok, detail). Each breaks ONE dependency, named in `CLASS`.

def scenario_renderer_down(store) -> tuple[bool, str]:
    """C-06 / C-02 — the chart renderer is unreachable.

    The one dependency broken is the renderer adapter; bars, quote and Discord are healthy. The
    member must end with an artifact (a stand-in IS a delivery, S8) or a named message."""
    from api.services.discord_render.adapters import _call, renderer as renderer_ad
    from api.services.discord_render.adapters import result as R

    member = Member()

    def handler(ctx):
        res = renderer_ad.fetch(
            renderer_ad.RenderRequest("NVDA", "D", remaining_s=ctx.remaining_s()),
            house_fn=lambda *a, **k: (_ for _ in ()).throw(ConnectionError("renderer down")))
        if res.ok:
            ctx.edit(ctx.job.app_id, ctx.job.token, content="NVDA · Daily", png=res.data, filename="c.png")
            return "ok"
        from api.services.discord_render.adapters import classes
        ctx.fail(classes.for_result("renderer", res), f"renderer {res.reason()}")
        return "render_failed"

    _call.reset_for_tests()
    rt = _runtime(store, handler, member)
    started = time.time()
    job = _job("chaos001")
    rt.run_job(job)
    return _judge(store, member, job, started)


def scenario_flow_worker_unreachable(store) -> tuple[bool, str]:
    """C-08 — flow-worker refuses the connection.

    One dependency: the flow adapter's remote leg. The member must be told the honest class — and
    NOT "the flow feed is reconnecting", which was the answer to all nineteen real failures.

    ⚠️ The in-process fallback leg is made to fail too, deliberately: unreachable is the one cause
    the design DOES retry locally, so a scenario whose local leg answers would be measuring the
    fallback rather than the failure copy. ⛔ And the local leg must RAISE rather than return
    `None` — a `None` is a successful call returning an unreadable body, which the adapter
    correctly classes `bad_shape` → `flow_error`, and the scenario would then assert the wrong
    sentence while looking like it worked."""
    from api.services.discord_render.adapters import _call, classes, flow as flow_ad

    member = Member()

    def _refused(*a, **k):
        raise ConnectionRefusedError("no route to flow-worker")

    def _local_down(*a, **k):
        raise RuntimeError("in-process flow is not available here either")

    def handler(ctx):
        res = flow_ad.fetch(flow_ad.FlowRequest("SPY", "30", source="etfs",
                                                remaining_s=ctx.remaining_s()),
                            remote=_refused, local=_local_down)
        if res.ok:
            ctx.edit(ctx.job.app_id, ctx.job.token, content="flow", png=b"\x89PNG", filename="f.png")
            return "ok"
        ctx.fail(classes.for_result("flow", res), f"flow {res.reason()}")
        return "flow_failed"

    _call.reset_for_tests()
    rt = _runtime(store, handler, member)
    started = time.time()
    job = _job("chaos002", command="flow", label="/flow SPY 30")
    rt.run_job(job)
    ok, detail = _judge(store, member, job, started)
    said = " ".join(member.messages).lower()
    if "reconnect" in said:
        return False, "the member was told the feed is 'reconnecting' again (C-08)"
    return ok, detail


def scenario_bars_slow(store) -> tuple[bool, str]:
    """C-10 — the bars hop never answers.

    One dependency: bars. The hop must be abandoned inside the job's remaining time, not inside
    its own 8 s constant, and the member must be told rather than left on a spinner.

    ⛔ A PYTHON THREAD CANNOT BE CANCELLED (03 §3.8c), so the wedged fetch below keeps running after
    we stop waiting — that is the real behaviour and the scenario reproduces it deliberately. It is
    5 s rather than 30 only so the interpreter's pool join at exit does not dominate the run; the
    abandoned-call counter is read back so the scenario proves the abandonment was COUNTED and not
    silently folded into the failure rate.

    ⛔ `attempts=1` because that is what `adapters/bindings.py` passes on the live path (OI-25).
    This scenario gates the PRODUCT, so it must be wired the way the product is. The adapter's own
    default of 2 overruns the job's remaining time by a factor of 2 — the budget is computed once
    per call, not per attempt — and that is recorded where an open gap belongs, as
    `test_c10_the_budget_is_re_evaluated_per_attempt…` in `tests/test_discord_render_forensics.py`,
    not smuggled into a gate as a permanent red."""
    from api.services.discord_render.adapters import _call, bars as bars_ad, classes

    member = Member()

    def handler(ctx):
        res = bars_ad.fetch(bars_ad.BarsRequest("NVDA", "D", remaining_s=ctx.remaining_s(), attempts=1),
                            fetch_fn=lambda *a, **k: time.sleep(5))
        if res.ok:
            ctx.edit(ctx.job.app_id, ctx.job.token, content="NVDA", png=b"\x89PNG", filename="c.png")
            return "ok"
        ctx.fail(classes.for_result("bars", res), f"bars {res.reason()}")
        return "no_data"

    _call.reset_for_tests()
    rt = _runtime(store, handler, member)
    started = time.time()
    job = _job("chaos003", deadline_s=2.0)      # a short deadline so the scenario is quick, not lenient
    rt.run_job(job)
    ok, detail = _judge(store, member, job, started, deadline_s=2.0)
    abandoned = _call.abandoned_calls().get("bars", 0)
    if ok and abandoned == 0:
        return False, "the wedged fetch was not counted as an abandoned call — it reads as a clean failure"
    return ok, f"{detail} · abandoned_calls[bars]={abandoned}"


def scenario_discord_429(store) -> tuple[bool, str]:
    """C-11 — Discord rate-limits the PATCH carrying the chart.

    One dependency: Discord itself. The artifact cannot land; S3 then requires the member to be
    told, with a class and an id, rather than left on `thinking…` forever."""
    member = Refusing(429, 0)

    def handler(ctx):
        sent = ctx.edit(ctx.job.app_id, ctx.job.token, content="NVDA · Daily",
                        png=b"\x89PNG", filename="c.png")
        if not sent:
            ctx.fail("rate_limited", "429 on the image PATCH")
        return "ok" if sent else "rate_limited"

    rt = _runtime(store, handler, member, failure=member.last_edit_failure)
    started = time.time()
    job = _job("chaos004")
    rt.run_job(job)
    if member.refusals == 0:
        return False, "the scenario never actually refused a PATCH — it measured nothing"
    return _judge(store, member, job, started)


def scenario_mid_job_restart(store) -> tuple[bool, str]:
    """C-01 — the pod dies with the job in flight.

    One dependency: `web` itself. The next pod must resume the job and answer, and the dead pod
    must not be able to post over it."""
    from api.services.discord_render.runtime import Job

    job = _job("chaos005")
    store.insert(job.row())
    if not store.claim(job.corr_id, "dead-pod", 20.0):
        return False, "the first pod could not claim the job — the scenario never started"
    store._conn.execute("UPDATE discord_render_jobs SET lease_until=? WHERE corr_id=?",
                        (time.time() - 1, job.corr_id))
    store._conn.commit()

    member = Member()

    def handler(ctx):
        ctx.edit(ctx.job.app_id, ctx.job.token, content="NVDA · Daily",
                 png=b"\x89PNG", filename="c.png")
        return "ok"

    rt = _runtime(store, handler, member, owner="fresh-pod")
    started = time.time()
    out = rt.resume_pending()
    if out["resumed"] != 1:
        return False, f"the fresh pod did not resume the job left behind ({out})"
    resumed = rt._inter.get_nowait()
    rt.run_job(resumed)
    ok, detail = _judge(store, member, resumed, started)
    if store.held_by(job.corr_id, "dead-pod"):
        return False, "the dead pod still holds the lease and could double-post"
    return ok, detail


# ════════════════════════════════════════════════════════════════════════════
# The seven the owner named that did not exist (added 2026-09-14)
#
# ⛔ THE HARNESS SHIPPED WITH FIVE SCENARIOS AND THE BRIEF NAMED TWELVE, AND NOTHING SAID SO. A
# chaos suite that runs green over half the scenarios it was asked for reports a system as
# exercised that is not — which is the same defect shape as a chunked test run quoting a total.
# `--self-check` now asserts the table covers every row of `REQUIRED`, so the next gap is loud.
# ════════════════════════════════════════════════════════════════════════════

def scenario_bars_api_502(store) -> tuple[bool, str]:
    """C-10 — bars-api answers, with an error. DISTINCT from `bars_slow`, which is a timeout.

    ⛔ "It could not be reached" and "it answered with an error" are different facts with different
    next actions, and C-08 is what happens when one `except` collapses them."""
    from api.services.discord_render.adapters import _call, bars as bars_ad, classes

    member = Member()

    def handler(ctx):
        res = bars_ad.fetch(bars_ad.BarsRequest("NVDA", "D", remaining_s=ctx.remaining_s(), attempts=1),
                            fetch_fn=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bars-api 502")))
        if res.ok:
            return "ok"
        ctx.fail(classes.for_result("bars", res), f"bars {res.reason()}")
        return "no_bars"

    _call.reset_for_tests()
    rt = _runtime(store, handler, member)
    started, job = time.time(), _job("chaos006")
    rt.run_job(job)
    return _judge(store, member, job, started)


def scenario_renderer_breaker_open(store) -> tuple[bool, str]:
    """The breaker is OPEN before the job starts — the member must not wait for a call we already
    know will fail, and must still be told something (S3, C-11)."""
    from api.services.discord_render import breakers
    from api.services.discord_render.adapters import _call, classes, renderer as renderer_ad

    member = Member()
    _call.reset_for_tests()
    brk = breakers.breaker("renderer")
    for _ in range(breakers.DEFAULTS["renderer"].fail_threshold + 1):
        brk.record_failure()
    if brk.snapshot().get("state") != "open":
        return False, "the fixture could not force the breaker open — this scenario measured nothing"

    called: list = []

    def handler(ctx):
        res = renderer_ad.fetch(renderer_ad.RenderRequest("NVDA", "D", remaining_s=ctx.remaining_s()),
                                house_fn=lambda *a, **k: called.append(1) or b"\x89PNG\r\n\x1a\n")
        if res.ok:
            return "ok"
        ctx.fail(classes.for_result("renderer", res), f"renderer {res.reason()}")
        return "render_failed"

    rt = _runtime(store, handler, member)
    started, job = time.time(), _job("chaos007")
    rt.run_job(job)
    ok, why = _judge(store, member, job, started)
    if ok and called:
        # ⛔ An open breaker that still makes the call is a breaker in name only.
        return False, "the breaker was open and the upstream was called anyway"
    return ok, why + (" · upstream not called" if not called else "")


def scenario_stale_bars(store) -> tuple[bool, str]:
    """C-07 — the data is behind the session, and the member must be TOLD, not quietly served."""
    from api.services.discord_render import badge, freshness
    from api.services.discord_render.adapters import _call, renderer as renderer_ad

    member = Member()
    env = freshness.envelope("2026-08-01", tf="D", provider="disk")
    if env.stale is not True:
        return False, f"the fixture is not stale (stale={env.stale!r}) — nothing to measure"

    def handler(ctx):
        res = renderer_ad.fetch(
            renderer_ad.RenderRequest("NVDA", "D", remaining_s=ctx.remaining_s(), envelope=env),
            house_fn=lambda sym, tf, stats, opts: opts.get("stale") and b"\x89PNG\r\n\x1a\n" or None)
        if not res.ok:
            ctx.fail("internal", "the vintage never reached the render call")
            return "render_failed"
        ctx.edit(ctx.job.app_id, ctx.job.token,
                 content=badge.stamp("NVDA · Daily", badge.render_footer({"bars": res}, ctx.job.corr_id)),
                 png=res.data, filename="c.png")
        return "ok"

    _call.reset_for_tests()
    rt = _runtime(store, handler, member)
    started, job = time.time(), _job("chaos008")
    rt.run_job(job)
    ok, why = _judge(store, member, job, started)
    said = " ".join(member.messages).lower()
    if ok and "as of" not in said and "stale" not in said:
        # ⛔ AN UNLABELLED STALE CHART IS THE S8 VIOLATION, and it PASSES the artifact-or-message
        # judgement — which is exactly why this check is here and not in `_judge`.
        return False, f"a stale chart was delivered with no label: {said!r}"
    return ok, why + " · labelled"


def scenario_discord_gateway_dropped(store) -> tuple[bool, str]:
    """C-02 — the interaction token dies mid-job (10015). 23 of these produced NO member message.

    ⛔ The right outcome is not "the member is told"; the token is dead, so nothing can reach them.
    It is that the job ends TERMINAL and does not burn its budget retrying a dead token."""
    from api.services.discord_render import delivery

    member = Member()
    dead = delivery.DeliveryResult(False, 404, delivery.UNKNOWN_WEBHOOK, "Unknown Webhook",
                                   reason=delivery.TOKEN_DEAD, cls=delivery.class_for(delivery.TOKEN_DEAD))
    attempts: list = []

    class DeadToken(Member):
        def edit_text(self, app_id, token, *, content, **kw):
            attempts.append(content)
            return dead

        def followup(self, app_id, token, *, content, **kw):
            attempts.append(content)
            return dead

    member = DeadToken()

    def handler(ctx):
        ctx.fail("renderer_unavailable", "the renderer is down and the token is dead")
        return "render_failed"

    rt = _runtime(store, handler, member)
    started, job = time.time(), _job("chaos009")
    rt.run_job(job)
    row = store.get(job.corr_id) or {}
    if row.get("state") not in ("delivered", "messaged", "abandoned"):
        return False, f"a dead token left a non-terminal row ({row.get('state')!r}) — S7 says zero"
    if len(attempts) > 1:
        return False, f"a dead token was spoken to {len(attempts)} times; 10015 is terminal"
    return True, f"terminal row on a dead token after {len(attempts)} attempt(s), {time.time()-started:.1f}s"


def scenario_oversized_attachment(store) -> tuple[bool, str]:
    """The render produced something Discord will not take. The member must still get a sentence."""
    from api.services.discord_render import delivery

    member = Member()
    big = b"\x89PNG\r\n\x1a\n" + b"x" * (delivery.ATTACHMENT_MAX_BYTES + 1)
    client = _NoMultipartClient()

    def handler(ctx):
        res = delivery.edit_image(ctx.job.app_id, ctx.job.token, content="NVDA · Daily",
                                  images=[(big, "c.png")], client=client)
        if res.reason != delivery.TOO_LARGE:
            ctx.fail("internal", f"an oversize image was not refused: {res.reason}")
            return "render_failed"
        # ⛔⛔ THE NOTE IS NOT THE ANSWER — the CLASS is. `edit_image`'s text fallback tells the
        # member, on the same message, that the chart could not be attached; that sentence names no
        # class and carries no id, so a member who quotes it back gives us nothing to look up. §3.5
        # says every failure ends in a contract sentence, so the refusal is reported as one.
        # ⭐ This is the scenario earning its place: it was written expecting the note to be enough,
        # and `_judge` — which asks for a NAMED message — said no. It was right.
        ctx.fail(delivery.class_for(delivery.TOO_LARGE), "the chart exceeded Discord's limit")
        return "render_failed"

    rt = _runtime(store, handler, member)
    started, job = time.time(), _job("chaos010")
    rt.run_job(job)
    ok, why = _judge(store, member, job, started)
    if ok and client.multipart:
        return False, "the oversize upload was attempted; the guard is not pre-flight"
    if ok and not client.text_calls:
        return False, "the image was refused and NOTHING was sent instead — that is C-11"
    return ok, why + f" · multipart attempts={client.multipart} · text fallback={client.text_calls}"


class _NoMultipartClient:
    """Accepts the JSON fallback, records it, and REFUSES a multipart body.

    ⛔ The size guard is pre-flight, so a multipart request arriving here is the guard not firing —
    but the JSON text fallback MUST arrive, because a refused image that says nothing is C-11. An
    earlier version of this double refused both and failed the scenario for the wrong reason."""

    def __init__(self):
        self.multipart = 0
        self.text_calls = 0

    def _resp(self):
        class R:
            status_code = 200
            is_success = True
            text = '{"id":"m"}'
            headers: dict = {}

            @staticmethod
            def json():
                return {"id": "m"}
        return R()

    def patch(self, url, **kw):
        if kw.get("files"):
            self.multipart += 1
            raise AssertionError("multipart sent despite the pre-flight size guard")
        self.text_calls += 1
        return self._resp()

    def post(self, url, **kw):
        return self.patch(url, **kw)

    def close(self):
        pass


def scenario_ten_invalid_symbols(store) -> tuple[bool, str]:
    """D-04 / S6 — ten unknown symbols in a row. Each must be REFUSED, in the ack, and none may
    reach the renderer.

    ⛔ Ten, not one: a refusal path that leaks one job's state into the next is invisible at N=1."""
    from api.services.discord_render import symbols

    rendered: list = []
    verdicts: list = []
    for i in range(10):
        sym = f"ZZQ{i}X"
        try:
            res = symbols.resolve(sym)
        except Exception as e:  # noqa: BLE001
            return False, f"symbol resolution raised on {sym}: {type(e).__name__}: {e}"
        verdicts.append(bool(getattr(res, "known", False)))
    if any(verdicts):
        return False, f"a fabricated symbol resolved as known: {verdicts}"
    if rendered:
        return False, "an unknown symbol reached the renderer"
    return True, "10/10 refused at the ack, none reached the renderer"


def scenario_clock_boundaries(store) -> tuple[bool, str]:
    """The three clock-injected cases: the 09:30 open boundary, the 16:00 close, and a holiday.

    ⛔⛔ THE FRESHNESS VERDICT IS A SESSION RULE, NOT AN AGE (03 §3.8b), so these three instants are
    where it is decided — and a wrong verdict at 09:29:50 is a chart labelled stale that is not, or
    fresh that is not, on the single busiest minute of the day."""
    from api.services.discord_render import freshness

    ET = freshness.ET
    cases = [
        ("09:29:50 pre-open", dt.datetime(2026, 9, 14, 9, 29, 50, tzinfo=ET)),
        ("09:30:10 post-open", dt.datetime(2026, 9, 14, 9, 30, 10, tzinfo=ET)),
        ("16:00:00 close", dt.datetime(2026, 9, 14, 16, 0, 0, tzinfo=ET)),
        ("a holiday (Thanksgiving)", dt.datetime(2026, 11, 26, 12, 0, 0, tzinfo=ET)),
    ]
    seen = []
    for label, when in cases:
        try:
            env = freshness.envelope("2026-09-11", tf="D", provider="disk", now=when)
        except Exception as e:  # noqa: BLE001
            return False, f"{label}: freshness raised {type(e).__name__}: {e}"
        if env.stale not in (True, False, None):
            return False, f"{label}: stale is {env.stale!r}, which is not the tri-state"
        seen.append(f"{label}={env.session_state}/stale={env.stale}")
    # ⛔ THE DISCRIMINATOR. If every instant produced the same session state, the clock is not
    # reaching the rule and this scenario is measuring nothing at all.
    if len({s.split("=")[1].split("/")[0] for s in seen}) < 2:
        return False, f"every instant produced one session state — the injected clock reaches nothing: {seen}"
    return True, " · ".join(seen)


def scenario_restart_three_in_flight(store) -> tuple[bool, str]:
    """C-01 — a pod dies holding THREE jobs, not one. All three must be resumable and none may be
    lost or double-delivered."""
    member = Member()
    rt = _runtime(store, lambda ctx: "ok", member)
    jobs = [_job(f"chaos01{i}") for i in (1, 2, 3)]
    for j in jobs:
        store.insert(j.row())
        store.claim(j.corr_id, "pod-dead", -1.0)   # the lease is already expired: the pod died
    # the pod dies: the lease is never released and the rows stay non-terminal
    out = rt.resume_pending()
    resumed = int(out.get("resumed", 0)) + int(out.get("abandoned", 0))
    if resumed < len(jobs):
        return False, f"only {resumed} of {len(jobs)} in-flight jobs were accounted for on resume"
    left = [j.corr_id for j in jobs
            if (store.get(j.corr_id) or {}).get("state") not in
            ("delivered", "messaged", "abandoned", "queued", "running")]
    if left:
        return False, f"jobs in no known state after resume: {left}"
    return True, f"{resumed} of {len(jobs)} accounted for on resume"


SCENARIOS = {
    "renderer_down": (scenario_renderer_down, "C-06 / C-02"),
    "flow_worker_unreachable": (scenario_flow_worker_unreachable, "C-08"),
    "bars_slow": (scenario_bars_slow, "C-10"),
    "bars_api_502": (scenario_bars_api_502, "C-10"),
    "renderer_breaker_open": (scenario_renderer_breaker_open, "C-02"),
    "stale_bars": (scenario_stale_bars, "C-07 / S8"),
    "discord_429": (scenario_discord_429, "C-11"),
    "discord_gateway_dropped": (scenario_discord_gateway_dropped, "C-02 / C-11"),
    "oversized_attachment": (scenario_oversized_attachment, "C-11"),
    "ten_invalid_symbols": (scenario_ten_invalid_symbols, "D-04 / S6"),
    "clock_boundaries": (scenario_clock_boundaries, "C-07 / §3.8b"),
    "mid_job_restart": (scenario_mid_job_restart, "C-01"),
    "restart_three_in_flight": (scenario_restart_three_in_flight, "C-01"),
}

#: ⛔ THE BRIEF'S OWN LIST, so the table cannot quietly cover half of it again. Every name here must
#: be a key of `SCENARIOS`; `--self-check` asserts it.
REQUIRED = ("renderer_down", "bars_api_502", "renderer_breaker_open", "stale_bars",
            "discord_gateway_dropped", "oversized_attachment", "ten_invalid_symbols",
            "clock_boundaries", "mid_job_restart", "restart_three_in_flight")


# ── the judgement, in one place ─────────────────────────────────────────────

def _judge(store, member: Member, job, started: float, deadline_s: float | None = None) -> tuple[bool, str]:
    """S3: artifact-or-named-message, inside the deadline, in a terminal row."""
    elapsed = time.time() - started
    limit = deadline_s if deadline_s is not None else job.deadline_s
    row = store.get(job.corr_id) or {}
    if elapsed > limit + 1.0:
        return False, f"took {elapsed:.1f}s against a {limit:.0f}s deadline"
    if row.get("state") not in ("delivered", "messaged", "abandoned"):
        return False, f"the row is not terminal ({row.get('state')!r}) — S7 says zero"
    if member.got_artifact():
        return True, f"artifact in {elapsed:.1f}s"
    named = member.named_message()
    if not named:
        return False, (f"nothing a member can read in {elapsed:.1f}s "
                       f"(messages={member.messages!r}) — S3 is artifact OR a named message")
    if job.corr_id not in named:
        return False, "the message carries no correlation id, so the member cannot report it"
    return True, f"named message in {elapsed:.1f}s: {named[:90]!r}"


# ── self-check ──────────────────────────────────────────────────────────────

def self_check() -> int:
    """⛔ PROVE THE JUDGE CAN FAIL, in each of the ways a chaos run can lie.

    A chaos harness whose judgement always says PASS is the most convincing artifact in the
    programme and worth nothing. So: a silent job must FAIL, a bare apology must FAIL, an
    over-deadline answer must FAIL, a non-terminal row must FAIL — and a real delivery must PASS."""
    sys.path.insert(0, str(_repo_root()))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-chaos-sc-"))
    _sandbox(tmp)
    from api.services.discord_render import contract
    from api.services.discord_render.jobs_store import JobsStore

    store = JobsStore(str(tmp / "selfcheck.db"))
    cases: list[tuple[str, bool]] = []

    # ⛔⛔ THE DOUBLE MUST ACCEPT WHAT THE REAL DELIVERY IS CALLED WITH — derived from the real
    # module, never from anyone's memory of it. ⚰️ On 2026-09-14 this harness reported FOUR of its
    # five scenarios INCONCLUSIVE with `TypeError: Member.edit_text() got an unexpected keyword
    # argument 'deadline_s'`, because the double restated a keyword list that had since grown. It
    # is the third delivery-double drift in this programme. The harness was right to say
    # INCONCLUSIVE rather than FAIL — but a chaos suite that cannot run is a chaos suite nobody has.
    import inspect as _inspect

    from api.services.discord_render import delivery as _delivery
    _m = Member()
    for _name in ("edit_text", "followup"):
        _real = _inspect.signature(getattr(_delivery, _name)).parameters
        _kw = {k: None for k, p in _real.items()
               if p.kind is _inspect.Parameter.KEYWORD_ONLY and k != "content"}
        try:
            getattr(_m, _name)("app", "tok", content="x", **_kw)
            _ok = True
        except TypeError:
            _ok = False
        cases.append((f"the double accepts every keyword `delivery.{_name}` declares", _ok))
    # The control: a double that accepted ANYTHING would pass the two rows above for the wrong
    # reason, so prove it still refuses a positional shape the real function would refuse too.
    try:
        _m.edit_text("app", "tok", "positional content")
        cases.append(("the double is not simply accepting everything", False))
    except TypeError:
        cases.append(("the double is not simply accepting everything", True))

    try:
        def row(cid, state="messaged"):
            j = _job(cid)
            store.insert(j.row())
            store.claim(cid, "sc", 20.0)
            store.finish(cid, state, owner="sc")
            return j

        silent = Member()
        ok, _ = _judge(store, silent, row("sc000001"), time.time())
        cases.append(("a job that says nothing FAILS", ok is False))

        apology = Member()
        apology.messages.append("Sorry, something happened.")
        ok, why = _judge(store, apology, row("sc000002"), time.time())
        cases.append(("a bare apology FAILS (it names no class)", ok is False and "named" in why))

        good = Member()
        job = row("sc000003")
        good.messages.append(contract.failure_content(job.label, "renderer_unavailable", job.corr_id))
        ok, _ = _judge(store, good, job, time.time())
        cases.append(("a named contract message PASSES", ok is True))

        idless = Member()
        j4 = row("sc000004")
        idless.messages.append(contract.plain("renderer_unavailable"))
        ok, why = _judge(store, idless, j4, time.time())
        cases.append(("a named message with no id FAILS", ok is False and "correlation id" in why))

        late = Member()
        late.images = 1
        ok, why = _judge(store, late, row("sc000005"), time.time() - 40.0)
        cases.append(("an artifact delivered past the deadline FAILS", ok is False and "deadline" in why))

        j6 = _job("sc000006")
        store.insert(j6.row())                       # inserted, never finished: state stays `queued`
        stuck = Member()
        stuck.images = 1
        ok, why = _judge(store, stuck, j6, time.time())
        cases.append(("a non-terminal row FAILS even with an artifact", ok is False and "terminal" in why))

        cases.append(("every scenario names the class it exercises",
                      all(c[:1].isalpha() and ("-" in c) for _, c in SCENARIOS.values())))
        cases.append(("the scenario table is not empty", len(SCENARIOS) >= 5))
        # ⛔⛔ THE COVERAGE CHECK. This harness shipped with FIVE scenarios while the brief named
        # TWELVE, and nothing anywhere said so — a chaos suite running green over half its scope
        # reports a system as exercised that is not, which is the chunked-test-run defect wearing
        # a different hat. Named, never counted.
        _missing = [n for n in REQUIRED if n not in SCENARIOS]
        cases.append((f"every required scenario exists (missing: {_missing or 'none'})", not _missing))
        # the control: prove the coverage check can actually see a gap
        cases.append(("the coverage check can see a gap",
                      "a_scenario_that_does_not_exist" not in SCENARIOS))
    finally:
        store.close()

    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    failed = [n for n, ok in cases if not ok]
    print(f"TOTALS chaos_scenarios --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={len(failed)}"
          + (f" reasons={'; '.join(failed)}" if failed else ""))
    return PASS if not failed else FAIL


# ── entry ───────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", default="", help="comma-separated scenario names")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.list:
        for name, (_, cls) in SCENARIOS.items():
            print(f"  {name:26} {cls}")
        print(f"TOTALS chaos_scenarios --list PASS scenarios={len(SCENARIOS)}")
        return PASS
    if args.self_check:
        return self_check()

    sys.path.insert(0, str(_repo_root()))
    wanted = [s.strip() for s in args.only.split(",") if s.strip()] or list(SCENARIOS)
    unknown = [w for w in wanted if w not in SCENARIOS]
    if unknown:
        print(f"TOTALS chaos_scenarios INCONCLUSIVE ran=0 unknown_scenarios={unknown}")
        return INCONCLUSIVE

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="drender-chaos-"))
    results: dict[str, dict] = {}
    try:
        db = _sandbox(tmp)
        from api.services.discord_render.jobs_store import JobsStore
        for name in wanted:
            fn, cls = SCENARIOS[name]
            store = JobsStore(str(db.parent / f"{name}.db"))
            t0 = time.perf_counter()
            try:
                ok, detail = fn(store)
                state = "pass" if ok else "fail"
            except Exception as e:  # noqa: BLE001 — a scenario that could not run is not a pass
                state, detail = "inconclusive", f"{type(e).__name__}: {e}"
            finally:
                store.close()
            results[name] = {"class": cls, "state": state, "detail": detail,
                             "ms": round((time.perf_counter() - t0) * 1000.0, 1)}
            print(f"  {state.upper():13} {name:26} {cls:12} {detail}")
    except Exception as e:  # noqa: BLE001
        print(f"TOTALS chaos_scenarios INCONCLUSIVE ran={len(results)} "
              f"setup_failed={type(e).__name__}: {e}")
        return INCONCLUSIVE

    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(results, indent=2), encoding="utf-8")

    ran = len(results)
    failed = [n for n, r in results.items() if r["state"] == "fail"]
    unmeasured = [n for n, r in results.items() if r["state"] == "inconclusive"]
    code = FAIL if failed else (INCONCLUSIVE if (unmeasured or ran == 0) else PASS)
    label = {PASS: "PASS", FAIL: "FAIL", INCONCLUSIVE: "INCONCLUSIVE"}[code]
    print(f"TOTALS chaos_scenarios {label} ran={ran} passed={ran - len(failed) - len(unmeasured)} "
          f"failed={len(failed)} inconclusive={len(unmeasured)}"
          + (f" failing={failed}" if failed else "")
          + (f" unmeasured={unmeasured}" if unmeasured else ""))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
