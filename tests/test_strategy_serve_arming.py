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
(``PINE_RUNTIME_STAGE``, admins today) and the lane's admission (kill list, allowlist, capability admission). Today the
server admits NO strategy: ``strategy-decl`` has no row in the capability registry, so every strategy declines
``runtime:not-yet-graded`` and is drawn as before with its backtest refused by name. The JS census
(``strategyServeCensus.test.js``) latches exactly that verdict for its production state; the last rail here holds the
verdict to the server, so the day ``strategy-decl`` is admitted this file goes red BY NAME and the census is re-measured.

Mutation proofs (run by hand, each restored from a saved copy; recorded in the EVIDENCE file):
    1. drop the ``=1`` from the Dockerfile ARG                        -> default / production-shaped RED
    2. give another VITE_* ARG a default                              -> only-one-default RED
    3. set the ledger row's status to "dark"                          -> ledger RED
    4. stop the capability detector naming ``strategy-decl``           -> server-admits-no-strategy RED
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


def test_the_server_admits_no_strategy_today(monkeypatch):
    """The production state of `strategyServeCensus.test.js` latches "not admitted" for every committed strategy. This
    holds that to the server's own verdict (capability admission ON), so admitting `strategy-decl` cannot slip past it:
    when it is admitted, re-measure the census (`strategyServeAudit.measure.test.js`) and move both."""
    monkeypatch.setenv("PINE_RUNTIME_CAPABILITY_ADMISSION", "on")
    from api.services import runtime_definitions as rd
    scripts = _committed_strategies()
    assert len(scripts) == 25, len(scripts)
    admitted, missing_decl = [], []
    for key, src in scripts:
        ok, missing = rd.capability_admitted(src, persist=False, wait=120.0)
        assert "pending" not in missing, f"{key}: the detector did not answer"
        if ok:
            admitted.append(key)
        if "strategy-decl" not in missing:
            missing_decl.append(key)
    assert admitted == [], f"the server now admits strategies {admitted}: re-measure the serve census"
    assert missing_decl == [], f"`strategy-decl` is no longer what withholds {missing_decl}"
