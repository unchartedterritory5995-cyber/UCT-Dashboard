#!/usr/bin/env python
"""R39 — what stability looks like under FOUR identities, offline, for $0.00.

⛔⛔ THESE ARE MEASUREMENTS, NOT A CHANGE OF IDENTITY. Nothing here writes to `wisdom_records`
or `wisdom_principles`, and the ruled key-based identity remains the only one that ever does.
The point is to bound a number the programme is about to make a decision on: session 9 measured
MARKET_SIGNAL reproducing across three runs **8.9%** of the time and PRINCIPLE **17%**, and the
publication floor blocked **88%** of what it governs on the strength of those. How much of that is
the extractor genuinely disagreeing with itself, and how much is one thing wearing two names?

    KEY            the ruled identity. Splits a renamed record in two, so it is the LOWER bound.
    MERGED-MS      MARKET_SIGNAL keys clustered by name-token Jaccard (R30's own measure).
    LENS-PRINCIPLE PRINCIPLE keys clustered by golden.py's paraphrase lens. Documented to
                   OVER-merge, so it is the UPPER bound.
    STRUCTURED-MS  MARKET_SIGNAL keyed on structured fields, if they are populated enough to try.

⭐ ONE AUTHORITY, FOUR ROW-REWRITES. Every identity is expressed by rewriting the identity FIELDS
on a copy of each row and handing the result to the SHIPPED `reconcile.reconcile()` — the same
call session 9 used, whose `histogram()` and the floor's `floor.passes()` then score it unchanged.
A second reconciler would drift from the one it audits and the drift would be silent.

⛔ THE CLUSTERING INVARIANT, and it is the whole reason this is not a similarity sweep:
**two keys that appear in the SAME run are two records, never one renamed record.** Clusters are
therefore built by union-find over candidate pairs, and a union is REFUSED unless the two
components' run-sets are disjoint. That keeps three properties at once — the result is a partition
(so transitive by construction), the relation is symmetric, and no cluster can ever claim a
stability above 1.0 by merging two things that co-existed.

⚠️ Merging can only ever RAISE stability, so every identity here is an upper bound on KEY and KEY
is the floor. An identity that merges wrongly manufactures agreement, which is why LENS is labelled
a bound rather than a proposal, and why the merged pairs are written out for a human to check.
"""
from __future__ import annotations

import argparse
import collections
import itertools
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

for _s in (sys.stdout, sys.stderr):          # cp1252 consoles; see rescore_offline.py
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

DEFAULT_ROOT = REPO / "data" / "wisdom" / "gate-runs"

#: R30's own threshold, and the two either side of it for a sensitivity read.
JACCARD_SWEEP = (0.4, 0.5, 0.6)


# ── the clustering primitive ─────────────────────────────────────────────────

class _Union:
    """Union-find whose merges are refused when the two components share a run.

    ⛔ The guard is on the COMPONENT, not the pair. Two keys may individually be disjoint while
    their components are not — refusing only at the pair level would let A~B and B~C quietly place
    A and C, which co-occurred, in one cluster.
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
            return False                      # they co-occur: two records, not one renamed record
        # deterministic: the lexicographically smaller root wins, so the answer never depends
        # on dict ordering or on which pair happened to be considered first
        lo, hi = (ra, rb) if str(ra) <= str(rb) else (rb, ra)
        self.parent[hi] = lo
        self.runs[lo] = self.runs[lo] | self.runs[hi]
        return True

    def clusters(self) -> dict:
        out: dict = {}
        for k in self.parent:
            out.setdefault(self.find(k), []).append(k)
        return {root: sorted(members, key=str) for root, members in out.items()}


def cluster_keys(entries: dict, similar) -> tuple:
    """`entries` maps key -> {"runs": set(...), ...}. Returns (key -> cluster_id, stats).

    Candidate pairs are considered in a deterministic order — highest similarity first, then by
    key — so the partition is reproducible run to run.
    """
    keys = sorted(entries, key=str)
    uf = _Union(keys, lambda k: entries[k]["runs"])
    scored = []
    for a, b in itertools.combinations(keys, 2):
        # ⚠️ AN OPTIMISATION, NOT THE GUARD — and that is measured, not assumed. Disabling this
        # line leaves all 11 tests GREEN (mutation, 2026-09-15), because `_Union.union` refuses the
        # same merges at component level. It is kept only to avoid calling `similar()` — which for
        # the paraphrase lens is the expensive part — on pairs that can never merge. ⛔ Do not
        # describe it as a second line of defence: a guard that cannot be mutation-proved is not a
        # guard (`lesson_a_guard_repeated_is_a_guard_unproved`), and believing in it would make the
        # real one look optional.
        if entries[a]["runs"] & entries[b]["runs"]:
            continue
        sim = similar(a, b)
        if sim is not None and sim > 0:
            scored.append((-sim, str(a), str(b), a, b))
    merged_pairs = []
    for _neg, _sa, _sb, a, b in sorted(scored):
        if uf.union(a, b):
            merged_pairs.append((a, b, -_neg))
    clusters = uf.clusters()
    assign = {k: root for root, members in clusters.items() for k in members}
    return assign, {"keys": len(keys), "clusters": len(clusters),
                    "merges": len(merged_pairs), "refused_unions": uf.refused,
                    "pairs": merged_pairs}


# ── the four identities, each a row rewrite ──────────────────────────────────

def _rows_by_segment(runs, rtype, *, key_field):
    """key -> {"runs": set, "rows": [...]}, per segment, for one record type."""
    out: dict = {}
    for run in runs:
        for row in run["rows"]:
            if row.get("record_type") != rtype:
                continue
            seg = row.get("segment_id")
            key = tuple(row.get(key_field) or row.get("record_key") or ())
            slot = out.setdefault(seg, {}).setdefault(key, {"runs": set(), "rows": []})
            slot["runs"].add(run["run_id"])
            slot["rows"].append(row)
    return out


def identity_key(runs, **_):
    """The ruled identity, untouched. ⛔ Must reproduce session 9 exactly — it is the control."""
    return [dict(r) for r in runs], {"identity": "key"}


def _apply_assignments(runs, rtype, key_field, assign_by_segment, label):
    """Rewrite one type's identity field to its cluster id; every other row passes through."""
    new_runs = []
    for run in runs:
        rows = []
        for row in run["rows"]:
            if row.get("record_type") != rtype:
                rows.append(row)
                continue
            seg = row.get("segment_id")
            key = tuple(row.get(key_field) or row.get("record_key") or ())
            cid = (assign_by_segment.get(seg) or {}).get(key)
            if cid is None:
                rows.append(row)
                continue
            # ⛔ the cluster id carries NO text — it is the segment plus an index over a sorted
            # cluster list, so an artifact of this study can never become a quote in a report.
            ident = f"{label}:{seg}:{cid}"
            # ⚠️ SHAPE MATTERS: `principle_key` is a SCALAR string in the schema and group_key
            # wraps it itself (reconcile.py:97); `market_signal_key` / `record_key` are LISTS that
            # group_key tuples (reconcile.py:99,101). Writing the wrong shape raises
            # "unhashable type: 'list'" deep inside the reconciler rather than here.
            value = ident if key_field == "principle_key" else [rtype, ident]
            rows.append(dict(row, **{key_field: value, "record_key": [rtype, ident]}))
        new_runs.append(dict(run, rows=rows))
    return new_runs


def identity_merged_ms(runs, *, threshold=0.5, **_):
    """MARKET_SIGNAL clustered by R30's own name-token Jaccard."""
    from api.services.wisdom.extract import reconcile

    by_segment = _rows_by_segment(runs, "MARKET_SIGNAL", key_field="market_signal_key")
    tokens_of: dict = {}
    for seg, keys in by_segment.items():
        for key, slot in keys.items():
            toks = frozenset()
            for row in slot["rows"]:
                toks |= reconcile._name_tokens(row)
            tokens_of[(seg, key)] = toks

    assign_by_segment, stats = {}, collections.Counter()
    pairs = []
    for seg, keys in by_segment.items():
        def similar(a, b, _seg=seg):
            ta, tb = tokens_of[(_seg, a)], tokens_of[(_seg, b)]
            union = ta | tb
            if not union:
                return 0.0            # ⭐ no names persisted -> no merges, never an exception
            return len(ta & tb) / len(union) if len(ta & tb) / len(union) >= threshold else 0.0

        assign, st = cluster_keys(keys, similar)
        # index the roots so the id is small and textless
        roots = {root: i for i, root in enumerate(sorted({v for v in assign.values()}, key=str))}
        assign_by_segment[seg] = {k: roots[v] for k, v in assign.items()}
        for field in ("keys", "clusters", "merges", "refused_unions"):
            stats[field] += st[field]
        pairs.extend((seg, a, b, round(sim, 3)) for a, b, sim in st["pairs"])

    return (_apply_assignments(runs, "MARKET_SIGNAL", "market_signal_key", assign_by_segment,
                               f"msclust{int(threshold * 100)}"),
            {"identity": "merged-ms", "threshold": threshold, **dict(stats), "pairs": pairs})


def identity_lens_principle(runs, *, lens=None, **_):
    """PRINCIPLE clustered by golden.py's paraphrase lens. ⚠️ Documented to OVER-merge."""
    # ⛔ KEYED ON `principle_key`, BECAUSE THAT IS WHAT DECIDES PRINCIPLE'S IDENTITY.
    # reconcile.group_key uses principle_key for PRINCIPLE when present (reconcile.py:96-98), so an
    # assignment map built on record_key would never be found and every row would pass through
    # unchanged — which is exactly what happened on the first run here: 60 merges reported, total
    # still 182. The cluster stats and the scored total disagreeing is the only thing that showed
    # it; the "other types unchanged" control cannot see it, because PRINCIPLE was unchanged too.
    by_segment = _rows_by_segment(runs, "PRINCIPLE", key_field="principle_key")
    text_of: dict = {}
    for seg, keys in by_segment.items():
        for key, slot in keys.items():
            # the lens reads the normalize_quote_key form (golden.py:745,750). principle_key is a
            # hash and carries no text, so the comparable form comes off the row's record_key.
            rk = slot["rows"][0].get("record_key") or ()
            text_of[(seg, key)] = str(rk[1]) if len(rk) > 1 else ""

    assign_by_segment, stats = {}, collections.Counter()
    pairs = []
    for seg, keys in by_segment.items():
        def similar(a, b, _seg=seg):
            ta, tb = text_of[(_seg, a)], text_of[(_seg, b)]
            if not ta or not tb:
                return 0.0
            return 1.0 if lens(ta, tb) else 0.0

        assign, st = cluster_keys(keys, similar)
        roots = {root: i for i, root in enumerate(sorted({v for v in assign.values()}, key=str))}
        assign_by_segment[seg] = {k: roots[v] for k, v in assign.items()}
        for field in ("keys", "clusters", "merges", "refused_unions"):
            stats[field] += st[field]
        pairs.extend((seg, a, b, sim) for a, b, sim in st["pairs"])

    return (_apply_assignments(runs, "PRINCIPLE", "principle_key", assign_by_segment, "lensclust"),
            {"identity": "lens-principle", **dict(stats), "pairs": pairs})


STRUCTURED_FIELDS = ("instrument", "direction", "timeframe")


def market_signal_field_coverage(runs) -> dict:
    """What the persisted MARKET_SIGNAL payload actually carries. Field NAMES and %s only."""
    seen, total = collections.Counter(), 0
    for run in runs:
        for row in run["rows"]:
            if row.get("record_type") != "MARKET_SIGNAL":
                continue
            total += 1
            fields = row.get("fields") or {}
            signal = fields.get("market_signal") if isinstance(fields, dict) else None
            if not isinstance(signal, dict):
                continue
            for k, v in signal.items():
                if v not in (None, "", [], {}):
                    seen[k] += 1
    return {"market_signal_rows": total,
            "coverage": {k: round(n / total, 4) for k, n in sorted(seen.items())} if total else {}}


def identity_structured_ms(runs, *, fields=STRUCTURED_FIELDS, **_):
    """MARKET_SIGNAL keyed on structured fields rather than on its name."""
    assign_by_segment: dict = {}
    by_segment = _rows_by_segment(runs, "MARKET_SIGNAL", key_field="market_signal_key")
    collapsed = collections.Counter()
    for seg, keys in by_segment.items():
        tup_of = {}
        for key, slot in keys.items():
            row = slot["rows"][0]
            signal = ((row.get("fields") or {}).get("market_signal")) or {}
            tup = tuple(str(signal.get(f) or "").strip().lower() for f in fields)
            tup_of[key] = tup
        groups: dict = {}
        for key, tup in sorted(tup_of.items(), key=lambda kv: str(kv[0])):
            groups.setdefault(tup, []).append(key)
        # ⛔ the co-occurrence guard applies here too: a structured tuple shared by two keys in ONE
        # run is two signals the schema cannot tell apart, and merging them would invent agreement.
        assign, idx = {}, 0
        for tup, members in sorted(groups.items(), key=lambda kv: str(kv[0])):
            runs_seen: set = set()
            bucket = []
            for key in members:
                if keys[key]["runs"] & runs_seen:
                    idx += 1
                    assign[key] = idx            # its own identity
                    continue
                runs_seen |= keys[key]["runs"]
                bucket.append(key)
            idx += 1
            for key in bucket:
                assign[key] = idx
            if len(bucket) > 1:
                collapsed[tup] += len(bucket)
        assign_by_segment[seg] = assign
    return (_apply_assignments(runs, "MARKET_SIGNAL", "market_signal_key", assign_by_segment,
                               "msstruct"),
            {"identity": "structured-ms", "fields": list(fields),
             "distinct_names_collapsed": int(sum(collapsed.values())),
             "tuples_with_a_merge": len(collapsed)})


def assert_merges_landed(before: dict, after: dict, rtype: str, meta: dict) -> None:
    """⛔ THE INVARIANT THAT CATCHES A SILENT NO-OP REWRITE.

    A rewrite that reports merges but does not change the scored total has not been applied — the
    assignment map was keyed on a field the reconciler does not use for that type, every lookup
    missed, and every row passed through. That failure is INVISIBLE to a "the other types are
    unchanged" control, because the type under test is unchanged too. It happened here on
    2026-09-15 (60 lens merges, PRINCIPLE still 182), and this is what would have said so.
    """
    merges = int(meta.get("merges") or 0)
    if merges <= 0:
        return
    b, a = before[rtype]["total"], after[rtype]["total"]
    if a >= b:
        raise AssertionError(
            f"{meta.get('identity')}: reported {merges} merges on {rtype} but the identity count "
            f"did not fall ({b} -> {a}). The rewrite did not reach the reconciler's key field.")


def score(runs):
    """Reconcile + histogram + the floor's verdict, all through the shipped authorities."""
    from api.services.wisdom.extract import reconcile
    from api.services.wisdom.publish import floor

    result = reconcile.reconcile(runs)
    hist = reconcile.histogram(result)
    per_type: dict = {}
    for s in result["scores"]:
        slot = per_type.setdefault(s["record_type"] or "UNKNOWN",
                                   {"total": 0, "stability_sum": 0.0, "publish": 0, "block": 0})
        slot["total"] += 1
        slot["stability_sum"] += s["stability"]
        if floor.passes(s["record_type"], s["stability"], s["n"]):
            slot["publish"] += 1
        else:
            slot["block"] += 1
    for slot in per_type.values():
        slot["stability_mean"] = round(slot["stability_sum"] / slot["total"], 4) if slot["total"] else 0.0
        del slot["stability_sum"]
    return {"n": result["n"], "identities": len(result["scores"]), "histogram": hist,
            "per_type": per_type}


# ── artifacts ────────────────────────────────────────────────────────────────

def write_manifest(root: pathlib.Path, label: str, scored: dict, meta: dict) -> pathlib.Path:
    """One manifest per identity, beside the runs, in the gitignored tree (§0.4f).

    ⛔ The manifest carries counts, histograms and cluster STATS. The merged PAIRS are written
    separately (see `write_review_file`) because they carry keys, and keys are quote-derived.
    """
    import os

    d = root / f"reconcile-{label}"
    d.mkdir(parents=True, exist_ok=True)
    safe_meta = {k: v for k, v in meta.items() if k != "pairs"}
    payload = {"identity": label, "n": scored["n"], "identities": scored["identities"],
               "per_type": scored["per_type"], "histogram": scored["histogram"], "meta": safe_meta}
    path = d / "manifest.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n",
                   encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return path


def load_runs(root: pathlib.Path) -> list:
    from api.services.wisdom.extract import reconcile

    ids = reconcile.discover(root)
    if len(ids) < 2:
        raise SystemExit(f"INCONCLUSIVE: {len(ids)} persisted run(s) under {root}; need at least 2")
    return [reconcile.load_run(root, rid) for rid in ids]


def paraphrase_lens():
    """A PAIRWISE predicate assembled from golden.py's own lens parts — never reimplemented.

    ⛔ WHY ASSEMBLED RATHER THAN CALLED. golden's lens is `_fuzzy_agreed(a_keys, b_keys)`
    (golden.py:721-761): a greedy ONE-TO-ONE matcher that returns a COUNT of agreed records
    between two runs. Clustering needs a symmetric pair predicate, which that is not. So the three
    parts are taken exactly as they are and nothing is re-derived:

        tokenizer   golden._key_tokens          golden.py:698 / body :718
        threshold   golden.PARAPHRASE_TOKEN_OVERLAP = 0.6   golden.py:662
        guard       golden._polarity_conflict   golden.py:679-695

    ⚠️ The threshold is documented as deliberately generous — an UPPER bound on how much drift is
    paraphrase — so this identity OVER-merges by design and is reported as a bound, never as a
    proposal.

    ⛔ It compares `key[1]`, the `normalize_quote_key` form, which is what the lens itself reads
    (golden.py:745,750) — not the raw statement. Comparing raw text would be a different measure
    wearing the lens's name.

    ⚰️ Resolved at CALL time and the resolved names are reported, because this very module once had
    `_tokens` bound TWICE at module level (the E5 shadowing bug): the similarity that ran was not
    the one anybody had read. Measured 2026-09-15: `_tokens` is now bound exactly once
    (golden.py:329) and `_key_tokens` once (golden.py:698).
    """
    from api.services.wisdom.extract import golden

    tokens = getattr(golden, "_key_tokens", None)
    threshold = getattr(golden, "PARAPHRASE_TOKEN_OVERLAP", None)
    conflict = getattr(golden, "_polarity_conflict", None)
    if not callable(tokens) or threshold is None or not callable(conflict):
        return None, None

    def lens(a: str, b: str) -> bool:
        if not a or not b:
            return False
        if conflict(a, b):
            return False              # never/always, long/short, above/below — not a paraphrase
        ta, tb = tokens(a), tokens(b)
        union = ta | tb
        if not union:
            return False              # no tokens survive the >2-char filter: no evidence, no merge
        return (len(ta & tb) / len(union)) >= threshold

    return (f"_key_tokens+PARAPHRASE_TOKEN_OVERLAP({threshold})+_polarity_conflict", lens)


def write_review_file(path: pathlib.Path, rows: list) -> int:
    """The owner's hand-check sheet. ⛔ GITIGNORED ONLY — it carries the merged keys themselves.

    The report may state that this file exists and how many rows it has. It may never quote a row.
    """
    import os

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True, default=str) + "\n")
    os.replace(tmp, path)
    return len(rows)
