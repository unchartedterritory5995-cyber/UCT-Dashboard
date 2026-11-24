"""R30/R34/OI-45 — can the stall record and its page actually fail? Five mutations, each named.

⛔ A rail that has never been seen RED is decoration. Each mutation removes one guarantee and
names the case that must go red; a mutation that reddens the suite somewhere else says nothing
about the guard it deleted.

⛔ MUTATIONS RUN IN A THROWAWAY WORKTREE, NEVER ON A BRANCH YOU CARE ABOUT, and the original is
restored BY BYTES with its sha256 verified — never by `git checkout`, which has already
destroyed one session's unrelated finished work in this repo.

⛔⛔ AND THE SENTENCE ABOVE IS NOW CODE, NOT A REQUEST. Until 2026-11-24 this file called no tree
guard at all: run from the integrator's checkout it edited `api/**` in place, and a run killed
mid-mutation would have left the edit there — the incident B4 (owner ruling, 2026-09-14) exists
to make impossible. It now calls the shared `harness_guard.guard()` at module level, before any
write, on `ROOT` — the one tree it guards, mutates and tests.

Usage:  python docs/discord-render/instruments/mutation_harness_stall_record.py [repo-root]
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ⛔ FLAGS ARE NOT PATHS: only a positional argument names the tree.
_POSITIONAL = [a for a in sys.argv[1:] if not a.startswith("-")]
#: The ONE tree this harness guards, mutates and tests. The guard inspects exactly the tree the
#: edits land in; a guard that looks at one tree while the writes go to another guards nothing.
ROOT = Path(_POSITIONAL[0]).resolve() if _POSITIONAL else HERE.parents[2]

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless ROOT is a sacrificed mutation sandbox, then refuses to
# start a run on an anchor that no longer matches its source.
sys.path.insert(0, str(HERE))
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)

TARGET = "api/services/discord_render/stall_record.py"
OBSERVE = "api/services/discord_render/observe.py"
TESTS = "tests/test_stall_record.py"


TOKEN_SLOTS = "api/services/discord_render/token_slots.py"
RENDER_PANELS = "api/routers/render_panels.py"
TOKEN_TESTS = "tests/test_token_slots.py"

#: Every control names the case that must go red (`expect_red`) and the suite it must go red IN
#: (`suite`): a mutation reddening a DIFFERENT suite says nothing about the guard it deleted.
MUTATIONS = [
    # ⛔ The whole of OI-45. Re-gating the page behind the V2 flag is the exact bug being closed:
    # the rule existed, was tested, was mutation-covered, and could never fire in production.
    {"name": "M1 the page is re-gated behind the dark V2 flag",
     "file": TARGET,
     "old": "        if d[\"page\"]:\n",
     "new": "        import os as _o\n        if d[\"page\"] and _o.environ.get(\"DISCORD_RENDER_V2_ENABLED\"):\n",
     "expect_red": "test_a_stall_pages_with_V2_DARK", "suite": TESTS},
    # ⛔ severity is what makes it audible. Anything but "critical" is recorded and never paged.
    {"name": "M2 the severity drops to warning — recorded, never told",
     "file": TARGET,
     "old": "chart_health_alerts.emit(ALERT_KEY, \"critical\", msg,",
     "new": "chart_health_alerts.emit(ALERT_KEY, \"warning\", msg,",
     "expect_red": "test_the_severity_is_critical", "suite": TESTS},
    # ⛔ the cooldown must be DURABLE. In-memory it is erased ~20x/day and suppresses nothing.
    {"name": "M3 the cooldown stops being persisted",
     "file": TARGET,
     "old": "            _write_cooldown(now)\n",
     "new": "            pass\n",
     "expect_red": "test_the_cooldown_survives_a_process_restart", "suite": TESTS},
    # ⛔ the uptime floor is what keeps the boot-window stalls from paging 20x/day.
    {"name": "M4 the uptime floor reads as zero — every boot stall pages",
     "file": OBSERVE,
     "old": "LOOP_STALL_PAGE_UPTIME_FLOOR_S = 900.0",
     "new": "LOOP_STALL_PAGE_UPTIME_FLOOR_S = 0.0",
     "expect_red": "test_tier2_pages_only_past_the_uptime_floor", "suite": TESTS},
    # ⛔ tier 1 is the working path for the largest measured class (20,446 ms below the floor).
    {"name": "M5 tier 1 is raised out of reach — the 80 s block pages nobody",
     "file": OBSERVE,
     "old": "LOOP_STALL_PAGE_ALWAYS_MS = 3000.0",
     "new": "LOOP_STALL_PAGE_ALWAYS_MS = 1000000.0",
     "expect_red": "test_tier1_pages_at_any_uptime", "suite": TESTS},
    # ⛔⛔ R51's OWN REGRESSION, and it is a different mutation from M5. M5 raises tier 1 so far
    # that even an 80 s block is silent — a break nobody would ship by accident. THIS one puts
    # it back to the 5,000 ms it was on 2026-09-17, which looks entirely reasonable and silently
    # restores the exact hole the ruling closed: the measured 3,572 ms block that killed an ack
    # and paged nobody. A plausible mutation is the one worth railing.
    {"name": "M9 tier 1 goes back above the Discord ack budget — a 3.5 s ack-killer pages nobody",
     "file": OBSERVE,
     "old": "LOOP_STALL_PAGE_ALWAYS_MS = 3000.0",
     "new": "LOOP_STALL_PAGE_ALWAYS_MS = 5000.0",
     "expect_red": "test_a_block_just_past_the_ack_budget_pages_at_low_uptime", "suite": TESTS},
    # ── commit B (R29): the token-slot counter ──────────────────────────────
    # ⛔ If both slots move together the counter cannot answer R29's question at all.
    {"name": "M6 the slot label is swapped — previous is counted as current",
     "file": RENDER_PANELS,
     "old": "            matched_slot = _slot\n",
     "new": "            matched_slot = token_slots.SLOT_CURRENT\n",
     "expect_red": "test_a_previous_match_increments_only_previous", "suite": TOKEN_TESTS},
    # ⛔ In memory the count means "since the last deploy" — and this pod restarts ~20x/day.
    {"name": "M7 the counter stops being persisted",
     "file": TOKEN_SLOTS,
     "old": "            os.replace(tmp, p)      # atomic — a torn counter would read as a zero\n",
     "new": "            pass\n",
     "expect_red": "test_counts_survive_a_process_restart", "suite": TOKEN_TESTS},
    # ⛔ UNREADABLE IS NOT ZERO — the one way a corrupt file could authorise clearing a live token.
    {"name": "M8 an unreadable counter reports itself as clean",
     "file": TOKEN_SLOTS,
     "old": "        d[\"unreadable\"] = True\n",
     "new": "        pass\n",
     "expect_red": "test_an_unreadable_counter_is_not_a_zero", "suite": TOKEN_TESTS},
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def run_tests(which: str | None = None) -> tuple[int, str]:
    suites = [which] if which else [TESTS, TOKEN_TESTS]
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", *suites],
                       cwd=str(ROOT), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=900)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    originals = {p: p.read_bytes() for p in {ROOT / m["file"] for m in MUTATIONS}}
    shas = {p: sha(p) for p in originals}
    for p, s in shas.items():
        print(f"captured {p.name} sha256={s} bytes={len(originals[p])}")

    rc, out = run_tests()
    if rc != 0:
        print("  CONTROL BEFORE: FAILED — refusing to mutate a red tree")
        print(out[-1500:])
        return 2
    print(f"  CONTROL BEFORE: exit=0  {[l for l in out.splitlines() if 'passed' in l][-1:]}")

    failed = 0
    try:
        for m in MUTATIONS:
            path = ROOT / m["file"]
            src = path.read_text(encoding="utf-8", newline="")
            # ⛔⛔ EOL-DERIVED ANCHORS, NEVER HAND-TYPED ONES. `core.autocrlf=true` on this box,
            # so a checked-out file is CRLF while an anchor written in source is LF. A multi-line
            # anchor then matches ZERO times and the harness reports ANCHOR MISS — which reads
            # almost like a pass unless the harness refuses to score it, which this one does.
            # Measured here on the first run: M1 and M3 both missed for exactly this reason.
            eol = "\r\n" if "\r\n" in src else "\n"
            old = m["old"].replace("\n", eol)
            new = m["new"].replace("\n", eol)
            if old not in src:
                print(f"  {m['name']}: ANCHOR MISS — mutation not applied (NOT a pass)")
                failed += 1
                continue
            if src.count(old) != 1:
                print(f"  {m['name']}: anchor matches {src.count(old)}x — refusing an ambiguous edit")
                failed += 1
                continue
            path.write_text(src.replace(old, new), encoding="utf-8", newline="")
            rc, out = run_tests(m["suite"])
            named_red = m["expect_red"] in out and rc != 0
            print(f"  {m['name']}: {'RED (good)' if named_red else 'GREEN (BAD)'}"
                  f" — expected {m['expect_red']}")
            if not named_red:
                failed += 1
            path.write_bytes(originals[path])
    finally:
        for p, b in originals.items():
            p.write_bytes(b)
        for p, s in shas.items():
            back = sha(p)
            print(f"  restore {p.name} sha256={back} {'verified' if back == s else 'MISMATCH'}")
            if back != s:
                failed += 1

    rc, out = run_tests()
    print(f"  CONTROL AFTER: exit={rc}  {[l for l in out.splitlines() if 'passed' in l][-1:]}")
    if rc != 0:
        failed += 1
    print(f"TOTALS mutation_harness_stall_record {'PASS' if not failed else 'FAIL'} "
          f"declared={len(MUTATIONS)} evaluated={len(MUTATIONS)} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
