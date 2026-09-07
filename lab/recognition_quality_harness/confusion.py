"""Confusion-matrix + precision/recall computation, generalized from the
by-hand cross-referencing done identically three times (Hammer, Bull Flag,
Pullback-to-21-EMA): read the judge's per-case verdict, read
`answer_key_ingredients.json`'s `detector_fired`, tally TP/FP/FN/TN,
excluding AMBIGUOUS-INSUFFICIENT cases from the denominator (the convention
every prior cycle used, now made structural instead of re-derived by hand
each time -- a real source of copy-paste risk given how easy it is to get
this cross-reference subtly wrong under time pressure).
"""
from __future__ import annotations

from dataclasses import dataclass, field


AMBIGUOUS_LABELS = {"AMBIGUOUS-INSUFFICIENT", "AMBIGUOUS", "AMBIGUOUS_INSUFFICIENT"}
POSITIVE_LABELS = {"POSITIVE"}
NEGATIVE_LABELS = {"NEGATIVE"}


@dataclass
class ConfusionResult:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    excluded: int = 0
    tp_cases: list[str] = field(default_factory=list)
    fp_cases: list[str] = field(default_factory=list)
    fn_cases: list[str] = field(default_factory=list)
    tn_cases: list[str] = field(default_factory=list)
    excluded_cases: list[str] = field(default_factory=list)
    unmatched_cases: list[str] = field(default_factory=list)  # in verdicts but not in answer_key, or vice versa

    @property
    def n_scored(self) -> int:
        return self.tp + self.fp + self.fn + self.tn

    @property
    def precision(self) -> float | None:
        denom = self.tp + self.fp
        return round(self.tp / denom, 3) if denom else None

    @property
    def recall(self) -> float | None:
        denom = self.tp + self.fn
        return round(self.tp / denom, 3) if denom else None

    def summary_line(self) -> str:
        p = f"{self.precision:.3f}" if self.precision is not None else "n/a"
        r = f"{self.recall:.3f}" if self.recall is not None else "n/a"
        return (f"TP={self.tp} FP={self.fp} FN={self.fn} TN={self.tn} "
                f"(n_scored={self.n_scored}, excluded={self.excluded}) "
                f"-> precision={p}, recall={r}")


def compute_confusion(verdicts: dict[str, str], answer_key: dict[str, dict]) -> ConfusionResult:
    """`verdicts`: case_id -> "POSITIVE"|"NEGATIVE"|"AMBIGUOUS-INSUFFICIENT".
    `answer_key`: case_id -> {..., "detector_fired": bool, ...} (the
    corpus_builder's answer_key_ingredients.json, loaded as a dict).
    Case ids present in one but not the other are recorded, never silently
    dropped -- a mismatch here is itself a real finding (a judge who
    skipped a case, or an id typo), not noise to average away."""
    result = ConfusionResult()
    verdict_ids = set(verdicts.keys())
    key_ids = set(answer_key.keys())
    result.unmatched_cases = sorted(verdict_ids ^ key_ids)

    for case_id in sorted(verdict_ids & key_ids):
        verdict = verdicts[case_id].strip().upper()
        fired = bool(answer_key[case_id]["detector_fired"])

        if verdict in AMBIGUOUS_LABELS:
            result.excluded += 1
            result.excluded_cases.append(case_id)
            continue
        is_positive = verdict in POSITIVE_LABELS
        if is_positive and fired:
            result.tp += 1
            result.tp_cases.append(case_id)
        elif is_positive and not fired:
            result.fn += 1
            result.fn_cases.append(case_id)
        elif not is_positive and fired:
            result.fp += 1
            result.fp_cases.append(case_id)
        else:
            result.tn += 1
            result.tn_cases.append(case_id)

    return result
