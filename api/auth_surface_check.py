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

DELEGATED ROUTES (2026-07-27)
-----------------------------
web mounts `flow_proxy`'s catch-all forwarders, which execute no handler — they
sign an HMAC vouch and hand the request to flow-worker, whose copy of the router
holds the Depends() gate. Introspecting web's route objects therefore CANNOT see
that gate, and reporting all 56 forwarders as UNGATED (as the 2026-07-27 alert
did) is both false here and the kind of noise that gets a paging channel ignored
— the very failure that let four real ungated routes sit for weeks.

They are not ALLOWED_OPEN either: that list means "checked and safe for a stated
reason", and web has nothing to check. So they get a third bucket, DELEGATED,
which is an obligation rather than a verdict — web asks flow-worker (over private
networking, at VOUCH_PATH) whether it actually gates them, and pages when the
answer is bad, vacuous, or never arrives. A delegation nobody can fail would be a
suppression with better manners.

⚠️ DEPLOY ORDER: flow-worker serves VOUCH_PATH, so ship it FIRST
(`railway up -s flow-worker`). A web deploy that lands first will page once per
boot with `HTTP 404 from /api/admin/auth-surface` until the worker catches up.
"""
from __future__ import annotations

import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

# Where flow-worker answers "do I gate my own mutating routes?". NOT under any
# flow_proxy.PROXY_PREFIXES, so it is reachable only over Railway private
# networking, never from the internet — and push-secret gated on top of that.
VOUCH_PATH = "/api/admin/auth-surface"

# This pod's own most recent audit, served at VOUCH_PATH. None until boot runs.
_LAST_AUDIT: dict | None = None

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


def _is_proxy_forwarder(route) -> bool:
    """True iff this route's handler is flow_proxy's catch-all forwarder.

    Identity against the real function, deliberately — NOT "the path starts with
    /api/flow". A prefix rule would hand a free pass to any genuinely ungated
    endpoint that happens to live under a proxied prefix, which is the one thing
    delegation must never do. Only the forwarder itself can be delegated, and it
    executes no business logic: it validates the session cookie, signs an HMAC
    vouch, and hands the request to flow-worker, whose copy of the router holds
    the actual Depends() gate.
    """
    endpoint = getattr(route, "endpoint", None)
    if endpoint is None:
        return False
    try:
        from api.flow_proxy import _proxy
    except Exception:                          # pragma: no cover - defensive
        return False
    return endpoint is _proxy


def audit_routes(app) -> dict:
    """Inspect `app`'s mutating routes. Pure — returns findings, alerts nothing.

    Three buckets, not two. `ungated` is a verdict: nothing gates this, page.
    `delegated` is an OBLIGATION: the gate is real but lives on flow-worker, so
    this process cannot see it and must go ask (see verify_delegation). Anything
    gated here appears in neither.
    """
    ungated: list[tuple[str, str]] = []
    delegated: list[tuple[str, str]] = []
    checked = 0
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        if not path.startswith(AUDITED_PREFIXES):
            continue
        proxied = _is_proxy_forwarder(route)
        for method in sorted(m for m in methods if m in MUTATING):
            checked += 1
            if (method, path) in ALLOWED_OPEN:
                continue
            if _guard_names_for(route) & GUARD_NAMES:
                continue
            (delegated if proxied else ungated).append((method, path))
    return {
        "checked": checked,
        "ungated": sorted(ungated),
        "delegated": sorted(delegated),
        "ok": not ungated,
    }


def run_startup_audit(app, service: str = "web") -> dict:
    """Audit + log a greppable fingerprint + alert on Discord if anything is open.

    Never raises: a diagnostic that can take down the pod it is diagnosing is a
    worse bug than the one it looks for.
    """
    global _LAST_AUDIT
    try:
        result = audit_routes(app)
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] audit itself failed: %s", e)
        return {"checked": 0, "ungated": [], "delegated": [], "ok": None,
                "error": str(e)}

    result["service"] = service
    _LAST_AUDIT = result

    if result["ok"]:
        logger.info("[startup] auth-surface: service=%s mutating_routes=%d ungated=0 "
                    "delegated=%d OK",
                    service, result["checked"], len(result["delegated"]))
    else:
        listing = ", ".join(f"{m} {p}" for m, p in result["ungated"])
        logger.error("[startup] auth-surface: service=%s mutating_routes=%d UNGATED=%d "
                     "-> %s", service, result["checked"], len(result["ungated"]), listing)
        _alert(service, _ungated_message(service, result))

    if result["delegated"]:
        _start_delegation_vouch(service, result["delegated"])
    return result


def _ungated_message(service: str, result: dict) -> str:
    listing = "\n".join(f"  {m} {p}" for m, p in result["ungated"])
    return (
        f"\U0001F534 **AUTH SURFACE** `{service}` is serving "
        f"{len(result['ungated'])} UNGATED mutating route(s):\n```\n{listing}\n```\n"
        f"Reachable by anyone on the internet. If these were gated in git, the "
        f"deploy did not reach this pod (the flow surface is proxied — gating it "
        f"needs `railway up -s flow-worker`)."
    )


# --- the delegated obligation -------------------------------------------------

def fetch_worker_vouch(timeout: float = 5.0) -> dict:
    """Ask flow-worker for its own audit result over private networking.

    Returns {"reachable": bool, "audit": dict} or {"reachable": False,
    "detail": str}. Never raises — a transport failure is a finding, not a crash.
    """
    base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
    if not base:
        return {"reachable": False, "detail": "WORKER_INTERNAL_URL is unset"}
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    try:
        import httpx
        r = httpx.get(base + VOUCH_PATH, timeout=timeout,
                      headers={"Authorization": f"Bearer {secret}"})
    except Exception as e:                     # noqa: BLE001
        return {"reachable": False, "detail": f"{type(e).__name__}: {e}"}
    if r.status_code != 200:
        return {"reachable": False,
                "detail": f"HTTP {r.status_code} from {VOUCH_PATH} "
                          f"(404 = flow-worker predates this check; deploy it first)"}
    try:
        return {"reachable": True, "audit": r.json()}
    except Exception as e:                     # noqa: BLE001
        return {"reachable": False, "detail": f"unparseable vouch: {e}"}


def _fmt_routes(rows) -> str:
    out = []
    for row in rows or ():
        try:
            m, p = row[0], row[1]
        except Exception:                      # pragma: no cover - defensive
            m, p = "?", str(row)
        out.append(f"  {m} {p}")
    return "\n".join(out)


def verify_delegation(delegated, fetch=None, attempts: int = 10,
                      sleep_s: float = 15.0, service: str = "web") -> dict:
    """Discharge the promise that `delegated` routes are gated on flow-worker.

    Alerts and returns vouched=False when the answer is bad OR unavailable.
    Silence on an unreachable worker would make this a check that cannot fail,
    which is the same suppression the delegated bucket exists to avoid — the pods
    restart independently, so "not answering yet" is retried, but "still not
    answering" pages.
    """
    fetch = fetch or fetch_worker_vouch
    detail = "no attempt made"
    for attempt in range(max(1, attempts)):
        try:
            res = fetch(timeout=5.0)
        except Exception as e:                 # noqa: BLE001
            res = {"reachable": False, "detail": f"{type(e).__name__}: {e}"}

        if res.get("reachable"):
            audit = res.get("audit") or {}
            ok, checked = audit.get("ok"), audit.get("checked") or 0
            if ok is True and checked > 0:
                logger.info("[auth-surface] delegation vouched: flow-worker gates "
                            "%d mutating route(s); %d proxied route(s) covered",
                            checked, len(delegated))
                return {"vouched": True, "reason": "flow-worker vouched"}
            if ok is False:
                return _delegation_failed(service, delegated, (
                    f"flow-worker reports {len(audit.get('ungated') or [])} UNGATED "
                    f"mutating route(s):\n```\n{_fmt_routes(audit.get('ungated'))}\n```"
                ))
            if ok is True:
                return _delegation_failed(service, delegated, (
                    "flow-worker answered ok over ZERO checked routes — a vacuous "
                    "pass. Its flow routers did not mount."
                ))
            detail = "flow-worker has not finished its own audit"
        else:
            detail = str(res.get("detail") or "unreachable")

        if attempt + 1 < max(1, attempts) and sleep_s:
            time.sleep(sleep_s)

    return _delegation_failed(service, delegated,
                              f"flow-worker never vouched: {detail}")


def _delegation_failed(service: str, delegated, reason: str) -> dict:
    logger.error("[auth-surface] delegation UNVERIFIED for %d route(s): %s",
                 len(delegated), reason)
    _alert(service, (
        f"\U0001F7E0 **AUTH SURFACE** `{service}` is proxying {len(delegated)} "
        f"mutating route(s) it cannot verify.\n{reason}\n"
        f"These forward to flow-worker, so their gate lives there and web cannot "
        f"see it. Until flow-worker vouches, treat them as UNVERIFIED — not safe."
    ))
    return {"vouched": False, "reason": reason}


def _start_delegation_vouch(service: str, delegated) -> None:
    """Off the boot path — flow-worker may still be starting, and a diagnostic
    must never be the reason a pod fails its healthcheck."""
    threading.Thread(target=verify_delegation, args=(delegated,),
                     kwargs={"service": service}, daemon=True,
                     name="auth-surface-vouch").start()


def _require_push_secret(authorization: str) -> None:
    from fastapi import HTTPException
    secret = (os.environ.get("PUSH_SECRET") or "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="forbidden")


def build_vouch_router():
    """flow-worker's side of the delegation: serve this pod's own audit result.

    Read-only by construction — it reports what boot already computed and touches
    no handler. Mounted on flow-worker; web consumes it over private networking.
    """
    from fastapi import APIRouter, Header
    from fastapi.responses import JSONResponse

    router = APIRouter()

    @router.get(VOUCH_PATH, include_in_schema=False)
    def auth_surface_vouch(authorization: str = Header(default="")):
        _require_push_secret(authorization)
        if _LAST_AUDIT is None:
            return JSONResponse({"ok": None, "checked": 0,
                                 "detail": "audit has not run"})
        return JSONResponse(_LAST_AUDIT)

    return router


def _alert(service: str, message: str) -> None:
    """Best-effort Discord alert. Never raises."""
    webhook = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not webhook:
        return
    try:
        import httpx
        httpx.post(webhook, json={"content": message}, timeout=10,
                   headers={"User-Agent": "Mozilla/5.0"})
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] alert failed: %s", e)
