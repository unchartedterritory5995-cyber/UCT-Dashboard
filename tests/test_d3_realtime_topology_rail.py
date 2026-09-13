"""D3 CP1 — RATIFICATION MADE CHECKABLE. Zero runtime change.

GATE-D3 CP1, approval fingerprint `00ebb5e80`, owner-signed 2026-09-12:

    CP1 - RATIFICATION ONLY, MADE CHECKABLE. A rail that pins the
    one-connection-per-key invariant and the topology exactly as documented.
    NO RUNTIME CHANGE: no new socket, no new subscriber, no change to any
    existing stream. If the rail and the documentation disagree, the DOCUMENT
    is what gets corrected - the rail reports what is, and a rail written to
    match a stale doc is worse than no rail.

⭐ THE SCOPE'S LAST CLAUSE IS THE WHOLE DESIGN. This rail reads SOURCE and
asserts what the source does. Three documented claims were already false when it
was written (GATE-D3 §2's counter-finding), and the fix was to correct
`CLAUDE.md`, never to soften the assertions.

⛔ WHAT D3 CP1 DOES NOT DO: it opens no socket, adds no subscriber, and imports
nothing at module scope that would. Every check below is a text/AST read of the
files on disk.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: ⛔ THREE VENDOR SOCKETS, THREE OWNERS. This is the topology D3 ratifies. A
#: fourth appearing, or one of these changing vendor, must fail here BY NAME —
#: "which vendor is on which socket" is exactly the fact CLAUDE.md got wrong.
TOPOLOGY = {
    "api/services/realtime_stream.py": {
        "vendor": "finnhub",
        "url_fragment": "wss://ws.finnhub.io",
        "carries": "tick-by-tick equity trades feeding the in-memory price store",
    },
    "api/services/bar_stream.py": {
        "vendor": "massive",
        "url_fragment": "wss://socket.massive.com/stocks",
        "carries": "minute bar aggregates, owner-refcounted for multiple consumers",
    },
    "api/massive_ws_worker.py": {
        "vendor": "massive",
        "url_fragment": "wss://socket.massive.com/options",
        "carries": "the OPRA options tape, on flow-worker",
    },
}


def _src(rel: str) -> str:
    p = ROOT / rel
    assert p.exists(), f"the topology names a file that does not exist: {rel}"
    return p.read_text(encoding="utf-8", errors="replace")


def _code_only(rel: str) -> str:
    """⛔ CODE, NEVER PROSE. Every docstring blanked, then unparsed — a URL in a
    comment must not satisfy a check about which socket a module opens."""
    tree = ast.parse(_src(rel))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) \
                    and isinstance(b[0].value.value, str):
                b[0].value.value = ""
    return ast.unparse(tree)


# ───────────────────────────── the topology ─────────────────────────────────

@pytest.mark.parametrize("rel", sorted(TOPOLOGY))
def test_each_socket_module_opens_the_vendor_the_topology_names(rel):
    code = _code_only(rel)
    frag = TOPOLOGY[rel]["url_fragment"]
    assert frag in code, (
        f"{rel} no longer opens {frag}. D3's topology says it carries "
        f"{TOPOLOGY[rel]['carries']}. Either the module moved vendor — which is a "
        f"real change needing its own line — or this rail is now the stale artifact.")


def test_the_CONTROL_a_url_that_appears_only_in_PROSE_does_not_count():
    """NON-VACUITY, and it is the one that matters here: `bar_stream.py`'s
    DOCSTRING names its URL too, so a naive text search would pass even if the
    constant were deleted."""
    raw = _src("api/services/bar_stream.py")
    stripped = _code_only("api/services/bar_stream.py")
    assert "Connects to wss://socket.massive.com/stocks" in raw, (
        "the prose this control depends on has moved; re-derive the control")
    assert "Connects to wss://socket.massive.com/stocks" not in stripped, (
        "the docstring stripper is not stripping — every check above may be "
        "passing on a comment")


def test_there_is_no_FOURTH_vendor_socket_anywhere_under_api():
    """⛔ A new socket is a D3 decision, not an implementation detail."""
    found = {}
    for p in sorted((ROOT / "api").rglob("*.py")):
        rel = p.relative_to(ROOT).as_posix()
        if "__pycache__" in rel:
            continue
        try:
            code = _code_only(rel)
        except SyntaxError:
            continue
        for m in re.findall("wss://[A-Za-z0-9._/-]+", code):
            found.setdefault(rel, set()).add(m.split("?")[0])
    unexpected = {r: sorted(u) for r, u in found.items() if r not in TOPOLOGY}
    assert not unexpected, (
        f"a websocket URL appears in a module the D3 topology does not name: {unexpected}. "
        "Add it to TOPOLOGY with what it carries, or remove it.")


# ─────────────────── the one-connection-per-key invariant ───────────────────

def test_the_one_connection_gate_is_at_the_STARTUP_entry_point():
    """⛔ THE LAYER IS THE INVARIANT, not merely the presence of a guard.

    GATE-D3 §2 and the source comment both say the gate lives in `start_stream`
    and NOT in the reconnect loop, for two reasons: the question "should this
    PROCESS stream at all" is answered once at boot, and putting it inside
    `_run_websocket` short-circuits the connect/backoff/circuit-breaker tests
    that drive that coroutine directly.
    """
    tree = ast.parse(_src("api/services/realtime_stream.py"))
    fns = {n.name: n for n in ast.walk(tree)
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assert "start_stream" in fns, "start_stream is gone — the entry point moved"

    def mentions_guard(node) -> bool:
        return any(
            (isinstance(c, ast.ImportFrom) and "vendor_socket_guard" in (c.module or ""))
            or (isinstance(c, ast.alias) and "vendor_socket_guard" in (c.name or ""))
            or (isinstance(c, ast.Name) and c.id == "vendor_socket_guard")
            or (isinstance(c, ast.Attribute) and isinstance(c.value, ast.Name)
                and c.value.id == "vendor_socket_guard")
            for c in ast.walk(node))

    assert mentions_guard(fns["start_stream"]), (
        "start_stream no longer consults vendor_socket_guard. On 2026-08-10 six "
        "forgotten dev servers held this socket with the production key; prod was "
        "kicked and looped into a circuit breaker for hours with live charts dead.")

    if "_run_websocket" in fns:
        assert not mentions_guard(fns["_run_websocket"]), (
            "the guard has moved INTO the reconnect loop. That re-litigates a boot "
            "decision on every reconnect and short-circuits the connect/backoff/"
            "circuit-breaker tests that drive this coroutine directly.")


def test_the_bar_stream_second_consumer_seam_is_owner_refcounted():
    """D3 §2's first measurement: two independent consumers share ONE connection
    because subscribe carries a per-symbol OWNER, so one unsubscribe cannot cut
    the other's feed."""
    tree = ast.parse(_src("api/services/bar_stream.py"))
    fns = {n.name: n for n in ast.walk(tree)
           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assert "subscribe_symbols" in fns, "the second-consumer seam is gone"
    args = [a.arg for a in fns["subscribe_symbols"].args.args
            + fns["subscribe_symbols"].args.kwonlyargs]
    assert "owner" in args, (
        "subscribe_symbols lost its `owner` parameter — without it one consumer's "
        "unsubscribe cuts the other's feed, which is the whole reason the refcount exists")
    assert "add_trade_listener" in fns, "the callback door the second consumer uses is gone"


# ───────────────── the documented numbers, read from source ─────────────────

def test_the_hysteresis_constants_are_what_the_frontend_actually_declares():
    """⚰️ CLAUDE.md said the disengage was 300 s. The constant reads 150000 ms.
    The DOC was corrected; this pins the source so the next drift is caught here."""
    js = (ROOT / "app/src/lib/barsStreamManager.js").read_text(encoding="utf-8")
    stale = re.search("BARS_LIVE_STALE_MS = ([0-9]+)", js)
    dis = re.search("BARS_LIVE_DISENGAGE_MS = ([0-9]+)", js)
    assert stale and dis, "the hysteresis constants are no longer declared by those names"
    assert int(stale.group(1)) == 120000, stale.group(1)
    assert int(dis.group(1)) == 150000, (
        f"BARS_LIVE_DISENGAGE_MS is now {dis.group(1)}; D3 ratified 150000. A change "
        "here alters when the chart hands the developing bar back to Finnhub.")
    assert int(dis.group(1)) > int(stale.group(1)), (
        "disengage must exceed engage or the hysteresis inverts and the feed thrashes")


def test_CLAUDE_md_no_longer_attributes_the_wrong_vendor_to_realtime_stream():
    """⚰️ THE DOCUMENT WAS THE THING THAT WAS WRONG, and the scope says so:
    `CLAUDE.md` named Massive/Polygon and `wss://socket.polygon.io/stocks` for
    `realtime_stream.py`, which is Finnhub. Corrected in the same commit as this
    rail. This asserts the correction, so it cannot silently regress."""
    md = (ROOT / "CLAUDE.md").read_text(encoding="utf-8", errors="replace")
    # ⚰️ THE TOMBSTONE KEEPS THE RETIRED CLAIM VERBATIM, so the wrong vendor
    # name legitimately still appears on the line. Read only the CLAIM — everything
    # before the ⚰️ marker. A rail that forbade the word outright would forbid the
    # idiom that records the correction, which is the opposite of what it is for.
    checked = 0
    for line in md.splitlines():
        if "realtime_stream.py" not in line or "—" not in line:
            continue
        claim = line.split("⚰️")[0]
        checked += 1
        assert "Polygon" not in claim and "Massive" not in claim, (
            f"CLAUDE.md again attributes a Massive/Polygon socket to "
            f"realtime_stream.py, which connects to Finnhub: {claim.strip()!r}")
        # ⚠️ Case-insensitive on purpose: one of the two lines names the vendor
        # only through `wss://ws.finnhub.io` and `FINNHUB_API_KEY`, which IS naming
        # it. A rail demanding the capitalised word would fail a correct line.
        assert "finnhub" in claim.lower(), (
            f"the line names realtime_stream.py without naming its vendor in any "
            f"form: {claim.strip()!r}")
    assert checked, (
        "no CLAUDE.md line describes realtime_stream.py any more — this check is "
        "passing over an empty set, which is not the same as passing")
