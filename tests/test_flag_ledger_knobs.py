"""X-16: the `knobs` section of docs/feature_flags.json is held to the code.

`flags` admits only names the AST index classifies as a gate, a visibility flag
or a mode flag, so three env vars that DECIDE behaviour had no ledger at all:
a cutover switch (`IMPLIED_ENRICHMENT_CUTOVER`), a sample rate
(`D5_CP4_DUAL_COMPUTE_SAMPLE_RATE`) and a gate read only in morning-wire
(`WIRE_SURFACE_LINE_ENABLED`). `knobs` holds them. This rail keeps it honest:

  * every `repo: uct-dashboard` knob must be READ by the code (derived by the same
    AST scan `flags` uses, never typed here), so a retired knob cannot linger;
  * every knob states a real decision in the same vocabulary as `flags`;
  * a knob is never also a gate, which belongs in `flags` where its own rail is.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path

import pytest

from api.services import feature_flag_index as ffi

REPO = Path(__file__).resolve().parents[1]
LEDGER = REPO / "docs" / "feature_flags.json"
VALID_STATUS = {"armed", "dark", "pending"}


def _knobs() -> dict:
    data = json.loads(LEDGER.read_text(encoding="utf-8"))
    return {k: v for k, v in data.get("knobs", {}).items() if not k.startswith("_")}


@functools.lru_cache(maxsize=1)
def _scan() -> dict:
    return ffi.scan(ffi.repo_roots(REPO), REPO)


def _read_by_repo() -> set[str]:
    return set(_scan())


def _unread_local(knobs: dict, read: set[str]) -> list[str]:
    local = {k for k, v in knobs.items() if v.get("repo") == "uct-dashboard"}
    return sorted(local - read)


def test_the_three_x16_knobs_are_ledgered():
    assert {"IMPLIED_ENRICHMENT_CUTOVER", "D5_CP4_DUAL_COMPUTE_SAMPLE_RATE",
            "WIRE_SURFACE_LINE_ENABLED"} <= set(_knobs())


def test_every_local_knob_is_read_by_the_code():
    local = {k for k, v in _knobs().items() if v.get("repo") == "uct-dashboard"}
    assert local, "no local knobs: the section lost its rows"
    missing = _unread_local(_knobs(), _read_by_repo())
    assert not missing, f"knobs the code no longer reads (delete or fix): {missing}"


def test_a_local_knob_is_not_a_gate_hiding_from_the_flags_rail():
    gates = {k for k in _scan() if ffi.is_gate(k)}
    local = {k for k, v in _knobs().items() if v.get("repo") == "uct-dashboard"}
    assert not (local & gates), f"these are gates; declare them under `flags`: {sorted(local & gates)}"


def test_an_external_knob_names_its_repo_and_is_not_read_here():
    read = _read_by_repo()
    for name, row in _knobs().items():
        assert row.get("repo"), f"{name}: knob must name the repo that reads it"
        if row["repo"] != "uct-dashboard":
            assert name not in read, (
                f"{name} says repo={row['repo']!r} but this repo reads it; it belongs to the local rail")


@pytest.mark.parametrize("name", sorted(_knobs()))
def test_each_knob_states_a_decision(name):
    row = _knobs()[name]
    assert row.get("status") in VALID_STATUS, f"{name}: bad status {row.get('status')!r}"
    assert len((row.get("note") or "").strip()) >= 20, f"{name}: note must say why"
    assert row.get("read_at"), f"{name}: read_at must name where the code reads it"
    if row["status"] == "pending":
        assert row.get("since"), f"{name}: pending needs since"


def test_the_rail_can_fail_on_a_knob_nothing_reads():
    """Control: a typed knob the code does not read is caught, and a real one is not."""
    fake = dict(_knobs(), A_KNOB_NOBODY_READS={"repo": "uct-dashboard"})
    assert _unread_local(fake, _read_by_repo()) == ["A_KNOB_NOBODY_READS"]
