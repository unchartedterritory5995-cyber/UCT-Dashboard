"""The remote-tests RED PROBE (2026-11-26): one test that always fails, on purpose.

Not collected by any suite run: its name does not match ``test_*.py``, so pytest collects it ONLY when the path is
named explicitly. It exists so the remote-tests lane can be proved to go red end to end:

    python tools/remote_tests.py --pytest tests/remote_tests_red_probe.py tests/test_remote_tests_lane.py

must exit 1 and print this test's id, while the run badge stays green (no failure email, 2026-11-16) and the run page
carries a ``::error::`` annotation "remote tests: pytest is RED". Read the tool's exit code, never the run badge.
"""


def test_the_red_probe_fails_on_purpose():
    assert False, "remote-tests red probe: this failure is the expected answer"
