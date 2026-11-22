"""Review the Step 2 sample from a chat (the owner on his phone, 2026-11-12).

    python chat_review.py next [N]            print the next N undecided sample questions (default 5), phone-friendly
    python chat_review.py save FILE.json      save answers: [{"id": "si_...", "v": "keep|fix|cut", "note": "..."}]

The queue is the same one the review page builds (static/index.html, unitSample: 5 per lesson, riskiest first,
widened to 15 after one defect), and answers go through the page's own endpoint (POST /api/verdict), so the page
and the chat stay one record. The review server must be running (Start Library Review).
"""
import json
import os
import sys
import urllib.request

HOME = os.path.dirname(os.path.abspath(__file__))
API = "http://127.0.0.1:8794/api/"
SAMPLE_FIRST, SAMPLE_WIDE = 5, 10
#: owner 2026-11-14: review "core first": setups, risk, orders, shorting, process, psychology, styles, then the rest,
#: options last. Lessons keep their order inside a track.
TRACK_ORDER = ["SET", "F9", "F10", "F10b", "F12", "F8", "F11", "F1", "F5", "V", "F7", "F6"]


def ordered_units(idx):
    rank = {t: i for i, t in enumerate(TRACK_ORDER)}
    return sorted(idx["units"], key=lambda u: rank.get(u["track"], len(TRACK_ORDER)))


#: the setup cards' example charts (one image per winner, failure and near-miss), drawn from the pod's bars with the
#: ticker, the buy, the stop and the R marks: the owner's view of the example, never a member's
SHEETS = r"C:\Users\pgosz\uct-worktrees\_study-resume\scratchpad\setups"


def chart_image(card, chart):
    """The example image for a question's chart: same ticker, the image's date within 14 days of the chart's last day
    (a question shows the day before the breakout or up to two weeks into the trade; the image is named on the signal day)."""
    import datetime as dt
    if not chart or not card:
        return None
    # a lesson names its card by path ("docs/study/setups/criteria/01-flat-base.json"); the sheets sit under its stem
    folder = os.path.join(SHEETS, os.path.splitext(os.path.basename(str(card)))[0], "final")
    if not os.path.isdir(folder):
        return None
    sym, asof = str(chart.get("sym") or "").upper(), str(chart.get("asof") or "")
    try:
        day = dt.date.fromisoformat(asof)
    except ValueError:
        return None
    best = None
    for name in os.listdir(folder):
        parts = name[:-4].split("_") if name.endswith(".png") else []
        if len(parts) < 3 or parts[-2].upper() != sym:
            continue
        try:
            gap = abs((dt.date.fromisoformat(parts[-1]) - day).days)
        except ValueError:
            continue
        if gap <= 14 and (best is None or gap < best[0]):
            best = (gap, os.path.join(folder, name))
    return best[1] if best else None


def load(name):
    return json.load(open(os.path.join(HOME, "data", name), encoding="utf-8"))


def fnv(s):        # the page's hash(): 32-bit FNV-1a over UTF-16 code units
    h = 2166136261
    for ch in s.encode("utf-16-le").decode("utf-16-le"):
        for unit in ([ord(ch)] if ord(ch) < 0x10000 else [0xD800 + ((ord(ch) - 0x10000) >> 10), 0xDC00 + ((ord(ch) - 0x10000) & 0x3FF)]):
            h ^= unit
            h = (h * 16777619) & 0xFFFFFFFF
    return h


def reviews():
    with urllib.request.urlopen(API + "verdicts", timeout=10) as r:
        data = json.load(r)
    return data.get("records") or {}


def queue(idx, calls, recs):
    decided = lambda i: bool((recs.get(i) or {}).get("v"))
    out = []
    for u in ordered_units(idx):
        ups = sorted([i for i in u["ids"] if "Upgraded" in ((calls.get(i) or {}).get("r") or "")], key=fnv)
        first = sorted(ups[:SAMPLE_FIRST], key=lambda i: (-((calls.get(i) or {}).get("rk") or 0), fnv(i)))
        done = [i for i in first if decided(i)]
        defects = sum(1 for i in done if recs[i]["v"] != "keep")
        wide = ups[SAMPLE_FIRST:SAMPLE_FIRST + SAMPLE_WIDE] if len(done) == len(first) and 0 < defects < 3 else []
        out += [(u, i) for i in first + wide]
    return out, decided


def show(n):
    idx, calls, recs = load("index.json"), load("calls.json"), reviews()
    q, decided = queue(idx, calls, recs)
    left = [(u, i) for u, i in q if not decided(i)]
    tracks = {}
    print(f"{len(q) - len(left)} of {len(q)} done\n")
    for num, (u, i) in enumerate(left[:n], 1):
        if u["track"] not in tracks:
            tracks[u["track"]] = load(f"track-{u['track']}.json")
        qq = next(x for x in tracks[u["track"]][u["unit"]]["questions"] if x["id"] == i)
        print(f"**{num}. {u['unit']} {u['title']}**  `{i}`")
        if qq.get("story"):
            print(qq["story"])
        print(f"**{qq.get('q')}**")
        if qq.get("sentence"):
            print(qq["sentence"].replace("___", f"**{qq.get('answer')}**"))
        elif qq.get("choices"):
            for k, c in zip("ABCD", qq["choices"]):
                print(f"{k}) {c}" + ("  ✅" if c == qq.get("answer") else ""))
        else:
            print(f"Answer: **{(qq.get('prefix') or '')}{qq.get('answer')}{(qq.get('suffix') or '')}**")
        if qq.get("simple"):
            print(f"_Why:_ {qq['simple']}")
        if qq.get("chart"):
            c = qq["chart"]
            img = chart_image(tracks[u["track"]][u["unit"]].get("card"), c)
            print(f"Chart: {c.get('sym')} up to {c.get('asof')}" + (f" (trade {c['trade']['entry']} / {c['trade']['stop']})" if c.get("trade") else ""))
            print(f"IMAGE: {img}" if img else "IMAGE: none on file")
        print()


def save(path):
    idx = load("index.json")
    unit_of = {i: u for u in idx["units"] for i in u["ids"]}
    tracks = {}
    for a in json.load(open(path, encoding="utf-8")):
        u = unit_of[a["id"]]
        if u["track"] not in tracks:
            tracks[u["track"]] = load(f"track-{u['track']}.json")
        qq = next(x for x in tracks[u["track"]][u["unit"]]["questions"] if x["id"] == a["id"])
        rec = {"id": a["id"], "kind": "q", "unit": u["slug"], "key": qq["key"], "v": a["v"], "note": a.get("note", ""),
               "tags": ["via chat"], "q": str(qq.get("q") or "")[:160]}
        req = urllib.request.Request(API + "verdict", data=json.dumps(rec).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            print(a["id"], a["v"], r.status)


if __name__ == "__main__":
    if sys.argv[1] == "next":
        show(int(sys.argv[2]) if len(sys.argv) > 2 else 5)
    else:
        save(sys.argv[2])
