"""The capacity replay on a GitHub runner (a MEASUREMENT, not a rail): #2962's real Linux topology, `uvicorn workers=N`
on one socket, against a SYNTHETIC store (`tools/capacity_replay/synth_store.py`: the real schema and row shapes,
random-walk prices, no production or vendor data), driven by the 500-member model (`replay_members.py`).

Run it:  python tools/remote_tests.py --pytest tests/test_capacity_replay_ci.py --env CAPACITY_REPLAY=1 --download out
It is skipped everywhere else (it takes ~15-25 min and the whole runner). Results land in remote-out/capacity/:
summary.json (per case: process count, members, offered / OK req/s, p50 / p95 / p99, sheds, timeouts, the share of
requests the leader answered for a follower, roles, RSS per process) and the raw per-case JSON.

⛔ WHAT ONE RUNNER CANNOT SHOW. The load generator and every bars-api process share one machine, so the ceiling it
finds is the RUNNER's, split between them; it measures the per-process SLOPE (1 -> 2 -> 4 processes) and the leader's
hand-off share, not a 500-member peak (~1,500 req/s edge-first). A second runner as the load generator is not
possible in this lane: it is one job, and GitHub-hosted runners accept no inbound connection from another job.
The synthetic store is ~1 GB (production 3-20 GB), so the OS page cache is warmer than production's.
"""
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools", "capacity_replay"))
import ci_replay  # noqa: E402

pytestmark = pytest.mark.skipif(not ci_replay.enabled(), reason="a measurement: CAPACITY_REPLAY=1 on a Linux runner only")


@pytest.mark.timeout(2400)       # the suite default (300 s) is for rails; this is a ~20 min measurement
def test_the_capacity_replay_on_this_runner(tmp_path):
    summary = ci_replay.run(tmp_path)
    assert any(c.get("ok_rps") for c in summary["cases"]), "no case answered anything: read the server logs"
