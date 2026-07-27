#!/usr/bin/env python3
"""Server-side market-hours deploy guard.

`.git/hooks/pre-push` makes the deploy freeze mechanical for anyone pushing from
a clone. It cannot see a commit authored in the GitHub web UI -- a web commit
never runs a local hook, so the guard is bypassed by construction, not by
override. Between 2026-07-21 and 2026-07-24 three web-UI commits to
`api/massive_ws_worker.py` landed mid-session that way.

This script is the same decision, evaluated from a commit instead of a push, so
CI can run it on GitHub's side. It is a DETECTOR, not a blocker: a `push`-
triggered workflow runs after the push has already landed and Railway has
already been triggered. It exists to make a violation loud and immediate rather
than something discovered days later while reading `git log`. Making it a true
blocker requires branch protection (PR-only master + this as a required check).

Exit codes:
  0  compliant (outside the freeze window, or no relevant files touched)
  1  VIOLATION  (freeze-window deploy)
  2  undetermined (could not read the clock or the watched-file list) -- treated
     as attention-needed by the workflow, never silently as "compliant"

Usage:
  python tools/check_deploy_window.py --sha HEAD
  python tools/check_deploy_window.py --sha <sha> --base <sha>
  python tools/check_deploy_window.py --at 2026-07-24T15:45:00Z --files api/massive_ws_worker.py
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py<3.9 only
    ZoneInfo = None  # type: ignore[assignment]

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOK_PATH = REPO_ROOT / "tools" / "git-hooks" / "pre-push"

# Freeze window, mirroring tools/git-hooks/pre-push exactly.
# Day-of-week uses .NET's convention there (0=Sun .. 6=Sat); keep it identical
# so the two guards can never disagree about which days are trading days.
FREEZE_START_MIN = 9 * 60 + 15   # 9:15 AM ET
FREEZE_END_MIN = 16 * 60 + 20    # 4:20 PM ET (exclusive)


class Undetermined(RuntimeError):
    """We could not evaluate the rule. Never degrade this to 'compliant'."""


@dataclass
class Verdict:
    severity: str            # 'ok' | 'web' | 'flow'
    et_time: str
    in_freeze: bool
    flow_touched: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.severity == "ok"


def load_watched_files(hook_path: Path = HOOK_PATH) -> set:
    """Parse FLOW_WATCHED out of the pre-push hook.

    The hook is the single source of truth for which paths redeploy the
    flow-worker (it is itself kept in sync with the Railway service settings).
    Duplicating the list here would drift, and a drifted list fails OPEN -- it
    would call a flow-touching push clean. So a parse failure is Undetermined,
    never an empty set.
    """
    try:
        text = hook_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise Undetermined(f"cannot read {hook_path}: {exc}") from exc

    m = re.search(r'^FLOW_WATCHED="(.*?)"', text, re.MULTILINE | re.DOTALL)
    if not m:
        raise Undetermined(f"FLOW_WATCHED assignment not found in {hook_path}")
    # Shell line continuations (\ + newline) join the entries.
    raw = m.group(1).replace("\\\n", " ")
    files = {p.strip() for p in raw.split() if p.strip()}
    if not files:
        raise Undetermined("FLOW_WATCHED parsed to an empty list")
    # Precondition: the parse produced real paths, not shell noise.
    if "api/massive_ws_worker.py" not in files:
        raise Undetermined(
            "FLOW_WATCHED parsed but is missing api/massive_ws_worker.py -- "
            "the hook format likely changed; fix the parser rather than "
            "shipping a guard that silently matches nothing"
        )
    return files


def to_et(now_utc: datetime):
    if ZoneInfo is None:
        raise Undetermined("zoneinfo unavailable; cannot resolve ET")
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    try:
        return now_utc.astimezone(ZoneInfo("America/New_York"))
    except Exception as exc:  # tzdata missing on a slim runner
        raise Undetermined(f"cannot resolve America/New_York: {exc}") from exc


def classify(now_utc: datetime, changed_files, watched) -> Verdict:
    et = to_et(now_utc)
    # .NET DayOfWeek convention: Sunday=0 .. Saturday=6
    dow = (et.weekday() + 1) % 7
    mins = et.hour * 60 + et.minute
    in_freeze = 1 <= dow <= 5 and FREEZE_START_MIN <= mins < FREEZE_END_MIN
    flow_touched = sorted(f for f in changed_files if f in watched)
    et_time = et.strftime("%a %Y-%m-%d %H:%M %Z")

    if not in_freeze:
        return Verdict("ok", et_time, False, flow_touched)
    return Verdict("flow" if flow_touched else "web", et_time, True, flow_touched)


def _git(*args) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout


def commit_inputs(sha: str, base: str = None):
    """Return (authored_utc, changed_files) for a commit or a push range."""
    try:
        ts = int(_git("log", "-1", "--format=%ct", sha).strip())
        if base:
            files = _git("diff", "--name-only", f"{base}..{sha}")
        else:
            files = _git("show", "--name-only", "--format=", sha)
    except (subprocess.CalledProcessError, ValueError) as exc:
        raise Undetermined(f"git lookup failed for {sha}: {exc}") from exc
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc),
        [f.strip() for f in files.splitlines() if f.strip()],
    )


def render(v: Verdict, sha: str = None) -> str:
    who = f" ({sha[:8]})" if sha else ""
    if v.ok:
        return f"[deploy-window] OK{who} — {v.et_time} is outside the freeze window."
    if v.severity == "flow":
        return (
            f"[deploy-window] VIOLATION{who} — {v.et_time} is inside the "
            f"market-hours freeze (Mon-Fri 9:15 AM - 4:20 PM ET) AND this change "
            f"touches flow-worker watched files:\n"
            + "".join(f"    {f}\n" for f in v.flow_touched)
            + "  A flow-worker redeploy drops the live Massive OPRA options tape.\n"
            "  OPRA does not replay: the gap is PERMANENT until the overnight\n"
            "  T+1 flat file backfills it.\n"
            "  -> Ship flow-path changes after 4:20 PM ET or before 9:15 AM ET."
        )
    return (
        f"[deploy-window] VIOLATION{who} — {v.et_time} is inside the market-hours "
        f"freeze (Mon-Fri 9:15 AM - 4:20 PM ET).\n"
        "  Every master push swaps the Railway web container; /api/* drops for\n"
        "  minutes for live members.\n"
        "  -> Batch pushes until after 4:20 PM ET."
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sha", help="commit to evaluate (default: HEAD)")
    ap.add_argument("--base", help="compare against this sha instead of the commit's parent")
    ap.add_argument(
        "--at",
        help="ISO-8601 UTC instant to evaluate, overriding the commit's author "
        "time. CI passes the RUN time here: the hook evaluates the rule when a "
        "push happens, and it is the push -- not authorship -- that deploys.",
    )
    ap.add_argument("--files", nargs="*", help="changed files, overrides the commit's diff")
    args = ap.parse_args(argv)

    try:
        watched = load_watched_files()
        sha = args.sha or ("HEAD" if args.files is None else None)
        when = files = None
        if args.at is None or args.files is None:
            when, files = commit_inputs(sha or "HEAD", args.base)
        if args.at is not None:
            when = datetime.fromisoformat(args.at.replace("Z", "+00:00"))
        if args.files is not None:
            files = args.files
        verdict = classify(when, files, watched)
    except Undetermined as exc:
        print(f"[deploy-window] UNDETERMINED — {exc}", file=sys.stderr)
        return 2

    print(render(verdict, sha))
    return 0 if verdict.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
