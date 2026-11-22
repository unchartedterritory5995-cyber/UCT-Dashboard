"""Arming the strategy broker for members: the build default, the override, and what it reaches.

Owner ruling 2026-11-17 (delegated to the coordinator): serve the Strategy Tester report for a Pine strategy only where
the pin ledger (``brokerPins.resolved.json``) witnesses every broker rule its backtest rests on; every other strategy is
refused by name. The readiness audit and the census are
``docs/pine/evidence/2026-11-17-serve-witnessed-strategies/EVIDENCE.md``.

HOW THE GATE IS ARMED. The gate reads ``import.meta.env.VITE_PINE_STRATEGY_BROKER_ENABLED === '1'``
(``app/src/components/chart/engine/strategyBrokerGate.js``), a BUILD constant. ``Dockerfile.web`` now declares that ARG
with the default ``1``: a production build whose Railway variable is UNSET bakes the gate ON; a Railway variable that is
set (``0`` to hold it) is passed as the build arg and wins. Local and test builds have no Docker ARG, so the suites keep
the gate's dark default and stub it on by name.

WHAT IT REACHES. The broker runs only on the per-bar runtime lane, which needs the member's runtime stage
(``PINE_RUNTIME_STAGE``, admins today) and the lane's admission (kill list, allowlist, capability admission). The server
admits a strategy by capability when every capability it uses has a conformant registry row: ``strategy-decl`` since
2026-11-18, and ``request-other`` (closed-bar history) since 2026-11-19 (#2016), so 22 of the 25 committed strategies
are admitted and the other 3 are withheld by name by a capability with no row. Admission is a door, not a pin: an
admitted strategy's backtest is served only where every broker rule it rests on is pinned, and is refused by name
otherwise; a killed source (the kill list, by source hash) falls back off the runtime lane whatever its admission, so
its backtest is refused by name (the kill named). The JS census
(``strategyServeCensus.test.js``) latches the server's verdict per committed strategy (``SERVER_ADMITS``) for its
production state; the last two rails here hold that list to the server, both ways, so a registry change that moves a
verdict turns this file red BY NAME and the census is re-measured.

WHICH BUNDLE. Members load the bundle ``web-front`` builds and serves (``front/README.md``), not ``web``'s. Both build
``Dockerfile.web`` (``front/service.json``, ``railway.web.json``), each from its OWN Railway variables, so the default
reaches the members' bundle only while the variable is ABSENT on web-front (an empty value, or a reference to a variable
``web`` does not have, bakes it OFF there).

Mutation proofs (run by hand, each restored from a saved copy; recorded in the EVIDENCE file):
    1. drop the ``=1`` from the Dockerfile ARG                        -> default / production-shaped RED
    1b. point ``front/service.json`` at another Dockerfile            -> members' bundle RED
    2. give another VITE_* ARG a default                              -> only-one-default RED
    3. set the ledger row's status to "dark"                          -> ledger RED
    4. stop the capability detector naming ``strategy-decl``           -> server-admits-exactly-the-census-list RED
    (2026-11-19, the census re-latch after #2016; recorded in the PR)
    5. drop one of the five request-other admits from ``SERVER_ADMITS`` -> server-admits-exactly-the-census-list RED
    6. a CONTROL the server admits (pmax-explorer, the old control)    -> CONTROL RED
    6b. give ``enum`` a (non-admitted) registry row                   -> CONTROL RED (the no-row check)
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DOCKERFILE = ROOT / "Dockerfile.web"
GATE = ROOT / "app" / "src" / "components" / "chart" / "engine" / "strategyBrokerGate.js"
LEDGER = ROOT / "docs" / "feature_flags.json"
CORPUS = ROOT / "corpus" / "committed"
#: the member door's own predicate (`memberPaneDefinition.js::STRATEGY_DECLARATION`), the call form opening a line
STRATEGY_DECLARATION = re.compile(r"^[ \t]*strategy[ \t]*\(", re.M)
_ARG = re.compile(r"^ARG\s+(VITE_[A-Z0-9_]+)(?:=(\S*))?\s*$", re.M)


def _gate():
    """(flag name, the literal the gate compares to), read off the gate module, never typed."""
    src = GATE.read_text(encoding="utf-8")
    m = re.search(r"import\.meta\.env\.(VITE_[A-Z0-9_]+)\s*===\s*'([^']*)'", src)
    assert m, "strategyBrokerGate.js no longer reads `import.meta.env.<FLAG> === '<v>'`"
    return m.group(1), m.group(2)


def _args():
    """{name: default or None} for every VITE_* build ARG in Dockerfile.web."""
    return {n: (d or None) for n, d in _ARG.findall(DOCKERFILE.read_text(encoding="utf-8"))}


def _baked(railway: str | None) -> str:
    """The value a production build of Dockerfile.web bakes for the broker flag: Railway passes a SET variable as the
    build arg, which wins; an unset one leaves the ARG's default; the ENV mirror then exports it to `npm run build`
    (an unpassed ARG with no default exports "")."""
    name, _ = _gate()
    body = DOCKERFILE.read_text(encoding="utf-8")
    assert f"{name}=${name}" in body, "the ENV mirror no longer exports the broker flag to the build"
    default = _args().get(name)
    if railway is not None:
        return railway
    return default if default is not None else ""


def test_the_broker_gate_defaults_on_in_the_production_build():
    name, on = _gate()
    assert name == "VITE_PINE_STRATEGY_BROKER_ENABLED"
    assert _args().get(name) == on, (
        f"Dockerfile.web must declare `ARG {name}={on}`: the owner ruling of 2026-11-17 arms the strategy broker by "
        "its build default, with Railway's variable as the override")


@pytest.mark.parametrize("railway, expect_on", [
    (None, True),      # the variable unset on web: the ARG default bakes the gate ON
    ("1", True),
    ("0", False),      # the hold: any value other than the literal turns it OFF
    ("", False),
    ("true", False),
])
def test_a_production_shaped_build_bakes_the_gate(railway, expect_on):
    _, on = _gate()
    assert (_baked(railway) == on) is expect_on, (railway, _baked(railway))


#: The services whose image carries the BUILT frontend, by their config-as-code file. `web-front` (front/README.md) is
#: the one members load: it serves `/assets` and the app shell; `web` keeps its own copy of the build.
FRONTEND_SERVICES = {"web": ROOT / "railway.web.json", "web-front": ROOT / "front" / "service.json"}


@pytest.mark.parametrize("service", sorted(FRONTEND_SERVICES))
def test_every_service_that_builds_the_members_bundle_builds_this_dockerfile(service):
    """The default reaches the bundle members load only because BOTH frontend services build `Dockerfile.web`, and a
    change to it rebuilds both. (Measured 2026-11-17 by the Studio session: a VITE_* set on `web` alone changed nothing
    members load; `web-front` builds and serves its own bundle.)"""
    cfg = json.loads(FRONTEND_SERVICES[service].read_text(encoding="utf-8"))
    build = cfg.get("build") or {}
    assert build.get("builder") == "DOCKERFILE" and build.get("dockerfilePath") == DOCKERFILE.name, (
        f"{service} no longer builds {DOCKERFILE.name}: the strategy broker's default does not reach its bundle")
    watch = build.get("watchPatterns")
    assert watch is None or DOCKERFILE.name in watch, (
        f"{service} does not rebuild when {DOCKERFILE.name} changes, so the default would not reach its bundle")


def test_no_other_config_builds_the_frontend_from_this_dockerfile():
    """A third service building `Dockerfile.web` would bake the default too: it must be named above, on purpose."""
    found = set()
    for p in list(ROOT.glob("railway*.json")) + list(ROOT.glob("*/service.json")) + list(ROOT.glob("services/*/railway.json")):
        cfg = json.loads(p.read_text(encoding="utf-8"))
        if ((cfg.get("build") or {}).get("dockerfilePath")) == DOCKERFILE.name:
            found.add(p.resolve())
    assert found == {p.resolve() for p in FRONTEND_SERVICES.values()}, sorted(str(p) for p in found)


@pytest.mark.parametrize("service", sorted(FRONTEND_SERVICES))
@pytest.mark.parametrize("railway, expect_on", [
    (None, True),   # absent on the service: the ARG default
    ("", False),    # PRESENT but empty, e.g. web-front's `${{web.VITE_...}}` reference to a variable web does not have
    ("0", False),   # the hold
    ("1", True),
])
def test_each_frontend_service_bakes_the_gate_from_its_own_variable(service, railway, expect_on):
    """Each service passes its OWN variable as the build arg (web-front keeps its own copies or references), so the
    gate is ON in the members' bundle only when the variable is absent on web-front, or the literal 1 there."""
    _, on = _gate()
    assert (_baked(railway) == on) is expect_on, (service, railway)


def test_only_the_strategy_broker_arg_carries_a_default():
    """A default arms a flag without a Railway step. Only the ruled one may have one: any other default would arm a
    feature nobody ruled on, silently, at the next build."""
    name, _ = _gate()
    with_default = sorted(n for n, d in _args().items() if d is not None)
    assert with_default == [name], with_default


def test_the_ledger_row_records_the_ruling():
    name, on = _gate()
    row = json.loads(LEDGER.read_text(encoding="utf-8"))["build_flags"][name]
    assert row["status"] == "armed", "the Dockerfile default arms the flag; the ledger must say so"
    assert sorted(row["where"]) == sorted(FRONTEND_SERVICES), "both services that build the bundle carry the variable"
    assert "2026-11-17" in row["owner_decision"]
    assert f"ARG {name}={on}" in row["note"], "the ledger names the mechanism that arms it"
    assert "0" in row["note"] and "override" in row["note"]


def _committed_strategies():
    out = []
    for p in sorted(CORPUS.glob("*.pine")):
        with open(p, encoding="utf-8", newline="") as fh:
            src = fh.read()
        if STRATEGY_DECLARATION.search(src):
            out.append((p.stem, src))
    return out


CENSUS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtime" / "__tests__" / "strategyServeCensus.test.js"


def _census_server_admits() -> list:
    """`SERVER_ADMITS` as the census rail latches it, PARSED from that file (one list, never a copy here)."""
    src = CENSUS.read_text(encoding="utf-8")
    m = re.search(r"const SERVER_ADMITS = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert m, "strategyServeCensus.test.js no longer declares `const SERVER_ADMITS = Object.freeze([...])`"
    return re.findall(r"'([^']+)'", m.group(1))


def _server_verdicts(monkeypatch) -> dict:
    monkeypatch.setenv("PINE_RUNTIME_CAPABILITY_ADMISSION", "on")
    from api.services import runtime_definitions as rd
    out = {}
    for key, src in _committed_strategies():
        ok, missing = rd.capability_admitted(src, persist=False, wait=120.0)
        assert "pending" not in missing, f"{key}: the detector did not answer"
        out[key] = (ok, missing)
    return out


# ⚰️ `test_the_server_admits_no_strategy_today` (until 2026-11-18): `strategy-decl` had no registry row, so the server
# admitted none of the 25 and the census latched "not admitted" for each. `strategy-decl` is admitted on Q-SD1 / Q-SD2
# (supertrend-strategy, community) and W9-Q-S1p, all MATCH runtime-on (api/data/pine_runtime_allowlist.json).
def test_the_server_admits_exactly_the_census_list(monkeypatch):
    """The production state of `strategyServeCensus.test.js` latches the server's verdict per committed strategy from
    its `SERVER_ADMITS`. This holds that list to the server's own verdict (capability admission ON), BOTH ways, so a
    registry change cannot move what members are served past the census: a moved verdict re-measures the census
    (`strategyServeAudit.measure.test.js`) and moves both."""
    verdicts = _server_verdicts(monkeypatch)
    assert len(verdicts) == 25, len(verdicts)
    admitted = sorted(k for k, (ok, _) in verdicts.items() if ok)
    assert admitted == sorted(_census_server_admits()), "the server's admitted strategies are not the census's list"
    # every withheld one is withheld by a capability with no conformant row, never by `strategy-decl`
    for key, (ok, missing) in verdicts.items():
        assert ok or missing, f"{key}: withheld with no reason"
        assert "strategy-decl" not in missing, f"{key}: `strategy-decl` withholds it"


def test_CONTROL_admission_is_a_door_not_a_pin(monkeypatch):
    """CONTROL. Admission is a door, not a pin: the server admits a strategy whose backtest rests on a broker rule no
    MATCHing capture pins (B-EXIT-QTY is absent from `brokerPins.resolved.json`), and the census holds that the member
    is refused by name at its report (`runtime:strategy-unpinned`). Here: such a strategy IS admitted (so the census
    control is reached), and B-EXIT-QTY is indeed unpinned.
    ⚰️ Until 2026-11-19 (the strategy unit) the control was B-EXIT-NA on macd-shortlong and stop-loss-and-take-profit:
    the community capture macd-shortlong-strategy-is-rddt-1d-2026-11-18 now pins it (MATCH), and both are served."""
    verdicts = _server_verdicts(monkeypatch)
    pins = json.loads((ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtime" / "brokerPins.resolved.json")
                      .read_text(encoding="utf-8"))["rules"]
    assert "B-EXIT-QTY" not in pins
    assert "B-EXIT-NA" in pins
    for key in ("tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy",):
        assert verdicts[key][0] is True, f"{key}: {verdicts[key][1]}"
        assert key in _census_server_admits()
    # and the same detector withholds a strategy BY NAME for capabilities that have NO registry row (`enum`; a library
    # version; and `import`, which is never a row of its own: it is met by its libraries). ⚰️ This was pmax-explorer,
    # withheld by `request-other` alone, until 2026-11-19: #2016 admitted `request-other` (closed-bar history), so the
    # server admits pmax-explorer by capability, and the kill list (by source hash, DRAW-1 rule) keeps it off the runtime
    # lane: the host lane draws it and its backtest is refused by name (the census's REQUEST_OTHER_ADMITS).
    key, missing = ("trailing-take-profit-trailing-stop-loss__41jwaH1ikz",
                    ["enum", "import", "library:jason5480/chrono_utils/7"])
    assert verdicts[key] == (False, missing), verdicts[key]
    assert key not in _census_server_admits()
    registry = json.loads((ROOT / "api" / "data" / "pine_runtime_allowlist.json").read_text(encoding="utf-8"))
    assert not set(missing) & set(registry["capabilities"]), "a control capability now has a registry row"
