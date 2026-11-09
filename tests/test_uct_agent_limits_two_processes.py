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
    world.env["SPEND_TEST_RENEW_S"] = "0.1"                # the lease is never shorter than two renewals
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


# ═══ one web replica: the supported scope, docs/agent/budget/SINGLE-REPLICA-SCOPE.md ═════════════
#: Flip this only when these limits really live on a store instances share. It protects the $1-a-day vision member
#: ceiling and the 20 global in-flight turns: both count in SQLite on web's own volume, so a second instance on its
#: own volume would count separately and each limit would silently double.
SHARED_STORE_EXISTS = False


def replica_total(config):
    """What a Railway config asks for: every region's replicas added up, else `numReplicas`, else Railway's 1."""
    deploy = config.get("deploy") or {}
    regions = deploy.get("multiRegionConfig") or {}
    if regions:
        return sum(int((r or {}).get("numReplicas") or 0) for r in regions.values())
    return int(deploy.get("numReplicas") or 1)


@pytest.mark.parametrize("config,total", [
    ({}, 1), ({"deploy": {"numReplicas": 3}}, 3),
    ({"deploy": {"numReplicas": 1, "multiRegionConfig": {"us-west2": {"numReplicas": 1}, "us-east4": {"numReplicas": 1}}}}, 2),
], ids=["default", "plain", "two-regions-of-one"])
def test_REPLICAS_regions_are_added_up(config, total):
    """One replica in each of two regions is two instances, however small each figure looks."""
    assert replica_total(config) == total


def test_REPLICAS_web_pins_one_replica_until_a_shared_store_exists():
    """The SOURCE check. ⛔ Not the effective one: see test_REPLICAS_separate_volumes_are_invisible below."""
    web = json.loads((ROOT / "railway.web.json").read_text("utf-8"))
    assert SHARED_STORE_EXISTS or (web["deploy"]["numReplicas"] == 1 and replica_total(web) == 1)
    assert SHARED_STORE_EXISTS or replica_total(json.loads((ROOT / "railway.json").read_text("utf-8"))) <= 1


@pytest.fixture
def replicas(clean_limits, monkeypatch):
    def be(replica, deployment="d1"):
        monkeypatch.setenv("RAILWAY_DEPLOYMENT_ID", deployment)
        monkeypatch.setenv("RAILWAY_REPLICA_ID", replica)
    return be


@pytest.fixture
def clean_limits(tmp_path, monkeypatch):
    from api.services.uct_agent import limits, store
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "replicas.db"))
    monkeypatch.setattr(store, "_READY", False)
    monkeypatch.setattr(limits, "_READY_FOR", None)
    return limits


def test_REPLICAS_a_second_replica_on_this_store_stops_paid_turns_on_both_and_alerts(replicas, clean_limits, monkeypatch):
    limits, alerts = clean_limits, []
    monkeypatch.setattr(limits, "_alert_replicas", alerts.append)
    replicas("r1")
    assert limits.admit("a", new_request=False)
    replicas("r2")
    with pytest.raises(limits.Refused) as e:
        limits.admit("b", new_request=False)
    assert e.value.reason == "multiple_replicas" and e.value.sentence == limits.UNAVAILABLE
    replicas("r1")
    with pytest.raises(limits.Refused):
        limits.admit("c", new_request=False)
    assert alerts == [2, 2]


def test_REPLICAS_a_redeploy_is_not_two_replicas(replicas, clean_limits):
    """A new deployment brings a new replica id. Counting across deployments would refuse turns after every deploy."""
    replicas("old", "d1")
    assert clean_limits.admit("a", new_request=False)
    replicas("new", "d2")
    assert clean_limits.admit("b", new_request=False)


def test_REPLICAS_a_crash_restart_with_a_new_id_does_not_stop_paid_turns(replicas, clean_limits, monkeypatch):
    """The dead replica's row is seconds old. It predates this process, so it cannot be running beside it."""
    limits = clean_limits
    monkeypatch.setattr(limits, "_STARTED_AT", 0.0)
    replicas("died")
    assert limits.admit("a", new_request=False, now=1000.0)
    monkeypatch.setattr(limits, "_STARTED_AT", 1010.0)     # the restart
    replicas("restarted")
    assert limits.admit("b", new_request=False, now=1020.0)


def test_REPLICAS_a_live_replica_beside_a_restarted_one_is_still_caught(replicas, clean_limits, monkeypatch):
    limits, alerts = clean_limits, []
    monkeypatch.setattr(limits, "_alert_replicas", alerts.append)
    monkeypatch.setattr(limits, "_STARTED_AT", 1010.0)
    replicas("restarted")
    assert limits.admit("a", new_request=False, now=1020.0)
    replicas("still-alive")                                # admits after the restart, so its row is new
    with pytest.raises(limits.Refused) as e:
        limits.admit("b", new_request=False, now=1030.0)
    assert e.value.reason == "multiple_replicas" and alerts == [2]


def test_REPLICAS_a_replica_that_has_gone_stops_counting(replicas, clean_limits):
    limits = clean_limits
    replicas("r1")
    assert limits.admit("a", new_request=False, now=1000.0)
    replicas("r2")
    assert limits.admit("b", new_request=False, now=1000.0 + limits.REPLICA_WINDOW_S + 1)


def test_REPLICAS_outside_railway_there_is_nothing_to_count(clean_limits, monkeypatch):
    monkeypatch.delenv("RAILWAY_REPLICA_ID", raising=False)
    assert clean_limits.admit("a", new_request=False)


def test_REPLICAS_separate_volumes_are_invisible_to_this_check(replicas, clean_limits, tmp_path, monkeypatch):
    """⛔ THE BLIND SPOT, PINNED. Replicas on separate volumes each see one, so both keep taking turns. If this test
    ever fails, the check got better: until then it must not be described as seeing every replica."""
    from api.services.uct_agent import store
    limits = clean_limits
    replicas("r1")
    assert limits.admit("a", new_request=False)
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "another_volume.db"))
    monkeypatch.setattr(store, "_READY", False)
    monkeypatch.setattr(limits, "_READY_FOR", None)
    replicas("r2")
    assert limits.admit("b", new_request=False)            # admitted: it cannot see r1
