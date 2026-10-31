"""Builds the HOURLY Go Signal drafts for the owner's review: docs/study/bank/spot.go_signal_hourly.json.

One `spot` item per owner-ruled day (the 45 daily footprints graded 2026-10-27/28, minus the cuts) plus the
alternates the owner or the finder pointed at (RKLB the day before, VGZ earlier sessions). Each item EMBEDS its
own hourly bars (`bars_embed`, tf='60', unix-second keys) — the pod's bars store has no hourly history before
2026-09-28, so the import route's get_bars_before path cannot serve these; the embed path stores them as the
record itself. Visible window = the 15 sessions before the ruled session plus the ruled session (every
regular-session hourly bar, so the flag, the undercut and the whole day's red-to-green are on the chart);
forward = the next 5 sessions. Facts come from scripts/study/find_go_signal_hourly.py (the flag levels the
overlay draws, the first-hour read, the finder's own verdict), so the owner can rule on the chart and the
finder's reading at once. Drafts only; nothing is approved here.

    python -X utf8 scripts/study/gen_go_signal_hourly.py
"""
import hashlib, json, os, sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
from scripts.study._common import make_item  # noqa: E402
from scripts.study.find_go_signal_hourly import evaluate, sessions, to_bars  # noqa: E402

BARS = os.path.join(REPO, "docs", "study", "setups", "go_signal_hourly_bars.json")
OUT = os.path.join(REPO, "docs", "study", "bank", "spot.go_signal_hourly.json")
SOURCE = "docs/study/setups/go_signal_hourly_bars.json"
SKILL = "setup.intraday.go_signal"
SETUP = "Go Signal (hourly)"
BACK_SESSIONS, FWD_SESSIONS = 15, 5

DEFINITION = ("Go Signal (hourly): the same family as the Oops Reversal and the UNR, read on the hourly chart. A stock "
              "that has advanced forms a notable hourly flag, a slight range off a higher low; in the first hour of a "
              "session the stock undercuts the flag's low and quickly goes red to green, closing the hour back above "
              "the flag low. The daily bar is only the footprint (owner rulings 2026-10-27).")

# the owner's daily-footprint grade (owner_verdicts.jsonl, 2026-10-27/28), carried as a fact so the review card shows it
OWNER_DAILY = {
    "MSFT|2022-11-17": "great", "DOCN|2026-04-27": "great", "MU|2024-03-19": "great", "ONON|2024-09-11": "great",
    "AAPL|2022-09-01": "good", "MSFT|2022-11-22": "good", "COLM|2024-02-02": "good", "SNOW|2022-03-24": "good",
    "CCI|2021-11-15": "good", "ANET|2022-02-16": "good", "SMH|2026-04-15": "good", "RKLB|2026-01-05": "good, plus the day before",
    "HL|2025-11-21": "good", "DASH|2024-11-04": "decent, some nuance", "PHM|2023-11-30": "good", "MDB|2023-06-01": "good",
    "SOFI|2025-06-23": "good", "TSLA|2023-05-31": "good", "ZM|2023-02-14": "good setup, no follow-through",
    "INTC|2022-01-14": "good setup, no follow-through", "AMZN|2022-08-18": "okay (daily only)", "AAPL|2022-08-24": "okay (daily only)",
    "CELH|2024-01-02": "okay, not much follow-through", "TEAM|2024-11-05": "eh", "NVDA|2022-07-25": "need the hourly",
    "AMZN|2022-10-11": "need the hourly", "AAPL|2022-11-16": "need the hourly", "MSFT|2022-07-14": "need the hourly",
    "NVDA|2022-10-11": "need the hourly (doubtful)", "VST|2026-10-16": "need the hourly (might just be an oops)",
    "VEON|2026-10-16": "need the hourly (needs to be more higher-low-ish)", "XERS|2026-10-16": "need the hourly",
    "CSCO|2023-03-16": "need the hourly (could be great)", "RKLB|2023-01-10": "need the hourly", "HOOD|2024-11-15": "need the hourly",
    "DUOL|2023-11-16": "need the hourly", "VGZ|2026-10-16": "replace with an earlier day",
}
# daily drafts the finder put on the pod that the owner never saw (no verdict line): drafted on the hourly straight away
NOT_YET_SHOWN = {"WING|2026-10-27": "pod daily draft never shown to the owner; hourly added 2026-10-30 (3 forward sessions only)"}
# extra sessions to draft from the same bars record: (bars key, session, why)
EXTRAS = [("RKLB|2026-01-05", "2026-01-02", "owner: 'plus the day before too'"),
          ("VGZ|2026-10-16", "2026-09-28", "owner: 'prob a few days earlier'; finder fires here"),
          ("VGZ|2026-10-16", "2026-09-14", "owner: 'prob a few days earlier'; finder fires here")]


def fact_line(f):
    if not f:
        return "The hourly finder could not read this session (window too short)."
    under = f"undercut the flag low by {f['undercut_pct']}%" if f["undercut"] else "did not undercut the flag low"
    rel = "above" if f["reclaim_pct"] >= 0 else "below"
    r2g = "red to green" if f["red_to_green"] else "not red to green"
    line = (f"On the last session shown the first hour {under} and closed {abs(f['reclaim_pct'])}% {rel} it ({r2g}); "
            f"the flag ran {f['flag_sessions']} sessions in a {f['flag_range_pct']}% range after a {f['advance_pct']}% advance"
            f"{', off a higher low' if f['higher_low'] else ', not off a higher low'}")
    if f.get("first_hour_vol_x") is not None:
        line += f"; first-hour volume {f['first_hour_vol_x']}x the flag's first hours"
    if f.get("fwd_5s_pct") is not None:
        line += f"; five sessions on the stock was {f['fwd_5s_pct']}% from the reclaim close"
    return line + "."


def build_item(sym, session, sess, k, facts, note):
    visible = [b for _, s in sess[max(0, k - BACK_SESSIONS):k + 1] for b in s]
    forward = [b for _, s in sess[k + 1:k + 1 + FWD_SESSIONS] for b in s]
    digest = hashlib.sha256(json.dumps(visible, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()
    ref = f"{SOURCE}#{SETUP}#{sym}#{session}"
    f = dict(facts or {})
    f.update({"setup": SETUP, "tf": "60", "owner_daily_grade": OWNER_DAILY.get(f"{sym}|{session}"), "why": note})
    reveal = {"detector": "find_go_signal_hourly", "setup": SETUP, "fires": bool(f.get("fires")), "quote": DEFINITION,
              "facts": f, "source": ref, "window_bars": len(visible),
              "example": {"sym": sym, "asof": session, "found_by": "find_go_signal_hourly.py over vendor hourly bars (read-only pod fetch 2026-10-30)"}}
    return make_item(
        type="spot", skill_id=SKILL,
        q="Is there a Go Signal on this hourly chart: a flag, an undercut of the flag low, and a first-hour red-to-green reclaim on the last session shown?",
        answer="yes", choices=["Yes", "No"],
        prompt_extra={"chart": {"window_bars": len(visible), "tf": "60"}, "subject": f"{sym} {session} hourly"},
        reveal=reveal, lesson_text=(DEFINITION + " " + fact_line(facts)).strip(), lesson_origin="session",
        source_kind="setups", source_ref=ref, difficulty=3,
        sym=sym, asof=session, adjustment_basis="split-adjusted",
        bars_embed={"sym": sym, "tf": "60", "asof": session, "bars": visible, "forward": forward, "sha256": digest})


def main():
    doc = json.load(open(BARS, encoding="utf-8"))
    items, skipped = [], []
    todo = [(key, key.split("|")[1], "owner-ruled day" if key in OWNER_DAILY else NOT_YET_SHOWN.get(key, "pod draft"))
            for key in doc["names"]] + list(EXTRAS)
    for key, session, note in todo:
        rec = doc["names"].get(key)
        if not rec or "bars" not in rec:
            skipped.append((key, session, "no bars"))
            continue
        sym = key.split("|")[0]
        sess = sessions(to_bars(rec["bars"]))
        idx = {d: i for i, (d, _) in enumerate(sess)}
        if session not in idx:
            skipped.append((key, session, "session not in window"))
            continue
        k = idx[session]
        items.append(build_item(sym, session, sess, k, evaluate(sess, k), note))
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(items, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    fires = sum(1 for it in items if it["reveal_json"]["fires"])
    print(f"{len(items)} hourly Go Signal drafts -> {OUT} ({os.path.getsize(OUT)} bytes); finder fires on {fires}; skipped {skipped}")
    print("generated", datetime.now().strftime("%Y-%m-%d"))


if __name__ == "__main__":
    main()
