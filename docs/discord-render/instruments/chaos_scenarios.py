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

    # the delivery module's two entry points
    def edit_text(self, app_id, token, *, content, components=None, client=None):
        from api.services.discord_render.delivery import DeliveryResult
        self.messages.append(content)
        return DeliveryResult(True, 200)

    def followup(self, app_id, token, *, content, components=None, ephemeral=True, client=None):
        from api.services.discord_render.delivery import DeliveryResult
        self.messages.append(content)
        return DeliveryResult(True, 200)

    # the runtime's `edit_fn` seam (what a handler calls to deliver the artifact)
    def edit_fn(self, app_id, token, **kw):
        if kw.get("png") or kw.get("pngs"):
            self.images += 1
        elif kw.get("content"):
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


SCENARIOS = {
    "renderer_down": (scenario_renderer_down, "C-06 / C-02"),
    "flow_worker_unreachable": (scenario_flow_worker_unreachable, "C-08"),
    "bars_slow": (scenario_bars_slow, "C-10"),
    "discord_429": (scenario_discord_429, "C-11"),
    "mid_job_restart": (scenario_mid_job_restart, "C-01"),
}


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
                      all(c.startswith("C-") for _, c in SCENARIOS.values())))
        cases.append(("the scenario table is not empty", len(SCENARIOS) >= 5))
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
