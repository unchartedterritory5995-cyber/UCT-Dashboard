"""SEC fetches for the dataset, through the V5 SEC client (declared User-Agent, shared rate limiter, retries),
with a content-addressed on-disk cache so every build is reproducible and re-runs never re-download."""
from __future__ import annotations

import gzip
import hashlib
import os

from api.services.fundamentals_pit import sec_client as SEC

CACHE = os.environ.get("MCAP_CACHE", "C:/mcapdata/cache")


def _path(url: str) -> str:
    h = hashlib.sha1(url.encode()).hexdigest()
    return os.path.join(CACHE, h[:2], h + ".gz")


def get(url: str, missing_ok: bool = True) -> bytes | None:
    """Cached GET. A 404 is cached too (as an empty marker) so it is asked once."""
    p = _path(url)
    if os.path.exists(p):
        b = gzip.decompress(open(p, "rb").read())
        return None if b == b"\x00404" else b
    try:
        body = SEC.get_bytes(url)
    except SEC.SecError as e:
        if e.status == 404 and missing_ok:
            body = b"\x00404"
        else:
            raise
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "wb") as f:
        f.write(gzip.compress(body, 6))
    os.replace(tmp, p)
    return None if body == b"\x00404" else body


def filing_base(cik: int, accn: str) -> str:
    return f"{SEC.WWW}/Archives/edgar/data/{cik}/{accn.replace('-', '')}"


def get_head(url: str, nbytes: int = 90000, retries: int = 4) -> bytes | None:
    """The first `nbytes` of a (possibly multi-MB) archive file: SEC ignores Range, so the stream is closed
    after the head is read. Same User-Agent and rate limiter as every other SEC call; cached."""
    import time
    import urllib.error
    import urllib.request
    key = f"{url}#head{nbytes}"
    p = _path(key)
    if os.path.exists(p):
        b = gzip.decompress(open(p, "rb").read())
        return None if b == b"\x00404" else b
    ua = os.environ.get("SEC_USER_AGENT", SEC.DEFAULT_UA)
    body = None
    for attempt in range(retries + 1):
        SEC._wait_turn()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read(nbytes)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                body = b"\x00404"
                break
            if e.code not in (403, 429, 500, 502, 503, 504) or attempt == retries:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries:
                raise
        time.sleep(min(60.0, 2.0 ** attempt))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "wb") as f:
        f.write(gzip.compress(body, 6))
    os.replace(p + ".tmp", p)
    return None if body == b"\x00404" else body
