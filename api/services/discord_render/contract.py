"""The failure message contract (owner decision D-05).

Every user-visible failure on the V2 path is built HERE and nowhere else:

    "<command> failed — <class in plain English> · id <corr-id> · retry?"  + [Retry]

⛔ Never a stack trace, an exception string or a URL. The builder takes a CLASS, not an
exception, so there is nothing for a traceback to leak through; a rail asserts the
output of every class.

⛔ Why a class and not the old per-site sentences: for two weeks `/flow` answered
"The flow feed is reconnecting" to a 30 s timeout (2026-09-11 AMD/AMDL), to a
flow-worker restart (2026-09-08 SPCX) and to every other non-ok read. A sentence per
call site drifts into one sentence for every cause. One table cannot.
"""
from __future__ import annotations

from api.services.discord_render.ids import is_corr_id

# class -> what a member reads. Keep these short, specific and true.
FAILURE_CLASSES: dict[str, str] = {
    "ack_late": "Discord closed the request before we answered",
    "queue_full": "we're at capacity right now",
    "deadline": "the chart service took too long",
    "renderer_unavailable": "the chart renderer is unavailable",
    "data_unavailable": "market data for this symbol couldn't be loaded",
    "symbol_not_found": "I don't have that symbol",
    "no_bars": "there are no bars for this symbol and timeframe",
    "flow_timeout": "the options-flow service didn't answer in time",
    "flow_unavailable": "the options-flow service is unavailable",
    "flow_error": "the options-flow service returned an error",
    "discord_rejected": "Discord refused the message",
    "rate_limited": "Discord is rate-limiting us",
    "restarted": "UCT restarted while this was rendering",
    "internal": "something went wrong on our side",
}

# Classes that are the member's input, not our failure: excluded from the success-rate SLO.
USER_ERROR_CLASSES = frozenset({"symbol_not_found", "no_bars"})

RETRY_PREFIX = "rt"
CONTENT_MAX = 2000


def plain(cls: str) -> str:
    return FAILURE_CLASSES.get(cls, FAILURE_CLASSES["internal"])


def normalize_class(cls: str | None) -> str:
    return cls if cls in FAILURE_CLASSES else "internal"


def retry_custom_id(cid: str) -> str:
    return f"{RETRY_PREFIX}|{cid}"


def parse_retry(custom_id: str | None) -> str | None:
    """The corr id a Retry button carries, or None for anything else."""
    parts = str(custom_id or "").split("|")
    if len(parts) == 2 and parts[0] == RETRY_PREFIX and is_corr_id(parts[1]):
        return parts[1]
    return None


def command_label(command: str, args: dict | None = None) -> str:
    """How the message names what failed: "/chart NVDA", "/flow DPRO · 30 days"."""
    a = args or {}
    cmd = str(command or "").strip().lstrip("/")
    if cmd in ("chart", "c", "charts"):
        tickers = a.get("tickers") or ([a["ticker"]] if a.get("ticker") else [])
        return ("/chart " + " ".join(str(t) for t in tickers)).strip()
    if cmd == "flow":
        days = str(a.get("days") or "1")
        window = "today" if days == "1" else ("all history" if days == "all" else f"{days} days")
        return f"/flow {a.get('ticker', '')} · {window}".replace("  ", " ").strip()
    if cmd == "buzz":
        return "/buzz"
    if cmd == "controls":
        return "Chart update"
    if cmd == "popup":
        return f"Chart {a.get('ticker', '')}".strip()
    return f"/{cmd}" if cmd else "Request"


def failure_content(label: str, cls: str, cid: str) -> str:
    text = f"{label} failed — {plain(cls)} · id {cid} · retry?"
    return text[:CONTENT_MAX]


def failure_components(cid: str) -> list:
    """One row, one button. No emoji: an invalid emoji rejects the whole tree
    (COMPONENT_INVALID_EMOJI stripped every chart's controls for a week)."""
    return [{"type": 1, "components": [
        {"type": 2, "style": 2, "label": "Retry", "custom_id": retry_custom_id(cid)}]}]
