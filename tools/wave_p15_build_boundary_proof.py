"""Wave P1.5 — prove the web build boundary, before and after the one canary.

⛔ WHY THIS IS AN INSTRUMENT AND NOT A PARAGRAPH. The previous packaging attempt
"succeeded" — the build was green, the selector variable was present in the
container, and Tesseract was simply absent, because the variable never selected
the build graph. The lesson is that a build boundary must be read off the
PLATFORM's own account of what it built, never inferred from what we set.

Railway publishes exactly that: every deployment carries a `serviceManifest`
naming its builder, its Dockerfile path, its nixpacks config path and its start
command, plus the `configFile` the settings were merged from. This reads them
live for all five services and checks them against what the repository declares.

  python tools/wave_p15_build_boundary_proof.py            # A-F, live + repo
  python tools/wave_p15_build_boundary_proof.py --json     # machine-readable

⛔ IT READS. It never sets a variable, never triggers a deploy, and never
touches member data.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB_RAILWAY = ROOT / "railway.web.json"
SHARED_RAILWAY = ROOT / "railway.json"
WEB_DOCKERFILE = ROOT / "Dockerfile.web"

# The service that owns OCR, and the ones that must never receive it.
# Windows needs the resolved .exe; a bare name raises WinError 2.
_RAILWAY = shutil.which("railway") or "railway"

OCR_OWNER = "web"
SHARED_IMAGE_SERVICES = ("worker", "flow-worker", "bars-api")
INDEPENDENT = ("chart-renderer",)

OK, BAD, MEH = "PASS", "FAIL", "n/a"


def _railway_status() -> dict:
    out = subprocess.run([_RAILWAY, "status", "--json"], cwd=ROOT,
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise SystemExit("railway status failed: " + (out.stderr or "")[:400])
    return json.loads(out.stdout)


def _services(status: dict) -> dict:
    """serviceName -> {configFile, builder, dockerfilePath, nixpacksConfigPath,
    buildCommand, startCommand, commit}."""
    found = {}
    for env in status["environments"]["edges"]:
        node = env["node"]
        if node["name"] != "production":
            continue
        for si in node["serviceInstances"]["edges"]:
            svc = si["node"]
            meta = (svc.get("latestDeployment") or {}).get("meta") or {}
            manifest = meta.get("serviceManifest") or {}
            build = manifest.get("build") or {}
            deploy = manifest.get("deploy") or {}
            found[svc["serviceName"]] = {
                "configFile": meta.get("configFile"),
                "commit": (meta.get("commitHash") or "")[:9] or None,
                "builder": build.get("builder"),
                "dockerfilePath": build.get("dockerfilePath"),
                "nixpacksConfigPath": build.get("nixpacksConfigPath"),
                "buildCommand": build.get("buildCommand"),
                "startCommand": deploy.get("startCommand"),
                "healthcheckPath": deploy.get("healthcheckPath"),
            }
    return found


def _var_presence(service: str, names) -> dict | None:
    """Which of `names` are SET on a service, or None if the list could not be
    read. Values are never returned or printed — the question is presence, and
    the answer must not leak a secret.

    ⛔ NONE MEANS UNKNOWN, AND UNKNOWN IS NOT CLEAN. The first draft of this
    returned {name: None} on a failed read, which the caller then scored as
    "the flag is not set" — a swallowed error becoming a confident finding, on
    the one check that says whether OCR is live for members. One retry, then
    the truth."""
    for attempt in (1, 2):
        out = subprocess.run([_RAILWAY, "variables", "--service", service, "--kv"],
                             cwd=ROOT, capture_output=True,
                             encoding="utf-8", errors="replace", timeout=180)
        if out.returncode == 0:
            keys = {line.split("=", 1)[0].strip()
                    for line in out.stdout.splitlines() if "=" in line}
            return {n: (n in keys) for n in names}
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--skip-vars", action="store_true",
                    help="skip the per-service variable read (5 CLI calls)")
    args = ap.parse_args()

    web_cfg = json.loads(WEB_RAILWAY.read_text(encoding="utf-8"))
    shared_cfg = json.loads(SHARED_RAILWAY.read_text(encoding="utf-8"))
    live = _services(_railway_status())
    checks = []

    def check(key, verdict, detail):
        checks.append({"check": key, "verdict": verdict, "detail": detail})

    # ── A · web selects the new build contract ──────────────────────────────
    want = "/" + str(web_cfg["build"]["dockerfilePath"])
    w = live.get(OCR_OWNER, {})
    selected = (w.get("builder") == "DOCKERFILE"
                and (w.get("dockerfilePath") or "").lstrip("/") ==
                web_cfg["build"]["dockerfilePath"].lstrip("/"))
    check("A web builds from the web Dockerfile",
          OK if selected else BAD,
          "live: builder=%s dockerfilePath=%s configFile=%s | repo declares %s"
          % (w.get("builder"), w.get("dockerfilePath"), w.get("configFile"), want))

    # ── B · the other three do not ──────────────────────────────────────────
    strays = [s for s in SHARED_IMAGE_SERVICES
              if (live.get(s, {}).get("builder") == "DOCKERFILE"
                  or live.get(s, {}).get("dockerfilePath"))]
    check("B worker/flow-worker/bars-api keep the shared build",
          OK if not strays else BAD,
          ", ".join("%s=%s" % (s, live.get(s, {}).get("builder")) for s in SHARED_IMAGE_SERVICES)
          + (" | STRAYS: %s" % strays if strays else ""))

    # ── C · chart_renderer untouched ────────────────────────────────────────
    diff = subprocess.run([shutil.which("git") or "git", "diff", "--name-only", "origin/master", "--",
                           "services/chart_renderer"], cwd=ROOT,
                          capture_output=True, text=True)
    touched = [ln for ln in diff.stdout.splitlines() if ln.strip()]
    check("C chart-renderer untouched by Wave P",
          OK if not touched else BAD,
          "live builder=%s | changed files: %s"
          % (live.get("chart-renderer", {}).get("builder"), touched or "none"))

    # ── D · Tesseract belongs to the web build definition alone ─────────────
    build_files = ["nixpacks.toml", "railway.json", "railway.web.json",
                   "requirements.txt", "services/chart_renderer/Dockerfile",
                   "services/chart_renderer/requirements.txt", "Dockerfile.web"]
    carriers = [f for f in build_files
                if (ROOT / f).exists()
                and "tesseract" in (ROOT / f).read_text(encoding="utf-8").lower()]
    check("D tesseract appears in exactly one build definition",
          OK if carriers == ["Dockerfile.web"] else BAD,
          "carriers: %s" % carriers)

    # ── E · start-up semantics are not forked ───────────────────────────────
    same = web_cfg["deploy"] == shared_cfg["deploy"]
    live_same = (w.get("startCommand") or "") == web_cfg["deploy"]["startCommand"]
    check("E the start command has one authority",
          OK if same else BAD,
          "repo deploy blocks equal=%s | live web startCommand matches repo=%s"
          % (same, live_same))

    # ── F · OCR is dark, read live, never inferred from a default ───────────
    if args.skip_vars:
        check("F OCR activation is dark", MEH, "--skip-vars")
    else:
        flags = {}
        for svc in (OCR_OWNER,) + SHARED_IMAGE_SERVICES:
            flags[svc] = _var_presence(svc, ["J2_OCR_ENABLED", "NIXPACKS_CONFIG_FILE",
                                             "RAILWAY_DOCKERFILE_PATH"])
        unread = [s for s, f in flags.items() if f is None]
        lit = [s for s, f in flags.items() if f and f.get("J2_OCR_ENABLED")]
        stale = [s for s, f in flags.items()
                 if f and (f.get("NIXPACKS_CONFIG_FILE")
                           or f.get("RAILWAY_DOCKERFILE_PATH"))]
        check("F OCR activation is dark on every service",
              OK if not lit and not stale and not unread else BAD,
              "J2_OCR_ENABLED set on: %s | abandoned selectors set on: %s | "
              "COULD NOT READ: %s"
              % (lit or "nothing", stale or "nothing", unread or "none"))

    # ⛔ The image itself must not enable it — and this asks the INSTRUCTIONS,
    # not the file text. A substring search calls the comment that explains why
    # nothing sets the flag a violation, which is the grep-versus-structure
    # mistake this whole rail exists to avoid.
    df = WEB_DOCKERFILE.read_text(encoding="utf-8")
    setters = [ln.strip() for ln in df.splitlines()
               if ln.split(" ")[0].upper() in ("ENV", "ARG")
               and "J2_OCR_ENABLED" in ln]
    check("F' the image installs OCR without enabling it",
          OK if not setters else BAD,
          "ENV/ARG lines setting the OCR flag: %s" % (setters or "none"))

    if args.json:
        print(json.dumps({"checks": checks, "live": live}, indent=2))
    else:
        print("WAVE P1.5 — WEB BUILD BOUNDARY")
        print("=" * 74)
        for svc, d in sorted(live.items()):
            print("  %-15s builder=%-10s dockerfile=%-16s config=%s"
                  % (svc, d["builder"], d["dockerfilePath"] or "-",
                     d["configFile"] or "-"))
        print("-" * 74)
        for c in checks:
            print("  [%s] %s\n        %s" % (c["verdict"], c["check"], c["detail"]))
    return 0 if all(c["verdict"] != BAD for c in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
