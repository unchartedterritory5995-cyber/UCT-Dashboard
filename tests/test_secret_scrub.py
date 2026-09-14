"""The rig-credential rail: no credential reaches a committed artifact.

⚰️ 2026-09-13. A playwright teardown error printed its call log, a `Cookie:` header was
in it, and a live member session token went to disk and into an agent's tool output. The
credential was rotated. This is the standing check that it has not happened again.

⛔ Scoped runs only on this box — name the file:

    python -m pytest tests/test_secret_scrub.py -q
"""
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from tools import secret_scrub                                  # noqa: E402

# Built at runtime so THIS file does not contain the literal it hunts — the same rule the
# module follows, and the reason its own first draft failed its own check.
SESSION = "uct_" + "session"
PATTERN_FILES = ("tools/secret_scrub.py", "tests/test_secret_scrub.py")
TOKEN_CHARS = set("abcdefghijklmnopqrstuvwxyz"
                  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.+/=")
FAKE = "Q7" * 24


def test_the_module_self_check_passes():
    assert secret_scrub.self_check() == 0


def test_the_scanner_can_see_a_planted_leak(tmp_path):
    """⛔ NON-VACUITY. A clean scan proves nothing unless a dirty one would fail."""
    (tmp_path / "run.log").write_text(f"  - cookie: {SESSION}={FAKE}\n", encoding="utf-8")
    hits = secret_scrub.scan_paths([tmp_path])
    assert hits, "the scanner missed a planted session cookie — every clean result below is vacuous"
    assert FAKE not in str(hits), "the scanner echoed the secret it found"


def test_the_scanner_does_not_cry_wolf(tmp_path):
    """A redacted line, and a mention with no value, are both NOT findings."""
    (tmp_path / "a.log").write_text(
        f"cookie: {SESSION}=<redacted>\n{SESSION}=\nthe session ended normally\n", encoding="utf-8")
    assert secret_scrub.scan_paths([tmp_path]) == []


def test_no_credential_in_the_repo_source_or_docs():
    """The artifact dirs a rig can write to, plus everything committed."""
    here = pathlib.Path(secret_scrub.__file__).resolve()
    targets = [REPO / "docs", REPO / "tools", REPO / "scripts", REPO / "app" / "src", REPO / "tests"]
    hits = secret_scrub.scan_paths(targets, skip_files=[here, pathlib.Path(__file__).resolve()])
    assert hits == [], "credential-shaped content in a committed path: " + "; ".join(
        f"{p}:{n} ({k})" for p, n, k in hits[:10])


def test_no_credential_in_git_history_of_this_branch():
    """A scrubbed working tree is not enough — the leak may be in a commit.

    ⛔ RANGE IS `origin/master..HEAD`, NOT `merge-base..HEAD`. After this branch merges
    master, a merge-base range replays master's OWN commits as if they were ours — the
    first run failed on an `Authorization:` header in `api/` code from another
    workstream. A rail that reds on somebody else's commit gets waved through.

    ⛔ Findings name the FILE. The first version scanned one concatenated blob and
    reported `line 2058` of something that exists nowhere on disk, which is a finding
    nobody can act on (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
    """
    # ⛔ NOT `text=True`: on Windows that decodes the pipe with the locale codec
    # (cp1252) and git emits UTF-8, so the first box-drawing byte kills the reader
    # thread. That is the exact bug that made `tools/flag_ledger_audit.py` unrunnable
    # for weeks while reporting something that read like an auth failure.
    def git(*args):
        return subprocess.run(["git", "-C", str(REPO), *args],
                              capture_output=True, encoding="utf-8", errors="replace").stdout

    if not git("rev-parse", "--verify", "-q", "origin/master").strip():
        return                                  # no remote to compare against
    diff = git("diff", "-U0", "origin/master..HEAD")
    assert diff.strip(), "empty diff — the check would pass vacuously"

    hits, path = [], "<unknown>"
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and secret_scrub.scan_text(line):
            hits.append(path)
    # These two DEFINE the credential shapes, so they match by construction. They are
    # exempt here and held to the STRICTER rule below instead — see that test for why an
    # exemption without a replacement guarantee is exactly where a secret hides.
    hits = [h for h in hits if h not in PATTERN_FILES]
    assert hits == [], "commits on this branch add credential-shaped content in: " + ", ".join(
        sorted(set(hits)))


def test_the_pattern_files_carry_no_real_credential():
    """⛔ THE EXEMPTION'S PRICE.

    `secret_scrub.py` and this file are skipped by every shape-based scan, because they
    contain the shapes. That exemption is precisely where a secret can hide, and it did:
    the first draft of the scrubber pasted the ACTUAL leaked token in as a fixture, and
    the scan came back clean over it *because the file was on the skip list*.

    So the exempt files get a different, stricter rule: **no long high-entropy literal.**
    Every fixture here is assembled from short pieces at runtime, so a real credential —
    which arrives as one long pasted string — cannot satisfy it.
    """
    def long_entropy_literals(src):
        out = []
        for lit in re.findall(r"""["']([^"'\n]{32,})["']""", src):
            if (set(lit) <= TOKEN_CHARS and any(c.isupper() for c in lit)
                    and any(c.islower() for c in lit) and any(c.isdigit() for c in lit)):
                out.append(lit)
        return out

    # ⛔ NON-VACUITY: prove the predicate fires on a pasted-token shape before trusting
    # it to say the real files are clean. Assembled here, never a real value.
    planted = 'tok = "' + "-Ab3" + "Xy7Qm" + ("Kp9Zt4Lw" * 6) + '"'
    assert long_entropy_literals(planted), "the predicate cannot see a pasted token — it proves nothing"
    assert not long_entropy_literals('name = "charts-breadth__390__after.png"'), "flags an ordinary filename"

    bad = []
    for rel in PATTERN_FILES:
        for lit in long_entropy_literals((REPO / rel).read_text(encoding="utf-8")):
            bad.append(f"{rel}: a {len(lit)}-char mixed-case literal")
    assert bad == [], ("a long high-entropy literal in an exempt file — build fixtures by "
                       "concatenation, never paste a credential: " + "; ".join(bad))
