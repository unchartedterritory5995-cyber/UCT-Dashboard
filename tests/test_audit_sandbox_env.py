"""`tools/audit_sandbox_env.py` must never hand a local backend the live data root.

⛔ THIS FILE EXISTS BECAUSE THE TOOL FAILED ITS OWN PURPOSE ONCE, on the first run.
Three pins — `DATA_DIR`, `DESK_CREATIVE_DATA_DIR`, `RAILWAY_VOLUME_MOUNT_PATH` —
carry `/data` ITSELF as their literal rather than `/data/<something>`, and the
first implementation split on `"/data/"`, so those three came back **unchanged**.
The sandbox would have handed the backend `C:\\data` under the name of a safety
feature. It was caught by running the check below by hand; it is a test now so it
cannot come back.

⚠️ On this box `/data` IS `C:\\data` — the owner's live files — and several
modules write, one of them (`theme_performance`) in the background **on boot**. So
"the sandbox mostly works" is not a state worth having.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))

import audit_sandbox_env as ASE  # noqa: E402
import conftest as CONF  # noqa: E402


def _env(tmp_path):
    return ASE.sandbox_env(tmp_path / "sandbox")


def _looks_like_the_live_root(value: str) -> bool:
    v = str(value).replace("\\", "/").rstrip("/").lower()
    return v.startswith("/data") or v.endswith(":/data") or "/data/" in v.split("sandbox", 1)[0]


def test_NO_variable_points_at_the_shared_data_root(tmp_path):
    """The one property this tool exists for."""
    env = _env(tmp_path)
    offenders = {k: v for k, v in env.items() if v and _looks_like_the_live_root(v)}
    assert not offenders, (
        "these variables would send a local backend at the LIVE data root, which is "
        "the exact thing this tool exists to prevent:\n  "
        + "\n  ".join(f"{k} = {v}" for k, v in sorted(offenders.items())))


def test_the_BARE_ROOT_pins_are_redirected_too(tmp_path):
    """⛔ The specific bug this file was written for.

    A pin whose literal is `/data` itself must land on the sandbox ROOT, not be
    passed through. Asserted by NAME rather than by count, so the case survives a
    future pin joining or leaving the group."""
    env = _env(tmp_path)
    _, pins, _ = CONF.shared_data_root_census()
    bare = [v for v, lit in pins.items() if str(lit).replace("\\", "/").rstrip("/").endswith("/data")]
    assert bare, "no bare-root pin found — this test has stopped testing the case it was written for"
    for var in bare:
        assert var in env, f"{var} is a bare-root pin and the sandbox does not set it"
        assert not _looks_like_the_live_root(env[var]), f"{var} still resolves to the live root"


def test_it_REDIRECTS_EVERY_pin_the_census_derives(tmp_path):
    """⛔ The non-vacuity guard. A sandbox that redirected three variables would
    pass the check above trivially. The set it covers must be the census's own
    set — not a subset, and not a hand-typed list that drifts from it."""
    env = _env(tmp_path)
    _, pins, _ = CONF.shared_data_root_census()
    assert pins, "the census returned no pins — it is not measuring anything"
    missing = sorted(set(pins) - set(env))
    assert not missing, (
        f"{len(missing)} shared-root pin(s) the census derives are NOT redirected: {missing}")


def test_it_REFUSES_when_the_census_reports_something_it_cannot_redirect(tmp_path, monkeypatch):
    """⭐ Both directions. An unpinnable literal must stop the run, not be skipped —
    otherwise the day a new `/data` path lands with no override, this tool would
    quietly build a sandbox with a hole in it and report success."""
    real = CONF.shared_data_root_census
    monkeypatch.setattr(
        CONF, "shared_data_root_census",
        lambda *a, **k: (real()[0], real()[1], ["/data/zz_planted_unpinnable.db"]))
    with pytest.raises(SystemExit) as excinfo:
        ASE.sandbox_env(tmp_path / "sandbox")
    assert "zz_planted_unpinnable.db" in str(excinfo.value), (
        "the refusal must NAME what it could not redirect; a bare 'refused' leaves "
        "the next reader to go and find it")


def test_the_quiet_flags_blank_a_webhook_rather_than_removing_it(tmp_path):
    """⚠️ A blank webhook posts nothing; an ABSENT one lets a default re-appear.
    This repo has paged production from a test suite once, and that is the
    distinction that prevents it."""
    env = _env(tmp_path)
    for var in ("DISCORD_WEBHOOK_URL", "DISCORD_TSDR_WEBHOOK_URL"):
        assert var in env, f"{var} must be present-and-blank, never absent"
        assert env[var] == "", f"{var} must be blank, got {env[var]!r}"
