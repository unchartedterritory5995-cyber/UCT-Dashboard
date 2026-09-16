"""Ask-AI grounding eval 6.4, method grounding-v1 (W1 §6.4; manifest §7.4; metrics-v1.md §6.4).

Per question, three mechanical numbers:
  coverage             is the question answerable from the corpus at all? (FTS index when S-F's
                       retrieval exists, else keyword search over wisdom_segments)
  citation validity    every [S:<segment_id>] cite in an answer resolves to a stored segment
  faithfulness         every claim sentence carries a valid cite AND its numbers and tickers occur
                       in the cited segment text AND half its content words do
The judge is the corpus, not a model: nothing here asks an LLM whether an answer is grounded.

THE QUESTION SET is fixed, versioned and GITIGNORED (data/wisdom/eval/askai-wisdom-v1.json): its
questions are written from paid content. When it is absent the run is INCONCLUSIVE, never a zero.

ARMS. with_wisdom retrieves segments through S-F's retrieval (find_spec seam
api.services.wisdom.publish.retrieval.search); without_wisdom gives the answerer none. Answer
generation costs money, so it runs only when asked (generate_answers=True, not dry_run) and
stops at max_usd.
"""
from __future__ import annotations

import importlib
import importlib.util
import inspect
import json
import pathlib
import re
import sqlite3
from typing import Callable, Optional

from api.services.wisdom.core import ids, store, timeutil

SET_VERSION = "askai-wisdom-v1"
METHOD_VERSION = "grounding-v1"
EXPECTED_QUESTIONS = 30
#: Bound against the retrieval signature, never executed — `bind()` matches arguments to
#: parameters and runs no code, so this costs no query and touches no index.
_PROBE_QUERY = "signature probe"
REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
CITE_RE = re.compile(r"\[S:([0-9a-f]{8,64})\]")
_NUM_RE = re.compile(r"(?<![\w.])\d+(?:\.\d+)?")
_TICKER_RE = re.compile(r"\$?\b[A-Z]{2,5}\b")
_WORD_RE = re.compile(r"[a-z][a-z0-9']{3,}")
_STOP = frozenset("""about above after again against also because been before being below between both
could does doing down during each from further have having here into itself just more most much must
only other over same should some such than that their them then there these they this those through
under until very were what when where which while will with would your yours said says like""".split())
OPUS_USD_PER_M_INPUT = 5.0
OPUS_USD_PER_M_OUTPUT = 25.0


def default_set_path() -> pathlib.Path:
    return REPO_ROOT / "data" / "wisdom" / "eval" / f"{SET_VERSION}.json"


def load_question_set(path=None) -> tuple:
    """(set, None) or (None, reason). Validates the fixed shape so a truncated file is not a run."""
    p = pathlib.Path(path) if path else default_set_path()
    if not p.exists():
        return None, f"question_set_absent:{p.name}"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except ValueError as exc:
        return None, f"question_set_unparseable:{exc}"
    questions = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(questions, list) or len(questions) != EXPECTED_QUESTIONS:
        return None, f"question_set_invalid:expected_{EXPECTED_QUESTIONS}_questions"
    qids = [q.get("qid") for q in questions]
    if len(set(qids)) != len(qids) or any(not q for q in qids):
        return None, "question_set_invalid:qids_not_unique"
    for q in questions:
        terms = ((q.get("coverage") or {}).get("all_of") or [])
        if not q.get("question") or not terms:
            return None, f"question_set_invalid:{q.get('qid')}_missing_question_or_terms"
    return data, None


def coverage_for(conn: sqlite3.Connection, question: dict, *, k: int = 5) -> dict:
    cov = question.get("coverage") or {}
    all_of = [str(t).lower() for t in cov.get("all_of") or []]
    any_of = [str(t).lower() for t in cov.get("any_of") or []]
    where = ["LOWER(text) LIKE ?" for _ in all_of]
    params: list = [f"%{t}%" for t in all_of]
    if any_of:
        where.append("(" + " OR ".join("LOWER(text) LIKE ?" for _ in any_of) + ")")
        params += [f"%{t}%" for t in any_of]
    try:
        rows = conn.execute(f"SELECT segment_id FROM wisdom_segments WHERE {' AND '.join(where)} LIMIT ?",
                            params + [k]).fetchall()
    except sqlite3.Error as exc:
        return {"covered": False, "segment_ids": [], "method": "keyword", "error": type(exc).__name__}
    return {"covered": bool(rows), "segment_ids": [r[0] for r in rows], "method": "keyword"}


def split_claims(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text or "")
    return [p.strip() for p in parts if len(CITE_RE.sub("", p).split()) >= 4]


def check_answer(conn: sqlite3.Connection, text: str) -> dict:
    cites = CITE_RE.findall(text or "")
    found: dict = {}
    distinct = sorted(set(cites))
    if distinct:
        marks = ",".join("?" for _ in distinct)
        for sid, body in conn.execute(f"SELECT segment_id, text FROM wisdom_segments WHERE segment_id IN ({marks})",
                                      distinct):
            found[sid] = body or ""
    claims = split_claims(text)
    detail, traceable = [], 0
    for claim in claims:
        claim_cites = [c for c in CITE_RE.findall(claim) if c in found]
        bare = CITE_RE.sub("", claim)
        if not claim_cites:
            detail.append({"traceable": False, "why": "no_valid_citation"})
            continue
        union = " ".join(found[c] for c in claim_cites).lower()
        numbers_ok = all(n in union for n in _NUM_RE.findall(bare))
        tickers_ok = all(t.lstrip("$").lower() in union for t in _TICKER_RE.findall(bare))
        words = {w for w in _WORD_RE.findall(bare.lower()) if w not in _STOP}
        share = 1.0 if not words else len(words & set(_WORD_RE.findall(union))) / len(words)
        ok = numbers_ok and tickers_ok and share >= 0.5
        traceable += int(ok)
        detail.append({"traceable": ok, "numbers_ok": numbers_ok, "tickers_ok": tickers_ok,
                       "word_share": round(share, 3)})
    return {"claims": len(claims), "traceable": traceable, "cites": len(cites),
            "valid_cites": sum(1 for c in cites if c in found), "claim_detail": detail}


class BudgetExceeded(RuntimeError):
    pass


class AnthropicAnswerer:
    """One Messages call per question, capped in dollars, usage printed by the caller."""

    SYSTEM = ("You answer questions about what the UCT trading team (TSDR, Bracco, Manrav, Chartmaster) has "
              "taught. Use ONLY the numbered source segments provided. After every sentence that states a "
              "fact, cite the segment it came from as [S:<segment_id>]. If no segment answers the question, "
              "say so in one sentence and cite nothing.")

    def __init__(self, *, model: str = "claude-opus-5", max_tokens: int = 500, max_usd: float = 5.0):
        self.model, self.max_tokens, self.max_usd = model, max_tokens, max_usd
        self.spent_usd = 0.0
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._client = None

    def _get_client(self):
        if self._client is None:
            import anthropic

            from api.services import llm_timeouts

            self._client = anthropic.Anthropic(timeout=llm_timeouts.OFFLINE_JOB)
        return self._client

    def answer(self, question: str, segments: list) -> dict:
        if self.spent_usd >= self.max_usd:
            raise BudgetExceeded(f"spent ${self.spent_usd:.4f} of ${self.max_usd:.2f}")
        blocks = "\n\n".join(f"[S:{s['segment_id']}] {str(s.get('text') or '')[:1500]}" for s in segments)
        prompt = question if not segments else f"{question}\n\nSource segments:\n{blocks}"
        msg = self._get_client().messages.create(model=self.model, max_tokens=self.max_tokens, system=self.SYSTEM,
                                                 messages=[{"role": "user", "content": prompt}])
        text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
        usage = getattr(msg, "usage", None)
        tin = int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "cache_creation_input_tokens", 0) or 0) \
            + int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        tout = int(getattr(usage, "output_tokens", 0) or 0)
        cost = tin / 1e6 * OPUS_USD_PER_M_INPUT + tout / 1e6 * OPUS_USD_PER_M_OUTPUT
        self.calls += 1
        self.input_tokens += tin
        self.output_tokens += tout
        self.spent_usd += cost
        return {"text": text, "input_tokens": tin, "output_tokens": tout, "cost_usd": round(cost, 6)}

    def usage(self) -> dict:
        return {"model": self.model, "calls": self.calls, "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens, "cost_usd": round(self.spent_usd, 6), "cap_usd": self.max_usd}


def retrieval_seam() -> tuple:
    """(search(query, k) -> [{segment_id, text}], status). S-F builds the module; until then None.

    ⚰️ THIS SEAM REPORTED "ok" FOR A SEARCH IT COULD NOT CALL, and the arm it feeds is the
    whole point of the eval. S-F's search is keyword-only past `query`
    (`search(query, *, tickers=(), limit=3, ...)`), and this wrapper invoked `fn(query, k)`
    positionally — a TypeError on EVERY question. `run_grounding` catches that per question
    into `retrieval_error` and carries on with no segments, so the with_wisdom arm would have
    retrieved NOTHING while the metric row still said `retrieval: ok`: the two arms identical,
    published as a measurement of whether wisdom retrieval grounds better than none.

    ⭐ Which is why the bind check is here rather than at the call site. An exception per
    question is swallowed and becomes a confident finding; a status computed ONCE, before this
    returns, is the difference between "we could not retrieve" and "retrieval added nothing" —
    two facts a reader of the D-class metrics must never see collapsed
    (`lesson_a_swallowed_error_becomes_a_confident_finding`).

    ⛔ Refusing outright beats calling it wrong. An unbindable search is reported by NAME and
    the arm runs without retrieval; guessing at a positional spelling is how this broke.
    """
    name = "api.services.wisdom.publish.retrieval"
    if importlib.util.find_spec(name) is None:
        return None, "retrieval_module_absent"
    try:
        fn = getattr(importlib.import_module(name), "search", None)
    except Exception as exc:
        return None, f"retrieval_import_failed:{type(exc).__name__}"
    if not callable(fn):
        return None, "retrieval_search_absent"
    try:
        inspect.signature(fn).bind(_PROBE_QUERY, limit=1)
    except (TypeError, ValueError):
        return None, "retrieval_signature_mismatch"

    def search(query: str, k: int) -> list:
        out = []
        for item in fn(query, limit=k) or []:
            item = dict(item)
            if item.get("segment_id"):
                out.append({"segment_id": item["segment_id"], "text": item.get("text") or ""})
        return out
    return search, "ok"


def _rate(k: int, n: int) -> Optional[float]:
    return None if n == 0 else round(k / n, 6)


def run_grounding(ctx, *, with_wisdom: bool, db_path: Optional[str] = None, set_path=None,
                  answerer=None, retrieval: Optional[Callable] = None, generate_answers: bool = False,
                  k: int = 5) -> dict:
    arm = "with_wisdom" if with_wisdom else "without_wisdom"
    data, why = load_question_set(set_path)
    if data is None:
        return {"status": "INCONCLUSIVE", "reason": why, "arm": arm, "method_version": METHOD_VERSION}
    retrieval_status = "not_used"
    if with_wisdom:
        if retrieval is None:
            retrieval, retrieval_status = retrieval_seam()
        else:
            retrieval_status = "injected"
    spend = generate_answers and not ctx.dry_run
    if spend and answerer is None:
        answerer = AnthropicAnswerer()
    per_question, covered = [], 0
    claims = traceable = cites = valid = answered = 0
    stopped = None
    with store.read(db_path) as conn:
        for q in data["questions"]:
            cov = coverage_for(conn, q, k=k)
            covered += int(cov["covered"])
            item = {"qid": q["qid"], "shape": q.get("shape"), "covered": cov["covered"],
                    "coverage_segments": len(cov["segment_ids"])}
            if spend and stopped is None:
                segments = []
                if with_wisdom and retrieval is not None:
                    try:
                        segments = retrieval(q["question"], k)
                    except Exception as exc:
                        item["retrieval_error"] = type(exc).__name__
                try:
                    ans = answerer.answer(q["question"], segments)
                except BudgetExceeded as exc:
                    stopped = str(exc)
                else:
                    checked = check_answer(conn, ans["text"])
                    answered += 1
                    claims += checked["claims"]
                    traceable += checked["traceable"]
                    cites += checked["cites"]
                    valid += checked["valid_cites"]
                    item.update({"answered": True, "segments_given": len(segments), "claims": checked["claims"],
                                 "traceable": checked["traceable"], "cites": checked["cites"],
                                 "valid_cites": checked["valid_cites"]})
            per_question.append(item)
    total = len(data["questions"])
    computed_at = timeutil.iso_et(ctx.now_et)
    run_id = ids.sha24("grounding", arm, METHOD_VERSION, computed_at)
    usage = answerer.usage() if answerer is not None and hasattr(answerer, "usage") else None
    notes = {"arm": arm, "question_set": data.get("version", SET_VERSION), "questions": total,
             "answers_generated": answered, "retrieval": retrieval_status, "budget_stop": stopped,
             "usage": usage}
    rows = [
        ("grounding_coverage", covered, total),
        ("grounding_faithfulness", traceable, claims),
        ("grounding_citation_validity", valid, cites),
    ]
    metric_rows = [{"metric_run_id": run_id, "metric": m, "slice_json": json.dumps({"status": "combined"}),
                    "numerator": num, "denominator": den, "value": _rate(num, den), "method_version": METHOD_VERSION,
                    "computed_at": computed_at, "notes": json.dumps(notes, sort_keys=True)} for m, num, den in rows]
    if not ctx.dry_run:
        with store.write(db_path) as conn:
            conn.executemany(
                "INSERT INTO wisdom_metrics (metric_run_id, metric, slice_json, numerator, denominator, value, "
                "method_version, computed_at, notes) VALUES (:metric_run_id, :metric, :slice_json, :numerator, "
                ":denominator, :value, :method_version, :computed_at, :notes)", metric_rows)
            conn.execute(
                "INSERT OR REPLACE INTO wisdom_eval_runs (run_id, kind, extractor_version, method_version, n, "
                "metrics_json, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
                (run_id, f"grounding:{arm}", METHOD_VERSION, total,
                 json.dumps({"notes": notes, "per_question": per_question}, sort_keys=True), computed_at))
    return {"status": "ok", "arm": arm, "run_id": run_id, "method_version": METHOD_VERSION,
            "coverage": f"{covered}/{total}", "faithfulness": f"{traceable}/{claims}",
            "citation_validity": f"{valid}/{cites}", "answers_generated": answered, "retrieval": retrieval_status,
            "budget_stop": stopped, "usage": usage, "written": not ctx.dry_run, "per_question": per_question}
