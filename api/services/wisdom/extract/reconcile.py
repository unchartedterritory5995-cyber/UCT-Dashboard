"""Wave 1.5 item 2 — the N-pass reconciler. Turns persisted gate runs into a stability score.

**The owner's wording:** *"extract each segment N=3 times (Batch) … keep a record only if it
appears in >= 2 of 3, and store stability = runs_present / N"*.

⛔⛔ **MATCHING IS BY KEY, PER SEGMENT — NEVER BY TEXT AND NEVER BY SPAN.** That is the E5 lesson
paid for twice. `writer.Checked.key()` is the identity that survives paraphrase: for PRINCIPLE and
MARKET_SIGNAL it is `normalize_quote_key` over the statement/name, and for the four mechanical
types it is `(type, ticker, stance, direction)`. Char spans move between runs even when the
extractor found the same thing, so a span-based match would report disagreement that is really
re-wording — the exact confound that made a precision/recall delta unciteable in session 2.

⭐ **Per SEGMENT**, because that is what the measurement means: stability asks whether re-extracting
*the same paragraph* yields the same record. The group key is therefore `(segment_id, record key)`.

⛔ **The runs must agree on extractor_version AND on the segment set.** Mixing versions is the same
class of confound as E5 — two runs scored under different rules cannot be compared, and a
reconciler that silently averaged them would manufacture a stability number nobody could defend.
Both mismatches REFUSE, naming what differs.

⚠️⚠️ **MARKET_SIGNAL's identity is PROVISIONAL — owner ruling R30: ACCEPT_AUDIT, 2026-09-15.**

Session 3 recorded that MARKET_SIGNAL has no id anywhere in the schema — it lives only as
`wisdom_records.market_signal_json` — so its key here is `(type, normalize_quote_key(name))`, the
tuple session 4's persistence adopted. **That is the first stable id MARKET_SIGNAL has ever had**,
and it is **name-based**: a signal renamed between runs reads as two different signals and scores
**1/N twice instead of 2/N once**, understating stability.

⭐ **The ruling accepts it for this measurement and requires an audit beside it** (see
`audit_market_signal_renames` below), because the cost of being wrong is bounded and recoverable:
the runs persist **raw records**, so the reconciler can be re-run offline under a different key
for **$0.00**. Nothing about choosing this key now forecloses choosing another later — which is
exactly why it was safe to accept rather than block the run.

⛔ The audit measures the suspicion; it does not resolve it. A suspected rename is reported by
segment id and KEY, never by name text.

⛔ **Writers touch COLUMNS ONLY.** `stability` and `stability_runs` are written by `record_id` and
by `principle_key`; nothing that feeds `writer._canonical_hash` is read or written, so
`record_hash` and `record_id` are unchanged. A test pins that across a write.
"""
from __future__ import annotations

import json
import os
import pathlib
import sqlite3
from typing import Iterable, Optional

RECORDS_FILE = "records.jsonl"
MANIFEST_FILE = "manifest.json"
#: `run_records.touch_segment` writes this; `load_run` below is the ONE reader (2026-09-19 fix).
SEGMENTS_SEEN_FILE = "segments_seen.jsonl"

#: R56 (owner ruling, 2026-09-15). The persisted-runs root, resolved ONCE, here.
#:
#: ⚰️⚰️ WHAT IT REPLACED, AND WHY THE REPLACEMENT IS THE WHOLE POINT. This was
#: `pathlib.Path("data") / "wisdom" / "gate-runs"` — a BARE CWD-RELATIVE literal, with no
#: environment override anywhere and no way for the chain to pass one (`chain.py` calls every
#: step as `fn(ctx)` and nothing else). On a developer's box the CWD is the repo root and it
#: happens to land on the gitignored tree. On the pod the CWD is `/app` (WORKDIR, Dockerfile.web),
#: so it resolved to `/app/data/wisdom/gate-runs` — an EPHEMERAL IMAGE LAYER, not the Railway
#: volume, and one that `.gitignore`'s `data/` keeps out of the image entirely.
#:
#: ⛔⛔ THE CONSEQUENCE WAS NOT "A WRONG DIRECTORY", IT WAS "N-PASS CAN NEVER COMPLETE". Runs
#: written to an image layer are destroyed on every redeploy, and `MIN_RUNS = 3` needs three
#: passes to coexist. A chain-side N-pass writing to the old default would have accumulated
#: nothing, forever, while every step reported `ok`.
#:
#: ⛔ There were also TWO definitions of this constant — here and in `tools/wisdom/gate_records.py`
#: — one writing runs and one discovering them. Two authorities over one path is how a writer and
#: a reader come to disagree in silence. `gate_records` now imports THIS function.
GATE_RUNS_DIR_ENV = "WISDOM_GATE_RUNS_DIR"


def gate_runs_root() -> pathlib.Path:
    """Where persisted extraction runs live. Never CWD-relative.

    `WISDOM_GATE_RUNS_DIR` wins if set; otherwise `<DATA_DIR>/wisdom/gate-runs`, with DATA_DIR
    defaulting to `/data` — the same resolution `entity_master/schema.py:33` uses, and the same
    volume the wisdom store defaults onto (`core/store.py:43`).
    """
    override = (os.environ.get(GATE_RUNS_DIR_ENV) or "").strip()
    if override:
        return pathlib.Path(override)
    return pathlib.Path(os.environ.get("DATA_DIR", "/data")) / "wisdom" / "gate-runs"


#: ⛔ THERE IS DELIBERATELY NO MODULE-LEVEL `DEFAULT_ROOT` CONSTANT ANY MORE. It was a default
#: ARGUMENT (`score_silently(ctx, *, root=DEFAULT_ROOT)`), and Python binds a default argument
#: ONCE, at import. Any constant here would freeze whatever the environment said at import time,
#: so a rehearsal or a test that pins DATA_DIR afterwards would be silently ignored — the same
#: class of bug as the CWD-relative literal, wearing different clothes. Callers pass `root=None`
#: and the resolution happens per call, in `gate_runs_root()`.

#: Written beside the runs it reconciles, in the same gitignored tree (§0.4f).
REPORT_FILE = "reconcile-report.json"

#: ⛔⛔ MARKET_SIGNAL's PUBLICATION IDENTITY — owner ruling **R43, 2026-09-15**.
#:
#: This ONE constant is the switch. `KEY` is the name-based identity R30 accepted provisionally;
#: `MERGED_J05` clusters keys whose names share at least `MS_MERGE_JACCARD` token Jaccard within a
#: segment, which is R30's OWN audit threshold. Session 10 measured the difference: 236 identities
#: and 21 publishable under KEY, 163 and **61** under MERGED_J05.
#:
#: ⚠️ Merging can only ever RAISE stability, and a raised stability PUBLISHES where the floor would
#: have blocked — so the guard below is not decoration: **two keys present in the SAME run are two
#: records, never one renamed record**, and a merge that would seat them together is refused.
#:
#: ⭐ KEY is still computed on every reconciliation and written to the manifest as
#: `comparison_key_identity`, so the lower bound never stops being visible.
MS_IDENTITY = "MERGED_J05"
MS_MERGE_JACCARD = 0.5

#: ⛔⛔ PRINCIPLE's PUBLICATION IDENTITY — owner ruling **R43, 2026-09-15**, revised session 12.
#:
#: `KEY` is the `principle_key` identity. `LENS_STRICT_06` clusters keys whose normalised
#: statements agree under **golden.py's own paraphrase lens** at threshold `PRINCIPLE_LENS_JACCARD`.
#:
#: ⭐ IT IS RULED ON GRADED EVIDENCE, NOT ON TASTE. Where two members of a merged cluster both map
#: to a golden record, the labels settle the merge: **13 of 13 correct at t=0.6, 7 of 7 at t=0.9 —
#: precision 1.000 at every threshold measured.** KEY publishes 31 PRINCIPLE records; this
#: publishes ~67.
#:
#: ⚠️ PROVISIONAL, and the reason is stated so it is not forgotten: n is small (13 gradeable
#: clusters) and the lens is documented to OVER-merge. The 42 ungradeable pairs in
#: `data/wisdom/identity-study/lens-principle-pairs.jsonl` are the confirmation. **If any
#: hand-checked pair is an over-merge, set this back to "KEY" — one line, one commit.**
PRINCIPLE_IDENTITY = "LENS_STRICT_06"
PRINCIPLE_LENS_JACCARD = 0.6


class ReconcileRefused(ValueError):
    """A reconciliation that cannot be defended is refused, never approximated."""


def _run_dir(root, run_id: str) -> pathlib.Path:
    return pathlib.Path(root) / run_id


def load_run(root, run_id: str, *, phase: str = "gate") -> dict:
    """One persisted run's records and its manifest. Raises if the run is not there."""
    d = _run_dir(root, run_id)
    records_path = d / RECORDS_FILE
    if not records_path.exists():
        raise ReconcileRefused(f"run {run_id!r} has no {RECORDS_FILE} at {d}")
    rows = []
    for line in records_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("phase") == phase:
            rows.append(row)
    manifest = {}
    if (d / MANIFEST_FILE).exists():
        manifest = json.loads((d / MANIFEST_FILE).read_text(encoding="utf-8"))
    versions = {r.get("extractor_version") for r in rows}
    # ⛔⛔ BUG FOUND 2026-09-19 (adversarial review, session 28 part 2): `run_records.touch_segment`
    # writes an EMPTY marker to segments_seen.jsonl specifically so a segment that legitimately
    # kept zero records still counts as SEEN for the parity check below (`reconcile`'s segment-set
    # comparison) -- a pass finding nothing in one paragraph is routine LLM-instability, not a
    # fault, and `persist_result`'s own docstring says so. But this function used to build
    # "segments" from `rows` alone, so that marker had ZERO effect on the comparison it exists
    # for: any segment with kept=[] in even one pass made that pass's segment set differ from the
    # others', and `reconcile()` refused the WHOLE night -- the identical permanent-loss failure
    # mode as the N-pass budget-trim bug fixed earlier tonight, from an entirely different cause.
    # The marker file is read here, unioned into "segments", and is the ONLY thing this dict
    # exposes about it -- rows (and therefore scoring) are unaffected by a segment having no kept
    # records; only the parity check now sees it as covered.
    seen_path = d / SEGMENTS_SEEN_FILE
    seen_ids = {r.get("segment_id") for r in rows}
    if seen_path.exists():
        for line in seen_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            seen_ids.add(json.loads(line).get("segment_id"))
    return {"run_id": run_id, "rows": rows, "manifest": manifest,
            "extractor_version": versions.pop() if len(versions) == 1 else None,
            "segments": seen_ids}


class _Union:
    """Union-find whose merges are REFUSED when the two components share a run.

    ⛔ The guard is on the COMPONENT, not the pair. Two keys can be individually disjoint while
    their components are not — a pair-level check would let A~B and B~C quietly seat A and C, which
    co-occurred, in one cluster, and that cluster would then claim a stability it never earned.
    """

    def __init__(self, keys, runs_of):
        self.parent = {k: k for k in keys}
        self.runs = {k: set(runs_of(k)) for k in keys}
        self.refused = 0

    def find(self, k):
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def union(self, a, b) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.runs[ra] & self.runs[rb]:
            self.refused += 1
            return False
        lo, hi = (ra, rb) if str(ra) <= str(rb) else (rb, ra)
        self.parent[hi] = lo
        self.runs[lo] = self.runs[lo] | self.runs[hi]
        return True

    def roots(self) -> dict:
        return {k: self.find(k) for k in self.parent}


def market_signal_assignments(runs: list, *, threshold: float = MS_MERGE_JACCARD) -> dict:
    """{segment_id: {key: cluster_id}} for MARKET_SIGNAL under the merged identity.

    ⭐ Deterministic: candidate pairs are considered highest-similarity first then by key, and the
    cluster id is an index over the sorted roots — so it carries NO text and the same runs always
    produce the same partition.
    """
    import itertools

    by_segment: dict = {}
    for run in runs:
        for row in run["rows"]:
            if row.get("record_type") != "MARKET_SIGNAL":
                continue
            seg = row.get("segment_id")
            key = tuple(row.get("market_signal_key") or row.get("record_key") or ())
            slot = by_segment.setdefault(seg, {}).setdefault(key, {"runs": set(), "tokens": frozenset()})
            slot["runs"].add(run["run_id"])
            slot["tokens"] = slot["tokens"] | _name_tokens(row)

    out: dict = {}
    for seg, entries in by_segment.items():
        keys = sorted(entries, key=str)
        uf = _Union(keys, lambda k, _e=entries: _e[k]["runs"])
        scored = []
        for a, b in itertools.combinations(keys, 2):
            if entries[a]["runs"] & entries[b]["runs"]:
                # ⚠️ AN OPTIMISATION, NOT THE GUARD — measured, not assumed. Mutation
                # 2026-09-15: disabling THIS line leaves all 27 tests green, because
                # `_Union.union` refuses the same merges; disabling the union guard reds
                # `test_the_guard_holds_at_COMPONENT_level_not_just_pair_level`. So the guard is
                # `union`, and this only avoids scoring pairs that can never merge. ⛔ Do not call
                # it a second line of defence — a guard that cannot be mutation-proved is not one.
                continue
            ta, tb = entries[a]["tokens"], entries[b]["tokens"]
            union = ta | tb
            if not union:
                continue                      # no names persisted -> no evidence -> no merge
            jac = len(ta & tb) / len(union)
            if jac >= threshold:
                scored.append((-jac, str(a), str(b), a, b))
        for _neg, _sa, _sb, a, b in sorted(scored):
            uf.union(a, b)
        roots = uf.roots()
        index = {root: i for i, root in enumerate(sorted(set(roots.values()), key=str))}
        out[seg] = {k: index[r] for k, r in roots.items()}
    return out


def principle_assignments(runs: list, *, threshold: float = PRINCIPLE_LENS_JACCARD) -> dict:
    """{segment_id: {principle_key: cluster_id}} under golden.py's paraphrase lens.

    ⛔ THE LENS IS ASSEMBLED FROM golden's OWN PARTS, never re-derived: `_key_tokens` (the
    tokenizer), `_polarity_conflict` (never/always, long/short — not a paraphrase), and the
    threshold above. golden's shipped entry point `_fuzzy_agreed` is a one-to-one COUNT matcher
    between two runs, not a pair predicate, which is why the parts are used rather than the whole.

    ⛔ Same invariant as MARKET_SIGNAL: two keys present in the SAME run are two records.
    """
    import itertools

    from api.services.wisdom.extract import golden

    tokens = getattr(golden, "_key_tokens", None)
    conflict = getattr(golden, "_polarity_conflict", None)
    if not callable(tokens) or not callable(conflict):
        return {}                         # the lens is unavailable: no merges, never an exception

    by_segment: dict = {}
    for run in runs:
        for row in run["rows"]:
            if row.get("record_type") != "PRINCIPLE" or not row.get("principle_key"):
                continue
            seg = row.get("segment_id")
            key = row["principle_key"]
            slot = by_segment.setdefault(seg, {}).setdefault(key, {"runs": set(), "text": ""})
            slot["runs"].add(run["run_id"])
            if not slot["text"]:
                record_key = row.get("record_key") or ()
                # the lens reads the normalize_quote_key form, which principle_key (a hash) is not
                slot["text"] = str(record_key[1]) if len(record_key) > 1 else ""

    out: dict = {}
    for seg, entries in by_segment.items():
        keys = sorted(entries, key=str)
        uf = _Union(keys, lambda k, _e=entries: _e[k]["runs"])
        scored = []
        for a, b in itertools.combinations(keys, 2):
            if entries[a]["runs"] & entries[b]["runs"]:
                continue
            ta, tb = entries[a]["text"], entries[b]["text"]
            if not ta or not tb or conflict(ta, tb):
                continue
            sa, sb = tokens(ta), tokens(tb)
            union = sa | sb
            if not union:
                continue
            jac = len(sa & sb) / len(union)
            if jac >= threshold:
                scored.append((-jac, str(a), str(b), a, b))
        for _neg, _sa, _sb, a, b in sorted(scored):
            uf.union(a, b)
        roots = uf.roots()
        index = {root: i for i, root in enumerate(sorted(set(roots.values()), key=str))}
        out[seg] = {k: index[r] for k, r in roots.items()}
    return out


def group_key(row: dict, ms_assign: Optional[dict] = None,
              principle_assign: Optional[dict] = None) -> tuple:
    """The identity a record is matched on ACROSS runs. ⛔ Key only — never text, never span.

    PRINCIPLE uses its cross-segment `principle_key` where the run recorded one, because that is
    the identity the Brain KB lane itself keys on; everything else uses `record_key`, which is
    already `normalize_quote_key`-based for MARKET_SIGNAL and structured for the four mechanical
    types.
    """
    rtype = row.get("record_type")
    if rtype == "PRINCIPLE" and row.get("principle_key"):
        ident = ("PRINCIPLE", row["principle_key"])
        # R43 session 12: under LENS_STRICT the identity is the CLUSTER. The id carries no text.
        if principle_assign is not None:
            cid = (principle_assign.get(row.get("segment_id")) or {}).get(row["principle_key"])
            if cid is not None:
                ident = ("PRINCIPLE", f"lensclust:{cid}")
    elif rtype == "MARKET_SIGNAL" and row.get("market_signal_key"):
        ident = tuple(row["market_signal_key"])
        # R43: under MERGED_J05 the identity is the CLUSTER, not the name. The cluster id carries
        # no text — it is the segment plus an index — so nothing quote-derived enters an id.
        if ms_assign is not None:
            cid = (ms_assign.get(row.get("segment_id")) or {}).get(ident)
            if cid is not None:
                ident = ("MARKET_SIGNAL", f"msclust:{cid}")
    else:
        ident = tuple(row.get("record_key") or (rtype,))
    return (row.get("segment_id"), ident)


def reconcile(runs: list) -> dict:
    """Fold N runs into one score per (segment, key). Refuses on a version or segment-set mismatch.

    ⛔ `N` is `len(runs)` — the number of passes actually reconciled — and is written alongside
    every score. A ratio without its denominator is not a measurement (Q17 then reads that
    denominator and blocks anything measured over too few passes).
    """
    if len(runs) < 2:
        raise ReconcileRefused(f"reconciliation needs at least 2 runs, got {len(runs)}")

    versions = {r["extractor_version"] for r in runs}
    if len(versions) != 1 or None in versions:
        detail = ", ".join(f"{r['run_id']}={r['extractor_version']}" for r in runs)
        raise ReconcileRefused(
            "refusing to reconcile runs with different extractor_version — two runs scored under "
            f"different rules cannot be compared (E5): {detail}")

    segment_sets = [r["segments"] for r in runs]
    if any(s != segment_sets[0] for s in segment_sets[1:]):
        base = segment_sets[0]
        diffs = []
        for r in runs[1:]:
            missing, extra = sorted(base - r["segments"]), sorted(r["segments"] - base)
            if missing or extra:
                diffs.append(f"{r['run_id']}: missing {len(missing)}, extra {len(extra)}")
        raise ReconcileRefused(
            "refusing to reconcile runs over different segment sets — a record absent because its "
            f"segment was never sent is not a record the extractor disagreed about: {'; '.join(diffs)}")

    n = len(runs)
    # R43: MARKET_SIGNAL's identity. Computed ONCE over all runs, because a cluster is a property
    # of the run SET, not of a row. Under KEY this stays None and group_key behaves as before.
    ms_assign = market_signal_assignments(runs) if MS_IDENTITY == "MERGED_J05" else None
    pr_assign = principle_assignments(runs) if PRINCIPLE_IDENTITY.startswith("LENS_STRICT") else None
    seen: dict = {}
    for run in runs:
        for key in {group_key(row, ms_assign, pr_assign) for row in run["rows"]}:  # once per run
            slot = seen.setdefault(key, {"runs_present": 0, "record_ids": set(),
                                         "principle_keys": set(), "record_type": None})
            slot["runs_present"] += 1
        for row in run["rows"]:
            slot = seen[group_key(row, ms_assign, pr_assign)]
            slot["record_type"] = slot["record_type"] or row.get("record_type")
            if row.get("record_id"):
                slot["record_ids"].add(row["record_id"])
            if row.get("principle_key"):
                slot["principle_keys"].add(row["principle_key"])

    scores = []
    for (segment_id, ident), slot in sorted(seen.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        scores.append({
            "segment_id": segment_id,
            "identity": list(ident),
            "record_type": slot["record_type"],
            "runs_present": slot["runs_present"],
            "n": n,
            "stability": slot["runs_present"] / n,
            "record_ids": sorted(slot["record_ids"]),
            "principle_keys": sorted(slot["principle_keys"]),
        })
    # ⭐ THE LOWER BOUND NEVER STOPS BEING VISIBLE. KEY is recomputed here and carried into the
    # manifest so a reader can always see what the ruled identity bought over the provisional one.
    # ⛔ Comparison only — it is never written to wisdom_records or wisdom_principles.
    comparison = None
    if ms_assign is not None or pr_assign is not None:
        key_only: dict = {}
        for run in runs:
            for k in {group_key(row) for row in run["rows"]}:
                key_only[k] = key_only.get(k, 0) + 1
        comparison = {"identity": "KEY", "principle_identity": PRINCIPLE_IDENTITY,
                      "identities": len(key_only),
                      "at_full_agreement": sum(1 for v in key_only.values() if v == n)}
    return {"n": n, "run_ids": [r["run_id"] for r in runs],
            "extractor_version": versions.pop(), "scores": scores,
            "ms_identity": MS_IDENTITY, "ms_merge_jaccard": MS_MERGE_JACCARD,
            "comparison_key_identity": comparison}


def histogram(result: dict) -> dict:
    """Per-type counts by stability value, plus how many would clear the Q17 floor."""
    from api.services.wisdom.publish import floor

    out: dict = {}
    for s in result["scores"]:
        slot = out.setdefault(s["record_type"] or "UNKNOWN",
                              {"total": 0, "by_stability": {}, "clears_floor": 0})
        slot["total"] += 1
        bucket = f"{s['runs_present']}/{s['n']}"
        slot["by_stability"][bucket] = slot["by_stability"].get(bucket, 0) + 1
        if floor.passes(s["record_type"], s["stability"], s["n"]):
            slot["clears_floor"] += 1
    return out


def write_scores(conn: sqlite3.Connection, result: dict) -> dict:
    """Write stability + stability_runs as COLUMNS. ⛔ Never touches a hashed field.

    Returns counts of rows actually updated, so a write that matched nothing is visible rather
    than reported as success.
    """
    records = principles = 0
    for s in result["scores"]:
        if s["record_ids"]:
            cur = conn.execute(
                f"UPDATE wisdom_records SET stability = ?, stability_runs = ? "
                f"WHERE record_id IN ({','.join('?' * len(s['record_ids']))})",
                [s["stability"], s["n"], *s["record_ids"]])
            records += cur.rowcount or 0
        if s["principle_keys"]:
            cur = conn.execute(
                f"UPDATE wisdom_principles SET stability = ?, stability_runs = ? "
                f"WHERE principle_key IN ({','.join('?' * len(s['principle_keys']))})",
                [s["stability"], s["n"], *s["principle_keys"]])
            principles += cur.rowcount or 0
    return {"records_updated": records, "principles_updated": principles}


def write_report(root, result: dict, *, extra: Optional[dict] = None) -> pathlib.Path:
    """The reconciliation's own artifact, beside the runs, in the gitignored tree."""
    import os

    payload = {"n": result["n"], "run_ids": result["run_ids"],
               "extractor_version": result["extractor_version"],
               "keys": len(result["scores"]), "by_type": histogram(result)}
    payload.update(extra or {})
    d = _run_dir(root, result["run_ids"][-1])
    d.mkdir(parents=True, exist_ok=True)
    path = d / REPORT_FILE
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return path


def discover(root) -> list:
    """Every persisted run id under `root`, oldest first by directory name (a UTC stamp)."""
    base = pathlib.Path(root)
    if not base.exists():
        return []
    return sorted(p.name for p in base.iterdir() if (p / RECORDS_FILE).exists())


def score_silently(ctx, *, root=None) -> dict:
    """Daily-chain entry point. A no-op unless enough compatible runs are persisted.

    ⛔ `N` comes from the number of runs actually reconciled, never from a literal — so a
    reconciliation over four passes stores 4, and Q17 reads that real denominator.

    ⛔ `root=None` resolves PER CALL via `gate_runs_root()` (R56). It is not a constant default,
    because a default argument binds once at import — see the note beside `gate_runs_root`.
    """
    from api.services.wisdom.core import store
    from api.services.wisdom.publish import floor

    root = gate_runs_root() if root is None else root
    ids = discover(root)
    if len(ids) < floor.MIN_RUNS:
        return {"skipped": f"only {len(ids)} persisted run(s); need {floor.MIN_RUNS}",
                "runs": len(ids)}
    runs = [load_run(root, rid) for rid in ids[-floor.MIN_RUNS:]]
    try:
        result = reconcile(runs)
    except ReconcileRefused as exc:
        return {"skipped": f"refused: {exc}", "runs": len(runs)}
    with store.write() as conn:
        written = write_scores(conn, result)
    write_report(root, result, extra={"written": written})
    return {"n": result["n"], "run_ids": result["run_ids"], "keys": len(result["scores"]),
            "by_type": histogram(result), **written}


# ── R30: the MARKET_SIGNAL rename audit ──────────────────────────────────────

#: Two names this similar, in the same segment, that did NOT match by key are a suspected rename.
RENAME_JACCARD = 0.5


def _name_tokens(row: dict) -> frozenset:
    """Tokens of a MARKET_SIGNAL's name. ⛔ Used only to MEASURE suspicion; never reported."""
    import re

    fields = row.get("fields") or {}
    signal = fields.get("market_signal") if isinstance(fields, dict) else None
    name = (signal or {}).get("name") if isinstance(signal, dict) else None
    return frozenset(t for t in re.findall(r"[a-z0-9]+", str(name or "").lower()) if len(t) > 2)


def audit_market_signal_renames(runs: list, *, threshold: float = RENAME_JACCARD) -> dict:
    """How much of MARKET_SIGNAL's instability is a RENAME rather than a disagreement?

    ⛔⛔ THE QUESTION THIS ANSWERS. The key is `normalize_quote_key(name)`, so a signal the
    extractor names slightly differently on a second pass becomes two identities scoring 1/N each
    instead of one scoring 2/N. That understates stability, and under Q17 an understated stability
    BLOCKS a record that should publish — the error runs in the fail-closed direction, which is
    safe but not free.

    For each segment, every pair of MARKET_SIGNAL keys that did NOT match and whose name tokens
    share at least `threshold` Jaccard is reported as a suspected rename.

    ⛔ Reported by SEGMENT ID and KEY only. The names themselves are never returned — they are
    extracted text, and the whole point of the key is that it is the publishable identity.

    ⚠️ It measures suspicion, not truth. Two genuinely different signals can share vocabulary;
    a real rename can share none. The number is a prompt for a decision, not the decision.
    """
    by_segment: dict = {}
    for run in runs:
        for row in run["rows"]:
            if row.get("record_type") != "MARKET_SIGNAL":
                continue
            seg = row.get("segment_id")
            key = tuple(row.get("market_signal_key") or row.get("record_key") or ())
            slot = by_segment.setdefault(seg, {})
            entry = slot.setdefault(key, {"runs": set(), "tokens": frozenset()})
            entry["runs"].add(run["run_id"])
            entry["tokens"] = entry["tokens"] | _name_tokens(row)

    n = len(runs)
    suspected, total_keys = [], 0
    for seg, keys in sorted(by_segment.items(), key=lambda kv: str(kv[0])):
        total_keys += len(keys)
        items = sorted(keys.items(), key=lambda kv: str(kv[0]))
        for i, (key_a, a) in enumerate(items):
            for key_b, b in items[i + 1:]:
                if a["runs"] & b["runs"]:
                    continue          # both in the same run: two real signals, not a rename
                union = a["tokens"] | b["tokens"]
                if not union:
                    continue
                jac = len(a["tokens"] & b["tokens"]) / len(union)
                if jac >= threshold:
                    suspected.append({
                        "segment_id": seg,
                        "key_a": list(key_a), "key_b": list(key_b),
                        "jaccard": round(jac, 3),
                        "runs_a": sorted(a["runs"]), "runs_b": sorted(b["runs"]),
                        "combined_runs": len(a["runs"] | b["runs"]),
                        "would_become": f"{len(a['runs'] | b['runs'])}/{n}",
                    })
    share = (len(suspected) / total_keys) if total_keys else 0.0
    return {"threshold": threshold, "n": n, "market_signal_keys": total_keys,
            "suspected_renames": len(suspected), "share_of_keys": round(share, 4),
            "examples": suspected[:20]}
