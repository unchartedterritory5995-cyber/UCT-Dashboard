#!/usr/bin/env python
"""Weekly Railway-config regression audit — liveflow deploy-survival guard.

Purpose (spec: docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md
SS P0 + SS6): watchPatterns silently reverting, or railway.json losing the
exec / --timeout-graceful-shutdown / drainingSeconds trio, would silently re-open
the fixed production data-loss bug (Massive OPRA feed gaps on every deploy).
This audit catches that drift weekly.

Checks (all READ-ONLY — GraphQL queries + local git reads only):
  1. Worker serviceInstance watchPatterns == the 6 root-anchored api/build patterns.
  2. Web serviceInstance watchPatterns == [] (deliberate — web must deploy on every commit).
  3. Env placement: web MASSIVE_WS_ENABLED=1 + MASSIVE_WS_DRY_RUN=0; worker
     MASSIVE_WS_ENABLED=0 + LIVEFLOW_MONITOR_ENABLED=1; NEITHER service carries
     RAILWAY_DEPLOYMENT_DRAINING_SECONDS / RAILWAY_DEPLOYMENT_OVERLAP_SECONDS as an
     env var (drain lives in railway.json only).
  4. origin/master railway.json: startCommand keeps `exec python -m api.worker_main`,
     `exec uvicorn`, `--timeout-graceful-shutdown 5`; deploy.drainingSeconds == 30;
     NO watchPatterns key anywhere in the file (dashboard-only setting).

On drift: ONE Discord message (env DISCORD_WEBHOOK_URL, else parsed from the repo
.env) listing each failed assertion. On all-pass: PASS lines to stdout, no post.
Exit codes: 0 pass / 1 drift / 2 script-error (script-error posts a
"monitor blind" Discord note so a broken auditor is never silent).

Auth gotchas (learned 2026-07-06):
  * The Railway CLI accessToken in ~/.railway/config.json expires ~daily. The CLI
    auto-refreshes it on any command, so on "Not Authorized" we shell out to
    `railway whoami` (cwd = the linked repo), re-read the token, and retry once.
  * backboard.railway.app 403s the default python User-Agent — the
    `railway-cli/4.5.0` UA header is mandatory.

Runs on the local Windows PC via Task Scheduler (weekly, Monday 8:00 AM).
Stdlib only. `--dry-run` runs every check + prints results but never posts.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------- constants

REPO = "C:/Users/Patrick/uct-dashboard"
RAILWAY_CONFIG = "C:/Users/Patrick/.railway/config.json"
GQL_URL = "https://backboard.railway.app/graphql/v2"

ENV_ID = "4c2149a7-d7bd-4bf9-9a4c-a879a5800067"  # production
PROJECT_ID_FALLBACK = "d6574d0b-7973-4ece-b35c-65c0ad4c453d"  # luminous-recreation

# service key -> (Railway serviceId, CLI service name)
SERVICES = {
    "worker": ("33f6c2a4-42f6-4e09-8e31-72096d6138d1", "worker"),
    "web": ("f57fc2b1-0dbc-44e6-9514-84f55a94fc37", "web"),
}

EXPECTED_WORKER_WATCH = [
    "/api/**",
    "/requirements.txt",
    "/railway.json",
    "/nixpacks.toml",
    "/Procfile",
    "/runtime.txt",
]

DRIFT_PREFIX = "⚠️ RAILWAY CONFIG DRIFT (liveflow deploy-survival guard)"
BLIND_PREFIX = (
    "⚠️ RAILWAY CONFIG AUDIT — SCRIPT ERROR "
    "(monitor blind — liveflow deploy-survival guard NOT verified this week)"
)

GIT_TIMEOUT = 120
HTTP_TIMEOUT = 30
CLI_TIMEOUT = 90


class AuditScriptError(Exception):
    """Environment/tooling failure — the audit could not verify (exit 2)."""


class GqlQueryError(Exception):
    """The GraphQL server answered but rejected this query shape."""


# ---------------------------------------------------------------- railway auth


def _load_railway_config() -> dict:
    try:
        with open(RAILWAY_CONFIG, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        raise AuditScriptError(f"cannot read {RAILWAY_CONFIG}: {exc}") from exc


def _read_token() -> str:
    tok = (_load_railway_config().get("user") or {}).get("accessToken")
    if not tok:
        raise AuditScriptError(f"no user.accessToken in {RAILWAY_CONFIG}")
    return tok


def _project_id() -> str:
    """projectId from the config's projects entry for the uct-dashboard repo."""
    projects = _load_railway_config().get("projects") or {}
    for path, entry in projects.items():
        norm = str(path).replace("\\", "/").rstrip("/").lower()
        if norm.endswith("/uct-dashboard"):
            pid = (entry or {}).get("project")
            if pid:
                return pid
    return PROJECT_ID_FALLBACK


def _refresh_token_via_cli() -> bool:
    """`railway whoami` refreshes the expired accessToken in config.json."""
    try:
        res = subprocess.run(
            "railway whoami",
            shell=True,
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT,
        )
        return res.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


_TOKEN: dict = {"value": None}


def gql(query: str, variables: dict) -> dict:
    """POST a GraphQL query; on Not Authorized, CLI-refresh the token and retry once."""
    last_err = "unknown"
    for attempt in (1, 2):
        if _TOKEN["value"] is None:
            _TOKEN["value"] = _read_token()
        body = json.dumps({"query": query, "variables": variables}).encode()
        req = urllib.request.Request(
            GQL_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {_TOKEN['value']}",
                "Content-Type": "application/json",
                # mandatory: default python UA gets 403 from backboard
                "User-Agent": "railway-cli/4.5.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                out = json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403) and attempt == 1:
                last_err = f"HTTP {exc.code}"
                _TOKEN["value"] = None
                _refresh_token_via_cli()
                continue
            raise AuditScriptError(f"Railway GraphQL HTTP {exc.code}") from exc
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise AuditScriptError(f"Railway GraphQL unreachable: {exc}") from exc

        errors = out.get("errors") or []
        if errors:
            msgs = "; ".join(str(e.get("message", "")) for e in errors)
            if "Not Authorized" in msgs and attempt == 1:
                last_err = msgs
                _TOKEN["value"] = None  # expired token — refresh via CLI, retry
                _refresh_token_via_cli()
                continue
            raise GqlQueryError(msgs)
        return out.get("data") or {}
    raise AuditScriptError(f"Railway GraphQL Not Authorized after CLI token refresh ({last_err})")


# ---------------------------------------------------------------- data fetchers


def fetch_watch_patterns(service_id: str) -> list:
    data = gql(
        """
        query si($serviceId: String!, $environmentId: String!) {
          serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
            watchPatterns
          }
        }
        """,
        {"serviceId": service_id, "environmentId": ENV_ID},
    )
    inst = data.get("serviceInstance")
    if inst is None or not isinstance(inst.get("watchPatterns"), list):
        raise AuditScriptError(f"serviceInstance query returned no watchPatterns for {service_id}")
    return inst["watchPatterns"]


def _variables_via_cli(cli_name: str) -> dict:
    res = subprocess.run(
        f"railway variables --service {cli_name} --kv",
        shell=True,
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT,
    )
    if res.returncode != 0:
        raise AuditScriptError(
            f"railway variables --service {cli_name} failed: {(res.stderr or res.stdout).strip()[:300]}"
        )
    out = {}
    for line in (res.stdout or "").splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    if not out:
        raise AuditScriptError(f"railway variables --service {cli_name} returned no variables")
    return out


def fetch_variables(service_key: str) -> dict:
    """Env vars for a service: GraphQL variables query, CLI fallback on shape failure."""
    service_id, cli_name = SERVICES[service_key]
    try:
        data = gql(
            """
            query v($projectId: String!, $environmentId: String!, $serviceId: String!) {
              variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
            }
            """,
            {"projectId": _project_id(), "environmentId": ENV_ID, "serviceId": service_id},
        )
        variables = data.get("variables")
        if isinstance(variables, dict) and variables:
            # a few worker keys carry stray whitespace (e.g. 'PYTHONUNBUFFERED\n')
            return {str(k).strip(): v for k, v in variables.items()}
        raise GqlQueryError("variables query returned empty/non-dict")
    except GqlQueryError as exc:
        print(f"  [info] variables query shape failed for {service_key} ({exc}); "
              f"falling back to railway CLI")
        return _variables_via_cli(cli_name)


def fetch_master_railway_json() -> dict:
    fetch = subprocess.run(
        ["git", "-C", REPO, "fetch", "origin", "master"],
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT,
    )
    if fetch.returncode != 0:
        # offline fetch is non-fatal — origin/master from the last fetch still audits
        print(f"  [warn] git fetch origin master failed (auditing last-fetched "
              f"origin/master): {(fetch.stderr or '').strip()[:200]}")
    show = subprocess.run(
        ["git", "-C", REPO, "show", "origin/master:railway.json"],
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT,
    )
    if show.returncode != 0:
        raise AuditScriptError(
            f"git show origin/master:railway.json failed: {(show.stderr or '').strip()[:300]}"
        )
    try:
        return json.loads(show.stdout)
    except ValueError as exc:
        raise AuditScriptError(f"origin/master railway.json is not valid JSON: {exc}") from exc


def _find_key_paths(obj, key: str, path: str = "") -> list:
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            child = f"{path}.{k}" if path else str(k)
            if k == key:
                hits.append(child)
            hits.extend(_find_key_paths(v, key, child))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(_find_key_paths(v, key, f"{path}[{i}]"))
    return hits


# ---------------------------------------------------------------- checks


class Auditor:
    def __init__(self):
        self.passes: list[str] = []
        self.failures: list[str] = []

    def check(self, ok: bool, desc: str, got) -> None:
        if ok:
            self.passes.append(f"PASS  {desc}")
        else:
            self.failures.append(f"- EXPECTED {desc} GOT {got!r}")

    def run(self) -> None:
        # 1+2 — watchPatterns per service (dashboard-set; NEVER in railway.json)
        worker_watch = fetch_watch_patterns(SERVICES["worker"][0])
        self.check(
            worker_watch == EXPECTED_WORKER_WATCH,
            f"worker watchPatterns == {EXPECTED_WORKER_WATCH}",
            worker_watch,
        )
        web_watch = fetch_watch_patterns(SERVICES["web"][0])
        self.check(
            web_watch == [],
            "web watchPatterns == [] (deliberate — web deploys on every commit)",
            web_watch,
        )

        # 3 — env-var placement
        web_vars = fetch_variables("web")
        worker_vars = fetch_variables("worker")
        self.check(
            web_vars.get("MASSIVE_WS_ENABLED") == "1",
            "web env MASSIVE_WS_ENABLED == '1'",
            web_vars.get("MASSIVE_WS_ENABLED"),
        )
        self.check(
            web_vars.get("MASSIVE_WS_DRY_RUN") == "0",
            "web env MASSIVE_WS_DRY_RUN == '0'",
            web_vars.get("MASSIVE_WS_DRY_RUN"),
        )
        self.check(
            worker_vars.get("MASSIVE_WS_ENABLED") == "0",
            "worker env MASSIVE_WS_ENABLED == '0'",
            worker_vars.get("MASSIVE_WS_ENABLED"),
        )
        self.check(
            worker_vars.get("LIVEFLOW_MONITOR_ENABLED") == "1",
            "worker env LIVEFLOW_MONITOR_ENABLED == '1'",
            worker_vars.get("LIVEFLOW_MONITOR_ENABLED"),
        )
        for var in ("RAILWAY_DEPLOYMENT_DRAINING_SECONDS", "RAILWAY_DEPLOYMENT_OVERLAP_SECONDS"):
            for name, env in (("web", web_vars), ("worker", worker_vars)):
                self.check(
                    var not in env,
                    f"{name} env has NO {var} (drain lives in railway.json only)",
                    f"set to {env.get(var)!r}" if var in env else None,
                )

        # 4 — config-as-code on origin/master
        rj = fetch_master_railway_json()
        deploy = rj.get("deploy") or {}
        start = deploy.get("startCommand") or ""
        for frag in ("exec python -m api.worker_main", "exec uvicorn", "--timeout-graceful-shutdown 5"):
            self.check(
                frag in start,
                f"railway.json deploy.startCommand contains '{frag}'",
                start[:220] or "<missing>",
            )
        self.check(
            deploy.get("drainingSeconds") == 30,
            "railway.json deploy.drainingSeconds == 30",
            deploy.get("drainingSeconds"),
        )
        wp_paths = _find_key_paths(rj, "watchPatterns")
        self.check(
            not wp_paths,
            "railway.json has NO watchPatterns key anywhere "
            "(file is shared web+worker; patterns live in the dashboard per-service)",
            wp_paths,
        )


# ---------------------------------------------------------------- discord


def _webhook_url() -> str | None:
    url = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if url:
        return url
    env_path = os.path.join(REPO, ".env")
    try:
        with open(env_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == "DISCORD_WEBHOOK_URL":
                    return v.strip().strip("'\"") or None
    except OSError:
        pass
    return None


def post_discord(content: str) -> bool:
    url = _webhook_url()
    if not url:
        print("  [warn] no DISCORD_WEBHOOK_URL (env or repo .env) — cannot post alert")
        return False
    if len(content) > 1990:  # Discord 2000-char message cap
        content = content[:1960] + "\n... (truncated)"
    req = urllib.request.Request(
        url,
        data=json.dumps({"content": content}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "uct-railway-config-audit/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError) as exc:
        print(f"  [warn] Discord post failed: {exc}")
        return False


# ---------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description="Weekly Railway config regression audit "
                                                 "(liveflow deploy-survival guard)")
    parser.add_argument("--dry-run", action="store_true",
                        help="run all checks and print results; never post to Discord")
    args = parser.parse_args()

    try:  # Windows console defaults to cp1252 — keep unicode output safe
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    print("railway_config_audit: weekly liveflow deploy-survival guard"
          + (" [DRY RUN]" if args.dry_run else ""))

    auditor = Auditor()
    try:
        auditor.run()
    except AuditScriptError as exc:
        print(f"SCRIPT ERROR: {exc}")
        if not args.dry_run:
            post_discord(f"{BLIND_PREFIX}\n- {exc}")
        return 2
    except Exception as exc:  # unexpected — still exit 2 + monitor-blind note
        print(f"SCRIPT ERROR (unexpected): {type(exc).__name__}: {exc}")
        if not args.dry_run:
            post_discord(f"{BLIND_PREFIX}\n- {type(exc).__name__}: {exc}")
        return 2

    for line in auditor.passes:
        print(line)
    if auditor.failures:
        print(f"\nDRIFT DETECTED — {len(auditor.failures)} failed assertion(s):")
        for line in auditor.failures:
            print(line)
        if not args.dry_run:
            post_discord(DRIFT_PREFIX + "\n" + "\n".join(auditor.failures))
        else:
            print("(dry-run: Discord post suppressed)")
        return 1

    print(f"\nALL CHECKS PASS ({len(auditor.passes)}/{len(auditor.passes)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
