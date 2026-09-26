"""Real client IP derivation behind Cloudflare → Railway.

The app runs as a single uvicorn process behind Cloudflare (proxied) and Railway's
edge. `request.client.host` is therefore the immediate upstream (the edge), which is
IDENTICAL for every user — so keying rate-limits or activity logs on it collapses all
users into one bucket / one logged IP (a launch-morning global lockout for the login
limiter). Derive the true client IP from trusted proxy headers instead.

Precedence:
  1. `CF-Connecting-IP` — set by Cloudflare, NOT client-spoofable (Cloudflare overwrites
     any client-supplied value). This is the authoritative source in front of Cloudflare.
  2. left-most `X-Forwarded-For` hop — fallback for any non-Cloudflare path.
  3. peer address — last resort (local dev / direct hits).
"""
from __future__ import annotations

import ipaddress


def client_ip(request) -> str:
    headers = getattr(request, "headers", None) or {}
    try:
        cf = headers.get("cf-connecting-ip")
    except Exception:  # pragma: no cover - non-dict header stores
        cf = None
    if cf:
        return cf.strip()
    try:
        xff = headers.get("x-forwarded-for")
    except Exception:  # pragma: no cover
        xff = None
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    client = getattr(request, "client", None)
    if client and getattr(client, "host", None):
        return client.host
    return "unknown"


# ── Measurement for the Cloudflare-origin hardening (known limit, 2026-09-26) ─────────
#
# ⛔ `CF-Connecting-IP` is only unforgeable for traffic that actually crossed Cloudflare.
# The Railway origin (`web-production-05cb6.up.railway.app`) also answers directly, and
# measured 2026-09-26 as the smoke account: a direct login carrying a forged
# `CF-Connecting-IP: 203.0.113.7` was recorded AS 203.0.113.7, while a forged
# `X-Forwarded-For` was dropped (Railway sets that header itself — a direct hit recorded
# the caller's real IPv4). So a caller who skips Cloudflare picks their own rate-limit
# bucket. The fix is to trust `CF-Connecting-IP` only when the address Railway saw
# connecting is Cloudflare's. What Railway reports for traffic that DID cross Cloudflare
# is the one fact not yet measured, and guessing it wrong would put every member in one
# bucket (the launch-morning lockout this module's header describes) — so `describe` is
# served to admins first, and `client_ip` above is deliberately unchanged until it is read.

#: Cloudflare's published ranges, https://www.cloudflare.com/ips-v4 and /ips-v6, fetched
#: 2026-09-26. A range Cloudflare adds later is simply "not Cloudflare" here: the safe
#: direction for the check this feeds is the caller's real hop, never a forged header.
CLOUDFLARE_RANGES = (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)
_CLOUDFLARE_NETWORKS = tuple(ipaddress.ip_network(r) for r in CLOUDFLARE_RANGES)

#: The forwarding headers `describe` reports, verbatim. Nothing else about the request.
_FORWARDING_HEADERS = ("cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded",
                       "x-envoy-external-address", "true-client-ip")


def in_cloudflare(ip: str | None) -> bool:
    """True when `ip` parses and lies inside one of Cloudflare's published ranges."""
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False
    return any(addr in net for net in _CLOUDFLARE_NETWORKS)


def railway_hop(request) -> str | None:
    """The RIGHT-most `X-Forwarded-For` entry — the address the edge in front of this
    process saw connecting (an entry a proxy appends goes on the right; the left is
    whatever the caller claimed). None when the header is absent or empty."""
    headers = getattr(request, "headers", None) or {}
    try:
        xff = headers.get("x-forwarded-for")
    except Exception:  # pragma: no cover
        xff = None
    if not xff:
        return None
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    return parts[-1] if parts else None


def describe(request) -> dict:
    """The forwarding facts one request arrived with — served to ADMINS only, by
    `GET /api/auth/admin/request-ip-probe` — so the hardening above is decided on a
    measurement of both paths (through Cloudflare, and at the origin), not a guess."""
    headers = getattr(request, "headers", None) or {}
    seen = {}
    for name in _FORWARDING_HEADERS:
        try:
            value = headers.get(name)
        except Exception:  # pragma: no cover
            value = None
        if value is not None:
            seen[name] = value
    client = getattr(request, "client", None)
    hop = railway_hop(request)
    return {
        "peer": getattr(client, "host", None) if client else None,
        "headers": seen,
        "railway_hop": hop,
        "railway_hop_in_cloudflare": in_cloudflare(hop),
        "client_ip_today": client_ip(request),
        "cloudflare_ranges_fetched": "2026-09-26",
    }
