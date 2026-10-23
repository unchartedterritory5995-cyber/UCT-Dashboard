"""auditA_build.py - builds auditA_verdicts.jsonl for the three recall segments.

READ-ONLY on the repo: it reads the bank files and imports the importer's pure
check functions (api/services/study_import.py) to validate every proposed fix.
Writes only to the scratchpad (files prefixed auditA_).
"""
import json
import pathlib
import sys

REPO = pathlib.Path(r"C:\Users\pgosz\uct-worktrees\study-import")
OUT = pathlib.Path(r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad")
sys.path.insert(0, str(REPO))
from api.services import study_import as si  # noqa: E402  (pure functions only)


def load(seg):
    d = json.load(open(REPO / "docs" / "study" / "bank" / f"{seg}.json", encoding="utf-8"))
    items = d["items"] if isinstance(d, dict) else d
    return [i for i in items if i.get("review_status") != "approved"]


BIBLE = load("recall.bible")
CONCEPTS = load("recall.concepts")
GLOSSARY = load("recall.glossary")
BY_ID = {i["id"]: i for i in BIBLE + CONCEPTS + GLOSSARY}

V = {}  # item_id -> verdict dict


def put(iid, verdict, code, reason, source_line=None, fix=None, duplicate_of=None):
    assert iid in BY_ID, iid
    assert iid not in V, iid
    V[iid] = dict(verdict=verdict, code=code, reason=reason, source_line=source_line,
                  fix=fix, duplicate_of=duplicate_of)


def fx(field, after, *also):
    f = {"field": field, "after": after}
    if also:
        f["also"] = [{"field": a, "after": b} for a, b in also]
    return f


# ═════════════════════════════════ BIBLE ══════════════════════════════════════
B = "C:/Users/pgosz/projects/uct-intelligence/prompts/01_methodology_bible.txt"
RULE = {n: t for n, t in [
    (1, "Cut losses at exactly 7-8% below your buy point — no exceptions, no hope"),
    (2, "Let winners run — use the 20-25% profit rule or climax top signals, not a fixed target"),
    (3, "Buy stocks at or near new 52-week or all-time highs, not cheap stocks near lows"),
    (4, "Volume must confirm every breakout (40-50%+ above average)"),
    (5, "Never average down — add only to winners"),
    (6, "Never buy on tips or opinions — let the chart and fundamentals confirm"),
    (7, "Don't buy more than 5-7 stocks at once — concentration beats diversification"),
    (8, "RS line should be making new highs before or at the same time as price"),
    (9, "The best stocks form sound base patterns before major moves"),
    (10, "Earnings growth is the engine — without it, there is no sustainable move"),
    (11, "Big winning stocks show up on new high lists, not new low lists"),
    (12, "Institutions must be buying — accumulation days > distribution days"),
    (13, "The general market direction determines 75% of a stock's outcome"),
    (14, "Follow-Through Days confirm new market uptrends (Day 4-7, 1.5%+ on higher volume)"),
    (15, "5-6 distribution days in 25 sessions signals market top — reduce exposure"),
    (16, "The best time to buy is within 5-10% of a proper base breakout pivot"),
    (17, "Buy the leading stock in the leading industry group"),
    (18, "Round numbers are not sell targets — sell on climax tops and technical signals"),
    (19, "Never marry a stock — be willing to sell if the story changes"),
    (20, "Price/volume analysis beats news — the tape never lies"),
    (21, "Sell when a stock fails to follow through after a breakout on heavy volume"),
    (22, "The biggest winners look \"too expensive\" before they double"),
    (23, "Study your mistakes more than your successes — losers teach more"),
]}


def bl(n):
    return f"{B} line {22 + n}: \"{n}. {RULE[n]}\""


GIVEAWAY = ("Giveaway: the three distractors are playbook 'named mistakes' (Chasing.../Buying.../Ignoring...), "
            "the key is the only line written as a rule, so it is answered without knowing O'Neil. The distractors "
            "come from playbook prose the owner put on HOLD 2026-10-18; ")
OWNER_TRADES = ("two of the pool's lines ('high-of-day break', 'before a candle holds the 20-EMA') he says he trades. ")
STEM = "Same stem on all 23 rule items; choices 50-119 chars; lesson is the one-line rule."

MCQ = {1: "si_bcf98cc7457f", 2: "si_58718bb8e40f", 3: "si_e88789e05d8f", 4: "si_1fb63fbba6cd",
       5: "si_1104114022ea", 6: "si_fdb7831aaa7b", 7: "si_37fa1c2cd494", 8: "si_3f7a98b5a9a4",
       9: "si_a70663725c6e", 10: "si_c0b8c4aec06b", 11: "si_b96a9522602f", 12: "si_3afdffc09713",
       13: "si_9d0b682370ce", 14: "si_8a881e510006", 15: "si_68132ed2c794", 16: "si_a08e2232967b",
       17: "si_bfbdcb36467b", 18: "si_bdc2dc791074", 19: "si_ec18f25b5b53", 20: "si_2dec6ccfa011",
       21: "si_fe1184f136c2", 22: "si_ee3272f5aa04", 23: "si_d2783fd0183e"}
FILL = {1: "si_f6c5b2e8c2c2", 2: "si_96b7ce55203a", 3: "si_b41e18794a71", 4: "si_601ddb6b73e9",
        7: "si_b2d51dfb6d3e", 13: "si_9964149f05d1", 14: "si_6aa3c69c58b9", 15: "si_3fd4578bd6cb",
        16: "si_2e64ce9e97d8"}

# numeric-rule MCQs: the fill-in tests the same rule without the giveaway
for n, fid in FILL.items():
    extra = OWNER_TRADES if n in (1, 2, 3, 4) else ""
    put(MCQ[n], "cut", "duplicate",
        f"Rule {n} is already quizzed by its fill-in {fid}, which tests the rule's content. " + GIVEAWAY + extra + STEM,
        bl(n), None, fid)

put(MCQ[11], "cut", "duplicate",
    "Same idea as rule 3 (buy near new highs, not cheap stocks near lows), quizzed by fill-in si_b41e18794a71; "
    "its lesson folds this rule in. " + GIVEAWAY + STEM, bl(11), None, FILL[3])
put(MCQ[22], "cut", "duplicate",
    "Restates rule 3 / CANSLIM L ('laggards lag for a reason'); folded into the rule-3 fill-in lesson. "
    + GIVEAWAY + OWNER_TRADES + STEM, bl(22), None, FILL[3])
put(MCQ[18], "cut", "duplicate",
    "Same idea as rule 2 (sell on climax tops, not a fixed or round target), quizzed by fill-in si_96b7ce55203a; "
    "folded into that lesson. " + GIVEAWAY + OWNER_TRADES + STEM, bl(18), None, FILL[2])
put(MCQ[20], "cut", "duplicate",
    "Slogan with no testable content beyond rule 6 (tips vs chart) and rule 4 (volume confirms); 'the tape never lies' "
    "is a house word the owner wants out of copy he did not write (VOICE 7b) and the bible is not his writing. "
    + GIVEAWAY + STEM, bl(20), None, MCQ[6])

SUP = {
    "sell1": f"{B} SELL RULES 1: \"Hard stop: 7-8% below buy point — no exceptions. If you paid $50, stop is $46.00-$46.50.\"",
    "sell2": f"{B} SELL RULES 2: \"20-25% profit target (for most stocks): take partial profits when up 20-25% from breakout. Let the remainder ride with trailing stop.\"",
    "sell3": f"{B} SELL RULES 3: \"Climax top: after a long advance, the stock makes its single LARGEST daily point gain of the entire run. This is a sell signal.\"",
    "sell7": f"{B} SELL RULES 7: \"RS line fails to confirm new price high: stock making new highs but RS line is not — divergence warning.\"",
    "own3": "docs/study/VOICE.md + docs/study/sizing_rule.md §1 (owner, Sunday Scans 2026-06-14): \"I almost never take a loss greater than 3%.\"",
    "ownstop": "docs/study/sizing_rule.md §2: \"Default stop: the low of the day, or the prior day's low. (Owner's answer.)\"",
    "appt": "docs/study/VOICE.md §3 (real column): \"The stop is an appointment, not a debate.\"",
    "ownhold": "morning-wire/data/voice/voice_exemplars.json (Sunday Scans 2026-06-14): \"Hold your winners by selling partials into strength and trailing the rising moving averages.\"",
    "N": f"{B} CANSLIM N: \"The stock must be making new highs — 'buy high, sell higher.' Never buy stocks making new lows hoping for a reversal.\"",
    "L": f"{B} CANSLIM L: \"RS Rating 80+ minimum. Prefer 85-95+. Buy only the top 1-2 stocks in the top industry groups. Never buy the cheap laggard 'because it hasn't moved yet' — laggards lag for a reason. The leading stock leads because institutions are buying it.\"",
    "S": f"{B} CANSLIM S: \"Volume on breakout MUST be 40-50%+ above average daily volume (50-day average). Without volume confirmation, do not buy the breakout.\"",
    "cupvol": f"{B} CUP-WITH-HANDLE: \"Volume on breakout: 40-50%+ above 50-day average volume (ideally 3-4x average on the breakout day).\" / \"Failure signals: ... breakout on below-average volume.\"",
    "heavy": "app/src/components/chart/engine/ast/conceptVocabulary.json#heavy volume: \"vol_ratio >= 2\" (\"Two times the symbol's own average\")",
    "desk510": "docs/study/sizing_rule.md §5: \"5 to 10 positions for a momentum swing book. Concentration over diversification.\" / \"Correlation: five positions in one theme count as one trade\"",
    "semis": "docs/study/corrections/recall.principles.jsonl si_99956e481849 (proposed lesson, owner 2026-10-19): \"If the semis roll over, five semiconductor longs all hit their stops on the same day\"",
    "M": f"{B} CANSLIM M: \"3 out of 4 stocks follow the general market. Never fight the market direction. When the market is in a Confirmed Uptrend, buy aggressively. Under Pressure = reduce exposure. Correction = go to cash or minimal exposure. Use Follow-Through Days to identify new uptrends. Use distribution day counts to identify market tops.\"",
    "ftd": f"{B} FOLLOW-THROUGH DAY RULES: \"Day count: starts when a major index ... makes a rally attempt (closes higher than prior day after a decline). Qualifying FTD: occurs on Day 4-7 ... rises 1.5%+ on HIGHER volume than the prior session. ... FTDs on Day 4-5 are stronger than Day 6-7. FTDs that fail (undercut the rally attempt low within a few days) are false signals. After FTD: buy the 2-3 best setups that have formed during the correction. Do not chase everything.\"",
    "ownftd": "voice_exemplars.json (Sunday Scans 2026-04-05): \"I do like to add one more before the Follow-Through Day.\"",
    "dd": f"{B} DISTRIBUTION DAY RULES: \"major index falls 0.2%+ on higher volume than the prior session. Signals institutional selling. ... rolling 25-session window. Thresholds: 3 days = caution, 4 days = reduce exposure, 5-6 days = market under pressure or correction. Reset: distribution days expire after 25 sessions or if the index gains 5%+ from the distribution day close. Stalling: ... less than 0.1% gain on high volume ... also counts as distribution\"",
    "wiredd": "C:/Users/pgosz/projects/morning-wire/morning_wire_engine.py ~4584: \"elif 4 <= max_d <= 5: if phase == 'Confirmed Uptrend': phase = 'Uptrend Under Pressure' / elif max_d >= 6: ... phase = 'Market in Correction'\" (max_d = QQQ distribution count)",
    "cup": f"{B} CUP-WITH-HANDLE: \"Cup depth: 12-33% ... over 7 weeks to 15 months ... Handle: forms in upper third of the cup. Drifts down no more than 8-12% ... Volume dries up during handle ... Pivot/buy point: 10 cents above the highest high of the handle ... best breakouts from bases 7-16 weeks old. Very short bases (under 6 weeks) are not fully formed.\"",
    "vcpentry": f"{B} VCP: \"Entry: 5-10% above the pivot on the day of breakout (never chase more than 5-10% above pivot).\"",
    "chase": "app/src/pages/modelbook/setupPlaybooks.js (Flat Base Breakout mistakes): \"Chasing well past the breakout instead of entering near the pivot.\"",
    "minadd": f"{B} MINERVINI RISK MANAGEMENT: \"Initial entry on breakout (50-75% of intended position). Add the remaining 25-50% when stock confirms by moving higher from entry.\"",
    "ladder": "docs/study/sizing_rule.md §5: \"Progressive exposure: pilot → half → full, add only after the last step paid.\"",
    "jmistake": "CLAUDE.md Trade Journal: \"Mistake taxonomy: 17 default mistakes (overtrading, FOMO, chasing, early_exit, ..., oversized, ..., added_to_loser, ...)\"",
    "CA": f"{B} CANSLIM C/A: \"EPS up 25%+ vs same quarter prior year. Ideal: 40-50%+ ... Accelerating EPS growth across the last 3-4 quarters is the strongest signal. Sales growth ... ideally 25%+.\" / \"25%+ EPS growth per year for the prior 3-5 years.\"",
    "own160": "voice_exemplars.json (Sunday Scans 2026-07-12): \"160% revenue growth.\"",
    "I": f"{B} CANSLIM I: \"Must show increasing number of quality mutual funds and institutions owning shares.\"",
    "volacc": "C:/Users/pgosz/projects/uct-intelligence/scripts/scanner_candidates.py ~795-893: vol_acc_ratio = avg volume on up days / avg volume on down days over the last 10 bars; \"if vol_acc_ratio > 1.1\" scores highest",
    "rsrank": "api/services/screener/methodology.py _rs_rank_method: \"Price performance rank against the whole universe, 1-99.\" / \"80 means it outperformed 80% of the names we cover.\"",
    "rsline_scan": "uct-intelligence/scripts/scanner_candidates.py _compute_rs_slope: \"Compute RS line slope: ticker_close / spy_close over last 20 bars. Returns 'up', 'flat', or 'down'\"",
    "minstall": f"{B} MINERVINI SELLING RULES: \"Move from VCP breakout that stalls immediately (fails to follow through in 2-3 days): exit quickly — false breakout signal.\"",
    "ownmist": "voice_exemplars.json (Sunday Scans 2026-06-21): \"Whether it be missed trades, oversizing, selling too early, holding too long, under trading or overtrading, I will consistently learn lessons from the market about myself and make adjustments accordingly.\"",
    "ownstopout": "voice_exemplars.json (Sunday Scans 2026-06-21): \"I am okay stopping out before a stock moves.\"",
}

LESSON = {}
LESSON[1] = ("O'Neil cuts every loss at 7-8% below the buy point. No exceptions, and no hoping it comes back. "
             "The bible's worked example: pay $50 and the stop sits at $46.00 to $46.50. "
             "The stop is an appointment, not a debate. "
             "That number belongs to O'Neil's system, and our stops sit much closer. "
             "The owner: \"I almost never take a loss greater than 3%.\" "
             "The desk's default stop is the low of the day or the prior day's low. "
             "Whichever system you follow, set the stop before you buy and take it when it hits.")
LESSON[2] = ("O'Neil's profit rule: when a stock is up 20-25% from the breakout, take partial profits. "
             "Let the rest ride with a trailing stop. He does not sell at a fixed target or a round number. "
             "His other exit is a climax top. After a long advance, the stock posts its single largest daily point gain of the run. "
             "That is a sell signal. "
             "The owner's version is close: \"Hold your winners by selling partials into strength and trailing the rising moving averages.\" "
             "(Sunday Scans, 2026-06-14)")
LESSON[3] = ("O'Neil buys strength. Rule 3: buy at or near new 52-week or all-time highs, not cheap stocks near lows. "
             "His phrase is \"buy high, sell higher.\" "
             "Rule 11 says it from the other side. Big winners show up on new high lists, not new low lists. "
             "Never buy a stock making new lows and hope for a reversal. Laggards lag for a reason. "
             "Rule 22 names the feeling you will fight: the biggest winners look too expensive before they double.")
LESSON[4] = ("Volume is the proof behind a breakout. "
             "O'Neil wants breakout volume at least 40-50% above the 50-day average. Without it, he does not buy the breakout. "
             "On a cup with handle the ideal is 3-4 times average on the breakout day. "
             "A breakout on below-average volume is one of the bible's failure signals. "
             "The firm's screener uses a stricter word: it calls volume heavy at twice the stock's own average.")
LESSON[7] = ("O'Neil keeps the book small: no more than 5-7 stocks at once. "
             "The reason is in the rule itself, concentration beats diversification. "
             "The desk runs a little wider: 5 to 10 positions for a momentum swing book, still concentration over diversification. "
             "Count names in one theme as one trade. "
             "If the semis roll over, five semiconductor longs can all hit their stops on the same day.")
LESSON[13] = ("Three out of four stocks follow the general market. That is the M in CANSLIM. "
              "It is why O'Neil checks the market before any chart. "
              "In a Confirmed Uptrend he buys aggressively. Under Pressure, he reduces exposure. "
              "In a Correction he goes to cash or close to it. "
              "Follow-Through Days mark new uptrends, and distribution day counts mark tops. "
              "The firm puts its own read in one number every morning, the Exposure Rating.")
LESSON[14] = ("A Follow-Through Day says a new uptrend has a chance. "
              "The count starts when a major index closes higher after a decline: day 1 of the rally attempt. "
              "The follow-through comes on day 4 to 7, with the index up 1.5% or more on higher volume than the day before. "
              "Day 4-5 follow-throughs are stronger than day 6-7. Not all of them work. "
              "If the index undercuts the rally low a few days later, it was a false signal. "
              "After one, buy the 2-3 best setups that formed in the correction. Do not chase everything. "
              "The owner often starts early: \"I do like to add one more before the Follow-Through Day.\" (Sunday Scans, 2026-04-05)")
LESSON[15] = ("A distribution day is a major index down 0.2% or more on higher volume than the session before. "
              "It signals institutional selling. O'Neil counts them over a rolling 25 sessions. "
              "Three is caution, four means reduce exposure, and 5-6 means the market is under pressure or in correction. "
              "A day drops off after 25 sessions, or once the index gains 5% from that day's close. "
              "The firm's Morning Wire counts them on QQQ. "
              "Four or five turn a confirmed uptrend into Uptrend Under Pressure. Six or more reads Market in Correction.")
LESSON[16] = ("Buy near the pivot, not after the move. "
              "The pivot is the breakout point of a proper base. On a cup with handle it sits 10 cents above the handle's high. "
              "O'Neil's buy zone runs to 5-10% above that pivot. "
              "The bible's VCP rules say the same: never chase more than 5-10% above the pivot. "
              "Past that you are chasing, a named mistake in the firm's playbooks.")
LESSON[5] = ("Never average down. Buying more of a stock that is below your entry means adding to a loser. "
             "O'Neil only adds to positions that are working. "
             "Minervini's version in the bible: start with part of the position. Add the rest once the stock moves higher from your entry. "
             "The desk ladders the same way: pilot, then half, then full, and you add only after the last step paid. "
             "Added to a loser is one of the named mistakes in the firm's journal.")
LESSON[6] = ("A tip is someone else's opinion. "
             "O'Neil does not act on it until the chart and the fundamentals agree. "
             "The chart shows price and volume. The fundamentals show the earnings growth behind the move. "
             "Rule 20 says it another way: price and volume beat the news. "
             "Hear a tip, put the name on a list, and let the chart decide.")
LESSON[8] = ("The RS line is the stock's price divided by SPY, drawn as a line. "
             "It rises when the stock beats the market and falls when it lags. "
             "O'Neil wants it making new highs before or at the same time as the price. "
             "The warning is the opposite: price makes a new high and the RS line does not. "
             "The bible lists that divergence as a sell signal. "
             "Do not mix it up with the RS rank, the screener's 1-99 score.")
LESSON[9] = ("Big moves start from bases. O'Neil's model base is the cup with handle. "
             "The cup corrects 12-33% from the prior high, over 7 weeks to 15 months. "
             "The handle forms in the upper third of the cup and drifts down no more than 8-12%, on drying volume. "
             "The buy point is 10 cents above the handle's high. "
             "Bases of 7-16 weeks give the best breakouts. Under 6 weeks, a base is not fully formed.")
LESSON[10] = ("For O'Neil, earnings are the fuel. "
              "The C in CANSLIM wants quarterly EPS up 25% or more against the same quarter a year ago, ideally 40-50% or more. "
              "Accelerating growth over the last 3-4 quarters is the strongest signal. Sales should grow too, ideally 25% or more. "
              "The A wants annual EPS growth of 25% or more for 3-5 years. "
              "The owner reads growth in his scans too: \"160% revenue growth.\" (Sunday Scans, 2026-07-12)")
LESSON[12] = ("The bible: the leading stock leads because institutions are buying it. "
              "Rule 12 asks for proof, more accumulation days than distribution days. "
              "The I in CANSLIM looks for a growing number of quality funds owning the stock. "
              "The firm's scanner measures the same footprint over the last 10 bars: average volume on up days against down days. "
              "Above 1.1 scores highest in its candle score.")
LESSON[17] = ("O'Neil buys the strongest stock in the strongest industry group, never the cheap laggard that has not moved yet. "
              "The L in CANSLIM: RS Rating 80 or higher, better 85-95, and only the top 1-2 stocks in the top groups. "
              "The leading stock leads because institutions are buying it. The laggard lags for a reason. "
              "The firm's screener uses the same cut for a leader: RS rank 80 or higher.")
LESSON[19] = ("You buy a stock for a reason: the earnings, the new product, the story. "
              "When that reason changes, the reason to hold it is gone. "
              "O'Neil is willing to sell, even if he still likes the company. "
              "The owner keeps the same open mind: \"I am okay stopping out before a stock moves.\" (Sunday Scans, 2026-06-21)")
LESSON[21] = ("A real breakout keeps going. "
              "When a stock breaks out on heavy volume and then fails to follow through, O'Neil sells. "
              "The bible's Minervini rules put a clock on it. A breakout that stalls in the first 2-3 days is a false signal, so exit quickly. "
              "Watch the next few days after any breakout for that follow-through.")
LESSON[23] = ("Losers teach more than winners. "
              "O'Neil reviews his mistakes more than his successes. "
              "The firm's journal makes that concrete: each trade can carry named mistakes like chasing, early exit, oversized or added to loser. "
              "The owner writes it plainly: \"Whether it be missed trades, oversizing, selling too early, holding too long, under trading or overtrading, "
              "I will consistently learn lessons from the market about myself and make adjustments accordingly.\" (Sunday Scans, 2026-06-21)")

SUPPORT = {1: ["sell1", "own3", "ownstop", "appt"], 2: ["sell2", "sell3", "ownhold"], 3: ["N", "L"],
           4: ["S", "cupvol", "heavy"], 7: ["desk510", "semis"], 13: ["M"], 14: ["ftd", "ownftd"],
           15: ["dd", "wiredd"], 16: ["cup", "vcpentry", "chase"], 5: ["minadd", "ladder", "jmistake"],
           6: [], 8: ["sell7", "rsrank"], 9: ["cup"], 10: ["CA", "own160"], 12: ["L", "I", "volacc"],
           17: ["L", "rsrank"], 19: ["ownstopout"], 21: ["minstall"], 23: ["jmistake", "ownmist"]}
EXTRA_RULES = {3: [11, 22], 2: [18], 6: [20]}


def support(n):
    s = [bl(n)] + [bl(m) for m in EXTRA_RULES.get(n, [])] + [SUP[k] for k in SUPPORT[n]]
    return s


# fill-ins: key verified, lesson is the one-line rule (thin)
fill_reason = {
    1: "Key '7-8%' verified verbatim in rule 1 and SELL RULES 1. Defect: the lesson is the one-line rule; it does not say why, give the worked example, or how the desk differs (the owner's own line is 3%).",
    2: "Key '20-25%' verified in rule 2 and SELL RULES 2 ('take partial profits when up 20-25% from breakout'). Lesson is one line; the question wording ('names a profit rule. What percent?') is loose. Folds in rule 18 (cut as duplicate).",
    3: "Key verified verbatim. Lesson is one line; the sibling rules 11 and 22 say the same thing and are folded in here (both cut as duplicates).",
    4: "Key '40-50%+' verified in rule 4 and CANSLIM S. Lesson is one line; it should also say how this differs from the firm screener's 'heavy volume' (2x average), which members will meet in the screener items.",
    7: "Key '5-7' verified, but the question says 'hold' where the rule says 'buy'. Lesson is one line and does not give the desk's own number (5 to 10 positions, sizing_rule.md §5).",
    14: "Key 'Day 4-7' verified in rule 14 and the FOLLOW-THROUGH DAY RULES. Lesson is one line; the bible's own FTD section answers every follow-up (what counts, which days are stronger, failure, what to buy after).",
    15: "Key '5-6' verified in rule 15 and the DISTRIBUTION DAY RULES. Lesson is one line. Note the glossary's Distribution day item says 4-6 for the same count; the glossary is fixed to drop its number so members are not taught two counts.",
    16: "Key '5-10%' verified in rule 16 and the VCP entry rule. Lesson is one line; it does not define the pivot or say what happens past the zone.",
}
FILL_Q = {
    2: "O'Neil's rule 2: the profit rule takes partial profits at what gain from the breakout?",
    7: "O'Neil's rule 7: don't buy more than how many stocks at once?",
}
for n, fid in FILL.items():
    if n == 13:
        continue
    also = [("reveal_json.support", support(n))]
    if n in FILL_Q:
        put(fid, "fix", "thin_lesson", fill_reason[n], bl(n),
            fx("lesson_text", LESSON[n], ("q", FILL_Q[n]), *also))
    else:
        put(fid, "fix", "thin_lesson", fill_reason[n], bl(n), fx("lesson_text", LESSON[n], *also))

put(FILL[13], "fix", "ambiguous",
    "The rule's wording ('determines 75% of a stock's outcome') contradicts the same bible's CANSLIM M section "
    "('3 out of 4 stocks follow the general market'): following the market is not the same as the market deciding 75% "
    "of the outcome, so the item teaches a misreading under O'Neil's name. Re-key to the M section's own sentence. Lesson is one line.",
    bl(13) + " || " + SUP["M"],
    fx("q", "O'Neil: of every 4 stocks, how many follow the general market?",
       ("answer", {"answer": "3", "accept": ["3 out of 4", "three", "3 of 4", "three out of four", "75%"]}),
       ("lesson_text", LESSON[13]),
       ("reveal_json.support", support(13))))

# non-numeric rules: rewrite the giveaway MCQ as a cloze (em-dash rules) or a fill-in
CLOZE = {
    5: ("Never average down", "add only to winners",
        ["concentration beats diversification", "add only to winners", "losers teach more", "accumulation days > distribution days"]),
    6: ("Never buy on tips or opinions", "let the chart and fundamentals confirm",
        ["add only to winners", "no exceptions, no hope", "let the chart and fundamentals confirm", "losers teach more"]),
    10: ("Earnings growth is the engine", "without it, there is no sustainable move",
         ["add only to winners", "reduce exposure", "concentration beats diversification", "without it, there is no sustainable move"]),
    12: ("Institutions must be buying", "accumulation days > distribution days",
         ["accumulation days > distribution days", "losers teach more", "no exceptions, no hope", "be willing to sell if the story changes"]),
    19: ("Never marry a stock", "be willing to sell if the story changes",
         ["losers teach more", "be willing to sell if the story changes", "concentration beats diversification", "accumulation days > distribution days"]),
    23: ("Study your mistakes more than your successes", "losers teach more",
         ["add only to winners", "reduce exposure", "losers teach more", "without it, there is no sustainable move"]),
}
for n, (head, key, choices) in CLOZE.items():
    assert key in choices
    q = f"Complete O'Neil's rule {n} as the bible quotes it: \"{head}, ...\""
    extra = OWNER_TRADES if n in () else ""
    put(MCQ[n], "fix", "other",
        GIVEAWAY + extra + STEM + " Repair without inventing: a cloze on the rule's own second half, distractors = second halves "
        "of other O'Neil rules from the same block (verbatim, all under 40 chars, none a sensible completion of this rule).",
        bl(n),
        fx("choices", choices, ("q", q), ("answer", {"answer": key}), ("lesson_text", LESSON[n]),
           ("reveal_json.support", support(n))))

FILLQ = {
    8: ("O'Neil's rule 8: the RS line should make new highs before or at the same time as what?", "price",
        ["the price", "price does", "the stock price", "the stock's price"]),
    9: ("O'Neil's rule 9: the best stocks form sound what before major moves?", "base patterns",
        ["bases", "base", "a base", "base pattern", "sound bases", "sound base patterns"]),
    17: ("O'Neil's rule 17: buy the leading stock in the leading what?", "industry group",
         ["group", "industry", "industry groups", "leading industry group", "the leading industry group"]),
    21: ("O'Neil's rule 21: sell when a stock does what after a breakout on heavy volume?", "fails to follow through",
         ["fails to follow-through", "doesn't follow through", "does not follow through", "no follow through",
          "no follow-through", "fails"]),
}
for n, (q, key, acc) in FILLQ.items():
    assert key.lower() in RULE[n].lower(), n
    extra = OWNER_TRADES if n in (9, 17, 21) else ""
    put(MCQ[n], "fix", "other",
        GIVEAWAY + extra + STEM + " The rule has no clean split for a cloze, so repair as a fill-in on its key phrase "
        "(verbatim from the rule), the same shape as the numeric fill-ins.",
        bl(n),
        fx("q", q, ("prompt_json.format", "fill"), ("choices", None),
           ("answer", {"answer": key, "accept": acc}), ("lesson_text", LESSON[n]),
           ("reveal_json.support", support(n))))

# ════════════════════════════════ CONCEPTS ════════════════════════════════════
CV = "app/src/components/chart/engine/ast/conceptVocabulary.json"
VC = {  # concept -> vocab.chart item that covers it on a real chart (built from the same formula)
    "trending": "si_ae2a3d2ee8c2", "in a downtrend": "si_064a19797e7d", "coiled": "si_e5415ebbc514",
    "higher lows": "si_753c1ad054f2", "gapping up": "si_a9966a26e634", "gapping down": "si_c1f6442dfeba",
    "heavy volume": "si_9a5c5f10feeb", "near its highs": "si_1ec086350d8b", "at new highs": "si_c3b163c7d33b",
    "at the 20 ema": "si_a271e3bae058", "shallow pullback": "si_b5364c9f7f61", "deep pullback": "si_95654245f566",
}
CONCEPT_SRC = json.load(open(REPO / CV, encoding="utf-8"))["concepts"]
CODE = ("Choices are raw screener code (e.g. 'close > sma(close, 20) && ...', up to 117 chars), unreadable on a phone "
        "and a test of code literacy, not trading; the lesson is the bare formula.")
for c in CONCEPTS:
    w = c["prompt_json"]["subject"]
    src = f"{CV}#{w}: source \"{CONCEPT_SRC[w]['source']}\""
    if w in VC:
        put(c["id"], "cut", "duplicate",
            f"vocab.chart already teaches '{w}' on real charts with a full lesson, built from this exact screener formula "
            f"(docs/study/terms/chart_words.json, after the owner chose vocabulary/technical terms and asked to review where he "
            f"can see the chart). Key verified. " + CODE, src, None, VC[w])

put("si_cdd726be8fd5", "cut", "duplicate",
    "Near-duplicate of 'leaders pulling back' (si_230c241fbb50): same Classic Flag/Pullback attribution, same idea "
    "(RS 80+, above the 50-day, at the 20 EMA); telling the two screens apart means memorising -3..+1 vs -2..+2 and a "
    "dollar-volume floor, threshold trivia with no trading value. Key verified. " + CODE,
    f"{CV}#pullback to the 20ema: source \"{CONCEPT_SRC['pullback to the 20ema']['source']}\"", None, "si_230c241fbb50")
for cid, w in (("si_4591e299d308", "oversold"), ("si_71d1c74e46b2", "overbought")):
    put(cid, "cut", "unsupported_lesson",
        f"Key verified (preset '{CONCEPT_SRC[w]['grounding'][0]['preset']}'). But the source gives only the number, so no "
        "lesson can answer the obvious follow-up (what the desk does with an overbought or oversold stock) without inventing "
        "it, and for a desk that buys strength an unexplained 'overbought' risks teaching the opposite of the method. The "
        "owner's own writing barely uses the words (voice corpus: 'overbought' 0, 'oversold' 1). Rebuild only if the owner "
        "states how the desk reads RSI. " + CODE,
        f"{CV}#{w}: source \"{CONCEPT_SRC[w]['source']}\"")
for cid, w in (("si_11bef080d60f", "large cap"), ("si_dba4f8a3982e", "mega cap")):
    put(cid, "cut", "trivia",
        f"Key verified (preset '{CONCEPT_SRC[w]['grounding'][0]['preset']}'). A market-cap size label is screener-preset "
        "trivia with no bearing on the method (the owner's writing never uses 'large cap'/'mega cap'); at most a "
        "Foundations fact, not a Method recall item. " + CODE,
        f"{CV}#{w}: source \"{CONCEPT_SRC[w]['source']}\"")

CL = {}
CL["leader"] = ("A leader is a stock that is beating most of the market. "
                "The firm's screener measures it with the RS rank, a 1-99 score. "
                "Each stock's weighted return is ranked against every name the firm covers: 40% three-month, 20% six-month, 20% one-month and 20% one-week. "
                "A rank of 80 means it outperformed 80% of them. "
                "The screener calls 80 or higher a leader, its own preset, not a round number someone picked. "
                "Company size is not part of the test. "
                "The universe is the firm's coverage list, not the whole market.")
CL["leaders pulling back"] = ("This is the firm's shipped Leaders Pullback screen. "
                              "A stock passes when three things are true. RS rank is 80 or higher. Price is above its 50-day average. "
                              "And price is within 2% of its 20-day EMA, above or below. "
                              "In plain words: a strong stock, still in its uptrend, sitting at its short-term average. "
                              "The vocabulary files it under the Classic Flag/Pullback setup. "
                              "The screen finds candidates. The chart still decides if there is a trade.")
CL["tight base"] = ("This is the firm's shipped High-RS tight bases screen. "
                    "Two tests: RS rank 80 or higher, and the recent bars tightly consolidated. "
                    "Tight has a number: the spread of the last ten closes, their coefficient of variation, is under 2.5%. "
                    "In plain words: a leader whose closes are bunched in a narrow band. "
                    "The vocabulary links that tightness to the VCP. "
                    "The owner: \"I love these stocks that consolidate at or around $100 and give us a nice tight base for us to get involved in.\" (Sunday Scans, 2026-05-17)")
CL["liquid"] = ("The firm's screener calls a stock liquid when its 30-day average volume is at least 1 million shares. "
                "That is its own preset, Over 1M. "
                "It is a floor, not a signal: it says the stock trades enough shares, and nothing about direction. "
                "The 20 EMA pullback screen uses a dollar floor instead, $20 million a day over 30 days. "
                "The owner: \"You have to keep the liquid leaders on your list.\" (Sunday Scans, 2026-06-28)")
CL["closing strong"] = ("The screener calls a bar closing strong when the close sits in the top third of the day's range. "
                        "It measures where the close lands between the low, 0, and the high, 1. "
                        "At 0.66 or above, the close is in the top third. "
                        "A close near the high says the stock finished near its best price of the day. "
                        "The opposite preset is the bottom third, 0.33 or below. "
                        "The owner looks for it: \"followed by a nice inside day and strong close where I began buying some shares.\" (Sunday Scans, 2026-05-17)")
CSUP = {
    "leader": [f"{CV}#leader: source \"rs_rank >= 80\", grounding preset \"Over 80\", note \"80 is the firm's own RS-rank preset, not a round number chosen here.\"",
               SUP["rsrank"],
               "api/services/screener/snapshot_builder.py: \"the 40%·3m + 20%·6m + 20%·1m + 20%·1w weighted return ... the same number rs_rank is the universe percentile OF\"",
               "api/services/screener/methodology.py caveat: \"The universe is our own coverage list, not the whole market\""],
    "leaders pulling back": [f"{CV}#leaders pulling back: source \"rs_rank >= 80 && above_50sma && pct_vs_ema20 >= -2 && pct_vs_ema20 <= 2\", starter_screen \"starter_leaders_pullback\", attribution setup \"Classic Flag/Pullback\""],
    "tight base": [f"{CV}#tight base: source \"rs_rank >= 80 && tight_consolidation\", note \"The firm's shipped `High-RS tight bases` screen\"",
                   f"{CV}#coiled note: \"`screener/candles.py` sets it when the ten-close coefficient of variation is under 2.5%\", attribution setup \"VCP\"",
                   "voice_exemplars.json (Sunday Scans 2026-05-17): \"I love these stocks that consolidate at or around $100 and give us a nice tight base for us to get involved in.\""],
    "liquid": [f"{CV}#liquid: source \"avg_volume_30d >= 1000000\", preset \"Over 1M\"",
               f"{CV}#pullback to the 20ema: \"dollar_vol_30d >= 20000000\"",
               "voice_exemplars.json (Sunday Scans 2026-06-28): \"You have to keep the liquid leaders on your list.\""],
    "closing strong": [f"{CV}#closing strong: source \"close_position >= 0.66\", sentence \"the close's position inside the bar's range\", preset \"Top third (>0.66)\"",
                       "api/services/screener/filters.py close_position presets: \"Top third (>0.66)\" / \"Bottom third (<0.33)\"",
                       "close_position scale (position inside the bar's range): 0 = close at the low, 1 = close at the high",
                       "voice_exemplars.json (Sunday Scans 2026-05-17): \"OUST gave a really good opportunity on Monday on the Oops reversal undercut of support at that $24 level, followed by a nice inside day and strong close where I began buying some shares.\""],
}
CCH = {
    "leader": ("RS rank 80 or higher", ["Market cap $200B or more", "RS rank 80 or higher", "Market cap $10B or more", "30-day avg volume of 1M or more"],
               "Distractor 'rs_rank >= 80 && pct_vs_ema20 ...' contains the key as its first clause (confusable). "),
    "leaders pulling back": ("RS 80+, above 50 SMA, within 2% of 20 EMA",
                             ["Pullback of 20% or more", "3+ higher lows in a row", "RS 80+, above 50 SMA, within 2% of 20 EMA", "Close in the top third of the range"], ""),
    "tight base": ("RS rank 80+ and tightly consolidated",
                   ["Opening gap of 3% or more", "RS rank 80+ and tightly consolidated", "Volume at least 2x its average", "30-day avg volume of 1M or more"], ""),
    "liquid": ("30-day avg volume of 1M or more",
               ["30-day avg volume of 1M or more", "Market cap $200B or more", "Market cap $10B or more", "Volume at least 2x its average"],
               "Two distractors are 93- and 117-char multi-clause formulas. "),
    "closing strong": ("Close in the top third of the range",
                       ["3+ higher lows in a row", "Made a new 52-week high", "Market cap $10B or more", "Close in the top third of the range"], ""),
}
for c in CONCEPTS:
    w = c["prompt_json"]["subject"]
    if w not in CCH:
        continue
    key, choices, note = CCH[w]
    assert key in choices
    put(c["id"], "fix", "long_choices",
        f"Key verified against {CV}#{w} ('{CONCEPT_SRC[w]['source']}'). {note}" + CODE +
        " Fix: the same four answers in plain English taken from each concept's own preset label / sentence, and a lesson "
        "built from the vocabulary's notes and the screener's methodology.",
        f"{CV}#{w}: source \"{CONCEPT_SRC[w]['source']}\"",
        fx("choices", choices, ("answer", {"answer": key}), ("lesson_text", CL[w]),
           ("reveal_json.support", CSUP[w])))

# ════════════════════════════════ GLOSSARY ════════════════════════════════════
BR = "docs/curriculum/uct_method_presenter_brief.json#glossary"
CAT = "app/src/pages/modelbook/setupCatalog.js"
PB = "app/src/pages/modelbook/setupPlaybooks.js"
ENG = "C:/Users/pgosz/projects/morning-wire/morning_wire_engine.py calculate_exposure (calibration v2, 2026-08-21)"
MH = "C:/Users/pgosz/projects/uct-intelligence/prompts/05_market_health.txt SECTION 3 (Weinstein)"
VE = "morning-wire/data/voice/voice_exemplars.json"

BRIEF = {g["term"]: g["definition"] for g in json.load(open(REPO / "docs/curriculum/uct_method_presenter_brief.json", encoding="utf-8"))["glossary"]}
FWD, REV, OLD = {}, {}, {}
for it in GLOSSARY:
    s = it["prompt_json"]["subject"]
    if it["prompt_json"]["q"].startswith("At the desk"):
        FWD[s] = it
        OLD[s] = it["answer_json"]["answer"]
    else:
        REV[s] = it

T = {}  # term -> spec


def term(t, code, reason, lesson, sup, new_def=None, label=None, fwd_code=None, rev_code=None, rev_reason=None):
    T[t] = dict(code=code, reason=reason, lesson=lesson, sup=sup, new_def=new_def, label=label,
                fwd_code=fwd_code, rev_code=rev_code, rev_reason=rev_reason)


term("UCT Exposure Rating", "unsupported_key",
     "The brief (AI-written 2026-07-27) says the score is 'computed from breadth, distribution days and index MA structure'; "
     "the engine's calibration v2 (2026-08-21) says breadth no longer moves it: base from QQQ vs its 50/200 SMA, a phase "
     "adjustment and IBD gates. 'The number that grants trading permission' is the brief's permission-band framing (a "
     "FRAMING_TERM). The real fact, in the engine: the score IS the recommended exposure %. 154-char key.",
     "The Exposure Rating is one number from 0 to 150, published with the Morning Wire each morning. "
     "The number is the recommended exposure: the share of your account the firm thinks should be at work. "
     "100 means fully invested. Above 100 is margin territory, and the engine only gets there in a Confirmed Uptrend. "
     "It starts from where QQQ sits against its averages. Above the 50-day it starts at 100. "
     "Below the 50-day but above the 200-day, 40. Below the 200-day, 15. "
     "The market phase then adjusts it, and a few gates cap or floor it.",
     [f"{ENG}: \"Base (QQQ trend state): >50SMA -> 100 | <50SMA but >200SMA -> 40 | <200SMA -> 15 / Phase adj: Confirmed Uptrend +10 (leveraged territory) | Market in Correction -10 / Gates: Restraint cap 65 (pre-B4) | S2 cap 40 | B4 floor 30 | FTD-day floor 40\"",
      f"{ENG}: \"'score': score, # 0-150, IS the recommended exposure %\" / \"ceiling = 150 # 101-150 = margin/leverage territory\"",
      f"{ENG}: \"`breadth` / `risk_apt` / `stockbee` ... no longer move the score.\""],
     new_def="The firm's daily 0-150 score; the number is the recommended exposure %.")

term("Distribution day", "unsupported_key",
     "'A cluster of 4-6 within roughly 25 sessions is treated as the end of an uptrend' matches no firm source: the bible "
     "says 5-6 = under pressure or correction (and O'Neil rule 15, quizzed in recall.bible, says 5-6 = top); the firm's "
     "own wire says 4-5 = Uptrend Under Pressure, 6+ = Market in Correction. Two segments would teach two counts. Re-key "
     "to the bible's definition and leave the count to the bible item and the lesson.",
     "A distribution day is a major index down 0.2% or more on higher volume than the session before. "
     "It signals institutional selling. Count them over a rolling 25 sessions. "
     "A day drops off after 25 sessions, or once the index gains 5% from that day's close. "
     "A day where the index barely gains on heavier volume counts too: that is selling into strength. "
     "The firm's Morning Wire counts them on QQQ. "
     "Four or five turn a confirmed uptrend into Uptrend Under Pressure. Six or more reads Market in Correction.",
     [SUP["dd"], SUP["wiredd"]],
     new_def="A major index down 0.2% or more on higher volume than the prior session.")

term("Follow-through day", "unsupported_key",
     "'Up big' is vaguer than the bible ('1.5%+ on HIGHER volume'), and 're-opens buying at pilot size' is the brief's "
     "progressive-exposure framing, in no firm rule (the bible says buy the 2-3 best setups; the engine floors exposure "
     "at 40). Related, not duplicate: recall.bible si_6aa3c69c58b9 quizzes the same day count under O'Neil's name.",
     "A Follow-Through Day is the signal that a new uptrend has a chance. "
     "After a decline, a major index closes higher: day 1 of a rally attempt. "
     "On day 4 to 7 the index rises 1.5% or more on higher volume than the day before. That is the follow-through. "
     "It means institutional buying has shown up. It is not a guarantee: if the index undercuts the rally low soon after, it failed. "
     "The firm's engine lifts the Exposure Rating to at least 40 on a Follow-Through Day.",
     [SUP["ftd"], f"{ENG}: \"FTD-day floor 40\" / \"if ftd_today: floor = max(floor, 40)\""],
     new_def="Day 4 to 7 of a rally attempt, a major index up 1.5% or more on higher volume.")

term("Stage 2", "framing_term",
     "'The firm's mechanical eight-question Stage-2 gate must pass before a name is tradeable' is the AI-written course's "
     "'gate' framing (curriculum_dossier.md 'The Stage-2 gate'), a rigid rule the owner has not stated; gates are teaching, "
     "never quiz (owner 2026-10-17). The life-cycle half is supported by the firm's market notes.",
     "Stocks move through four stages. Stage 1 is a base: sideways after a decline, with the 30-week average flattening. "
     "Stage 2 is the advance: price above a rising 30-week average, volume expanding on rallies and contracting on pullbacks. "
     "Stage 3 is the top, price swinging around a flattening average. Stage 4 is the decline, price below a falling average. "
     "The firm's market notes call Stage 2 the only stage to be long. "
     "The owner: \"Big stage 1 base and possible uptrend here.\" (Sunday Scans, 2026-06-28)",
     [f"{MH}: \"Stage 1 — Basing ... 30-week moving average ... flattening after trending down\" / \"Stage 2 — Advancing (THE ONLY STAGE TO BE LONG): Price above the 30-week MA, and the 30-week MA is trending UP / Volume expanding on rallies, contracting on pullbacks\" / \"Stage 3 — Distribution/Topping: Price oscillating above and below the 30-week MA\" / \"Stage 4 — Declining: Price below the 30-week MA, and the 30-week MA is trending DOWN\"",
      f"{VE} (Sunday Scans 2026-06-28): \"Big stage 1 base and possible uptrend here.\""],
     new_def="The advancing phase of a stock's four-stage life cycle.")

term("ADR%", "thin_lesson",
     "Key verified: the firm's scanner hard-gates adr_pct < 4% (LOW_ADR, filtered). Lesson is the one-line definition.",
     "ADR% is the average daily range. It is how far a stock travels from high to low on a normal day, as a percent of price. "
     "The firm's scanner averages it over the last 21 bars, and it drops anything under 4%. "
     "The bible's EP rules give the reason: a stock needs enough movement to produce meaningful R-multiples. "
     "Under 3% is too slow for that style. "
     "ADR% says nothing about direction, only how much the stock usually moves.",
     ["uct-intelligence/scripts/scanner_candidates.py _compute_adr: \"Average Daily Range % over last 21 bars\" / \"if adr_pct < 4.0: base['alert_state'] = 'LOW_ADR'\"",
      f"{B} EP: \"ADR% filter: minimum 4-5% average daily range. This ensures the stock has enough movement to generate meaningful R-multiples. Stocks with ADR below 3% are too slow for EP/HTF methodology.\""],
     rev_reason="Key verified. Lesson is one line; the definition also spells out the acronym, which leaks the answer (minor).")

term("RS line", "unsupported_key",
     "'Leadership shows there before it shows in price' overstates the firm's sources: the bible's rule 8 says new highs "
     "'before or at the same time as price'. Re-key to what the line is. Related, not duplicate: recall.bible rule 8.",
     "The RS line is the stock's price divided by SPY, drawn as a line under the chart. "
     "It rises when the stock beats the market and falls when it lags. "
     "The firm's scanner reads its trend over 20 bars: up, flat or down. "
     "O'Neil wants it making new highs before or at the same time as price. "
     "Price at a new high with the RS line lagging is a warning. "
     "The RS line is not the RS rank, the screener's 1-99 score against every stock it covers.",
     [SUP["rsline_scan"], bl(8), SUP["sell7"], SUP["rsrank"]],
     new_def="Relative strength versus SPY plotted as a line; it rises when the stock beats the market.")

term("R / R-multiple", "thin_lesson",
     "Key verified against the brief and consistent with the house sizing rule. Lesson is the one-line definition with no worked example.",
     "R is your unit of risk. 1R is the dollars you lose if the stop hits. "
     "Every result is then priced in R, so a big trade and a small trade can be compared. "
     "Take a $100,000 account risking 1%: 1R is $1,000. With a $2 stop that is 500 shares. "
     "A winner that makes $3,000 is +3R. A loser stopped out as planned is -1R.",
     ["docs/study/corrections/recall.principles.jsonl si_4ecb84ae36ab (owner-requested lesson): \"A $100,000 account at 1% risk with a $2 stop distance is $1,000 / $2 = 500 shares.\"",
      "arithmetic on that example: 3 x $1,000 = $3,000 (+3R); a full stop-out = -1R"],
     rev_code="other",
     rev_reason="The quote shown to the member starts 'One R is ...', so the definition names the answer. Reword the quote "
                "without the term (meaning unchanged). Lesson is one line.")

term("Expectancy", "unsupported_key",
     "'Independent of win rate' contradicts the formula it sits beside (win% is in it); the brief means a low win rate can "
     "still pay, which is a different claim. Re-key without the clause.",
     "Expectancy is what a system makes per trade on average, in R or in percent. "
     "Multiply your win rate by your average win, then subtract your loss rate times your average loss. "
     "A system can lose most of its trades and still pay. "
     "The bible's Martin Luk example: 23% winners averaging +15%, losers averaging -3%. "
     "That is (0.23 × 15) minus (0.77 × 3), about +1.14% per trade. "
     "Win rate alone does not tell you whether a system pays.",
     [f"{B} MARTIN LUK: \"Win rate model: 23% wins ... Average win: +15%. Average loss: -3%. Expectancy: (0.23 × 15) - (0.77 × 3) = 3.45 - 2.31 = +1.14% per trade expectancy. Implication: the MAJORITY of trades are losses, but the occasional 20-50R winner ... overwhelmingly compensates.\""],
     new_def="(win% × average win in R) − (loss% × average loss in R): what a system makes per trade on average.")

term("Account Risk %", "thin_lesson",
     "Key verified against docs/study/sizing_rule.md §1 ('2% is the hard ceiling. Under 1% is normal.') and §3. Lesson is "
     "one line; the owner's standing rule asks for the range, the worked example and the order (stop first).",
     "Account risk is the slice of your account you lose if one trade hits its stop. "
     "It is position size times stop distance: a 20% position with a 5% stop risks 1% of the account. "
     "The desk's range is 0.25% to 2%, chosen by setup quality, your recent trading and the market. "
     "2% is the hard ceiling, and under 1% is normal. "
     "Work it backwards to size a trade: position size equals risk divided by stop distance. "
     "Set the stop first, then the size.",
     ["docs/study/sizing_rule.md §1: \"0.25% to 2% of the account, chosen by setup quality, your recent performance, market conditions and your edge. 2% is the hard ceiling. Under 1% is normal.\"",
      "docs/study/sizing_rule.md §3: \"Position % = risk % ÷ stop distance %.\" / \"Worked: 1% risk, 5% stop → 20% position.\"",
      "docs/study/sizing_rule.md §2: \"stop first, distance second, size last.\""],
     rev_reason="Key verified. Lesson is one line; the quote's 'account risked' leaks the term (minor).")

term("Portfolio heat", "unsupported_key",
     "'Capped at 10% for the whole book' contradicts the owner's ruling of 2026-10-19 (recall.principles): the 10% heat and "
     "40% sector numbers are the tools' guardrails, 'so you see it; you decide', never hard caps.",
     "Heat is what you would lose if every stop in the book hit at once. "
     "For each position take entry minus stop, times shares. Add them up and divide by the account. "
     "Five positions each risking 1% is 5% heat. "
     "The firm's heat tool flags the book at 10%, and any one sector over 40% of the book. "
     "It is a guardrail so you see the number. You decide. "
     "Names in one theme tend to stop out together, so count them as one bet.",
     ["docs/study/corrections/recall.principles.jsonl si_99956e481849 (owner 2026-10-19): \"The tools flag sector concentration at 40% and open risk at 10% of the account so you see it; you decide.\"",
      "same, segment rule: \"numeric caps appear only as the tools' guardrails (40% sector flag, 10% heat)\"",
      SUP["semis"], "arithmetic: 5 positions x 1% = 5% heat"],
     new_def="Total open risk across all positions, Σ (entry − stop) × shares ÷ equity; the firm's tool flags it at 10%.")

term("Episodic Pivot (EP)", "ambiguous",
     "'Trailed on the 10/20-day' disagrees with the firm's own Setup Library playbook ('EPs are meant to be held — trail the "
     "daily 9-EMA'); sizing_rule.md §6 cites the dossier's 10/20-day. Two firm sources, two answers: drop the clause. "
     "'Re-rates' is model wording; the catalog's own line is clearer.",
     "An Episodic Pivot is a neglected stock that gaps up hard on a major catalyst, most often earnings, on massive volume. "
     "It is day one of a new trend. The ideal close is in the top 25% of the day's range. "
     "The Setup Library gives two entries: the opening-range breakout on day one, or a day-two inside bar that breaks the day-one high. "
     "The stop goes under the opening-range low. EPs are meant to be held, trailing the short-term daily averages. "
     "The owner: \"This had an episodic pivot where it gapped up to $50 on earnings day, then advanced from $50 up to $100 in about 10 sessions.\" (Sunday Scans, 2026-05-24)",
     [f"{CAT} Episodic Pivot essence: \"A neglected stock gaps up powerfully on a major catalyst, on massive volume — day one of a sustained new trend.\"",
      f"{PB} Episodic Pivot: \"ideally closing in the top 25% of the range\" / \"Day 1: the earnings-day opening-range breakout ... Day 2+: ... an inside bar that then breaks the Day 1 high\" / \"Below the 30-minute opening-range low (Day 1)\" / \"surfing the short-term daily moving averages\"",
      f"{VE} (Sunday Scans 2026-05-24): \"This had an episodic pivot where it gapped up to $50 on earnings day, then advanced from $50 up to $100 in about 10 sessions.\""],
     new_def="A neglected stock gaps up on a major catalyst on massive volume; day one of a new trend.")

term("Power Earnings Gap (PEG)", "unsupported_key",
     "The brief's definition ('bought on its first controlled pullback into gap support') is the firm catalog's Gap Support "
     "setup, not its Power Earnings Gap ('Blowout numbers gap the stock above its base on huge volume'). Key unsupported by "
     "the firm's own Setup Library, and it blurs PEG into Gap support.",
     "A Power Earnings Gap is a report so strong that the stock gaps above its whole base on huge volume. "
     "The Setup Library reads it as institutions repricing the stock in real time. "
     "It differs from an Episodic Pivot in where it starts. An EP wakes up a neglected stock; a PEG launches from a base already built. "
     "Gap Support is the later setup, the first controlled pullback that tests the gap. "
     "The owner: \"Monster earnings gap up and follow through.\" (Sunday Scans, 2026-05-17)",
     [f"{CAT} Power Earnings Gap essence: \"Blowout numbers gap the stock above its base on huge volume — institutions repricing in real time.\"",
      f"{CAT} Episodic Pivot essence: \"A neglected stock gaps up powerfully on a major catalyst\"",
      f"{CAT} Gap Support essence: \"The first controlled pullback into a prior up-gap\"",
      f"{VE} (Sunday Scans 2026-05-17): \"Monster earnings gap up and follow through.\""],
     new_def="An earnings report so strong the stock gaps above its base on huge volume.")

term("Gap support", "voice",
     "Concept verified against the catalog's Gap Support setup. 'The level the tape remembers' is model prose using a house "
     "word the owner wants out of copy he did not write (VOICE 7b). Lesson is one line.",
     "Gap support is the zone left by a prior gap up. On a pullback, price should hold it. "
     "The Setup Library trades the first controlled pullback into the gap. A candle holds the gap zone, proving it as support. "
     "The entry is over that candle's high. "
     "If price falls back through the gap, the support has failed. "
     "The owner: \"Maybe one more contraction to the gap support at $62.50 or some build under $70, either way nice to see these software stocks gap up and hold.\" (Sunday Scans, 2026-05-17)",
     [f"{CAT} Gap Support essence: \"The first controlled pullback into a prior up-gap — a candle holds the gap zone, proving it as support; entry over its high.\"",
      f"{VE} (Sunday Scans 2026-05-17): \"Maybe one more contraction to the gap support at $62.50 or some build under $70, either way nice to see these software stocks gap up and hold.\""],
     new_def="The prior up-gap zone that price must defend on a pullback.")

term("High Volume Edge (HVC)", "unsupported_key",
     "The label mixes two names: the owner writes 'The HVC (High Volume Close)' (Sunday Scans 2026-05-31) and the catalog "
     "names the setup 'High Volume Edge'; 'Edge' does not expand to HVC. 'Taught with gap support as one principle' is a note "
     "about the AI-written course, not a definition. Relabel to the owner's own words and drop the course note.",
     "HVC is the high volume close: the close of the day with the most volume in the lookback. "
     "That close becomes a line the stock should hold. "
     "The Setup Library calls the setup High Volume Edge. A surge on the highest volume closes strong, and that close becomes the pivot to defend. "
     "On the firm's charts the 52-week volume high is drawn in gold. "
     "The owner: \"Doing nothing wrong above the HVC at $85.\" (Sunday Scans, 2026-05-24)",
     [f"{VE} (Sunday Scans 2026-05-31): \"The HVC (High Volume Close) from the day the govt announced investments is at $14.70 and I will be tracking that spot.\"",
      f"{CAT} High Volume Edge essence: \"A surge on the highest volume in the lookback, closing strong — that day's close becomes the pivot price must defend.\"",
      "CLAUDE.md Charts: \"HVC gold volume bars (52W volume high detection ...)\"",
      f"{VE} (Sunday Scans 2026-05-24): \"Doing nothing wrong above the HVC at $85.\""],
     new_def="The highest-volume day's close becomes the line the stock must hold.",
     label="HVC (High Volume Close)")

term("U&R (Undercut & Rally)", "thin_lesson",
     "Key verified against the catalog ('Price briefly undercuts a prominent prior low ... then reclaims it'). Lesson is one "
     "line and does not separate it from its near neighbours (Remount, 2B), whose brief definitions read almost the same.",
     "An Undercut & Rally is a shakeout you buy. "
     "Price dips just under a prominent prior low, stops out the weak holders and lures in shorts, then reclaims the low. "
     "The reclaim is the signal. "
     "It differs from a Remount, which reclaims a moving average, and from a 2B, a failed break of any prior extreme. "
     "The owner: \"This MXL from the day three undercut of earnings day low at $50 has gone on to double and is now flagging, showing relative strength into the 9EMA.\" (Sunday Scans, 2026-05-17)",
     [f"{CAT} U&R essence: \"Price briefly undercuts a prominent prior low — stopping out weak holders, luring shorts — then reclaims it.\"",
      f"{CAT} Remount essence: \"A leader slips below its moving average, shakes out weak hands, then remounts it with authority.\"",
      f"{CAT} 2B Reversal essence: \"Price breaks a prior extreme, fails to follow through, and snaps back\"",
      f"{VE} (Sunday Scans 2026-05-17): \"This MXL from the day three undercut of earnings day low at $50 has gone on to double and is now flagging, showing relative strength into the 9EMA.\""],
     rev_reason="Key verified. Lesson is one line; 'undercuts' in the quote leaks the term (minor).")

term("Remount", "ambiguous",
     "'A shakeout below a key line followed by retaking it' reads the same as the U&R definition; a member cannot tell them "
     "apart. The catalog's line names the line: a moving average.",
     "A Remount is a leader that slips below a moving average and shakes out the weak hands. Then it gets back above with authority. "
     "The line can be any of the house averages: the 9, 20, 50 or 200. "
     "In the 20 EMA Pullback setup, the remount of the 9 EMA is the buy. "
     "It differs from an Undercut & Rally, which reclaims a prior low rather than an average. "
     "The owner: \"All it did was work into the 20EMA and then remount.\" (Sunday Scans, 2026-07-12)",
     [f"{CAT} Remount essence: \"A leader slips below its moving average, shakes out weak hands, then remounts it with authority.\"",
      f"{CAT} 20 EMA Pullback essence: \"a candle holds it, and the remount of the 9 EMA is the buy.\"",
      f"{VE} (Sunday Scans 2026-07-12): \"All it did was work into the 20EMA and then remount.\" / \"Nice hammer and 3 day bounce off the 50SMA to remount.\" / \"The 200SMA remount was attractive out of this mini base\"",
      "house moving averages 9/20/50/200 (spec C20 / dossier CORRECTIONS)"],
     new_def="A leader slips below its moving average, shakes out, then retakes it with authority.")

term("Slingshot", "thin_lesson",
     "Key verified against the catalog. Lesson is one line. No firm source gives the stop or the context, so the fixed "
     "lesson stops at what the catalog says; the owner should add the follow-ups (owner corpus: 0 uses of the word).",
     "A Slingshot starts with a strong uptrend that pulls back and settles. "
     "The trigger is price recapturing a 4-period EMA drawn on the highs, not on the closes. "
     "You are buying momentum resuming, not trying to catch the low of the pullback.",
     [f"{CAT} Slingshot essence: \"A strong uptrend pulls back, stabilizes, then recaptures the 4-EMA of the highs — buy momentum resuming, not the low.\""])

term("2B Reversal / Oops", "thin_lesson",
     "Key verified against the catalog's 2B Reversal and Oops Reversal entries. Lesson is one line.",
     "A 2B is a failed break. Price pushes past a prior high or low, cannot follow through, and snaps back inside, trapping the late entries. "
     "A 2B works in either direction. "
     "An Oops is the same trap arriving on a gap. The stock gaps below the prior day's low, then reverses and closes the gap. "
     "Larry Williams named it. "
     "The owner: \"OUST gave a really good opportunity on Monday on the Oops reversal undercut of support at that $24 level, followed by a nice inside day and strong close where I began buying some shares.\" (Sunday Scans, 2026-05-17)",
     [f"{CAT} 2B Reversal (direction 'both'): \"Price breaks a prior extreme, fails to follow through, and snaps back — trapping the late entries.\"",
      f"{CAT} Oops Reversal: \"A gap below the prior day's low that reverses and closes the gap — the classic Larry Williams trap for panicked sellers.\"",
      f"{VE} (Sunday Scans 2026-05-17): \"OUST gave a really good opportunity on Monday on the Oops reversal undercut of support at that $24 level, followed by a nice inside day and strong close where I began buying some shares.\""])

term("Go Signal", "thin_lesson",
     "Key verified against the catalog (which adds 'closes above the catalyst high'). Lesson is one line.",
     "A Go Signal follows a catalyst gap. The stock digests the gap and pulls back into the 9 EMA. "
     "Then one wide candle engulfs the pullback and closes above the catalyst day's high. "
     "That close is the resumption trigger. "
     "It differs from Gap Support, which buys a hold of the gap zone itself. And from a Kicker, where the gap day is the signal.",
     [f"{CAT} Go Signal essence: \"A catalyst gap digests into the 9 EMA — then one wide candle engulfs the pullback and closes above the catalyst high.\"",
      f"{CAT} Gap Support / Kicker Candle essences"])

term("Launchpad", "unsupported_key",
     "'(9>20>50>200)' is not the firm's Launchpad: the Setup Library playbook bunches the 8-EMA, 21-EMA, 30-SMA and 50-SMA "
     "into a tight bundle, after a bear market or correction. Re-key to the catalog/playbook wording and keep MA periods out "
     "of the key (spec C20 MA drift).",
     "A Launchpad forms after a momentum burst or a correction. "
     "The moving averages bunch into a tight bundle, stacked in order, and price consolidates on top of them. "
     "The tight bundle is the tell: it often comes before a strong move. "
     "The entry is the break of the consolidation. The stop goes under the consolidation low or the moving-average stack. "
     "The Setup Library's named mistake is forcing it before the averages have actually converged. "
     "The owner: \"I like the potential launchpad setting up here with all the MAs stacked.\" (Sunday Scans, 2026-07-12)",
     [f"{CAT} Launchpad essence: \"A momentum burst, then a pullback that consolidates on top of a stacked cluster of moving averages — and launches.\"",
      f"{PB} Launchpad: \"The consolidation that follows a bear market or correction, when multiple moving averages converge into a tight bundle ... frequently precedes a strong, directional move\" / \"The 8-EMA, 21-EMA, 30-SMA and 50-SMA bunched closely together and stacked in order\" / \"Break of the consolidation\" / \"below the consolidation low / the MA stack\" / mistake \"Forcing the trade before the moving averages have actually converged.\"",
      f"{VE} (Sunday Scans 2026-07-12): \"I like the potential launchpad setting up here with all the MAs stacked.\""],
     new_def="A tight consolidation sitting on a stacked bundle of moving averages, before it launches.")

term("Wedge Pop / Wedge Drop", "model_jargon",
     "'One descending-coil skeleton with two resolutions' is model jargon, and it is wrong for the Drop: the firm's Wedge Drop "
     "playbook is a RISING wedge after a top, under the averages, that drops out the bottom. Re-key from the two playbooks.",
     "A Wedge Pop comes after a decline ends. Price coils into a tightening wedge, often under the 9 and 20 EMAs, as volume dries up. "
     "The pop is a strong candle that breaks out of the wedge and reclaims the averages, starting an up-cycle. "
     "A Wedge Drop is the mirror after a top: a rising wedge under the averages, then a drop that loses them. "
     "The stop sits on the far side of the wedge. "
     "The owner: \"This was a very aggressive wedge pop in the indexes and really more like a failed breakdown for the most part.\" (Sunday Scans, 2026-04-12)",
     [f"{PB} Wedge Pop: \"coils into a wedge — often beneath the moving averages — and then pops out the top, reclaiming the averages and confirming a new up-cycle\" / \"frequently still below the 9/20-EMA. Volume dries up\" / stop \"Below the wedge / consolidation low.\"",
      f"{PB} Wedge Drop: \"bounces and coils into a rising wedge — often back up to the underside of the moving averages — and then drops out the bottom, losing the averages\" / stop \"Above the wedge / consolidation high.\"",
      f"{VE} (Sunday Scans 2026-04-12): \"This was a very aggressive wedge pop in the indexes and really more like a failed breakdown for the most part.\""],
     new_def="A wedge under the averages that resolves: the pop reclaims them, the drop loses them.")

term("Kicker candle", "ambiguous",
     "'The trap that closes above the prior day's high' leaves out the weak prior close and the catalyst gap, so it also "
     "describes any strong up day; 'flipping the short-term control' is model wording. The catalog's line is exact.",
     "A Kicker Candle starts with a weak close that makes the chart look broken. "
     "Then a catalyst gaps the stock up, and it closes above that weak day's high. "
     "Everyone who sold or shorted the weak close is trapped. "
     "In one day, control has flipped to the buyers.",
     [f"{CAT} Kicker Candle essence: \"The prior day closes weak, looking broken — then a catalyst gaps it up to close above that day's high, trapping shorts.\""],
     new_def="A weak close, then a catalyst gap up that closes above that day's high, trapping shorts.")

term("Morning Wire", "unsupported_key",
     "'The five-number scorecard' exists only in the AI-written course docs (curriculum_final_v2.json etc.), not in the "
     "product; 'regime read' is a word the owner bans in AI-written copy. Keep the supported half.",
     "The Morning Wire is the firm's daily brief, out around 7:35 AM ET before the open. "
     "It carries the Exposure Rating and the market phase, the UCT 20 leadership list and the day's earnings. "
     "It also lists the top picks with entry, stop and target. "
     "Read it before you place a trade: it tells you how much to have on and which names lead.",
     ["CLAUDE.md Data Pipeline: \"Windows Task Scheduler: runs daily at 7:35 AM ET (Mon–Fri)\"; Data Sources: \"Leadership 20 | ... Daily (7:35 AM ET) · Morning Rundown · UCT Exposure Rating · Earnings\"",
      "CLAUDE.md Top 5 Picks: \"Fields ... Entry Type, Entry, Stop, Target, Invalidation\""],
     new_def="The firm's daily pre-market brief, out around 7:35 AM ET.")

term("Sunday Scans", "thin_lesson",
     "Key supported (VOICE.md: 61 Sunday Scans posts are the owner's own writing; Desk show). Lesson is one line.",
     "Sunday Scans is the owner's weekend write-up and Desk show. "
     "He walks through the week's best charts name by name. What each did, where it is getting tight, what he wants to see next. "
     "Use it to build your list for the week. "
     "The owner: \"Focus on the strongest names that are building out higher lows and getting tight.\" (Sunday Scans, 2026-06-14)",
     ["docs/study/VOICE.md: \"mined from 88 Substack posts: 27 articles, 61 Sunday Scans\"",
      "CLAUDE.md The Desk: Sunday Scans uploads public",
      f"{VE} (Sunday Scans 2026-06-14): \"Focus on the strongest names that are building out higher lows and getting tight.\""],
     rev_reason="Key supported. Lesson is one line; 'weekend scan publication' leaks the term (minor).")

term("UCT 20", "thin_lesson",
     "Key supported (CLAUDE.md UCT 20: ranked Leadership 20 rebuilt by the daily wire run). Lesson is one line.",
     "The UCT 20 is the firm's ranked list of twenty leading stocks, rebuilt each morning when the wire engine runs. "
     "Each name carries its setup, catalyst and a trade plan with entry, stop and target. "
     "A tracker follows the list as an equal-weight portfolio. A name is bought at the open when it joins and sold at the open when it leaves. "
     "Use it as a starting list of leaders, then judge each chart yourself.",
     ["CLAUDE.md UCT 20: \"Ranked list of Leadership 20 stocks from /api/leadership\" / \"Expanded row: company desc · catalyst · price action · trade bar (entry/stop/target)\"",
      "CLAUDE.md UCT20 Portfolio Tracker: \"buys/sells at market open\" / \"equal-weight NAV\""],
     rev_reason="Key supported. Lesson is one line; 'twenty names' leaks the term (minor).")

term("Model Book", "unsupported_key",
     "'The source for the Winners Gallery' exists only in the AI-written course docs, not the product. Keep the supported half (CLAUDE.md Model Book).",
     "The Model Book is the firm's library of the best stocks in history, year by year. "
     "Open a stock and its chart shows the setups the firm labeled on it. Each has entry, stop and target lines, a grade and notes. "
     "A second tab shows the catalysts behind the big up moves. "
     "Study it to see what big winners looked like before they ran. "
     "The owner: \"Build a playbook, modelbook, rules, and process.\" (Sunday Scans, 2026-06-14)",
     ["CLAUDE.md Model Book: \"a curated library of the best stocks in history, organized by year, where clicking a stock opens its chart with the firm's playbook setups labeled on it (markers + entry/stop/target price lines + grade + teaching notes)\" / Catalysts tab",
      f"{VE} (Sunday Scans 2026-06-14): \"Build a playbook, modelbook, rules, and process.\""],
     new_def="The firm's library of history's best stocks by year, with setups labeled on each chart.")

# Compass: cut both directions
CUT_TERMS = {"Compass"}
NEWDEF = {t: (T[t]["new_def"] or OLD[t]) for t in T}
LABEL = {t: (T[t]["label"] or t) for t in T}
ORDER = [g for g in BRIEF if g in FWD]
for t in FWD:
    assert t in T or t in CUT_TERMS, t


def map_fwd_choices(subject):
    it = FWD[subject]
    old_to_term = {OLD[t]: t for t in OLD}
    present = [old_to_term[c] for c in it["prompt_json"]["choices"]]
    out = []
    for t in present:
        if t in CUT_TERMS:
            rep = next(x for x in ORDER if x not in present and x not in CUT_TERMS and x != subject
                       and NEWDEF.get(x) not in out)
            out.append(NEWDEF[rep])
        else:
            out.append(NEWDEF[t])
    changed = out != it["prompt_json"]["choices"]
    return out, changed


for t in ORDER:
    f, r = FWD[t], REV[t]
    if t in CUT_TERMS:
        why = ("Cut both directions. 'Pre-grades the capstone trade plan before the owner's review' describes the AI-written "
               "course (capstone / playbook defense are framing terms), not the product; what remains ('the Journal's AI coach') "
               "is a product-feature name with no trading value and is not one of the owner's house words. Remove its definition "
               "from the distractor pool too (it is a distractor in si_1718caca9bbc).")
        put(f["id"], "cut", "unsupported_key", why, f"{BR}#Compass: \"{BRIEF['Compass']}\"")
        put(r["id"], "cut", "unsupported_key", why, f"{BR}#Compass: \"{BRIEF['Compass']}\"")
        continue
    s = T[t]
    sl = f"{BR}#{t}: \"{BRIEF[t]}\""
    sup = s["sup"]
    choices, changed = map_fwd_choices(t)
    stale = [OLD[x] for x in OLD if OLD[x] in f["prompt_json"]["choices"] and x != t and (x in CUT_TERMS or (T.get(x) or {}).get("new_def"))]
    stale_note = (" Also: distractor definitions here carry text fixed or cut elsewhere in this audit; the choices are "
                  "re-drawn with the corrected definitions." if changed else "")
    # forward
    if s["new_def"]:
        also = [("choices", choices), ("lesson_text", s["lesson"]), ("reveal_json.support", sup)]
        if s["label"]:
            also.insert(0, ("q", f"At the desk, what does \"{s['label']}\" mean?"))
        put(f["id"], "fix", s["fwd_code"] or s["code"], s["reason"] + stale_note, sl,
            fx("answer", {"answer": s["new_def"]}, *also))
    else:
        also = [("reveal_json.support", sup)]
        if changed:
            also.insert(0, ("choices", choices))
        put(f["id"], "fix", s["fwd_code"] or s["code"], s["reason"] + stale_note, sl,
            fx("lesson_text", s["lesson"], *also))
    # reverse
    rchoices = [LABEL.get(c, c) for c in r["prompt_json"]["choices"]]
    rchanged = rchoices != r["prompt_json"]["choices"]
    rreason = s["rev_reason"] or s["reason"]
    if t == "R / R-multiple":
        newq = ("The dollars you planned to lose if the stop hits. Every result is priced in this unit, so trades "
                "of different sizes compare.")
        put(r["id"], "fix", s["rev_code"], rreason, sl,
            fx("prompt.quote", newq, ("lesson_text", s["lesson"]), ("reveal_json.support", sup)))
    elif s["new_def"]:
        also = [("lesson_text", s["lesson"]), ("reveal_json.support", sup)]
        if rchanged:
            also = [("choices", rchoices), ("answer", {"answer": LABEL[t]})] + also
        put(r["id"], "fix", s["rev_code"] or s["code"], rreason, sl, fx("prompt.quote", s["new_def"], *also))
    else:
        also = [("reveal_json.support", sup)]
        if rchanged:
            also.insert(0, ("choices", rchoices))
        put(r["id"], "fix", s["rev_code"] or s["code"], rreason, sl, fx("lesson_text", s["lesson"], *also))

# HVC label also appears as a distractor in other reverse items: handled above via LABEL mapping when that
# item is fixed; assert every reverse item that shows the old label got a choices fix.
for t, r in REV.items():
    if "High Volume Edge (HVC)" in r["prompt_json"]["choices"] and t not in CUT_TERMS:
        fixd = V[r["id"]]["fix"]
        flat = [fixd] + (fixd.get("also") or [])
        assert any(x["field"] == "choices" for x in flat), r["id"]

# ═══════════════════════════════ VALIDATION ═══════════════════════════════════
problems = []
seg_of = {}
for i in BIBLE:
    seg_of[i["id"]] = "recall.bible"
for i in CONCEPTS:
    seg_of[i["id"]] = "recall.concepts"
for i in GLOSSARY:
    seg_of[i["id"]] = "recall.glossary"

missing = [i for i in BY_ID if i not in V]
if missing:
    problems.append(f"missing verdicts: {missing}")

for iid, v in V.items():
    if v["verdict"] not in ("keep", "fix", "cut"):
        problems.append(f"{iid}: bad verdict")
    if v["verdict"] == "fix" and not v["fix"]:
        problems.append(f"{iid}: fix without fix")
    if v["duplicate_of"] and v["duplicate_of"] in V and V[v["duplicate_of"]]["verdict"] == "cut":
        problems.append(f"{iid}: duplicate_of points at a cut item {v['duplicate_of']}")
    if not v["fix"]:
        continue
    item = json.loads(json.dumps(BY_ID[iid]))
    flat = [v["fix"]] + (v["fix"].get("also") or [])
    for e in flat:
        fld, aft = e["field"], e["after"]
        if fld == "q":
            item["prompt_json"]["q"] = aft
        elif fld == "choices":
            if aft is None:
                item["prompt_json"].pop("choices", None)
            else:
                item["prompt_json"]["choices"] = aft
        elif fld == "answer":
            item["answer_json"] = aft if isinstance(aft, dict) else {"answer": aft}
        elif fld == "lesson_text":
            item["lesson_text"] = aft
        elif fld == "prompt.quote":
            item["prompt_json"]["quote"] = aft
        elif fld == "prompt_json.format":
            item["prompt_json"]["format"] = aft
        elif fld == "reveal_json.support":
            item["reveal_json"]["support"] = aft
        else:
            problems.append(f"{iid}: unknown field {fld}")
    ch = item["prompt_json"].get("choices")
    ans = item["answer_json"]["answer"]
    if ch is not None:
        if ans not in ch:
            problems.append(f"{iid}: answer not in choices")
        if len(set(ch)) != len(ch):
            problems.append(f"{iid}: duplicate choices")
    for prob in si.voice_check(si.question_text(item), question=True):
        problems.append(f"{iid}: question voice: {prob}")
    for fld, text in si.lesson_texts(item):
        for prob in si.voice_check(text, lesson=True):
            problems.append(f"{iid}: {fld} voice: {prob}")
        for w in ("tape", "regime", " dial", "the loop"):
            if w in text.lower():
                problems.append(f"{iid}: {fld} uses '{w.strip()}'")
    for tok in si.grounding_check(item):
        problems.append(f"{iid}: ungrounded {tok}")
    q = item["prompt_json"].get("quote")
    if isinstance(q, str):
        for prob in si.voice_check(q):
            problems.append(f"{iid}: quote voice: {prob}")
    if isinstance(ch, list):
        for c in ch:
            for prob in si.voice_check(c):
                problems.append(f"{iid}: choice voice: {prob}")

import re as _re
long_sent = []
for iid, v in V.items():
    if not v["fix"]:
        continue
    for e in [v["fix"]] + (v["fix"].get("also") or []):
        if e["field"] in ("lesson_text", "q", "prompt.quote") and isinstance(e["after"], str):
            own = _re.sub(r'"[^"]*"', '"Q"', e["after"])  # owner / source quotes are exempt
            for s in _re.split(r"(?<=[.!?])\s+", own):
                if len(s.split()) > 22:
                    long_sent.append((iid, e["field"], len(s.split()), s))
for x in long_sent:
    print("LONG", x)

if problems:
    print("PROBLEMS:")
    for p in problems:
        print("  ", p)
    raise SystemExit(1)

lines = []
for seg, items in (("recall.bible", BIBLE), ("recall.concepts", CONCEPTS), ("recall.glossary", GLOSSARY)):
    for it in items:
        v = V[it["id"]]
        lines.append(json.dumps({"item_id": it["id"], "segment": seg, "skill_id": it["skill_id"],
                                 "verdict": v["verdict"], "code": v["code"], "reason": v["reason"],
                                 "source_line": v["source_line"], "fix": v["fix"],
                                 "duplicate_of": v["duplicate_of"]}, ensure_ascii=False))
(OUT / "auditA_verdicts.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
from collections import Counter
c = Counter((seg_of[i], V[i]["verdict"]) for i in V)
codes = Counter((seg_of[i], V[i]["code"]) for i in V)
print("in scope:", len(BY_ID), "written:", len(lines))
for k in sorted(c):
    print(k, c[k])
for k in sorted(codes):
    print("code", k, codes[k])
