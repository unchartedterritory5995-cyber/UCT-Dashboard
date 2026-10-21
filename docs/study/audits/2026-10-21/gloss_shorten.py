"""Shorten the recall.glossary "what does X mean" choices for phone width.

Each "mean" item's four choices are drawn from the same pool of 26
definitions (the answers of the 26 "mean" items), so one short form per term
shortens every choice list. Appends fix records (choices, then answer) to
docs/study/corrections/recall.glossary.jsonl. Idempotent: skips an item that
already carries a record with this script's tag.

  python -I -X utf8 gloss_shorten.py [--dry]
"""
import json
import pathlib
import sys

REPO = pathlib.Path("C:/Users/pgosz/uct-worktrees/study-import")
BANK = REPO / "docs/study/bank/recall.glossary.json"
CORR = REPO / "docs/study/corrections/recall.glossary.jsonl"
TAG = "short-choices 2026-10-21"
BY = ('session 2026-10-21; the owner delegated the tightening '
      '("whatever you suggest honestly"); answer choices cut to phone width')
MAX = 55

SHORT = {
    "UCT Exposure Rating": "The firm's daily 0-150 score: suggested exposure %",
    "Distribution day": "Index falls 0.2%+ on higher volume than the prior day",
    "Follow-through day": "Rally day 4-7: index up 1.5%+ on higher volume",
    "Stage 2": "The advancing phase of the four-stage cycle",
    "ADR%": "Average daily range in %; the candidate floor is 4%",
    "RS line": "Stock ÷ SPY as a line; rises when it beats the market",
    "R / R-multiple": "One R = your planned dollar loss if the stop hits",
    "Expectancy": "What a system makes per trade on average, in R",
    "Account Risk %": "The % of the account one trade risks; 2% is the cap",
    "Portfolio heat": "Total open risk across all positions; flagged at 10%",
    "Episodic Pivot (EP)": "A neglected stock's catalyst gap starts a new trend",
    "Power Earnings Gap (PEG)": "Blowout earnings gap the stock above its base",
    "Gap support": "The prior up-gap zone a pullback must hold",
    "High Volume Edge (HVC)": "The highest-volume day's close, a line to hold",
    "U&R (Undercut & Rally)": "Undercuts a prior low, traps sellers, then reclaims it",
    "Remount": "A leader dips below a moving average, then retakes it",
    "Slingshot": "Recapturing the 4-EMA of the highs after a pullback",
    "2B Reversal / Oops": "A failed break of a prior high or low that snaps back",
    "Go Signal": "A catalyst gap digests into the 9 EMA, then engulfs",
    "Launchpad": "A tight base on top of stacked moving averages",
    "Wedge Pop / Wedge Drop": "A wedge breaking up through, or down from, the MAs",
    "Kicker candle": "Weak close, then a gap up closing above that day's high",
    "Morning Wire": "The firm's daily pre-market brief, about 7:35 AM ET",
    "Sunday Scans": "The firm's weekend scan publication",
    "UCT 20": "The firm's ranked list of 20 leading stocks",
    "Model Book": "The firm's library of history's best stocks, by year",
}


def main(dry: bool) -> int:
    items = json.loads(BANK.read_text(encoding="utf-8"))
    mean = [it for it in items if "mean" in it["prompt_json"]["q"]]
    long_to_subject = {it["answer_json"]["answer"]: it["prompt_json"]["subject"] for it in mean}
    assert set(long_to_subject.values()) == set(SHORT), sorted(set(SHORT) ^ set(long_to_subject.values()))
    assert len(set(SHORT.values())) == len(SHORT), "two terms share a short form"
    too_long = {k: len(v) for k, v in SHORT.items() if len(v) > MAX}
    assert not too_long, too_long

    done = set()
    for line in CORR.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            if r.get("tag") == TAG:
                done.add(r["item_id"])

    recs = []
    for it in mean:
        if it["id"] in done:
            continue
        before = it["prompt_json"]["choices"]
        missing = [c for c in before if c not in long_to_subject]
        assert not missing, (it["id"], missing)
        after = [SHORT[long_to_subject[c]] for c in before]
        answer = SHORT[it["prompt_json"]["subject"]]
        assert answer in after and len(set(after)) == 4, it["id"]
        base = {"ts": "2026-10-21", "item_id": it["id"], "segment": "recall.glossary",
                "owner_words": "whatever you suggest honestly", "by": BY, "tag": TAG,
                "verdict": "fix", "status": "confirmed",
                "note": "choices shortened to phone width; meaning kept from the item's own support lines"}
        recs.append(dict(base, field="choices", after=after))
        recs.append(dict(base, field="answer", after=answer))
        print(f"{it['id']} {it['prompt_json']['subject']}: max {max(map(len, before))} -> {max(map(len, after))}")

    if dry:
        print(f"DRY: {len(recs)} records not written")
        return 0
    if recs:
        text = CORR.read_text(encoding="utf-8")
        with open(CORR, "a", encoding="utf-8", newline="\n") as fh:
            if text and not text.endswith("\n"):
                fh.write("\n")
            for r in recs:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(recs)} records")
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry" in sys.argv[1:]))
