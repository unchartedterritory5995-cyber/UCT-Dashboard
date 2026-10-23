"""Bottoms batch 2: the 17 regime.bottoms holds, settled on real bars.

Evidence: docs/study/audits/2026-10-23/bottoms_price_check.md (Yahoo SPY/^GSPC/
QQQ/^IXIC/^VIX bars, then every kept number re-read on the chart the item
ships: the pod's study_bars snapshot). Appends records to
docs/study/corrections/regime.bottoms.jsonl:
  * 9 rejects: 7 whose last bar does not show the signpost, 2 whose chart
    carries the bad SPY bars of 2008-09-29 (low 11.85) and 2008-11-07 (low 53.15);
  * 8 kept: q reworded to a chart read, choices swapped where the audit found a
    defensible distractor, lesson_text = the signpost lesson + the measured
    note, reveal.quote = the measured note. No news clause survives: none was
    checked against a news source.
Idempotent by tag. Then: audit_rebuild.py regime.bottoms.

  python -I -X utf8 bottoms_batch2.py [--dry]
"""
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
CORR = REPO / "docs/study/corrections/regime.bottoms.jsonl"
BANK = REPO / "docs/study/bank/regime.bottoms.json"
TAG = "bottoms-batch2 2026-10-23"
BY = ('session 2026-10-23; the owner delegated the tightening ("whatever you suggest honestly"); '
      'price check on real bars')
EVIDENCE = "docs/study/audits/2026-10-23/bottoms_price_check.md"

Q = "{bottom}: the chart ends on the day one signpost fired. Which one?"

LESSON = {
    "Capitulation": ("That's capitulation. The last bar is a big down day on volume well above normal, after a "
                     "run of red days. It's the flush: everyone who is going to sell, sells. It means the market "
                     "is running out of sellers, not finding buyers. So it isn't a buy signal on its own. Next "
                     "you want bad news to fail to make a new low, then a follow-through day."),
    "News Failure": ("That's the news failure. Price undercut the prior low, then reversed and closed green. "
                     "When bad news can't push price lower, the sellers are spent. It marks the turn, not the "
                     "confirmation. I still wait for a follow-through day before I press."),
    "The Follow-Through Day": ("That's the follow-through day. A few sessions after the low, the index rallies "
                               "hard on heavier volume than the day before. It's the sign big buyers are stepping "
                               "back in. It can fail, so the stop goes under the low. This is where you start "
                               "watching the names that break out first."),
}

# id -> (measured note, new choices or None). Every number is the pod's snapshot.
KEEP = {
    "si_c2c8c906e852": ("Here SPY opened below its prior low, then rallied 5.1% off the low to close up 2.6%.",
                        ["News Failure", "Leadership Emerges", "Capitulation", "The Follow-Through Day"]),
    "si_553b9a890157": ("Here SPY fell 9.6% and closed near its low, on volume 2.1 times its 20-day average, "
                        "the heaviest of the chart.",
                        ["News Failure", "Capitulation", "Leadership Emerges", "The Follow-Through Day"]),
    "si_e1c2559e50cb": ("Here SPY fell 2.6% to the lowest close of the chart, its seventh straight down day, on "
                        "volume nearly twice its 20-day average.", None),
    "si_e8febf0f81b0": ("Here SPY rose 1.6% on heavier volume than the day before, three sessions after its "
                        "February 11 closing low.", None),
    "si_f57df1bb386c": ("Here SPY fell 6.5% and closed near its low, on volume 2.7 times its 20-day average, "
                        "the heaviest of the chart.",
                        ["The Follow-Through Day", "News Failure", "Capitulation", "Leadership Emerges"]),
    "si_7f5d712143b3": ("Here SPY undercut its August low intraday, then rallied 4.6% off the low to close up "
                        "2.2%.", None),
    "si_3b80b6bc1543": ("Here SPY fell 2.7% to the lowest close of the chart, its fourth straight down day, on "
                        "volume 1.8 times its 20-day average.",
                        ["Leadership Emerges", "News Failure", "The Follow-Through Day", "Capitulation"]),
    "si_2c5cf5fe2b7e": ("Here SPY rose 4.8% on twice the prior day's volume, three sessions after its October "
                        "10 low.", None),
}

CUT = {
    "si_8824aded5eb6": ("FTD 2022-11-10 is session 20 after the low; 2022-10-21 (session 6, SPY +2.4% on 1.48x "
                        "the prior day's volume) already qualified"),
    "si_94495d8da54e": "FTD 2020-03-26: SPY volume 0.86x the prior day (^GSPC 0.94x), so not heavier volume",
    "si_a37391a802da": ("FTD 2019-01-04: SPY volume 0.99x the prior day and 0.87x its 20-day average on the chart "
                        "the item ships"),
    "si_9d2e9f0dbbbf": ("Capitulation 2016-01-20: SPY closed -1.28% and above its open, after an up day; a "
                        "reversal bar, not a flush"),
    "si_85520092d6ac": ("News Failure 2016-02-11: closed red (SPY -1.30%) and SPY's low 181.09 did not undercut "
                        "the January low 181.02"),
    "si_28c4e2396923": "FTD 2011-10-10: SPY volume 0.74x the prior day, so not heavier volume",
    "si_24d4b19957f4": ("News Failure 2002-10-09: no undercut and no reversal; SPY closed -2.82% near its low "
                        "(the undercut came 10-10)"),
    "si_07141dea361c": ("chart carries bad SPY bars (2008-09-29 low 11.85, real 110.97; 2008-11-07 low 53.15, "
                        "real 90.50); the -6.7% flush itself checks out, revive when the bars are fixed"),
    "si_2f527b374a59": ("chart carries bad SPY bars (2008-09-29 low 11.85, real 110.97; 2008-11-07 low 53.15, "
                        "real 90.50); the FTD itself checks out (SPY +3.95% on 1.15x), revive when the bars "
                        "are fixed"),
}


def main(dry: bool) -> int:
    items = {it["id"]: it for it in json.loads(BANK.read_text(encoding="utf-8"))}
    assert set(KEEP) | set(CUT) == set(items), sorted(set(items) ^ (set(KEEP) | set(CUT)))
    done = set()
    for line in CORR.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            if r.get("tag") == TAG:
                done.add(r["item_id"])
    base = {"ts": "2026-10-23", "segment": "regime.bottoms", "owner_words": "whatever you suggest honestly",
            "by": BY, "tag": TAG, "audit": EVIDENCE, "status": "confirmed"}
    recs = []
    for iid, why in CUT.items():
        if iid not in done:
            recs.append(dict(base, item_id=iid, verdict="reject", reason=why))
    for iid, (note, choices) in KEEP.items():
        if iid in done:
            continue
        it = items[iid]
        sign = it["reveal_json"]["signpost"]
        key = it["answer_json"]["answer"]
        assert key == sign and sign in LESSON, (iid, key, sign)
        if choices is not None:
            assert key in choices and len(set(choices)) == 4, iid
        recs.append(dict(base, item_id=iid, verdict="fix", field="q",
                         after=Q.format(bottom=it["reveal_json"]["bottom"])))
        if choices is not None:
            recs.append(dict(base, item_id=iid, verdict="fix", field="choices", after=choices))
        recs.append(dict(base, item_id=iid, verdict="fix", field="lesson_text", lesson_origin="session",
                         after=LESSON[sign] + " " + note))
        recs.append(dict(base, item_id=iid, verdict="fix", field="reveal.quote", after=note))
    print(f"{len(recs)} records ({len(CUT)} rejects, {len(KEEP)} kept)")
    if dry or not recs:
        return 0
    text = CORR.read_text(encoding="utf-8")
    with open(CORR, "a", encoding="utf-8", newline="\n") as fh:
        if text and not text.endswith("\n"):
            fh.write("\n")
        for r in recs:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry" in sys.argv[1:]))
