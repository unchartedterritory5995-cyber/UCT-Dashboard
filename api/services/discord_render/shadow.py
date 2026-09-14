"""Shadow mode: what would V2 have ANSWERED? — without a member ever seeing it (P2.10).

`RENDER_V2_SHADOW=1` with `DISCORD_RENDER_V2_ENABLED` still unset. The pre-V2 path serves the
member exactly as it does today; alongside it, this records the acknowledgement V2 *would* have
returned, so the flip is a decision made on production traffic rather than on a bench.

⛔⛔ IT COMPARES THE ACK, AND ONLY THE ACK. Not the chart, not the delivery, not the queue. Running
the V2 producer in shadow would mean a second render per request on the pod that already has one
event loop and one shared thread pool — that is C-02, caused deliberately, to measure something a
bench already answers. What a bench CANNOT answer is the ack decision on real traffic: which
symbols members actually type, which of them V2 would refuse, and whether it would defer where the
old path replies. That is the risk the flip carries, and this is the cheapest honest way to see it.

⛔⛔ IT CANNOT DELIVER, BY CONSTRUCTION AND NOT BY CARE. Nothing here touches `app_id`, the
interaction `token`, the runtime, the jobs store or `edit`. The only output is a `drender` event.
A shadow that could write to Discord is not a shadow, and "we were careful" is not a mechanism —
`tests/test_discord_render_shadow.py` asserts the module names none of those.

⛔ AND IT IS BOUNDED BY ITS OWN BUDGET, SEPARATELY FROM THE MEMBER'S. The member's reply is already
on its way; a shadow that made them wait would be measuring the cost of measuring. Past
`SHADOW_BUDGET_S` it records `budget` and stops — a missing sample, never a slow ack.
"""
from __future__ import annotations

import os
import time

ENV = "RENDER_V2_SHADOW"
#: ⛔⛔ IT MUST NOT BE STRICTER THAN THE PATH IT MODELS. This matches `commands.SYMBOL_BUDGET_S`
#: (0.6 s), the budget the real V2 ack path gives the same symbol check.
#:
#: ⚰️ It was 0.4 s — "its own budget, well under the ack path's, because it runs beside a reply that
#: has already gone" — which sounds careful and is wrong. A shadow that gives up sooner than the
#: thing it models bails on exactly the slow lookups V2 would have completed, so it MISSES the
#: refusals it exists to find and under-reports divergence in the one direction nobody would query.
#: Caught by a local run coming back `outcome=budget` on a cold index, where the ack path's 0.6 s
#: would have answered. It runs on a pool thread after the reply has gone, so the extra 200 ms costs
#: a member nothing.
SHADOW_BUDGET_S = 0.6


def enabled() -> bool:
    """⛔ DEFAULT OFF, unlike the kill switches. This one ADDS work; an enablement gate that
    defaulted on would turn itself on in every environment the moment it merged."""
    return str(os.environ.get(ENV, "")).strip().lower() in ("1", "true", "yes", "on")


def run_safely(interaction: dict, pre_v2_reply: dict | None) -> dict | None:
    """What the pool actually runs. `observe_ack` behind one guard that REPORTS.

    ⛔⛔ A FUTURE NOBODY READS SWALLOWS EVERYTHING. The route submits this to a thread pool
    and never calls `.result()`, so an exception inside it is not raised anywhere — the
    request is safe, and the shadow could be failing on every single interaction with
    nothing to show for it. That is the silent-failure shape this whole programme exists to
    close, re-created by the very mechanism that protects the member.

    ⚰️ Found by a mutation that stayed GREEN: narrowing the ROUTE's `except Exception` to
    `except ValueError` changed nothing, because the route never sees this exception at all.
    The route's guard covers the setup — the import, the flag read, the submit — and this
    one covers the work."""
    try:
        return observe_ack(interaction, pre_v2_reply=pre_v2_reply)
    except Exception as e:  # noqa: BLE001
        from api.services.discord_render import observe
        observe.event("shadow", outcome="error", detail=type(e).__name__)
        return None


def observe_ack(interaction: dict, *, pre_v2_reply: dict | None, resolve=None, now=time.perf_counter) -> dict:
    """Record what V2's ack decision would have been. Returns the comparison, for the log and tests.

    `pre_v2_reply` is what the member is ACTUALLY getting, so the two can be compared rather than
    described separately — a shadow that reports only its own answer leaves the reader to remember
    the other one."""
    from api.services.discord_render import observe, symbols

    started = now()
    data = interaction.get("data") or {}
    itype = interaction.get("type")
    command = str(data.get("name") or "")
    out: dict = {"cmd": command, "itype": itype}

    tickers = _tickers(interaction)
    verdicts: list = []
    if tickers:
        resolve = resolve or symbols.resolve
        for t in tickers:
            if (now() - started) > SHADOW_BUDGET_S:
                out["budget"] = True         # ⛔ a MISSING sample, never a slow ack
                break
            try:
                verdicts.append(resolve(t))
            except Exception as e:  # noqa: BLE001 — a shadow must never affect the request it shadows
                out["error"] = type(e).__name__
                break

    refused = [v.symbol for v in verdicts if getattr(v, "status", None) == symbols.UNKNOWN]
    unanswerable = [v.symbol for v in verdicts if getattr(v, "status", None) == symbols.UNANSWERABLE]
    out["symbols"] = len(tickers)
    out["would_refuse"] = ",".join(refused) if refused else None
    # ⛔⛔ WITHOUT THIS, A DIVERGENCE OF ZERO IS UNINTERPRETABLE — and zero is the number the flip
    # decision rests on. "V2 agreed with the old path" and "V2 could not tell" both produce no
    # refusals, and only this count separates them. A run that recorded a quiet weekend of perfect
    # agreement, when what actually happened was that every symbol check failed open, is an
    # instrument reporting its own blind spot as a property of what it measured.
    out["unanswerable"] = ",".join(unanswerable) if unanswerable else None
    out["index_ready"] = _index_ready()
    out["pre_v2_type"] = (pre_v2_reply or {}).get("type")
    # ⭐ The single number worth watching through a session: how often V2 would have told a member
    # "I don't have that symbol" where the old path went ahead and drew something.
    out["divergence"] = bool(refused) and (pre_v2_reply or {}).get("type") in (5, 6)
    out["ms"] = round((now() - started) * 1000.0, 1)
    # ⛔⛔ EMIT WITHIN `observe._FIELDS`, OR THE RECORD REACHES THE LOG EMPTY.
    # ⚰️ `observe.event` keeps ONLY the fields in its allowlist and drops the rest **silently**. The
    # first version of this passed `symbols`, `would_refuse`, `unanswerable`, `index_ready`,
    # `divergence` and `pre_v2_type` — none of them allowlisted — so the line that actually reached
    # production was `{"t":"drender","evt":"shadow","cmd":"chart","ms":12.3}`. Shadow mode ran live
    # for twenty minutes producing content-free records that LOOKED like it was working, and
    # Monday's data would have been worthless. Found by reading the emitter, not by watching the
    # output: the line was there, so nothing looked wrong.
    observe.event("shadow", cmd=command, ms=out["ms"], outcome=outcome(out), detail=detail(out))
    return out


def outcome(rec: dict) -> str:
    """The one greppable word. ⛔ `could_not_tell` is a SEPARATE outcome from `agree`, for the same
    reason `unanswerable` is a separate field: a run of quiet agreement and a run where every check
    failed open are the same zero, and only this distinguishes them."""
    if rec.get("error"):
        return "error"
    if rec.get("divergence"):
        return "divergence"
    if rec.get("unanswerable"):
        return "could_not_tell"
    if rec.get("budget"):
        return "budget"
    return "agree"


def detail(rec: dict) -> str:
    """Compact, greppable, and inside the allowlist. `observe.scrub` still runs over it."""
    idx = rec.get("index_ready")
    return (f"n={rec.get('symbols', 0)}"
            f" refuse={rec.get('would_refuse') or '-'}"
            f" unans={rec.get('unanswerable') or '-'}"
            f" idx={'1' if idx is True else '0' if idx is False else '?'}"
            f" pre={rec.get('pre_v2_type')}")


def _index_ready() -> bool | None:
    """Whether the symbol authorities can answer at all, in THIS process.

    ⚰️ ⛔ AND "THIS PROCESS" IS THE POINT, LEARNED THE HARD WAY 2026-09-13. A `railway ssh` probe
    spawns a **different** Python from the uvicorn server (pid 569 vs pid 1) and imports every module
    COLD — so `ticker_search_index.ready()` reads False there while the server has the index fully
    loaded. A probe run that way reported every symbol as `unanswerable` and looked exactly like a
    production defect; `/api/ticker-search?q=NV` through the real server returned real rows seconds
    later. **A pod probe measures the probe's process.** Timing from one is an upper bound (which
    `05-progress` already said); a VERDICT from one can be simply wrong.

    Recorded on the shadow line so Monday's data says which process state produced it."""
    try:
        from api.services.discord_render import symbols
        return bool(symbols._index_ready())
    except Exception:  # noqa: BLE001
        return None


def _tickers(interaction: dict) -> list[str]:
    """The symbols this interaction is about, or `[]`. Never raises — a shadow that can break the
    request it is shadowing is worse than no shadow."""
    try:
        from api.services import discord_interactions as di
        data = interaction.get("data") or {}
        name = str(data.get("name") or "")
        if name in di.CHART_COMMAND_NAMES:
            return [r.ticker for r in di.parse_chart_requests(interaction, default_tf="D")][:4]
        if name == di.FLOW_COMMAND:
            tkr, _days = di.parse_flow_command(interaction)
            return [tkr] if tkr else []
    except Exception:  # noqa: BLE001
        return []
    return []
