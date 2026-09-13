"""Redact credentials before anything is logged, written, or surfaced. ONE copy.

⚰️ **2026-09-13.** The `/charts` A/B harness crashed during teardown and printed the raw
playwright exception. A playwright error embeds the request headers of the call that
failed, and one of those headers is `Cookie:` — so a LIVE member session token landed in
a run log and in the agent's own tool output. The session had to be rotated.

⛔ The rule this encodes: **a raw playwright/HTTP exception is never printed.** Print
`brief(exc)`. Anything else that reaches a log, a file, or a tool result goes through
`scrub()` first.

⛔ **ONE implementation, deliberately.** A scrubber copied into each rig is three
scrubbers, and `lesson_a_guard_repeated_is_a_guard_unproved` applies: only one of them
ever gets the next fix, and none of them can be mutation-proved as *the* guard.

⭐ **The scanner builds its needle by concatenation**, so this file does not contain the
literal it hunts — and a self-check case asserts exactly that, which is how the first
draft was caught writing the cookie name into this very paragraph. That is not
decoration: this repo has six recorded cases of a literal-hunting check matching its own
source or the prose beside it and reporting a property of itself as a property of what it
measured. A value-shape floor (16+ chars) is the second half: the cookie name followed by
nothing, and one followed by `<redacted>`, are both correctly NOT findings.

    python tools/secret_scrub.py --self-check
    python tools/secret_scrub.py --scan <dir> [<dir>...]      # exit 1 on any finding
"""

import argparse
import os
import pathlib
import re
import sys

# Value shape: long enough to be a real credential, in the charset tokens actually use.
_VAL = r"[A-Za-z0-9_\-\.\+/=]{16,}"
_SHORTVAL = r"[A-Za-z0-9_\-\.\+/=]{6,}"

# Needles assembled at runtime so this module never contains the literals it hunts.
_SESSION_NAME = "uct_" + "session"
_SENSITIVE_NAME = r"(?:token|secret|password|passwd|api[_\-]?key|" + "session" + r"|auth)"

# What to REDACT (broad: better to over-redact a log than to leak one).
_RULES = (
    # `Cookie: a=b; c=d` / `Set-Cookie: ...` / `Authorization: Bearer ...` — to end of line.
    (re.compile(r"(?im)^(\s*-?\s*(?:set-)?cookie\s*:\s*).+$"), r"\1<redacted>"),
    (re.compile(r"(?im)^(\s*-?\s*authorization\s*:\s*).+$"), r"\1<redacted>"),
    # Inline `cookie: ...` / `authorization: ...` inside a one-line message.
    (re.compile(r"(?i)((?:set-)?cookie\s*:\s*)" + _SHORTVAL + r"[^\s,;]*"), r"\1<redacted>"),
    (re.compile(r"(?i)(authorization\s*:\s*)(?:bearer\s+)?" + _SHORTVAL), r"\1<redacted>"),
    # `<sensitive-name>=value` or `<sensitive-name>: value`, any casing.
    # ⛔ The name may carry a PREFIX — the session cookie wears a `uct_` one, and
    # `x_api_token:` is the same shape. A leading `\b` does not match between `_` and a
    # letter (both are word characters), so the first draft matched only the unprefixed
    # name and sailed straight past the very cookie that leaked.
    (re.compile(r"(?i)(?<![A-Za-z0-9_\-])([A-Za-z0-9_\-]*" + _SENSITIVE_NAME +
                r"[A-Za-z0-9_\-]*\s*[=:]\s*)" + _SHORTVAL), r"\1<redacted>"),
)

# What COUNTS AS A LEAK when scanning an artifact.
#
# ⛔ SCANNING IS NARROW WHERE REDACTING IS BROAD, AND THE ASYMMETRY IS THE POINT.
# Over-redacting a log costs nothing. Over-reporting costs the instrument: the first
# draft also flagged any `<name containing token/secret/key>=<value>` and returned 68
# findings, of which the real one was 1 — the rest were `apiKey:` in vendor bundles,
# prose in design docs, and ordinary identifiers. A scanner with a 1.5% hit rate is one
# people mute, and a muted scanner is worse than none because it reads as coverage
# (`lesson_a_gate_list_drifts_like_any_other_artifact`).
#
# These three are the shapes that mean a CREDENTIAL REACHED AN ARTIFACT: the session
# cookie by name, and the two headers that carry bearer credentials.
_FINDINGS = (
    ("session-cookie", re.compile(_SESSION_NAME + r"=" + _VAL)),
    ("cookie-header", re.compile(r"(?i)(?:set-)?cookie\s*:\s*" + _VAL)),
    ("authorization-header", re.compile(r"(?i)authorization\s*:\s*(?:bearer\s+)?" + _VAL)),
)

_SKIP_DIRS = {".git", "node_modules", "dist", "build", ".vite", "__pycache__", ".pytest_cache"}
_SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".gz", ".ico",
             ".woff", ".woff2", ".ttf", ".mp4", ".db", ".sqlite", ".wasm"}


def scrub(text) -> str:
    """Redact every credential shape. Keeps the field NAME so the line still reads."""
    out = str(text)
    for pat, repl in _RULES:
        out = pat.sub(repl, out)
    return out


def brief(exc, limit: int = 300) -> str:
    """Exception type + first line, scrubbed. A call log is never safe to print."""
    first = str(exc).splitlines()[0] if str(exc) else ""
    return scrub(f"{type(exc).__name__}: {first}")[:limit]


def scan_text(text: str):
    """Findings in one blob, as (kind, line_no). NEVER returns the matched value."""
    hits = []
    for i, line in enumerate(str(text).splitlines(), 1):
        for kind, pat in _FINDINGS:
            if pat.search(line):
                hits.append((kind, i))
                break
    return hits


def scan_paths(paths, skip_files=()):
    """Walk paths for leaked credentials. Returns (path, line_no, kind) — no values."""
    skip = {pathlib.Path(p).resolve() for p in skip_files}
    found = []
    for root in paths:
        root = pathlib.Path(root)
        if not root.exists():
            continue
        files = [root] if root.is_file() else [
            p for p in root.rglob("*")
            if p.is_file() and not _SKIP_DIRS & set(p.parts)
            and not any(part.startswith("dist") for part in p.parts)   # dist-before/-after too
            and p.suffix.lower() not in _SKIP_EXT
        ]
        for p in files:
            try:
                if p.resolve() in skip or p.stat().st_size > 20_000_000:
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for kind, line_no in scan_text(text):
                found.append((str(p), line_no, kind))
    return found


def default_scan_paths():
    """Where THIS rig leaves output. Deliberately not every agent session on the box.

    ⛔ The first draft defaulted to the whole `%TEMP%/claude` tree — every session's
    transcripts and task outputs, which is minutes of walking and a pile of findings
    belonging to work nobody here is doing. A scan that slow and that noisy is one people
    stop running. Point it at the current session's scratchpad with `--scan`, or set
    `UCT_RIG_SCAN_DIRS` (os.pathsep-separated) to have it included by default.
    """
    repo = pathlib.Path(__file__).resolve().parent.parent
    out = [repo / "docs", repo / "tools", repo / "scripts"]
    tmp = pathlib.Path(os.environ.get("TEMP") or os.environ.get("TMPDIR") or "/tmp")
    if (tmp / "uct_ab").exists():
        out.append(tmp / "uct_ab")
    for extra in (os.environ.get("UCT_RIG_SCAN_DIRS") or "").split(os.pathsep):
        if extra.strip() and pathlib.Path(extra.strip()).exists():
            out.append(pathlib.Path(extra.strip()))
    return out


def self_check() -> int:
    import tempfile
    fails = []

    def case(name, ok):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            fails.append(name)

    # ⛔ SYNTHETIC, NEVER THE REAL VALUE. The first draft pasted the actual leaked token
    # in here as a fixture — and because this file is on the scanner's own skip list, the
    # scan came back clean over it. An allowlist is exactly where a secret can hide, so
    # the rule is that no real credential enters the file, not that the file is exempt.
    # Same SHAPE (leading dash, mixed case, dashes, 64 chars), no real bytes.
    tok = "-" + "Kq7" + "-Xm2Vt" + "-" + ("aZ9pR4nL" * 6)[:57]
    leaked = f"  - cookie: {_SESSION_NAME}={tok}"
    probe = tok[5:25]        # a slice of the SYNTHETIC value, never a real one
    case("scrub kills the leaked cookie line", probe not in scrub(leaked))
    case("scrub keeps the field name", "cookie" in scrub(leaked).lower() and "<redacted>" in scrub(leaked))
    case("scrub kills Set-Cookie", probe not in scrub(f"Set-Cookie: {_SESSION_NAME}={tok}; Path=/"))
    case("scrub kills Authorization: Bearer", "abcdefghijklmnop" not in scrub("authorization: Bearer abcdefghijklmnop"))
    case("scrub kills a password field", "hunter2hunter2hunter2" not in scrub("password=hunter2hunter2hunter2"))
    case("scrub kills a token field", "abcdefghijklmnop" not in scrub("X-Api-Token: abcdefghijklmnop"))
    case("scrub is multi-line safe",
         probe not in scrub(f"Route.fetch failed\n  - cookie: {_SESSION_NAME}={tok}\n  - x: 1"))
    case("scrub leaves ordinary text alone",
         scrub("charts-breadth__390__after.png") == "charts-breadth__390__after.png")
    case("scrub leaves a plain sentence alone",
         scrub("the session ended and the widget rendered") == "the session ended and the widget rendered")
    case("brief drops the call log", "\n" not in brief(RuntimeError(f"boom\n  - cookie: {_SESSION_NAME}={tok}")))
    case("brief scrubs a one-line leak", probe not in brief(RuntimeError(f"{_SESSION_NAME}={tok}")))

    # Scanner: it must SEE a real one, and must NOT cry wolf on a redacted one.
    case("scanner finds a live session cookie", scan_text(leaked) != [])
    case("scanner finds a bare cookie header", scan_text(f"Cookie: {tok}") != [])
    case("scanner ignores an already-redacted line", scan_text(f"cookie: {_SESSION_NAME}=<redacted>") == [])
    case("scanner ignores a valueless mention", scan_text(f"{_SESSION_NAME}=") == [])
    case("scanner reports no value, only kind+line", all(
        len(h) == 2 and isinstance(h[1], int) for h in scan_text(leaked)))
    case("this module does not contain the literal it hunts",
         (_SESSION_NAME + "=") not in pathlib.Path(__file__).read_text(encoding="utf-8"))

    # ⛔ NON-VACUITY: a scanner that cannot see a planted file proves nothing about a clean tree.
    with tempfile.TemporaryDirectory() as d:
        planted = pathlib.Path(d) / "run.log"
        planted.write_text(f"GET /api/auth/me\n  - cookie: {_SESSION_NAME}={tok}\n", encoding="utf-8")
        hits = scan_paths([d])
        case("scan_paths finds a planted leak (non-vacuity control)", len(hits) == 1)
        case("scan_paths reports kind + line, never the value",
             bool(hits) and hits[0][2] == "session-cookie" and tok not in str(hits))
        planted.write_text(scrub(planted.read_text(encoding="utf-8")), encoding="utf-8")
        case("scrubbing the planted file clears the finding", scan_paths([d]) == [])

    print("SELF-CHECK " + ("PASS" if not fails else f"FAIL ({len(fails)})"))
    return 0 if not fails else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--scan", nargs="*", default=None,
                    help="paths to scan (default: repo docs/tools/scripts + agent scratchpads)")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    paths = a.scan if a.scan else default_scan_paths()
    # This file and its test legitimately describe the shapes; they are not artifacts.
    here = pathlib.Path(__file__).resolve()
    skip = [here, here.parent.parent / "tests" / "test_secret_scrub.py"]
    hits = scan_paths(paths, skip_files=skip)
    for path, line_no, kind in hits:
        print(f"LEAK {kind}: {path}:{line_no}")
    print(f"scanned {len(list(paths))} path(s) — {len(hits)} finding(s)")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
