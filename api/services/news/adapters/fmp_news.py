"""FMP news adapter — the breadth and company-release lanes.

TWO ENDPOINTS, OPPOSITE TREATMENT (measured 7 Sep 2026, 15,193 articles):

  /stable/news/press-releases   six sources, all primary wire, 91.4% subject
                                accurate. This IS the company-IR lane -- it
                                replaces per-issuer feed discovery entirely.
                                Its only junk family is law-firm solicitation
                                (224 of 229 rejections).

  /stable/news/stock            37 sources but 85.5% commentary. Unusable raw;
                                behind the publisher whitelist it contributes
                                Reuters, Barron's, CNBC, WSJ, Business Insider
                                and the wires.

INGESTION SHAPE (§4)
    `-latest` variants return the GLOBAL feed and let us ingest once and fan
    out by symbol. `probe_latest()` verifies them at runtime; if they are not
    available the ingestor falls back to bounded, scheduled iteration over the
    active universe. Either way ingestion is central and a user page load never
    reaches FMP.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import httpx

_log = logging.getLogger(__name__)

BASE = "https://financialmodelingprep.com"
STOCK_LATEST = "/stable/news/stock-latest"
PR_LATEST = "/stable/news/press-releases-latest"
STOCK_BY_SYMBOL = "/stable/news/stock"
PR_BY_SYMBOL = "/stable/news/press-releases"

# Measured: `limit` is honoured up to 250 and silently capped there.
PAGE_SIZE = 250
_TIMEOUT = httpx.Timeout(connect=5.0, read=25.0, write=10.0, pool=10.0)

# Politeness pacing. No 429 was observed at 120/min during validation; this
# leaves headroom and is the only rate control ingestion needs.
_MIN_GAP = float(os.environ.get("NEWS_FMP_MIN_GAP_S", "0.5"))
_last_call = 0.0
_pace_lock = threading.Lock()

_client: httpx.Client | None = None
_client_lock = threading.Lock()


def _http() -> httpx.Client:
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = httpx.Client(
                    timeout=_TIMEOUT,
                    headers={"Accept": "application/json",
                             "User-Agent": "UCT-Intelligence/1.0"})
    return _client


def _api_key() -> str:
    return (os.environ.get("FMP_API_KEY") or "").strip()


class FmpUnavailable(RuntimeError):
    """No key, or the provider refused. Ingestion logs and moves on."""


def _get(path: str, params: dict[str, Any], budget: "RequestBudget | None" = None) -> Any:
    key = _api_key()
    if not key:
        raise FmpUnavailable("FMP_API_KEY not set")
    if budget is not None:
        budget.spend()

    global _last_call
    with _pace_lock:
        wait = _MIN_GAP - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()

    p = dict(params)
    p["apikey"] = key
    last_err = ""
    for attempt in range(3):
        try:
            r = _http().get(f"{BASE}{path}", params=p)
            if r.status_code == 429:
                time.sleep(2 + attempt * 4)
                last_err = "429"
                continue
            if r.status_code in (401, 403):
                raise FmpUnavailable(f"FMP {r.status_code}: plan or key issue")
            r.raise_for_status()
            return r.json()
        except FmpUnavailable:
            raise
        except httpx.HTTPStatusError as e:
            last_err = f"{e.response.status_code}"
            if e.response.status_code < 500:
                break
            time.sleep(1 + attempt)
        except httpx.HTTPError as e:
            last_err = type(e).__name__
            time.sleep(1 + attempt)
    raise FmpUnavailable(f"FMP {path} failed: {last_err}")


class RequestBudget:
    """Hard ceiling. Ingestion aborts rather than overspending (§6)."""

    def __init__(self, limit: int, label: str = "fmp") -> None:
        self.limit = int(limit)
        self.label = label
        self.used = 0

    def spend(self, n: int = 1) -> None:
        if self.used + n > self.limit:
            raise FmpUnavailable(
                f"request ceiling reached for {self.label}: {self.used}/{self.limit}")
        self.used += n

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


# ---------------------------------------------------------------------------
def _rows(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        payload = payload.get("content") or payload.get("data") or []
    return [r for r in (payload or []) if isinstance(r, dict)]


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if " " in s and "T" not in s:
        s = s.replace(" ", "T")
    s = s.replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d"):
            try:
                d = datetime.strptime(s, fmt)
                break
            except ValueError:
                continue
        else:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def normalize(row: dict, *, lane: str) -> dict | None:
    """FMP row -> the shared raw shape the ingestor consumes."""
    url = (row.get("url") or "").strip()
    title = (row.get("title") or "").strip()
    if not title or not url:
        return None
    published = _parse_dt(row.get("publishedDate") or row.get("date"))
    if not published:
        return None
    sym = (row.get("symbol") or "").upper().strip()
    return {
        "provider": "fmp",
        "lane": lane,
        # FMP has no stable article id; the URL is the identity it supplies.
        #
        # ⛔ The lane must NOT be part of the key. FMP serves the same company
        # release from BOTH /news/press-releases and /news/stock, so keying on
        # "{lane}:{url}" produced two rows for one article and the feed showed
        # "Micron Technology to Report Fiscal Fourth Quarter Results" twice in
        # a row. The lane is still recorded on the item as `raw_ref`.
        "provider_id": url[:500],
        "publisher": (row.get("publisher") or row.get("site") or "").strip(),
        "url": url,
        "title": title,
        "body": (row.get("text") or row.get("snippet") or "").strip(),
        "image": (row.get("image") or "").strip(),
        "published_at": published,
        "tags": [sym] if sym else [],
        "author": (row.get("author") or "").strip(),
    }


# ---------------------------------------------------------------------------
# §4: is the global path available?
# ---------------------------------------------------------------------------
_latest_support: dict[str, bool] | None = None


def probe_latest(budget: RequestBudget | None = None) -> dict[str, Any]:
    """Verify the global `-latest` endpoints. Cached for the process.

    Returns {'stock': bool, 'press': bool, 'detail': str}. Never raises: a
    failure here simply selects the bounded per-symbol fallback.
    """
    global _latest_support
    if _latest_support is not None:
        return {**_latest_support, "detail": "cached"}

    out = {"stock": False, "press": False}
    detail = []
    for name, path in (("stock", STOCK_LATEST), ("press", PR_LATEST)):
        try:
            rows = _rows(_get(path, {"limit": 5, "page": 0}, budget))
            ok = bool(rows) and any((r.get("title") and r.get("url")) for r in rows)
            out[name] = ok
            detail.append(f"{name}={'ok' if ok else 'empty'}({len(rows)})")
        except FmpUnavailable as e:
            detail.append(f"{name}=unavailable({e})")
        except Exception as e:                       # noqa: BLE001 - never fatal
            detail.append(f"{name}=error({type(e).__name__})")
    _latest_support = out
    return {**out, "detail": ", ".join(detail)}


def reset_latest_cache() -> None:
    global _latest_support
    _latest_support = None


# ---------------------------------------------------------------------------
# pulls
# ---------------------------------------------------------------------------
def fetch_latest(lane: str, *, pages: int = 2, budget: RequestBudget | None = None,
                 since: datetime | None = None) -> list[dict]:
    """Global feed for a lane. `lane` is 'press' or 'stock'.

    Stops early once a page is entirely older than `since`, which is what keeps
    routine polling to one or two requests.
    """
    path = PR_LATEST if lane == "press" else STOCK_LATEST
    out: list[dict] = []
    for page in range(max(1, pages)):
        rows = _rows(_get(path, {"limit": PAGE_SIZE, "page": page}, budget))
        if not rows:
            break
        norm = [n for n in (normalize(r, lane=lane) for r in rows) if n]
        out.extend(norm)
        if since and norm and all(n["published_at"] < since for n in norm):
            break
        if len(rows) < PAGE_SIZE:
            break
    return out


def fetch_symbol(symbol: str, lane: str, *, limit: int = PAGE_SIZE,
                 frm: str = "", to: str = "",
                 page: int = 0, budget: RequestBudget | None = None) -> list[dict]:
    """Per-symbol pull: the bounded fallback, and the backfill path."""
    path = PR_BY_SYMBOL if lane == "press" else STOCK_BY_SYMBOL
    params: dict[str, Any] = {"symbols": symbol.upper(), "limit": limit}
    if page:
        params["page"] = page
    if frm:
        params["from"] = frm
    if to:
        params["to"] = to
    rows = _rows(_get(path, params, budget))
    return [n for n in (normalize(r, lane=lane) for r in rows) if n]


def fetch_symbols(symbols: Iterable[str], lane: str, *,
                  budget: RequestBudget | None = None,
                  limit: int = PAGE_SIZE) -> list[dict]:
    """Bounded iteration for the fallback path. Stops cleanly at the ceiling."""
    out: list[dict] = []
    for sym in symbols:
        if budget is not None and budget.remaining <= 0:
            break
        try:
            out.extend(fetch_symbol(sym, lane, limit=limit, budget=budget))
        except FmpUnavailable as e:
            _log.warning("fmp %s %s: %s", lane, sym, e)
            break
        except Exception as e:                       # noqa: BLE001
            _log.warning("fmp %s %s unexpected: %s", lane, sym, e)
    return out


def window_days_back(days: int) -> tuple[str, str]:
    now = datetime.now(timezone.utc).date()
    return (now - timedelta(days=days)).isoformat(), now.isoformat()
