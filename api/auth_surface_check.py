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

import inspect
import io
import json
import logging
import os
import textwrap
import threading
import time
import tokenize

# ⭐ TERM-011 / RM-N09 step 3 — the OPS-class destination reader. MODULE level: `_alert`
# below reads the webhook BEFORE its try/except, so a lazy import there could raise
# out of a function whose docstring promises it never raises.
from api.services.alert_destination import ops_webhook as _ops_webhook

logger = logging.getLogger(__name__)

# Where flow-worker answers "do I gate my own mutating routes?". NOT under any
# flow_proxy.PROXY_PREFIXES, so it is reachable only over Railway private
# networking, never from the internet — and push-secret gated on top of that.
VOUCH_PATH = "/api/admin/auth-surface"

# This pod's own most recent audit, served at VOUCH_PATH. None until boot runs.
_LAST_AUDIT: dict | None = None

# Dependencies that constitute a gate, matched by `__name__` anywhere in a
# route's dependency tree. ⚰️ This said "kept in sync with the static test's
# GUARDS"; it was not (`require_paid` was never in that set) — the two are
# different instruments over different inputs, and neither is derived from the
# other.
#
# ⭐ TERM-026 added the last three. Each was already a real, fail-closed gate
# that reads its credential ITSELF rather than through `get_current_user`, so a
# `Depends`-shaped audit reported every route behind it as open — measured
# 2026-09-27 over `api.main:app`: 13 chart-data GETs (`require_bars_access`,
# `api/bars_auth.py`), 9 worker GETs (`require_push_secret`, one copy per
# router, every one raising 401 on a blank or wrong bearer) and 5 Desk-article
# GETs (`require_article_reader`, `api/routers/desk.py`, fails closed to `paid`).
# Invisible while the aperture was mutating-only; the first GET census would
# otherwise have reported 27 gated routes as findings.
GUARD_NAMES = {
    "require_flow_admin",
    "require_flow_user",
    "require_admin",
    "get_current_user",
    "verify_push_secret",
    "require_paid",
    "require_bars_access",
    "require_push_secret",
    "require_article_reader",
}

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# ⭐ The STAGED read gate (`api/open_reads_gate.py`, flag OPEN_READS_GATE).
# ⛔ DELIBERATELY NOT IN GUARD_NAMES. It is attached where whole routers are
# MOUNTED, so it sits in the tree of routes it does not govern — mutating routes
# (it passes every non-GET/HEAD straight through) and unclassified reads. In
# GUARD_NAMES it would mark an ungated POST in the same router "gated" and hide
# it from the boot page. So it counts as a gate ONLY in the read census, and only
# for a route its own table (`GATED_READS`) classifies.
READ_GATE_NAME = "open_reads_gate"

# ⭐ TERM-026 / GATE-7 — THE READ APERTURE. `MUTATING` above decides what PAGES
# at boot and is deliberately unchanged; this decides what the census EXAMINES.
# The risk the auditor exists for is an unauthenticated GET of vendor or member
# data, and a terminal is read-shaped, so an instrument that looked only at
# MUTATING was reassuring in exactly the region the terminal lives in.
READ_METHODS = frozenset({"GET", "HEAD"})

# Routes that are open TODAY, recorded by name with a reason, so the widened
# aperture reports what is NEW rather than re-reporting what is known. A ratchet:
# an entry that stops being true is itself a finding (see `audit_surface`).
READ_BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "auth_surface_read_baseline.json")

#: `inline` — gated in the handler BODY, not by a `Depends`; carries a `marker`
#:            that must still appear in the comment-stripped handler source.
#: `public` — deliberately anonymous (health, capability links, OAuth callbacks).
#: `open`   — NO gate found anywhere. Recorded so the census can gate on what
#:            is new; recording is not a ruling that it is safe.
BASELINE_KINDS = ("inline", "public", "open")

# Prefixes whose mutating routes must be gated. Deliberately a allow-list of
# what we AUDIT rather than of what may be open — an unlisted router is simply
# not checked here, which is honest, instead of being silently declared safe.
AUDITED_PREFIXES = (
    "/api/flow",
    "/api/flow-reconcile",
    "/api/live/massive",
    "/api/live",
    "/api/oi",
    # 🔴 ADDED 2026-08-09. `/api/admin` was NOT audited, which is the second
    # reason `AdminGuardMiddleware` being unregistered was silent: the boot
    # check that exists to say "this pod is serving ungated mutating routes"
    # was not looking at the admin surface at all, so ~30 destructive ops sat
    # open with a green fingerprint in the log every morning.
    "/api/admin",
    # 🔴 ADDED 2026-08-24, closing the backtest wiring review's concern #3
    # ("no auth-rail completeness assertion — any new router added to this repo
    # today lands unchecked"). `/api/screener` carries the saved-screen and
    # scan-refresh mutations and, once `SCREEN_BACKTEST_ENABLED` is set, the
    # backtest POST as well. Its routes are gated per-handler and the source is
    # covered by `tests/test_screener_backtest_auth.py`, but "gated in git" and
    # "gated in production" are the two different facts this module exists to
    # separate — the backtest router is mounted BEHIND A FLAG, so the surface
    # this pod actually serves is not knowable from the source at all.
    # ⚠️ MEASURED BEFORE ADDING: the real audit run over the live app with this
    # prefix reports ZERO ungated mutating routes, so it cannot page on boot.
    "/api/screener",
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

    # ── surfaced 2026-08-09 by adding /api/admin to AUDITED_PREFIXES ──────────
    # All five are `api/routers/bars.py` handlers whose FIRST statement is
    # `_check_admin_auth(request)` — `bars_fetch._check_admin_auth`, which 401s
    # unless `Authorization: Bearer <PUSH_SECRET>` matches and 500s when
    # PUSH_SECRET is unset (fail-closed both ways). They are curl-driven ops
    # endpoints, which is why they take a bearer rather than a session.
    # ⛔ THE PAIRED ASSERTION, per this dict's own contract, is
    # `test_admin_guard_registered.py::test_every_allowed_open_admin_route_still
    # _calls_its_inline_gate` — and it DERIVES the five from this dict rather
    # than restating them, so an entry added here without a real gate goes red.
    ("POST", "/api/admin/warm-universe"):
        "Gated INLINE by _check_admin_auth(request) (Bearer PUSH_SECRET).",
    ("POST", "/api/admin/warm-universe-stop"):
        "Gated INLINE by _check_admin_auth(request) (Bearer PUSH_SECRET).",
    ("POST", "/api/admin/ticker-liveness"):
        "Gated INLINE by _check_admin_auth(request) (Bearer PUSH_SECRET).",
    ("POST", "/api/admin/refresh-bars-all"):
        "Gated INLINE by _check_admin_auth(request) (Bearer PUSH_SECRET).",
    ("POST", "/api/admin/refresh-bars/{ticker}"):
        "Gated INLINE by _check_admin_auth(request) (Bearer PUSH_SECRET).",
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


def middleware_guarded_prefixes(app) -> tuple[str, ...]:
    """Path prefixes gated by a middleware that is ACTUALLY INSTALLED on `app`.

    ⛔ BOTH HALVES ARE DERIVED, NEITHER IS TYPED. The prefix list comes from
    `admin_guard.GUARDED_PREFIXES` — the same tuple the middleware itself
    matches on — and the installation is read from `app.user_middleware`, the
    registry Starlette iterates when it builds the stack.

    ⭐ THAT SECOND HALF IS THE ENTIRE POINT. `AdminGuardMiddleware` shipped
    complete, fails closed, and had 8 green tests while `add_middleware` was
    never called anywhere in `api/main.py` — so a `Depends`-shaped audit saw
    nothing and a prefix-shaped audit would have declared those routes safe on
    the strength of a module that was not running. This function returns `()`
    the moment the registration goes away, which flips every route it covered
    straight back into `ungated` and pages at the next boot. A gate this audit
    cannot see disappear is a suppression, not a check.
    """
    try:
        from api.middleware.admin_guard import AdminGuardMiddleware, GUARDED_PREFIXES
    except Exception:                          # pragma: no cover - defensive
        return ()
    for mw in getattr(app, "user_middleware", []) or []:
        if getattr(mw, "cls", None) is AdminGuardMiddleware:
            return tuple(GUARDED_PREFIXES)
    return ()


def audit_routes(app) -> dict:
    """Inspect `app`'s mutating routes. Pure — returns findings, alerts nothing.

    Four buckets, not two. `ungated` is a verdict: nothing gates this, page.
    `delegated` is an OBLIGATION: the gate is real but lives on flow-worker, so
    this process cannot see it and must go ask (see verify_delegation).
    `middleware_gated` is a route whose gate is an installed ASGI middleware
    rather than a `Depends()` — invisible to `route.dependant`, so it is
    reported by name rather than silently counted as fine. Anything gated by a
    dependency appears in none of them.
    """
    ungated: list[tuple[str, str]] = []
    delegated: list[tuple[str, str]] = []
    middleware_gated: list[tuple[str, str]] = []
    mw_prefixes = middleware_guarded_prefixes(app)
    checked = 0
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        if not path.startswith(AUDITED_PREFIXES):
            continue
        proxied = _is_proxy_forwarder(route)
        by_middleware = bool(mw_prefixes) and path.startswith(mw_prefixes)
        for method in sorted(m for m in methods if m in MUTATING):
            checked += 1
            if (method, path) in ALLOWED_OPEN:
                continue
            if _guard_names_for(route) & GUARD_NAMES:
                continue
            if by_middleware:
                middleware_gated.append((method, path))
                continue
            (delegated if proxied else ungated).append((method, path))
    return {
        "checked": checked,
        "ungated": sorted(ungated),
        "delegated": sorted(delegated),
        "middleware_gated": sorted(middleware_gated),
        "ok": not ungated,
    }


#: The SPA catch-all api/main.py mounts only when app/dist is built.
SPA_CATCH_ALL = "/{full_path:path}"


def load_read_baseline(path: str | None = None) -> dict:
    """`{(method, path): {"kind", "reason", ["marker"]}}` from the baseline file.

    Missing or unreadable ⇒ `{}` — which FAILS CLOSED: every open read then
    reports as new. That is the right direction for a gate and the wrong one for
    a quiet boot, which is why the boot log only reports reads (never pages).
    """
    try:
        with open(path or READ_BASELINE_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        logger.warning("[auth-surface] read baseline unreadable: %s", e)
        return {}
    out: dict = {}
    for row in data.get("routes") or ():
        entry = {k: v for k, v in row.items() if k not in ("method", "path")}
        out[(str(row["method"]).upper(), str(row["path"]))] = entry
    return out


def _code_tokens(fn) -> str | None:
    """The handler's source with comments and docstrings removed, as one string
    of tokens — or None when the source cannot be read. Prose that NAMES a gate
    is not a gate; only code that calls it is."""
    try:
        src = inspect.getsource(fn)
    except (OSError, TypeError):
        return None
    kept = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(textwrap.dedent(src)).readline):
            if tok.type == tokenize.COMMENT:
                continue
            if tok.type == tokenize.STRING and \
                    tok.string.lstrip("rbuRBUfF").startswith(('"""', "'''")):
                continue
            kept.append(tok.string)
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return None
    return " ".join(kept)


def _handler_mentions(fn, marker: str) -> bool:
    """True iff `marker` appears in the handler's CODE (not its comments or
    docstring). An unreadable source answers False, never True."""
    code = _code_tokens(fn)
    return bool(code) and bool(marker) and marker in code


def audit_surface(app, baseline: dict | None = None) -> dict:
    """The WHOLE route table: a published denominator plus two verdicts.

    ⭐ THE DENOMINATOR IS THE DELIVERABLE (TERM-026). A guard that reports
    "0 unguarded" without saying over how many routes cannot be told apart from
    one that examined nothing. So this returns, derived from `app.routes` and
    never typed: `routes_total` (every (method, path) pair), `by_method`,
    `examined` (every read in the app + the mutating routes `audit_routes`
    checks), and the read buckets, which close over what was examined.

    Reads (`READ_METHODS`, whole app, first registration of a (method, path)
    wins — as it does in FastAPI):
      gated            — a `GUARD_NAMES` dependency in the tree
      middleware_gated — under an INSTALLED admin-guard prefix
      delegated        — flow_proxy's forwarder (gate lives on flow-worker)
      recorded[kind]   — named in the baseline (see `BASELINE_KINDS`)
      ungated          — none of the above: a FINDING

    Also findings: `stale_baseline` (an entry for a route now gated, or gone —
    the ratchet only moves down) and `inline_marker_missing` (an `inline`
    entry whose gate no longer appears in its handler's code).

    Mutating: `audit_routes(app)` verbatim — the boot verdict is unchanged.
    Pure: sends no request, runs no handler.
    """
    if baseline is None:
        baseline = load_read_baseline()
    mw_prefixes = middleware_guarded_prefixes(app)
    try:
        from api import open_reads_gate as _org
        staged_family = _org.family_of
        staged_mode = _org.mode()
    except Exception:                          # pragma: no cover - defensive
        staged_family, staged_mode = (lambda _p: None), "unavailable"

    routes_total = 0
    by_method: dict[str, int] = {}
    seen: set[tuple[str, str]] = set()
    shadowed = 0
    gated = mw_gated = delegated = flag_gated = 0
    recorded = {k: 0 for k in BASELINE_KINDS}
    ungated: list[tuple[str, str]] = []
    marker_missing: list[tuple[str, str]] = []
    open_read_keys: set[tuple[str, str]] = set()

    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        for method in sorted(methods):
            routes_total += 1
            by_method[method] = by_method.get(method, 0) + 1
            if method not in READ_METHODS:
                continue
            key = (method, path)
            if key in seen:
                shadowed += 1          # FastAPI serves the first registration
                continue
            seen.add(key)
            names = _guard_names_for(route)
            if names & GUARD_NAMES:
                gated += 1
                continue
            # The staged read gate: a gate for THIS read only when it is in the
            # tree AND its table classifies the route. Counted inside `gated` so
            # the buckets still close, and reported separately WITH THE MODE —
            # while OPEN_READS_GATE is off these answer anonymously, and a census
            # that hid that would be a proxy for "gated" rather than the fact.
            if READ_GATE_NAME in names and staged_family(path):
                gated += 1
                flag_gated += 1
                continue
            if mw_prefixes and path.startswith(mw_prefixes):
                mw_gated += 1
                continue
            if _is_proxy_forwarder(route):
                delegated += 1
                continue
            open_read_keys.add(key)
            entry = baseline.get(key)
            if entry is None:
                ungated.append(key)
                continue
            kind = entry.get("kind")
            if kind not in recorded:
                ungated.append(key)    # an unknown kind is not a recording
                continue
            if kind == "inline" and not _handler_mentions(
                    getattr(route, "endpoint", None), entry.get("marker", "")):
                marker_missing.append(key)
            recorded[kind] += 1

    # ⛔ NOT filtered by READ_METHODS. Mutation-proved 2026-09-27: with GET
    # dropped from the aperture and this filtered, every GET entry silently left
    # the stale set and the CLI exited 0 over 4 examined reads. An entry the
    # census can no longer SEE is stale for that reason too, which makes the
    # baseline itself a floor on the aperture.
    # `requires_dist`: the SPA shell and root-level static files are registered by
    # api/main.py only `if os.path.exists(DIST)` — a checkout with no built
    # frontend has none of them. Their absence is stale ONLY when the bundle's
    # routes are present at all, read from the app itself (the SPA catch-all),
    # never from the filesystem, so one missing asset in a built app still fails.
    dist_served = any(k[1] == SPA_CATCH_ALL for k in seen)
    stale = sorted(k for k in baseline if k not in open_read_keys
                   and (dist_served or not baseline[k].get("requires_dist")))
    mutating = audit_routes(app)
    reads_examined = len(seen)
    reads = {
        "examined": reads_examined,
        "shadowed": shadowed,
        "gated": gated,
        "flag_gated": flag_gated,
        "flag_mode": staged_mode,
        "middleware_gated": mw_gated,
        "delegated": delegated,
        "recorded": recorded,
        "ungated": sorted(ungated),
    }
    ok = not (ungated or stale or marker_missing or mutating["ungated"])
    return {
        "routes_total": routes_total,
        "by_method": dict(sorted(by_method.items())),
        "examined": reads_examined + mutating["checked"],
        "reads": reads,
        "mutating": mutating,
        "stale_baseline": stale,
        "inline_marker_missing": sorted(marker_missing),
        "ok": ok,
    }


def format_denominator(res: dict) -> str:
    """One greppable line. Every number is read off `audit_surface`'s result."""
    r = res["reads"]
    return (
        f"examined {res['examined']}/{res['routes_total']} (method,path) | "
        f"reads {r['examined']}: gated={r['gated']} "
        f"(of which OPEN_READS_GATE-staged={r.get('flag_gated', 0)} "
        f"mode={r.get('flag_mode', '?')}) "
        f"middleware_gated={r['middleware_gated']} delegated={r['delegated']} "
        f"public={r['recorded']['public']} inline={r['recorded']['inline']} "
        f"recorded_open={r['recorded']['open']} UNRECORDED={len(r['ungated'])} | "
        f"mutating(audited prefixes) {res['mutating']['checked']}: "
        f"UNGATED={len(res['mutating']['ungated'])} | "
        f"stale_baseline={len(res['stale_baseline'])} "
        f"inline_marker_missing={len(res['inline_marker_missing'])} | "
        f"by_method={res['by_method']}"
    )


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
                    "delegated=%d middleware_gated=%d OK",
                    service, result["checked"], len(result["delegated"]),
                    len(result.get("middleware_gated") or ()))
    else:
        listing = ", ".join(f"{m} {p}" for m, p in result["ungated"])
        logger.error("[startup] auth-surface: service=%s mutating_routes=%d UNGATED=%d "
                     "-> %s", service, result["checked"], len(result["ungated"]), listing)
        _alert(service, _ungated_message(service, result))

    # ⭐ TERM-026 — the READ census and its denominator, LOGGED, NEVER PAGED.
    # `ok` above stays the mutating verdict, because two things read it: this
    # function's page, and web's `verify_delegation`, which pages "flow-worker
    # reports N UNGATED mutating route(s)" off the worker's `ok`. Folding reads
    # into it would mislabel that page, and this pod's table differs from the one
    # the baseline was measured on (flag-mounted routers; flow-worker serves
    # `/internal/health`), so a read page here would fire on things no local run
    # could see. The gate for reads is `tools/auth_surface_audit.py` and
    # `tests/test_auth_surface_reads.py`; this line is the production-side
    # measurement, so "examined nothing" is visible here too.
    try:
        surface = audit_surface(app)
        result["reads_census"] = {
            "denominator": format_denominator(surface),
            "unrecorded": [f"{m} {p}" for m, p in surface["reads"]["ungated"]],
        }
        log = logger.warning if surface["reads"]["ungated"] else logger.info
        log("[startup] auth-surface-reads: service=%s %s", service,
            result["reads_census"]["denominator"])
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] read census failed: %s", e)

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
    # ⭐ TERM-011 / RM-N09 step 3 — the OPS-class destination, resolved at CALL time.
    # ⛔ With DISCORD_OPS_WEBHOOK_URL unset or blank (how it ships, and what production
    # holds) this returns DISCORD_WEBHOOK_URL's value — exactly what the literal read
    # that stood here returned. Same channel, same bytes; proved at the wire in
    # tests/test_alert_destination.py.
    webhook = (_ops_webhook() or "").strip()
    if not webhook:
        return
    try:
        import httpx
        httpx.post(webhook, json={"content": message}, timeout=10,
                   headers={"User-Agent": "Mozilla/5.0"})
    except Exception as e:                     # pragma: no cover - defensive
        logger.warning("[auth-surface] alert failed: %s", e)
