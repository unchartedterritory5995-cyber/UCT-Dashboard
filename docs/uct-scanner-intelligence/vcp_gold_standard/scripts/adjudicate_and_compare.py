"""Phase 3B Lane A -- adjudicate the 4-reviewer blinded judgments per case,
then join with the (previously hidden) answer key to compute System A / D
quantitative metrics against reviewer-established ground truth.

Input:  data/review_results_raw.json  (the Workflow output, saved manually
        after the blinded-review run completes)
        data/case_answer_key.json     (System A/D outputs + case metadata)
Output: data/adjudication.json        (per-case consensus + agreement level)
        data/metrics.json             (precision/recall/F1/etc for A and D)
"""
import json
import math
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(__file__)
RAW_PATH = os.path.join(HERE, "..", "data", "review_results_raw.json")
ANSWER_KEY_PATH = os.path.join(HERE, "..", "data", "case_answer_key.json")
ADJUDICATION_PATH = os.path.join(HERE, "..", "data", "adjudication.json")
METRICS_PATH = os.path.join(HERE, "..", "data", "metrics.json")


def wilson_ci(successes, n, z=1.96):
    if n == 0:
        return (None, None)
    p = successes / n
    denom = 1 + z ** 2 / n
    center = (p + z ** 2 / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p) / n) + (z ** 2 / (4 * n ** 2)))) / denom
    return (round(max(0.0, center - half), 3), round(min(1.0, center + half), 3))


def load_reviews():
    raw = json.load(open(RAW_PATH, encoding="utf-8"))
    # raw is the Workflow return value: {"results": [{persona_key, batch_idx, result:{case_judgments:[...]}}]}
    by_case = defaultdict(list)  # case_id -> list of judgments (one per reviewer)
    for entry in raw["results"]:
        persona = entry["persona_key"]
        judgments = entry["result"]["case_judgments"]
        for j in judgments:
            j["_reviewer"] = persona
            by_case[j["case_id"]].append(j)
    return by_case


def adjudicate_case(case_id, judgments):
    identities = [j["identity"] for j in judgments]
    counts = Counter(identities)
    n = len(judgments)
    yes = counts.get("YES", 0)
    borderline = counts.get("BORDERLINE", 0)
    no = counts.get("NO", 0)
    insuff = counts.get("INSUFFICIENT_DATA", 0)

    # Consensus direction (unanimous / strong-majority / weak-majority / unresolved)
    max_count = counts.most_common(1)[0][1] if counts else 0
    if max_count == n:
        agreement = "unanimous"
    elif max_count >= math.ceil(n * 0.75):
        agreement = "strong_majority"
    elif max_count > n / 2:
        agreement = "weak_majority"
    else:
        agreement = "unresolved"

    # Reviewer-consensus label for quantitative comparison. Strict: only
    # unanimous or strong_majority YES/NO become a binary ground-truth label;
    # everything else (including all BORDERLINE-led or unresolved cases) is
    # excluded from precision/recall/F1 -- per A6's explicit instruction not
    # to manufacture certainty out of ambiguity.
    consensus_label = None
    if agreement in ("unanimous", "strong_majority"):
        top_label = counts.most_common(1)[0][0]
        if top_label == "YES":
            consensus_label = "positive"
        elif top_label == "NO":
            consensus_label = "negative"
        # BORDERLINE/INSUFFICIENT_DATA majorities stay None (excluded)

    avg_confidence = round(sum(j["confidence_0_100"] for j in judgments) / n, 1) if n else None
    avg_quality = None
    quality_vals = [j["quality_0_100"] for j in judgments if j.get("quality_0_100") is not None]
    if quality_vals:
        avg_quality = round(sum(quality_vals) / len(quality_vals), 1)
    lifecycle_counts = Counter(j["lifecycle"] for j in judgments)

    return {
        "case_id": case_id,
        "n_reviewers": n,
        "identity_counts": dict(counts),
        "agreement_level": agreement,
        "consensus_label": consensus_label,
        "avg_confidence": avg_confidence,
        "avg_quality": avg_quality,
        "lifecycle_counts": dict(lifecycle_counts),
        "judgments": judgments,
    }


def confusion_counts(cases, answer_key, engine_key):
    tp = fp = tn = fn = 0
    excluded = 0
    for c in cases:
        label = c["consensus_label"]
        if label is None:
            excluded += 1
            continue
        fired = answer_key[c["case_id"]][engine_key]["fired"]
        if label == "positive" and fired:
            tp += 1
        elif label == "positive" and not fired:
            fn += 1
        elif label == "negative" and fired:
            fp += 1
        elif label == "negative" and not fired:
            tn += 1
    return tp, fp, tn, fn, excluded


def metrics_from_confusion(tp, fp, tn, fn):
    n = tp + fp + tn + fn
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * precision * recall / (precision + recall)) if (precision and recall and (precision + recall) > 0) else None
    fpr = fp / (fp + tn) if (fp + tn) else None
    fnr = fn / (fn + tp) if (fn + tp) else None
    precision_ci = wilson_ci(tp, tp + fp) if (tp + fp) else (None, None)
    recall_ci = wilson_ci(tp, tp + fn) if (tp + fn) else (None, None)
    return {
        "n": n, "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": round(precision, 3) if precision is not None else None,
        "precision_95ci": precision_ci,
        "recall": round(recall, 3) if recall is not None else None,
        "recall_95ci": recall_ci,
        "f1": round(f1, 3) if f1 is not None else None,
        "false_positive_rate": round(fpr, 3) if fpr is not None else None,
        "false_negative_rate": round(fnr, 3) if fnr is not None else None,
    }


def main():
    by_case = load_reviews()
    answer_key = json.load(open(ANSWER_KEY_PATH, encoding="utf-8"))

    adjudications = {}
    for case_id, judgments in by_case.items():
        adjudications[case_id] = adjudicate_case(case_id, judgments)

    missing = set(answer_key.keys()) - set(adjudications.keys())
    if missing:
        print("WARNING: cases with no review judgments:", sorted(missing))

    cases = list(adjudications.values())

    agreement_summary = Counter(c["agreement_level"] for c in cases)
    consensus_summary = Counter(c["consensus_label"] or "excluded_ambiguous" for c in cases)

    metrics = {"overall": {}}
    for engine_key, engine_label in (("system_a", "System A"), ("system_d", "System D")):
        tp, fp, tn, fn, excluded = confusion_counts(cases, answer_key, engine_key)
        m = metrics_from_confusion(tp, fp, tn, fn)
        m["excluded_ambiguous_cases"] = excluded
        metrics["overall"][engine_key] = m

    # Engine agreement / disagreement rate (independent of reviewer labels)
    both_fired = sum(1 for c in cases if answer_key[c["case_id"]]["system_a"]["fired"] and answer_key[c["case_id"]]["system_d"]["fired"])
    both_rejected = sum(1 for c in cases if not answer_key[c["case_id"]]["system_a"]["fired"] and not answer_key[c["case_id"]]["system_d"]["fired"])
    disagree = len(cases) - both_fired - both_rejected
    metrics["engine_agreement"] = {
        "both_fired": both_fired, "both_rejected": both_rejected,
        "disagree": disagree, "n": len(cases),
        "agreement_rate": round((both_fired + both_rejected) / len(cases), 3) if cases else None,
    }

    # By lifecycle (reviewer-modal lifecycle per case), by liquidity, by volatility
    def group_metrics(group_fn):
        groups = defaultdict(list)
        for c in cases:
            groups[group_fn(c)].append(c)
        out = {}
        for g, gc in groups.items():
            row = {"n": len(gc)}
            for engine_key in ("system_a", "system_d"):
                tp, fp, tn, fn, excluded = confusion_counts(gc, answer_key, engine_key)
                row[engine_key] = metrics_from_confusion(tp, fp, tn, fn)
                row[engine_key]["excluded_ambiguous_cases"] = excluded
            out[g] = row
        return out

    def modal_lifecycle(c):
        if not c["lifecycle_counts"]:
            return "unknown"
        return Counter(c["lifecycle_counts"]).most_common(1)[0][0]

    metrics["by_lifecycle"] = group_metrics(lambda c: modal_lifecycle(c))
    metrics["by_liquidity_tier"] = group_metrics(lambda c: answer_key[c["case_id"]]["liquidity_tier"])
    metrics["by_volatility_tier"] = group_metrics(lambda c: answer_key[c["case_id"]]["volatility_tier"])
    metrics["by_agreement_category"] = group_metrics(lambda c: answer_key[c["case_id"]]["agreement_category"])

    metrics["reviewer_agreement_summary"] = dict(agreement_summary)
    metrics["consensus_label_summary"] = dict(consensus_summary)
    metrics["n_cases"] = len(cases)

    json.dump(adjudications, open(ADJUDICATION_PATH, "w", encoding="utf-8"), indent=2, default=str)
    json.dump(metrics, open(METRICS_PATH, "w", encoding="utf-8"), indent=2, default=str)

    print("agreement levels:", dict(agreement_summary))
    print("consensus labels:", dict(consensus_summary))
    print("System A overall:", metrics["overall"]["system_a"])
    print("System D overall:", metrics["overall"]["system_d"])
    print("engine agreement:", metrics["engine_agreement"])
    print("wrote", ADJUDICATION_PATH)
    print("wrote", METRICS_PATH)


if __name__ == "__main__":
    main()
