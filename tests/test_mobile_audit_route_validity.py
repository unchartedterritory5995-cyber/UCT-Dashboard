"""Wave K Slice 0 — rails for the mobile-audit anti-vacuity hardening (§131).

Wave J shipped THREE clean audits of pages that were not the target. Two died
in the argument before a browser ever launched; the third was the consequence
of landing on the SPA catch-all, which has no horizontal overflow and no
small tap targets and therefore measures as a perfect page.

These tests pin both halves of the fix:
  - `validate_route`  refuses the malformed input up front
  - `check_reached`   refuses to believe a measurement that came from
                      somewhere other than the requested route

Both are pure functions precisely so this rail needs no browser. A guard that
can only be exercised by a full Playwright sweep is a guard nobody runs.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# tools/ is not a package; load the module by path so this rail does not
# depend on how the repo is invoked.
_SPEC = importlib.util.spec_from_file_location(
    "mobile_audit", Path(__file__).resolve().parents[1] / "tools" / "mobile_audit.py"
)
mobile_audit = importlib.util.module_from_spec(_SPEC)
sys.modules["mobile_audit"] = mobile_audit
try:
    _SPEC.loader.exec_module(mobile_audit)
except ImportError as exc:  # playwright absent in some environments
    pytest.skip(f"mobile_audit import failed: {exc}", allow_module_level=True)

validate_route = mobile_audit.validate_route
check_reached = mobile_audit.check_reached


def _probe(path, **kw):
    base = {
        "pathname": path, "href": f"http://localhost:8092{path}",
        "notFound": False, "rootChildren": 3, "bodyTextLen": 500,
    }
    base.update(kw)
    return base


class TestValidateRoute:
    @pytest.mark.parametrize("route", ["/journal", "/journal/notebook", "/", "/a/b/c"])
    def test_ordinary_app_paths_are_accepted(self, route):
        assert validate_route(route) is None

    def test_THE_GIT_BASH_REWRITE_is_refused(self):
        # The literal value Wave J's harness actually received. MSYS rewrote
        # `/journal` into a Windows path before Python ever saw the argument.
        err = validate_route("C:/Program Files/Git/journal")
        assert err is not None
        assert "start with '/'" in err
        # The message must name the cause and a way out, or the next person
        # hits the same wall.
        assert "MSYS_NO_PATHCONV" in err

    def test_THE_COMMA_SEPARATED_LIST_is_refused(self):
        # `--routes /journal,/journal/notebook` is ONE element to nargs="*".
        err = validate_route("/journal,/journal/notebook")
        assert err is not None
        assert "comma" in err.lower()
        assert "SPACE-separated" in err

    def test_a_windows_path_that_kept_its_leading_slash_is_refused(self):
        assert validate_route("/C:/Program Files/Git/journal") is not None
        assert validate_route("/journal\\notebook") is not None

    def test_a_protocol_relative_route_is_refused(self):
        assert validate_route("//evil.example.com/journal") is not None

    @pytest.mark.parametrize("route", ["", "   ", None, 42])
    def test_empty_or_non_string_routes_are_refused(self, route):
        assert validate_route(route) is not None


class TestCheckReached:
    def test_the_requested_route_measured_at_that_route_is_accepted(self):
        assert check_reached("/journal/notebook", _probe("/journal/notebook")) is None

    def test_a_trailing_slash_difference_is_not_treated_as_a_miss(self):
        assert check_reached("/journal", _probe("/journal/")) is None
        assert check_reached("/journal/", _probe("/journal")) is None

    def test_a_query_string_in_the_requested_route_is_ignored(self):
        assert check_reached("/journal?note=abc", _probe("/journal")) is None

    def test_THE_404_SURFACE_IS_REFUSED_EVEN_THOUGH_IT_MEASURES_CLEAN(self):
        # This is the exact Wave J failure: the catch-all page genuinely has
        # overflowX=0 and zero small targets. The numbers are real; they just
        # describe the wrong page.
        err = check_reached("/journal", _probe("/journal", notFound=True))
        assert err is not None and "404" in err

    def test_a_redirect_away_from_the_requested_route_is_refused(self):
        # e.g. an auth bounce to /login, or a LegacyRedirect. Not necessarily
        # an app bug, but always an audit bug: the row would claim /journal.
        err = check_reached("/journal", _probe("/login"))
        assert err is not None
        assert "/journal" in err and "/login" in err

    def test_an_unmounted_spa_shell_is_refused(self):
        err = check_reached("/journal", _probe("/journal", rootChildren=0))
        assert err is not None and "never mounted" in err

    def test_a_page_that_rendered_nothing_is_refused(self):
        err = check_reached("/journal", _probe("/journal", bodyTextLen=3))
        assert err is not None and "essentially nothing" in err

    def test_absent_probe_data_is_refused_rather_than_passing(self):
        assert check_reached("/journal", None) is not None
        assert check_reached("/journal", {}) is not None


class TestNonVacuity:
    """The rails above must be able to FAIL, and must not all pass for one
    trivial reason. A guard nobody has seen fire is not a guard."""

    def test_the_valid_and_invalid_cases_are_genuinely_distinguished(self):
        good = ["/journal", "/journal/notebook"]
        bad = ["C:/Program Files/Git/journal", "/journal,/journal/notebook", ""]
        assert all(validate_route(r) is None for r in good)
        assert all(validate_route(r) is not None for r in bad)

    def test_a_clean_probe_and_a_404_probe_differ_only_in_the_flag(self):
        # Proves the 404 refusal is driven by `notFound`, not by some other
        # difference in the fixture that would make the test pass for the
        # wrong reason.
        clean = _probe("/journal")
        four04 = dict(clean, notFound=True)
        assert check_reached("/journal", clean) is None
        assert check_reached("/journal", four04) is not None
