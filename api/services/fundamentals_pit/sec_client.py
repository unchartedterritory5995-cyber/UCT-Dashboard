"""SEC EDGAR HTTP client for INGESTION ONLY (never on a member request path).

Fair access (sec.gov "Accessing EDGAR Data", checked 2026-09-22): at most 10
requests/second across all machines, and a declared User-Agent naming the
organisation and a contact address. This client enforces ONE process-wide
limiter (default 5 req/s, env SEC_MAX_RPS, hard-capped at 9), declares
SEC_USER_AGENT (default: UCT's existing EDGAR identity), retries 429/5xx with
bounded exponential backoff, and never retries a 404.
"""
from __future__ import annotations

import gzip
import json
import os
import threading
import time
import urllib.error
import urllib.request

DEFAULT_UA = "UCTDashboard contact@unchartedterritory.com"
DATA = "https://data.sec.gov"
WWW = "https://www.sec.gov"

_lock = threading.Lock()
_next_at = [0.0]


# Lightweight, process-wide acquisition counters (the V5 rebuild reports them).
STATS = {"requests": 0, "ok": 0, "retries": 0, "http_429": 0, "http_403": 0, "http_5xx": 0,
         "network": 0, "not_found": 0, "gave_up": 0, "bytes": 0, "retry_after_waits": 0}
_stats_lock = threading.Lock()
RETRY_AFTER_CAP = 300.0


def _bump(key: str, n: int = 1) -> None:
    with _stats_lock:
        STATS[key] += n


def stats() -> dict:
    with _stats_lock:
        return dict(STATS)


def _retry_after(err) -> float | None:
    """Seconds the server asked us to wait (Retry-After: seconds or an HTTP date)."""
    try:
        v = err.headers.get("Retry-After") if getattr(err, "headers", None) is not None else None
    except Exception:
        return None
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        from email.utils import parsedate_to_datetime
        try:
            return max(0.0, parsedate_to_datetime(v).timestamp() - time.time())
        except Exception:
            return None


class SecError(RuntimeError):
    def __init__(self, url: str, status: int | None, msg: str):
        super().__init__(f"{status} {url}: {msg}")
        self.url, self.status = url, status


def _rps() -> float:
    try:
        return max(0.5, min(9.0, float(os.environ.get("SEC_MAX_RPS", "5"))))
    except ValueError:
        return 5.0


def _wait_turn() -> None:
    with _lock:
        now = time.monotonic()
        at = max(now, _next_at[0])
        _next_at[0] = at + 1.0 / _rps()
    delay = at - time.monotonic()
    if delay > 0:
        time.sleep(delay)


def get_bytes(url: str, retries: int = 4, timeout: float = 60.0, opener=None) -> bytes:
    ua = os.environ.get("SEC_USER_AGENT", DEFAULT_UA)
    last: Exception | None = None
    for attempt in range(retries + 1):
        _wait_turn()
        _bump("requests")
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip"})
        wait = min(60.0, 2.0 ** attempt)
        try:
            with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                _bump("ok"); _bump("bytes", len(body))
                return body
        except urllib.error.HTTPError as e:
            if e.code == 404:
                _bump("not_found")
                raise SecError(url, 404, "not found") from e
            last = e
            kind = {429: "http_429", 403: "http_403"}.get(e.code, "http_5xx" if e.code >= 500 else None)
            if kind:
                _bump(kind)
            if e.code not in (403, 429, 500, 502, 503, 504):
                raise SecError(url, e.code, str(e)) from e
            ra = _retry_after(e)
            if ra is not None:                         # the server's own instruction wins over our backoff
                _bump("retry_after_waits")
                wait = min(RETRY_AFTER_CAP, max(wait, ra))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            _bump("network")
            last = e
        if attempt < retries:
            _bump("retries")
            time.sleep(wait)
    _bump("gave_up")
    raise SecError(url, getattr(last, "code", None), f"gave up after {retries + 1} attempts: {last}")


def download(url: str, dest: str, retries: int = 4, timeout: float = 300.0, opener=None) -> int:
    """Stream a large SEC file (bulk archives, FS data sets) to `dest` under the
    same fair-access rules as every other call: one rate-limited request, the
    declared User-Agent, bounded retries. Written to `dest.part` and renamed, so
    a killed download never leaves a truncated file under the real name. An
    existing `dest` is kept (idempotent). Returns bytes written (0 if kept)."""
    if os.path.exists(dest):
        return 0
    ua = os.environ.get("SEC_USER_AGENT", DEFAULT_UA)
    tmp = dest + ".part"
    last: Exception | None = None
    for attempt in range(retries + 1):
        _wait_turn()
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        try:
            n = 0
            with (opener or urllib.request.urlopen)(req, timeout=timeout) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    n += len(chunk)
            os.replace(tmp, dest)
            return n
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise SecError(url, 404, "not found") from e
            last = e
            if e.code not in (403, 429, 500, 502, 503, 504):
                raise SecError(url, e.code, str(e)) from e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
        time.sleep(min(60.0, 2.0 ** attempt))
    raise SecError(url, getattr(last, "code", None), f"gave up after {retries + 1} attempts: {last}")


def get_json(url: str, cache_dir: str | None = None, cache_name: str | None = None, **kw) -> dict:
    """JSON GET with an OPTIONAL on-disk cache (backfill / repair runs)."""
    if cache_dir and cache_name:
        p = os.path.join(cache_dir, cache_name)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    data = json.loads(get_bytes(url, **kw))
    if cache_dir and cache_name:
        os.makedirs(cache_dir, exist_ok=True)
        tmp = os.path.join(cache_dir, cache_name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, os.path.join(cache_dir, cache_name))
    return data


def companyfacts(cik: int, **kw) -> dict:
    return get_json(f"{DATA}/api/xbrl/companyfacts/CIK{cik:010d}.json", cache_name=f"facts_{cik}.json", **kw)


def submission_pages(cik: int, **kw) -> tuple[dict, list[dict]]:
    main = get_json(f"{DATA}/submissions/CIK{cik:010d}.json", cache_name=f"sub_{cik}.json", **kw)
    pages = [main["filings"]["recent"]]
    for f in main["filings"].get("files", []):
        pages.append(get_json(f"{DATA}/submissions/{f['name']}", cache_name=f"sub_{f['name']}", **kw))
    return main, pages


def company_tickers(**kw) -> dict[str, int]:
    j = get_json(f"{WWW}/files/company_tickers.json", cache_name="company_tickers.json", **kw)
    return {v["ticker"].upper(): int(v["cik_str"]) for v in j.values()}


def filing_instance(cik: int, accn: str) -> str | None:
    """The filing's own XBRL instance (inline filings: `*_htm.xml`), or None."""
    import re
    idx = get_bytes(f"{WWW}/Archives/edgar/data/{cik}/{accn.replace('-', '')}/{accn}-index.htm").decode("utf-8", "replace")
    hrefs = re.findall(r'href="([^"]+)"', idx)
    cand = [h for h in hrefs if h.endswith("_htm.xml")] or \
           [h for h in hrefs if h.endswith(".xml") and not re.search(r"_(cal|def|lab|pre)\.xml$", h)
            and "FilingSummary" not in h and "/R" not in h]
    if not cand:
        return None
    return get_bytes(WWW + cand[0].replace("/ix?doc=", "")).decode("utf-8", "replace")
