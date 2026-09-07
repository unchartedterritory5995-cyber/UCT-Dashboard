"""The bootstrap/parts transport for /api/flow/aggregate.

The endpoint has always returned everything `processFlowData` produced, because
that function's contract includes its own raw inputs. Measured on prod
2026-09-07: 23.83 MB, cf-cache-status DYNAMIC, 8.2 s cold. A consumption audit of
OptionsFlow.jsx found ~69% of it is not read until a specific tab is opened.

These tests cover the TRANSPORT: that parts are sliced without parsing, that the
allowlist cannot drift from the JS module that defines it, and that the flag
genuinely gates the new path. What is *in* each part is owned by
`flowBootstrap.test.js`, which re-derives it from the page itself.
"""
import json
import os
import re
import gzip
import pathlib

import pytest

from api.services import flow_aggregate as fa

REPO = pathlib.Path(__file__).resolve().parents[1]
JS_MODULE = REPO / "app" / "src" / "pages" / "optionsFlow" / "flowBootstrap.js"


# ── the allowlist is DERIVED from the JS, never retyped ──────────────────────
def _js_part_names() -> list[str]:
    """Parse PART_NAMES out of flowBootstrap.js: 'bootstrap' + DEFERRED_KEYS."""
    src = JS_MODULE.read_text(encoding="utf-8")
    m = re.search(r"export const DEFERRED_KEYS = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert m, "DEFERRED_KEYS not found in flowBootstrap.js"
    keys = re.findall(r"'([^']+)'", m.group(1))
    assert keys, "DEFERRED_KEYS parsed empty"
    return ["bootstrap"] + keys


def test_python_allowlist_matches_the_js_contract_exactly():
    """Two authorities over one value is the defect this repo pays for most.

    The server's allowlist and the client's PART_NAMES describe the same wire
    contract. If they drift, a surface asks for a part the server refuses and the
    page silently falls back to shipping the whole tape — fast in staging, slow
    in production, and green in every test that does not compare the two.
    """
    assert sorted(fa.PART_NAMES) == sorted(_js_part_names())


def test_the_control_can_actually_fail():
    """A parser that finds nothing would make the test above vacuously true."""
    names = _js_part_names()
    assert len(names) >= 5
    assert "bootstrap" in names and "all_trades" in names


def test_is_part_name_rejects_everything_outside_the_allowlist():
    # `part` reaches a cache key and the argv path of a subprocess. Unbounded
    # values there are how a query param becomes an injection surface.
    for good in fa.PART_NAMES:
        assert fa.is_part_name(good)
    for bad in ("", "clean_confirmed", "__proto__", "../../etc/passwd",
                "bootstrap; rm -rf /", "BOOTSTRAP", None):
        assert not fa.is_part_name(bad)


# ── frame reader: slices bytes, never parses them ────────────────────────────
def _frame(name: str, body: bytes) -> bytes:
    return b"PART " + name.encode() + b" " + str(len(body)).encode() + b"\n" + body + b"\n"


def test_frames_are_sliced_out_verbatim():
    a = json.dumps({"x": 1}).encode()
    b = json.dumps([1, 2, 3]).encode()
    stats = b'{"buildMs":1}'
    raw = b"STATS " + str(len(stats)).encode() + b"\n" + stats + b"\n" + _frame("bootstrap", a) + _frame("WATCH", b)
    got = fa._read_frames(raw)
    assert got["bootstrap"] == a
    assert got["WATCH"] == b
    assert got["__stats__"] == stats


def test_a_body_containing_newlines_is_still_sliced_correctly():
    """The length prefix is what makes this safe — a scanner looking for '\\n'
    would truncate any part whose JSON contains one."""
    body = b'{"a":"line1\\nline2","b":[1,\n2]}'
    got = fa._read_frames(_frame("bootstrap", body))
    assert got["bootstrap"] == body


def test_a_malformed_stream_yields_NOTHING_not_a_partial_set():
    """A half-read set would cache a payload missing arrays the page needs —
    worse than declining and falling back to the whole-D path.

    ⛔ The load-bearing case is TRUNCATION AFTER A GOOD FRAME. The three inputs
    below it fail before anything is collected, so they pass even against a
    reader that returns whatever it managed to read — mutation testing caught
    exactly that: swapping `return {}` for `pass` left this test green until the
    truncated-stream case was added.
    """
    good = _frame("bootstrap", b'{"x":1}')
    assert fa._read_frames(good + b"PART all_trades notanumber\nxx\n") == {}
    assert fa._read_frames(good + b"total garbage here\n") == {}
    # ...and the degenerate inputs, which must also yield nothing.
    assert fa._read_frames(b"garbage") == {}
    assert fa._read_frames(b"") == {}


def test_frames_are_returned_as_bytes_and_never_json_parsed():
    """The whole point of the format: a 20+ MB part must never become a Python
    object graph on a single-process pod that has OOM'd before."""
    body = json.dumps([{"S": "NVDA"}] * 50).encode()
    got = fa._read_frames(_frame("all_trades", body))
    assert isinstance(got["all_trades"], (bytes, bytearray))


# ── the flag actually gates it ───────────────────────────────────────────────
def test_parts_are_off_by_default(monkeypatch):
    monkeypatch.delenv("FLOW_BOOTSTRAP_ENABLED", raising=False)
    assert fa.parts_enabled() is False


def test_parts_enable_only_on_exactly_1(monkeypatch):
    for val, want in (("1", True), ("0", False), ("true", False), ("", False)):
        monkeypatch.setenv("FLOW_BOOTSTRAP_ENABLED", val)
        assert fa.parts_enabled() is want, val


# ── the endpoint wiring ──────────────────────────────────────────────────────
def test_the_endpoint_consults_the_flag_and_the_allowlist_before_serving_a_part():
    """Derived from the route source, not retyped: a part path that skipped either
    guard would serve the new payload to everyone the moment the code deployed."""
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    block = src[src.index('part = request.query_params.get("part")'):]
    block = block[:block.index("flow_aggregate._STATS")]
    assert "parts_enabled()" in block, "the part path does not check the flag"
    assert "is_part_name(part)" in block, "the part path does not check the allowlist"
    assert "get_cached_or_build_part" in block


def test_the_part_path_falls_through_rather_than_erroring():
    """A member must never get a 4xx because a part name drifted — the flag is a
    performance opt-in, so an unknown part means 'serve the old thing'."""
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    block = src[src.index('part = request.query_params.get("part")'):]
    block = block[:block.index("flow_aggregate._STATS")]
    assert "status_code=4" not in block and "status_code=5" not in block


def test_the_part_path_uses_the_same_csv_source_as_the_whole_D_path():
    """Two different providers for one dataset is how a part comes from a
    different CSV than the bootstrap it is merged into."""
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    provider = 'gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8")'
    assert src.count(provider) == 2, "part path and build_aggregate must share the provider"
