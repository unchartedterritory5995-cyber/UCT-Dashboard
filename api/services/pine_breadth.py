"""Track 4, unit B1 (2026-11-22): UCT breadth as daily series under TradingView's `USI:` spellings, served dark.

A member's Pine script reads NYSE and Nasdaq breadth as `request.security("USI:ADVN.NY", "D", close)` and the like
(27 scripts in the whole-population census; TradingView's own Advance Decline Line among them). This module answers
`GET /api/pine/breadth/{spelling}` (api/routers/pine_breadth.py) from UCT's OWN breadth: the Exchange Breadth V1
authority (`breadth_exchange_authority`: NYSE from 2009-06-11, Nasdaq from 2008-01-02, advancing / declining /
unchanged over each exchange's operating equity, common stock and ADRs, point in time).

⛔ IT IS NEVER TRADINGVIEW'S SERIES. The exchanges' official counts also hold preferreds, funds and other issues, so
our counts differ from `USI:` by construction. Every answer carries `label: "UCT breadth"` and the definition, and the
grade is a substitution (MATCH_SUBSTITUTED, or a named divergence), never MATCH (coordinator ruling 2026-11-22).
Whether a session's count is read on that session's chart bar or the next (TradingView's `SP:SPX` reads the previous
session) is the capture's to say (Q-T4-B1, `docs/pine/capture-queue-2026-11-22-t4-breadth.md`); this module serves
rows keyed by session date and decides no alignment.

THE SPELLINGS. `SPELLINGS` maps each `USI:` spelling to (exchange universe, metric). `ADD` is advancing minus
declining of the same session. The short spellings (`USI:ADV`, `USI:DECL`, `USI:ADVQ`, `USI:DECLQ`) and the bare
`ADVN` / `DECN` are `aliasOf` a long one and stay `witness: "pending"` until Q-T4-B1 shows TradingView answers them
alike. Volume spellings (`UVOL`, `DVOL`, `TVOL`, and the Nasdaq ones) are NOT served: UCT holds no up / down volume
series (unit B3).

LICENCE. The family is `uct_breadth` in the Pine data catalog, whose pair (`massive`, `derived_analytics`, T-11)
reads LA for member display since ESC-03 was ANSWERED BY THE OWNER 2026-11-22 (it was held at R until then). The
catalog's decision is read live per request: a refusing licence still refuses a member by the catalog's own
sentence. An ADMIN reads the values while the stage is dark, to grade them against the capture.

THE LANE (the #2422 pattern). A cold read of one metric's whole history is a ~9 s database walk, so a request never
makes it: rows come from the in-process copy, then the disk snapshot `<PINE_BREADTH_DIR>/<universe>-<metric>.json`
(temp + os.replace), else the answer is `pending` and ONE background refresh is queued (2 workers, deduplicated).
A copy older than `TTL_S` is served as it stands and kicks a refresh. A failed refresh keeps the copy we have.

STAGE. `PINE_BREADTH_SUPPLY_ENABLED`: unset or `admins` -> admins only; `all` -> paid members (served while the
catalog passes uct_breadth); `off` or an unknown value -> nobody (404).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

log = logging.getLogger("pine_breadth")

SCHEMA = "uct.pine-breadth/v1"
FAMILY = "uct_breadth"
TTL_S = 6 * 3600
STAGES = ("off", "admins", "all")
DEFINITION = ("UCT breadth: the session's count of {exchange}-listed operating equity (common stock and ADRs, point "
              "in time) that {what}, from 1-minute composites. Not the exchange's official count, which also holds "
              "preferreds, funds and other issues.")
WHAT = {"advancing": "closed up", "declining": "closed down", "unchanged": "closed unchanged",
        "add": "closed up, less the count that closed down"}

#: spelling -> (universe, metric). `add` is derived: advancing - declining of the same session.
SPELLINGS = {
    "USI:ADVN.NY": ("nyse", "advancing"), "USI:DECL.NY": ("nyse", "declining"), "USI:UNCH.NY": ("nyse", "unchanged"),
    "USI:ADVN.NQ": ("nasdaq", "advancing"), "USI:DECL.NQ": ("nasdaq", "declining"),
    "USI:UNCH.NQ": ("nasdaq", "unchanged"),
    "USI:ADD": ("nyse", "add"), "USI:ADDQ": ("nasdaq", "add"),
}
#: spellings TradingView may answer as one of the above: served only once Q-T4-B1 witnesses it
ALIASES = {"USI:ADV": "USI:ADVN.NY", "USI:DECL": "USI:DECL.NY", "USI:ADVQ": "USI:ADVN.NQ",
           "USI:DECLQ": "USI:DECL.NQ", "ADVN": "USI:ADVN.NY", "DECN": "USI:DECL.NY"}
#: read by the corpus, not held by UCT (unit B3: up / down volume as a new derived series)
NOT_HELD = {"USI:UVOL", "USI:DVOL", "USI:UVOLQ", "USI:DVOLQ", "USI:TVOL", "USI:TVOLQ"}


def stage() -> str:
    v = (os.environ.get("PINE_BREADTH_SUPPLY_ENABLED") or "").strip().lower()
    if not v:
        return "admins"
    if v in ("1", "true", "yes", "on"):
        return "all"
    return v if v in STAGES else "off"


def resolve(spelling: str) -> dict:
    """{spelling, universe, metric, aliasOf, witness} or {spelling, refusal}. Pure: no data read."""
    s = (spelling or "").strip().upper()
    if s in NOT_HELD:
        return {"spelling": s, "refusal": f"`{s}` is not held: UCT has no up or down volume breadth series yet."}
    alias = ALIASES.get(s)
    base = alias or s
    if base not in SPELLINGS:
        return {"spelling": s, "refusal": f"`{s}` is not a breadth spelling UCT serves."}
    uni, metric = SPELLINGS[base]
    return {"spelling": s, "universe": uni, "metric": metric, "aliasOf": alias,
            "witness": "pending (Q-T4-B1)"}


def _dir() -> str:
    override = os.environ.get("PINE_BREADTH_DIR")
    if override:
        return override
    base = os.environ.get("DATA_DIR") or ("/data" if os.path.isdir("/data") else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "data"))
    return os.path.join(base, "pine_breadth")


def _path(universe: str, metric: str) -> str:
    return os.path.join(_dir(), f"{universe}-{metric}.json")


def licence_refusal() -> Optional[dict]:
    from api.services import pine_data_catalog as cat
    r = cat.family_refusal(FAMILY)
    return {"guard": r[0], "sentence": r[1]} if r else None


# ── the rows (background lane only) ─────────────────────────────────────────────────────────────────────────────
def _history(universe: str, metric: str) -> dict:
    from api.services import breadth_exchange_authority as ea
    rows = ea.universe_history(metric, universe, limit=0)
    if rows is None:
        raise RuntimeError("the exchange breadth authority is not in force")
    return rows


def fetch_rows(universe: str, metric: str) -> list:
    """[{d, o, h, l, c}] by session date, oldest first. `add` = advancing - declining, OHLC from the closes only (a
    difference of two intraday ranges is not a range), so o = h = l = c."""
    if metric == "add":
        adv, dec = _history(universe, "advancing"), _history(universe, "declining")
        return [{"d": d, "o": adv[d]["c"] - dec[d]["c"], "h": adv[d]["c"] - dec[d]["c"],
                 "l": adv[d]["c"] - dec[d]["c"], "c": adv[d]["c"] - dec[d]["c"]}
                for d in sorted(set(adv) & set(dec))
                if adv[d].get("c") is not None and dec[d].get("c") is not None]
    rows = _history(universe, metric)
    return [{"d": d, "o": r.get("o"), "h": r.get("h"), "l": r.get("l"), "c": r["c"]}
            for d, r in sorted(rows.items()) if r.get("c") is not None]


def refresh(universe: str, metric: str, now: Optional[float] = None) -> dict:
    now = time.time() if now is None else now
    prev = _read_disk(universe, metric)
    try:
        rows = fetch_rows(universe, metric)
        doc = {"schema": SCHEMA, "universe": universe, "metric": metric, "refreshedAt": now, "state": "ok",
               "rows": rows, "knownFrom": rows[0]["d"] if rows else None}
    except Exception as e:  # noqa: BLE001 - the copy we have stays, by name
        log.warning("pine_breadth refresh FAILED %s %s: %s", universe, metric, type(e).__name__)
        if prev and prev.get("rows"):
            doc = {**prev, "state": "unavailable", "staleSince": prev.get("refreshedAt"), "error": type(e).__name__}
        else:
            doc = {"schema": SCHEMA, "universe": universe, "metric": metric, "refreshedAt": now,
                   "state": "unavailable", "rows": [], "knownFrom": None, "error": type(e).__name__}
    _write_atomic(_path(universe, metric), doc)
    with _MEM_LOCK:
        _MEM[(universe, metric)] = doc
    return doc


_MEM: dict = {}
_MEM_LOCK = threading.Lock()


def _read_disk(universe: str, metric: str) -> Optional[dict]:
    try:
        with open(_path(universe, metric), encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("schema") == SCHEMA else None


def _write_atomic(path: str, doc: dict) -> None:
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".pine-breadth-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pine-breadth-refresh")
_INFLIGHT: set = set()
_INFLIGHT_LOCK = threading.Lock()


def kick(universe: str, metric: str) -> bool:
    key = (universe, metric)
    with _INFLIGHT_LOCK:
        if key in _INFLIGHT:
            return False
        _INFLIGHT.add(key)

    def run():
        try:
            refresh(universe, metric)
        except Exception:  # noqa: BLE001
            log.exception("pine_breadth refresh crashed for %s %s", universe, metric)
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(key)

    _POOL.submit(run)
    return True


def read(spelling: str, now: Optional[float] = None) -> dict:
    """What a request answers: never a database walk on the request thread."""
    now = time.time() if now is None else now
    r = resolve(spelling)
    if "refusal" in r:
        return {"schema": SCHEMA, "state": "refused", **r}
    key = (r["universe"], r["metric"])
    with _MEM_LOCK:
        doc = _MEM.get(key)
    if doc is None:
        doc = _read_disk(*key)
        if doc is not None:
            with _MEM_LOCK:
                _MEM[key] = doc
    exch = {"nyse": "NYSE", "nasdaq": "Nasdaq"}[r["universe"]]
    head = {"schema": SCHEMA, **r, "label": "UCT breadth",
            "definition": DEFINITION.format(exchange=exch, what=WHAT[r["metric"]])}
    if doc is None:
        kick(*key)
        return {**head, "state": "pending",
                "sentence": f"UCT is gathering the {exch} breadth history; ask again in a few seconds."}
    age = now - float(doc.get("refreshedAt") or 0)
    if age > TTL_S:
        kick(*key)
    return {**head, "state": "ready", "source": doc.get("state"), "rows": doc.get("rows") or [],
            "knownFrom": doc.get("knownFrom"), "ageS": int(age), "refreshing": age > TTL_S,
            **({"staleSince": doc["staleSince"]} if doc.get("staleSince") else {})}
