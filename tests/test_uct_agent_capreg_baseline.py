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
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAPREG = ROOT / "app" / "src" / "agent" / "qa" / "capabilityRegression"
CORPUS = CAPREG / "baseline" / "corpus.json"
GOLDEN = CAPREG / "baseline" / "goldenWorkflows.json"
LOCK = CAPREG / "baseline" / "baseline.lock.json"
DECISIONS = ROOT / "docs" / "agent" / "COMPATIBILITY-DECISIONS.md"
AGENT_CI = ROOT / ".github" / "workflows" / "agent-ci.yml"

#: keys that document an entry without asserting anything (editing them is never a weakening)
NOTE_KEYS = {"source", "about"}


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _digest(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def _phrasings(intent):
    return [p if isinstance(p, dict) else {"text": p} for p in intent.get("phrasings", [])]


def fingerprint(corpus: dict, golden: dict) -> dict:
    """The lock's view of the data: per entry, a digest of its ASSERTIONS and the gaps it carries."""
    out = {"intents": {}, "refusals": {}, "workflows": {}}
    for it in corpus["intents"]:
        body = {k: v for k, v in it.items() if k not in NOTE_KEYS and k != "phrasings"}
        phr = {}
        for p in _phrasings(it):
            rest = {k: v for k, v in p.items() if k not in ("text", "gaps")}
            phr[p["text"]] = {"digest": _digest(rest), "gaps": sorted((p.get("gaps") or {}).keys())}
        out["intents"][it["id"]] = {"digest": _digest(body), "phrasings": phr}
    for r in corpus.get("refusals", []):
        out["refusals"][r["id"]] = {"digest": _digest({k: v for k, v in r.items() if k not in NOTE_KEYS and k != "gap"}), "gap": bool(r.get("gap"))}
    for w in golden["workflows"]:
        out["workflows"][w["id"]] = {"digest": _digest({k: v for k, v in w.items() if k not in NOTE_KEYS and k != "gap"}), "gap": bool(w.get("gap"))}
    return out


def decided_keys(text: str) -> set[str]:
    return {m.group(1) for m in re.finditer(r"^###\s+(\S+)", text, re.M)}


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
    for kind in ("refusals", "workflows"):
        for wid, was in lock[kind].items():
            cur = now[kind].get(wid)
            if cur is None:
                v.append((wid, f"{kind[:-1]} removed"))
                continue
            if cur["digest"] != was["digest"]:
                v.append((wid, f"{kind[:-1]} assertions changed"))
            if cur["gap"] and not was["gap"]:
                v.append((wid, f"{kind[:-1]} gained a known gap"))
    return v


def unlocked(lock: dict, now: dict) -> list[str]:
    out = [i for i in now["intents"] if i not in lock["intents"]]
    out += [f"{i}: \"{t}\"" for i, e in now["intents"].items() if i in lock["intents"] for t in e["phrasings"] if t not in lock["intents"][i]["phrasings"]]
    out += [w for k in ("refusals", "workflows") for w in now[k] if w not in lock[k]]
    return out


def _state():
    return _load(LOCK), fingerprint(_load(CORPUS), _load(GOLDEN)), decided_keys(DECISIONS.read_text(encoding="utf-8"))


# ── the rail ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_no_baseline_entry_is_removed_or_weakened_without_a_decision():
    lock, now, keys = _state()
    undecided = [(i, w) for i, w in violations(lock, now) if f"BASELINE:{i}" not in keys]
    assert not undecided, ("baseline entries removed or weakened with no `### BASELINE:<id>` decision in "
                           "docs/agent/COMPATIBILITY-DECISIONS.md:\n" + "\n".join(f"  {i}: {w}" for i, w in undecided))


def test_every_entry_is_locked():
    lock, now, _ = _state()
    missing = unlocked(lock, now)
    assert not missing, "new corpus / golden entries are not in baseline.lock.json — run `python tests/test_uct_agent_capreg_baseline.py --update`:\n  " + "\n  ".join(missing)


def test_every_known_gap_names_id_reason_owner():
    corpus, golden = _load(CORPUS), _load(GOLDEN)
    gaps = [g for it in corpus["intents"] for p in _phrasings(it) for g in (p.get("gaps") or {}).values()]
    gaps += [w["gap"] for w in [*golden["workflows"], *corpus.get("refusals", [])] if w.get("gap")]
    for g in gaps:
        for k in ("id", "reason", "owner"):
            assert str(g.get(k) or "").strip(), f"a known gap without {k}: {g}"


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


def test_agent_ci_runs_the_capability_regression_suite():
    """The deterministic suite is part of the Agent CI (its own job, besides the sharded union) — never a paid eval."""
    y = AGENT_CI.read_text(encoding="utf-8")
    assert "capability-regression" in y and "src/agent/qa/capabilityRegression" in y
    assert "test_uct_agent_capreg" in y or "tests/test_uct_agent*.py" in y
    for paid in ("agent_eval_run", "ANTHROPIC_API_KEY", "agent_live_batch"):
        assert paid not in y, f"the Agent CI must never run a paid live-model eval ({paid})"


if __name__ == "__main__":
    if "--update" in sys.argv:
        lock_now = fingerprint(_load(CORPUS), _load(GOLDEN))
        if LOCK.exists():
            lock, _, keys = _state()
            bad = [(i, w) for i, w in violations(lock, lock_now) if f"BASELINE:{i}" not in keys]
            if bad:
                print("refused: undecided weakenings —\n" + "\n".join(f"  {i}: {w}" for i, w in bad))
                sys.exit(1)
        LOCK.write_text(json.dumps({"about": "capreg baseline lock — tests/test_uct_agent_capreg_baseline.py --update", **lock_now},
                                   indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"locked {len(lock_now['intents'])} intents, {len(lock_now['refusals'])} refusals, {len(lock_now['workflows'])} workflows")
