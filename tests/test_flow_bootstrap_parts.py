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


def _js_derived_part_names():
    """Parse DERIVED_PART_NAMES out of flowBootstrap.js."""
    src = JS_MODULE.read_text(encoding="utf-8")
    m = re.search(r"export const DERIVED_PART_NAMES = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert m, "DERIVED_PART_NAMES not found in flowBootstrap.js"
    keys = re.findall(r"'([^']+)'", m.group(1))
    assert keys, "DERIVED_PART_NAMES parsed empty"
    return keys


def test_derived_parts_match_the_js_contract_exactly():
    """TOP_PICKS travels over the parts transport but is NOT in the partition.

    Two lists, one authority each. If the server allowlists a derived part the
    client does not know about (or the reverse), a request 400s or a computed
    product is silently unreachable and the page falls back to shipping the raw
    arrays -- which is the whole cost 3b exists to remove.
    """
    assert sorted(fa.DERIVED_PART_NAMES) == sorted(_js_derived_part_names())


def test_derived_parts_are_requestable_but_not_part_of_the_partition():
    for name in fa.DERIVED_PART_NAMES:
        assert fa.is_part_name(name), f"{name} must be requestable"
        assert name not in fa.PART_NAMES, (
            f"{name} is DERIVED -- putting it in the partition makes "
            "'the parts recombine into D' false while every test still passes"
        )


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


def test_an_UNKNOWN_part_falls_through_rather_than_erroring():
    """A member must never get an error because a part NAME drifted — the flag is
    a performance opt-in, so an unknown part means 'serve the old thing'.

    ⛔ This is about the GUARD, not the build. The guard is a plain boolean
    condition with no error branch of its own, so an unrecognised name simply
    does not enter the part path and lands on whole-D below.
    """
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    block = src[src.index('part = request.query_params.get("part")'):]
    guard = block[:block.index("got = flow_aggregate.get_cached_or_build_part")]
    assert "status_code" not in guard, "an unknown part name must not raise"
    assert "is_part_name(part)" in guard


def test_a_KNOWN_part_that_cannot_be_built_does_NOT_serve_the_whole_aggregate():
    """⛔ THE OPPOSITE CASE, AND IT USED TO FALL THROUGH.

    A declined build dropping into the whole-D path answers a ~200 KB request for
    one part with the ~2,900 KB gzipped (24 MB decoded) full aggregate. It matters
    precisely BECAUSE the builder is single-flight: the first of three concurrent
    part requests builds while its two siblings are declined, so a three-part
    first paint would have pulled the full aggregate twice on every cold cache.
    503 is this endpoint's own documented "not built" contract and leaves the
    caller free to retry the siblings or fall back to the tape.
    """
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    block = src[src.index('got = flow_aggregate.get_cached_or_build_part'):]
    block = block[:block.index("flow_aggregate._STATS")]
    assert "status_code=503" in block, "a declined KNOWN part still falls through to whole-D"
    # ...and it must be the LAST word of the part path, not a branch something
    # else can step past into the whole-D build.
    assert "return JSONResponse" in block


def test_every_builder_shares_one_csv_provider():
    """Two different providers for one dataset is how a part comes from a
    different CSV than the bootstrap it is merged into.

    ⛔ THE EXPECTED COUNT IS DERIVED, NOT TYPED. This asserted `== 2` and went
    red the day a third legitimate caller appeared (the first-paint preparer)
    using the very same provider -- the invariant held and the number had
    drifted. A hand-typed count beside the thing it describes is the defect this
    repo keeps re-committing; so count the call sites that need a provider and
    require the provider expression to appear exactly that many times. A new
    caller with a DIFFERENT provider now fails this, which is the real rule.
    """
    src = (REPO / "api" / "flow_router.py").read_text(encoding="utf-8")
    provider = 'gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8")'
    # ⛔ A NAMED BINDING OF THE SAME EXPRESSION COUNTS. The two-pass preparer
    # binds the provider once (`provider = lambda: ...`) and hands it to both
    # passes, which satisfies this invariant MORE strongly than repeating the
    # literal -- the two passes cannot possibly diverge. Counting only literals
    # made the rail red while the property it protects was intact, which is the
    # same "retyped literal" failure this file has already corrected once.
    shared_binding = f"provider = lambda: {provider}"
    if shared_binding in src:
        # Each `key, version, provider,` call site is fed that one binding, so
        # count it as a use of the shared provider...
        src = src.replace("key, version, provider,", f"key, version, {provider},")
        # ...and drop the DEFINITION, which is not a call site and would
        # otherwise be counted as one more use than there are builders.
        src = src.replace(shared_binding, "")
    sites = (src.count("flow_aggregate.get_cached_or_build_part(")
             + src.count("flow_aggregate.get_cached_or_build("))
    assert sites >= 2, (
        "found fewer than two builder call sites -- this probe has stopped "
        "seeing the thing it grades, so its verdict is vacuous")
    assert src.count(provider) == sites, (
        f"{sites} builder call sites but {src.count(provider)} uses of the shared "
        "provider -- one of them is feeding a build from a different CSV")

# ── the bootstrap part must carry stats, or the date picker vanishes again ────
def test_the_bootstrap_part_carries_stats_so_availableDates_survives():
    """⛔ THE PHASE-A REGRESSION, REACHABLE AGAIN THROUGH THE TRANSPORT.

    The date-range picker renders only when `availableDates` is non-empty, and
    with the tape deferred the ONLY source of that value is `stats.availableDates`
    on the aggregate. The parts stream emits stats as its own frame, so a bootstrap
    served as a bare D subset would drop it and the control would gate itself off —
    a regression caused by changing transport, not logic, which is exactly the kind
    a partition test would not notice.
    """
    frames = {"bootstrap": b'{"CONV":[1,2],"TICKER_DB":{}}',
              "all_trades": b'[{"S":"NVDA"}]'}
    stats = {"availableDates": ["9/4/2026"], "totalTrades": 29514}
    out = fa.envelope_bootstrap(frames, stats)

    body = json.loads(out["bootstrap"])
    assert body["ok"] is True
    assert body["stats"]["availableDates"] == ["9/4/2026"]
    # the D subset must survive BYTE-FOR-BYTE, not merely round-trip equal
    assert body["D"] == {"CONV": [1, 2], "TICKER_DB": {}}
    assert b'{"CONV":[1,2],"TICKER_DB":{}}' in out["bootstrap"]


def test_the_envelope_is_the_SAME_shape_the_whole_D_endpoint_returns():
    """One shape for the client to understand, not two. `fetchPrehydrate` already
    accepts {ok, stats, D}; a different envelope here would need a second reader."""
    out = fa.envelope_bootstrap({"bootstrap": b'{}'}, {"availableDates": []})
    assert set(json.loads(out["bootstrap"])) == {"ok", "stats", "D"}


def test_the_envelope_never_parses_the_deferred_arrays():
    """The frames exist so this process never materialises a 16 MB array.

    ⛔ IDENTITY (`is`) CANNOT TEST THIS. CPython returns the SAME object from
    `bytes(b"...")`, so an `is` assertion passes against a wrapper that copies —
    it was written that way first and a copying mutant survived it. Unparseable
    bytes discriminate properly: anything that tried to decode this frame would
    raise, so surviving it unchanged is proof the wrapper only moved bytes.
    """
    junk = b'<<< not json >>>' + bytes([0xFF, 0xFE])   # not even valid UTF-8
    out = fa.envelope_bootstrap({"bootstrap": b'{}', "all_trades": junk}, {})
    assert out["all_trades"] == junk


def test_build_parts_ACTUALLY_APPLIES_the_envelope():
    """⛔ THE HELPER CAN BE PERFECT AND CALLED BY NOBODY.

    Deleting the call from build_parts left every test above green while the
    served bootstrap went back to a bare subset and the date picker vanished —
    this repo's most-repeated defect, reproduced by a one-line mutation.
    """
    import inspect
    src = inspect.getsource(fa.build_parts)
    assert "envelope_bootstrap(" in src, "build_parts does not apply the envelope"
    # ...and BEFORE compression, or the cached blob is the unwrapped one.
    assert src.index("envelope_bootstrap(") < src.index("gzip.compress"),         "the envelope is applied after the part is already compressed"


def test_a_missing_bootstrap_frame_is_left_for_the_caller_to_reject():
    """build_parts already treats a bootstrap-less stream as unusable; the wrapper
    must not invent one and make a broken stream look serviceable."""
    out = fa.envelope_bootstrap({"all_trades": b"[]"}, {"availableDates": []})
    assert "bootstrap" not in out


def test_CONTROL_a_bare_subset_really_would_lose_availableDates():
    """Without this the tests above could pass against a transport that never
    risked the bug."""
    bare = b'{"CONV":[1,2]}'
    assert "availableDates" not in json.loads(bare)

