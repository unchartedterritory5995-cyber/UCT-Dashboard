"""THE refusal authority (`scripts/shared_root_guard.py`, ruling W11-R51, F-CLOCK-1 review C1).

Every spelling the safety review measured, against a FAKE root in tmp_path (the real C:\\data is never
named to the filesystem here: the device / UNC spellings are refused as strings, and every root in
this file is a scratch directory). Then the four call sites, each driven through its own entry point
with its roots swapped for the fake one: the hub launcher, the pytest tripwire, the campaign seeder and
the perf harness. And a scratch-dir control that must pass, so none of this can go green by refusing
everything.
"""
import inspect
import os
import sys
from pathlib import Path

import pytest

import conftest as rootconf

REPO = Path(__file__).resolve().parents[1]
for p in (REPO / "scripts", REPO / "tools", REPO / "tools" / "notebook_campaign"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
import hub_sandbox_boot as hub  # noqa: E402
import notebook_perf_harness as perf  # noqa: E402
import seed_members as seedmod  # noqa: E402
import shared_root_guard as guard  # noqa: E402

WINDOWS = os.name == "nt"


@pytest.fixture
def fake(tmp_path):
    root = tmp_path / "FAKEDATA"
    (root / "sub").mkdir(parents=True)
    sandbox = tmp_path / "FAKEDATA-sandbox"          # shares the root's name as a PREFIX: must pass
    sandbox.mkdir()
    return root, sandbox


def _spellings(root: Path, tmp_path: Path) -> dict:
    r = str(root)
    out = {
        "plain": r, "upper": r.upper(), "trailing sep": r + os.sep, "sub": str(root / "sub"),
        "forward slashes": r.replace("\\", "/"), "dotdot": str(root / "sub" / ".."),
    }
    if WINDOWS:
        drive, rest = os.path.splitdrive(r)        # "C:", "\\Users\\...\\FAKEDATA"
        letter = drive[0]
        out.update({
            "trailing dot": r + ".", "trailing space": r + " ",
            "device ?": "\\\\?\\" + r, "device ? sub": "\\\\?\\" + r + "\\sub", "device .": "\\\\.\\" + r,
            "admin share localhost": f"\\\\localhost\\{letter}$" + rest,
            "admin share 127 sub": f"\\\\127.0.0.1\\{letter.lower()}$" + rest + "\\sub",
            "device UNC admin share": f"\\\\?\\UNC\\localhost\\{letter}$" + rest,
            # R1 (ruling W11-R52): the NT object-manager prefix, ONE leading separator
            "nt prefix": "\\??\\" + r, "nt prefix sub": "\\??\\" + r + "\\sub",
            "nt prefix forward": "/??/" + r.replace("\\", "/"),
        })
    return out


# ── the authority itself ────────────────────────────────────────────────────────────────────

def test_every_spelling_is_refused(fake, tmp_path):
    root, _ = fake
    for label, spelling in _spellings(root, tmp_path).items():
        assert guard.refuse(spelling, roots=[str(root)]), label


def test_a_relative_spelling_is_refused(fake, monkeypatch):
    root, _ = fake
    monkeypatch.chdir(root.parent)
    assert guard.refuse("FAKEDATA", roots=[str(root)])
    assert guard.refuse(os.path.join("FAKEDATA", "sub"), roots=[str(root)])


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows reparse point")
def test_a_junction_and_its_sub_directory_are_refused(fake, tmp_path):
    import _winapi
    root, _ = fake
    link = tmp_path / "innocent-looking"
    _winapi.CreateJunction(str(root), str(link))
    try:
        assert guard.refuse(str(link), roots=[str(root)])
        assert guard.refuse(str(link / "sub"), roots=[str(root)])
    finally:
        os.rmdir(link)                              # removes the junction, never the target


def test_two_separators_are_refused_before_anything_is_resolved(monkeypatch):
    # A device / UNC path is refused as a STRING: realpath (which would touch a share) is never called.
    def boom(*_a, **_k):
        raise AssertionError("realpath was called for a device / UNC spelling")
    monkeypatch.setattr(guard.os.path, "realpath", boom)
    for p in ("\\\\?\\Z:\\nowhere", "\\\\.\\Z:\\nowhere", "\\\\server\\share\\x", "//server/share/x"):
        assert guard.refuse(p, roots=["Z:\\elsewhere"])


def test_a_root_spelled_exactly_is_refused_without_touching_the_disk(fake, monkeypatch):
    # Review M4: the drive spelling is compared BEFORE realpath, so refusing the root itself never
    # opens a handle on it.
    root, _ = fake
    monkeypatch.setattr(guard.os.path, "realpath", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("disk")))
    assert guard.refuse(str(root), roots=[str(root)])
    assert guard.refuse(str(root / "sub"), roots=[str(root)])


def test_control_a_scratch_dir_passes(fake, tmp_path):
    root, sandbox = fake
    assert guard.refuse(str(sandbox), roots=[str(root)]) is None
    assert guard.refuse(str(tmp_path / "FAKEDATA2" / "x"), roots=[str(root)]) is None
    assert guard.hit(str(sandbox / "auth.db"), guard.canonical_roots([str(root)])) is None


def test_the_tripwire_entry_point_maps_every_string_spelling(fake, tmp_path):
    root, _ = fake
    croots = guard.canonical_roots([str(root)])
    for label, spelling in _spellings(root, tmp_path).items():
        assert guard.hit(os.path.join(spelling, "auth.db") if not spelling.endswith(os.sep) else spelling + "auth.db",
                         croots), label


# ── the four call sites, each through its own door ──────────────────────────────────────────

def test_the_hub_launcher_refuses_every_spelling(fake, tmp_path, capsys):
    root, sandbox = fake
    for label, spelling in _spellings(root, tmp_path).items():
        with pytest.raises(SystemExit):
            hub._refuse_shared_root(spelling, guard.canonical_roots([str(root)]))
        assert "REFUSING TO RUN" in capsys.readouterr().out, label
    hub._refuse_shared_root(str(sandbox), guard.canonical_roots([str(root)]))      # control: no exit


def test_the_seeder_refuses_every_spelling(fake, tmp_path, monkeypatch):
    root, sandbox = fake
    monkeypatch.setattr(seedmod, "SHARED_ROOTS", (str(root),))
    for label, spelling in _spellings(root, tmp_path).items():
        assert seedmod.refuse_shared_root(spelling), label
    assert seedmod.refuse_shared_root(str(sandbox)) is None


def test_the_perf_harness_refuses_every_spelling(fake, tmp_path, monkeypatch):
    root, sandbox = fake
    monkeypatch.setattr(perf, "SHARED_ROOTS", (str(root),))
    for label, spelling in _spellings(root, tmp_path).items():
        assert perf.refuse_shared_root(spelling), label
    assert perf.refuse_shared_root(str(sandbox)) is None


def test_the_pytest_tripwire_blocks_a_write_through_a_device_spelling(fake):
    root, sandbox = fake
    if not WINDOWS:
        pytest.skip("device paths are a Windows spelling")
    target = "\\\\?\\" + str(root / "sub" / "written.txt")
    with rootconf.pretend_shared_root(str(root)):
        before = len(rootconf.SHARED_ROOT_VIOLATIONS)
        with pytest.raises(rootconf.SharedDataRootWrite):
            open(target, "w").close()
        assert len(rootconf.SHARED_ROOT_VIOLATIONS) == before + 1
        rootconf.SHARED_ROOT_VIOLATIONS.pop()                                 # ours, not the run's
        with open(sandbox / "control.txt", "w") as fh:                        # control: allowed
            fh.write("x")
    assert not (root / "sub" / "written.txt").exists()


@pytest.mark.parametrize("p", ["C:\\scratch\\what?", "\\??\\Z:\\anything", "/??/Z:/anything", "sb?x"])
def test_r1_any_question_mark_or_nt_prefix_is_refused_before_resolving(p, monkeypatch):
    monkeypatch.setattr(guard.os.path, "realpath",
                        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("resolved")))
    assert guard.refuse(p, roots=["Z:\\elsewhere"])


def test_r1_control_a_long_path_device_prefix_into_a_scratch_dir_is_no_tripwire_hit(fake):
    root, sandbox = fake
    croots = guard.canonical_roots([str(root)])
    assert guard.hit("\\\\?\\" + str(sandbox / "x.db"), croots) is None
    assert guard.hit("\\??\\" + str(sandbox / "x.db"), croots) is None


def test_r1_the_tripwire_reports_a_stray_question_mark_it_cannot_map(fake):
    root, _ = fake
    croots = guard.canonical_roots([str(root)])
    assert guard.hit("?" + str(root / "x.db"), croots)                 # not a device prefix: reported
    assert guard.hit("\\?" + str(root / "x.db"), croots)


def test_r1_the_tripwire_blocks_a_write_through_the_nt_prefix(fake):
    root, sandbox = fake
    if not WINDOWS:
        pytest.skip("the NT prefix is a Windows spelling")
    target = "\\??\\" + str(root / "sub" / "nt.txt")
    with rootconf.pretend_shared_root(str(root)):
        before = len(rootconf.SHARED_ROOT_VIOLATIONS)
        with pytest.raises(rootconf.SharedDataRootWrite):
            open(target, "w").close()
        assert len(rootconf.SHARED_ROOT_VIOLATIONS) == before + 1
        rootconf.SHARED_ROOT_VIOLATIONS.pop()
        with open(sandbox / "control-nt.txt", "w") as fh:
            fh.write("x")
    assert not (root / "sub" / "nt.txt").exists()


def test_n5_the_last_two_copies_ask_the_guard(fake, monkeypatch):
    import tools.notebook_daily_prep_probe as prep
    from tools.wisdom import evals_common
    root, sandbox = fake
    monkeypatch.setattr(prep, "shared_roots", lambda: [str(root)])
    with pytest.raises(prep.SharedRootRefused):
        prep.refuse_shared_root({"db": "\\??\\" + str(root / "x.db")})
    prep.refuse_shared_root({"db": str(sandbox / "x.db")})                           # control
    monkeypatch.setattr(evals_common, "_SHARED_ROOTS", (str(root),))
    with pytest.raises(SystemExit):
        evals_common.refuse_shared_root(str(root / "sub" / "e.db"), "--db")
    assert evals_common.refuse_shared_root(str(sandbox / "e.db"), "--db") == str(sandbox / "e.db")
    for fn in (prep.refuse_shared_root, evals_common.refuse_shared_root):
        src = inspect.getsource(fn)
        assert "guard" in src and "startswith(" not in src, fn.__qualname__


def test_the_copies_are_gone():
    """Each call site asks the guard; none still carries its own compare."""
    for fn in (hub._refuse_shared_root, seedmod.refuse_shared_root, perf.refuse_shared_root,
               rootconf._shared_root_hit_against):
        src = inspect.getsource(fn)
        assert "guard" in src, fn.__qualname__
        assert "startswith(" not in src and "normcase" not in src, fn.__qualname__
    assert not hasattr(hub, "_norm")
