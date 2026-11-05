"""The owner's conditions on the three limits, proved with real threads and a real second OS process.

Each process here is `tests/spend_limits_process_worker.py`, started with `subprocess`: separate interpreters, sharing
only the SQLite files, exactly what a limit "across processes" has to survive. Nothing reaches a provider.
"""
from __future__ import annotations

import contextlib
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = ROOT / "tests" / "spend_limits_process_worker.py"
TIMEOUT_S = 90


@pytest.fixture
def world(tmp_path):
    """Two fresh databases, shared by every process started from here and by nothing else."""
    agent_db, catalyst_db = tmp_path / "uct_agent.db", tmp_path / "catalysts.db"
    env = {**os.environ, "UCT_AGENT_DB_PATH": str(agent_db), "CATALYST_DB_PATH": str(catalyst_db),
           "AUTH_DB_PATH": str(tmp_path / "auth.db"), "PYTHONPATH": str(ROOT), "PYTHONIOENCODING": "utf-8"}
    for key in ("UCT_AGENT_INFLIGHT_GLOBAL", "UCT_AGENT_INFLIGHT_PER_MEMBER", "UCT_AGENT_INFLIGHT_LEASE_S",
                "CATALYST_COST_HARD_CAP", "INTERACTIVE_AI_RESERVE_USD", "CATALYST_COST_CAP_DAILY"):
        env.pop(key, None)
    started = []

    class World:
        go, stop, agent, catalyst = str(tmp_path / "go"), str(tmp_path / "stop"), agent_db, catalyst_db

        def start(self, *args):
            p = subprocess.Popen([sys.executable, str(WORKER), *args], env=self.env, cwd=str(tmp_path),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            started.append(p)
            return p

        @staticmethod
        def line(p):
            text = p.stdout.readline()
            assert text, p.stderr.read()[-2000:]
            return json.loads(text)

        def race(self, *processes):
            """Everyone ready, then release them at once."""
            for p in processes:
                assert self.line(p) == {"ready": True}
            pathlib.Path(self.go).write_text("go")

    World.env = env
    subprocess.run([sys.executable, str(WORKER), "init"], env=env, cwd=str(tmp_path), check=True, timeout=TIMEOUT_S)
    yield World()
    pathlib.Path(tmp_path / "stop").write_text("stop")
    for p in started:
        with contextlib.suppress(Exception):
            p.wait(timeout=20)
        if p.poll() is None:
            p.kill()
        p.stdout.close()
        p.stderr.close()


def members(prefix, n):
    return ",".join(f"{prefix}{i}" for i in range(n))


def inflight(world):
    with contextlib.closing(sqlite3.connect(world.agent)) as c:
        return [r[0] for r in c.execute("SELECT user_id FROM agent_inflight")]


# ═══ 20 concurrent turns, globally ═══════════════════════════════════════════════════════════════
def test_GLOBAL_two_processes_admit_exactly_twenty_between_them(world):
    a, b = world.start("admit", world.go, members("a", 16), world.stop), world.start("admit", world.go, members("b", 16), world.stop)
    world.race(a, b)
    ra, rb = world.line(a), world.line(b)
    assert len(ra["got"]) + len(rb["got"]) == 20
    assert set(ra["refused"] + rb["refused"]) == {"global_in_flight"}
    assert len(ra["refused"]) + len(rb["refused"]) == 12
    assert len(inflight(world)) == 20


def test_GLOBAL_fair_one_member_holds_one_place_whichever_process_they_reach(world):
    a, b = world.start("admit", world.go, "same,x1,x2", world.stop), world.start("admit", world.go, "same,y1,y2", world.stop)
    world.race(a, b)
    ra, rb = world.line(a), world.line(b)
    assert inflight(world).count("same") == 1
    assert (ra["refused"] + rb["refused"]) == ["in_flight"]


def test_GLOBAL_one_member_cannot_crowd_out_the_others(world):
    """Many requests from one member take one place, so the other 19 stay open."""
    a = world.start("admit", world.go, ",".join(["heavy"] * 30), world.stop)
    b = world.start("admit", world.go, members("m", 19), world.stop)
    world.race(a, b)
    ra, rb = world.line(a), world.line(b)
    assert len(ra["got"]) == 1 and len(rb["got"]) == 19


def test_GLOBAL_a_killed_process_frees_its_places_with_the_lease(world):
    world.env["UCT_AGENT_INFLIGHT_LEASE_S"] = "1"
    a = world.start("admit", world.go, members("gone", 5), world.stop)
    world.race(a)
    assert len(world.line(a)["got"]) == 5
    a.kill()
    a.wait(timeout=20)
    time.sleep(1.2)
    pathlib.Path(world.go).unlink()
    b = world.start("admit", world.go, members("next", 20), world.stop)
    world.race(b)
    assert len(world.line(b)["got"]) == 20


# ═══ $1 a day per member, on one transaction ═════════════════════════════════════════════════════
def _vision_ledger(world):
    with contextlib.closing(sqlite3.connect(world.catalyst)) as c:
        return c.execute("SELECT COUNT(*), COALESCE(SUM(cost_usd), 0) FROM catalyst_cost_log"
                         " WHERE ticker = 'indicator-vision:racer'").fetchone()


def test_VISION_threads_in_two_processes_hold_one_members_share(world):
    """Eight threads in each process, one member, every call billed: three fit in $1, whoever gets there."""
    a, b = world.start("vision", world.go, "racer", "8"), world.start("vision", world.go, "racer", "8")
    world.race(a, b)
    ra, rb = world.line(a), world.line(b)
    assert ra["calls"] + rb["calls"] == 3
    rows, usd = _vision_ledger(world)
    assert rows == 3 and usd <= 1.0
    assert sum(g == "vision:member-share" for g in ra["gates"] + rb["gates"]) == 13


def test_VISION_a_second_process_sees_what_the_first_already_spent(world):
    a = world.start("vision", world.go, "racer", "2")
    world.race(a)
    assert world.line(a)["calls"] == 2
    pathlib.Path(world.go).unlink()
    b = world.start("vision", world.go, "racer", "4")
    world.race(b)
    assert world.line(b)["calls"] == 1
    assert _vision_ledger(world)[1] <= 1.0
