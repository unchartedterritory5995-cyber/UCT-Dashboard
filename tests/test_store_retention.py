"""Arch 5-B.8: the store retention registry, and disk_watchdog's view of it."""
from __future__ import annotations

import importlib
import os

import pytest

from api.services import store_backup, store_retention as sr


def test_every_backed_up_store_has_a_retention_entry():
    missing = sorted(s.name for s in store_backup.STORES if sr.get(s.name) is None)
    assert not missing, f"stores with a backup but no retention rule: {missing}"


def test_member_classification_agrees_with_store_backup():
    for s in store_backup.STORES:
        assert sr.get(s.name).member_data == (s.klass == store_backup.CLASS_MEMBER), s.name


@pytest.mark.parametrize("entry", [r for r in sr.REGISTRY if r.path], ids=lambda r: r.name)
def test_the_declared_file_is_the_one_the_owning_module_opens(entry):
    mod, _, attr = entry.path.partition(":")
    val = getattr(importlib.import_module(mod), attr)
    val = val() if callable(val) else val
    assert os.path.basename(str(val)) == entry.file


@pytest.mark.parametrize("entry", [r for r in sr.REGISTRY if r.prunes], ids=lambda r: r.name)
def test_every_declared_sweep_exists(entry):
    assert entry.sweeps, f"{entry.name} declares pruned tables but names no sweep"
    for spec in entry.sweeps:
        assert callable(sr.resolve_sweep(spec)), spec


def test_names_and_files_are_unique():
    assert len({r.name for r in sr.REGISTRY}) == len(sr.REGISTRY)
    assert len({r.file for r in sr.REGISTRY}) == len(sr.REGISTRY)


def test_the_guard_fails_closed():
    assert sr.may_prune("workspace_docs", "artifact_versions") is True
    assert sr.may_prune("workspace_docs", "workspace_docs") is False, "an undeclared table"
    assert sr.may_prune("community", "posts") is False, "a never-swept member store"
    assert sr.may_prune("no_such_store", "t") is False


def test_annotation_reads_undeclared_for_an_unknown_consumer():
    assert sr.annotate("mystery_dir") == "retention: UNDECLARED"
    assert sr.annotate("workspace_docs.db") == "retention: member, swept"
    assert sr.annotate("community.db") == "retention: member, never swept"


def test_disk_watchdog_shows_the_registry_beside_each_consumer(tmp_path, monkeypatch):
    from api.services import disk_watchdog as dw
    (tmp_path / "tweets.db").write_bytes(b"x" * 4096)
    (tmp_path / "mystery").mkdir()
    (tmp_path / "mystery" / "f").write_bytes(b"y" * 2048)
    monkeypatch.setattr(dw, "DATA_DIR", str(tmp_path))
    snap = dw.snapshot()
    by = {c["name"]: c["retention"] for c in snap["top_consumers"]}
    assert by["tweets.db"] == "retention: non-member, swept"
    assert by["mystery"] == "retention: UNDECLARED"


def test_an_undeclared_artifact_prune_deletes_no_member_row(monkeypatch):
    """The guard is wired where member rows are deleted: drop the declaration and the
    sweep removes nothing, whatever its own policy says."""
    from api.services import artifact_versions as av
    monkeypatch.setattr(av, "is_enabled", lambda: True)
    monkeypatch.setattr(sr, "may_prune", lambda store, table: False)

    class _NoConn:
        def execute(self, *a, **k):
            raise AssertionError("an undeclared prune touched the store")

    assert av._prune(_NoConn(), "u1", "screen", "s1") == []
