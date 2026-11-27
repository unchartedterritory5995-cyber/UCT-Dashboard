"""W9 ARMED, EVERY STAGE AT ONCE (owner decision 2026-11-26): the census counts what the armed broker serves.

The owner, verbatim, in chat on 2026-11-26: "we are only admins and have no users so everything can always be live
fully". That is the owner's act of arming the strategy broker (docs/pine/W9-DECISIONS-2026-11-07.md D6: "The act of
arming remains the owner's"), every W2 stage at once.

WHAT WAS ALREADY TRUE IN PRODUCTION (read live 2026-11-26): `Dockerfile.web` declares
`ARG VITE_PINE_STRATEGY_BROKER_ENABLED=1` (since 2026-11-17) and the Railway variable is unset on web and web-front, so
the build bakes the gate ON; PINE_RUNTIME_STAGE=all; PINE_RUNTIME_CAPABILITY_ADMISSION=on; `strategy-decl` admitted.
The product served the strategies whose every exercised broker rule is pinned (strategyServeCensus.test.js).

WHAT STILL SAID "DARK", and this unit changes: the census predicates counted an order-placing strategy as never served
(`coverage_map.runtime_on_transfers`, the coverage ratchet's runtime-on lane, `parity_roadmap.member_model`), and the
scorecard said "Strategy backtests are not served to members yet." Each now reads ONE arming authority, the build's own
(`coverage_map.strategy_broker_armed`: the gate's flag and literal, and Dockerfile.web's ARG default for it).

Rails, each able to fail (mutants: ci/mutants/w9-arm-all.json):
  (a) an order-placing strategy whose census armed verdict transfers is SERVED on the runtime-on lane and by the member
      model (with the server's admission), armed;
  (b) a strategy that exercises an unpinned or unsettled rule (its armed verdict does not transfer) stays REFUSED, by the
      name of that rule (`armed_wall`), on every predicate;
  (c) the RE-DISARM path: the ARG default set to anything but the literal (or the line removed) answers "not armed",
      and every predicate goes back to "a strategy is never served";
  and the host lane (`transfers_fully`) never counts a strategy, armed or not: the broker never runs there.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import coverage_map as CM  # noqa: E402
import coverage_ratchet as R  # noqa: E402
import parity_roadmap as PR  # noqa: E402
import run_census as RC  # noqa: E402

RT = RC.LANE_RUNTIME_ON
PROD = RC.LANE_PRODUCTION
GATE = pathlib.Path(CM.BROKER_GATE)
DOCKERFILE = pathlib.Path(CM.DOCKERFILE_WEB)
FLAG = "VITE_PINE_STRATEGY_BROKER_ENABLED"
STRATEGY = "//@version=5\nstrategy('s')\nif close > open\n    strategy.entry('L', strategy.long)\nplot(close)\n"
UNPINNED_WALL = "run:runtime:strategy-unpinned:B-EXIT-QTY"


def _verdict(transfers, wall=None):
    return {"schema": CM.ARMED_SCHEMA, "transfers": transfers, "wall": wall}


def _row(armed=None, *, clean=False, attached=True, lane="runtime"):
    r = {"attached": attached, "clean": clean, "steps": [{"attached": attached, "lane": lane}]}
    if armed is not None:
        r["strategyArmed"] = armed
    return r


def _disarmed_dockerfile(tmp_path, replacement):
    body = DOCKERFILE.read_text(encoding="utf-8")
    line = "ARG %s=1" % FLAG
    assert body.count(line) == 1, "Dockerfile.web no longer declares `%s` exactly once" % line
    p = tmp_path / "Dockerfile.web"
    p.write_text(body.replace(line, replacement), encoding="utf-8")
    return p


# ── where "armed" is decided: the build, read off its two files ─────────────────────────────────────────────────────

def test_the_committed_build_arms_the_broker():
    assert CM.strategy_broker_armed() is True
    assert "import.meta.env.%s === '1'" % FLAG in GATE.read_text(encoding="utf-8")


@pytest.mark.parametrize("replacement", ["ARG %s=0" % FLAG, "ARG %s=" % FLAG, "ARG %s" % FLAG, "ARG %s=true" % FLAG,
                                         "", "# ARG %s=1" % FLAG])
def test_the_re_disarm_path_is_the_same_line(tmp_path, replacement):
    assert CM.strategy_broker_armed(dockerfile=str(_disarmed_dockerfile(tmp_path, replacement))) is False


def test_arming_fails_closed(tmp_path):
    assert CM.strategy_broker_armed(dockerfile=str(tmp_path / "missing")) is False
    gate = tmp_path / "gate.js"
    gate.write_text("export const strategyBrokerEnabled = () => true\n", encoding="utf-8")
    assert CM.strategy_broker_armed(gate=str(gate)) is False
    # another flag's default does not arm this one
    other = tmp_path / "Dockerfile.web"
    other.write_text("ARG VITE_PINE_RUNTIME_PANE_ENABLED=1\n", encoding="utf-8")
    assert CM.strategy_broker_armed(dockerfile=str(other)) is False


# ── (a) / (b) / (c) the runtime-on predicate (the map's and the ratchet's one authority) ──────────────────────────

def test_a_an_armed_strategy_the_broker_serves_transfers_on_the_runtime_on_lane():
    assert CM.broker_serves(_row(_verdict(True)), True) is True
    assert CM.runtime_on_transfers(_row(_verdict(True)), True, armed=True) is True
    # armed=None reads the committed build (armed)
    assert CM.runtime_on_transfers(_row(_verdict(True)), True) is True


def test_b_a_strategy_on_an_unpinned_rule_stays_refused_by_name():
    row = _row(_verdict(False, UNPINNED_WALL))
    assert CM.runtime_on_transfers(row, True, armed=True) is False
    assert CM.armed_wall(row) == UNPINNED_WALL
    # an old census row (no verdict), a malformed or older verdict, and a threw are never read as served
    for r in (_row(), _row({"threw": "x"}), _row({**_verdict(True), "schema": "uct.strategy-armed/v0"}),
              _row({**_verdict("yes")})):
        assert CM.runtime_on_transfers(r, True, armed=True) is False, r


def test_b_the_kill_list_stops_an_armed_strategy():
    assert CM.runtime_on_transfers(_row(_verdict(True)), True, killed=True, armed=True) is False


def test_c_disarmed_no_strategy_transfers(tmp_path):
    assert CM.runtime_on_transfers(_row(_verdict(True)), True, armed=False) is False
    assert CM.broker_serves(_row(_verdict(True)), False) is False


def test_an_indicator_is_unchanged_by_arming():
    for armed in (True, False):
        assert CM.runtime_on_transfers(_row(clean=True, lane="host"), False, armed=armed) is True
        assert CM.runtime_on_transfers(_row(clean=False, attached=False, lane=None), False, armed=armed) is False


def test_the_host_lane_never_counts_a_strategy_armed_or_not():
    u = CM.order_usage_of(STRATEGY)
    assert CM.places_orders(u)
    assert CM.transfers_fully({**_row(_verdict(True)), "clean": True}, u) is False


# ── the coverage ratchet (committed corpus, CI) ──────────────────────────────────────────────────────────────────────

def test_the_ratchet_counts_an_armed_strategy_on_runtime_on_and_names_a_refused_one(monkeypatch):
    monkeypatch.setattr(R, "_killed", lambda: set())
    assert R.transfers(RT, _row(_verdict(True)), STRATEGY) is True
    assert R.transfers(PROD, {**_row(_verdict(True)), "clean": True}, STRATEGY) is False
    refused = _row(_verdict(False, UNPINNED_WALL))
    assert R.transfers(RT, refused, STRATEGY) is False
    assert R.wall_of(RT, refused, STRATEGY) == "a strategy the armed broker does not serve: %s" % UNPINNED_WALL
    assert R.wall_of(PROD, refused, STRATEGY).startswith("a strategy that places orders (strategy.entry")
    killed_src = {CM.hashlib.sha256(STRATEGY.encode("utf-8")).hexdigest()}
    monkeypatch.setattr(R, "_killed", lambda: killed_src)
    assert R.transfers(RT, _row(_verdict(True)), STRATEGY) is False
    assert R.wall_of(RT, _row(_verdict(True)), STRATEGY).startswith("on the runtime kill list")


def test_the_ratchet_disarmed_counts_no_strategy(monkeypatch):
    monkeypatch.setattr(R, "_killed", lambda: set())
    monkeypatch.setattr(CM, "strategy_broker_armed", lambda *a, **k: False)
    assert R.transfers(RT, _row(_verdict(True)), STRATEGY) is False
    assert R.wall_of(RT, _row(_verdict(True)), STRATEGY).startswith("a strategy that places orders")


# ── the member model (the served headline: docs/pine/parity-roadmap*.json, the full census) ─────────────────────────

def _map(scripts, added):
    return {"scripts": scripts, "runtimeOn": {"walls": {"byScript": {}}, "added": sorted(added), "lost": []}}


def _script(key, *, orders=True, armed=None):
    return {"key": key, "clean": False, "placesOrders": orders, "wouldTransferIfArmed": armed, "walls": []}


def _facts(status, missing=()):
    return {"admission": {"status": status, "missing": list(missing), "historyOnly": False}, "rtAttached": False}


def test_a_the_member_model_serves_an_armed_strategy_the_server_admits():
    m = _map([_script("s:served", armed=True)], {"s:served"})
    served, walls, _e, _m = PR.member_model(m, {"s:served": _facts("capability")})
    assert served == {"s:served"} and walls == {}


def test_b_the_member_model_refuses_every_other_strategy_by_name():
    m = _map([_script("s:refused", armed=False), _script("s:not-admitted", armed=True), _script("s:killed", armed=True),
              _script("s:old-facts", armed=True), _script("s:map-disagrees", armed=False)],
             {"s:not-admitted", "s:killed", "s:old-facts", "s:map-disagrees"})
    facts = {"s:refused": {"admission": None}, "s:not-admitted": _facts("not-admitted", ["enum"]),
             "s:killed": _facts("killed"), "s:old-facts": {"admission": None}, "s:map-disagrees": _facts("capability")}
    served, walls, _e, _m = PR.member_model(m, facts)
    assert served == set()
    assert walls["s:refused"] == [PR.WALL_STRATEGY]
    assert walls["s:not-admitted"] == [PR.ADMISSION + "enum"]
    assert walls["s:killed"] == [PR.WALL_KILLED]
    assert walls["s:old-facts"] == ["facts:missing"]
    assert PR.WALL_STRATEGY in walls["s:map-disagrees"]


def test_c_the_member_model_disarmed_serves_no_strategy():
    # a map built disarmed puts no strategy in `added` (runtime_on_transfers with armed False): the strategy wall stands
    m = _map([_script("s:x", armed=True)], set())
    served, walls, _e, _m = PR.member_model(m, {"s:x": _facts("capability")})
    assert served == set() and walls["s:x"] == [PR.WALL_STRATEGY]


def test_an_indicator_in_the_member_model_is_unchanged():
    m = _map([_script("i:x", orders=False)], {"i:x"})
    assert PR.member_model(m, {"i:x": _facts("capability")})[0] == {"i:x"}
