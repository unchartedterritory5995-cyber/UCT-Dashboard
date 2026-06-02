"""Proxy-and-cache company logos on our own volume.

Resolves each ticker's logo ONCE from a multi-source chain, normalizes to
PNG, and stores under /data/logo_cache/{SYM}.png. Thereafter we serve from
our own disk (~10ms), immune to third-party outages. Misses write a
{SYM}.miss sentinel so we don't refetch every request (retried after 7d).
Mirrors the ticker_meta disk-cache + ticker_names prewarm patterns.
Never raises.
"""
import io
import logging
import os
import time

import requests

_logger = logging.getLogger(__name__)
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "logo_cache")
_MISS_TTL = 7 * 86400  # retry a miss after 7 days
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_TIMEOUT = 8


def _safe(sym: str) -> str:
    return os.path.basename((sym or "").upper().strip())


def _png_path(sym: str) -> str:
    return os.path.join(_CACHE_DIR, f"{_safe(sym)}.png")


def _miss_path(sym: str) -> str:
    return os.path.join(_CACHE_DIR, f"{_safe(sym)}.miss")


def get_logo_path(sym: str):
    """Return the cached PNG path if present on disk, else None."""
    p = _png_path(sym)
    return p if os.path.exists(p) else None


def _recent_miss(sym: str) -> bool:
    mp = _miss_path(sym)
    try:
        return os.path.exists(mp) and (time.time() - os.path.getmtime(mp) < _MISS_TTL)
    except OSError:
        return False


def _finnhub_logo_bytes(sym: str):
    key = os.environ.get("FINNHUB_API_KEY", "")
    if not key:
        return None
    try:
        j = requests.get("https://finnhub.io/api/v1/stock/profile2",
                         params={"symbol": sym, "token": key}, timeout=_TIMEOUT).json() or {}
        url = j.get("logo") or ""
        if url:
            r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
            if r.ok and r.content:
                return r.content
    except Exception:
        return None
    return None


def _url_bytes(url: str):
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT, allow_redirects=True)
        if r.ok and r.content and len(r.content) > 200:
            return r.content
    except Exception:
        return None
    return None


def _fetch_sources(sym: str):
    """Try each source in priority order; return raw image bytes or None."""
    s = _safe(sym)
    return (
        _finnhub_logo_bytes(s)
        or _url_bytes(f"https://assets.parqet.com/logos/symbol/{s}")
        or _url_bytes(f"https://financialmodelingprep.com/image-stock/{s}.png")
    )


def _normalize_png(raw: bytes):
    """Rasterize/convert any input (PNG/SVG/JPG) to a square-ish PNG via Pillow.
    SVGs aren't handled by Pillow directly — if Pillow can't open it, keep raw
    bytes only if they already look like PNG, else None."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im.thumbnail((96, 96))
        out = io.BytesIO()
        im.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        # Pillow can't read SVG; accept raw only if it's already a PNG.
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            return raw
        return None


def resolve_and_cache(sym: str):
    """Resolve+cache the logo. Returns the PNG path on success, else None."""
    s = _safe(sym)
    if not s:
        return None
    existing = get_logo_path(s)
    if existing:
        return existing
    if _recent_miss(s):
        return None

    raw = _fetch_sources(s)
    png = _normalize_png(raw) if raw else None

    os.makedirs(_CACHE_DIR, exist_ok=True)
    if not png:
        try:
            open(_miss_path(s), "w").close()
        except OSError:
            pass
        return None

    tmp = _png_path(s) + ".tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(png)
        os.replace(tmp, _png_path(s))
    except OSError as e:
        _logger.warning("logo write failed for %s: %s", s, e)
        return None
    return _png_path(s)


# ── Bounded async resolver (politeness to third parties) ──────────────────────
import threading
from concurrent.futures import ThreadPoolExecutor

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="logo-resolve")
_INFLIGHT: set = set()
_INFLIGHT_LOCK = threading.Lock()

# 1x1 transparent PNG returned on cold miss so the client never shows a broken img.
TRANSPARENT_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)


def schedule_resolve(sym: str) -> None:
    s = _safe(sym)
    if not s:
        return
    with _INFLIGHT_LOCK:
        if s in _INFLIGHT or len(_INFLIGHT) >= 8:
            return
        _INFLIGHT.add(s)

    def _job():
        try:
            resolve_and_cache(s)
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(s)

    _POOL.submit(_job)
