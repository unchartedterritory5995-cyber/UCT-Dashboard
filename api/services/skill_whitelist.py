"""TERM-061 / BRK-06 / FT-040 -- the agent skill file and its endpoint whitelist, GENERATED from
the live route table. Served by `api/routers/skill_file.py` at `GET /api/skill.md` and
`GET /api/skill/whitelist` (owner ruling T-16: publish once `RATE_LIMIT_POLICY=enforce`; no MCP).

FB-X2-01: *"publish a skill file with an endpoint whitelist, because the whitelist is the
load-bearing half"* -- it exists to stop somebody else's agent inventing endpoints. Its named
anti-pattern is DOC-1: *"a whitelist is a roster, and it must be generated from the registry,
or it becomes the thing it exists to prevent."* So nothing here is typed: every entry is derived
from the app's routes, `auth_surface_check`'s guard walk, the open-reads gate's table, the
rate-limit families and the personal-API scope markers.

TWO LISTS, TWO CREDENTIALS, AND THEY DO NOT MIX:

  * `personal_token` -- every route a Personal API token (`Authorization: Bearer uctpat_...`)
    can reach. Derived from the SAME thing the auth check enforces: a route accepts the bearer
    only when its resolved dependency graph carries a `require_capture_scope(<scope>)` closure
    (the `_capture_scope` marker) whose scope is one of `capture_auth.PERSONAL_SCOPES`, the
    scopes a personal token is minted with. `get_current_user` reads a cookie and nothing else
    (railed by tests/test_capture_auth_boundary.py), so every other route refuses the token.
    This list and that check therefore cannot disagree: they are one walk over one marker.
  * `entries` -- member-callable GET reads that need the member's own signed-in session:
      - method GET, under `/api/`, outside the excluded prefixes below;
      - gated at MEMBER or PAID level (`require_paid` => `paid`; the member guards => `member`;
        or the open-reads gate's own table says paid/member). An ADMIN or machine-secret guard
        anywhere in the tree excludes the route. An OPEN route is excluded;
      - declared in a rate-limit family (FB-S9-03, "limits before any programmatic client").
        A route with no family is excluded and reported, never listed.
    Each entry carries the `tier` the caller must hold (entitlement inheritance: an agent acting
    for a member gets exactly that member's access) and the family's limit, read from
    `api/rate_limit_policy.FAMILIES`, never restated.

`tests/test_skill_whitelist.py` holds the committed `docs/api/` copies equal to what this module
generates from `api.main:app`; `tests/test_skill_file_route.py` holds the served list equal to
the enforced set on a minimal app.
"""
from __future__ import annotations

import json
import re

EXCLUDED_PREFIXES = (
    "/api/admin", "/api/auth", "/api/stream", "/api/r/", "/api/webhooks", "/api/push",
    "/api/desk/zoom-webhook", "/api/debug",
)

#: Member-gated reads that still do not belong in an AGENT's whitelist, each with its reason.
#: Matched against the route template. A new route matching one of these is excluded by rule,
#: not by a hand-typed path list.
EXCLUDED_PATTERNS = (
    (r"token", "credential or capability-link surface (minting, listing, or a secret in the path)"),
    (r"/capture/connections|/connectors", "linked-account management, not a data read"),
    (r"-debug(/|$)", "diagnostic route"),
)

ADMIN_GUARDS = {"require_admin", "require_flow_admin", "verify_push_secret", "require_push_secret"}
PAID_GUARDS = {"require_paid"}
MEMBER_GUARDS = {"get_current_user", "require_flow_user", "require_bars_access", "require_article_reader"}

SKILL_MD_PATH = "/api/skill.md"
WHITELIST_PATH = "/api/skill/whitelist"

#: Request and response shapes for the personal-token doors, keyed by (method, path). This is
#: the ONLY hand-written part, because a body read inside the handler has no schema to derive.
#: The ROUTE SET is never taken from here: `personal_token_routes` derives it, and
#: tests/test_skill_file_route.py fails if a derived door has no entry or an entry has no door.
PERSONAL_DOOR_DOCS: dict[tuple[str, str], dict] = {
    ("POST", "/api/j2/personal/notes"): {
        "summary": "Create a note in the member's Notebook from markdown.",
        "body": [
            ("title", "text, optional", "the note's title"),
            ("markdown", "text, optional", "the body; a note needs a title or some markdown"),
            ("folder", "text, optional", "a folder path like `Inbox/Ideas`, made on first use"),
            ("tags", "list of text, optional", "tags to set on the note"),
        ],
        "response": '{"note": {"id": "<note id>", "title": "<title>", "url": '
                    '"https://uctintelligence.com/journal/notebook?note=<note id>"}}',
    },
    ("POST", "/api/j2/personal/notes/{note_id}/append"): {
        "summary": "Append markdown to the end of one of the member's notes.",
        "body": [
            ("markdown", "text, required", "the text to add"),
        ],
        "response": '{"note": {"id": "<note id>", "title": "<title>", "url": "<note url>"}}',
    },
    ("POST", "/api/j2/personal/daily/append"): {
        "summary": "Append markdown to today's daily note (the server's Eastern-time day), "
                   "creating it from the member's daily template if it does not exist yet.",
        "body": [
            ("markdown", "text, required", "the text to add"),
        ],
        "response": '{"note": {"id": "<note id>", "title": "<title>", "url": "<note url>"}, '
                    '"created": true, "day": "YYYY-MM-DD"}',
    },
}


def _tier(route, path: str) -> str | None:
    from api import auth_surface_check as asc
    from api import open_reads_gate as org

    guards = asc._guard_names_for(route)
    if guards & ADMIN_GUARDS:
        return None
    if guards & PAID_GUARDS:
        return "paid"
    if guards & MEMBER_GUARDS:
        return "member"
    if asc.READ_GATE_NAME in guards:
        fam = org.family_of(path)
        if fam in ("paid", "member"):
            return fam
    return None


def _scopes_of(route) -> set[str]:
    """Every `_capture_scope` marker in the route's resolved dependency graph."""
    found: set[str] = set()

    def walk(dep):
        scope = getattr(getattr(dep, "call", None), "_capture_scope", None)
        if scope:
            found.add(scope)
        for sub in getattr(dep, "dependencies", []) or []:
            walk(sub)

    dependant = getattr(route, "dependant", None)
    if dependant is not None:
        walk(dependant)
    return found


def personal_token_routes(app) -> list[dict]:
    """`[{"method", "path", "scope"}]`: the routes a Personal API token can reach, sorted.

    A route qualifies when one of its scope markers is a personal scope. A route whose marker is
    a Browser Capture scope refuses a personal token (403), so it is not listed."""
    from api.services.journal_two import capture_auth

    personal = set(capture_auth.PERSONAL_SCOPES)
    out, seen = [], set()
    for route in getattr(app, "routes", []):
        scopes = _scopes_of(route) & personal
        if not scopes:
            continue
        for method in sorted(getattr(route, "methods", None) or ()):
            key = (method, route.path)
            if key in seen:
                continue
            seen.add(key)
            out.append({"method": method, "path": route.path, "scope": sorted(scopes)[0]})
    out.sort(key=lambda e: (e["path"], e["method"]))
    return out


def _params(route) -> str:
    """The route's path and query parameters, read from FastAPI's own dependency model."""
    try:
        from fastapi.dependencies.utils import get_flat_dependant
        flat = get_flat_dependant(route.dependant, skip_repeats=True)
    except Exception:  # noqa: BLE001 -- a route we cannot introspect lists no params
        return ""
    parts = []
    for p in flat.path_params:
        parts.append(f"{{{p.alias}}}")
    for p in flat.query_params:
        if p.required:
            parts.append(f"{p.alias} (required)")
        else:
            default = getattr(p.field_info, "default", None)
            if default is None or default == "" or isinstance(default, (list, dict, set)):
                parts.append(p.alias)
            else:
                text = str(default)
                parts.append(f"{p.alias}={text[:24]}")
    return ", ".join(parts).replace("|", "/")


def build(app) -> dict:
    """`{"personal_token": [...], "entries": [...], "excluded_no_rate_family": [...]}`,
    sorted and deterministic."""
    from api import rate_limit_policy as rlp

    entries, no_family = [], []
    seen = set()
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        if "GET" not in methods or not path.startswith("/api/"):
            continue
        if path.startswith(EXCLUDED_PREFIXES) or (path in seen):
            continue
        if any(re.search(pat, path, re.I) for pat, _why in EXCLUDED_PATTERNS):
            continue
        tier = _tier(route, path)
        if tier is None:
            continue
        hit = rlp.classify(path)
        if hit is None:
            no_family.append(path)
            continue
        if hit[0] != rlp.KIND_FAMILY:
            continue
        seen.add(path)
        entries.append({
            "method": "GET", "path": path, "tier": tier,
            "rate_limit_family": hit[1], "limit": rlp.FAMILIES[hit[1]].limit,
            "params": _params(route),
        })
    entries.sort(key=lambda e: e["path"])
    return {
        "personal_token": personal_token_routes(app),
        "entries": entries,
        "excluded_no_rate_family": sorted(set(no_family)),
    }


def to_json(data: dict) -> str:
    return json.dumps(data, indent=2, sort_keys=True) + "\n"


def _limits() -> dict:
    """Every number the skill file states, read from the module that enforces it."""
    from api.routers import data_exports as exports_router
    from api.routers import notebook_personal_api as papi_router
    from api.services import data_exports as exports_svc
    from api.services.journal_two import capture_auth
    from api.services.journal_two import note_personal_api as papi

    return {
        "personal_rate": papi_router._RATE,
        "personal_ttl_days": capture_auth.PERSONAL_TOKEN_TTL_DAYS,
        "personal_prefix": capture_auth.PERSONAL_TOKEN_PREFIX,
        "personal_max_tokens": capture_auth.MAX_PERSONAL_TOKENS,
        "personal_max_kb": papi.MAX_MARKDOWN_BYTES // 1024,
        "personal_gate": papi.PERSONAL_API_GATE,
        "export_burst": exports_router.EXPORT_BURST,
        "export_daily_default": exports_svc.DEFAULT_DAILY_CAP,
    }


def to_skill_md(data: dict) -> str:
    from api import rate_limit_policy as rlp

    lim = _limits()
    personal = data.get("personal_token") or []
    entries = data.get("entries") or []
    lines = [
        "# UCT Intelligence: skill file for AI agents and scripts",
        "",
        f"Served at `GET {SKILL_MD_PATH}`. The same lists as JSON: `GET {WHITELIST_PATH}`.",
        "Generated by `api/services/skill_whitelist.py` from the live route table; do not edit by hand.",
        "Regenerate the committed copy with `UPDATE_SKILL_WHITELIST=1 python -m pytest tests/test_skill_whitelist.py`.",
        "",
        "## Rules for an agent",
        "",
        "- Call ONLY the endpoints listed in this file. If a task needs an endpoint that is not",
        "  listed, say it is not available. Never guess or build a path.",
        "- There are two credentials and two lists, and they do not mix:",
        "  1. A Personal API token works ONLY on the endpoints under \"Personal API token endpoints\".",
        "     Every other endpoint refuses it (401 or 403).",
        "  2. The endpoints under \"Member session reads\" need the member's own signed-in UCT session",
        "     (the `uct_session` cookie a browser holds after sign-in). They are for an agent working",
        "     inside the member's own browser. A personal token is refused there.",
        "- You can read only what the member can read. A `paid` endpoint answers 402 to a member",
        "  without a paid plan. Report that; do not look for another endpoint.",
        "- On 429, wait the number of seconds in the `Retry-After` header before trying again.",
        "- There is no MCP server.",
        "",
        f"## Personal API token endpoints ({len(personal)})",
        "",
        "### The token",
        "",
        "- The member makes one in UCT Settings, Personal API, while signed in on a paid plan.",
        f"  It is shown once, starts with `{lim['personal_prefix']}`, lasts {lim['personal_ttl_days']}"
        " days and can be revoked there.",
        f"  A member can hold up to {lim['personal_max_tokens']} live tokens.",
        "- Send it on every request: `Authorization: Bearer <token>`.",
        "- Bodies are JSON (`Content-Type: application/json`).",
        f"- When the server's Personal API switch (`{lim['personal_gate']}`) is off, every endpoint",
        "  below answers 404 `{\"detail\": \"Not Found\"}`.",
        "",
        "### Limits",
        "",
        f"- {lim['personal_rate']} per token. Past it: 429",
        "  `{\"detail\": \"Too many requests with this token. Wait a minute and try again.\"}`.",
        f"- A request body carries at most {lim['personal_max_kb']} KB of markdown (413 past it).",
        "- Every refusal is JSON `{\"detail\": \"<a sentence you can show the member>\"}`:",
        "  400 bad input, 401 token missing/expired/revoked, 403 token not allowed here,",
        "  404 note not found, 413 too large, 423 note locked, 429 rate limit,",
        "  503 database busy (with `Retry-After: 5`).",
        "",
    ]
    for door in personal:
        doc = PERSONAL_DOOR_DOCS.get((door["method"], door["path"])) or {}
        lines += [f"### {door['method']} `{door['path']}`", ""]
        lines.append(doc.get("summary", "(no description recorded)"))
        lines += ["", f"Scope: `{door['scope']}`.", ""]
        body = doc.get("body") or []
        if body:
            lines += ["| body field | type | meaning |", "|---|---|---|"]
            for name, kind, meaning in body:
                lines.append(f"| `{name}` | {kind} | {meaning} |")
            lines.append("")
        if doc.get("response"):
            lines += ["Response 200:", "", "```json", doc["response"], "```", ""]

    used = sorted({e["rate_limit_family"] for e in entries})
    lines += [
        f"## Member session reads ({len(entries)})",
        "",
        "### Limits",
        "",
        "- Every read below is in a rate-limit family with one limit per caller: per member when",
        "  signed in (all of a member's sessions share one budget), otherwise per client IP.",
        "- Past the limit the server answers 429 with `Retry-After`, `X-RateLimit-Limit`,",
        "  `X-RateLimit-Remaining`, `X-RateLimit-Reset` and the body",
        "  `{\"detail\": \"Too many requests. Retry after N seconds.\", \"family\": \"<family>\", \"retry_after\": N}`.",
        f"- Data exports (`/api/exports/...`) also allow {lim['export_burst']} per member and a daily",
        f"  cap per member (default {lim['export_daily_default']} files per Eastern-time day;",
        "  `GET /api/exports/quota` shows the member's own). An export answers a CSV or XLSX file,",
        "  chosen with `format=csv` or `format=xlsx`.",
        "",
        "| family | limit |",
        "|---|---|",
    ]
    for fam in used:
        lines.append(f"| {fam} | {rlp.FAMILIES[fam].limit} |")
    lines += [
        "",
        "Responses are JSON unless the path says export. Params: `{name}` is a path parameter,",
        "`name=value` is a query parameter and its default, `(required)` must be sent.",
        "",
        "| method | path | tier | family | params |",
        "|---|---|---|---|---|",
    ]
    for e in entries:
        params = e.get("params") or ""
        lines.append(f"| {e['method']} | `{e['path']}` | {e['tier']} | {e['rate_limit_family']} | {params} |")
    lines.append("")
    return "\n".join(lines)
