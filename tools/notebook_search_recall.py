"""Measured recall of the Notebook's search on a labelled set (wave 10, lane 10E-1, clause 13c).

    python tools/notebook_search_recall.py                     # measure, print, compare to the baseline
    python tools/notebook_search_recall.py --json out.json     # ... and keep every query's ranking
    python tools/notebook_search_recall.py --write-baseline    # record the measurement as the baseline
    python tools/notebook_search_recall.py --self-check        # the planted-regression controls

WHAT IT MEASURES. The labelled set `docs/notebook/search-recall-set.json` (a synthetic trader
corpus -- no member's words -- plus queries labelled with the notes they should find) is seeded
into a fresh SQLite file through the product's own `notes.create_note` (so the FTS index is built
by the real triggers), then every query is asked of the two readers a member reaches:
  * search_box -- `notes.list_and_count_notes(q=..., sort="relevance", limit=10)`, exactly what
    `GET /api/j2/notes` answers the sidebar search box (FolderSidebar asks for sort=relevance);
  * switcher   -- `notes.switcher_search(q, limit=10)`, the quick switcher: its title tiers, then
    (wave 10, F6) the search box's own relevance order below them when the titles leave room.
For each: recall@10 (the share of a query's relevant notes in its first ten, averaged over
queries) and MRR@10 (the mean of 1/rank of the first relevant note, 0 when none is in the first
ten), overall and by query KIND -- so a paraphrase or a typo the lexical search cannot find is a
measured miss, never an omitted query.

THE BASELINE lives in the set file's "baseline" block (written only by --write-baseline, with the
tree it was measured on). The default run compares against it and exits 1 when either number for
either reader falls below its baseline: a recall regression is a red, an improvement is not.

SANDBOX: `import conftest` before any `api.*` import applies the census pins (every `/data/...`
path goes to a per-session sandbox) and arms the shared-root tripwire -- the same idiom as
tools/notebook_scale_benchmark.py. A `q=` search writes one activity_log row; that row lands in
the sandbox auth.db, which gets its schema and this run's user first.

CONTROLS (--self-check): a PLANTED ranker defect -- `fts_match_expr` degraded to keep only the
first three letters of the first word, patched in for that run only -- must fall below the
baseline and fail the comparison. An instrument that cannot fail is not a rail. And (wave 10,
F6) a planted SWITCHER defect -- its body half switched off, the switcher it replaced -- must
fall below the switcher's own baseline: the recorded 0.41 is what that defect scores.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

import conftest  # noqa: E402,F401 -- the census pins and the tripwire, before any api.* import

from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402
from api.services.journal_two import notes_search  # noqa: E402

SET_PATH = _REPO / "docs" / "notebook" / "search-recall-set.json"
USER_ID = "recall_user"
K = 10
READERS = ("search_box", "switcher")


def load_set(path: Path = SET_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _doc(paragraphs: list[str]) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]}
                                       for p in paragraphs]}


def _prepare_activity_sink() -> None:
    from api.services import auth_db  # AUTH_DB_PATH points at the conftest sandbox
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        c.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                  (USER_ID, "recall@local.invalid", "x"))
        c.commit()
    finally:
        c.close()


def seed(conn: sqlite3.Connection, notes: list[dict]) -> dict:
    """key -> note id, every note made through `create_note` (the real write path)."""
    ids = {}
    for n in notes:
        payload = {"title": n["title"], "bodyJson": _doc(n["body"])}
        if n.get("tags"):
            payload["tags"] = n["tags"]
        if n.get("ticker"):
            payload["ticker"] = n["ticker"]
        note = notes_svc.create_note(USER_ID, payload, conn=conn)
        ids[n["key"]] = note["id"]
    return ids


def rank(reader: str, conn: sqlite3.Connection, q: str) -> list[str]:
    if reader == "search_box":
        rows, _total = notes_svc.list_and_count_notes(USER_ID, q=q, sort="relevance", limit=K, conn=conn)
        return [r["id"] for r in rows]
    got = notes_svc.switcher_search(USER_ID, q, limit=K, conn=conn)
    return [r["id"] for r in got.get("notes", [])]


def score(ranked: list[str], relevant: list[str]) -> tuple[float, float, int | None]:
    top = ranked[:K]
    hit = [r for r in relevant if r in top]
    recall = len(hit) / len(relevant) if relevant else 0.0
    first = next((i for i, x in enumerate(top, 1) if x in relevant), None)
    return recall, (1.0 / first if first else 0.0), first


def measure(labelled: dict | None = None) -> dict:
    labelled = labelled or load_set()
    _prepare_activity_sink()
    tmp = tempfile.mkdtemp(prefix="nb_recall_")
    conn = sqlite3.connect(os.path.join(tmp, "recall.db"))
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    try:
        ids = seed(conn, labelled["notes"])
        key_of = {v: k for k, v in ids.items()}
        out = {"k": K, "notes": len(labelled["notes"]), "queries": len(labelled["queries"]), "readers": {}}
        for reader in READERS:
            per, kinds = [], {}
            for q in labelled["queries"]:
                rel = [ids[k] for k in q["relevant"]]
                ranked = rank(reader, conn, q["q"])
                rc, rr, first = score(ranked, rel)
                per.append({"q": q["q"], "kind": q["kind"], "relevant": q["relevant"], "recall": round(rc, 4),
                            "rr": round(rr, 4), "first_relevant_rank": first,
                            "top": [key_of.get(x, "?") for x in ranked[:K]]})
                b = kinds.setdefault(q["kind"], [0.0, 0.0, 0])
                b[0] += rc
                b[1] += rr
                b[2] += 1
            n = len(per)
            out["readers"][reader] = {
                "recall_at_10": round(sum(p["recall"] for p in per) / n, 4),
                "mrr_at_10": round(sum(p["rr"] for p in per) / n, 4),
                "zero_recall_queries": [p["q"] for p in per if p["recall"] == 0],
                "by_kind": {k: {"n": v[2], "recall_at_10": round(v[0] / v[2], 4), "mrr_at_10": round(v[1] / v[2], 4)}
                            for k, v in sorted(kinds.items())},
                "per_query": per,
            }
        return out
    finally:
        conn.close()


def compare(result: dict, baseline: dict | None) -> list[str]:
    """Every number below its baseline, named. None -> no baseline recorded (never a pass)."""
    if not baseline:
        return ["no baseline is recorded in the set file (run --write-baseline once, and commit it)"]
    falls = []
    for reader in READERS:
        b = (baseline.get("readers") or {}).get(reader) or {}
        r = result["readers"][reader]
        for m in ("recall_at_10", "mrr_at_10"):
            if m not in b:
                falls.append(f"{reader}.{m}: no baseline number")
            elif r[m] + 1e-9 < b[m]:
                falls.append(f"{reader}.{m} {r[m]:.4f} < baseline {b[m]:.4f}")
    return falls


@contextlib.contextmanager
def planted_regression():
    """The control's defect: the ranker's query degraded to the first three letters of the
    first word. Patched on the module `list_notes` reads it from, for the duration only."""
    orig = notes_svc.fts_match_expr

    def degraded(q):
        words = [w for w in (q or "").split() if w]
        return orig(words[0][:3]) if words else orig(q)

    notes_svc.fts_match_expr = degraded
    try:
        yield
    finally:
        notes_svc.fts_match_expr = orig


@contextlib.contextmanager
def planted_switcher_regression():
    """The switcher control's defect: the body half (wave 10, F6) switched off, so the
    switcher answers titles only, as it did before. Patched for the duration only."""
    orig = notes_svc._switcher_fill_from_body
    notes_svc._switcher_fill_from_body = lambda *a, **k: None
    try:
        yield
    finally:
        notes_svc._switcher_fill_from_body = orig


def _tree() -> str:
    try:
        return subprocess.run(["git", "-C", str(_REPO), "rev-parse", "--short=9", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def self_check() -> int:
    labelled = load_set()
    base = labelled.get("baseline")
    good = measure(labelled)
    ok_real = not compare(good, base)
    with planted_regression():
        bad = measure(labelled)
    falls = compare(bad, base)
    ok_ctl = bool(falls) and not any("no baseline" in f for f in falls)
    with planted_switcher_regression():
        bad_sw = measure(labelled)
    sw_falls = compare(bad_sw, base)
    ok_sw = bool(sw_falls) and all(f.startswith("switcher.") for f in sw_falls)
    print(f"{'ok ' if ok_real else 'BAD'} the real ranker meets the baseline: "
          f"{ {r: (good['readers'][r]['recall_at_10'], good['readers'][r]['mrr_at_10']) for r in READERS} }")
    print(f"{'ok ' if ok_ctl else 'BAD'} the planted regression FAILS the comparison: {falls}")
    print(f"{'ok ' if ok_sw else 'BAD'} the planted switcher regression FAILS the switcher's baseline only: {sw_falls}")
    return 0 if (ok_real and ok_ctl and ok_sw) else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    labelled = load_set()
    res = measure(labelled)
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    for reader in READERS:
        r = res["readers"][reader]
        print(f"{reader}: recall@10 {r['recall_at_10']:.4f}  MRR@10 {r['mrr_at_10']:.4f}  "
              f"zero-recall {len(r['zero_recall_queries'])}/{res['queries']}")
        for kind, v in r["by_kind"].items():
            print(f"   {kind:40s} n={v['n']:2d} recall {v['recall_at_10']:.3f} mrr {v['mrr_at_10']:.3f}")
    if a.write_baseline:
        text = SET_PATH.read_text(encoding="utf-8")
        data = json.loads(text)
        data["baseline"] = {"measured_on_tree": _tree(), "k": K,
                            "readers": {r: {m: res["readers"][r][m] for m in ("recall_at_10", "mrr_at_10")}
                                        for r in READERS}}
        SET_PATH.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"baseline written to {SET_PATH.relative_to(_REPO)}")
        return 0
    falls = compare(res, labelled.get("baseline"))
    for f in falls:
        print("FALL " + f)
    return 1 if falls else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
