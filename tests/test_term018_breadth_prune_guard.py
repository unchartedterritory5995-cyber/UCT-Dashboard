"""TERM-018 observation: the Breadth V2 producer's archive-before-prune ALARM
(`api/services/breadth_v2_producer.py::_alarm::breadth_v2_prune_guard::<computed>`).

The guard decides the SEVERITY a blocked prune reaches the operator alert sink with: an archive INTEGRITY
failure (a malformed / mismatched ack, a corrupt archive, a producer copy that differs) PAGES as `critical`;
an archive that simply has not caught up yet (`ACK_MISSING`) is a `warning` — disk grows, nothing is lost.
These tests drive the real `_prune_vintages` → `_alarm` → `chart_health_alerts.emit` path with a temp producer
root and a temp archive; only the sink's transport is captured.
"""
from __future__ import annotations

import json
import os
import stat
import sys

import pytest

from api.services import breadth_v2_producer as prod
from api.services import chart_health_alerts as cha

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "breadth_exch"))
import live_core as lc  # noqa: E402

TAGS = ["p202610010000", "p202610020000", "p202610030000", "p202610040000"]


@pytest.fixture
def emitted(tmp_path, monkeypatch):
    root, arch = str(tmp_path / "producer"), str(tmp_path / "archive")
    monkeypatch.setattr(prod, "ROOT", root)
    monkeypatch.setattr(prod, "EXCH_ARCHIVE_DIR", arch)
    for t in TAGS:
        vd = os.path.join(root, "vintages", t)
        for sub in ("inputs_", "grouped_"):
            os.makedirs(os.path.join(vd, sub + t))
        open(os.path.join(vd, "inputs_" + t, "INPUT_MANIFEST.json"), "w").write(t)
        open(os.path.join(vd, "grouped_" + t, "x_0.json"), "w").write("[0]")
        with prod._state() as c:
            c.execute("INSERT INTO vintage VALUES(?,?,?,?,?,?,?,?)", (t, "", "", "", "", t[1:], "ready", "{}"))
    out = []
    monkeypatch.setattr(cha, "emit", lambda key, severity, message, metadata=None: out.append(
        {"key": key, "severity": severity, "message": message}) or True)
    return {"out": out, "root": root, "arch": arch}


def _archive_oldest(e):
    lc.archive_vintages(os.path.join(e["root"], "vintages"), [TAGS[0]], e["arch"], code_commit="t")


def test_an_archive_integrity_failure_pages_critical(emitted):
    _archive_oldest(emitted)
    p = os.path.join(emitted["arch"], TAGS[0] + ".ARCHIVED.json")
    os.chmod(p, stat.S_IWUSR | stat.S_IRUSR)
    open(p, "w").write("{not json")                                       # malformed ack: integrity
    out = prod._prune_vintages()
    assert out["blocked"] == {TAGS[0]: "ACK_MALFORMED"}
    assert [(a["key"], a["severity"]) for a in emitted["out"]] == [("breadth_v2_prune_guard", "critical")]


def test_an_archive_that_has_not_caught_up_only_warns(emitted):
    out = prod._prune_vintages()                                         # nothing archived yet
    assert out["blocked"] == {TAGS[0]: "ACK_MISSING"}
    assert [(a["key"], a["severity"]) for a in emitted["out"]] == [("breadth_v2_prune_guard", "warning")]
    assert os.path.isdir(os.path.join(emitted["root"], "vintages", TAGS[0]))


def test_a_corrupt_archive_pages_critical_and_names_the_vintage(emitted):
    _archive_oldest(emitted)
    f = os.path.join(emitted["arch"], TAGS[0], "grouped_" + TAGS[0], "x_0.json")
    os.chmod(f, stat.S_IWUSR | stat.S_IRUSR)
    open(f, "w").write("rot")
    out = prod._prune_vintages()
    assert out["blocked"] == {TAGS[0]: "ARCHIVE_FILE_CORRUPT"}
    assert emitted["out"][-1]["severity"] == "critical" and TAGS[0] in emitted["out"][-1]["message"]


def test_a_verified_archive_prunes_and_raises_nothing(emitted):
    _archive_oldest(emitted)
    assert prod._prune_vintages() == {"pruned": [TAGS[0]], "blocked": {}}
    assert emitted["out"] == [] and json.load(open(os.path.join(emitted["arch"], TAGS[0] + ".ARCHIVED.json")))
