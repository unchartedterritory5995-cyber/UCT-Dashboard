"""Boot-time assertion that the DEPLOYED app actually gates its mutating routes.

WHY NOT JUST THE STATIC TEST
----------------------------
`tests/test_flow_auth_surface.py` reads the source and proves the code is right.
Its own docstring names the gap it cannot close:

    "This test passing means the code is right, NOT that production is
     protected."

Because the flow surface is PROXIED (`flow_proxy.PROXY_PREFIXES`), a gate added
on web never reaches the flow-worker's own copy of the router — that needs
`railway up -s flow-worker`. So "gated in git" and "gated in production" are
genuinely different facts, and the 2026-07-26 audit found four ungated mutating
routes that had looked fine in review for weeks.

WHY NOT A PROBE
---------------
The obvious canary — fire an unauthenticated POST and expect 401/403 — is unsafe
by construction. It is harmless only WHEN THE GATE WORKS; in the one case it
exists to detect, the request is not rejected and the handler RUNS. That is not
hypothetical: during this audit a probe of a mutating endpoint executed a real
production job (8,108 contracts captured) before anyone intended it.

So this reads the live route objects instead. It touches no handler, sends no
request, and cannot have side effects — but it inspects the ACTUAL objects this
process is serving, which is the fact the static test cannot establish.

Runs once at startup on both pods. Routes do not change at runtime, so there is
nothing to re-check on a schedule.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Dependencies that constitute a gate. Kept in sync with the static test's GUARDS.
GUARD_NAMES = {
    "require_flow_admin",
    "require_flow_user",
    "require_admin",
    "get_current_user",
    "verify_push_secret",
    "require_paid",
}

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Prefixes whose mutating routes must be gated. Deliberately a allow-list of
# what we AUDIT rather than of what may be open — an unlisted router is simply
# not checked here, which is honest, instead of being silently declared safe.
AUDITED_PREFIXES = (
    "/api/flow",
    "/api/flow-reconcile",
    "/api/live/massive",
    "/api/live",
    "/api/oi",
)

# Routes with no Depends() gate that are nonetheless protected, each with its
# reason. (method, path) -> why.
#
# An entry here is a promise this audit CANNOT keep on its own — if the inline
# check is later deleted, the allow-list would keep reporting OK. So every entry
# must be paired with a source-level assertion in
# tests/test_flow_auth_surface.py that the inline check still exists. Do not add
# an entry without one.
ALLOWED_OPEN: dict[tuple[str, str], str] = {
    ("POST", "/api/live/massive/stream-test"):
        "Gated INLINE, not by Depends(): the handler compares "
        "Authorization: Bearer against PUSH_SECRET and returns 403 otherwise. "
        "Asserted by test_stream_test_keeps_its_inline_push_secret_gate.",
    ("POST", "/api/flow-backup/run"):
        "Gated INLINE, not by Depends(): trigger_run() calls "
        "_require_push_secret(authorization) before spawning the backup thread. "
        "Asserted by test_flow_backup_run_keeps_its_inline_push_secret_gate.",
}


def _guard_names_for(route) -> set[str]:
    """Every dependency callable reachable from a route, by name.

    Walks the whole tree because a gate is frequently nested one level down
    (a router-level `dependencies=[Depends(require_flow_admin)]`, or a guard
    that itself Depends on `get_current_user`). Checking only the top level
    would report a correctly-gated route as open.
    """
    found: set[str] = set()
    dependant = getattr(route, "dependant", None)
    if dependant is None:
        return found
    stack, seen = [dependant], set()
    while stack:
        d = stack.pop()
        if id(d) in seen:
            continue
        seen.add(id(d))
        call = getattr(d, "call", None)
        name = getattr(call, "__name__", None)
        if name:
            found.add(name)
        stack.extend(getattr(d, "dependencies", []) or [])
    return found


def audit_routes(app) -> dict:
    """Inspect `app`'s mutating routes. Pure — returns findings, alerts nothing."""
    ungated: list[tuple[str, str]] = []
    checked = 0
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        if not path.startswith(AUDITED_PREFIXES):
            continue
        for method in sorted(m for m in methods if m in MUTATING):
            checked += 1
            if (method, path) in ALLOWED_OPEN:
                continue
            if not (_guard_names_for(route) & GUARD_NAMES):
                ungated.append((method, path))
    return {
        "checked": checked,
        "ungated": sorted(ungated),
        "ok": not ungated,
    }


def run_startup_audit(app, service: str = "web") -> dict:
    """Audit + log a greppable fingerprint + alert on Discord if anything is open.

    Never raises: a diagnostic that can take down the pod it is diagnosing is a
    worse bug than the one it looks for.
    """
    try:
        result = audit_routes(app)
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] audit itself failed: %s", e)
        return {"checked": 0, "ungated": [], "ok": None, "error": str(e)}

    if result["ok"]:
        logger.info("[startup] auth-surface: service=%s mutating_routes=%d ungated=0 OK",
                    service, result["checked"])
        return result

    listing = ", ".join(f"{m} {p}" for m, p in result["ungated"])
    logger.error("[startup] auth-surface: service=%s mutating_routes=%d UNGATED=%d -> %s",
                 service, result["checked"], len(result["ungated"]), listing)
    _alert(service, result)
    return result


def _alert(service: str, result: dict) -> None:
    """Best-effort Discord alert. Never raises."""
    webhook = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not webhook:
        return
    try:
        import httpx
        listing = "\n".join(f"  {m} {p}" for m, p in result["ungated"])
        httpx.post(
            webhook,
            json={"content": (
                f"\U0001F534 **AUTH SURFACE** `{service}` is serving "
                f"{len(result['ungated'])} UNGATED mutating route(s):\n```\n{listing}\n```\n"
                f"Reachable by anyone on the internet. If these were gated in git, the "
                f"deploy did not reach this pod (the flow surface is proxied — gating it "
                f"needs `railway up -s flow-worker`)."
            )},
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0"},
        )
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] alert failed: %s", e)
