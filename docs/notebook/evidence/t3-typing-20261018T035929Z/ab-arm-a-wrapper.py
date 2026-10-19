"""P2 T3 Task 10 A/B control: the SAME harness on the SAME tree, `--with-blocks` seeding every block
EXCEPT the mood check-in. Arm A (this) against arm B (the harness as committed, every block) isolates
what the one Tier 3 block adds to typing. Nothing else differs."""
import sys

sys.path.insert(0, r"C:\Users\Patrick\uct-worktrees\notebook-t3\tools")
sys.path.insert(0, r"C:\Users\Patrick\uct-worktrees\notebook-t3\scripts")
import notebook_perf_harness as h  # noqa: E402

before = tuple(h.TRADER_BLOCK_KINDS)
h.TRADER_BLOCK_KINDS = tuple(k for k in before if k != "moodCheckIn")
assert "moodCheckIn" in before and len(h.TRADER_BLOCK_KINDS) == len(before) - 1, (before, h.TRADER_BLOCK_KINDS)
print(f"A/B arm A: seeding {len(h.TRADER_BLOCK_KINDS)} nodes (no moodCheckIn): {list(h.TRADER_BLOCK_KINDS)}", flush=True)
sys.exit(h.main(sys.argv[1:]))
