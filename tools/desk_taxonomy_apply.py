"""One-shot production apply for the Desk Video taxonomy (plan Task 12).

Reads `tools/taxonomy_out/assignments.json` (written by the Task 11
classification pipeline, after owner approval) — shape:

    {"categories": [{name, kind, sort_order, blurb}, ...],
     "assignments": [{id, category, tags}, ...]}

and POSTs it in ONE request to `POST /api/education/taxonomy-apply`
(`api/routers/education.py`), which is `all-or-nothing` server-side
(`education_service.bulk_apply_taxonomy` — one SQLite transaction; a bad
category rolls back the whole batch, but a missing video id is reported, not
fatal).

── Modes ────────────────────────────────────────────────────────────────────

--dry-run (default, and the explicit flag is also accepted as a no-op):
    Loads + shape-validates assignments.json, prints a summary (category
    count, assignment count, per-category totals, first 3 assignments) and
    the exact endpoint that --execute would POST to. NO network call unless
    --check is also passed.

--check (usable with either mode):
    One lightweight GET against a PUSH_SECRET-gated read endpoint
    (`/api/education/insights-backfill/pending?limit=1`) — the only class of
    route on this router that accepts the same Bearer auth as
    taxonomy-apply (the paid-content GET routes use session-cookie auth
    instead, so they can't serve as a Bearer preflight). Confirms the host
    is reachable and PUSH_SECRET is accepted BEFORE risking the real POST.

--execute:
    Actually POSTs the payload. REFUSES unless --backup-done is also passed
    — the operator must first run the documented railway-ssh backup (exact
    command printed in the refusal message). Prints the response
    `{categories, videos, missing_ids}` and exits nonzero if HTTP != 200,
    `missing_ids` is non-empty, or `videos` != len(assignments).

Retry idiom mirrors `tools/desk_taxonomy_dump.py::_get_cues`: 2 retries with
backoff on 5xx/network errors, fail-fast (no retry) on 4xx — a 4xx is a
permanent answer (bad payload / bad secret), not a transient blip.

Usage:
    python tools/desk_taxonomy_apply.py                                    # dry-run
    python tools/desk_taxonomy_apply.py --check                            # dry-run + auth/reachability probe
    python tools/desk_taxonomy_apply.py --execute --backup-done            # the real thing
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter

import requests
from dotenv import load_dotenv

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

MAIN_REPO_DIR = r"C:\Users\Patrick\uct-dashboard"
load_dotenv(os.path.join(MAIN_REPO_DIR, ".env"))

BASE = "https://uctintelligence.com"
HDRS = {
    "Authorization": f"Bearer {os.environ.get('PUSH_SECRET', '')}",
    # Cloudflare 1010-blocks non-browser User-Agents on uctintelligence.com.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 desk-taxonomy-apply",
}

_DEFAULT_ASSIGNMENTS = os.path.join(_ROOT, "tools", "taxonomy_out", "assignments.json")
APPLY_ENDPOINT = f"{BASE}/api/education/taxonomy-apply"
# Only PUSH_SECRET-gated GET on this router (paid-content GETs use session
# cookies, not Bearer) — doubles as a Bearer-auth + reachability preflight.
_CHECK_ENDPOINT = f"{BASE}/api/education/insights-backfill/pending?limit=1"

_BACKUP_CMD = (
    'railway ssh --service web "cp /data/education.db '
    '/data/education.pre-taxonomy-$(date +%Y%m%d).db"'
)

_REQUIRED_CATEGORY_KEYS = {"name", "kind", "sort_order", "blurb"}
_REQUIRED_ASSIGNMENT_KEYS = {"id", "category", "tags"}


# ── Load + validate ─────────────────────────────────────────────────────────

def load_assignments(path: str) -> dict:
    """Load assignments.json and validate its shape. Fails loud (raises
    ValueError with the offending index + missing keys) rather than letting
    a malformed file silently apply a partial/garbled taxonomy."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object, got {type(data).__name__}")

    missing_top = {"categories", "assignments"} - data.keys()
    if missing_top:
        raise ValueError(f"{path}: missing top-level key(s): {sorted(missing_top)}")

    cats = data["categories"]
    assigns = data["assignments"]
    if not isinstance(cats, list):
        raise ValueError(f"{path}: 'categories' must be a list, got {type(cats).__name__}")
    if not isinstance(assigns, list):
        raise ValueError(f"{path}: 'assignments' must be a list, got {type(assigns).__name__}")

    for i, c in enumerate(cats):
        if not isinstance(c, dict):
            raise ValueError(f"{path}: categories[{i}] is not an object: {c!r}")
        missing = _REQUIRED_CATEGORY_KEYS - c.keys()
        if missing:
            raise ValueError(
                f"{path}: categories[{i}] ({c.get('name', '?')!r}) missing key(s): {sorted(missing)}")

    for i, a in enumerate(assigns):
        if not isinstance(a, dict):
            raise ValueError(f"{path}: assignments[{i}] is not an object: {a!r}")
        missing = _REQUIRED_ASSIGNMENT_KEYS - a.keys()
        if missing:
            raise ValueError(
                f"{path}: assignments[{i}] (id={a.get('id', '?')!r}) missing key(s): {sorted(missing)}")
        if not isinstance(a.get("tags"), list):
            raise ValueError(
                f"{path}: assignments[{i}] (id={a.get('id')}) 'tags' must be a list, "
                f"got {type(a.get('tags')).__name__}")

    return data


# ── Summary (dry-run + pre-flight for --execute) ────────────────────────────

def print_summary(data: dict) -> None:
    cats = data["categories"]
    assigns = data["assignments"]
    counts = Counter(a["category"] for a in assigns)
    known = {c["name"] for c in cats}

    print(f"Categories:   {len(cats)}")
    print(f"Assignments:  {len(assigns)}")
    print()
    print("Per-category totals:")
    for c in sorted(cats, key=lambda c: (c.get("sort_order") if c.get("sort_order") is not None else 1 << 30)):
        n = counts.get(c["name"], 0)
        print(f"  {c['name']:<32} {n:>4}   (kind={c.get('kind')})")

    orphans = sorted(set(counts) - known)
    if orphans:
        print("  ! assignments reference categories NOT in the categories list:")
        for o in orphans:
            print(f"      {o!r}: {counts[o]}")

    print()
    print("First 3 assignments:")
    for a in assigns[:3]:
        print(f"  id={a['id']:<5} category={a['category']!r:<28} tags={a['tags']}")


# ── Network: --check preflight + --execute POST ─────────────────────────────

def run_check() -> bool:
    print(f"[check] GET {_CHECK_ENDPOINT}")
    try:
        r = requests.get(_CHECK_ENDPOINT, headers=HDRS, timeout=30)
    except requests.RequestException as e:
        print(f"[check] FAILED — network error: {type(e).__name__}: {e}")
        return False
    if r.status_code == 200:
        print("[check] OK — host reachable, PUSH_SECRET accepted.")
        return True
    print(f"[check] FAILED — HTTP {r.status_code}: {r.text[:300]}")
    return False


def _post_apply(payload: dict) -> requests.Response:
    """POST taxonomy-apply with 2 retries + backoff on 5xx/network errors —
    a 4xx (bad payload, bad secret) is a permanent answer and is returned
    immediately for the caller to inspect, no retry. Mirrors the `_get_cues`
    idiom in tools/desk_taxonomy_dump.py."""
    last_err: Exception | None = None
    for attempt in range(3):  # 1 try + 2 retries
        try:
            r = requests.post(APPLY_ENDPOINT, headers=HDRS, json=payload, timeout=120)
        except requests.RequestException as e:
            last_err = e
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        if r.status_code >= 500:
            last_err = requests.HTTPError(f"{r.status_code} server error for taxonomy-apply", response=r)
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last_err
        return r  # 2xx or 4xx — no retry, caller inspects status/body
    raise last_err  # pragma: no cover — loop always returns or raises above


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assignments", default=_DEFAULT_ASSIGNMENTS,
                    help=f"Path to assignments.json (default: {_DEFAULT_ASSIGNMENTS}).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Explicit no-op — this is already the default when --execute is omitted.")
    ap.add_argument("--check", action="store_true",
                    help="Also run a lightweight GET auth/reachability preflight "
                         "(PUSH_SECRET-gated endpoint).")
    ap.add_argument("--execute", action="store_true",
                    help="POST the payload to production. Refuses without --backup-done.")
    ap.add_argument("--backup-done", action="store_true",
                    help="Confirms the pre-apply railway-ssh backup has already been run. "
                         "Required (with the operator's own eyes) to unlock --execute.")
    args = ap.parse_args()

    if args.dry_run and args.execute:
        print("Specify at most one of --dry-run / --execute (dry-run is already the default).")
        return 1

    try:
        data = load_assignments(args.assignments)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Failed to load {args.assignments}: {e}")
        return 1

    print_summary(data)
    print(f"\nEndpoint (POST, fires only on --execute): {APPLY_ENDPOINT}")

    needs_secret = args.check or args.execute
    if needs_secret and not os.environ.get("PUSH_SECRET"):
        print(f"\nPUSH_SECRET not set (checked env + {MAIN_REPO_DIR}\\.env) — "
              f"required for --check / --execute.")
        return 1

    check_ok = True
    if args.check:
        print()
        check_ok = run_check()

    if not args.execute:
        print("\n[dry-run] No taxonomy-apply POST was made.")
        return 0 if check_ok else 1

    # ── --execute ────────────────────────────────────────────────────────
    if not args.backup_done:
        print("\nREFUSING to --execute without --backup-done.")
        print(f"Run the backup FIRST, from the linked main repo dir ({MAIN_REPO_DIR}):\n")
        print(f"  {_BACKUP_CMD}")
        print("\nThen re-run this tool with --execute --backup-done.")
        return 1

    if not check_ok:
        print("\n--check failed — aborting --execute (fix connectivity/auth first).")
        return 1

    payload = {"categories": data["categories"], "assignments": data["assignments"]}
    expected = len(payload["assignments"])
    print(f"\n[execute] POSTing {expected} assignments / {len(payload['categories'])} "
          f"categories to {APPLY_ENDPOINT} ...")

    try:
        r = _post_apply(payload)
    except Exception as e:
        print(f"[execute] POST failed after retries: {type(e).__name__}: {e}")
        return 1

    if r.status_code != 200:
        print(f"[execute] FAILED — HTTP {r.status_code}: {r.text[:2000]}")
        return 1

    try:
        result = r.json()
    except Exception as e:
        print(f"[execute] Could not parse JSON response: {e}\nRaw: {r.text[:2000]}")
        return 1

    print(f"[execute] Response: {result}")

    missing = result.get("missing_ids") or []
    videos = result.get("videos")
    problems = []
    if missing:
        problems.append(f"missing_ids non-empty: {missing}")
    if videos != expected:
        problems.append(f"videos={videos} != expected len(assignments)={expected}")
    if problems:
        print("[execute] FAILED — " + "; ".join(problems))
        return 1

    print(f"[execute] OK — applied {videos} video rows across "
          f"{result.get('categories')} categories, 0 missing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
