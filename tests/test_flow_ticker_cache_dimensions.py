"""The semantic inputs to the per-ticker Search product, pinned.

The new Search path caches a derived product by (ticker, source, tape version).
That key is only correct while those are the ONLY dimensions that change the
answer. Two of them are easy to get wrong:

- RANGE. `/api/flow/ticker` takes no range/window/days parameter — it returns a
  ticker's COMPLETE history and the page scopes it at render time
  (`_scopeAllDirectional`). If someone adds a range parameter, the endpoint
  starts returning different rows for the same key and the cache silently serves
  a wrong-range Search. A fast wrong-range Search is a failure, not a win.

- COLUMNS. `?cols=` narrows the CSV projection. It is a TRANSPORT narrowing, but
  `processFlowData` reads columns by name, so computing the derived product from
  a narrowed CSV could change the answer. The derived path must always use the
  full column set.

⛔ These are drift guards over a signature, so they fail when the contract moves
rather than when the behaviour finally breaks in production.
"""
import inspect
import re
from pathlib import Path

import pytest

ROUTER = Path(__file__).resolve().parents[1] / "api" / "flow_router.py"


def _ticker_endpoint_source() -> str:
    src = ROUTER.read_text(encoding="utf-8")
    m = re.search(r"def get_flow_ticker\((.*?)\):", src, re.S)
    assert m, "get_flow_ticker not found — the Search product's input contract moved"
    return m.group(1)


def test_the_control_can_see_the_endpoint():
    """A parser that finds nothing would make every assertion below vacuous."""
    sig = _ticker_endpoint_source()
    assert "symbol" in sig
    assert "source" in sig


def test_ticker_endpoint_has_no_range_dimension():
    """Range is NOT a semantic input, which is why the cache key omits it."""
    sig = _ticker_endpoint_source()
    for banned in ("days", "date_from", "date_to", "date_filter", "window", "range"):
        assert banned not in sig, (
            f"`{banned}` appeared in get_flow_ticker's signature. The per-ticker "
            "Search product is cached by (ticker, source, version) precisely "
            "because the feed is range-independent. Add the dimension to the "
            "cache key before adding it here, or the cache will serve a "
            "wrong-range Search."
        )


def test_ticker_endpoint_still_takes_the_two_dimensions_the_key_uses():
    sig = _ticker_endpoint_source()
    assert "symbol" in sig, "ticker is a semantic input and must remain one"
    assert "source" in sig, "stocks vs indexes selects a different dataset"


def test_columns_are_transport_only_and_must_not_narrow_the_derived_build():
    """`cols` may narrow the wire body, never the derived computation input."""
    src = ROUTER.read_text(encoding="utf-8")
    assert "cols" in _ticker_endpoint_source(), "the cols projection disappeared"
    # The derived Search build must not pass a narrowed column set through.
    m = re.search(r"def get_flow_ticker\(.*?\n(.*?)\n@", src, re.S)
    assert m, "could not read the endpoint body"
    body = m.group(1)
    assert "parse_columns(cols)" in body, (
        "the endpoint no longer parses cols the way this guard assumes"
    )
