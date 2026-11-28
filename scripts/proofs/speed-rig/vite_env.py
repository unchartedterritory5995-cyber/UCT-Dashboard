"""The speed rig's CANDIDATE BUILD helpers (2026-11-28, the workflow's build_ref / base_ref): the VITE_* constants a
candidate front end is built with, and the record of what was built.

    python scripts/proofs/speed-rig/vite_env.py env [--extra K=V,K=V] [--dockerfile <candidate>/Dockerfile.web]
        prints KEY=VALUE lines: vite-env.json (production's values) with --extra laid over them (the B side's own
        flags, for an A/B of a flag). Refuses a key that is not VITE_[A-Z0-9_]+, a value that is not a short flag
        (0, 1, empty or [A-Za-z0-9._:-] at most 16), a name that reads as a credential (TOKEN/KEY/SECRET/PASSWORD), and, with --dockerfile, a key that Dockerfile.web does not declare as an ARG (it
        could never reach production's build, so a candidate built with it measures a build nobody can ship).
    python scripts/proofs/speed-rig/vite_env.py meta <dist> --side B --ref <ref> --sha <sha> [--env-keys K,K]
        writes <dist>/build-meta.json (side, ref, commit, entry script, the VITE_* names) and prints it. When the
        commit IS production's web commit (/build.json), the candidate's entry script must be production's: content
        hashed, it differs only when the constants differ, so a mismatch means vite-env.json has drifted from Railway
        (exit 1: the numbers would measure another build than production's).
    python scripts/proofs/speed-rig/vite_env.py --self-check
Standard library only. Never handles a secret: a value that is not a short flag is refused, never printed.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = re.compile(r"VITE_[A-Z0-9_]+")
#: a build FLAG: 0, 1, empty, or a short word (2026-11-28 audit: never a credential, which is longer)
VALUE = re.compile(r"[A-Za-z0-9._:-]{0,16}")
#: a name that says it holds a credential is refused outright, whatever its value (the audit's rule)
SECRETISH = re.compile(r"TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH", re.I)
ENTRY = re.compile(r"/assets/index-[\w-]+\.js")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36"


def base() -> str:
    return os.environ.get("UCT_PROOF_BASE", "https://uctintelligence.com")


def declared(dockerfile_text: str) -> dict[str, str]:
    """{VITE name: its ARG default ('' when none)} for every `ARG VITE_*` Dockerfile.web declares."""
    return {m.group(1): (m.group(2) or "").strip().strip('"') for m in re.finditer(r"^ARG\s+(VITE_[A-Z0-9_]+)(?:=(\S*))?", dockerfile_text, re.M)}


def build_env(base_env: dict, extra: str = "", dockerfile_text: str | None = None) -> dict:
    env = dict(base_env)
    # ⛔ an error names an item's POSITION and LENGTH, never its text (a mistyped credential must not reach the log)
    for i, part in enumerate([p.strip() for p in (extra or "").split(",") if p.strip()], 1):
        k, sep, v = part.partition("=")
        if not sep:
            raise ValueError(f"build_env item {i} ({len(part)} characters) is not KEY=VALUE")
        env[k.strip()] = v.strip()
    for i, (k, v) in enumerate(env.items(), 1):
        if not KEY.fullmatch(k):
            raise ValueError(f"name {i} ({len(k)} characters) is not a VITE_* name")
        if SECRETISH.search(k):
            raise ValueError(f"name {i} ({len(k)} characters) reads as a credential (TOKEN/KEY/SECRET/PASSWORD): never a build flag here")
        if not isinstance(v, str) or not VALUE.fullmatch(v):
            raise ValueError(f"the value of name {i} ({len(str(v))} characters) is not a short flag (refused, not printed)")
    if dockerfile_text is not None:
        decl = declared(dockerfile_text)
        missing = sorted(set(env) - set(decl))
        if missing:
            raise ValueError(f"{len(missing)} name(s) not declared as an ARG in the candidate's Dockerfile.web (never in a production build)")
        # ⛔ EVERY declared ARG is SET in production's build, empty when Railway leaves it unset: Dockerfile.web's
        # `ENV VITE_X=$VITE_X` exports each one, so vite inlines '' where an unset variable would inline undefined. The
        # bundle (and its content-hashed entry) then differs from production's even with every flag equal: measured
        # 2026-11-28, the same commit built here without them hashed index-Dxho7ZLT.js against production's
        # index-Dbeet4b5.js (the parity check's MISMATCH). So a declared ARG Railway leaves unset gets its ARG default.
        for k, v in decl.items():
            if k not in env:
                # a credential-named ARG (VITE_PICOVOICE_ACCESS_KEY) is filled only EMPTY, as an unset one builds
                # ⚠️ PARITY RISK: if Railway ever SETS VITE_PICOVOICE_ACCESS_KEY, production's bundle inlines the key and no
                # candidate's does (the rig never handles a credential): the parity check then reads MISMATCH even on
                # production's own commit, and the wake word is off in every candidate. Refusing is the right answer.
                if not VALUE.fullmatch(v) or (SECRETISH.search(k) and v):
                    raise ValueError(f"an ARG default ({len(v)} characters) is not a short flag (refused, not printed)")
                env[k] = v
    return env


def get(path: str) -> str:
    req = urllib.request.Request(base() + path, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def parity(sha: str, entry: str, prod_commit: str | None, prod_entry: str | None) -> dict:
    """Is this the production commit, and if so is the candidate's entry production's?"""
    same = bool(sha and prod_commit and (sha.startswith(prod_commit) or prod_commit.startswith(sha)))
    if not same:
        return {"productionCommit": prod_commit, "productionEntry": prod_entry, "sameCommit": False, "verdict": "n/a (another commit)"}
    ok = bool(prod_entry) and entry == prod_entry
    return {"productionCommit": prod_commit, "productionEntry": prod_entry, "sameCommit": True,
            "verdict": "MATCH" if ok else "MISMATCH: vite-env.json has drifted from production's build (or its install differs)"}


def meta(dist: str, side: str, ref: str, sha: str, env_keys: list[str]) -> tuple[dict, int]:
    ip = os.path.join(dist, "index.html")
    if os.path.getsize(ip) > 1 << 20:   # a vite index.html is a few KB: the candidate's file is never read unbounded
        raise SystemExit("refused: the build's index.html is larger than 1 MB")
    with open(ip, encoding="utf-8", errors="replace") as f:
        html = f.read(1 << 20)
    m = ENTRY.search(html)
    if not m:
        raise SystemExit(f"{dist}/index.html names no /assets/index-*.js: not a vite build")
    try:
        b = json.loads(get("/build.json"))
        prod_commit = str(b.get("commit") or "") or None
    except Exception:  # noqa: BLE001 -- a label; the parity is then 'n/a'
        prod_commit = None
    try:
        pm = ENTRY.search(get("/"))
        prod_entry = pm.group(0) if pm else None
    except Exception:  # noqa: BLE001
        prod_entry = None
    rec = {"side": side, "ref": ref, "sha": sha, "label": f"{ref}@{sha[:12]}", "entry": m.group(0), "viteEnv": sorted(env_keys),
           "parity": parity(sha, m.group(0), prod_commit, prod_entry)}
    tmp = os.path.join(dist, "build-meta.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rec, f, indent=1)
    os.replace(tmp, os.path.join(dist, "build-meta.json"))
    print(json.dumps(rec, indent=1))
    return rec, (1 if rec["parity"]["verdict"].startswith("MISMATCH") else 0)


def self_check() -> int:
    df = "ARG VITE_A\nARG VITE_B=1\nENV VITE_A=$VITE_A\n"
    ok = build_env({"VITE_A": "1"}, "VITE_B=0", df) == {"VITE_A": "1", "VITE_B": "0"}
    # a declared ARG the file leaves unset is set as production's build sets it: its default, else empty
    df2 = df + "ARG VITE_C\nARG VITE_D=1\n"
    ok = ok and build_env({"VITE_A": "1"}, "", df2) == {"VITE_A": "1", "VITE_B": "1", "VITE_C": "", "VITE_D": "1"}
    # a credential-named ARG with no default is filled empty (as production builds it), and a 16-char word passes
    ok = ok and build_env({"VITE_A": "x" * 16}, "", df + "ARG VITE_PICOVOICE_ACCESS_KEY\n").get("VITE_PICOVOICE_ACCESS_KEY") == ""
    for bad in (({"VITE_A": "1"}, "VITE_C=1", df), ({"VITE_A": "a b"}, "", None), ({"NODE_OPTIONS": "x"}, "", None),
                ({"VITE_A": "x" * 17}, "", None), ({}, "VITE_A", None), ({}, "VITE_API_KEY=1", None), ({}, "VITE_RENDER_TOKEN=ab", None),
                ({"VITE_DB_PASSWORD": ""}, "", None), ({"VITE_A": "1"}, "", df + "ARG VITE_X_SECRET=abc\n")):
        try:
            build_env(*bad)
            ok = False
            print(f"self-check FAILED: {bad} was not refused")
        except ValueError:
            pass
    shipped = json.load(open(os.path.join(HERE, "vite-env.json"), encoding="utf-8"))["env"]
    build_env(shipped)   # the shipped file itself passes its own rules
    p = parity("06c46c63fbd3", "/assets/index-X.js", "06c46c63fbd3d5d84b0c", "/assets/index-X.js")
    q = parity("06c46c63fbd3", "/assets/index-Y.js", "06c46c63fbd3d5d84b0c", "/assets/index-X.js")
    r = parity("ae0314c56142", "/assets/index-Y.js", "06c46c63fbd3d5d84b0c", "/assets/index-X.js")
    ok = ok and p["verdict"] == "MATCH" and q["verdict"].startswith("MISMATCH") and not r["sameCommit"]
    print(f"vite_env self-check: {'ok' if ok else 'FAILED'} (undeclared, spaced, non-VITE, long and bare values refused; parity told apart)")
    return 0 if ok else 1


def main() -> int:
    a = sys.argv[1:]
    if "--self-check" in a:
        return self_check()
    opt = lambda k, d="": a[a.index(k) + 1] if k in a else d  # noqa: E731
    if a[:1] == ["env"]:
        df = opt("--dockerfile")
        shipped = json.load(open(os.path.join(HERE, "vite-env.json"), encoding="utf-8"))["env"]
        try:
            env = build_env(shipped, opt("--extra"), open(df, encoding="utf-8").read() if df else None)
        except ValueError as e:
            print(f"refused: {e}", file=sys.stderr)
            return 1
        for k in sorted(env):
            print(f"{k}={env[k]}")
        return 0
    if a[:1] == ["meta"] and len(a) > 1:
        _, code = meta(a[1], opt("--side"), opt("--ref"), opt("--sha"), [k for k in opt("--env-keys").split(",") if k])
        return code
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
