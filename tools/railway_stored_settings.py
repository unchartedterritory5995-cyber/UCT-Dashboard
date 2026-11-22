"""Railway's STORED settings must equal the config files, for every service still built from one.

WHY. Railway stops reading `railway.json` / `railway.toml` on 2026-12-01 (hard cutoff). From that
day a service runs on the settings Railway has stored for it (what its Settings page shows), and
Railway never copied a config file's values there. Measured 2026-11-14, three services were built
from a file and had stored settings that would have changed them on that day:

  web           `railway.web.json`   stored: generic builder, no health check, no watch paths
  worker        `railway.json`       stored: generic builder, a different build, health path and start command
  flow-worker   `railway.json`       stored: generic builder, NO start command (the next deploy
                                     would have started the wrong process; the options tape stops)

The other services already ran with no config file. The stored settings of these three were
written to match their files on 2026-11-14, with no deploy. This tool keeps it that way:

    python tools/railway_stored_settings.py                          # compare every service; exit 0 same / 1 different / 2 could not tell
    python tools/railway_stored_settings.py --service web            # compare only the named service(s)
    python tools/railway_stored_settings.py --apply --service web    # store what web's file says (does NOT deploy)
    python tools/railway_stored_settings.py --self-check

`--service` may be repeated. `--apply` REFUSES to run without at least one `--service`: a bare
`--apply` would write every service whose stored settings differ, and on 2026-11-19 that list held
two services (`stream-ingest`, `stream-edge`) whose file and stored builder disagreed with nobody
having decided which one was intended (settled the same day: their files now equal what Railway
stores, except watch paths). Naming the services makes the write's reach a decision, not a side effect. Comparing (no `--apply`) stays all-services by default: it writes nothing.

The config files stay in the repo as the declared settings: review a change there, merge it,
then run `--apply`. Until 2026-12-01 Railway also still reads them at deploy time. After it,
`--apply` is the only way a change in one of these files reaches Railway.

Needs a Railway CLI of version 5 or newer, signed in, run from a folder linked to the project
(`railway link`). The CLI on PATH may be older: point `RAILWAY_CLI` at a newer `railway.exe`.
This tool never reads a credential file and never prints a variable value. Runbook:
`docs/runbooks/railway-config-cutoff.md`.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: service -> the config file it is built from. A service that reads no file is not listed.
#: `tests/test_railway_stored_settings.py` requires every key in each of these files to be one
#: `to_update` knows how to store, so a new key cannot be merged and silently never reach Railway.
SERVICES = {
    "web": "railway.web.json",
    "worker": "railway.json",
    "flow-worker": "railway.json",
    # Created 2026-11-14 as a NEW service, which never reads a config file: its first
    # deploy ran the default start command. Its stored settings were typed in by hand.
    # The two stream files name no builder on purpose (owner decision 2026-11-19): Railway
    # stores RAILPACK for both yet builds them with Nixpacks; see the runbook.
    "stream-ingest": "railway.ingest.json",
    "stream-edge": "railway.edge.json",
    # Track 6 (2026-11-22): the private Pine runtime service, created as a NEW service (which never
    # reads a config file), so its file reaches Railway only through `--apply --service pine-runtime`.
    "pine-runtime": "services/pine_runtime/railway.json",
}

#: (section, key) in a config file -> field of Railway's `ServiceInstanceUpdateInput`.
STORED_FIELD = {
    ("build", "dockerfilePath"): "dockerfilePath",
    ("build", "buildCommand"): "buildCommand",
    ("build", "watchPatterns"): "watchPatterns",
    ("deploy", "startCommand"): "startCommand",
    ("deploy", "preDeployCommand"): "preDeployCommand",
    ("deploy", "healthcheckPath"): "healthcheckPath",
    ("deploy", "healthcheckTimeout"): "healthcheckTimeout",
    ("deploy", "restartPolicyType"): "restartPolicyType",
    ("deploy", "restartPolicyMaxRetries"): "restartPolicyMaxRetries",
    ("deploy", "drainingSeconds"): "drainingSeconds",
    ("deploy", "overlapSeconds"): "overlapSeconds",
}
#: Builders Railway's update call accepts by name. A Dockerfile build has no name there: a
#: stored `dockerfilePath` is what selects it.
NAMED_BUILDERS = ("NIXPACKS", "RAILPACK", "HEROKU", "PAKETO")

UPDATE = """mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}"""


class UnknownSetting(ValueError):
    """A config file sets something this tool cannot store."""


class Inconclusive(RuntimeError):
    """Railway could not be asked. Not a pass and not a difference."""


def selected(services=None) -> dict:
    """The `SERVICES` entries a run covers, in `SERVICES` order. None or empty = every service.
    Raises ValueError on a name `SERVICES` does not hold, so a typo is never "nothing differs"."""
    if not services:
        return dict(SERVICES)
    unknown = sorted(set(services) - set(SERVICES))
    if unknown:
        raise ValueError(f"no such service in SERVICES: {', '.join(unknown)} (known: {', '.join(SERVICES)})")
    return {name: SERVICES[name] for name in SERVICES if name in set(services)}


# ── pure: what a file means, and where stored settings differ ─────────────────

def _unset(value) -> bool:
    return value in (None, "", [], {})


def stored_replicas(deploy: dict):
    """Stored replica count: Railway keeps it per region."""
    regions = (deploy or {}).get("multiRegionConfig") or {}
    if regions:
        return sum(int((r or {}).get("numReplicas") or 0) for r in regions.values())
    return (deploy or {}).get("numReplicas")


def differences(config: dict, stored: dict) -> list[str]:
    """Every setting the config file supplies whose stored value is different. [] = the same."""
    out = []
    for section in ("build", "deploy"):
        mine = (stored or {}).get(section) or {}
        for key, want in (config.get(section) or {}).items():
            if (section, key) == ("deploy", "numReplicas"):
                have = stored_replicas(mine)
            else:
                have = mine.get(key)
            same = (sorted(want) == sorted(have or [])) if isinstance(want, list) else (
                (_unset(want) and _unset(have)) or want == have)
            if not same:
                out.append(f"{section}.{key}: the file says {json.dumps(want)[:160]}, Railway has stored "
                           f"{'nothing' if _unset(have) else json.dumps(have)[:160]}")
    return out


def to_update(config: dict) -> dict:
    """The stored-settings update that makes Railway match `config`. Raises UnknownSetting for a
    key this tool has no stored field for, so nothing is ever left behind quietly."""
    update, unknown = {}, []
    build, deploy = config.get("build") or {}, config.get("deploy") or {}
    for section, body in (("build", build), ("deploy", deploy)):
        for key, value in body.items():
            if (section, key) == ("build", "builder"):
                if value == "DOCKERFILE":
                    if not build.get("dockerfilePath"):
                        unknown.append("build.builder DOCKERFILE without build.dockerfilePath")
                elif value in NAMED_BUILDERS:
                    update["builder"] = value
                else:
                    unknown.append(f"build.builder {value!r}")
            elif (section, key) == ("deploy", "numReplicas"):
                continue                     # stored per region; compared by `differences`, never written here
            elif (section, key) in STORED_FIELD:
                update[STORED_FIELD[(section, key)]] = value
            else:
                unknown.append(f"{section}.{key}")
    stray = [k for k in config if k not in ("$schema", "build", "deploy")]
    unknown += [f"top-level {k!r}" for k in stray]
    if unknown:
        raise UnknownSetting("; ".join(unknown))
    return update


def load_config(name: str, root: str = ROOT) -> dict:
    with open(os.path.join(root, name), encoding="utf-8") as f:
        return json.load(f)


# ── Railway, through its own CLI ──────────────────────────────────────────────

def _cli() -> list[str]:
    path = (os.environ.get("RAILWAY_CLI") or "").strip()
    return [path] if path else ["railway"]


def _run(args: list[str], cwd: str | None = None) -> str:
    cmd = _cli() + args
    shell = len(_cli()[0].split(os.sep)) == 1 and os.name == "nt"      # a bare `railway` on Windows is a .cmd shim
    try:
        p = subprocess.run(" ".join(cmd) if shell else cmd, shell=shell, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", cwd=cwd, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Inconclusive(f"could not run the Railway CLI ({type(exc).__name__})") from exc
    if p.returncode != 0:
        tail = " ".join((p.stderr or p.stdout).split())[-300:]
        if "unrecognized subcommand" in tail or "isn't valid" in tail or "unexpected argument" in tail:
            raise Inconclusive("this Railway CLI is too old (version 5 or newer is needed): set RAILWAY_CLI "
                               "to a newer railway.exe")
        raise Inconclusive(f"the Railway CLI refused `{' '.join(args[:3])}`: {tail}")
    return p.stdout


def read_stored(cwd: str | None = None) -> dict:
    """service name -> {'build': {...}, 'deploy': {...}} as Railway has them stored. Variable values
    are never part of this output (`--variables unmanaged`, and no `--include-variables`)."""
    graph = json.loads(_run(["config", "pull", "--json", "--variables", "unmanaged"], cwd))
    return {r["name"]: {"build": r.get("build") or {}, "deploy": r.get("deploy") or {}}
            for r in graph.get("resources", []) if r.get("type") == "service"}


def service_ids(cwd: str | None = None) -> tuple[dict, str]:
    status = json.loads(_run(["status", "--json"], cwd))
    ids = {e["node"]["name"]: e["node"]["id"] for e in status["services"]["edges"]}
    envs = [e["node"] for e in status["environments"]["edges"]]
    production = [e for e in envs if e.get("name") == "production"] or envs
    return ids, production[0]["id"]


def store(service_id: str, environment_id: str, update: dict, cwd: str | None = None) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        doc, var = os.path.join(tmp, "update.graphql"), os.path.join(tmp, "vars.json")
        with open(doc, "w", encoding="utf-8") as f:
            f.write(UPDATE)
        with open(var, "w", encoding="utf-8") as f:
            json.dump({"serviceId": service_id, "environmentId": environment_id, "input": update}, f)
        answer = json.loads(_run(["api", "-f", doc, "--variables", "@" + var, "--compact"], cwd))
    if answer.get("errors") or not (answer.get("data") or {}).get("serviceInstanceUpdate"):
        raise Inconclusive(f"Railway did not accept the update: {json.dumps(answer)[:300]}")


# ── the commands ──────────────────────────────────────────────────────────────

def check(out=print, cwd: str | None = None, root: str = ROOT, services=None) -> int:
    try:
        chosen = selected(services)
    except ValueError as exc:
        out(f"REFUSED: {exc}")
        return 2
    try:
        stored = read_stored(cwd)
    except Inconclusive as exc:
        out(f"INCONCLUSIVE: {exc}")
        return 2
    total = 0
    for service, name in chosen.items():
        if service not in stored:
            out(f"INCONCLUSIVE: Railway reports no service named {service}")
            return 2
        found = differences(load_config(name, root), stored[service])
        total += len(found)
        out(f"{'same     ' if not found else 'DIFFERENT'} {service:12} {name}")
        for line in found:
            out(f"    {line}")
    scope = "" if len(chosen) == len(SERVICES) else f" (only {', '.join(chosen)})"
    out(f"RESULT: Railway's stored settings equal the config files{scope}" if not total else
        f"RESULT: {total} stored setting(s) differ from the config files{scope}. `--apply --service <name>` "
        "stores what that service's file says (it does not deploy); or correct the file.")
    return 1 if total else 0


def apply(out=print, cwd: str | None = None, root: str = ROOT, services=None) -> int:
    """Store what the named services' files say. Refuses with no service named: see the module
    docstring. Nothing is read from or written to Railway before that refusal."""
    if not services:
        out("REFUSED: --apply needs at least one --service, so a write never reaches a service nobody named. "
            f"Services: {', '.join(SERVICES)}. Example: --apply --service web")
        return 2
    try:
        chosen = selected(services)
    except ValueError as exc:
        out(f"REFUSED: {exc}")
        return 2
    try:
        stored = read_stored(cwd)
        ids, environment = service_ids(cwd)
        for service, name in chosen.items():
            config = load_config(name, root)
            if not differences(config, stored.get(service) or {}):
                out(f"same      {service:12} nothing to store")
                continue
            update = to_update(config)
            store(ids[service], environment, update, cwd)
            out(f"stored    {service:12} {', '.join(sorted(update))}   ({time.strftime('%H:%M:%SZ', time.gmtime())})")
    except UnknownSetting as exc:
        out(f"REFUSED: a config file sets something this tool cannot store: {exc}")
        return 2
    except Inconclusive as exc:
        out(f"INCONCLUSIVE: {exc}")
        return 2
    out("stored settings do not deploy anything: a service picks them up at its next deployment.")
    return check(out, cwd, root, services=list(chosen))


def self_check(out=print) -> int:
    """Prove the comparison can answer both ways, with no Railway."""
    config = {"build": {"builder": "DOCKERFILE", "dockerfilePath": "Dockerfile.web", "watchPatterns": ["api/**", "app/**"]},
              "deploy": {"numReplicas": 1, "healthcheckPath": "/api/health", "healthcheckTimeout": 600}}
    same = {"build": {"builder": "DOCKERFILE", "dockerfilePath": "Dockerfile.web", "watchPatterns": ["app/**", "api/**"]},
            "deploy": {"multiRegionConfig": {"us-east4": {"numReplicas": 1}}, "healthcheckPath": "/api/health",
                       "healthcheckTimeout": 600, "runtime": "V2"}}
    cases = [("identical settings -> no difference", differences(config, same) == [])]
    for label, section, key, value in (("a different builder", "build", "builder", "RAILPACK"),
                                       ("no health check stored", "deploy", "healthcheckPath", None),
                                       ("one watch path missing", "build", "watchPatterns", ["api/**"]),
                                       ("two copies stored where the file says one", "deploy", "multiRegionConfig",
                                        {"us-east4": {"numReplicas": 2}})):
        broken = json.loads(json.dumps(same))
        broken[section][key] = value
        cases.append((f"{label} -> reported", len(differences(config, broken)) == 1))
    cases.append(("a Dockerfile build is stored as its path, not as a builder name",
                  to_update(config) == {"dockerfilePath": "Dockerfile.web", "watchPatterns": ["api/**", "app/**"],
                                        "healthcheckPath": "/api/health", "healthcheckTimeout": 600}))
    try:
        to_update({"deploy": {"somethingNew": 1}})
        cases.append(("a key with no stored field -> refused", False))
    except UnknownSetting:
        cases.append(("a key with no stored field -> refused", True))
    ok = all(passed for _, passed in cases)
    for label, passed in cases:
        out(f"  {'ok  ' if passed else 'FAIL'} {label}")
    out("self-check passed" if ok else "self-check FAILED")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--apply", action="store_true",
                   help="store what the named services' files say (does not deploy); needs --service")
    p.add_argument("--service", action="append", choices=list(SERVICES), metavar="NAME",
                   help=f"limit to this service; repeatable. One of: {', '.join(SERVICES)}. "
                        "Required with --apply; without it a compare covers every service")
    p.add_argument("--self-check", action="store_true", help="prove the comparison can report both answers")
    args = p.parse_args(argv)
    if args.self_check:
        return self_check()
    return apply(services=args.service) if args.apply else check(services=args.service)


if __name__ == "__main__":
    sys.exit(main())
