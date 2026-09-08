"""The Web Share Target's query must not reach our own access log.

⛔ THE THING BEING GUARDED IS MEMBER CONTENT, NOT A PARAMETER. `GET
/journal/share?...&text=...` carries whatever the sending app put in `text`,
which for most Android apps is the link PLUS surrounding prose — and can be a
passage the member selected out of private correspondence.
"""
from __future__ import annotations

import ast
import inspect
import logging
import pathlib
import re

import pytest

from api import logging_redaction as lr

REPO = pathlib.Path(__file__).resolve().parents[1]

SECRET = "PRIVATE_MEMBER_PROSE"
SHARE_TARGET = f"/journal/share?title=Fed+holds&text={SECRET}&url=https%3A%2F%2Fwsj.com%2Fx"

# uvicorn's own access call, mirrored. See `_test_the_record_shape_is_still_uvicorns`
# below, which derives this from the installed uvicorn rather than trusting it.
UVICORN_FMT = '%s - "%s %s HTTP/%s" %d'


def make_record(target: str, method: str = "GET") -> logging.LogRecord:
    return logging.LogRecord(
        name=lr.ACCESS_LOGGER, level=logging.INFO, pathname=__file__, lineno=1,
        msg=UVICORN_FMT,
        args=("127.0.0.1:5000", method, target, "1.1", 200),
        exc_info=None,
    )


@pytest.fixture()
def access_logger():
    """A clean `uvicorn.access` logger, restored afterwards."""
    logger = logging.getLogger(lr.ACCESS_LOGGER)
    before = list(logger.filters)
    for f in before:
        logger.removeFilter(f)
    yield logger
    for f in list(logger.filters):
        logger.removeFilter(f)
    for f in before:
        logger.addFilter(f)


def rendered(record: logging.LogRecord) -> str:
    return record.getMessage()


class TestTheRedaction:
    def test_the_shared_text_does_not_survive_into_the_log_line(self, access_logger):
        lr.install()
        rec = make_record(SHARE_TARGET)
        for f in access_logger.filters:
            f.filter(rec)
        line = rendered(rec)
        assert SECRET not in line
        assert "wsj.com" not in line
        # The useful half is kept: an operator still sees the route and status.
        assert "/journal/share" in line
        assert "GET" in line and "200" in line

    def test_WITHOUT_the_filter_the_text_is_right_there(self, access_logger):
        # ⭐ NON-VACUITY. Without this, the assertion above would pass just as
        # happily against a record that never contained the secret — which is
        # how a redaction rail silently stops redacting anything.
        rec = make_record(SHARE_TARGET)
        assert SECRET in rendered(rec)

    def test_every_other_route_keeps_its_query(self, access_logger):
        # ⛔ The narrowest layer, asserted. Redacting broadly would quietly cost
        # the operator the query strings that make an access log worth keeping.
        lr.install()
        rec = make_record("/api/bars/NVDA?tf=D&bars=5000")
        for f in access_logger.filters:
            f.filter(rec)
        assert "tf=D&bars=5000" in rendered(rec)

    def test_a_share_with_no_query_is_untouched(self, access_logger):
        lr.install()
        rec = make_record("/journal/share")
        for f in access_logger.filters:
            f.filter(rec)
        assert rendered(rec).count("/journal/share") == 1
        assert lr.REDACTION not in rendered(rec)

    def test_a_post_to_the_same_path_is_redacted_too(self, access_logger):
        # The path is what makes the query sensitive, not the verb.
        lr.install()
        rec = make_record(SHARE_TARGET, method="POST")
        for f in access_logger.filters:
            f.filter(rec)
        assert SECRET not in rendered(rec)

    def test_installing_twice_does_not_stack_filters(self, access_logger):
        lr.install()
        lr.install()
        mine = [f for f in access_logger.filters
                if isinstance(f, lr.ShareQueryRedactionFilter)]
        assert len(mine) == 1

    @pytest.mark.parametrize("args", [None, (), ("only-one",), ("a", "b"), ("a", "b", 42, "1.1", 200)])
    def test_an_unexpected_record_shape_passes_through_rather_than_exploding(
            self, access_logger, args):
        # ⛔ This filter runs on the response path of EVERY request. A defensive
        # bug here would cost the whole access log, which is worse than the
        # exposure it guards.
        lr.install()
        rec = make_record(SHARE_TARGET)
        rec.args = args
        for f in access_logger.filters:
            assert f.filter(rec) is True


class TestItIsActuallyWired:
    """⚰️ This repo's signature defect is a correct mechanism nobody calls."""

    def test_main_calls_install_inside_the_lifespan(self):
        src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        lifespan = next((n for n in ast.walk(tree)
                         if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
                         and n.name == "lifespan"), None)
        assert lifespan is not None, "api/main.py has no lifespan"
        calls = [n for n in ast.walk(lifespan)
                 if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute)
                 and n.func.attr == "install"
                 and isinstance(n.func.value, ast.Name)
                 and n.func.value.id == "logging_redaction"]
        assert calls, "logging_redaction.install() is never called from the lifespan"

    def test_it_is_not_installed_at_import_time(self):
        # ⛔ MEASURED, NOT ASSUMED: a filter added at module import is silently
        # discarded, because uvicorn rebuilds these loggers when it applies its
        # own logging config during startup. If someone "simplifies" this by
        # calling install() at import, redaction stops happening in production
        # while every test here still passes.
        src = pathlib.Path(inspect.getfile(lr)).read_text(encoding="utf-8")
        module_level = [n for n in ast.parse(src).body if isinstance(n, ast.Expr)]
        assert not [n for n in module_level
                    if isinstance(n.value, ast.Call)
                    and getattr(n.value.func, "id", None) == "install"]


class TestTheAssumptionAboutUvicorn:
    def test_the_path_is_still_the_third_arg_of_uvicorns_access_call(self):
        """⛔ The filter rewrites `args[2]`. That index is uvicorn's, not ours.

        Derived from the INSTALLED uvicorn rather than retyped here, so an
        upgrade that reorders the call fails loudly instead of silently
        redacting the wrong field (or nothing).
        """
        import uvicorn
        base = pathlib.Path(inspect.getfile(uvicorn)).parent
        impl = base / "protocols" / "http" / "h11_impl.py"
        assert impl.exists(), f"uvicorn layout changed: {impl}"
        text = impl.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"access_logger\.info\(\s*(.*?)\)\s*\n", text, re.S)
        assert m, "could not find uvicorn's access_logger.info call"
        call_args = [a.strip() for a in m.group(1).split(",") if a.strip()]
        # [0] format string, then client, method, path, version, status.
        assert "get_path_with_query_string" in call_args[1 + lr._PATH_ARG], (
            f"uvicorn's access args moved; path is no longer at index "
            f"{lr._PATH_ARG}: {call_args}")


class TestThePrimaryControl:
    """⭐ The redaction filter is the BACKSTOP. The control that actually keeps
    request URLs out of this app's logs is older and blunter: `api/main.py`
    silences `uvicorn.access`. Both are pinned, because the silence lives in a
    list about NOISE and could be undone by someone restoring visibility with
    no idea it is load-bearing for privacy."""

    def test_main_silences_the_uvicorn_access_logger(self):
        src = (REPO / "api" / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        noisy = None
        for node in ast.walk(tree):
            if isinstance(node, ast.For) and isinstance(node.target, ast.Name) \
                    and node.target.id == "_noisy" and isinstance(node.iter, ast.Tuple):
                noisy = [e.value for e in node.iter.elts if isinstance(e, ast.Constant)]
                break
        assert noisy is not None, "api/main.py no longer has the `_noisy` logger loop"
        assert "uvicorn.access" in noisy, (
            "`uvicorn.access` was removed from the silenced-logger list. That is "
            "the primary reason share payloads never reach our logs; the "
            "redaction filter is only the backstop. If this was deliberate, the "
            "filter still redacts /journal/share — but say so on purpose.")
        # ⭐ Non-vacuity: the probe really is reading a populated list.
        assert len(noisy) > 3 and "httpx" in noisy

    def test_uvicorn_logs_access_at_INFO_so_WARNING_suppresses_it(self):
        """The silence depends on a level relationship, not on a promise."""
        import uvicorn  # noqa: F401
        base = pathlib.Path(inspect.getfile(__import__("uvicorn"))).parent
        impl = (base / "protocols" / "http" / "h11_impl.py").read_text(
            encoding="utf-8", errors="replace")
        assert "access_logger.info(" in impl, (
            "uvicorn no longer logs access lines at INFO — setting that logger "
            "to WARNING may no longer suppress them.")
