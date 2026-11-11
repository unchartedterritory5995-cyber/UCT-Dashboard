"""UCT Agent capability regression (Mission 2) — the BASELINE rail.

The NL equivalence corpus (baseline/corpus.json) and the golden workflows (baseline/goldenWorkflows.json) are a baseline of
previously working behaviour. This test holds them to baseline/baseline.lock.json: an entry may be ADDED freely (re-lock),
and a known gap may be REMOVED freely (the fix landed), but removing an entry, removing a phrasing, adding a known gap
or changing an entry's assertions needs a recorded decision — `### BASELINE:<id>` in docs/agent/COMPATIBILITY-DECISIONS.md.

Re-lock (refuses while any undecided weakening exists):
    python tests/test_uct_agent_capreg_baseline.py --update
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPREG = ROOT / "app" / "src" / "agent" / "qa" / "capabilityRegression"
CORPUS = CAPREG / "baseline" / "corpus.json"
GOLDEN = CAPREG / "baseline" / "goldenWorkflows.json"
COLLISIONS = CAPREG / "baseline" / "routingCollisions.json"
CLOCKX = CAPREG / "baseline" / "clockExpectations.json"
LOCK = CAPREG / "baseline" / "baseline.lock.json"
DECISIONS = ROOT / "docs" / "agent" / "COMPATIBILITY-DECISIONS.md"
AGENT_CI = ROOT / ".github" / "workflows" / "agent-ci.yml"

#: keys that document an entry without asserting anything (editing them is never a weakening). `capabilities` and
#: `refuses` only CREDIT coverage; inventory.test.js rail 1b proves every credited name is really run by the assertions.
NOTE_KEYS = {"source", "about", "capabilities", "refuses"}
#: the lock's digest format. 2 (2026-11-04, review #769): the credit fields joined NOTE_KEYS. A lock of another format is
#: never compared silently: test_lock_format_is_current fails, and the re-lock is a reviewed change of its own.
LOCK_FORMAT = 3     # 3 (2026-11-04, review #769 delta): each gap's recorded failure `mode` is part of the lock


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _digest(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def _phrasings(intent):
    return [p if isinstance(p, dict) else {"text": p} for p in intent.get("phrasings", [])]


def fingerprint(corpus: dict, golden: dict) -> dict:
    """The lock's view of the data: per entry, a digest of its ASSERTIONS and the gaps it carries."""
    out = {"intents": {}, "refusals": {}, "workflows": {}, "collisions": {}, "clock": {}}
    for it in corpus["intents"]:
        body = {k: v for k, v in it.items() if k not in NOTE_KEYS and k != "phrasings"}
        phr = {}
        for p in _phrasings(it):
            rest = {k: v for k, v in p.items() if k not in ("text", "gaps")}
            # a gap's recorded failure MODE is locked too: loosening what "fails as expected" means needs a decision
            phr[p["text"]] = {"digest": _digest(rest), "gaps": sorted((p.get("gaps") or {}).keys()),
                              "modes": {lvl: g.get("mode") for lvl, g in sorted((p.get("gaps") or {}).items())}}
        out["intents"][it["id"]] = {"digest": _digest(body), "phrasings": phr}
    for r in corpus.get("refusals", []):
        out["refusals"][r["id"]] = {"digest": _digest({k: v for k, v in r.items() if k not in NOTE_KEYS and k != "gap"}), "gap": bool(r.get("gap")), "mode": (r.get("gap") or {}).get("mode")}
    for w in golden["workflows"]:
        out["workflows"][w["id"]] = {"digest": _digest({k: v for k, v in w.items() if k not in NOTE_KEYS and k != "gap"}), "gap": bool(w.get("gap")), "mode": (w.get("gap") or {}).get("mode")}
    # the routing-collision table (capreg-2): a row is keyed by its phrasing
    for r in (_load(COLLISIONS)["rows"] if COLLISIONS.exists() else []):
        out["collisions"][r["text"]] = {"digest": _digest({k: v for k, v in r.items() if k not in NOTE_KEYS and k != "gap"}), "gap": bool(r.get("gap")),
                                        "mode": (r.get("gap") or {}).get("mode")}
    # per-instant expectations (testing/clock.js): keyed "<intent>@<clock>"
    for iid, by in ((_load(CLOCKX)["intents"] if CLOCKX.exists() else {}).items()):
        for clk, e in by.items():
            out["clock"][f"{iid}@{clk}"] = {"digest": _digest(e.get("expect")), "gap": False, "mode": None}
    return out


FIELD = re.compile(r"^\s*[-*]\s*(Date|Decided by|Binds|Why|Replacement protection):\s*(.*?)\s*$", re.I)


def parse_decisions(text: str) -> dict[str, list[dict]]:
    """`### KEY — title` sections with their `- Field: value` lines. Fenced code blocks (the format example) and
    anything outside a `###` section are ignored."""
    out: dict[str, list[dict]] = {}
    cur = None
    fence = False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        m = re.match(r"^###\s+(\S+)", line)
        if m:
            cur = {"key": m.group(1)}
            out.setdefault(cur["key"], []).append(cur)
            continue
        if line.startswith("#"):
            cur = None
            continue
        f = FIELD.match(line)
        if cur is not None and f:
            cur[f.group(1).lower()] = f.group(2)
    return out


def decision_valid(d: dict) -> bool:
    """A decision counts only with a real date, a named decider (not a template placeholder) and a Binds line."""
    who = d.get("decided by", "")
    return (bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", d.get("date", ""))) and bool(who) and "<" not in who
            and bool(re.fullmatch(r"[0-9a-f]{16}->([0-9a-f]{16}|removed)", d.get("binds", ""))))


def decided_keys(text: str) -> set[str]:
    return set(parse_decisions(text))


def _entry(fp: dict, eid: str):
    for kind in ("intents", "refusals", "workflows", "collisions", "clock"):
        if eid in fp.get(kind, {}):
            return fp[kind][eid]
    return None


def binds_for(lock: dict, now: dict, eid: str) -> str:
    """What a decision for `eid` must bind: the locked entry's digest -> the current entry's digest (or `removed`), so a
    decision covers EXACTLY this change; the next weakening of the same id needs its own decision."""
    old, new = _entry(lock, eid), _entry(now, eid)
    return f"{_digest(old)}->{_digest(new) if new is not None else 'removed'}"


def undecided(lock: dict, now: dict, decisions: dict) -> list[tuple[str, str, str]]:
    out = []
    for eid, what in violations(lock, now):
        b = binds_for(lock, now, eid)
        if not any(decision_valid(d) and d.get("binds") == b for d in decisions.get(f"BASELINE:{eid}", [])):
            out.append((eid, what, b))
    return out


def _git(*args: str):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout
    except Exception:
        return None


#: files whose presence at the merge base proves master HAS the capreg suite (this rail, and every corpus / lock path the
#: suite has used — `data/` until 2026-11-04, then `baseline/`). Add a path here when the baseline moves.
SUITE_MARKERS = (
    "tests/test_uct_agent_capreg_baseline.py",
    "app/src/agent/qa/capabilityRegression/baseline/corpus.json",
    "app/src/agent/qa/capabilityRegression/baseline/baseline.lock.json",
    "app/src/agent/qa/capabilityRegression/data/corpus.json",
    "app/src/agent/qa/capabilityRegression/data/baseline.lock.json",
)


def base_lock(git=None):
    """The lock at the merge base with origin/master: (lock | None, reason).
    reason: ok | no-ref (origin/master unresolvable) | absent (master has no capreg suite yet) |
            lock-missing (master HAS the suite — its corpus exists — but no lock at the expected path: a moved lock)."""
    git = git or _git
    mb = (git("merge-base", "HEAD", "origin/master") or "").strip()
    if not mb:
        return None, "no-ref"
    text = git("show", f"{mb}:{LOCK.relative_to(ROOT).as_posix()}")
    if text is None:
        # "absent" only when master has NO trace of the suite: this rail's own file, or the corpus / lock at any path the
        # suite has ever used. A renamed baseline folder can then never pass itself off as "not on master yet".
        there = any(git("show", f"{mb}:{path}") is not None for path in SUITE_MARKERS)
        return None, ("lock-missing" if there else "absent")
    return json.loads(text), "ok"


def merge_base_mode(env=None, git=None) -> str:
    """skip-master: running ON master (the master deploy gate: GITHUB_REF refs/heads/master, or HEAD == origin/master) —
    comparing master with itself is meaningless, and this check must never turn the release gate red;
    strict: a push to an agent/** branch (Agent CI) — an unresolvable base FAILS;
    lenient: anything else (a PR merge ref, a local run) — an unresolvable base is a printed notice."""
    env = os.environ if env is None else env
    git = git or _git
    ref = env.get("GITHUB_REF", "")
    if ref == "refs/heads/master":
        return "skip-master"
    head, om = (git("rev-parse", "HEAD") or "").strip(), (git("rev-parse", "origin/master") or "").strip()
    if head and om and head == om:
        return "skip-master"
    return "strict" if ref.startswith("refs/heads/agent/") else "lenient"


def merge_base_check(env=None, git=None, state=None):
    """(ok: bool, message) — the merge-base rail as a pure function of its environment (tested below)."""
    mode = merge_base_mode(env, git)
    if mode == "skip-master":
        return True, "capreg merge-base check skipped: running on master itself"
    base, why = base_lock(git)
    if why == "no-ref":
        if mode == "strict":
            return False, "Agent CI must fetch origin/master for the merge-base baseline check"
        return True, "capreg merge-base check skipped: origin/master is not available here"
    if why == "absent":
        return True, "capreg merge-base check: master has no capreg baseline yet"
    if why == "lock-missing":
        return False, ("master has the capreg corpus but no baseline.lock.json at the expected path at the merge base "
                       "— a moved or renamed lock cannot be compared, so it is refused")
    lock, now, decisions = state or _state()
    if base.get("format") != LOCK_FORMAT:
        b = f"{_digest(base)}->{_digest(lock)}"
        ok = any(decision_valid(d) and d.get("binds") == b for d in decisions.get(f"LOCKFORMAT:{LOCK_FORMAT}", []))
        return ok, ("" if ok else f"the lock format changed against master: needs `### LOCKFORMAT:{LOCK_FORMAT}` with Date, Decided by and `- Binds: {b}`")
    bad = undecided(base, now, decisions)
    return (not bad), ("" if not bad else "weakened against the baseline on master (merge base) without a bound decision:\n" + _explain(bad))


def violations(lock: dict, now: dict) -> list[tuple[str, str]]:
    """[(id, what)] — every removal / weakening / assertion change of a LOCKED entry."""
    v = []
    for iid, was in lock["intents"].items():
        cur = now["intents"].get(iid)
        if cur is None:
            v.append((iid, "intent removed"))
            continue
        if cur["digest"] != was["digest"]:
            v.append((iid, "intent assertions changed (needs / deterministic / model / expect / board …)"))
        for text, p in was["phrasings"].items():
            c = cur["phrasings"].get(text)
            if c is None:
                v.append((iid, f'phrasing removed: "{text}"'))
                continue
            if c["digest"] != p["digest"]:
                v.append((iid, f'phrasing changed: "{text}"'))
            added = sorted(set(c["gaps"]) - set(p["gaps"]))
            if added:
                v.append((iid, f'phrasing "{text}" gained a known gap at level(s) {added}'))
            changed = sorted(lvl for lvl in set(c["gaps"]) & set(p["gaps"]) if (c.get("modes") or {}).get(lvl) != (p.get("modes") or {}).get(lvl))
            if changed:
                v.append((iid, f'phrasing "{text}": the recorded failure mode of its gap changed at level(s) {changed}'))
    for kind in ("refusals", "workflows", "collisions", "clock"):
        for wid, was in lock.get(kind, {}).items():
            cur = now[kind].get(wid)
            if cur is None:
                v.append((wid, f"{kind[:-1]} removed"))
                continue
            if cur["digest"] != was["digest"]:
                v.append((wid, f"{kind[:-1]} assertions changed"))
            if cur["gap"] and not was["gap"]:
                v.append((wid, f"{kind[:-1]} gained a known gap"))
            elif cur["gap"] and was["gap"] and cur.get("mode") != was.get("mode"):
                v.append((wid, f"{kind[:-1]}: the recorded failure mode of its gap changed"))
    return v


def unlocked(lock: dict, now: dict) -> list[str]:
    out = [i for i in now["intents"] if i not in lock["intents"]]
    out += [f"{i}: \"{t}\"" for i, e in now["intents"].items() if i in lock["intents"] for t in e["phrasings"] if t not in lock["intents"][i]["phrasings"]]
    out += [w for k in ("refusals", "workflows", "collisions", "clock") for w in now[k] if w not in lock.get(k, {})]
    return out


def _state():
    return _load(LOCK), fingerprint(_load(CORPUS), _load(GOLDEN)), parse_decisions(DECISIONS.read_text(encoding="utf-8"))


def _explain(rows) -> str:
    return "\n".join(f"  {i}: {w}\n    needs a decision `### BASELINE:{i} — …` with `- Date:`, `- Decided by:` and `- Binds: {b}`"
                     for i, w, b in rows)


# ── the rail ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_no_baseline_entry_is_removed_or_weakened_without_a_decision():
    lock, now, decisions = _state()
    bad = undecided(lock, now, decisions)
    assert not bad, "baseline entries removed or weakened without a bound decision in docs/agent/COMPATIBILITY-DECISIONS.md:\n" + _explain(bad)


def test_no_weakening_against_the_merge_base():
    """A hand-edited lock cannot launder a weakening: the corpus is ALSO held to the lock as it is on master."""
    ok, msg = merge_base_check()
    if ok and msg:
        print(msg)
    assert ok, msg


def test_merge_base_check_never_blocks_the_master_gate():
    """The master deploy gate checks out master shallow (depth 2) with CI set: on master the rail SKIPS, whatever git
    can or cannot resolve; on an agent/** push an unresolvable base fails; a moved lock fails wherever a base exists."""
    nothing = lambda *a: None                                   # a shallow checkout: no origin/master, no merge base
    assert merge_base_check({"CI": "true", "GITHUB_REF": "refs/heads/master"}, nothing)[0] is True
    same = lambda *a: "abc123\n" if a[0] == "rev-parse" else None   # HEAD == origin/master (a local run on master)
    assert merge_base_check({"CI": "true"}, same)[0] is True
    assert merge_base_check({"CI": "true", "GITHUB_REF": "refs/heads/agent/qa/x"}, nothing)[0] is False
    assert merge_base_check({"CI": "true", "GITHUB_REF": "refs/pull/1/merge"}, nothing)[0] is True
    corpus_only = lambda *a: ("mb1\n" if a[0] == "merge-base" else ("x" if a[0] == "rev-parse" and a[1] == "HEAD" else
                              ("y" if a[0] == "rev-parse" else ("{}" if a[1].endswith("corpus.json") else None))))
    ok, msg = merge_base_check({"CI": "true", "GITHUB_REF": "refs/heads/agent/qa/x"}, corpus_only)
    assert ok is False and "moved or renamed lock" in msg
    rail_only = lambda *a: ("mb1\n" if a[0] == "merge-base" else ("x" if a == ("rev-parse", "HEAD") else ("y" if a[0] == "rev-parse" else
                            ("pass" if a[1].endswith("tests/test_uct_agent_capreg_baseline.py") else None))))
    ok, msg = merge_base_check({"CI": "true", "GITHUB_REF": "refs/heads/agent/qa/x"}, rail_only)
    assert ok is False and "moved or renamed lock" in msg          # the folder renamed away: the rail file betrays the suite
    neither = lambda *a: ("mb1\n" if a[0] == "merge-base" else ("x" if a == ("rev-parse", "HEAD") else ("y" if a[0] == "rev-parse" else None)))
    assert merge_base_check({"CI": "true", "GITHUB_REF": "refs/heads/agent/qa/x"}, neither)[0] is True


def test_lock_format_is_current():
    assert _load(LOCK).get("format") == LOCK_FORMAT, "baseline.lock.json was written by another digest format"


def test_every_entry_is_locked():
    lock, now, _ = _state()
    missing = unlocked(lock, now)
    assert not missing, "new corpus / golden entries are not in baseline.lock.json — run `python tests/test_uct_agent_capreg_baseline.py --update`:\n  " + "\n  ".join(missing)


def test_every_known_gap_names_id_reason_owner():
    corpus, golden = _load(CORPUS), _load(GOLDEN)
    gaps = [g for it in corpus["intents"] for p in _phrasings(it) for g in (p.get("gaps") or {}).values()]
    gaps += [w["gap"] for w in [*golden["workflows"], *corpus.get("refusals", []), *_load(COLLISIONS)["rows"]] if w.get("gap")]
    for g in gaps:
        for k in ("id", "reason", "owner", "mode"):
            assert str(g.get(k) or "").strip(), f"a known gap without {k} (mode = the recorded failure, see testing/corpus.js gapIt): {g}"


def test_entries_are_unique_and_well_formed():
    corpus, golden = _load(CORPUS), _load(GOLDEN)
    ids = [i["id"] for i in corpus["intents"]] + [r["id"] for r in corpus.get("refusals", [])] + [w["id"] for w in golden["workflows"]]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for it in corpus["intents"]:
        texts = [p["text"] for p in _phrasings(it)]
        assert len(texts) == len(set(texts)), f"{it['id']}: duplicate phrasing"
        assert it["needs"] and it["capabilities"] and it.get("model", {}).get("ops"), it["id"]
        assert set(p.get("det") for p in _phrasings(it)) <= {None, "required"}, it["id"]
    for w in golden["workflows"]:
        assert w.get("source"), f"{w['id']}: a golden workflow names its evidence"
        assert w["steps"], w["id"]


def test_the_owner_s_exact_sentences_stay_in_the_corpus():
    """The owner's own words (2026-11-03/04) are the baseline's anchor — never paraphrased away."""
    texts = {p["text"] for it in _load(CORPUS)["intents"] for p in _phrasings(it)}
    texts |= {s["say"] for w in _load(GOLDEN)["workflows"] for s in w["steps"]}
    for s in ["Put four charts on my screen.", "Create four charts.", "Make a 2×2 chart layout.",
              "Show SPY, QQQ, NVDA and TSLA in four equal panels.", "Give me four equally sized charts with those tickers.",
              "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.",
              "Create four charts in a 2×2 grid: SPY, QQQ, NVDA, and TSLA, all on the daily timeframe.",
              "Undo the last change you made to my charts.", "Change the NVDA chart to the weekly timeframe, then undo that change.",
              "change NVDA to weekly then undo", "add the 9 and 20 EMAs", "describe the setup on nvda",
              "Create a new chart for NVDA on the daily timeframe, then add a second chart for QQQ.",
              "When does TSLA report earnings next?", "Add the 9 and 20 EMAs to the TSLA chart."]:
        assert s in texts, s


# ── the rail catches what it should (self-test on copies; the files are never written) ──────────────────────────
def test_rail_self_test_detects_removal_weakening_and_gap():
    corpus, golden = _load(CORPUS), _load(GOLDEN)
    lock = fingerprint(corpus, golden)
    c2 = copy.deepcopy(corpus)
    it = c2["intents"][0]
    first = _phrasings(it)[0]["text"]
    it["phrasings"] = [p for p in it["phrasings"] if (p if isinstance(p, str) else p["text"]) != first]
    assert any("phrasing removed" in w for _, w in violations(lock, fingerprint(c2, golden)))
    c3 = copy.deepcopy(corpus)
    c3["intents"][0]["expect"] = {}
    assert any("assertions changed" in w for _, w in violations(lock, fingerprint(c3, golden)))
    c4 = copy.deepcopy(corpus)
    p0 = c4["intents"][0]["phrasings"][0]
    p0 = p0 if isinstance(p0, dict) else {"text": p0}
    p0["gaps"] = {"c": {"id": "X", "reason": "r", "owner": "o"}}
    c4["intents"][0]["phrasings"][0] = p0
    assert any("gained a known gap" in w for _, w in violations(lock, fingerprint(c4, golden)))
    g2 = copy.deepcopy(golden)
    g2["workflows"].pop(0)
    assert any("removed" in w for _, w in violations(lock, fingerprint(corpus, g2)))
    # a note edit and a REMOVED gap are not weakenings
    c5 = copy.deepcopy(corpus)
    c5["intents"][0]["source"] = "edited note"
    for it5 in c5["intents"]:
        it5["phrasings"] = [({k: v for k, v in p.items() if k != "gaps"} if isinstance(p, dict) else p) for p in it5["phrasings"]]
    assert violations(lock, fingerprint(c5, golden)) == []
    assert decided_keys("### BASELINE:a — x\n### CAP:b.c\n") == {"BASELINE:a", "CAP:b.c"}


def test_decisions_need_date_decider_and_a_binding_and_fences_do_not_count():
    lock = fingerprint(_load(CORPUS), _load(GOLDEN))
    g2 = copy.deepcopy(_load(GOLDEN))
    gone = g2["workflows"].pop(0)["id"]
    now = fingerprint(_load(CORPUS), g2)
    b = binds_for(lock, now, gone)
    ok = f"### BASELINE:{gone} — retired\n- Date: 2026-11-04\n- Decided by: the owner\n- Binds: {b}\n"
    assert undecided(lock, now, parse_decisions(ok)) == []
    for bad in (f"```\n{ok}```\n",                                   # inside a fenced block
                ok.replace("- Decided by: the owner\n", ""),         # no decider
                ok.replace("the owner", "<the owner>"),              # a template placeholder
                ok.replace("- Date: 2026-11-04\n", ""),              # no date
                ok.replace(b, "0" * 16 + "->removed")):               # bound to another change
        assert [i for i, _, _ in undecided(lock, now, parse_decisions(bad))] == [gone], bad
    # one decision never unlocks the id for a LATER, different weakening
    c2 = copy.deepcopy(_load(CORPUS))
    c2["intents"][0]["expect"] = {}
    later = fingerprint(c2, _load(GOLDEN))
    iid = c2["intents"][0]["id"]
    once = f"### BASELINE:{iid} — x\n- Date: 2026-11-04\n- Decided by: the owner\n- Binds: {binds_for(lock, later, iid)}\n"
    assert undecided(lock, later, parse_decisions(once)) == []
    c3 = copy.deepcopy(c2)
    c3["intents"][0]["needs"] = []
    assert [i for i, _, _ in undecided(lock, fingerprint(c3, _load(GOLDEN)), parse_decisions(once))] == [iid]


def test_agent_ci_runs_the_capability_regression_suite():
    """The deterministic suite is part of the Agent CI (its own job, besides the sharded union) — never a paid eval."""
    y = AGENT_CI.read_text(encoding="utf-8")
    assert "capability-regression" in y and "src/agent/qa/capabilityRegression" in y
    # the suite runs at BOTH pinned market-clock instants (testing/clock.js; the 2026-11-04 09:30 ET red gate)
    assert "clock: [post, rth]" in y and "CAPREG_CLOCK: ${{ matrix.clock }}" in y
    assert "needs: capability-regression-clock" in y          # one aggregate result for both legs
    assert "test_uct_agent_capreg" in y or "tests/test_uct_agent*.py" in y
    for paid in ("agent_eval_run", "ANTHROPIC_API_KEY", "agent_live_batch"):
        assert paid not in y, f"the Agent CI must never run a paid live-model eval ({paid})"


if __name__ == "__main__":
    if "--update" in sys.argv:
        lock_now = fingerprint(_load(CORPUS), _load(GOLDEN))
        # before the baseline exists on master (merge base: no capreg suite), the PR that introduces it DEFINES it — the
        # lock is rewritten without comparison. From the first merge on, every change is compared (and CI compares
        # against master's lock too, whatever the same-tree lock says).
        if base_lock()[1] == "absent":
            print("the baseline is not on master yet: this branch defines it (re-locked without comparison)")
        elif LOCK.exists() and _load(LOCK).get("format") == LOCK_FORMAT:
            lock, _, decisions = _state()
            bad = undecided(lock, lock_now, decisions)
            if bad:
                print("refused: undecided weakenings —\n" + _explain(bad))
                sys.exit(1)
        LOCK.write_text(json.dumps({"about": "capreg baseline lock — tests/test_uct_agent_capreg_baseline.py --update", "format": LOCK_FORMAT, **lock_now},
                                   indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"locked {len(lock_now['intents'])} intents, {len(lock_now['refusals'])} refusals, {len(lock_now['workflows'])} workflows")


def test_no_control_characters_in_the_data():
    r"""A JSON `\b` written for a regex word boundary decodes to a BACKSPACE byte (it happened in CG-7 / CG-12's reasons):
    every string in the baseline and coverage files, once parsed, holds no control character but newline and tab."""
    bad = []

    def walk(o, where):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, f"{where}/{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{where}/{i}")
        elif isinstance(o, str) and any(ord(ch) < 32 and ch not in "\n\t" for ch in o):
            bad.append(where)

    for f in sorted([*(CAPREG / "baseline").glob("*.json"), *(CAPREG / "coverage").glob("*.json")]):
        walk(_load(f), f.relative_to(CAPREG).as_posix())
    assert not bad, r"control characters (write a regex \b as \\b in JSON):" + "\n  " + "\n  ".join(bad)


def test_rail_self_test_detects_a_loosened_gap_mode():
    """Review #769 delta (3): the recorded failure mode is locked — loosening it (e.g. to "") is a change that needs a decision."""
    corpus = _load(CORPUS)
    # every known gap may be fixed (a corpus with none is the goal): the rail is then self-tested on a SYNTHETIC gap,
    # locked first, so loosening its mode is still caught — never a vacuous pass
    if not any(isinstance(p, dict) and p.get("gaps") for it in corpus["intents"] for p in it["phrasings"]):
        corpus = copy.deepcopy(corpus)
        first = next(p for it in corpus["intents"] for p in it["phrasings"] if isinstance(p, dict))
        first["gaps"] = {"a": {"id": "CG-SELFTEST", "reason": "synthetic (rail self-test)", "owner": "rail", "mode": "→ selftest"}}
    lock = fingerprint(corpus, _load(GOLDEN))
    c2 = copy.deepcopy(corpus)
    hit = None
    for it in c2["intents"]:
        for p in it["phrasings"]:
            if isinstance(p, dict) and p.get("gaps"):
                lvl = sorted(p["gaps"])[0]
                p["gaps"][lvl]["mode"] = ""
                hit = it["id"]
                break
        if hit:
            break
    assert hit, "the corpus has no known gap to loosen"
    assert any(i == hit and "failure mode" in w for i, w in violations(lock, fingerprint(c2, _load(GOLDEN))))
