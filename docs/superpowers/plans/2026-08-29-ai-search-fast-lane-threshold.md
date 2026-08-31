# AI Search — Fast-Lane Quality Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the fast lane — the path 49 of 50 real member asks take — from a measured median of 12/30 to a defensible **23/30, with every remaining failure explained rather than mysterious**.

**Architecture:** Every task fixes something *measured* on 2026-08-29, not something suspected. The order is deliberate: make the instrument honest first (Tasks 1–2), because three separate times tonight a harness artifact was nearly reported as a product defect; then fix product defects (3–6); then arm the capability we already own (7); then, and only then, set the ratchet (8).

**Tech Stack:** Python 3.14 · FastAPI · pytest · Perplexity `sonar-pro` · Anthropic (judge + agent lane) · SQLite trend store.

**Spec:** This plan's evidence base is the session record in
`~/.claude/projects/C--Users-Patrick/memory/project_ai_search_ecosystem_2026_08_27.md`
(sections "PHASE 2", "FAST-LANE SCORES ARE NOT COMPARABLE ACROSS SESSIONS",
"DESK GAPS"). Read it before starting: it carries the traps that cost hours.

---

## Global Constraints

- **Never lower a bar to green a run.** `SEARCH_RUNG_PASS_BARS` is a ratchet. A gate that *no correct answer can satisfy* is a broken gate and may be fixed; a gate a correct answer fails is a product defect and may not.
- **TRANSLATE, don't disarm.** Three checks were repaired tonight by teaching them the lane's vocabulary (`fabricated_scan_rows`, the fast-lane gate, `price_without_tool`). Disarming a check is a last resort requiring an explicit note.
- **Fast-lane scores are only comparable WITHIN one session.** This lane's grounding is live market data. Never A/B across hours; run before-and-after back to back, or use `--grounding-audit`, which is deterministic and free.
- **Measure retrieval with `--grounding-audit` before paying for answers.** Zero cost, seconds, 30 questions.
- **The desk must be WARM.** Vendor keys live in `uct-intelligence/.env` (Massive/Finnhub/FMP); the report-card script only stages `ANTHROPIC`/`PERPLEXITY`. Load both or every rung-1 result is a harness artifact.
- **Run the exam LOCALLY, never on the prod pod** — it double-loads the api stack beside uvicorn and OOMs the single web pod (member-visible outage, twice on 8/28).
- Shared worktree: never `git add -A`; ship with `git push origin <branch>:master`; fetch → merge → re-verify → push, never force.
- Every new rail ships with a **control** proving it can return the other answer.

**Target, per rung** (current median → target):

| rung | what it tests | now | target | why not higher |
|---|---|---|---|---|
| 1 | desk facts | 3/8 | 7/8 | `S1-06` flow needs the flow-worker; unreachable locally |
| 2 | web + citations | 2/6 | 4/6 | no task targets this rung directly — the lift is expected from Task 3 (a timeout costs a whole web answer) and Task 5 (a declared gap stops the model substituting a web figure for desk data). **If Task 6 shows rung 2 still below 4/6, that is an unexplained miss and needs its own task before Task 8.** |
| 3 | verdicts/setups | 2/6 | 4/6 | `S3-05` needs a warm brain index |
| 4 | data-limits honesty | 0/5 | 3/5 | attributed per question 2026-08-29, and it is NOT a honesty-prompt problem: `S4-01`+`S4-02` are broken gates (Task 2), `S4-03` is a cold flow pack (environment), `S4-04` is a real capability gap (Task 4b), `S4-05`'s gate demands `web_search` when a correct "nobody knows" cites nothing. The shipped DESK GAPS change did NOT move this rung — measured, and recorded so nobody re-tries it. |
| 5 | refusals | 5/5 | 5/5 | already clean |
| | **total** | **12/30** | **23/30** | |

---

## STATUS 2026-08-30 — 7 of 8 tasks DONE

| task | state |
|---|---|
| 1 readiness probes every pack | ✅ `ce4e99367` |
| 2 fast-lane gates for refusal questions | ✅ `ce4e99367` |
| 3 timeout: 18s → 30s + one bounded retry | ✅ `f33bd8637` |
| 4 S1-07 short interest | ✅ declared as a gap (`f33bd8637`) — the row's `short_float_pct` is NULL, so the honest fix was to SAY so, not to render it |
| 4b written dates | ✅ `f33bd8637` — live: NVDA 2016-03-03 close $0.8163 |
| 5 per-ticker desk gaps | ✅ `ce4e99367` |
| 6 measure back-to-back | ✅ retrieval **16/30 → 25/30**; all 5 residual misses named |
| 7 agent auto-route | ✅ measured, **NOT ARMED** — three A/Bs, no win. The fast lane caught up once the clamps came off. |
| **8 set the ratchet** | ⛔ **DELIBERATELY NOT DONE — do not do it on a weekend.** |

### Why Task 8 is still open

2026-08-30 is a **Sunday**. `movers` and `earnings` are legitimately empty, the
flow-worker is unreachable and the brain index is cold. Writing today's per-rung
numbers into `SEARCH_RUNG_PASS_BARS` would set a permanent floor from the
worst-case environment, and honestly-good weekday work would fail against it
forever. That is the same defect as lowering a bar to green a run, in the other
direction.

**Do it on a warm weekday**, desk WARM in the pre-flight, median of 3 repeats,
bars + label + the gate-test pin in ONE commit.

### Also open, and NOT this plan's to fix

`tests/test_definition_concierge.py::test_the_propose_route_is_MOUNTED_and_PAID_GATED_like_every_other`
is RED on master: the `user_definitions` router grew **12 → 16 routes**
(`fede36788`, the library/sharing initiative) and neither count pin moved. ⛔ Do
NOT bump the number to green it — the pin exists so new routes get auth
coverage. Whoever added the four routes should confirm each is auth-gated, then
move both pins together.

---

### Task 1: The readiness probe must name every cold pack, not just `quote`

Tonight the probe checked one pack. `movers`, `flow` and the brain index were cold and their questions read as product failures. An exam that cannot tell "we don't hold this here" from "the product is broken" will keep producing wrong verdicts.

**Files:**
- Modify: `api/services/ai_search_eval/runner.py` (`fast_lane_desk_readiness`)
- Modify: `scripts/run_search_report_card.py` (readiness print)
- Test: `tests/test_ai_search_fast_lane_exam.py`

**Interfaces:**
- Consumes: `runner._PACK_TOOL_ALIAS` (pack → agent-tool name).
- Produces: `fast_lane_desk_readiness()` returning `{"warm": bool, "sources": list[str], "missing": list[str], "cold_packs": list[str], "question": str, "error": str|None}`. `cold_packs` is new; `missing` keeps its meaning (canary-required packs absent).

- [ ] **Step 1: Write the failing test**

```python
def test_readiness_probes_every_pack_the_exam_relies_on(monkeypatch):
    """One canary only proved `quote`. movers/flow/brain were cold all night and
    their questions read as product defects."""
    from api.services.ai_search_eval import runner
    seen = []

    def _fake(q):
        seen.append(q)
        return ("SYS", "salt", {"grounding_sources": ["regime", "quote"], "ctx_block": ""})

    monkeypatch.setattr(ai, "_grounded_system", _fake)
    r = runner.fast_lane_desk_readiness()
    assert len(seen) > 1, "readiness still probes a single canary"
    assert "movers" in r["cold_packs"] and "flow" in r["cold_packs"], r


def test_a_fully_warm_desk_reports_no_cold_packs(monkeypatch):
    """CONTROL — the probe must be able to say everything is warm, or it is a
    gate that can only fail."""
    from api.services.ai_search_eval import runner
    monkeypatch.setattr(
        ai, "_grounded_system",
        lambda q: ("SYS", "salt",
                   {"grounding_sources": ["regime", "quote", "movers", "flow",
                                          "breadth", "candidates", "playbook"],
                    "ctx_block": "x"}))
    assert runner.fast_lane_desk_readiness()["cold_packs"] == []
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python -m pytest tests/test_ai_search_fast_lane_exam.py -k readiness_probes -q -p no:warnings`
Expected: FAIL — `len(seen) > 1` is false (one canary), and `cold_packs` does not exist.

- [ ] **Step 3: Implement**

```python
# One probe question per pack the golden set can require. The question text is
# chosen to trip that pack's own intent gate — so if the gate itself regresses,
# this reports the pack as cold, which is the truth from the exam's point of view.
_PACK_PROBES = {
    "quote":      "what is NVDA trading at right now",
    "movers":     "what are the biggest gainers on the tape right now",
    "flow":       "what is the options flow saying on TSLA today",
    "breadth":    "what is market breadth telling us right now",
    "candidates": "what is on the scanner today",
    "playbook":   "how does the desk trade a high tight flag",
}


def fast_lane_desk_readiness(question: str | None = None) -> dict:
    from api.routers import ai_search as router
    probes = {"quote": question} if question else dict(_PACK_PROBES)
    sources: set[str] = set()
    cold: list[str] = []
    err = None
    for pack, q in probes.items():
        try:
            _system, _salt, meta = router._grounded_system(q)
            got = set(meta.get("grounding_sources") or [])
        except Exception as e:
            got, err = set(), f"{type(e).__name__}: {e}"
        sources |= got
        if pack not in got:
            cold.append(pack)
    missing = [p for p in _DESK_CANARY_EXPECT if p not in sources]
    return {"warm": not missing and err is None, "sources": sorted(sources),
            "missing": missing, "cold_packs": cold,
            "question": question or "pack sweep", "error": err}
```

- [ ] **Step 4: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_fast_lane_exam.py -q -p no:warnings`
Expected: PASS, all cases.

- [ ] **Step 5: Print cold packs in the CLI**

In `scripts/run_search_report_card.py`, inside the fast-lane pre-flight block, after the existing `desk:` line add:

```python
    if _ready.get("cold_packs"):
        print(f"          COLD PACKS (their questions measure this BOX, not the "
              f"product): {', '.join(_ready['cold_packs'])}")
```

- [ ] **Step 6: Commit**

```bash
git add api/services/ai_search_eval/runner.py scripts/run_search_report_card.py tests/test_ai_search_fast_lane_exam.py
git commit -m "fix(exam): readiness probes every pack, not one canary"
```

---

### Task 2: Fast-lane-appropriate gates for refusal questions

`S4-01` (unknown ticker `ZZZQ`) and `S4-02` (SpaceX, private) require `get_quote` / `get_short_interest`. The agent lane calls those tools and gets "unknown". The fast lane resolves no ticker, so it fires no packs — **a correct refusal can never satisfy these gates.** That is a broken gate, not a product defect, and the constraint above permits fixing it.

**Files:**
- Modify: `api/services/ai_search_eval/golden_set_search.json` (`S4-01`, `S4-02` only)
- Test: `tests/test_ai_search_fast_lane_exam.py`

**Interfaces:**
- Produces: an optional per-question key `fast_lane_tools` — when present, the fast lane uses it instead of `must_call_tools`. The agent lane always uses `must_call_tools`.

- [ ] **Step 1: Write the failing test**

```python
def test_a_correct_refusal_is_not_held_to_a_tool_it_cannot_fire(monkeypatch):
    """S4-01 asks about a ticker that does not exist. The fast lane resolves no
    symbol, so it fires no packs — and that IS the right behaviour. Holding it
    to get_quote makes a correct refusal unpassable."""
    _stub_exam(monkeypatch, ctx="", sources=["regime"],
               answer="I don't have ZZZQ on the desk — it isn't a symbol I can resolve.")
    out = runner.run_exam(lane="fast", question_ids=["S4-01-unknown-ticker"])
    assert out["results"][0]["tool_gate_pass"] is True, out["results"][0]


def test_the_agent_lane_still_owes_the_tool_call():
    """CONTROL — the agent CAN call get_quote and learn the ticker is unknown.
    Relaxing the fast lane must not relax the lane that has the tool."""
    from api.services.ai_search_eval.golden_set import load_golden_set
    q = next(x for x in load_golden_set() if x["id"] == "S4-01-unknown-ticker")
    assert ["get_quote", "grade_ticker"] in q["must_call_tools"]
```

- [ ] **Step 2: Run and watch it fail**

Run: `python -m pytest tests/test_ai_search_fast_lane_exam.py -k refusal_is_not_held -q -p no:warnings`
Expected: FAIL — `tool_gate_pass` is False.

- [ ] **Step 3: Add `fast_lane_tools` to the two questions**

In `golden_set_search.json`, add to `S4-01-unknown-ticker` and `S4-02-private-co` only:

```json
  "fast_lane_tools": []
```

- [ ] **Step 4: Honour it in the runner**

In `runner.run_exam`, immediately before `mech = checks.run_mechanical_checks(...)`:

```python
        q_for_checks = q
        if lane == "fast" and "fast_lane_tools" in q:
            # A correct refusal fires no packs. The AGENT can call get_quote and
            # be told the ticker is unknown; the fast lane has no such move, so
            # must_call_tools is agent-shaped here. Only these two questions
            # carry the override, and the agent lane never reads it.
            q_for_checks = dict(q, must_call_tools=q["fast_lane_tools"])
        transcript = {"answer": res.get("answer") or "",
                      "fired_tools": capture, "question": q_for_checks}
```

- [ ] **Step 5: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_fast_lane_exam.py -q -p no:warnings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/services/ai_search_eval/golden_set_search.json api/services/ai_search_eval/runner.py tests/test_ai_search_fast_lane_exam.py
git commit -m "fix(exam): a correct refusal is not held to a tool the lane cannot fire"
```

---

### Task 3: The 18-second timeout is a member-facing failure

Every run produced one `UNGRADED (timeout after 18s)`. In the exam that is one lost question; for a member it is a dead ask. The fast lane already has a bounded retry for 5xx; a timeout takes the outage ladder instead.

**Files:**
- Modify: `api/services/perplexity_search.py` (`_TIMEOUTS`, the `requests.Timeout` branch)
- Test: `tests/test_ai_search_resilience.py`

**Interfaces:**
- Produces: one bounded retry on timeout before the shadow/degraded ladder. No signature change.

- [ ] **Step 1: Write the failing test**

```python
def test_a_timeout_retries_once_before_giving_up(monkeypatch):
    """Measured: every fast-lane exam run lost one question to `timeout after
    18s`. A single slow upstream call should not be a dead ask."""
    calls = {"n": 0}

    def _flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise requests.Timeout("too slow")
        return _FakeResp(200, {"choices": [{"message": {"content": "ok"}}],
                               "citations": []})

    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    monkeypatch.setattr(pplx.requests, "post", _flaky)
    pplx._SEARCH_CACHE.clear()
    out = pplx.web_search("nvda", cache_salt="t-timeout")
    assert out.get("answer") == "ok"
    assert calls["n"] == 2, calls


def test_two_timeouts_still_surface_an_honest_error(monkeypatch):
    """CONTROL — the retry must be BOUNDED. An unbounded retry on the shared
    event loop is the 524-outage surface."""
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)

    def _dead(*a, **k):
        raise requests.Timeout("too slow")

    monkeypatch.setattr(pplx.requests, "post", _dead)
    pplx._SEARCH_CACHE.clear()
    out = pplx.web_search("nvda", cache_salt="t-timeout-2")
    assert not out.get("answer")
    assert "timeout" in (out.get("error") or "").lower()
```

- [ ] **Step 2: Run and watch it fail**

Run: `python -m pytest tests/test_ai_search_resilience.py -k timeout_retries -q -p no:warnings`
Expected: FAIL — `calls["n"] == 1`; the first timeout returns immediately.

- [ ] **Step 3: Implement**

In `perplexity_search.web_search`, replace the `except requests.Timeout:` branch body with:

```python
        except requests.Timeout:
            # One bounded retry: a single slow upstream call was costing a whole
            # ask (measured — every exam run lost one question to an 18s
            # timeout). BOUNDED on purpose: the retry loop runs `for attempt in
            # (0, 1)`, so this can never spin on the shared event loop.
            if attempt == 0:
                time.sleep(0.4)
                continue
            stale = _serve_shadow(model, domain_pack, query) if (allow_stale and not history) else None
            if stale is not None:
                return stale
            return {"answer": "", "citations": [], "error": f"timeout after {timeout}s",
                    "mode": resolved_mode, "model": model}
```

- [ ] **Step 4: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_resilience.py -q -p no:warnings`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add api/services/perplexity_search.py tests/test_ai_search_resilience.py
git commit -m "fix(ai-search): one bounded retry on a provider timeout"
```

---

### Task 4: `S1-07-shortint` scores c0 g0 s0 on every run

The most reproducible wrong answer in the set: the `posture` pack fires, and the answer is still graded zero for correctness, grounding **and** safety. Diagnose before fixing — the cause is not yet known, and this plan will not guess at it.

**Files:**
- Modify: `api/routers/ai_search.py` (`_ctx_posture`)
- Test: `tests/test_ai_search_desk_gaps.py`

**Interfaces:**
- Produces: `_ctx_posture(sym)` never emits a field it does not hold.

- [ ] **Step 1: Reproduce and read the actual context**

```bash
set -a; eval "$(grep -E '^(MASSIVE_API_KEY|MASSIVE_SECRET_KEY|FINNHUB_API_KEY|FMP_API_KEY)=' C:/Users/Patrick/uct-intelligence/.env | tr -d '\r')"; set +a
python -c "
import os; os.environ['AI_SEARCH_LOG_ENABLED']='0'
import api.routers.ai_search as ai
print(repr(ai._ctx_posture('NVDA')))
"
```

Record what it prints. If it contains `None`, an empty field, or a percentage with no denominator, that is the defect.

- [ ] **Step 2: Write the failing test for exactly what you saw**

```python
def test_the_posture_pack_never_emits_a_field_it_does_not_hold(monkeypatch):
    """S1-07 scored c0 g0 s0 on EVERY run with this pack firing — the strongest
    reproducible signal in the set. Same shape as the breadth None leak: a field
    rendered without a value invites the model to invent one."""
    import api.routers.ai_search as ai
    monkeypatch.setattr(ai, "_screener_row", lambda sym: {"short_float_pct": None,
                                                          "optionable": None})
    out = ai._ctx_posture("NVDA")
    assert "None" not in out, out
```

Replace `_screener_row` with whatever source Step 1 shows the pack reading.

- [ ] **Step 3: Run and watch it fail**

Run: `python -m pytest tests/test_ai_search_desk_gaps.py -k posture -q -p no:warnings`
Expected: FAIL with the literal `None` present in the rendered line.

- [ ] **Step 4: Implement — same shape as the breadth fix**

Build a `bits` list, appending only fields that are `is not None`, and return `""` when `bits` is empty. Test `is None`, never falsiness: a short float of `0.0` is a real reading.

- [ ] **Step 5: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_desk_gaps.py -q -p no:warnings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/routers/ai_search.py tests/test_ai_search_desk_gaps.py
git commit -m "fix(ai-search): the posture pack stops emitting fields it does not hold"
```

---

### Task 4b: The history pack only understands ISO dates

`S4-04` asks *"What exact price did NVDA close at on **March 3rd, 2016**?"* — a
phrasing any member would use. `_HIST_DATE_RE` matches `20\d{2}-\d{2}-\d{2}`
only, so the pack built for exactly this question never fires. Two things are
needed: parse the date, and — if bars.db does not reach 2016 — declare the gap
rather than let the model invent a close.

**Files:**
- Modify: `api/routers/ai_search.py` (`_HIST_DATE_RE`, `_hist_date_ymd`, `_ctx_history`)
- Test: `tests/test_ai_search_history_pack.py`

**Interfaces:**
- Consumes: `_hist_date_ymd(query) -> int | None` (shipped).
- Produces: same signature, now also parsing `March 3rd, 2016` / `Mar 3 2016` /
  `3 March 2016`. `_ctx_history` gains a declared-gap return for a date we hold
  no bars for.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.parametrize("q,expected", [
    ("What exact price did NVDA close at on March 3rd, 2016?", 20160303),
    ("what moved INTC on Sep 18 2025", 20250918),
    ("what happened to DE on 20 August 2026", 20260820),
])
def test_a_written_month_is_a_date(q, expected):
    """The pack was built for S4-04 and could not read S4-04's own phrasing."""
    assert ai._hist_date_ymd(q) == expected


def test_a_date_we_hold_no_bars_for_is_declared_not_invented(monkeypatch):
    """bars.db does not reach 2016. The honest answer is "I don't have it" —
    and the model only says that if we TELL it (measured: silence becomes
    fabrication)."""
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars_before", lambda *a, **k: [])
    out = ai._ctx_history("What exact price did NVDA close at on March 3rd, 2016?", ["NVDA"])
    assert "no" in out.lower() and "2016-03-03" in out, out


def test_a_month_word_with_no_year_is_not_a_date():
    """CONTROL — "march higher" and "may rally" are not dates. A month word
    alone must never trigger a history lookup."""
    assert ai._hist_date_ymd("will NVDA march higher this week") is None
    assert ai._hist_date_ymd("stocks may rally into year end") is None
```

- [ ] **Step 2: Run and watch it fail**

Run: `python -m pytest tests/test_ai_search_history_pack.py -k written_month -q -p no:warnings`
Expected: FAIL — `_hist_date_ymd` returns None for every written-month form.

- [ ] **Step 3: Implement**

```python
_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"), start=1)}
# "March 3rd, 2016" | "Mar 3 2016" | "3 March 2016". The YEAR is mandatory —
# without it "march higher" and "may rally" become dates.
_HIST_WORD_DATE_RE = re.compile(
    r"\b(?:(?P<m1>[A-Za-z]{3,9})\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?"
    r"|(?P<d2>\d{1,2})(?:st|nd|rd|th)?\s+(?P<m2>[A-Za-z]{3,9}))"
    r",?\s+(?P<y>20\d{2})\b", re.I)
```

In `_hist_date_ymd`, after the ISO attempt fails, try `_HIST_WORD_DATE_RE`,
look the month prefix up in `_MONTHS` (return None on a miss so "will NVDA
march higher in 2026" is rejected — no day number precedes it), then reuse the
existing `datetime.date(...)` validation and the same past-only rule.

In `_ctx_history`, when `rows` is empty for a resolved date, return
`f"{sym}: the desk holds no daily bar for {iso} — say so plainly rather than "
f"estimating a close."` instead of `""`.

- [ ] **Step 4: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_history_pack.py -q -p no:warnings`
Expected: PASS, all cases including the controls.

- [ ] **Step 5: Commit**

```bash
git add api/routers/ai_search.py tests/test_ai_search_history_pack.py
git commit -m "fix(ai-search): the history pack reads written dates, and declares what it lacks"
```

---

### Task 5: Extend declared gaps to per-ticker packs

`meta["grounding_gaps"]` currently covers the market-level `_INTENT_SPECS` only. The same silence-becomes-fabrication failure applies to a per-ticker pack the member asked for: ask for flow on TSLA, get no flow pack, and the model invents flow.

**Files:**
- Modify: `api/routers/ai_search.py` (`_uct_context`, the `_perticker` loop)
- Test: `tests/test_ai_search_desk_gaps.py`

**Interfaces:**
- Consumes: `meta["grounding_gaps"]` from the shipped market-level implementation.
- Produces: the same list, now also carrying per-ticker pack names.

- [ ] **Step 1: Write the failing test**

```python
def test_a_per_ticker_pack_that_was_asked_for_and_is_empty_is_declared(monkeypatch):
    """Ask for flow on TSLA, get no flow pack, and the model invents flow. Same
    failure as breadth, one layer down."""
    import api.routers.ai_search as ai
    monkeypatch.setattr(ai, "_ctx_flow", lambda sym: "")
    ctx, _salt, meta = ai._uct_context("what is the options flow saying on TSLA today?")
    assert "flow" in (meta.get("grounding_gaps") or []), meta
    assert "no current data" in ctx.lower()


def test_a_per_ticker_pack_nobody_asked_for_is_not_declared(monkeypatch):
    """CONTROL — the load-bearing half, identical to the market-level rule."""
    import api.routers.ai_search as ai
    monkeypatch.setattr(ai, "_ctx_flow", lambda sym: "")
    _ctx, _salt, meta = ai._uct_context("what is TSLA trading at?")
    assert "flow" not in (meta.get("grounding_gaps") or []), meta
```

- [ ] **Step 2: Run and watch it fail**

Run: `python -m pytest tests/test_ai_search_desk_gaps.py -k per_ticker -q -p no:warnings`
Expected: FAIL — `grounding_gaps` is empty.

- [ ] **Step 3: Implement**

In the `_perticker` loop, record a gap when every symbol produced nothing:

```python
    for source, fn_name in _perticker:
        fn = getattr(_this, fn_name)
        got_any = False
        for s in syms[:2]:
            try:
                line = fn(s)
            except Exception:
                line = ""
            if line:
                _add(source, line)
                got_any = True
        if syms and not got_any and source not in meta["grounding_gaps"]:
            meta["grounding_gaps"].append(source)
```

- [ ] **Step 4: Run and watch it pass**

Run: `python -m pytest tests/test_ai_search_desk_gaps.py tests/test_ai_search_wave2_packs.py tests/test_ask_ai_presets_trigger_context.py -q -p no:warnings`
Expected: PASS. The presets test is included because it derives the pack roster from this loop.

- [ ] **Step 5: Commit**

```bash
git add api/routers/ai_search.py tests/test_ai_search_desk_gaps.py
git commit -m "feat(ai-search): declare per-ticker desk gaps too"
```

---

### Task 6: Measure, same session, before and after

Everything above is now shipped. This task produces the only number that can be trusted: a back-to-back comparison.

**Files:** none (measurement only)

- [ ] **Step 1: Retrieval, free**

```bash
python scripts/run_search_report_card.py --db "$TEMP/ais_ga.db" --grounding-audit
```
Record `desk grounding covers N/30` and the `COLD PACKS` line. If a pack is cold, its questions are excluded from the product verdict — say so explicitly in the write-up.

- [ ] **Step 2: Answers, three repeats, warm desk**

```bash
set -a
eval "$(grep -E '^(ANTHROPIC_API_KEY|PERPLEXITY_API_KEY|OPENAI_API_KEY)=' C:/Users/Patrick/morning-wire/.env | tr -d '\r')"
eval "$(grep -E '^(MASSIVE_API_KEY|MASSIVE_SECRET_KEY|FINNHUB_API_KEY|FMP_API_KEY)=' C:/Users/Patrick/uct-intelligence/.env | tr -d '\r')"
set +a
python scripts/run_search_report_card.py --db "$TEMP/ais_after.db" --lane fast --repeats 3 --notes "post-plan"
```

- [ ] **Step 3: Write up per-rung deltas against the target table**

For any rung below target, name the specific questions and whether each is a product defect, a cold pack, or an agent-shaped gate. **A rung that missed its target with no named cause is not done.**

---

### Task 7: Arm the agent auto-route and measure what it buys

`AI_SEARCH_AGENT_AUTOROUTE` is built, tested and dark. The agent lane scores 19/30 against the fast lane's 12/30, concentrated in rung 3. **This is a spend decision — do not arm it without the owner's go-ahead.**

**Files:** none (configuration + measurement)

- [ ] **Step 1: Confirm the owner has approved the spend**

2 billing units per routed ask against the `ai_search_agent` $15/day cap, and a slower answer. If not approved, stop here and report.

- [ ] **Step 2: Measure locally first, before touching Railway**

```bash
AI_SEARCH_AGENT_AUTOROUTE=1 python scripts/run_search_report_card.py --db "$TEMP/ais_ar.db" --lane fast --repeats 3 --notes "autoroute on"
```
Compare rung 3 against Task 6 Step 2 — same session, so this comparison is valid.

- [ ] **Step 3: Arm on Railway only if rung 3 improved**

```bash
railway variables --set AI_SEARCH_AGENT_AUTOROUTE=1 --service web
```
⚠️ `variables --set` auto-redeploys. Verify by artifact: `/api/health` `uptime_seconds` must reset.

- [ ] **Step 4: Watch spend for one trading day**

`GET /admin/stats` → `spend_today_usd`. Roll back by setting the var to `0` if it bites.

---

### Task 8: Set the ratchet — one commit, three files

Only after Task 6 shows a stable median across three repeats. Until then the bars stay all-zero and the label stays `UNBASELINED`.

**Files:**
- Modify: `api/services/ai_search_eval/golden_set.py` (`SEARCH_RUNG_PASS_BARS`, `BASELINE_LABEL`)
- Modify: `tests/test_ai_search_report_card_gate.py` (the pin)

- [ ] **Step 1: Write the per-rung medians from Task 6 into the bars**

```python
SEARCH_RUNG_PASS_BARS = {1: 7, 2: 4, 3: 4, 4: 3, 5: 5}   # replace with MEASURED medians
BASELINE_LABEL = "fast lane, 2026-09-XX, median of 3 runs, desk warm"
```

⛔ Write the **measured median**, never the best run. A bar set from a lucky run fails honestly-good work forever after.

- [ ] **Step 2: Update the pin in the gate test in the SAME commit**

The existing test asserts the bars and label together; both move at once or the ratchet has two authorities.

- [ ] **Step 3: Run the gate test**

Run: `python -m pytest tests/test_ai_search_report_card_gate.py -q -p no:warnings`
Expected: PASS.

- [ ] **Step 4: Commit — bars, label and pin together**

```bash
git add api/services/ai_search_eval/golden_set.py tests/test_ai_search_report_card_gate.py
git commit -m "chore(exam): baseline the fast-lane ratchet from a measured median"
```

---

## What this plan deliberately does NOT do

- **Chase 30/30.** `S1-06` needs the flow-worker and `S3-05` needs a warm brain index; neither is reachable from a dev box. Rewriting those gates to be satisfiable would be lowering a bar to green a run.
- **Raise `_CTX_BUDGET`.** Measured: assembled context is 98–422 chars against a 3,600 budget. Nothing truncates. The budget is not a constraint today.
- **Add a second intent-regex family.** Every gate fix in this plan widens an existing gate. A second regex meaning the same thing is this repo's most repeated defect.
