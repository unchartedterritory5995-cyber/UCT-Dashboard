"""Is everything we built actually live? One plain answer, from the systems themselves.

The owner's ask (2026-11-14): "I always want to have confidence ... that the app and website are both
running the most up to date version of our product." This tool answers that from the systems that
know, never from memory or from a summary:

  * master -> production : is every commit on master promoted? if not, why (checks running, a hold,
                           checks failed) and for how long?
  * each Railway service : what is it RUNNING (its active deployment), what branch feeds it, and do
                           the newer commits on that branch touch the files that redeploy it? a
                           newest deploy that FAILED while an older one keeps serving is "stuck".
  * what members get     : the commit the site itself reports (/api/health, /build.json) and the
                           bundle the home page actually serves (a cached old page shows here).
  * desktop app          : newest release, its rollout share, app changes not yet released.
  * not live by choice   : features built and switched off (docs/feature_flags.json), open PRs,
                           recent branches with no PR.
  * the nightly tests    : the newest VALID master record the full suite published on `ci-results`
                           is under 36 h old, and the NEW failures it found (only NEW, never the
                           baseline it already carried). 2026-11-18: the nightly was dead two nights
                           running and nothing said so.

Each row is one of:
  LIVE        running the newest thing that matters for it
  ON THE WAY  newer code is moving through the normal pipeline (checks, a timed hold, a deploy)
  HAND        updated only by a hand deploy, by design (worker, flow-worker); lists what waits
  STUCK       newer code should be live by now and is not; says why
  CAN'T CHECK a source did not answer. NEVER read as live (an absence is only evidence if the
              instrument could have seen a presence)
  NOTE        information, never an alarm

Exit: 0 nothing stuck and every check answered · 1 something STUCK · 2 something could not be checked.

    python tools/live_check.py                    # report (fetches origin first)
    python tools/live_check.py --json             # machine-readable rows
    python tools/live_check.py --wait 900         # re-check each minute while a deploy is on the way
    python tools/live_check.py --post             # post to Discord when the alert rule says so
    python tools/live_check.py --post --morning   # always post (the daily summary)
    python tools/live_check.py --self-check       # proves every verdict can fire

Railway access, first that exists: RAILWAY_TOKEN (project token) · RAILWAY_API_TOKEN (account token) ·
the Railway CLI's own login (~/.railway/config.json). Without one, the Railway rows are CAN'T CHECK.
GitHub access is the `gh` CLI (GH_TOKEN in Actions). Discord: LIVE_CHECK_DISCORD_WEBHOOK, else
DISCORD_OPS_WEBHOOK_URL. Nothing here writes to Railway, GitHub code, or the site.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request


def _this_repo(fallback: str) -> str:
    """owner/name of this repository: $GITHUB_REPOSITORY in Actions, else this checkout's origin remote.

    Derived, never hardcoded, so moving the repository to another owner needs no edit here. `fallback`
    is used only when neither answers (no git, no origin)."""
    env = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if env:
        return env
    try:
        url = subprocess.run(["git", "-C", str(pathlib.Path(__file__).resolve().parent), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        url = ""
    m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else fallback


ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = _this_repo("unchartedterritory5995-cyber/UCT-Dashboard")
SITE = os.environ.get("LIVE_CHECK_SITE", "https://uctintelligence.com")
RAILWAY_GQL = "https://backboard.railway.com/graphql/v2"
RAILWAY_PROJECT = os.environ.get("RAILWAY_PROJECT_ID", "d6574d0b-7973-4ece-b35c-65c0ad4c453d")
RAILWAY_ENV = os.environ.get("RAILWAY_ENVIRONMENT_ID", "4c2149a7-d7bd-4bf9-9a4c-a879a5800067")
DESKTOP_REPO = "unchartedterritory5995-cyber/uct-desktop"
DESKTOP_RELEASES = "unchartedterritory5995-cyber/uct-desktop-releases"
#: Shell paths whose change needs a new app release (everything else in that repo is proofs and docs).
DESKTOP_APP_PATHS = ("src", "package.json", "electron-builder.yml", "build")
GATE_WORKFLOW = "master-deploy-gate.yml"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

LIVE, ON_THE_WAY, HAND, STUCK, UNKNOWN, NOTE = "LIVE", "ON THE WAY", "HAND", "STUCK", "CAN'T CHECK", "NOTE"
_ORDER = {STUCK: 0, UNKNOWN: 1, ON_THE_WAY: 2, HAND: 3, LIVE: 4, NOTE: 5}

#: master -> production: minutes OUTSIDE every deploy hold before an unpromoted commit is stuck. The
#: gate takes ~20-25 min and the promotion + web deploy ~5-10, so 60 unheld minutes is two full cycles.
PROMOTE_STUCK_MIN = 60
#: A service whose branch moved and that has not even STARTED a deploy after this long is stuck.
DEPLOY_START_STUCK_MIN = 20
#: While stuck, the same alert is repeated at most this often.
REPEAT_ALERT_H = 6
#: The nightly full suite is STUCK when its newest VALID master record is older than this. It is meant to
#: publish one a day; GitHub delivered its cron 7-10 h late on 11-12..11-17, so a day plus that slack.
NIGHTLY_STALE_H = 36
#: How many of the newest records on ci-results are read looking for a valid master one (each is one blob).
NIGHTLY_LOOKBACK = 40
#: At most this many NEW failure ids are named in an alert; the record names them all.
NIGHTLY_NEW_SHOWN = 8
IN_PROGRESS = {"BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"}
FAILED = {"FAILED", "CRASHED"}


# --------------------------------------------------------------------------------------------- rows

def row(area, name, state, says, detail="", key=None, since=None):
    return {"area": area, "name": name, "state": state, "says": says, "detail": detail,
            "key": key or f"{area}:{name}", "since": since}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_ts(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except ValueError:
        return None


def ago(t, now) -> str:
    if t is None:
        return "unknown time"
    m = int((now - t).total_seconds() // 60)
    if m < 1:
        return "just now"
    if m < 120:
        return f"{m} min ago"
    if m < 48 * 60:
        return f"{m // 60} h ago"
    return f"{m // 1440} days ago"


def short(sha) -> str:
    return (sha or "?")[:10]


# ------------------------------------------------------------------------------------ glob matching

def _glob_to_re(pat: str) -> re.Pattern:
    """Railway watch patterns are gitignore-style globs from the repo root."""
    p = pat.lstrip("/")
    out, i = [], 0
    while i < len(p):
        c = p[i]
        if p.startswith("**/", i):
            out.append("(?:.*/)?"); i += 3
        elif p.startswith("**", i):
            out.append(".*"); i += 2
        elif c == "*":
            out.append("[^/]*"); i += 1
        elif c == "?":
            out.append("[^/]"); i += 1
        else:
            out.append(re.escape(c)); i += 1
    body = "".join(out)
    # a bare directory or file name matches itself and everything under it, as gitignore does
    return re.compile("^" + body + ("(?:/.*)?$" if not p.endswith("*") else "$"))


def touches(files, patterns) -> list:
    """Files that would redeploy a service. No patterns = every file redeploys it (Railway's rule)."""
    if not patterns:
        return list(files)
    pos = [_glob_to_re(p) for p in patterns if not p.startswith("!")]
    neg = [_glob_to_re(p[1:]) for p in patterns if p.startswith("!")]
    return [f for f in files if any(r.match(f) for r in pos) and not any(r.match(f) for r in neg)]


# ------------------------------------------------------------------------------------------ sources

class SourceError(Exception):
    pass


def git(*args, check=True) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode != 0:
        raise SourceError(f"git {' '.join(args[:3])}: {r.stderr.strip()[:200]}")
    return r.stdout.strip()


def is_ancestor(a, b) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=ROOT,
                          capture_output=True).returncode == 0


def has_commit(sha) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=ROOT,
                          capture_output=True).returncode == 0


def gh_api(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SourceError(f"gh api {path.split('?')[0]}: {r.stderr.strip()[:200]}")
    return json.loads(r.stdout or "null")


def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def railway_token():
    if os.environ.get("RAILWAY_TOKEN"):
        return {"Project-Access-Token": os.environ["RAILWAY_TOKEN"]}, "RAILWAY_TOKEN"
    if os.environ.get("RAILWAY_API_TOKEN"):
        return {"Authorization": "Bearer " + os.environ["RAILWAY_API_TOKEN"]}, "RAILWAY_API_TOKEN"
    cfg = pathlib.Path.home() / ".railway" / "config.json"
    try:
        user = json.loads(cfg.read_text(encoding="utf-8-sig")).get("user") or {}
        # newer CLIs log in with OAuth and leave `token` empty, keeping the live one in `accessToken`
        tok = user.get("token") or user.get("accessToken")
    except (OSError, ValueError):
        tok = None
    if tok:
        return {"Authorization": "Bearer " + tok}, "Railway CLI login"
    return None, None


def railway_gql(query, variables, headers):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(RAILWAY_GQL, data=body, headers={
        **headers, "Content-Type": "application/json", "User-Agent": "uct-live-check"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        out = json.load(resp)
    if out.get("errors"):
        raise SourceError("railway: " + "; ".join(e.get("message", "?") for e in out["errors"])[:200])
    return out["data"]


_Q_INSTANCES = """query($env:String!){ environment(id:$env){ serviceInstances{ edges{ node{
  serviceName serviceId source{ repo }
  latestDeployment{ status createdAt meta }
  activeDeployments{ status createdAt meta } } } } } }"""
_Q_TRIGGERS = """query($pid:String!){ project(id:$pid){ services{ edges{ node{ name id
  repoTriggers{ edges{ node{ branch environmentId } } } } } } } }"""
_Q_VARS = """query($pid:String!,$env:String!,$svc:String!){
  variables(projectId:$pid, environmentId:$env, serviceId:$svc) }"""


def _deploy(d):
    if not d:
        return None
    m = d.get("meta") or {}
    wp = ((m.get("serviceManifest") or {}).get("build") or {}).get("watchPatterns")
    return {"status": d.get("status"), "at": d.get("createdAt"), "commit": m.get("commitHash"),
            "branch": m.get("branch"), "repo": m.get("repo"), "watch": wp}


def collect_railway(headers):
    inst = railway_gql(_Q_INSTANCES, {"env": RAILWAY_ENV}, headers)
    trig = railway_gql(_Q_TRIGGERS, {"pid": RAILWAY_PROJECT}, headers)
    branches = {}
    for e in trig["project"]["services"]["edges"]:
        n = e["node"]
        branches[n["id"]] = [t["node"]["branch"] for t in n["repoTriggers"]["edges"]
                             if t["node"]["environmentId"] == RAILWAY_ENV]
    services = []
    for e in inst["environment"]["serviceInstances"]["edges"]:
        n = e["node"]
        active = [_deploy(a) for a in (n.get("activeDeployments") or [])]
        serving = next((a for a in active if a["status"] == "SUCCESS"), None)
        latest = _deploy(n.get("latestDeployment"))
        services.append({
            "name": n["serviceName"], "id": n["serviceId"],
            "repo": (n.get("source") or {}).get("repo"),
            "branches": branches.get(n["serviceId"], []),
            "serving": serving, "latest": latest,
            "in_progress": [a for a in active if a["status"] in IN_PROGRESS]
                           + ([latest] if latest and latest["status"] in IN_PROGRESS
                              and latest not in active else []),
            "watch": (latest or {}).get("watch") or (serving or {}).get("watch") or [],
        })
    return sorted(services, key=lambda s: s["name"])


def landed_at(branch, sha, events):
    """When `sha` first became reachable from `branch`, from GitHub's push history (oldest first)."""
    for ev in sorted(events.get(branch, []), key=lambda e: e["timestamp"]):
        after = ev.get("after")
        if after and (after == sha or (has_commit(after) and is_ancestor(sha, after))):
            return _parse_ts(ev["timestamp"])
    try:
        return _parse_ts(git("show", "-s", "--format=%cI", sha))
    except SourceError:
        return None


def collect(*, fetch=True, flag_values=False) -> dict:
    """Every fact the verdicts need. A source that fails is recorded as an error, never as empty."""
    f = {"errors": {}, "now": _now().isoformat()}

    def attempt(name, fn):
        try:
            return fn()
        except (SourceError, OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as e:
            f["errors"][name] = f"{type(e).__name__}: {e}"[:300]
            return None

    headers, f["railway_auth"] = railway_token()
    if headers:
        f["services"] = attempt("railway", lambda: collect_railway(headers))
    else:
        f["services"] = None
        f["errors"]["railway"] = "no Railway access (set RAILWAY_TOKEN)"

    branches = {"master", "production"}
    for s in f["services"] or []:
        if s["repo"] and s["repo"].lower() == REPO.lower():
            branches.update(s["branches"])
    if fetch:
        attempt("git fetch", lambda: git("fetch", "--quiet", "origin",
                                         *[f"+refs/heads/{b}:refs/remotes/origin/{b}" for b in sorted(branches)]))
    f["tips"] = {}
    for b in sorted(branches):
        sha = git("rev-parse", "--verify", "--quiet", f"origin/{b}", check=False)
        if sha:
            f["tips"][b] = sha
    f["pending"] = attempt("git", lambda: [
        {"sha": s.split(" ", 1)[0], "subject": s.split(" ", 1)[1] if " " in s else ""}
        for s in git("log", "--first-parent", "--format=%H %s", "origin/production..origin/master").splitlines() if s])

    f["events"] = {}
    for b in sorted(branches):
        ev = attempt(f"github activity {b}",
                     lambda b=b: gh_api(f"repos/{REPO}/activity?ref=refs/heads/{b}&per_page=100"))
        f["events"][b] = ev or []
    f["gate_runs"] = attempt("github gate runs", lambda: [
        {"sha": r["head_sha"], "status": r["status"], "conclusion": r["conclusion"],
         "created": r["created_at"], "url": r["html_url"]}
        for r in gh_api(f"repos/{REPO}/actions/workflows/{GATE_WORKFLOW}/runs?branch=master&per_page=30")["workflow_runs"]])
    f["pending_record"] = None
    try:
        raw = gh_api(f"repos/{REPO}/contents/pending-promotion.json?ref=deploy-gate-state")
        import base64
        f["pending_record"] = json.loads(base64.b64decode(raw["content"]).decode())
    except SourceError:
        pass  # absent file = nothing pending; that is the normal state

    def site():
        health = json.loads(http_get(f"{SITE}/api/health"))
        build = json.loads(http_get(f"{SITE}/build.json?lc={int(time.time())}"))
        html = http_get(f"{SITE}/")
        m = re.search(r'src="/?(assets/index-[^"]+\.js)"', html)
        return {"api_commit": health.get("commit"), "api_build_id": health.get("build_id"),
                "uptime_s": health.get("uptime_seconds"), "front_commit": build.get("commit"),
                "front_build_id": build.get("build_id"), "home_bundle": m.group(1) if m else None}
    f["site"] = attempt("site", site)

    def desktop():
        rel = gh_api(f"repos/{DESKTOP_RELEASES}/releases/latest")
        yml = next((a for a in rel.get("assets", []) if a["name"] == "latest.yml"), None)
        stage = None
        if yml:
            m = re.search(r"stagingPercentage:\s*(\d+)", http_get(yml["browser_download_url"]))
            stage = int(m.group(1)) if m else 100
        pkg = gh_api(f"repos/{DESKTOP_REPO}/contents/package.json")
        import base64
        version = json.loads(base64.b64decode(pkg["content"]).decode()).get("version")
        since = rel.get("published_at")
        changes = {}
        for p in DESKTOP_APP_PATHS:
            for c in gh_api(f"repos/{DESKTOP_REPO}/commits?path={p}&since={since}&per_page=50") or []:
                if _parse_ts(c["commit"]["committer"]["date"]) > _parse_ts(since):
                    changes[c["sha"]] = c["commit"]["message"].splitlines()[0]
        return {"release": rel.get("tag_name"), "published": since, "stage": stage,
                "main_version": version, "unreleased": [{"sha": k, "subject": v} for k, v in changes.items()]}
    f["desktop"] = attempt("desktop", desktop)

    def flags():
        led = json.loads((ROOT / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
        return [{"name": k, "status": v.get("status"), "since": v.get("since"), "where": v.get("where") or [],
                 "note": (v.get("note") or "")} for k, v in led["flags"].items()
                if v.get("status") in ("dark", "pending")]
    f["flags"] = attempt("feature ledger", flags)
    if flag_values and headers and f["services"] and f["flags"]:
        def values():
            wanted = {x["name"] for x in f["flags"]}
            out = {}
            for s in f["services"]:
                if not any(s["name"] in x["where"] for x in f["flags"]):
                    continue
                allv = railway_gql(_Q_VARS, {"pid": RAILWAY_PROJECT, "env": RAILWAY_ENV, "svc": s["id"]},
                                   headers)["variables"] or {}
                # ⛔ only ledger flag names leave this function; every other variable is dropped here
                out[s["name"]] = {k: allv[k] for k in wanted if k in allv}
                del allv
            return out
        f["flag_values"] = attempt("flag values", values)

    def prs():
        open_prs = gh_api(f"repos/{REPO}/pulls?state=open&base=master&per_page=100")
        recent = gh_api(f"repos/{REPO}/pulls?state=all&per_page=100&sort=updated&direction=desc")
        heads = {p["head"]["ref"] for p in recent} | {p["head"]["ref"] for p in open_prs}
        cutoff = (_now() - dt.timedelta(days=7)).isoformat()
        branches_out = []
        for line in git("for-each-ref", "--no-merged=origin/master", "--sort=-committerdate",
                        "--format=%(committerdate:iso-strict) %(refname:short)", "refs/remotes/origin").splitlines():
            when, ref = line.split(" ", 1)
            if _parse_ts(when) and _parse_ts(when).isoformat() < cutoff:
                break
            name = ref.removeprefix("origin/")
            if name in heads or name in ("HEAD", "deploy-gate-state", "ci-results", "production"):
                continue
            branches_out.append({"branch": name, "at": when})
        return {"open": [{"n": p["number"], "title": p["title"], "draft": p["draft"], "at": p["created_at"]}
                         for p in open_prs], "no_pr": branches_out}
    f["work"] = attempt("open work", prs)
    f["nightly"] = attempt("nightly record", lambda: nightly_facts(fetch=fetch))
    return f


def _ci_inventory():
    """tools/ci_inventory.py, the ONE authority on what a VALID record is (never restated here)."""
    spec = importlib.util.spec_from_file_location("ci_inventory_for_live_check", ROOT / "tools" / "ci_inventory.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def nightly_facts(*, fetch=True, ref="origin/ci-results") -> dict:
    """The newest master record and the newest VALID master record on ci-results, newest run id first."""
    if fetch:
        git("fetch", "--quiet", "origin", "+refs/heads/ci-results:refs/remotes/origin/ci-results")
    names = git("ls-tree", "--name-only", f"{ref}:results").split()
    ids = sorted((n for n in names if n.isdigit()), key=int, reverse=True)[:NIGHTLY_LOOKBACK]
    if not ids:
        raise SourceError(f"{ref} holds no results/<run_id> records")
    valid = _ci_inventory().record_is_valid
    out = {"newest_master": None, "newest_valid": None, "read": 0}
    for rid in ids:
        s = json.loads(git("show", f"{ref}:results/{rid}/summary.json"))
        out["read"] += 1
        if (s.get("branch") or "") != "master":
            continue
        rec = {"run": rid, "finished": s.get("finished"), "sha": s.get("sha"), "verdict": s.get("verdict")}
        if out["newest_master"] is None:
            out["newest_master"] = rec
        if valid(s):
            try:
                d = json.loads(git("show", f"{ref}:results/{rid}/diff.json"))
                rec.update(diff_verdict=d.get("verdict"), new=list(d.get("new") or []))
            except (SourceError, ValueError):
                rec.update(diff_verdict=None, new=None)   # no diff in the record: NEW is unknowable
            out["newest_valid"] = rec
            break
    return out


# ----------------------------------------------------------------------------------------- verdicts

def _freeze_fn():
    """deploy_freeze.freeze_ends_at, with its window module loaded once (it reloads per call otherwise)."""
    spec = importlib.util.spec_from_file_location("_lc_freeze", ROOT / "tools" / "deploy_freeze.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mw = mod._window_module()
    return lambda t: mod.freeze_ends_at(t, in_window_fn=mw.in_window)


def unheld_minutes(start, now, freeze_ends_at, step_min=5) -> int:
    """Minutes between start and now that fell outside every deploy hold (rush, Wednesday window)."""
    if start is None:
        return 0
    start = max(start, now - dt.timedelta(days=3))
    total, t = 0, start
    while t < now:
        if freeze_ends_at(t) is None:
            total += step_min
        t += dt.timedelta(minutes=step_min)
    return total


def eval_promotion(f, now, freeze_ends_at, landed):
    pending = f.get("pending")
    if pending is None:
        return row("pipeline", "master -> production", UNKNOWN, "could not compare master and production",
                   f["errors"].get("git", ""))
    if not pending:
        return row("pipeline", "master -> production", LIVE, "every master commit is promoted to production")
    oldest = pending[-1]
    arrived = landed("master", oldest["sha"])
    n = len(pending)
    what = f"{n} master commit{'s' if n != 1 else ''} not promoted yet (oldest landed {ago(arrived, now)})"
    detail = "; ".join(f"{short(p['sha'])} {p['subject'][:70]}" for p in pending[:5])
    pend_shas = {p["sha"] for p in pending}
    runs = [r for r in (f.get("gate_runs") or []) if r["sha"] in pend_shas]
    # the NEWEST non-cancelled run decides: a later green (or a later run still going) supersedes an older red
    done = sorted([r for r in runs if r["conclusion"] != "cancelled"], key=lambda r: r["created"], reverse=True)
    if done and done[0]["status"] == "completed" and done[0]["conclusion"] not in ("success", "skipped"):
        return row("pipeline", "master -> production", STUCK,
                   f"{what}: the deploy checks FAILED on {short(done[0]['sha'])}, so nothing new goes live "
                   f"until a fix lands on master", done[0]["url"] + " · " + detail, since=arrived and arrived.isoformat())
    hold_end = freeze_ends_at(now)
    if hold_end:
        local = hold_end.astimezone(_et()).strftime("%H:%M ET")
        return row("pipeline", "master -> production", ON_THE_WAY,
                   f"{what}: held by a deploy window until {local}, then promoted automatically", detail)
    if unheld_minutes(arrived, now, freeze_ends_at) >= PROMOTE_STUCK_MIN:
        running = [r for r in runs if r["status"] != "completed"]
        why = "checks are still running" if running else "no promotion happened"
        return row("pipeline", "master -> production", STUCK,
                   f"{what}: more than {PROMOTE_STUCK_MIN} min outside any hold and {why}", detail,
                   since=arrived and arrived.isoformat())
    if f.get("gate_runs") is None:
        return row("pipeline", "master -> production", UNKNOWN, f"{what}; could not read the deploy checks",
                   f["errors"].get("github gate runs", ""))
    running = [r for r in runs if r["status"] != "completed"]
    how = "deploy checks are running" if running else "waiting for the deploy checks to start"
    return row("pipeline", "master -> production", ON_THE_WAY, f"{what}: {how}, promotion is automatic", detail)


def _et():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


def eval_service(s, f, now, landed, diff_files):
    name, latest, serving = s["name"], s["latest"], s["serving"]
    if not s["repo"] or s["repo"].lower() != REPO.lower():
        return row("service", name, NOTE, "not built from this repo, not checked here")
    running = (serving or {}).get("commit")
    building = s["in_progress"]
    trig = [b for b in s["branches"] if b in f["tips"]]
    if not s["branches"]:
        # hand-deployed by design: compare with master, the branch hand deploys are cut from
        tip = f["tips"].get("master")
        if not running:
            at = _parse_ts((serving or {}).get("at"))
            n = git("rev-list", "--count", f"--since={(serving or {}).get('at')}", "origin/master", check=False) if at else "?"
            return row("service", name, HAND,
                       f"updated only by hand; last one was an upload {ago(at, now)}, so its exact commit is unknown "
                       f"(about {n} master commits since)", key=f"service:{name}")
        files = diff_files(running, tip)
        hits = touches(files, s["watch"]) if files is not None else None
        if hits is None:
            return row("service", name, UNKNOWN, f"running {short(running)}, which this checkout cannot compare")
        if not hits:
            return row("service", name, LIVE, f"updated only by hand; running {short(running)}, nothing newer touches it")
        return row("service", name, HAND,
                   f"updated only by hand; {len(hits)} changed file{'s' if len(hits) != 1 else ''} on master "
                   f"wait for its next hand deploy (running {short(running)})", ", ".join(hits[:6]))
    if not trig:
        return row("service", name, UNKNOWN, f"its branch {s['branches']} could not be fetched")
    branch = trig[0]
    tip = f["tips"][branch]
    if building:
        b = building[0]
        return row("service", name, ON_THE_WAY,
                   f"deploying {short(b.get('commit'))} from {branch} (started {ago(_parse_ts(b.get('at')), now)})")
    if not running:
        return row("service", name, STUCK if latest and latest["status"] in FAILED else UNKNOWN,
                   f"no successful deployment is serving (newest: {(latest or {}).get('status')})")
    if running == tip:
        return row("service", name, LIVE, f"running the tip of {branch} ({short(tip)})")
    files = diff_files(running, tip)
    if files is None:
        return row("service", name, UNKNOWN, f"running {short(running)}, which this checkout cannot compare to {branch}")
    if not is_ancestor(running, tip):
        return row("service", name, STUCK,
                   f"running {short(running)}, which is NOT on {branch}: a rollback or a hand deploy of other code")
    hits = touches(files, s["watch"])
    failed = latest and latest["status"] in FAILED and latest.get("commit") != running
    if failed and not hits:
        # serving everything it needs; the failed attempt changed none of its files. Not stuck, but said, because
        # the cause is unknown here (2026-11-01's was Railway failing to fetch the repo, not our code).
        return row("service", name, LIVE,
                   f"running {short(running)}, nothing of its is missing; its newest deploy attempt FAILED "
                   f"{ago(_parse_ts(latest.get('at')), now)} (read that deploy's build log before its next change)")
    if failed:
        since = _parse_ts(latest.get("at"))
        return row("service", name, STUCK,
                   f"its newest deploy FAILED {ago(since, now)}; still running older {short(running)}"
                   + (f" and missing {len(hits)} changed file{'s' if len(hits) != 1 else ''}" if hits else ""),
                   ", ".join(hits[:6]), since=since and since.isoformat())
    if not hits:
        return row("service", name, LIVE,
                   f"running {short(running)}; newer {branch} commits do not touch its files")
    moved = landed(branch, tip)
    mins = (now - moved).total_seconds() / 60 if moved else 1e9
    if mins < DEPLOY_START_STUCK_MIN:
        return row("service", name, ON_THE_WAY, f"{branch} moved {ago(moved, now)}; Railway has not started the deploy yet")
    return row("service", name, STUCK,
               f"{len(hits)} changed file{'s' if len(hits) != 1 else ''} on {branch} not deployed; the branch moved "
               f"{ago(moved, now)} and Railway started no deploy", ", ".join(hits[:6]),
               since=moved and moved.isoformat())


def eval_site(f, now, services):
    site = f.get("site")
    if site is None:
        return [row("members", "website", UNKNOWN, "the live site did not answer", f["errors"].get("site", ""))]
    out = []
    by = {s["name"]: s for s in services or []}

    def check(label, reported, svc):
        s = by.get(svc)
        if s is None:
            return row("members", label, UNKNOWN if services is None else NOTE,
                       f"site reports {short(reported)}; Railway not readable to confirm it")
        want = (s["serving"] or {}).get("commit")
        if reported and want and reported == want:
            return row("members", label, LIVE, f"members get {short(reported)}, the same build Railway is serving")
        if s["in_progress"]:
            return row("members", label, ON_THE_WAY, f"site reports {short(reported)} while {svc} deploys")
        return row("members", label, STUCK, f"site reports {short(reported)} but Railway's {svc} is serving {short(want)}")

    out.append(check("server (/api/health)", site["api_commit"], "web"))
    out.append(check("pages (/build.json)", site["front_commit"], "web-front"))
    if site["home_bundle"] and site["front_build_id"]:
        if site["home_bundle"] == site["front_build_id"]:
            out.append(row("members", "home page bundle", LIVE, f"the home page loads the current bundle ({site['home_bundle']})"))
        else:
            front = by.get("web-front")
            moving = front and front["in_progress"]
            out.append(row("members", "home page bundle", ON_THE_WAY if moving else STUCK,
                           f"the home page loads {site['home_bundle']} but the current build is {site['front_build_id']}"
                           " (a cached old page)"))
    else:
        out.append(row("members", "home page bundle", UNKNOWN, "could not read the home page's bundle"))
    return out


def eval_desktop(f, now):
    d = f.get("desktop")
    if d is None:
        return [row("app", "desktop app", UNKNOWN, "could not read the desktop releases", f["errors"].get("desktop", ""))]
    out = [row("app", "website inside the app", NOTE, "the app loads the live site, so website rows above apply to it")]
    stage = d["stage"]
    if stage is not None and stage < 100:
        out.append(row("app", "newest release", ON_THE_WAY,
                       f"{d['release']} is offered to {stage}% of installs (staged rollout)", key="app:stage"))
    else:
        out.append(row("app", "newest release", LIVE,
                       f"{d['release']} is offered to every install (published {ago(_parse_ts(d['published']), now)})"))
    n = len(d["unreleased"])
    if n or (d["main_version"] and d["release"] and d["main_version"].lstrip("v") != d["release"].lstrip("v")):
        out.append(row("app", "app changes", HAND,
                       f"{n} app change{'s' if n != 1 else ''} since {d['release']} wait for the next release "
                       f"(main is at {d['main_version']})",
                       "; ".join(f"{short(c['sha'])} {c['subject'][:60]}" for c in d["unreleased"][:5])))
    else:
        out.append(row("app", "app changes", LIVE, f"no app change since {d['release']}"))
    return out


def eval_flags(f):
    fl = f.get("flags")
    if fl is None:
        return [row("off", "switched-off features", UNKNOWN, "could not read docs/feature_flags.json")]
    dark = sorted([x for x in fl if x["status"] == "dark"], key=lambda x: x["since"] or "", reverse=True)
    pend = [x for x in fl if x["status"] == "pending"]
    vals = f.get("flag_values")
    out = [row("off", "switched-off features", NOTE,
               f"{len(dark)} built features are switched off on purpose and {len(pend)} await a decision",
               "newest: " + ", ".join(f"{x['name']} ({x['since']})" for x in dark[:8]))]
    if vals is not None:
        on = []
        for x in dark:
            for svc in x["where"]:
                v = (vals.get(svc) or {}).get(x["name"])
                if v not in (None, "", "0", "false", "False", "off"):
                    on.append(f"{x['name']} on {svc}")
        if on:
            out.append(row("off", "ledger out of date", NOTE,
                           f"{len(on)} switch{'es' if len(on) != 1 else ''} the ledger calls off are ON in Railway",
                           ", ".join(on[:10])))
    return out


def eval_work(f, now):
    w = f.get("work")
    if w is None:
        return [row("work", "unmerged work", UNKNOWN, "could not list open PRs", f["errors"].get("open work", ""))]
    ready = [p for p in w["open"] if not p["draft"]]
    oldest = sorted(ready, key=lambda p: p["at"])
    out = [row("work", "open PRs into master", NOTE,
               f"{len(ready)} open (plus {len(w['open']) - len(ready)} drafts); none of these are live",
               "; ".join(f"#{p['n']} {p['title'][:50]} ({ago(_parse_ts(p['at']), now)})" for p in oldest[:6]))]
    if w["no_pr"]:
        out.append(row("work", "branches with no PR (7 days)", NOTE,
                       f"{len(w['no_pr'])} recent branches have commits and no PR, so they will never deploy as-is",
                       ", ".join(b["branch"] for b in w["no_pr"][:10])))
    return out


def eval_nightly(f, now):
    """The nightly full suite: is it alive (a VALID master record < NIGHTLY_STALE_H old), and what is NEW in it.

    ⛔ The `says` text carries no ages: the alert memory compares it, and an "N h ago" would re-post every hour."""
    name = "nightly full suite"
    n = f.get("nightly")
    if n is None:
        return [row("tests", name, UNKNOWN, "could not read the ci-results record store",
                    f["errors"].get("nightly record", ""))]
    m, v = n.get("newest_master"), n.get("newest_valid")
    if not v:
        return [row("tests", name, STUCK,
                    f"no VALID master record among the newest {n.get('read')} on ci-results",
                    f"newest master record: run {m['run']} ({m.get('verdict')})" if m else "no master record at all")]
    at = _parse_ts(v.get("finished"))
    out = []
    if at is None or now - at > dt.timedelta(hours=NIGHTLY_STALE_H):
        detail = f"newest valid: run {v['run']} on {short(v.get('sha'))}, finished {ago(at, now)}"
        if m and m["run"] != v["run"]:
            detail += f"; a newer master record (run {m['run']}) is INVALID ({m.get('verdict')})"
        out.append(row("tests", name, STUCK,
                       f"no VALID master run for over {NIGHTLY_STALE_H} h (newest valid is run {v['run']})", detail,
                       since=at and at.isoformat()))
    else:
        out.append(row("tests", name, LIVE, f"newest valid master run {v['run']}", f"finished {ago(at, now)}"))
    new = v.get("new")
    if new is None:
        out.append(row("tests", "nightly NEW failures", UNKNOWN, f"run {v['run']} published no diff",
                       "the record has no diff.json, so what is NEW cannot be read"))
    elif new:
        out.append(row("tests", "nightly NEW failures", STUCK,
                       f"run {v['run']} found {len(new)} NEW failure{'s' if len(new) != 1 else ''} "
                       f"against the previous valid master run",
                       "; ".join(str(k) for k in new[:NIGHTLY_NEW_SHOWN])
                       + (f"; and {len(new) - NIGHTLY_NEW_SHOWN} more" if len(new) > NIGHTLY_NEW_SHOWN else "")))
    else:
        out.append(row("tests", "nightly NEW failures", LIVE, f"run {v['run']} found no NEW failures"))
    return out


def evaluate(f, *, now=None, freeze_ends_at=None, landed=None, diff_files=None) -> list:
    now = now or _parse_ts(f["now"])
    freeze_ends_at = freeze_ends_at or _freeze_fn()
    landed = landed or (lambda b, sha: landed_at(b, sha, f["events"]))

    def _diff(a, b):
        if not (a and b and has_commit(a) and has_commit(b)):
            return None
        return [x for x in git("diff", "--name-only", a, b).splitlines() if x]
    diff_files = diff_files or _diff

    rows = [eval_promotion(f, now, freeze_ends_at, landed)]
    if f.get("services") is None:
        rows.append(row("service", "Railway services", UNKNOWN, "could not read Railway",
                        f["errors"].get("railway", "")))
    else:
        rows += [eval_service(s, f, now, landed, diff_files) for s in f["services"]]
    rows += eval_site(f, now, f.get("services"))
    rows += eval_desktop(f, now)
    rows += eval_flags(f)
    rows += eval_work(f, now)
    rows += eval_nightly(f, now)
    return rows


def exit_code(rows) -> int:
    if any(r["state"] == STUCK for r in rows):
        return 1
    if any(r["state"] == UNKNOWN for r in rows):
        return 2
    return 0


# ------------------------------------------------------------------------------------------- output

def headline(rows) -> str:
    stuck = [r for r in rows if r["state"] == STUCK]
    unknown = [r for r in rows if r["state"] == UNKNOWN]
    moving = [r for r in rows if r["state"] == ON_THE_WAY]
    if stuck:
        return f"NOT ALL LIVE: {len(stuck)} stuck" + (f", {len(unknown)} could not be checked" if unknown else "")
    if unknown:
        return f"PROBABLY LIVE, NOT PROVEN: {len(unknown)} check{'s' if len(unknown) != 1 else ''} could not run"
    if moving:
        return f"ALL LIVE except {len(moving)} thing{'s' if len(moving) != 1 else ''} on the way through the normal pipeline"
    return "ALL LIVE: everything that has reached master is running for members"


def render(rows, now, auth=None) -> str:
    stamp = now.astimezone(_et()).strftime("%a %b %d %H:%M ET")
    lines = [f"UCT live check, {stamp}", headline(rows), ""]
    titles = {"pipeline": "Pipeline", "service": "Railway services", "members": "What members get",
              "app": "Desktop app", "off": "Built but not on", "work": "Built but not merged",
              "tests": "Nightly tests"}
    for area in titles:
        group = sorted([r for r in rows if r["area"] == area], key=lambda r: (_ORDER[r["state"]], r["name"]))
        if not group:
            continue
        lines.append(titles[area])
        for r in group:
            lines.append(f"  [{r['state']}] {r['name']}: {r['says']}")
            if r["detail"] and r["state"] in (STUCK, UNKNOWN, ON_THE_WAY, HAND, NOTE):
                lines.append(f"      {r['detail'][:300]}")
        lines.append("")
    if auth:
        lines.append(f"(Railway read with: {auth})")
    return "\n".join(lines).encode("ascii", "replace").decode("ascii")


# ------------------------------------------------------------------------------------------ alerting

def fingerprint(rows) -> str:
    return "|".join(sorted(f"{r['key']}={r['says']}" for r in rows if r["state"] == STUCK))


def should_post(rows, prev, now, *, morning=False):
    """(post?, reason). prev = {"fingerprint": str, "posted_at": iso} from the last run, or {}."""
    fp = fingerprint(rows)
    if morning:
        return True, "morning summary"
    last = _parse_ts((prev or {}).get("posted_at"))
    had = (prev or {}).get("fingerprint", "")
    if fp and fp != had:
        return True, "new stuck item"
    if fp and (last is None or now - last >= dt.timedelta(hours=REPEAT_ALERT_H)):
        return True, f"still stuck after {REPEAT_ALERT_H} h"
    if had and not fp:
        return True, "recovered"
    return False, "nothing new to say"


#: The check itself broke (as opposed to a report of 1 stuck / 2 can't check). The workflow fails on > 2.
EXIT_BROKEN = 3


def discord_text(rows, now, link=None) -> str:
    """Discord's cut of the report: what needs attention in full, what is fine as one count per area.

    The full report overflowed Discord's 2,000 characters on its first post (2026-11-15) and lost the desktop
    and built-but-not-on sections; the full text stays in the run summary, linked here."""
    stamp = now.astimezone(_et()).strftime("%a %b %d %H:%M ET")
    lines = [f"UCT live check, {stamp}", headline(rows), ""]
    titles = {"pipeline": "Pipeline", "service": "Railway services", "members": "What members get",
              "app": "Desktop app", "off": "Built but not on", "work": "Built but not merged",
              "tests": "Nightly tests"}
    for area, title in titles.items():
        group = [r for r in rows if r["area"] == area]
        if not group:
            continue
        attention = sorted([r for r in group if r["state"] not in (LIVE, NOTE)], key=lambda r: _ORDER[r["state"]])
        live = [r for r in group if r["state"] == LIVE]
        notes = [r for r in group if r["state"] == NOTE and area in ("off", "work")]
        lines.append(f"{title}: {len(live)} live" if live else title)
        for r in attention:
            lines.append(f"  [{r['state']}] {r['name']}: {r['says'][:220]}")
        for r in notes:
            lines.append(f"  {r['says'][:160]}")
    if link:
        lines += ["", f"Full report: {link}"]
    out = "\n".join(lines).encode("ascii", "replace").decode("ascii")
    return out if len(out) <= 1900 else out[:1870] + "\n... (cut; see the full report)"


def webhook_url():
    hook = os.environ.get("LIVE_CHECK_DISCORD_WEBHOOK") or os.environ.get("DISCORD_OPS_WEBHOOK_URL") or ""
    # a value pasted through a Windows clipboard pipe can carry a BOM or a trailing newline
    hook = hook.strip().lstrip("﻿").strip()
    return hook or None


def post_discord(text) -> None:
    hook = webhook_url()
    if not hook:
        raise SourceError("no Discord webhook (LIVE_CHECK_DISCORD_WEBHOOK)")
    if not hook.startswith("https://"):
        # never print the value: it is a credential
        raise SourceError(f"LIVE_CHECK_DISCORD_WEBHOOK is not an https URL ({len(hook)} characters)")
    req = urllib.request.Request(hook, data=json.dumps({"content": "```\n" + text + "\n```"}).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "uct-live-check"})
    urllib.request.urlopen(req, timeout=20).read()


def load_state(path):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(path, state) -> None:
    p = pathlib.Path(path)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, p)


# ---------------------------------------------------------------------------------------- self-check

def _fixture(**over):
    base = {
        "now": "2026-11-16T20:00:00+00:00", "errors": {}, "railway_auth": "fixture",
        "tips": {"master": "m2", "production": "p1"},
        "pending": [], "events": {}, "gate_runs": [], "pending_record": None,
        "services": [
            {"name": "web", "id": "w", "repo": REPO, "branches": ["production"], "watch": ["api/**"],
             "serving": {"status": "SUCCESS", "commit": "p1", "at": "2026-11-16T19:00:00Z"},
             "latest": {"status": "SUCCESS", "commit": "p1", "at": "2026-11-16T19:00:00Z"}, "in_progress": []},
            {"name": "web-front", "id": "f", "repo": REPO, "branches": ["production"], "watch": ["app/**"],
             "serving": {"status": "SUCCESS", "commit": "p1", "at": "2026-11-16T19:00:00Z"},
             "latest": {"status": "SUCCESS", "commit": "p1", "at": "2026-11-16T19:00:00Z"}, "in_progress": []},
        ],
        "site": {"api_commit": "p1", "front_commit": "p1", "front_build_id": "assets/index-a.js",
                 "home_bundle": "assets/index-a.js", "api_build_id": "assets/index-a.js", "uptime_s": 1},
        "desktop": {"release": "v0.1.11", "published": "2026-11-12T00:00:00Z", "stage": None,
                    "main_version": "0.1.11", "unreleased": []},
        "flags": [], "work": {"open": [], "no_pr": []},
        "nightly": {"read": 3,
                    "newest_master": {"run": "9", "finished": "2026-11-16T08:00:00+00:00", "sha": "m1",
                                      "verdict": "RED"},
                    "newest_valid": {"run": "9", "finished": "2026-11-16T08:00:00+00:00", "sha": "m1",
                                     "verdict": "RED", "diff_verdict": "NO_NEW_FAILURES", "new": []}},
    }
    base.update(over)
    return base


def self_check() -> int:
    now = _parse_ts("2026-11-16T20:00:00+00:00")  # a Monday, 15:00 ET: no hold
    never = lambda t: None  # noqa: E731
    always = lambda t: now + dt.timedelta(minutes=30)  # noqa: E731
    long_ago = lambda b, sha: now - dt.timedelta(hours=3)  # noqa: E731
    recent = lambda b, sha: now - dt.timedelta(minutes=5)  # noqa: E731
    no_diff = lambda a, b: []  # noqa: E731

    def run(f, freeze=never, landed=long_ago, diff=no_diff):
        return evaluate(f, now=now, freeze_ends_at=freeze, landed=landed, diff_files=diff)

    def state(rows, name):
        return next(r["state"] for r in rows if r["name"] == name)

    fails = []

    def expect(label, got, want):
        ok = got == want
        print(f"  {'ok ' if ok else 'BAD'} {label}: {got}" + ("" if ok else f" (expected {want})"))
        if not ok:
            fails.append(label)

    print("live_check self-check")
    expect("all live is green", exit_code(run(_fixture())), 0)
    pend = [{"sha": "m2", "subject": "x"}]
    expect("unpromoted 3h, no hold -> STUCK", state(run(_fixture(pending=pend)), "master -> production"), STUCK)
    expect("unpromoted 5 min -> ON THE WAY", state(run(_fixture(pending=pend), landed=recent), "master -> production"), ON_THE_WAY)
    expect("unpromoted inside a hold -> ON THE WAY", state(run(_fixture(pending=pend), freeze=always), "master -> production"), ON_THE_WAY)
    failed_gate = [{"sha": "m2", "status": "completed", "conclusion": "failure", "created": "2026-11-16T19:58:00Z", "url": "u"}]
    expect("failed checks -> STUCK even when recent",
           state(run(_fixture(pending=pend, gate_runs=failed_gate), landed=recent), "master -> production"), STUCK)
    sup = failed_gate + [{"sha": "m2", "status": "completed", "conclusion": "success", "created": "2026-11-16T19:59:00Z", "url": "u"}]
    expect("a later green run supersedes a red one",
           state(run(_fixture(pending=pend, gate_runs=sup), landed=recent), "master -> production"), ON_THE_WAY)
    expect("git unreadable -> CAN'T CHECK, never live", state(run(_fixture(pending=None)), "master -> production"), UNKNOWN)

    svc = _fixture()["services"]
    behind = json.loads(json.dumps(svc))
    behind[0]["serving"]["commit"] = "p0"
    behind[0]["latest"]["commit"] = "p0"
    f_b = _fixture(services=behind)
    global is_ancestor
    real_anc = is_ancestor
    is_ancestor = lambda a, b: True  # noqa: E731
    try:
        expect("service behind, its files changed, no deploy for 3h -> STUCK",
               state(run(f_b, diff=lambda a, b: ["api/main.py"]), "web"), STUCK)
        expect("service behind but no file of its changed -> LIVE",
               state(run(f_b, diff=lambda a, b: ["app/x.js"]), "web"), LIVE)
        expect("branch moved 5 min ago -> ON THE WAY",
               state(run(f_b, landed=recent, diff=lambda a, b: ["api/main.py"]), "web"), ON_THE_WAY)
        fl = json.loads(json.dumps(behind))
        fl[0]["latest"] = {"status": "FAILED", "commit": "p1", "at": "2026-11-16T19:30:00Z"}
        expect("newest deploy FAILED, older still serving -> STUCK",
               state(run(_fixture(services=fl), diff=lambda a, b: ["api/main.py"]), "web"), STUCK)
        expect("newest deploy FAILED but none of its files changed -> LIVE (with a warning)",
               state(run(_fixture(services=fl), diff=lambda a, b: ["app/x.js"]), "web"), LIVE)
        bl = json.loads(json.dumps(behind))
        bl[0]["in_progress"] = [{"status": "BUILDING", "commit": "p1", "at": "2026-11-16T19:58:00Z"}]
        expect("a deploy building -> ON THE WAY",
               state(run(_fixture(services=bl), diff=lambda a, b: ["api/main.py"]), "web"), ON_THE_WAY)
        is_ancestor = lambda a, b: False  # noqa: E731
        expect("running a commit not on its branch -> STUCK",
               state(run(f_b, diff=lambda a, b: ["api/main.py"]), "web"), STUCK)
    finally:
        is_ancestor = real_anc

    hand = json.loads(json.dumps(svc[:1]))
    hand[0].update(name="worker", branches=[], watch=[])
    hand[0]["serving"]["commit"] = None
    expect("hand-deployed upload -> HAND, never STUCK", state(run(_fixture(services=hand)), "worker"), HAND)

    expect("site reports a different commit than Railway -> STUCK",
           state(run(_fixture(site={**_fixture()["site"], "api_commit": "zz"})), "server (/api/health)"), STUCK)
    expect("home page serves an old bundle -> STUCK",
           state(run(_fixture(site={**_fixture()["site"], "home_bundle": "assets/index-old.js"})), "home page bundle"), STUCK)
    expect("site down -> CAN'T CHECK", state(run(_fixture(site=None, errors={"site": "x"})), "website"), UNKNOWN)
    expect("no Railway -> CAN'T CHECK, exit 2", exit_code(run(_fixture(services=None, errors={"railway": "x"}))), 2)
    expect("staged desktop rollout -> ON THE WAY",
           state(run(_fixture(desktop={**_fixture()["desktop"], "stage": 10})), "newest release"), ON_THE_WAY)
    expect("unreleased app change -> HAND",
           state(run(_fixture(desktop={**_fixture()["desktop"], "unreleased": [{"sha": "a", "subject": "s"}]})), "app changes"), HAND)

    expect("glob api/** matches api/a/b.py", bool(touches(["api/a/b.py"], ["api/**"])), True)
    expect("glob api/** does not match app/x", bool(touches(["app/x"], ["api/**"])), False)
    expect("glob requirements*.txt", bool(touches(["requirements-dev.txt"], ["requirements*.txt"])), True)
    expect("bare dir name matches beneath it", bool(touches(["front/a/b.css"], ["front"])), True)
    expect("no patterns = every file", bool(touches(["x"], [])), True)

    night = _fixture()["nightly"]
    old = {**night, "newest_valid": {**night["newest_valid"], "finished": "2026-11-15T07:00:00+00:00"}}
    expect("nightly valid 12 h ago -> LIVE", state(run(_fixture()), "nightly full suite"), LIVE)
    expect("nightly valid 37 h ago -> STUCK", state(run(_fixture(nightly=old)), "nightly full suite"), STUCK)
    edge = {**night, "newest_valid": {**night["newest_valid"], "finished": "2026-11-15T09:00:00+00:00"}}
    expect("  ...35 h ago is still LIVE (the line is 36 h)", state(run(_fixture(nightly=edge)), "nightly full suite"),
           LIVE)
    dead = {"read": 40, "newest_master": {"run": "12", "finished": "2026-11-16T19:00:00+00:00", "verdict": "INVALID"},
            "newest_valid": None}
    expect("no valid master record at all -> STUCK", state(run(_fixture(nightly=dead)), "nightly full suite"), STUCK)
    expect("ci-results unreadable -> CAN'T CHECK", state(run(_fixture(nightly=None, errors={"nightly record": "x"})),
                                                         "nightly full suite"), UNKNOWN)
    reds = {**night, "newest_valid": {**night["newest_valid"], "diff_verdict": "NEW_FAILURES",
                                      "new": ["pytest|tests.test_house_terms|test_a"]}}
    expect("NEW failures in the newest valid run -> STUCK", state(run(_fixture(nightly=reds)), "nightly NEW failures"),
           STUCK)
    expect("  ...and none -> LIVE (the baseline is never re-reported)",
           state(run(_fixture()), "nightly NEW failures"), LIVE)
    nodiff = {**night, "newest_valid": {**night["newest_valid"], "new": None}}
    expect("  ...a record with no diff -> CAN'T CHECK, never 'none'",
           state(run(_fixture(nightly=nodiff)), "nightly NEW failures"), UNKNOWN)
    a1 = fingerprint(run(_fixture(nightly=old)))
    expect("the stale alert's text does not change hour to hour (no re-post every run)",
           a1 == fingerprint(evaluate(_fixture(nightly=old), now=now + dt.timedelta(hours=1), freeze_ends_at=never,
                                      landed=long_ago, diff_files=no_diff)), True)

    stuck_rows = run(_fixture(pending=pend))
    expect("alert: a new stuck item posts", should_post(stuck_rows, {}, now)[0], True)
    prev = {"fingerprint": fingerprint(stuck_rows), "posted_at": now.isoformat()}
    expect("alert: the same stuck item an hour later stays quiet",
           should_post(stuck_rows, prev, now + dt.timedelta(hours=1))[0], False)
    expect("alert: repeated after 6 h", should_post(stuck_rows, prev, now + dt.timedelta(hours=6))[0], True)
    expect("alert: recovery posts", should_post(run(_fixture()), prev, now)[0], True)
    expect("alert: all quiet stays quiet", should_post(run(_fixture()), {}, now)[0], False)
    expect("alert: morning always posts", should_post(run(_fixture()), {}, now, morning=True)[0], True)
    print("self-check:", "PASS" if not fails else f"FAIL ({len(fails)})")
    return 0 if not fails else 1


# ---------------------------------------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-fetch", action="store_true", help="use the refs already in this checkout")
    ap.add_argument("--wait", type=int, default=0, help="seconds to keep re-checking while a deploy is on the way")
    ap.add_argument("--post", action="store_true", help="post to Discord when the alert rule says so")
    ap.add_argument("--morning", action="store_true", help="with --post: always post (daily summary)")
    ap.add_argument("--state", default=str(pathlib.Path.home() / ".uct-live-check-state.json"),
                    help="alert memory file (what was last posted, so a stuck item is not re-posted every hour)")
    ap.add_argument("--flag-values", action="store_true", help="also read the real switch values from Railway")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    deadline = time.time() + a.wait
    while True:
        f = collect(fetch=not a.no_fetch, flag_values=a.flag_values)
        rows = evaluate(f)
        moving = [r for r in rows if r["state"] == ON_THE_WAY and r["area"] in ("service", "members")]
        if not moving or time.time() >= deadline:
            break
        print(f"... {len(moving)} deploy(s) on the way; re-checking in 60 s", file=sys.stderr)
        time.sleep(60)
    now = _parse_ts(f["now"])
    text = render(rows, now, f.get("railway_auth"))
    if a.json:
        print(json.dumps({"headline": headline(rows), "rows": rows, "errors": f["errors"], "at": f["now"]}, indent=2))
    else:
        print(text)
    if gh_summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(gh_summary, "a", encoding="utf-8") as fh:
            fh.write("## " + headline(rows) + "\n\n```\n" + text + "\n```\n")
    if a.post:
        prev = load_state(a.state)
        go, why = should_post(rows, prev, now, morning=a.morning)
        print(f"post: {'yes' if go else 'no'} ({why})", file=sys.stderr)
        if go and not webhook_url():
            print("::warning title=live check not posted::no LIVE_CHECK_DISCORD_WEBHOOK secret; the report is in "
                  "this run's summary only", file=sys.stderr)
        elif go:
            run = os.environ.get("GITHUB_RUN_ID")
            link = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{REPO}/actions/runs/{run}" if run else None
            try:
                post_discord(discord_text(rows, now, link))
            except (SourceError, OSError, ValueError) as e:
                # a post that failed is the CHECK breaking, never a report: exit 1 here once read as "stuck" and the
                # job stayed green while nothing reached Discord (2026-11-15)
                print(f"::error title=live check could not post::{type(e).__name__}: {e}"[:400], file=sys.stderr)
                return EXIT_BROKEN
            # remembered only after Discord accepted it: a failed post is retried by the next run
            save_state(a.state, {"fingerprint": fingerprint(rows), "posted_at": now.isoformat(), "reason": why})
    return exit_code(rows)


if __name__ == "__main__":
    sys.exit(main())
