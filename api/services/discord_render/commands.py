"""V2 command layer: the ack-path router and the worker-side handlers.

`handle(interaction, received)` is called by POST /api/discord/interactions after the
signature and guild gates. It returns the interaction response when V2 owns the
interaction, or None to leave it to the pre-V2 path. It does NO I/O on the event loop:
parse (pure), rate check (memory), `runtime.offer` (an in-memory put). The only awaits
are bounded executor calls (autocomplete search, the Retry lookup).

Handlers run on the runtime's dedicated workers and call the SAME producers the pre-V2
path calls (`di.run_chart_job`, `di.run_multi_chart_job`, `run_flow_card_job`,
`run_buzz_image_job`) with the runtime's tracked edit and the failure contract — so V2
changes the ENVELOPE (queue, lease, deadline, message) and not the chart a member gets.

Flags: DISCORD_RENDER_V2_ENABLED is the master (default OFF). The per-command switches
DISCORD_RENDER_V2_{CHART,FLOW,BUZZ,CONTROLS}_ENABLED are KILL switches under it (unset =
on), so flipping the master turns V2 on for everything and one command can be sent back
to the old path without touching the others.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import functools
import logging
import os
import threading
import time

from api.services import discord_interactions as di
from api.services.discord_render import contract
from api.services.discord_render.delivery import DeliveryResult
from api.services.discord_render.ids import corr_id
from api.services.discord_render.jobs_store import JobsStore
from api.services.discord_render.runtime import INTERACTIVE, Job, JobContext, JobRuntime

log = logging.getLogger("discord_render")

AUTOCOMPLETE_BUDGET_S = 1.2
RETRY_LOOKUP_BUDGET_S = 0.5
FLOW_TIMEOUT_S = 10.0

_OFF = ("0", "false", "off", "no", "")


def enabled() -> bool:
    return os.environ.get("DISCORD_RENDER_V2_ENABLED", "0").strip().lower() not in _OFF


def command_enabled(name: str) -> bool:
    """Per-command kill switch under the master (unset = on)."""
    if not enabled():
        return False
    return os.environ.get(f"DISCORD_RENDER_V2_{name.upper()}_ENABLED", "1").strip().lower() not in _OFF


# ── runtime singleton ───────────────────────────────────────────────────────

_runtime: JobRuntime | None = None
_runtime_lock = threading.Lock()
_io_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="drender-io")


def _last_edit_failure():
    f = di.last_edit_failure()
    if not f:
        return None
    return DeliveryResult(False, f.get("status"), f.get("code"), str(f.get("detail") or "")[:200])


def get_runtime() -> JobRuntime:
    global _runtime
    with _runtime_lock:
        if _runtime is None:
            _runtime = JobRuntime(store=JobsStore(), handlers=HANDLERS, edit_fn=di.edit_original,
                                  last_edit_failure=_last_edit_failure,
                                  commit=(os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12])
            _runtime.start()
        return _runtime


def start() -> dict:
    """Lifespan startup: build the runtime and resume what a dead pod left behind."""
    rt = get_runtime()
    out = rt.resume_pending()
    log.info("drender evt=started owner=%s resumed=%s abandoned=%s", rt.owner, out["resumed"], out["abandoned"])
    return out


def stop() -> int:
    """Lifespan shutdown: stop taking work and hand leases back for the next pod."""
    global _runtime
    with _runtime_lock:
        rt, _runtime = _runtime, None
    if rt is None:
        return 0
    released = rt.stop()
    log.info("drender evt=stopped owner=%s released=%s", rt.owner, released)
    return released


# ── helpers ─────────────────────────────────────────────────────────────────

def _ephemeral(content: str, components: list | None = None) -> dict:
    data: dict = {"content": content[:2000], "flags": di.EPHEMERAL}
    if components is not None:
        data["components"] = components
    return {"type": 4, "data": data}


def _interaction_subset(interaction: dict) -> dict:
    """Everything a handler needs to rebuild the request on any pod, and nothing more.
    The message body is kept only for its attachment ids and content (help/save picks)."""
    msg = interaction.get("message") or {}
    return {"data": interaction.get("data") or {}, "guild_id": str(interaction.get("guild_id") or ""),
            "channel_id": str(interaction.get("channel_id") or ""),
            "message": {"content": msg.get("content"), "attachments": [
                {"id": a.get("id")} for a in (msg.get("attachments") or []) if isinstance(a, dict)]}}


def _job(interaction: dict, command: str, label: str, *, ephemeral: bool = False) -> Job:
    return Job(corr_id=corr_id(interaction.get("id")), command=command,
               app_id=str(interaction.get("application_id") or os.environ.get("DISCORD_CHART_APP_ID") or ""),
               token=str(interaction.get("token") or ""), args=_interaction_subset(interaction), label=label,
               user_id=di.interaction_user_id(interaction), guild_id=str(interaction.get("guild_id") or ""),
               channel_id=str(interaction.get("channel_id") or ""), interaction_id=str(interaction.get("id") or ""),
               interaction_type=int(interaction.get("type") or 2), ephemeral=ephemeral, lane=INTERACTIVE)


def _enqueue(job: Job, defer: dict, received: float) -> dict:
    """Offer the job; the defer on success, an honest ephemeral on refusal."""
    if not job.app_id or not job.token:
        return _ephemeral("Discord did not supply a reply token.")
    rt = get_runtime()
    status, position = rt.offer(job)
    if status == "queued":
        rt.record_ack(job.corr_id, (time.perf_counter() - received) * 1000.0)
        log.info("drender evt=enqueued cid=%s cmd=%s pos=%s", job.corr_id, job.command, position)
        return defer
    if status == "user_busy":
        return _ephemeral(f"You already have {rt.per_user_max} requests rendering — they'll land in a moment. · id {job.corr_id}")
    rt.record_refused(job, "queue_full")
    return _ephemeral(contract.failure_content(job.label, "queue_full", job.corr_id), contract.failure_components(job.corr_id))


def _rate_limited(uid: str, n: int = 1, noun: str = "charts") -> dict | None:
    for _ in range(max(1, n)):
        wait = di.user_rate_check(uid)
        if wait:
            return _ephemeral(di.throttle_message(wait, noun=noun))
    return None


async def _bounded(fn, budget_s: float, default):
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(_io_pool, fn), timeout=budget_s)
    except Exception:  # noqa: BLE001 — timeout or error: the ack still answers
        return default


# ── the ack path ────────────────────────────────────────────────────────────

async def handle(interaction: dict, received: float) -> dict | None:
    from api.routers import discord_interactions as router
    itype = interaction.get("type")
    data = interaction.get("data") or {}
    name = data.get("name")
    cid_field = str(data.get("custom_id") or "")

    # Autocomplete (type 4) cannot be deferred: answer inside a bounded budget, off the loop.
    if itype == 4 and command_enabled("chart") and (name in di.CHART_COMMAND_NAMES or name == di.FLOW_COMMAND):
        if name == di.FLOW_COMMAND:
            fname, fval = di.focused_option(interaction)
            if fname == "days":
                return router._autocomplete(di.flow_days_choices(fval))
            q = (fval or "").strip().upper().lstrip("$")[:10]
        else:
            q = di.parse_autocomplete(interaction)
        if not q:
            return router._autocomplete([])
        typed = q.lstrip("$")
        fallback = [{"name": f"{typed} - chart it"[:100], "value": typed}] if di._TICKER_RE.match(typed) else []
        choices = await _bounded(lambda: router.fetch_ticker_choices(q), AUTOCOMPLETE_BUDGET_S, fallback)
        return router._autocomplete(choices)

    # Retry button on a failure message.
    retry_cid = contract.parse_retry(cid_field) if itype == 3 else None
    if retry_cid:
        rt = get_runtime()
        row = await _bounded(lambda: rt.store.get(retry_cid), RETRY_LOOKUP_BUDGET_S, None)
        if not row:
            return _ephemeral("That request has expired — please run the command again.")
        import json as _json
        payload = _json.loads(row.get("args_json") or "{}")
        limited = _rate_limited(di.interaction_user_id(interaction))
        if limited:
            return limited
        job = _job(interaction, row["command"], payload.get("label") or "Request", ephemeral=bool(row.get("ephemeral")))
        job.args = payload.get("args") or {}
        return _enqueue(job, {"type": 6}, received)

    if itype == 2 and name in di.CHART_COMMAND_NAMES and command_enabled("chart"):
        if not di.cmd_channel_ok(interaction):
            return router._channel_nudge()
        try:
            reqs = di.parse_chart_requests(interaction)          # validation only; tf defaults resolve in the worker
        except di.CommandError as e:
            return _ephemeral(str(e))
        limited = _rate_limited(di.interaction_user_id(interaction), len(reqs))
        if limited:
            return limited
        label = contract.command_label("chart", {"tickers": [r.ticker for r in reqs]})
        return _enqueue(_job(interaction, "multi" if len(reqs) > 1 else "chart", label), {"type": 5}, received)

    if itype == 2 and name == di.MULTI_COMMAND and command_enabled("chart"):
        if not di.cmd_channel_ok(interaction):
            return router._channel_nudge()
        try:
            reqs = di.parse_charts_command(interaction)
        except di.CommandError as e:
            return _ephemeral(str(e))
        limited = _rate_limited(di.interaction_user_id(interaction), len(reqs))
        if limited:
            return limited
        label = contract.command_label("chart", {"tickers": [r.ticker for r in reqs]})
        return _enqueue(_job(interaction, "charts", label), {"type": 5}, received)

    if itype == 2 and name == di.FLOW_COMMAND and command_enabled("flow"):
        if not di.cmd_channel_ok(interaction):
            return router._channel_nudge()
        limited = _rate_limited(di.interaction_user_id(interaction), noun="flow cards")
        if limited:
            return limited
        try:
            tkr, days = di.parse_flow_command(interaction)
        except di.CommandError as e:
            return _ephemeral(str(e))
        return _enqueue(_job(interaction, "flow", contract.command_label("flow", {"ticker": tkr, "days": days})),
                        {"type": 5}, received)

    if itype == 2 and name == di.BUZZ_COMMAND and command_enabled("buzz"):
        limited = _rate_limited(di.interaction_user_id(interaction), noun="boards")
        if limited:
            return limited
        return _enqueue(_job(interaction, "buzz", "/buzz", ephemeral=True),
                        {"type": 5, "data": {"flags": di.EPHEMERAL}}, received)

    if itype == 3 and command_enabled("controls"):
        if cid_field.startswith(di.FLOW_CHART_PREFIX + "|"):
            ticker = cid_field.split("|", 1)[1].strip().upper()
            if not di._TICKER_RE.match(ticker):
                return _ephemeral("Couldn't read that ticker.")
            limited = _rate_limited(di.interaction_user_id(interaction))
            if limited:
                return limited
            return _enqueue(_job(interaction, "popup", contract.command_label("popup", {"ticker": ticker}), ephemeral=True),
                            {"type": 5, "data": {"flags": di.EPHEMERAL}}, received)
        try:
            kind = di.component_kind(interaction)
        except di.CommandError:
            return None                                          # not ours: the old path answers "Unknown button."
        if kind == "charts":
            try:
                reqs = di.parse_multi_component(interaction)
            except di.CommandError as e:
                return _ephemeral(str(e))
            limited = _rate_limited(di.interaction_user_id(interaction), len(reqs))
            if limited:
                return limited
            return _enqueue(_job(interaction, "charts_controls", "Chart update"), {"type": 6}, received)
        if kind != "chart" or di.is_help_pick(interaction) or di.is_save_pick(interaction):
            return None          # help / save / activity answer synchronously on the old path (type 7 / 12)
        try:
            di.parse_component(interaction)
        except di.CommandError as e:
            return _ephemeral(str(e))
        limited = _rate_limited(di.interaction_user_id(interaction))
        if limited:
            return limited
        return _enqueue(_job(interaction, "controls", "Chart update"), {"type": 6}, received)

    return None


# ── worker-side handlers ────────────────────────────────────────────────────

def _chart_kwargs(ctx: JobContext, guild_id: str) -> dict:
    from api.routers import discord_interactions as router
    from api.services import discord_chart_context as chart_context
    from api.services import discord_chart_house as house
    from api.services.discord_chart_render import render_chart_png
    return dict(bars_fn=router.fetch_bars, render_fn=render_chart_png, edit_fn=ctx.edit,
                house_fn=house.render_house_chart if house.house_enabled() else None,
                quote_fn=router.fetch_ext_quote,
                context_fn=chart_context.context_line if chart_context.enabled() else None,
                components_fn=functools.partial(di.chart_components, guild_id=guild_id), fail_fn=ctx.fail)


def _multi_kwargs(ctx: JobContext) -> dict:
    from api.routers import discord_interactions as router
    from api.services import discord_chart_house as house
    from api.services.discord_chart_render import render_chart_png
    return dict(bars_fn=router.fetch_bars, render_fn=render_chart_png, edit_fn=ctx.edit,
                house_fn=house.render_house_chart if house.house_enabled() else None,
                quote_fn=router.fetch_ext_quote, components_fn=di.multi_components, fail_fn=ctx.fail)


def _rebuilt(ctx: JobContext) -> dict:
    a = ctx.job.args
    return {"data": a.get("data") or {}, "guild_id": a.get("guild_id"), "channel_id": a.get("channel_id"),
            "message": a.get("message") or {}}


def _handle_chart(ctx: JobContext):
    from api.routers import discord_interactions as router
    job, inter = ctx.job, _rebuilt(ctx)
    prefs = router._prefs_for(job.user_id)
    reqs = di.parse_chart_requests(inter, default_tf=prefs.get("tf", "D"))
    if len(reqs) > 1:
        items = [router.breadth_adjust(r, dict(prefs)) for r in reqs]
        return di.run_multi_chart_job(job.app_id, job.token, items, **_multi_kwargs(ctx))
    req = reqs[0]
    prefs = {**prefs, **req.overrides()}
    req, prefs = router.breadth_adjust(req, prefs)
    kw = _chart_kwargs(ctx, job.guild_id)
    return di.run_chart_job(job.app_id, job.token, req, prefs=prefs, **kw)


def _handle_charts(ctx: JobContext):
    from api.routers import discord_interactions as router
    job, inter = ctx.job, _rebuilt(ctx)
    prefs = router._prefs_for(job.user_id)
    parse = di.parse_multi_component if job.command == "charts_controls" else (
        lambda i: di.parse_charts_command(i, default_tf=prefs.get("tf", "D")))
    items = [router.breadth_adjust(r, dict(prefs)) for r in parse(inter)]
    return di.run_multi_chart_job(job.app_id, job.token, items, **_multi_kwargs(ctx))


def _handle_controls(ctx: JobContext):
    from api.routers import discord_interactions as router
    job, inter = ctx.job, _rebuilt(ctx)
    prefs = router._prefs_for(job.user_id)
    req = di.parse_component(inter)
    prefs = {**prefs, **req.overrides()}
    req, prefs = router.breadth_adjust(req, prefs)
    return di.run_chart_job(job.app_id, job.token, req, prefs=prefs, **_chart_kwargs(ctx, job.guild_id))


def _handle_popup(ctx: JobContext):
    from api.routers import discord_interactions as router
    job, inter = ctx.job, _rebuilt(ctx)
    ticker = str((inter["data"] or {}).get("custom_id") or "").split("|", 1)[1].strip().upper()
    prefs = router._prefs_for(job.user_id)
    req = di.ChartRequest(ticker=ticker, tf=prefs.get("tf", "D"), darkpool=True)
    req, prefs = router.breadth_adjust(req, prefs)
    return di.run_chart_job(job.app_id, job.token, req, prefs=prefs, **_chart_kwargs(ctx, job.guild_id))


def _handle_flow(ctx: JobContext):
    from api.routers import discord_interactions as router
    job, inter = ctx.job, _rebuilt(ctx)
    tkr, days = di.parse_flow_command(inter)
    router.run_flow_card_job(job.app_id, job.token, tkr, days, edit_fn=ctx.edit, fail_fn=ctx.fail,
                             timeout_s=FLOW_TIMEOUT_S, cid=job.corr_id)
    return "flow"


def _handle_buzz(ctx: JobContext):
    from api.routers import discord_interactions as router
    from api.services import buzz_image, buzz_reply
    job, inter = ctx.job, _rebuilt(ctx)
    opts = {o["name"]: o.get("value") for o in ((inter["data"] or {}).get("options") or [])}
    window = (opts.get("window") or "open").strip()
    ticker = (opts.get("ticker") or "").strip().upper()
    now = int(time.time())
    text = buzz_reply.build_ticker_text(ticker, window, now) if ticker else buzz_reply.build_board_text(now, window)
    if not ticker and buzz_image.image_enabled():
        router.run_buzz_image_job(job.app_id, job.token, text, window, edit_fn=ctx.edit)
    else:
        ctx.edit(job.app_id, job.token, content=text)
    return "buzz"


HANDLERS = {
    "chart": _handle_chart, "multi": _handle_chart, "charts": _handle_charts, "charts_controls": _handle_charts,
    "controls": _handle_controls, "popup": _handle_popup, "flow": _handle_flow, "buzz": _handle_buzz,
}
