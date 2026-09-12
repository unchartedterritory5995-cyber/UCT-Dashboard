"""Read Railway's LITERAL watch patterns, and catch the in-repo mirror drifting.

`api/flow_worker_main.py`'s header is the only in-repo copy of flow-worker's watch
list, and `tools/flow_worker_watch_coverage.py` trusts it. Nothing has ever checked
it against the dashboard, which is the actual authority — so the rail could be
guarding a list that no longer exists. That is the "second authority over one
value" defect wearing a different hat: one authority (the dashboard) and one
unverified copy.

⛔ THREE EXIT CODES, THREE DIFFERENT FACTS. Collapsing them is the defect
`CoverageLine` exists to avoid:

    0  read the patterns, mirror agrees
    1  read the patterns, mirror DRIFTED  — fix the header
    2  INCONCLUSIVE — no token, or the API refused. NOT a pass.

⚰️ A drift check that silently exits 0 when it could not read anything is worse
than no check: it reports coverage it never performed. The token is usually absent
(local runs, CI), so code 2 is the COMMON path and must never be mistaken for
agreement.

## Token

Measured 2026-09-11: the Railway CLI honours both env vars below and they override
the interactive session token in `~/.railway/config.json` (that session token is
rejected by the public API — 403 on Bearer and Project-Access-Token, on both
`railway.app` and `railway.com`).

    RAILWAY_TOKEN      project token  (Project -> Settings -> Tokens)
                       header: Project-Access-Token      <- preferred, tightest grant
    RAILWAY_API_TOKEN  account token  (Account Settings -> Tokens)
                       header: Authorization: Bearer     <- fallback

Usage:
    python tools/railway_watch_patterns.py            # print every service's patterns
    python tools/railway_watch_patterns.py --check    # compare against the header
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://backboard.railway.com/graphql/v2"
PROJECT_ID = os.environ.get("RAILWAY_PROJECT_ID", "d6574d0b-7973-4ece-b35c-65c0ad4c453d")

_QUERY = """
query($id:String!){
  project(id:$id){
    name
    services{ edges{ node{ name
      serviceInstances{ edges{ node{ environmentId watchPatterns rootDirectory } } } } } }
  }
}
"""


def _auth_headers() -> list[dict]:
    out = []
    if os.environ.get("RAILWAY_TOKEN"):
        out.append({"Project-Access-Token": os.environ["RAILWAY_TOKEN"]})
    if os.environ.get("RAILWAY_API_TOKEN"):
        out.append({"Authorization": "Bearer " + os.environ["RAILWAY_API_TOKEN"]})
    return out


def fetch() -> tuple[dict | None, str]:
    """(payload, reason). payload is None when it could not be read — the reason
    is returned rather than raised so the caller can exit 2 with something a human
    can act on."""
    heads = _auth_headers()
    if not heads:
        return None, ("no token: set RAILWAY_TOKEN (project token) or "
                      "RAILWAY_API_TOKEN (account token)")
    last = ""
    for h in heads:
        try:
            req = urllib.request.Request(
                API, data=json.dumps({"query": _QUERY,
                                      "variables": {"id": PROJECT_ID}}).encode(),
                headers={"Content-Type": "application/json", **h})
            body = json.loads(urllib.request.urlopen(req, timeout=45).read().decode())
            if body.get("errors"):
                last = "GraphQL errors: %s" % body["errors"][:1]
                continue
            return body, ""
        except urllib.error.HTTPError as e:
            last = "HTTP %s via %s" % (e.code, list(h)[0])
        except Exception as e:                      # noqa: BLE001
            last = "%s via %s" % (type(e).__name__, list(h)[0])
    return None, last or "unknown failure"


def patterns_by_service(payload: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    proj = (payload.get("data") or {}).get("project") or {}
    for edge in ((proj.get("services") or {}).get("edges") or []):
        node = edge["node"]
        pats: list[str] = []
        for ie in ((node.get("serviceInstances") or {}).get("edges") or []):
            pats.extend(ie["node"].get("watchPatterns") or [])
        out[node["name"]] = pats
    return out


_MOD_RE = re.compile(r"api/([A-Za-z0-9_]+)\.py$")


def modules_in(patterns: list[str]) -> set[str]:
    """Module names named by explicit `api/<name>.py` patterns.

    ⛔ A GLOB IS NOT A MODULE LIST. `api/**` names no specific module, so it is
    reported separately rather than silently contributing nothing — otherwise a
    service whose list was replaced wholesale by `api/**` would read as "every
    module drifted away", which is the wrong alarm.
    """
    return {m.group(1) for p in patterns for m in [_MOD_RE.search(p.strip())] if m}


def has_broad_glob(patterns: list[str]) -> bool:
    return any(p.strip() in ("api/**", "api/*", "**") for p in patterns)


def drift(header_modules: set[str], patterns: list[str]) -> tuple[set[str], set[str]]:
    """(in_header_not_railway, in_railway_not_header). Pure — unit tested on
    synthetic input so it means something without a token."""
    real = modules_in(patterns)
    return header_modules - real, real - header_modules


def main(argv: list[str]) -> int:
    payload, reason = fetch()
    if payload is None:
        print("[watch-patterns] INCONCLUSIVE — could not read Railway: %s" % reason)
        print("[watch-patterns] this is NOT a pass; nothing was verified")
        return 2
    by_svc = patterns_by_service(payload)
    for name in sorted(by_svc):
        pats = by_svc[name]
        print("=== %s (%d pattern%s)" % (name, len(pats), "" if len(pats) == 1 else "s"))
        for p in pats:
            print("    " + p)
        if not pats:
            print("    <none — this service rebuilds on EVERY push>")
    if "--check" not in argv:
        return 0

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from tools import flow_worker_watch_coverage as wc
    root = wc.repo_root()
    header = wc.watched_modules(root)
    pats = by_svc.get("flow-worker", [])
    if has_broad_glob(pats):
        print("\n[watch-patterns] flow-worker carries a BROAD glob (%s)." % pats)
        print("[watch-patterns] the header's explicit list no longer describes it — "
              "re-scope the mirror and the coverage rail together.")
        return 1
    missing, extra = drift(header, pats)
    if not missing and not extra:
        print("\n[watch-patterns] OK — the header mirror matches Railway (%d modules)"
              % len(header))
        return 0
    print("\n[watch-patterns] DRIFT — api/flow_worker_main.py's header disagrees "
          "with the dashboard:")
    for m in sorted(missing):
        print("    in header, NOT on Railway: %s" % m)
    for m in sorted(extra):
        print("    on Railway, NOT in header: %s" % m)
    print("\n  The DASHBOARD is the authority. Fix the header, not Railway — unless "
          "you\n  meant to change the watch list, in which case remember a wider "
          "list means\n  more flow-worker restarts and every restart gaps the OPRA tape.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
