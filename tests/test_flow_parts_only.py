"""`--only` is an EMISSION filter, never a computation filter.

WHY IT EXISTS, measured on prod across four consecutive RTH version rolls:

    parts built in 32999 ms :: spawn+run=32976ms
                               (node parse=1332ms process=4980ms) gzip=949ms
                               stdout=23764KB

Node's own accounted work is ~6.3 s. The other ~26 s is process startup plus
piping 13.9 MB of CSV in and 23.8 MB of parts OUT — and most of that output is
parts first paint never reads (`all_trades` 1,246 KB, `all_directional` 566 KB
and `WATCH` 478 KB gzipped alone). The version rolls every 60 s, so preparation
kept losing the race and members fell back to the 8-12 MB raw tape.

⛔ THE ENTIRE SAFETY ARGUMENT IS THAT THE EMITTED PARTS ARE UNCHANGED.
`processFlowData` still runs in full and `partsFrom(D)` is untouched; only the
serialisation loop is filtered. These tests run the REAL built bundle twice —
once unfiltered, once filtered — and compare the bytes, because a filter that
quietly altered a part would be a data defect wearing a performance ticket.
"""
import pathlib
import subprocess

import pytest

from api.services import flow_aggregate as fa

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "app" / "src" / "pages" / "optionsFlow" / "__fixtures__" / "flow-sample.csv"


def _frames(raw: bytes) -> dict:
    """Parse the length-prefixed frame protocol the bundle writes."""
    out, i = {}, 0
    while i < len(raw):
        nl = raw.index(b"\n", i)
        header = raw[i:nl].decode()
        parts = header.rsplit(" ", 1)
        name, length = parts[0], int(parts[1])
        body = raw[nl + 1: nl + 1 + length]
        out[name] = body
        i = nl + 1 + length + 1
    return out


def _run(only=None):
    bundle = fa.bundle_path()
    if not pathlib.Path(bundle).exists():
        pytest.skip("flow-facts bundle not built")
    argv = [fa.node_bin(), bundle, "aggregate", "--split-frames"]
    if only:
        argv.append("--only=" + ",".join(only))
    proc = subprocess.run(argv, input=FIXTURE.read_bytes(),
                          capture_output=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[:400]
    return _frames(proc.stdout)


@pytest.fixture(scope="module")
def full():
    return _run()


def test_CONTROL_the_unfiltered_build_really_emits_several_parts(full):
    """Without this, every comparison below could pass against a bundle that
    emits nothing at all."""
    parts = [k for k in full if k.startswith("PART ")]
    assert len(parts) >= 3, f"only got {parts}"
    assert "STATS" in full
    assert "PART bootstrap" in full


def test_only_bootstrap_emits_bootstrap_BYTE_FOR_BYTE(full):
    """⛔ THE SAFETY PROPERTY. The filter must change what is SENT, never what is
    computed — so the filtered bootstrap has to be identical to the unfiltered
    one, byte for byte."""
    filtered = _run(("bootstrap",))
    assert filtered["PART bootstrap"] == full["PART bootstrap"]


def test_first_paint_parts_are_identical_under_the_filter(full):
    filtered = _run(fa.FIRST_PAINT_PARTS)
    for name in fa.FIRST_PAINT_PARTS:
        key = f"PART {name}"
        if key in full:                       # TOP_PICKS needs an ETF replica
            assert filtered[key] == full[key], f"{name} changed under --only"


def test_the_filter_actually_DROPS_the_rest(full):
    """The whole point: a filtered build must be smaller. If it emitted
    everything anyway the IPC cost this exists to remove would still be paid."""
    filtered = _run(("bootstrap",))
    dropped = set(k for k in full if k.startswith("PART ")) - set(filtered)
    assert dropped, "the filter emitted every part — it saves nothing"
    assert sum(len(v) for v in filtered.values()) < sum(len(v) for v in full.values())


def test_STATS_is_ALWAYS_emitted(full):
    """⛔ `availableDates` lives in stats, and the date-range picker renders only
    when that calendar is non-empty — dropping stats would make the control
    disappear, which is a defect this workstream has already shipped once."""
    filtered = _run(("bootstrap",))
    assert "STATS" in filtered
    # ⛔ COMPARED FIELD-BY-FIELD, MINUS THE STOPWATCH. Two runs legitimately
    # differ in `processMs`/`totalMs` — they are how long THAT run took. Asserting
    # byte-equality made this fail for a reason that has nothing to do with the
    # filter, so compare the DATA and name the fields that are allowed to move.
    import json
    a, b = json.loads(full["STATS"]), json.loads(filtered["STATS"])
    # ⛔ DERIVED, NOT ENUMERATED. My first version hand-listed
    # {processMs, totalMs} and the test went flaky the moment `parseMs` — a
    # third stopwatch — happened to differ. Every timing field this payload
    # carries ends in `Ms`, so name the PROPERTY instead of the members.
    timing = {k for k in a if k.endswith("Ms")}
    assert set(a) == set(b)
    differing = {k for k in a if a[k] != b.get(k)}
    assert differing <= timing, f"the filter changed stats data: {differing - timing}"
    # CONTROL: the payload really is substantial, so this is not comparing {}.
    assert len(set(a) - timing) > 3


def test_an_unknown_name_in_only_drops_everything_rather_than_leaking(full):
    """Fails closed: the caller gets no parts, not all of them. A filter that
    silently ignored a typo would reintroduce the full 23.8 MB pipe with nobody
    noticing."""
    filtered = _run(("nonsense",))
    assert not [k for k in filtered if k.startswith("PART ")]
    assert "STATS" in filtered


def test_first_paint_parts_is_what_the_client_actually_fetches():
    """⛔ Derived, not retyped. The client's first paint asks for bootstrap +
    TOP_PICKS (SERVER_TOPPICKS_PARTS in flowParts.js); if these two lists ever
    disagree the preparer warms a set nobody requests and every load falls to
    the raw tape while every counter reads healthy."""
    js = (REPO / "app" / "src" / "pages" / "optionsFlow" / "flowParts.js").read_text(encoding="utf-8")
    import re
    m = re.search(r"SERVER_TOPPICKS_PARTS\s*=\s*Object\.freeze\(\[([^\]]*)\]", js)
    assert m, "could not find SERVER_TOPPICKS_PARTS in flowParts.js"
    client = tuple(x.strip().strip("'\"") for x in m.group(1).split(",") if x.strip())
    assert set(client) == set(fa.FIRST_PAINT_PARTS), (
        f"client first paint fetches {client} but the preparer warms "
        f"{fa.FIRST_PAINT_PARTS}")
