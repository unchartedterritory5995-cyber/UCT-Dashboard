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

from api.services.discord_render import artifact_cache
from api.services.discord_render import badge as badge_mod
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
            ticker=ticker, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
            # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. The ext-hours chip is decoration: a member
            # waits for the CHART, not for this, so a retry spends the chart's budget on a field
            # that can simply be omitted. Stated rather than inherited from `quote.ATTEMPTS`.
            attempts=1)))
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
        envelope = prior.envelope if prior and prior.ok else None

        def _produce():
            r = record(ctx, "renderer", renderer_adapter.fetch(renderer_adapter.RenderRequest(
                ticker=sym, tf=tf, stats=stats, options=dict(options or {}),
                corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
                envelope=envelope,
                # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. `produce_chart` already has its own
                # second chance — the mplfinance stand-in — so a retry here buys a slower path to
                # the same fallback while the member waits. Stated rather than inherited.
                attempts=1), house_fn=inner))
            return r.data if r.ok else None

        return _cached_render(ctx, sym, tf, options, envelope, _produce)
    return _render


# ── 2.5 wired to the hot path (D-02, OI-31) ─────────────────────────────────

def _cached_render(ctx, sym, tf, options, envelope, produce):
    """L1 → L2 → render, behind `RENDER_CACHE_ENABLED`.

    ⛔⛔ WITH THE FLAG OFF THIS IS `produce()` AND NOTHING ELSE — not a lookup that misses, not a
    key computed and thrown away. The V2 path has to be byte-for-byte what it was before the cache
    existed when the gate is off, and "we only did the cheap part" is how a flag stops being a flag.

    ⛔⛔ THE VINTAGE IS IN THE KEY, AND THAT IS WHY A HIT NEEDS NO LABEL. Two renders of the same
    symbol at the same data vintage are the same picture; serving the stored one is not a
    degradation and marking it "served from a slower backup source" would be furniture — the exact
    thing 04 §2 forbids. What a member is told about freshness comes from the ENVELOPE, which is
    identical either way. ⚠️ The corollary is the load-bearing half: if the vintage ever stops being
    part of the key, this comment becomes a lie and the cache starts serving yesterday's chart under
    today's badge.

    ⛔ A STAND-IN IS NEVER STORED (OI-32). It cannot reach here anyway — `house_fn` is the HOUSE
    render and the stand-in is drawn by `produce_chart`'s own fallback — but the flag is set
    explicitly rather than left to that argument, because "it cannot happen" is a claim about a
    caller and callers change.
    """
    if not artifact_cache.enabled():
        return produce()

    key = artifact_cache.key_for("chart", {
        "ticker": sym, "tf": tf,
        # only the options that change the PICTURE; anything else would split the key space and
        # quietly drop the hit rate to zero while every test still passed
        "opts": artifact_cache.normalise_args({k: v for k, v in (options or {}).items()
                                               if k in RENDER_KEY_OPTS}),
    }, vintage=artifact_cache.vintage_of(envelope))

    store = artifact_cache.store()
    # ⛔ THE TIER IS MEASURED PER LOOKUP, NOT READ OFF A RUNNING TOTAL. A first version reported
    # `l1` whenever the process had ever had a hit, which is a global counter answering a
    # per-request question — and it would have made the flip packet's "cache hit rate L1/L2" a
    # number that could not be wrong.
    before = store.stats()
    hit = store.get(key)
    if hit is not None:
        after = store.stats()
        from_l2 = (after.get("l2_promotions", 0) > before.get("l2_promotions", 0)
                   or after.get("l2_served_unpromoted", 0) > before.get("l2_served_unpromoted", 0))
        observe.event("cache_hit", cid=getattr(getattr(ctx, "job", None), "corr_id", None),
                      cmd="chart", sym=sym, tf=str(tf), outcome="hit",
                      detail=f"tier={'l2' if from_l2 else 'l1'}")
        return hit.data
    observe.event("cache_miss", cid=getattr(getattr(ctx, "job", None), "corr_id", None),
                  cmd="chart", sym=sym, tf=str(tf), outcome="miss")

    budget = _remaining(ctx)
    data = store.coalesce(key, produce, budget_s=budget if budget is not None else 0.0)
    if data is not None:
        store.put(key, artifact_cache.Artifact(data=data, envelope=envelope, provider="renderer"))
    return data


#: The render options that change the PICTURE. ⛔ Deliberately a small, named set: keying on the
#: whole options dict would put a per-member preference blob in the key and give every member their
#: own cache entry, which is a 0 % hit rate that no test would notice.
RENDER_KEY_OPTS = ("style", "darkpool", "compare", "to", "ext", "bars", "instances")


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
            corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
            # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. This adapter already has a SECOND leg —
            # the in-process fallback — so a retry would mean up to four flow-worker round trips
            # plus a local recompute inside one member's budget. The fallback IS the retry.
            attempts=1)))
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

#: Discord's hard limit. The stamp is never the thing that gets trimmed — see `badge.stamp`.
CONTENT_MAX = badge_mod.CONTENT_MAX


def standin_class(ctx, *, has_image: bool) -> str | None:
    """The failure class to label a stand-in with, or None when this is not a stand-in (C-06).

    ⛔⛔ A STAND-IN IS "THE HOUSE RENDERER WAS ASKED AND AN IMAGE WENT OUT ANYWAY", and that
    conjunction is the whole definition. `produce_chart` asks the house renderer first and falls
    back to the mplfinance drawing; the fallback is not a separate call this layer can see, so the
    tell is a recorded renderer FAILURE beside a delivery that carries a picture.

    ⭐ THIS IS WHY C-06's MEMBER-VISIBLE HALF COULD BE CLOSED WITHOUT TOUCHING `produce_chart`.
    The outcome tag (`fallback`) lives in a pre-V2 file under the byte-for-byte guarantee — but the
    same fact is already on the context, because `house_fn` records every renderer `Result`. The
    wrapper can derive what the render function would have had to be asked to report.

    ⛔ AND NOT ON A FAILURE. When the render fails and NO image goes out, the member gets the
    failure contract's sentence; labelling that as a "simplified chart" would name a picture that
    does not exist."""
    if not has_image:
        return None
    r = last_result(ctx, "renderer")
    if r is None or r.ok:
        return None
    return classes.for_result("renderer", r)


def stamp_suffix(ctx, *, has_image: bool = False) -> str:
    """The one footer line for this context, or `""` when there is nothing to say.

    ⛔ THIS IS A DERIVATION, NOT A SECOND COPY. It used to compose the sentence itself — badge,
    backup clause and id, all spelled here — beside a `badge.py` that composed the same line and
    was imported by nothing. It now asks `badge.render_footer`, which is the one owner.

    ⭐ IT IS KEPT AS A NAME BECAUSE THE RAILS USE IT AS ONE. `test_the_edit_wrapper_stamps_every
    _path_the_render_function_can_take` asserts `stamp_suffix(ctx) in content` — it DERIVES the
    expected value rather than typing it, which is why it survived this change pointing at the
    right property. Deleting the accessor would have forced those tests to hardcode the copy, and
    a hardcoded expectation is the second authority all over again, one layer out."""
    cls = standin_class(ctx, has_image=has_image)
    return badge_mod.render_footer(
        all_results(ctx),
        ctx.job.corr_id if getattr(ctx, "job", None) else None,
        quality=badge_mod.standin_label(cls) if cls else None)


def stamp(ctx, content, *, has_image: bool = False) -> str:
    """Append the one footer line to a message, once.

    ⛔⛔ THE COPY IS `badge.py`'s AND NOT THIS MODULE'S. This used to compose its own suffix —
    the badge sentence, the backup clause and the id, all spelled again here — beside a
    `badge.py` that composed the same line and was imported by nothing. **Two authors over the one
    sentence a member reads**, which is the defect the whole freshness design exists to remove, and
    it survived because both copies agreed on the day they were written.

    ⛔ ORDER IS QUALITY · VINTAGE · PROVENANCE · ID, ON ONE LINE (04 §4). One line, not two, and
    that is load-bearing: `badge.stamp` recognises its own previous stamp by the trailing ` · id`
    and cuts exactly ONE line, so a quality clause on a second line would survive onto the HEALED
    chart as a stale warning. `produce_chart` edits the same message twice — stand-in, then the
    real chart — so that is not a hypothetical.
    """
    return badge_mod.stamp(content, stamp_suffix(ctx, has_image=has_image))


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
        images = list(kw.get("pngs") or []) or ([(kw["png"], kw.get("filename"))]
                                                if kw.get("png") is not None else [])
        if "content" in kw:
            # ⛔ `has_image` IS COMPUTED BEFORE THE STAMP, NOT AFTER. The stand-in label (C-06) is
            # only correct on a delivery that actually carries a picture, and the fold above can
            # turn a text-only edit into one — so the question has to be asked of the edit that is
            # about to go out, never of the edit the caller wrote.
            kw = {**kw, "content": stamp(ctx, kw.get("content"), has_image=bool(images))}
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
