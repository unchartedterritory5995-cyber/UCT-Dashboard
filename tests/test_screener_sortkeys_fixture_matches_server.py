"""The Focus sort-menu test runs on a CAPTURE of two server values, and this keeps it honest.

app/src/pages/screener/focus/__tests__/sortKeys.test.js carries `VIEWS` (every view's columns) and
`FILTER_TYPES` (the filter type of every view column that has a filter), captured from
api/services/screener/filters.py. A vitest cannot import Python, so the copies stay; this test
reads them back out of the JS file and fails the day the server moves, rather than leaving the
sort menu tested against a list the product no longer has.
"""
import json
import pathlib
import re

from api.services.screener import filters

FIXTURE = pathlib.Path(__file__).resolve().parents[1] / "app/src/pages/screener/focus/__tests__/sortKeys.test.js"


def _captured():
    text = FIXTURE.read_text(encoding="utf-8")
    block = re.search(r"^const VIEWS = \{\n(.*?)^\}", text, re.S | re.M)
    assert block, "VIEWS block not found in sortKeys.test.js"
    views = {}
    for line in block.group(1).splitlines():
        m = re.match(r"\s*(\w+): (\[.*\]),?\s*$", line)
        if m:
            views[m.group(1)] = json.loads(m.group(2))
    types = re.search(r"^const FILTER_TYPES = (\{.*\})\s*$", text, re.M)
    assert types, "FILTER_TYPES line not found in sortKeys.test.js"
    return views, json.loads(types.group(1))


def test_the_fixture_is_read_at_all():
    views, types = _captured()
    # Non-vacuity: a parser that found nothing would make both comparisons below pass on {}.
    assert "technical" in views and "adr_pct" in views["technical"]
    assert types.get("adr_pct") == "range"


def test_captured_views_match_the_server():
    views, _ = _captured()
    assert views == {name: v["columns"] for name, v in filters.VIEWS.items()}


def test_captured_filter_types_match_the_server():
    views, types = _captured()
    columns = {c for cols in views.values() for c in cols}
    assert types == {c: filters.FILTERS[c]["type"] for c in sorted(columns) if c in filters.FILTERS}
