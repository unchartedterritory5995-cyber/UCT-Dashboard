"""Real client IP derivation behind Cloudflare → Railway.

The app runs as a single uvicorn process behind Cloudflare (proxied) and Railway's
edge. Keying rate-limits or activity logs on the wrong address collapses users into
one bucket (a launch-morning global lockout for the login limiter) — or, the other
way round, lets a caller choose their own bucket. Both have happened in design; the
rules below are MEASURED, not assumed.

⭐ What Railway's edge hands this process — measured 2026-09-26 through
`GET /api/auth/admin/request-ip-probe`, as the synthetic smoke account, once through
Cloudflare and once straight at the Railway origin, with forged values each time:

  * `X-Forwarded-For` is WRITTEN by Railway as `<connecting address>, <Railway's own
    proxy>`. A caller's `X-Forwarded-For` is DISCARDED on both paths. So the LEFT-most
    entry is the address that connected to Railway — a Cloudflare edge for traffic that
    crossed Cloudflare, the caller itself for a direct hit — and the caller cannot
    forge it. ⛔ The RIGHT-most entry is Railway's internal proxy on every request;
    keying on it would put every member in ONE bucket.
  * `X-Real-IP` is also written by Railway (a forged one is replaced): the true client
    for Cloudflare traffic, the connecting address for a direct hit — even when the
    direct hit forges `CF-Connecting-IP`.
  * `CF-Connecting-IP` is set by Cloudflare for traffic that crossed it (Cloudflare
    refuses a client-sent one, 403). ⛔ A DIRECT hit at the origin can send any value,
    and until this fix it was trusted: a forged `203.0.113.7` was recorded as the
    caller — a caller who skips Cloudflare picked their own rate-limit bucket.

Precedence:
  1. behind Railway's edge (an `X-Forwarded-For` is present):
     a. `CF-Connecting-IP`, but ONLY when the connecting address is inside Cloudflare's
        published ranges;
     b. else `X-Real-IP` (Railway's own answer — it also covers a Cloudflare range
        added after `CLOUDFLARE_RANGES` was fetched);
     c. else the connecting address itself.
  2. not behind Railway (local dev, tests): the peer address. Forwarded headers are not
     trusted when no edge wrote them.
"""
from __future__ import annotations

import ipaddress

#: Cloudflare's published ranges, https://www.cloudflare.com/ips-v4 and /ips-v6, fetched
#: 2026-09-26. A range Cloudflare adds later is simply "not Cloudflare" here, and step
#: 1b (Railway's `X-Real-IP`) still names the true client for it — never a forged header.
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


def _header(request, name: str) -> str | None:
    headers = getattr(request, "headers", None) or {}
    try:
        value = headers.get(name)
    except Exception:  # pragma: no cover - non-dict header stores
        return None
    value = (value or "").strip()
    return value or None


def in_cloudflare(ip: str | None) -> bool:
    """True when `ip` parses and lies inside one of Cloudflare's published ranges."""
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False
    return any(addr in net for net in _CLOUDFLARE_NETWORKS)


def railway_edge_client(request) -> str | None:
    """The address that connected to Railway's edge: the LEFT-most `X-Forwarded-For`
    entry, which Railway writes (a caller's own header is discarded — measured). None
    when there is no such header, i.e. the request did not come through Railway."""
    xff = _header(request, "x-forwarded-for")
    if not xff:
        return None
    first = xff.split(",")[0].strip()
    return first or None


def client_ip(request) -> str:
    edge = railway_edge_client(request)
    if edge:
        cf = _header(request, "cf-connecting-ip")
        if cf and in_cloudflare(edge):
            return cf
        real = _header(request, "x-real-ip")
        if real:
            return real
        return edge
    client = getattr(request, "client", None)
    if client and getattr(client, "host", None):
        return client.host
    return "unknown"


def describe(request) -> dict:
    """The forwarding facts one request arrived with — served to ADMINS only, by
    `GET /api/auth/admin/request-ip-probe`, so the rules above can be re-measured on
    both paths (through Cloudflare, and at the origin) whenever Railway's edge changes."""
    seen = {}
    for name in _FORWARDING_HEADERS:
        value = _header(request, name)
        if value is not None:
            seen[name] = value
    client = getattr(request, "client", None)
    edge = railway_edge_client(request)
    return {
        "peer": getattr(client, "host", None) if client else None,
        "headers": seen,
        "railway_edge_client": edge,
        "edge_in_cloudflare": in_cloudflare(edge),
        "client_ip": client_ip(request),
        "cloudflare_ranges_fetched": "2026-09-26",
    }
