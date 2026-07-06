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
