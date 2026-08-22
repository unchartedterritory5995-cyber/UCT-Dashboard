"""api/services/cot_prewarm.py -- Friday pre-warm of the COT weekly reads.

WHAT THIS IS
------------
`cot_narrative.get_or_create` writes one ~150-word read per (symbol, report
week) the first time a member asks for it, so the first member to open the COT
tab after a Friday refresh pays the model latency on every symbol they click.
This job walks every COT symbol once the Friday CFTC refresh has landed and asks
for the read up front; by Monday the tab serves cached prose.

THE FACTS BUNDLE (single authority -- this module only CONSUMES it)
------------------------------------------------------------------
The positioning analytics live in JavaScript. `npm run build` emits
`app/dist/cot-facts.cjs`, a self-contained Node CLI:

    node cot-facts.cjs proxies         -> {"ES": {"ticker": "SPY", "note": "via SPY"}, "ZR": null, ...}
    node cot-facts.cjs facts  < stdin  -> {"report_date", "facts", "read": {headline, bias, crowding, watch}}
        stdin: {"symbol", "name", "rows": [COT records ascending], "bars": [weekly bars] | null}
        non-zero exit + stderr on bad input

A missing bundle or a missing `node` is a logged `{"skipped": "no-bundle"}`,
never a raise: the scheduler job must be inert on a box without the build, and
no member request path depends on this module.

PROXY BARS
----------
Weekly bars for a symbol's price proxy are read IN-PROCESS through
`api.routers.bars.get_bars` -- the same 3-layer cache a chart hits, with no
self-HTTP through Cloudflare and no auth round trip. The loopback HTTP GET is
the fallback only when the in-process call itself raised.

ENV (all read at call time)
---------------------------
    COT_PREWARM_ENABLED   default "1"  -- anything else: {"skipped": "disabled"}
    COT_FACTS_BUNDLE      bundle path (default <repo>/app/dist/cot-facts.cjs)
    COT_NODE_BIN          node binary (default "node", resolved on PATH)
    PORT                  loopback port for the HTTP fallback (default 8000)

ENTRY POINTS
------------
    run_prewarm(symbols=None) -> summary dict (see `_new_summary`); never raises
    last_status()             -> the last summary + `running`, or {"ran": False}
    proxies() / facts_for() / fetch_proxy_bars()  -- the three pieces, patchable
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
from datetime import datetime, timezone

from api.services import cot_narrative, cot_service

logger = logging.getLogger(__name__)

ENABLED_ENV = "COT_PREWARM_ENABLED"   # default "1", read at call time
BUNDLE_ENV  = "COT_FACTS_BUNDLE"
NODE_ENV    = "COT_NODE_BIN"
PORT_ENV    = "PORT"

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_BUNDLE = os.path.join(_REPO_ROOT, "app", "dist", "cot-facts.cjs")
DEFAULT_NODE   = "node"

ROWS_WEEKS = 520        # 10 years of weekly records; the bundle's 3y index needs far less
BARS_COUNT = 600        # weekly proxy bars (~11.5 years)
MIN_ROWS   = 2          # below this there is no positioning read to write
BUNDLE_TIMEOUT_S = 60
HTTP_TIMEOUT_S   = 20

_LOCK = threading.Lock()        # one run at a time; a second caller gets {"skipped": "busy"}
_LAST: dict = {"ran": False}    # the last run summary, for `last_status()`
_RUNNING = False
_PROXIES: dict | None = None    # cached per process after the first SUCCESSFUL call
_PROXIES_LOCK = threading.Lock()


# -- config (read at call time) -----------------------------------------------

def _enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1").strip() == "1"


def bundle_path() -> str:
    return os.environ.get(BUNDLE_ENV, "").strip() or DEFAULT_BUNDLE


def node_bin() -> str:
    return os.environ.get(NODE_ENV, "").strip() or DEFAULT_NODE


def _resolve_node() -> str | None:
    """The node binary as an executable path, or None when there is none."""
    n = node_bin()
    if os.path.sep in n or (os.path.altsep and os.path.altsep in n):
        return n if os.path.isfile(n) else None
    return shutil.which(n)


def bundle_available() -> bool:
    return os.path.isfile(bundle_path()) and _resolve_node() is not None


# -- the bundle ---------------------------------------------------------------

def _run_bundle(command: str, payload=None):
    """`node <bundle> <command>` with `payload` (if any) as stdin JSON; the
    parsed stdout JSON, or None (logged) on ANY failure."""
    node = _resolve_node()
    bundle = bundle_path()
    if node is None or not os.path.isfile(bundle):
        logger.warning("[cot_prewarm] bundle unavailable (node=%r bundle=%r)", node_bin(), bundle)
        return None
    stdin = json.dumps(payload, default=str) if payload is not None else None
    try:
        proc = subprocess.run(
            [node, bundle, command], input=stdin, capture_output=True, text=True,
            encoding="utf-8", timeout=BUNDLE_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("[cot_prewarm] `%s` did not run: %s: %s", command, type(exc).__name__, exc)
        return None
    if proc.returncode != 0:
        logger.warning("[cot_prewarm] `%s` exited %s: %s", command, proc.returncode,
                       (proc.stderr or "").strip()[:400])
        return None
    try:
        return json.loads(proc.stdout or "")
    except ValueError as exc:
        logger.warning("[cot_prewarm] `%s` returned non-JSON stdout: %s", command, exc)
        return None


def proxies() -> dict:
    """symbol -> {"ticker", "note"} | None, from the bundle. Cached per process
    after the first successful call; a failure returns {} and is retried next time."""
    global _PROXIES
    with _PROXIES_LOCK:
        if _PROXIES is not None:
            return _PROXIES
        out = _run_bundle("proxies")
        if not isinstance(out, dict):
            return {}
        _PROXIES = out
        return _PROXIES


def facts_for(symbol: str, name: str, rows: list, bars) -> dict | None:
    """The bundle's `{"report_date", "facts", "read"}` for one symbol, or None
    (logged) when the bundle failed or answered with the wrong shape."""
    out = _run_bundle("facts", {"symbol": symbol, "name": name, "rows": rows, "bars": bars})
    if out is None:
        return None
    if (not isinstance(out, dict) or not out.get("report_date")
            or not isinstance(out.get("facts"), dict)):
        logger.warning("[cot_prewarm] facts for %s came back malformed: %s", symbol, str(out)[:200])
        return None
    return out


# -- proxy bars ---------------------------------------------------------------

def _payload_of(resp) -> dict:
    """A bars handler result as a dict. `get_bars` returns an ORJSONResponse
    (bytes body); a plain dict is accepted too."""
    if isinstance(resp, dict):
        return resp
    body = getattr(resp, "body", None)
    if body is None:
        return {}
    if isinstance(body, (bytes, bytearray, memoryview)):
        body = bytes(body).decode("utf-8")
    data = json.loads(body) if body else {}
    return data if isinstance(data, dict) else {}


def _bars_in_process(ticker: str) -> list:
    from api.routers import bars as bars_router
    # Every query param passed explicitly: called directly, an omitted one is the
    # `Query(...)` FieldInfo object, which is TRUTHY and would route the call into
    # the replay (`to`) branch.
    resp = bars_router.get_bars(ticker, tf="W", bars=BARS_COUNT, since="", to="", warm=0)
    status = getattr(resp, "status_code", 200)
    payload = _payload_of(resp)
    if status >= 400:
        logger.warning("[cot_prewarm] bars %s W -> %s (%s)", ticker, status, payload.get("error"))
        return []
    out = payload.get("bars")
    return out if isinstance(out, list) else []


def _bars_over_http(ticker: str) -> list:
    import requests
    port = os.environ.get(PORT_ENV, "").strip() or "8000"
    url = f"http://127.0.0.1:{port}/api/bars/{ticker}?tf=W&bars={BARS_COUNT}"
    r = requests.get(url, timeout=HTTP_TIMEOUT_S)
    if r.status_code >= 400:
        logger.warning("[cot_prewarm] bars %s over loopback HTTP -> %s", ticker, r.status_code)
        return []
    data = r.json()
    out = data.get("bars") if isinstance(data, dict) else None
    return out if isinstance(out, list) else []


def fetch_proxy_bars(ticker: str) -> list:
    """Weekly bars for a price proxy -- in-process first (see the module
    docstring), loopback HTTP only if that raised. [] on any failure, logged:
    a missing proxy series just means the read has no price context this week."""
    t = (ticker or "").strip().upper()
    if not t:
        return []
    try:
        return _bars_in_process(t)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cot_prewarm] in-process bars for %s failed (%s: %s); trying loopback HTTP",
                       t, type(exc).__name__, exc)
    try:
        return _bars_over_http(t)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cot_prewarm] loopback bars for %s failed: %s: %s", t, type(exc).__name__, exc)
        return []


# -- the run ------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_summary(symbols: list[str]) -> dict:
    return {"ran": True, "ran_at": _now(), "report_date": None,
            "generated": 0, "cached": 0, "skipped": 0, "errors": [],
            "symbols": len(symbols), "results": {}}


def _sym_result(status: str, *, cached=False, report_date=None, read=None, reason=None) -> dict:
    read = read if isinstance(read, dict) else {}
    return {"status": status, "cached": bool(cached), "report_date": report_date,
            "headline": read.get("headline"), "bias": read.get("bias"),
            "watch": read.get("watch"), "reason": reason}


def _prewarm_one(sym: str, proxy_map: dict) -> dict:
    """rows -> proxy bars -> bundle facts -> narrative, for one symbol. May raise;
    `run_prewarm` is what catches."""
    rows = cot_service.get_cot_data(sym, ROWS_WEEKS)
    if len(rows) < MIN_ROWS:
        return _sym_result("skipped", reason=f"{len(rows)} rows")
    proxy = proxy_map.get(sym) if isinstance(proxy_map, dict) else None
    ticker = proxy.get("ticker") if isinstance(proxy, dict) else None
    bars = (fetch_proxy_bars(ticker) or None) if ticker else None
    name = cot_service.SYMBOL_NAMES.get(sym, sym)
    out = facts_for(sym, name, rows, bars)
    if out is None:
        return _sym_result("error", reason="facts")
    read = out.get("read")
    report_date = out["report_date"]
    nar = cot_narrative.get_or_create(sym, name, report_date, out["facts"])
    status = (nar or {}).get("status") or "error"
    return _sym_result(status, cached=(nar or {}).get("cached"), report_date=report_date,
                       read=read, reason=(nar or {}).get("reason"))


def run_prewarm(symbols=None) -> dict:
    """Write this week's read for every COT symbol (or `symbols`). Never raises.

    {"skipped": "disabled" | "busy" | "no-bundle"} when it did not run; otherwise
    the summary: ran_at, report_date, generated, cached, skipped, errors[],
    symbols, results{SYM: {status, cached, report_date, headline, bias, watch}},
    post (the weekly Discord post's own result)."""
    global _LAST, _RUNNING
    if not _enabled():
        logger.info("[cot_prewarm] %s is off -- skipping", ENABLED_ENV)
        _LAST = {"ran": False, "ran_at": _now(), "skipped": "disabled"}
        return {"skipped": "disabled"}
    if not _LOCK.acquire(blocking=False):
        logger.info("[cot_prewarm] a run is already in progress -- skipping")
        return {"skipped": "busy"}
    try:
        _RUNNING = True
        if not bundle_available():
            logger.warning("[cot_prewarm] no bundle at %s or no node binary (%s) -- skipping",
                           bundle_path(), node_bin())
            _LAST = {"ran": False, "ran_at": _now(), "skipped": "no-bundle"}
            return {"skipped": "no-bundle"}

        wanted = [s.strip().upper() for s in (symbols or []) if s and s.strip()] \
            or list(cot_service.SYMBOL_MAP)
        summary = _new_summary(wanted)
        proxy_map = proxies()
        for sym in wanted:
            try:
                res = _prewarm_one(sym, proxy_map)
            except Exception as exc:  # noqa: BLE001 -- one symbol never aborts the loop
                logger.error("[cot_prewarm] %s failed: %s: %s", sym, type(exc).__name__, exc)
                res = _sym_result("error", reason=f"{type(exc).__name__}: {exc}"[:200])
            summary["results"][sym] = res
            st = res["status"]
            if st == "ok":
                summary["cached" if res["cached"] else "generated"] += 1
            elif st == "skipped":
                summary["skipped"] += 1
            else:
                summary["errors"].append({"symbol": sym, "error": res.get("reason") or st})
            rd = res.get("report_date")
            if rd and (summary["report_date"] is None or rd > summary["report_date"]):
                summary["report_date"] = rd
        logger.info("[cot_prewarm] done: %d generated, %d cached, %d skipped, %d errors (report %s)",
                    summary["generated"], summary["cached"], summary["skipped"],
                    len(summary["errors"]), summary["report_date"])

        try:
            from api.services import cot_weekly_post
            summary["post"] = cot_weekly_post.post_most_watched(summary)
        except Exception as exc:  # noqa: BLE001
            logger.error("[cot_prewarm] weekly post failed: %s: %s", type(exc).__name__, exc)
            summary["post"] = {"posted": 0, "error": f"{type(exc).__name__}: {exc}"[:200]}
        summary["finished_at"] = _now()
        _LAST = summary
        return summary
    finally:
        _RUNNING = False
        _LOCK.release()


def last_status() -> dict:
    """The last run summary (module-level) plus `running`, or {"ran": False}."""
    out = dict(_LAST)
    out["running"] = _RUNNING
    return out
