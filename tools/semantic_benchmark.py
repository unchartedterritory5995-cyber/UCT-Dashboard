"""Wave L Slice 5 — the semantic retrieval benchmark. MEASUREMENT ONLY.

⛔⛔ NOTHING IS ACTIVATED BY THIS FILE. No Notebook content is embedded in
production, nothing is written to a member database, and no external endpoint is
contacted: the local arm loads `all-MiniLM-L6-v2` from the on-disk HuggingFace
cache with `HF_HUB_OFFLINE=1`. The ZDR question that gates external embeddings
(risk_voice_embeddings_default_retention) is untouched, because no member text
leaves this machine.

THE QUESTION (§32): *is LOCAL semantic retrieval credible enough to anchor the
next Search/Ask wave?* — not "did embeddings find similar text".

⛔ THE BENCHMARK IS NOT RIGGED TOWARD SEMANTICS. Wave K's real failure class is
in here (a query whose words do not appear in the evidence that answers it), and
so are LEXICAL CONTROLS where exact matching should win and semantic similarity
is expected to blur: an exact ticker, a verbatim phrase, a specific number, and
a near-miss distractor. A benchmark where the new thing cannot lose measures
nothing.

    python tools/semantic_benchmark.py                  # full run
    python tools/semantic_benchmark.py --lexical-only   # no model needed

Writes tools/semantic_benchmark_out/report.json.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sqlite3
import statistics
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

OUT_DIR = pathlib.Path(__file__).parent / "semantic_benchmark_out"

# ── The corpus: Notebook-shaped research passages. ──────────────────────────
# Deliberately written the way a member's captured evidence actually reads —
# publisher prose and the member's own notes — not as keyword bait.
CORPUS: list[tuple[str, str]] = [
    ("d01", "Management guided to gross margin normalization through fiscal 2027 as "
            "the supply agreement rolls off."),
    ("d02", "We expect unit economics to compress as competitive pricing pressure "
            "builds in the mid-tier segment."),
    ("d03", "Roughly 68% of revenue came from three customers in the last fiscal "
            "year, with the largest at 31%."),
    ("d04", "A prolonged export-control regime affecting advanced accelerators would "
            "curtail addressable demand in mainland China."),
    ("d05", "Operating leverage improved: opex grew 4% against 19% revenue growth."),
    ("d06", "The company repurchased $2.1bn of stock during the quarter."),
    ("d07", "NVDA remains my largest position at 8.4% of the book."),
    ("d08", "Inventory days rose from 78 to 96, which management attributed to "
            "staging ahead of the product transition."),
    ("d09", "Key risk: a single foundry supplies substantially all leading-edge "
            "capacity, and any disruption there is not diversifiable."),
    ("d10", "Free cash flow conversion held above 90% despite the working capital "
            "build."),
    ("d11", "Litigation with a former licensing partner remains unresolved and could "
            "result in a material adverse outcome."),
    ("d12", "Backlog coverage extends into the second half, but bookings growth "
            "decelerated sequentially for the second consecutive quarter."),
    ("d13", "I think the margin story is more fragile than consensus assumes given "
            "HBM pricing."),
    ("d14", "Guidance implies revenue of $41.0bn to $43.0bn for the coming quarter."),
    ("d15", "Dependence on a narrow set of hyperscale buyers concentrates commercial "
            "outcomes in very few purchasing decisions."),
    ("d16", "Tariff escalation and cross-strait tension are the principal "
            "non-operational threats to the manufacturing footprint."),
    ("d17", "Headcount grew 12% year over year, concentrated in engineering."),
    ("d18", "The dividend was raised 8% and the payout ratio remains under 20%."),
    ("d19", "Profitability could be squeezed if input costs rise faster than the "
            "company can reprice contracts."),
    ("d20", "Segment disclosure changed this year, so prior-period comparisons are "
            "not like for like."),
    ("d21", "AMD is the closest comparable on gross margin trajectory."),
    ("d22", "Cash and equivalents stood at $43.2bn at quarter end."),
    ("d23", "Management declined to reaffirm the prior full-year framework, which I "
            "read as a soft negative."),
    ("d24", "Customer concentration has increased every year since 2023."),
]

# ── The queries, with ground truth. ─────────────────────────────────────────
# kind: "low_overlap"  — the Wave K failure class: right answer, wrong words
#       "lexical"      — exact matching SHOULD win; semantics may blur
#       "no_answer"    — nothing in the corpus answers it; finding something is
#                        a FALSE POSITIVE and the most expensive error here
QUERIES: list[dict] = [
    {"q": "margin pressure", "kind": "low_overlap", "relevant": {"d01", "d02", "d13", "d19"}},
    {"q": "what could go wrong", "kind": "low_overlap",
     "relevant": {"d04", "d09", "d11", "d16", "d23"}},
    {"q": "too reliant on a handful of buyers", "kind": "low_overlap",
     "relevant": {"d03", "d15", "d24"}},
    {"q": "profitability squeeze", "kind": "low_overlap", "relevant": {"d02", "d19", "d01"}},
    {"q": "geopolitical exposure", "kind": "low_overlap", "relevant": {"d04", "d16"}},
    {"q": "supply chain single point of failure", "kind": "low_overlap",
     "relevant": {"d09"}},
    {"q": "is demand slowing", "kind": "low_overlap", "relevant": {"d12", "d23"}},

    # ── Lexical controls: exact tokens the member typed on purpose. ─────────
    {"q": "NVDA", "kind": "lexical", "relevant": {"d07"}},
    {"q": "inventory days", "kind": "lexical", "relevant": {"d08"}},
    {"q": "buyback repurchased", "kind": "lexical", "relevant": {"d06"}},
    {"q": "dividend payout ratio", "kind": "lexical", "relevant": {"d18"}},
    {"q": "AMD", "kind": "lexical", "relevant": {"d21"}},
    {"q": "free cash flow conversion", "kind": "lexical", "relevant": {"d10"}},

    # ── No-answer: the corpus genuinely does not discuss these. ─────────────
    {"q": "zebra husbandry techniques", "kind": "no_answer", "relevant": set()},
    {"q": "what is the CEO's home address", "kind": "no_answer", "relevant": set()},
    {"q": "quantum error correction thresholds", "kind": "no_answer", "relevant": set()},
]

K = 5


# ── Arm A: the product's own deterministic lexical retrieval ────────────────
def build_lexical(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE VIRTUAL TABLE docs USING fts5(doc_id, text)")
    conn.executemany("INSERT INTO docs (doc_id, text) VALUES (?,?)", CORPUS)
    conn.commit()


def lexical_search(conn, query: str, k: int = K) -> list[str]:
    """⭐ Uses the PRODUCT's `ask_match_expr`, not a re-invented query builder —
    otherwise the baseline is a strawman rather than what actually ships."""
    from api.services.journal_two.ask_retrieval import ask_match_expr
    expr = ask_match_expr(query)
    if not expr:
        return []
    try:
        rows = conn.execute(
            "SELECT doc_id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs) LIMIT ?",
            (expr, k)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [r[0] for r in rows]


# ── Arm B: local semantic ───────────────────────────────────────────────────
class LocalSemantic:
    def __init__(self) -> None:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        import logging
        logging.getLogger("transformers").setLevel(logging.ERROR)
        from sentence_transformers import SentenceTransformer
        t0 = time.perf_counter()
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2",
                                         device="cpu")
        self.load_s = time.perf_counter() - t0
        self.ids = [d for d, _ in CORPUS]
        t0 = time.perf_counter()
        self.mat = self.model.encode([t for _, t in CORPUS], normalize_embeddings=True,
                                     batch_size=32, show_progress_bar=False)
        self.index_s = time.perf_counter() - t0

    def search(self, query: str, k: int = K, floor: float = 0.25) -> list[tuple[str, float]]:
        import numpy as np
        v = self.model.encode([query], normalize_embeddings=True)[0]
        sims = self.mat @ v
        order = np.argsort(-sims)[:k]
        # ⛔ A FLOOR IS REQUIRED, and choosing it is the whole no-answer story.
        # Cosine similarity always returns a nearest neighbour, so without a
        # floor every unanswerable question retrieves the top-5 anyway and the
        # model is handed evidence to hallucinate from.
        return [(self.ids[i], float(sims[i])) for i in order if sims[i] >= floor]


# ── Arm C: hybrid (reciprocal rank fusion) ──────────────────────────────────
def hybrid(lex: list[str], sem: list[tuple[str, float]], k: int = K) -> list[str]:
    """RRF: rank-based, so it needs no shared score scale between the arms.
    ⛔ It also inherits the semantic floor — an empty semantic list contributes
    nothing, which is what keeps no-answer behaviour from degrading."""
    scores: dict[str, float] = {}
    for r, d in enumerate(lex):
        scores[d] = scores.get(d, 0.0) + 1.0 / (60 + r + 1)
    for r, (d, _s) in enumerate(sem):
        scores[d] = scores.get(d, 0.0) + 1.0 / (60 + r + 1)
    return [d for d, _ in sorted(scores.items(), key=lambda kv: -kv[1])][:k]


def metrics(results: list[str], relevant: set[str]) -> dict:
    hits = [d for d in results if d in relevant]
    recall = len(hits) / len(relevant) if relevant else None
    precision = len(hits) / len(results) if results else (1.0 if not relevant else 0.0)
    rr = 0.0
    for i, d in enumerate(results):
        if d in relevant:
            rr = 1.0 / (i + 1)
            break
    return {"recall": recall, "precision": precision, "rr": rr,
            "returned": len(results), "hits": len(hits)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lexical-only", action="store_true")
    ap.add_argument("--floor", type=float, default=0.25)
    args = ap.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(":memory:")
    t0 = time.perf_counter()
    build_lexical(conn)
    lex_index_s = time.perf_counter() - t0

    sem = None
    if not args.lexical_only:
        try:
            sem = LocalSemantic()
        except Exception as e:                                   # noqa: BLE001
            print(f"local semantic arm unavailable: {e}", file=sys.stderr)

    rows = []
    lat = {"lexical": [], "semantic": [], "hybrid": []}
    for spec in QUERIES:
        q, kind, rel = spec["q"], spec["kind"], spec["relevant"]

        t0 = time.perf_counter(); lex = lexical_search(conn, q); lat["lexical"].append(time.perf_counter() - t0)

        semr: list[tuple[str, float]] = []
        if sem:
            t0 = time.perf_counter(); semr = sem.search(q, floor=args.floor); lat["semantic"].append(time.perf_counter() - t0)

        t0 = time.perf_counter(); hyb = hybrid(lex, semr) if sem else lex; lat["hybrid"].append(time.perf_counter() - t0)

        rows.append({
            "query": q, "kind": kind, "relevant": sorted(rel),
            "lexical": {"results": lex, **metrics(lex, rel)},
            "semantic": {"results": [d for d, _ in semr],
                         "scores": [round(s, 3) for _, s in semr],
                         **metrics([d for d, _ in semr], rel)} if sem else None,
            "hybrid": {"results": hyb, **metrics(hyb, rel)} if sem else None,
        })

    def agg(kind: str, arm: str, field: str):
        vals = [r[arm][field] for r in rows
                if r["kind"] == kind and r[arm] and r[arm][field] is not None]
        return round(statistics.mean(vals), 3) if vals else None

    summary = {}
    for kind in ("low_overlap", "lexical"):
        summary[kind] = {
            arm: {"recall@5": agg(kind, arm, "recall"),
                  "precision@5": agg(kind, arm, "precision"),
                  "mrr": agg(kind, arm, "rr")}
            for arm in ("lexical", "semantic", "hybrid")
        }
    # ⛔ For no-answer questions the ONLY good outcome is returning nothing.
    summary["no_answer"] = {
        arm: {"false_positive_queries": sum(
            1 for r in rows if r["kind"] == "no_answer" and r[arm] and r[arm]["returned"] > 0)}
        for arm in ("lexical", "semantic", "hybrid")
    }

    ops = {
        "lexical_index_seconds": round(lex_index_s, 4),
        "corpus_docs": len(CORPUS),
        "query_latency_ms": {a: (round(statistics.mean(v) * 1000, 2) if v else None)
                             for a, v in lat.items()},
    }
    if sem:
        import numpy as np
        hub = pathlib.Path.home() / ".cache" / "huggingface" / "hub"
        mdir = hub / "models--sentence-transformers--all-MiniLM-L6-v2"
        size = sum(f.stat().st_size for f in mdir.rglob("*") if f.is_file()) if mdir.exists() else None
        ops.update({
            "model": "all-MiniLM-L6-v2 (local, offline)",
            "model_load_seconds": round(sem.load_s, 2),
            "embed_index_seconds": round(sem.index_s, 3),
            "embed_dims": int(sem.mat.shape[1]),
            "index_bytes_float32": int(np.prod(sem.mat.shape) * 4),
            "model_on_disk_bytes": size,
            "semantic_floor": args.floor,
        })

    report = {"summary": summary, "ops": ops, "queries": rows}
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("=== LOW-OVERLAP (the Wave K failure class) ===")
    for arm, m in summary["low_overlap"].items():
        print(f"  {arm:9} recall@5={m['recall@5']} precision@5={m['precision@5']} mrr={m['mrr']}")
    print("=== LEXICAL CONTROLS (exact matching should win) ===")
    for arm, m in summary["lexical"].items():
        print(f"  {arm:9} recall@5={m['recall@5']} precision@5={m['precision@5']} mrr={m['mrr']}")
    print("=== NO-ANSWER (returning anything is a false positive) ===")
    for arm, m in summary["no_answer"].items():
        print(f"  {arm:9} false-positive queries: {m['false_positive_queries']}/3")
    print("=== OPS ===")
    for k2, v in ops.items():
        print(f"  {k2}: {v}")
    print(f"\nreport: {OUT_DIR / 'report.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
