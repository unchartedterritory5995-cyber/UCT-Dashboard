"""TERM-045 -- the SEC's Official List of Section 13(f) Securities, joined to a ticker's 13F holders.

Owner ruling T-14 (2026-10-07): use the SEC's free Official List (it carries CUSIPs); do not buy
the CUSIP master file. The list is exactly the population a Form 13F reports on, so it answers
"is this security 13(f)-reportable, and which of the issuer's securities are" without a vendor.

THE FILE. https://www.sec.gov/files/investment/13flist{YYYY}q{N}.txt, one quarterly plain-text
file, fixed 80-column lines (layout measured on 13flist2026q3.txt, 25,789 lines):
    [0:9]   CUSIP                     037833100
    [9]     "*" = listed options exist on the security
    [10:40] issuer name               APPLE INC
    [40:67] issue description         COM / CALL / PUT / NOTE ...
    [67:70] "*A*" added this quarter, "*D*" deleted, blank = unchanged
The first six CUSIP characters identify the ISSUER, so every security of one issuer shares them.

FETCH PATH (never a member request): `refresh()` is run by the job `sec_13f_list_refresh`
(main.py, daily, a no-op while the flag is unset). It tries the current quarter and then up to
three earlier ones, through `fundamentals_pit.sec_client` (the one SEC transport: declared
SEC_USER_AGENT, the process-wide fair-access limiter), with a per-request timeout and a hard
byte cap (MAX_BYTES; a larger answer is refused, not truncated). A quarter already on disk is
never fetched again. Files live under SEC_13F_LIST_PATH (default /data/sec_13f_list).

REQUEST PATH: `overlay()` reads the newest file on disk (parsed once per file, in process).
Nothing on disk = state `not_ingested`, never "not reportable". The ticker's CUSIP comes from
the local fails-to-deliver store (SEC cnsfails rows carry CUSIP + symbol) and else FMP's
company profile `cusip` field (cached 24 h); with neither the state is `no_cusip`.

THE JOIN. The Ownership tab's 13F holders (FMP's per-symbol 13F aggregation, already shown)
are the holders of the ticker's own CUSIP; the overlay adds which of the issuer's securities
are on the SEC list (shares, options, notes), whether the ticker's own security is, and the
list quarter. `annotate_positions()` joins Form 13F information-table positions
(edgar_ownership.aggregate_13f_positions, keyed by CUSIP) to the list the same way.

DARK behind SEC_13F_LIST_ENABLED (read per call, unset = OFF): the job does nothing and the
ownership payload is exactly what it was.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from datetime import date
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "SEC_13F_LIST_ENABLED"
BASE_URL = "https://www.sec.gov/files/investment/"
SOURCE = "SEC Official List of Section 13(f) Securities"
MAX_BYTES = 8 * 1024 * 1024        # the 2026q3 file is ~2.1 MB
TIMEOUT_S = 30
QUARTERS_TRIED = 4
MIN_ROWS = 100                     # a real list has tens of thousands of lines
_CUSIP_TTL = 24 * 3600
_CUSIP_FAIL_TTL = 3600
_STATUS = {"*A*": "added", "*D*": "deleted"}

_parsed: dict[tuple, dict] = {}
_parsed_lock = threading.Lock()


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def list_dir() -> str:
    return os.environ.get("SEC_13F_LIST_PATH", "/data/sec_13f_list")


def quarter_candidates(today: date) -> list[tuple[int, int]]:
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(QUARTERS_TRIED):
        out.append((y, q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return out


def url_for(year: int, quarter: int) -> str:
    return f"{BASE_URL}13flist{year}q{quarter}.txt"


def _name(year: int, quarter: int) -> str:
    return f"13flist{year}q{quarter}.txt"


# ── parsing ─────────────────────────────────────────────────────────────────

def parse_line(line: str) -> Optional[dict]:
    line = line.rstrip("\r\n")
    if len(line) < 41:
        return None
    cusip = line[0:9].strip().upper()
    if len(cusip) != 9 or not cusip.isalnum():
        return None
    return {"cusip": cusip,
            "has_listed_options": line[9:10] == "*",
            "issuer": line[10:40].strip(),
            "description": line[40:67].strip(),
            "status": _STATUS.get(line[67:70])}


def parse(text: str) -> list[dict]:
    return [r for r in (parse_line(ln) for ln in text.splitlines()) if r]


# ── fetch (job only) ────────────────────────────────────────────────────────

class _Capped:
    """A response whose read() refuses to return more than MAX_BYTES."""

    def __init__(self, resp):
        self._r = resp
        self.headers = resp.headers

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._r.close()
        return False

    def read(self, *_a):
        body = self._r.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError(f"13(f) list larger than {MAX_BYTES} bytes; refused")
        return body


def _capped_opener(req, timeout=None):
    return _Capped(urllib.request.urlopen(req, timeout=timeout))


def _sec_get(url: str) -> bytes:
    """The one SEC transport (fair-access limiter + SEC_USER_AGENT), bounded. Tests replace it."""
    from api.services.fundamentals_pit import sec_client
    body = sec_client.get_bytes(url, retries=1, timeout=TIMEOUT_S, opener=_capped_opener)
    if len(body) > MAX_BYTES:                  # a gzip body is capped again after decompression
        raise ValueError(f"13(f) list larger than {MAX_BYTES} bytes; refused")
    return body


def refresh(*, today: Optional[date] = None, get: Optional[Callable[[str], bytes]] = None) -> dict:
    """Make sure the newest published list is on disk. Never raises."""
    if not is_enabled():
        return {"skipped": True, "reason": f"{ENABLED_ENV} unset"}
    from api.services.fundamentals_pit.sec_client import SecError
    get = get or _sec_get
    d = list_dir()
    tried = []
    for y, q in quarter_candidates(today or date.today()):
        dest = os.path.join(d, _name(y, q))
        if os.path.exists(dest):
            return {"state": "cached", "quarter": f"{y}Q{q}", "tried": tried}
        url = url_for(y, q)
        try:
            body = get(url)
        except SecError as exc:
            tried.append({"quarter": f"{y}Q{q}", "status": exc.status})
            if exc.status == 404:
                continue                        # not published yet: the quarter before
            return {"state": "unavailable", "tried": tried, "detail": str(exc)}
        except Exception as exc:  # noqa: BLE001 -- recorded as a state
            tried.append({"quarter": f"{y}Q{q}", "error": type(exc).__name__})
            return {"state": "unavailable", "tried": tried, "detail": str(exc)}
        text = body.decode("latin-1")
        rows = parse(text)
        if len(rows) < MIN_ROWS:
            tried.append({"quarter": f"{y}Q{q}", "rows": len(rows)})
            return {"state": "rejected", "tried": tried,
                    "detail": f"{url} parsed to {len(rows)} rows; not a 13(f) list"}
        os.makedirs(d, exist_ok=True)
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, dest)
        with open(dest + ".meta.json", "w", encoding="utf-8") as f:
            json.dump({"url": url, "rows": len(rows), "bytes": len(body),
                       "fetched_on": (today or date.today()).isoformat()}, f)
        return {"state": "fetched", "quarter": f"{y}Q{q}", "rows": len(rows), "tried": tried}
    return {"state": "not_published", "tried": tried}


# ── the on-disk list (request path: disk only) ──────────────────────────────

def _newest_file() -> Optional[tuple[str, int, int]]:
    d = list_dir()
    try:
        names = os.listdir(d)
    except OSError:
        return None
    best = None
    for n in names:
        if not (n.startswith("13flist") and n.endswith(".txt")):
            continue
        try:
            y, q = n[7:-4].split("q")
            key = (int(y), int(q))
        except ValueError:
            continue
        if best is None or key > best[1:]:
            best = (os.path.join(d, n), *key)
    return best


def current_list() -> Optional[dict]:
    """{quarter, url, by_cusip, by_issuer} for the newest list on disk, or None."""
    f = _newest_file()
    if f is None:
        return None
    path, y, q = f
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_mtime_ns, st.st_size)
    with _parsed_lock:
        hit = _parsed.get(key)
    if hit is not None:
        return hit
    with open(path, "rb") as fh:
        rows = parse(fh.read().decode("latin-1"))
    by_issuer: dict[str, list] = {}
    for r in rows:
        by_issuer.setdefault(r["cusip"][:6], []).append(r)
    out = {"quarter": f"{y}Q{q}", "url": url_for(y, q), "rows": len(rows),
           "by_cusip": {r["cusip"]: r for r in rows}, "by_issuer": by_issuer}
    with _parsed_lock:
        _parsed.clear()
        _parsed[key] = out
    return out


def lookup(cusip: str, lst: dict) -> dict:
    """The ticker's own CUSIP against the list: its row, and every listed security of its issuer."""
    c = (cusip or "").strip().upper()
    own = lst["by_cusip"].get(c)
    return {"cusip": c, "on_list": own is not None and own.get("status") != "deleted",
            "security": own,
            "issuer_securities": list(lst["by_issuer"].get(c[:6], []))}


def annotate_positions(positions: list[dict], lst: dict) -> list[dict]:
    """Form 13F positions (keyed by CUSIP) joined to the list. A CUSIP the list does not carry
    is `on_list: False`; the position is kept, never dropped."""
    out = []
    for p in positions or []:
        row = lst["by_cusip"].get(str(p.get("cusip") or "").upper())
        out.append({**p, "on_list": row is not None and row.get("status") != "deleted",
                    "list_issuer": row["issuer"] if row else None,
                    "list_description": row["description"] if row else None})
    return out


# ── the ticker's CUSIP ──────────────────────────────────────────────────────

def _cusip_from_ftd(sym: str) -> Optional[str]:
    try:
        from api.services import ftd_dataset
        with ftd_dataset._conn() as c:
            r = c.execute("SELECT cusip FROM ftd WHERE symbol=? ORDER BY settle_date DESC LIMIT 1",
                          (sym,)).fetchone()
        return r[0] if r and r[0] else None
    except Exception:  # noqa: BLE001 -- an absent store is simply no answer
        return None


def _cusip_from_fmp(sym: str) -> Optional[str]:
    from api.services import fmp_client
    try:
        res = fmp_client.get_company_profile(sym, timeout=8)
    except Exception:  # noqa: BLE001 -- not found / not configured / transient: no answer
        return None
    v = res.value if res.degraded is None else None
    row = v[0] if isinstance(v, list) and v else v if isinstance(v, dict) else None
    c = (row or {}).get("cusip") if isinstance(row, dict) else None
    return str(c).strip().upper() if c and len(str(c).strip()) == 9 else None


def cusip_for(sym: str) -> Optional[str]:
    from api.services.cache import cache
    key = f"sec13f_cusip::{sym}"
    hit = cache.get(key)
    if hit is not None:
        return hit or None
    c = _cusip_from_ftd(sym) or _cusip_from_fmp(sym)
    cache.set(key, c or "", _CUSIP_TTL if c else _CUSIP_FAIL_TTL)
    return c


# ── the Ownership overlay ───────────────────────────────────────────────────

def overlay(payload: dict, sym: str) -> dict:
    """Return the ownership payload with `thirteen_f_list` added. Never mutates, never raises."""
    if not is_enabled() or not isinstance(payload, dict):
        return payload
    s = (sym or "").upper().strip()
    base = {"source": SOURCE}
    try:
        lst = current_list()
        if lst is None:
            block = {**base, "state": "not_ingested",
                     "reason": "the SEC 13(f) list has not been downloaded on this server yet"}
        else:
            base.update(quarter=lst["quarter"], url=lst["url"])
            cusip = cusip_for(s)
            if not cusip:
                block = {**base, "state": "no_cusip",
                         "reason": f"no CUSIP is on record for {s}, so it cannot be matched to the list"}
            else:
                hit = lookup(cusip, lst)
                block = {**base, "state": "ok" if hit["on_list"] else "not_on_list", **hit}
                tf = payload.get("thirteen_f")
                if isinstance(tf, dict) and tf.get("quarter"):
                    block["holders_quarter"] = tf["quarter"]
    except Exception as exc:  # noqa: BLE001 -- recorded as a state
        _logger.warning("[sec_13f_list] overlay failed for %s: %s", s, exc)
        block = {**base, "state": "unavailable", "reason": "the 13(f) list could not be read"}
    return {**payload, "thirteen_f_list": block}
