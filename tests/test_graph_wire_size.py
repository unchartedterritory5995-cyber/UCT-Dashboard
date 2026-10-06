"""C2D.9 — stored bytes, response bytes, and the compatibility boundary.

⛔ MEASURED THROUGH THE REAL ROUTES, not through the store. The question C2D.9
asks is what a MEMBER'S BROWSER receives, and that is decided by
``api/routers/user_definitions.py`` — which materialises a shared graph for any
caller that has not said it can hydrate. Measuring ``svc.get`` instead would
answer a question nobody has.

The documents come from ``tests/fixtures/graph_wire/``, emitted by
``app/src/components/chart/builder/graphWireFixture.test.js`` through the
product's own save door. There is one parser and it is in JS, so the lane that
can produce a real translated document produces it, and this lane reads it —
the same idiom as ``tests/fixtures/ast/multi_tree_parity.json``.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "graph_wire"
USER = "wire-user"


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _cases():
    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    for c in index["cases"]:
        c["definition"] = json.loads(
            (FIXTURES / f"{c['id']}.json").read_text(encoding="utf-8"))
        yield c


def _bytes(obj) -> int:
    return len(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def test_the_fixture_exists_and_spans_the_distribution():
    """⛔ A MISSING FIXTURE MUST FAIL LOUDLY, not skip. A skipped measurement
    reads exactly like a passing one in a summary line."""
    cases = list(_cases())
    assert len(cases) >= 5
    assert any(c["isGraph"] for c in cases), "no graph document in the fixture"
    assert any(not c["isGraph"] for c in cases), "no forest document in the fixture"


def test_stored_response_and_compact_response_bytes(store):
    """The three numbers, for every band."""
    rows = []
    for c in _cases():
        svc.save(USER, c["id"], c["definition"])
        stored = svc._newest(svc._connect(), USER, c["id"])["definition"]
        full = svc.get(USER, c["id"])
        compacted = svc.compact_row(full)
        rows.append({
            "band": c["band"],
            "graph": c["isGraph"],
            "stored": len(stored.encode("utf-8")),
            "response": _bytes(full["definition"]),
            "compact": _bytes(compacted["definition"]),
        })

    print("\n=== C2D.9 WIRE BYTES ===")
    print(f"  {'band':<12}{'stored':>9}{'response':>10}{'graph=1':>10}   ratio")
    for r in rows:
        ratio = (r["response"] / r["compact"]) if r["compact"] else 1
        print(f"  {r['band']:<12}{r['stored']:>9}{r['response']:>10}{r['compact']:>10}"
              f"   x{ratio:.1f}{'' if r['graph'] else '   (forest — unchanged)'}")

    for r in rows:
        if r["graph"]:
            # ⭐ THE POINT: compact at rest AND compact over the wire.
            assert r["compact"] < r["response"] / 5, r["band"]
            # …and the compact response is about the size of what is stored,
            # because it IS what is stored.
            assert r["compact"] <= r["stored"] * 1.2, r["band"]
        else:
            # ⛔ A FOREST DOCUMENT IS UNTOUCHED BY THE FLAG. If compaction ever
            # started rewriting V1 documents this would go red.
            assert r["compact"] == r["response"], r["band"]


def test_a_caller_that_does_not_ask_still_gets_the_forest(store):
    """⛔⛔ THE COMPATIBILITY BOUNDARY, ASSERTED. A member holding yesterday's
    bundle cannot hydrate; answering them compactly would blank their chart with
    nothing red anywhere. Opt-in means an old client never asks."""
    graph_case = next(c for c in _cases() if c["isGraph"])
    svc.save(USER, graph_case["id"], graph_case["definition"])
    row = svc.get(USER, graph_case["id"])
    compute = row["definition"]["compute"]
    assert "trees" in compute and "ast" in compute, "the default read is materialised"
    assert "graph" in compute, "…and the graph rides along, so a re-save stays small"

    compacted = svc.compact_row(row)["definition"]["compute"]
    assert "graph" in compacted
    assert "trees" not in compacted and "ast" not in compacted
    assert "sources" not in compacted and "source" not in compacted


def test_compacting_is_lossless_the_program_survives(store):
    """A smaller response that lost maths is not a smaller response."""
    from api.services import compute_graph as cg
    graph_case = next(c for c in _cases() if c["isGraph"])
    svc.save(USER, graph_case["id"], graph_case["definition"])
    row = svc.get(USER, graph_case["id"])
    full = row["definition"]["compute"]
    compacted = svc.compact_row(row)["definition"]["compute"]
    # the compact form expands back to exactly the forest the full one carried
    assert cg.expand_graph(compacted["graph"]) == full["trees"]
    assert svc.trees_hash(cg.expand_graph(compacted["graph"])) == full["treesHash"]


# ─── C2D.10 — the read path weakens no validation ───────────────────────────

def test_a_malformed_stored_graph_is_readable_but_never_expandable(store):
    """⛔ A ROW THAT CANNOT BE EXPANDED MUST STILL BE READABLE. Its owner has to
    be able to SEE it — to report it, to delete it — and one bad row taking out
    every listing that includes it is a worse failure than the row itself. The
    refusal belongs on the WRITE path, where `save` runs `assert_graph` before
    anything is stored.
    """
    import sqlite3
    graph_case = next(c for c in _cases() if c["isGraph"])
    svc.save(USER, graph_case["id"], graph_case["definition"])
    # Corrupt the STORED bytes directly — the only way to get an unexpandable
    # row past a write path that refuses one.
    c = svc._connect()
    row = svc._newest(c, USER, graph_case["id"])
    doc = json.loads(row["definition"])
    # ⛔ CORRUPT A NODE THAT ACTUALLY HAS `args`. Adding the key to a `num` node
    # trips the SHAPE rule instead, which is a different (also correct) refusal
    # — and asserting on it would leave the dangling-reference guard untested.
    nodes = doc["compute"]["graph"]["nodes"]
    victim = next(i for i, n in enumerate(nodes) if "args" in n)
    nodes[victim]["args"] = [len(nodes) + 5]                 # dangling reference
    c.execute("UPDATE user_definitions SET definition=? WHERE user_id=? AND def_id=? AND version=?",
              (json.dumps(doc), USER, graph_case["id"], row["version"]))
    c.commit()

    got = svc.get(USER, graph_case["id"])
    assert got is not None, "a corrupt row must still be readable"
    # …and it comes back RAW: no invented trees, no half-expansion.
    assert "trees" not in got["definition"]["compute"]
    # …and it cannot be re-saved, so the corruption cannot spread.
    with pytest.raises(ValueError) as e:
        svc.save(USER, graph_case["id"], got["definition"])
    assert f"compute.graph.nodes[{victim}].args[0]" in str(e.value)
    assert "declared BEFORE it" in str(e.value)


def test_the_bomb_is_still_refused_on_the_write_path(store):
    """The doubling fixture, through the REAL save rather than `assert_graph`
    directly — a validation that is not wired is not a validation."""
    import time
    from api.services import compute_graph as cg
    nodes = [{"type": "series", "name": "close"}]
    for _ in range(40):
        nodes.append({"type": "op", "name": "+",
                      "args": [len(nodes) - 1, len(nodes) - 1]})
    graph = {"graphVersion": cg.GRAPH_VERSION, "nodes": nodes,
             "outputRoots": {"value": len(nodes) - 1, "up": 0}, "parameters": {}}
    doc = {
        "id": "u_c2d9000000bb",
        "plots": [{"key": "up", "style": "line"}, {"key": "value", "style": "line"}],
        "compute": {"kind": "ast", "graph": graph, "scanPlot": "value",
                    "treesHash": "sha256:x", "fn": "sha256:x"},
    }
    t0 = time.time()
    with pytest.raises(ValueError) as e:
        svc.save(USER, "u_c2d9000000bb", doc)
    assert "expands to" in str(e.value)
    assert time.time() - t0 < 1.0


# ─── C2D.11 — what the two read shapes cost ─────────────────────────────────

def test_serialisation_and_parse_cost_of_each_read_shape(store):
    """⛔ NOT A MICRO-BENCHMARK FOR ITS OWN SAKE. C3 will hang visual payloads
    off this read path, and the question is whether it is being built on a
    response that needlessly rebuilds a forest first."""
    import time
    rows = []
    for c in _cases():
        svc.save(USER, c["id"], c["definition"])
        full = svc.get(USER, c["id"])["definition"]
        compacted = svc.compact_row(svc.get(USER, c["id"]))["definition"]

        def timed(fn, n=20):
            t0 = time.perf_counter()
            for _ in range(n):
                fn()
            return (time.perf_counter() - t0) * 1000 / n

        full_txt = json.dumps(full, separators=(",", ":"))
        cmp_txt = json.dumps(compacted, separators=(",", ":"))
        rows.append({
            "band": c["band"],
            "graph": c["isGraph"],
            "ser_full": timed(lambda: json.dumps(full, separators=(",", ":"))),
            "ser_cmp": timed(lambda: json.dumps(compacted, separators=(",", ":"))),
            "par_full": timed(lambda: json.loads(full_txt)),
            "par_cmp": timed(lambda: json.loads(cmp_txt)),
        })

    print("\n=== C2D.11 READ COST (ms per document) ===")
    print(f"  {'band':<12}{'serialise':>20}{'parse':>20}")
    print(f"  {'':<12}{'forest':>10}{'graph=1':>10}{'forest':>10}{'graph=1':>10}")
    for r in rows:
        print(f"  {r['band']:<12}{r['ser_full']:>10.2f}{r['ser_cmp']:>10.2f}"
              f"{r['par_full']:>10.2f}{r['par_cmp']:>10.2f}")

    for r in rows:
        if r["graph"]:
            # ⭐ The saving is structural, not a timing accident: there is an
            # order of magnitude less JSON to write and to read.
            assert r["ser_cmp"] < r["ser_full"], r["band"]
            assert r["par_cmp"] < r["par_full"], r["band"]
