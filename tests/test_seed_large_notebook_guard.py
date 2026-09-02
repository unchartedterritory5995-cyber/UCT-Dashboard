"""Rails on `tools/seed_large_notebook.py`'s shared-production-root guard.

Fix round 1 (Task 6 review). The reviewer found: `_norm()` used
`os.path.abspath`, which joins with the cwd and collapses `.`/`..` but never
follows a symlink or a Windows directory junction (`mklink /J`, no admin
needed). A "safe-looking" `--db` path whose containing directory was actually
a junction into the shared root sailed through the containment check
textually while every write landed inside the real root. Fixed by switching
`_norm()` to `os.path.realpath`, applied to both the candidate and the root
literals it is compared against (`_shared_root_hit` calls `_norm` on both).

⭐ These tests never touch the real `C:\\data`. Every "protected root" here is
a throwaway directory created by the test and swapped into
`_SHARED_ROOT_CANDIDATES` via monkeypatch — the same idiom the repo-root
conftest's own `pretend_shared_root` uses to watch its tripwire fire without
going near production.
"""
from __future__ import annotations

import subprocess

import pytest

from tools import seed_large_notebook as sln


def _make_junction(link, target) -> None:
    """Create an NTFS directory junction `link -> target` via `mklink /J`.
    Junctions (unlike symlinks) need no elevated privilege on Windows, which
    is exactly why this is a realistic bypass and not a hypothetical one."""
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise OSError(
            f"mklink /J failed (rc={result.returncode}): "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )


@pytest.fixture
def decoy_root(tmp_path):
    """A throwaway 'protected root' standing in for `C:\\data` — never the
    real thing — active only for the duration of one test."""
    root = tmp_path / "decoy_prod_root"
    root.mkdir()
    return root


def test_junction_into_protected_root_is_refused(tmp_path, decoy_root, monkeypatch):
    """The Critical finding, made concrete: a directory junction whose real
    target lands inside the protected root must be caught by containment,
    even though the junction's own path never mentions the root. Mirrors the
    reviewer's safe demonstration exactly — a 'safe-looking' `--db` path
    (`safe_looking_dir/seed.db`) that resolves, via the junction, to
    `decoy_prod_root/evil_target/seed.db`.

    Skips (naming the unverified property, not silently) if `mklink /J` is
    unavailable on this host — e.g. a non-Windows runner, or a locked-down
    filesystem that refuses reparse points."""
    real_target = decoy_root / "evil_target"
    real_target.mkdir()
    safe_looking = tmp_path / "safe_looking_dir"

    try:
        _make_junction(safe_looking, real_target)
    except OSError as e:
        pytest.skip(
            "mklink /J unavailable/failed on this host "
            f"({e}) -- this guard's resistance to an NTFS-junction bypass "
            "into the shared production root is UNVERIFIED on this host."
        )

    monkeypatch.setattr(sln, "_SHARED_ROOT_CANDIDATES", (str(decoy_root),))

    candidate = str(safe_looking / "seed.db")  # need not exist on disk
    hit = sln._shared_root_hit(candidate)
    assert hit is not None, (
        f"junction bypass succeeded: {candidate!r} was NOT recognized as "
        f"inside {str(decoy_root)!r} despite the junction resolving there — "
        f"the containment check is not following reparse points"
    )

    # The real CLI-facing refusal path also has to fire (exit 2), not just
    # the internal predicate.
    with pytest.raises(SystemExit) as exc_info:
        sln._refuse_if_shared(candidate, "--db")
    assert exc_info.value.code == 2


def test_relative_traversal_into_protected_root_is_still_refused(decoy_root, monkeypatch, tmp_path):
    """Existing protection, unregressed: `../` segments that resolve into the
    protected root are still caught."""
    monkeypatch.setattr(sln, "_SHARED_ROOT_CANDIDATES", (str(decoy_root),))
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    traversal = str(outside / ".." / decoy_root.name / "evil.db")
    assert sln._shared_root_hit(traversal) is not None


def test_literal_path_inside_protected_root_is_still_refused(decoy_root, monkeypatch):
    """Existing protection, unregressed: a plain literal path inside the root
    (no junction, no traversal trick) is still caught."""
    monkeypatch.setattr(sln, "_SHARED_ROOT_CANDIDATES", (str(decoy_root),))
    literal = str(decoy_root / "auth.db")
    assert sln._shared_root_hit(literal) is not None


def test_a_genuinely_safe_temp_path_is_accepted(decoy_root, monkeypatch, tmp_path):
    """Existing protection, other direction: a real throwaway path outside the
    root must NOT be refused. A guard that cries wolf on every ordinary run
    gets disabled by the next person who hits it — false positives are a
    correctness bug here too, not just a UX nit."""
    monkeypatch.setattr(sln, "_SHARED_ROOT_CANDIDATES", (str(decoy_root),))
    safe = tmp_path / "genuinely_safe_dir" / "seed.db"
    assert sln._shared_root_hit(str(safe)) is None
