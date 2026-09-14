"""Adapter-backed callables with the shapes the render functions already expect (P2.1).

`di.run_chart_job` takes `bars_fn(ticker, tf, n)`, `quote_fn(ticker)` and
`house_fn(sym, tf, stats, options)` and treats `None` as "did not work". This module builds those
three from a `JobContext`, so the V2 handlers hand over **adapters** while the render function keeps
the exact interface it has today.

⛔⛔ THE INTERFACE IS DELIBERATELY UNCHANGED, AND THAT IS THE POINT OF DOING IT THIS WAY. The ground
rule for the whole of P2 is that with `DISCORD_RENDER_V2_ENABLED` unset, member-visible behaviour is
byte-for-byte identical. These bindings are reachable ONLY from `commands.py`, which runs only on the
V2 path; the pre-V2 path in `discord_interactions.py` still binds the raw functions and is not
touched. Rewriting `produce_chart` to consume `Result` objects is the opposite trade: a large change
to a shared function, to gain something the caller can already get from `last_result()`.

⭐ WHAT THE PATH GAINS ANYWAY, WITHOUT THE RENDER FUNCTION KNOWING: every upstream call is now bounded
by `min(dependency timeout, the job's REMAINING time)`, behind its own breaker, with a jittered retry
where one is wanted — and each call's `Result` is kept on the context, so the freshness stamp, the
degraded label and the structured event have a source that is not a `None`.

⛔ A `None` STILL MEANS "DID NOT WORK", BUT IT IS NO LONGER ALL WE KNOW. The old path threw the
reason away at three separate layers; `last_result(ctx, "bars")` is where it now lives.
"""
from __future__ import annotations

import threading

from api.services.discord_render import observe
from api.services.discord_render.adapters import bars as bars_adapter
from api.services.discord_render.adapters import classes
from api.services.discord_render.adapters import flow as flow_adapter
from api.services.discord_render.adapters import quote as quote_adapter
from api.services.discord_render.adapters import renderer as renderer_adapter
from api.services.discord_render.adapters.result import Result
from api.services.discord_render.adapters.switch import adapters_enabled

_ATTR = "_adapter_results"
_LOCK = threading.Lock()


def record(ctx, name: str, result: Result) -> Result:
    """Keep the most recent Result per upstream on the job context.

    ⚠️ MOST RECENT, not a list: a multi-chart job calls bars once per timeframe and an unbounded list
    on a long-lived context is a slow leak on a pod that already restarts every eight minutes. The
    per-call detail is in the structured event; this is for the reply that is about to be built."""
    with _LOCK:
        store = getattr(ctx, _ATTR, None)
        if store is None:
            store = {}
            setattr(ctx, _ATTR, store)
        store[name] = result
    return result


def last_result(ctx, name: str) -> Result | None:
    return (getattr(ctx, _ATTR, None) or {}).get(name)


def all_results(ctx) -> dict:
    return dict(getattr(ctx, _ATTR, None) or {})


def _remaining(ctx) -> float | None:
    """The job's remaining budget, or None when the context cannot say — never a guess. A default of
    'plenty' here would silently restore the unbounded call this layer exists to remove."""
    fn = getattr(ctx, "remaining_s", None)
    try:
        return float(fn()) if callable(fn) else None
    except Exception:  # noqa: BLE001
        return None


def bars_fn(ctx):
    """`(ticker, tf, n) -> list[dict] | None` — the shape `produce_chart` already calls."""
    if not adapters_enabled():
        from api.routers.discord_interactions import fetch_bars
        return fetch_bars
    def _fetch(ticker, tf, n):
        r = record(ctx, "bars", bars_adapter.fetch(bars_adapter.BarsRequest(
            ticker=ticker, tf=tf, n=n, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
            # ⛔ ONE ATTEMPT HERE, BECAUSE THE CALLER ALREADY RETRIES (OI-25). `produce_chart._fetch`
            # loops twice with a fixed 1.5 s wait; retrying in the adapter too would make FOUR bars
            # fetches per chart and sleep ~2.9 s inside a 15 s deadline.
            attempts=1)))
        return r.data if r.ok else None
    return _fetch


def quote_fn(ctx):
    """`(ticker) -> (session, price) | None`."""
    if not adapters_enabled():
        from api.routers.discord_interactions import fetch_ext_quote
        return fetch_ext_quote
    def _fetch(ticker):
        r = record(ctx, "quote", quote_adapter.fetch(quote_adapter.QuoteRequest(
            ticker=ticker, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx))))
        return r.data if r.ok else None
    return _fetch


def house_fn(ctx, inner=None):
    """`(sym, tf, stats, options) -> bytes | None`.

    The envelope from the bars call — which by construction has already happened, since the render
    function needs bars before it can draw them — is carried onto the render's Result, so the picture
    is stamped with the vintage of the data drawn in it rather than with the moment it was taken."""
    if not adapters_enabled():
        from api.services.discord_chart_house import render_house_chart
        return inner or render_house_chart

    def _render(sym, tf, stats, options=None):
        prior = last_result(ctx, "bars")
        r = record(ctx, "renderer", renderer_adapter.fetch(renderer_adapter.RenderRequest(
            ticker=sym, tf=tf, stats=stats, options=dict(options or {}),
            corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
            envelope=prior.envelope if prior and prior.ok else None), house_fn=inner))
        return r.data if r.ok else None
    return _render


# ── /flow ───────────────────────────────────────────────────────────────────
#
# `run_flow_card_job` already takes a `fetch_fn(ticker, days)` seam, so the adapter slots in without
# touching the posting, the card render, or the "no significant options flow" copy. Two halves:
#
#   * `flow_fetch_fn` fetches through the adapter and returns the dict the router expects, or None;
#   * `flow_fail_fn` wraps `ctx.fail` so the router's GENERIC class becomes a trigger and the
#     adapter's real one is what the member is told.
#
# ⛔ WHY THE WRAPPER AND NOT A ROUTER CHANGE. `fail_cls` is a local in `run_flow_card_job`; a
# `fetch_fn` cannot set it, so passing one would make every flow failure read `flow_error` —
# strictly worse than today, where the httpx branch at least distinguishes a timeout from a
# transport error. The wrapper keeps the router byte-identical (pre-V2 path untouched) and still
# gives the member the honest class, because by the time the router calls `fail_fn` the adapter has
# already recorded exactly what it saw.

def flow_fetch_fn(ctx, *, source: str = "stocks", top_n: int = 15):
    """`(ticker, days) -> dict | None`, the shape `run_flow_card_job` calls."""
    def _fetch(ticker, days):
        r = record(ctx, "flow", flow_adapter.fetch(flow_adapter.FlowRequest(
            ticker=ticker, days=str(days), source=source, top_n=top_n,
            corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx))))
        # ⭐ An empty tape comes back as `ok` with `contract_count == 0` — the router reads that off
        # `contracts` and prints its own "no significant options flow …" sentence. A quiet session
        # is an answer, not a failure, and must not reach the failure counters.
        return r.data if r.ok else None
    return _fetch


# ── the stamp: what the member actually sees (P2.6/P2.7, 04-visual-spec) ────
#
# ⛔⛔ A DEGRADED ARTIFACT ALWAYS CARRIES ITS LABEL (S8). C-06 measured three unlabelled stand-ins,
# two of which never healed: a member was handed a lower-quality chart and told nothing, so they
# read it as the product. An unlabelled stand-in is worse than a failure message — a failure is
# honest and a silent substitution is not.
#
# ⛔ AND IT MUST BE RARE OR IT IS FURNITURE. Nothing is appended when every upstream answered at
# house quality, which on a healthy path is every time. The opposite failure is just as real: the
# first freshness design would have drawn a badge on every chart all weekend (§3.8b), and a badge
# that shows when nothing is wrong is not there on the day it matters.

#: Discord's hard limit. The stamp is never the thing that gets trimmed — see `stamp`.
CONTENT_MAX = 2000


def stamp_suffix(ctx) -> str:
    """The one line appended to a degraded delivery, or `""` when there is nothing to say.

    Order is vintage · provenance · id (04-visual-spec §4). Each clause has ONE owner: the badge is
    `Envelope.badge`, never a second copy of that sentence."""
    results = all_results(ctx)
    parts = []
    badge = next((r.badge for r in results.values() if r.stale is True and r.badge), None)
    if badge:
        parts.append(badge)
    providers = {r.provider for r in results.values() if r.ok and r.provider in ("in_process", "cache")}
    if providers:
        # ⭐ Named, not "degraded". "a slower backup source" is something a member can act on;
        # "degraded" is a word that means nothing to them and everything to us.
        parts.append("served from a slower backup source")
    if not parts:
        return ""
    cid = ctx.job.corr_id if getattr(ctx, "job", None) else None
    return " · ".join(parts) + (f" · id {cid}" if cid else "")


def stamp(ctx, content) -> str:
    """Append the stamp to a message, once.

    ⛔ WHEN IT DOES NOT FIT, THE CONTENT IS TRIMMED AND THE STAMP IS KEPT. The other way round is
    the S8 violation with extra steps: a 2,000-character reply whose last clause fell off is exactly
    the unlabelled stand-in C-06 describes, and it would happen only on the longest — usually the
    most degraded — replies.

    ⛔ IDEMPOTENT. `produce_chart` edits the same message more than once (a stand-in, then the real
    chart); appending on each pass would give a member the same warning twice and would not be
    caught by a test that only ever calls it once."""
    text = str(content or "")
    suffix = stamp_suffix(ctx)
    if not suffix or text.endswith(suffix):
        return text
    joined = f"{text}\n{suffix}" if text else suffix
    if len(joined) <= CONTENT_MAX:
        return joined
    keep = CONTENT_MAX - len(suffix) - 2
    return (text[:max(0, keep)].rstrip() + "\n" + suffix) if keep > 0 else suffix[:CONTENT_MAX]


# ── the image PATCH: OI-29, and the close of C-04 ───────────────────────────
#
# ⛔⛔ 2.6 HARDENED THE TEXT PATH AND EVERY BYTE OF C-04'S EVIDENCE IS ON THE IMAGE PATH. The 23
# `ATTACHMENT_NOT_FOUND` refusals and the 23 `10015` finals are all multipart chart PATCHes, and
# none of them went through `delivery.py`. Two things here close it:
#
#   1. `delivery_edit_fn()` puts the image PATCH behind the same budget, retry, 429/5xx policy,
#      size guard and class table as the text PATCH (`delivery.edit_image`);
#   2. `_fold_attachments` deletes the mechanism outright: the context line's second PATCH
#      re-uploads the BYTES instead of re-declaring ids it read off the first PATCH's response.
#
# ⭐ WHY (2) IS THE FIX AND NOT (1). `01`'s root-cause paragraph is careful: the ids go stale if
# anything replaced the attachment between the two PATCHes, and the failure is deterministic (0 %
# load correlation). No amount of retry policy helps a payload that is wrong every time. **An id
# naming a part present in the same request cannot be stale** — so the class ends when we stop
# sending ids for something we are not uploading, and only then.
#
# ⚠️ IT COSTS ONE RE-UPLOAD OF THE PNG, and that is the trade, stated rather than hidden. A house
# chart is ~100-500 KB; the alternative priced at 23 measured deliveries that reached nobody.

_IMAGES = "_delivered_images"
#: Bound on what a context will hold for the fold. A multi-chart job delivers up to four images;
#: past this the fold is skipped and RECORDED, never silently — a job that quietly stopped folding
#: is C-04 back with no evidence that it returned.
FOLD_MAX_BYTES = 8 * 1024 * 1024

#: ⛔ THREAD-LOCAL, NOT MODULE-LEVEL. The runtime runs jobs on a worker pool; a shared "last
#: failure" slot would report one member's delivery failure on another member's job, which is
#: C-12 (a failure that cannot be tied to a request) manufactured by the fix for C-04.
_LOCAL = threading.local()


def last_delivery_failure():
    """The most recent failed delivery ON THIS THREAD, or None. Read by `commands._last_edit_failure`."""
    return getattr(_LOCAL, "delivery_failure", None)


def _remember_images(ctx, images) -> None:
    total = sum(len(b or b"") for b, _ in images)
    with _LOCK:
        if total > FOLD_MAX_BYTES:
            setattr(ctx, _IMAGES, None)
            observe.event("fold_skipped_too_large", cid=getattr(getattr(ctx, "job", None), "corr_id", None),
                          outcome="skipped", detail=f"{total} bytes > {FOLD_MAX_BYTES}")
            return
        setattr(ctx, _IMAGES, list(images))


def _fold_attachments(ctx, kw: dict) -> dict:
    """Turn a re-declare-the-ids edit into a re-upload-the-bytes edit.

    `run_chart_job._context_follow_up` passes `keep_attachments` — the ids off the first edit's
    response. Those ids are exactly what C-04 is. If we still hold the bytes we sent, we send them
    again and drop the ids; if we do not, we leave the edit alone and RECORD that we could not
    fold, because a fold that silently did nothing is indistinguishable from one that worked."""
    if "keep_attachments" not in kw:
        return kw
    images = getattr(ctx, _IMAGES, None)
    cid = getattr(getattr(ctx, "job", None), "corr_id", None)
    if not images:
        observe.event("fold_unavailable", cid=cid, outcome="passthrough",
                      detail="no bytes held; ids re-declared as before")
        return kw
    out = {k: v for k, v in kw.items() if k != "keep_attachments"}
    if len(images) == 1:
        out["png"], out["filename"] = images[0]
    else:
        out["pngs"] = list(images)
    observe.event("attachments_folded", cid=cid, outcome="folded", detail=f"n={len(images)}")
    return out


def delivery_edit_fn():
    """`discord_interactions.edit_original`'s signature, served by `delivery.py`.

    This is what the V2 runtime is handed in place of the raw function, so the chart image travels
    the same hardened path the failure sentence already does.

    ⛔ THE KILL SWITCH IS READ PER CALL, not captured at construction. `get_runtime()` builds one
    runtime and keeps it; a switch consulted once would make `DISCORD_RENDER_V2_ADAPTERS_ENABLED=0`
    a lie for the life of the pod, which is the flag-that-reaches-nothing defect this repo has
    paid for more than once."""
    def _edit(app_id, token, *, content="", png=None, filename=None, components=None,
              pngs=None, keep_attachments=None, deadline_s=None, cid: str = "", **ignored):
        from api.services import discord_interactions as di
        if not adapters_enabled():
            return di.edit_original(app_id, token, content=content, png=png, filename=filename,
                                    components=components, pngs=pngs,
                                    keep_attachments=keep_attachments)
        from api.services.discord_render import delivery
        images = list(pngs) if pngs else ([(png, filename)] if png is not None else [])
        if images:
            res = delivery.edit_image(app_id, token, content=content, images=images,
                                      components=components, deadline_s=deadline_s, cid=cid)
        else:
            res = delivery.edit_text(app_id, token, content=content, components=components,
                                     attachments=keep_attachments, deadline_s=deadline_s, cid=cid)
        _LOCAL.delivery_failure = None if res.ok else res
        # ⛔ `res.message or True`, NEVER `res.message`. A 2xx with a body Discord did not make
        # readable is a SUCCESS; returning its `None` would tell `JobContext.edit` the delivery
        # failed and send the member a failure sentence under a chart that arrived.
        return (res.message or True) if res.ok else False
    return _edit


def edit_fn(ctx):
    """`ctx.edit`, with the stamp applied and the attachment ids folded away.

    ⛔ THE WRAPPER, NOT THE RENDER FUNCTION. `produce_chart` builds the content and knows nothing
    about adapters; stamping here means every path it can take — the fast cached reply, the
    stand-in, the final chart, the multi-chart — is labelled by construction rather than by
    remembering to label it at four call sites. That "remember at every site" is how C-06 produced
    three unlabelled stand-ins.

    ⛔ AND THE SAME ARGUMENT IS WHY THE FOLD LIVES HERE. It could have gone in
    `run_chart_job._context_follow_up`, one layer down — but that is a PRE-V2 file, shared with the
    path this programme guarantees is byte-for-byte unchanged. Folding in the wrapper closes the
    class on the path V2 members take and touches nothing the old path can see."""
    inner = ctx.edit
    if not adapters_enabled():
        return inner

    def _edit(app_id, token, **kw):
        kw = _fold_attachments(ctx, kw)
        if "content" in kw:
            kw = {**kw, "content": stamp(ctx, kw.get("content"))}
        images = list(kw.get("pngs") or []) or ([(kw["png"], kw.get("filename"))]
                                                if kw.get("png") is not None else [])
        kw.setdefault("deadline_s", _remaining(ctx))
        kw.setdefault("cid", getattr(getattr(ctx, "job", None), "corr_id", "") or "")
        sent = inner(app_id, token, **kw)
        if sent and images:
            _remember_images(ctx, images)
        return sent
    #: ⭐ Advertised so a caller that wants to know can ask, rather than inferring it from the
    #: absence of a failure. Nothing in the pre-V2 path reads it, which is the point.
    _edit.folds_attachments = True
    return _edit


def flow_fail_fn(ctx):
    """`(cls, detail) -> bool` — `ctx.fail`, with the class corrected from what the adapter saw."""
    def _fail(cls, detail=""):
        r = last_result(ctx, "flow")
        if r is not None and not r.ok:
            real = classes.for_result("flow", r)
            if real != cls:
                detail = f"{detail or ''} ({r.provider}: {r.reason()})".strip()
            cls = real
        return ctx.fail(cls, detail)
    return _fail
