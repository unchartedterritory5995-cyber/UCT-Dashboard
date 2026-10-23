"""auditC: build per-item verdicts for spot.fixtures, family.fixtures, vocab.chart, walk.method.
Read-only on the repo. Writes auditC_verdicts.jsonl + auditC_verdicts_debug.json in the scratchpad."""
import collections, json, os, re, sys
from datetime import date

REPO = r"C:\Users\pgosz\uct-worktrees\study-import"
OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, REPO)
from api.services import study_import as SI  # noqa: E402

def load(seg):
    return json.load(open(f"{REPO}/docs/study/bank/{seg}.json", encoding="utf-8"))

FXV = json.load(open(os.path.join(OUT, "auditC_fx_verify.json"), encoding="utf-8"))
verdicts = []

def V(it, seg, verdict, code, reason, checked, fix=None, dup=None):
    verdicts.append({"item_id": it["id"], "segment": seg, "skill_id": it["skill_id"], "verdict": verdict,
                     "code": code, "reason": reason, "checked": checked, "fix": fix, "duplicate_of": dup})

# ════════════════════════════════════════════════════════════════════════════
# SPOT + FAMILY (fixtures)
# ════════════════════════════════════════════════════════════════════════════
NAME = {"uct_kicker": "Kicker Candle", "uct_hve": "High Volume Edge", "uct_gap_support": "Gap Support",
        "uct_go_signal": "Go Signal", "uct_launch_pad": "Launchpad", "uct_oops_reversal": "Oops Reversal",
        "uct_slingshot": "Slingshot", "uct_capitulation": "Capitulation"}
CARD = {
    "uct_kicker": "setupCatalog.js Kicker Candle card: 'The prior day closes weak, looking broken, then a catalyst gaps it up to close above that day's high, trapping shorts.'",
    "uct_oops_reversal": "setupCatalog.js Oops Reversal card: 'A gap below the prior day's low that reverses and closes the gap, the classic Larry Williams trap.'",
    "uct_hve": "setupCatalog.js High Volume Edge card (direction long): 'A surge on the highest volume in the lookback, closing strong; that day's close becomes the pivot price must defend.'",
    "uct_gap_support": "setupCatalog.js Gap Support card: 'The first controlled pullback into a prior up-gap; a candle holds the gap zone, proving it as support.'",
    "uct_slingshot": "setupCatalog.js Slingshot card: 'A strong uptrend pulls back, stabilizes, then recaptures the 4-EMA of the highs.'",
    "uct_launch_pad": "setupCatalog.js Launchpad card: 'A momentum burst, then a pullback that consolidates on top of a stacked cluster of moving averages (9/20/50/200), and launches.'",
    "uct_go_signal": "setupCatalog.js Go Signal card: 'A catalyst gap digests into the 9 EMA, then one wide candle engulfs the pullback and closes above the catalyst high.'",
}
INTERNAL = {"uct_launch_pad", "uct_gap_support", "uct_capitulation", "uct_go_signal"}

# per detector: fixture basename -> (verdict, code, note, dup_basename)
K, C_DUP, C_AT, C_UNS, C_OTH = "keep", "duplicate", "also_true_distractor", "unsupported", "other"
D = {}
def put(det, base, verdict, code, note="", dup=None):
    D[(det, base)] = (verdict, code, note, dup)

# ── capitulation ──
for b in ("pos_4_INTC_20240802", "pos_6_COIN_20260205", "pos_5_MU_20250404", "neg_no_cascade_GOOGL_20260723",
          "neg_not_below_band_by_1atr_MSFT_20250407", "neg_quiet_session_AAPL_20230302"):
    put("uct_capitulation", b, "fix", "thin_lesson")
put("uct_capitulation", "pos_1_AAPL_20230804", "cut", C_DUP, "3-star flush only 1.5 ATR under the 50-day, the weakest of the six; cap is three positives (kept the 5-star INTC, 5-star COIN, 4-star MU)", "pos_4_INTC_20240802")
put("uct_capitulation", "pos_2_AMZN_20260206", "cut", C_DUP, "a sound 4-star flush but beyond the cap of three positives; one session from the kept COIN 2026-02-05 example (same selloff)", "pos_4_INTC_20240802")
put("uct_capitulation", "pos_3_NFLX_20240422", "cut", C_OTH, "fires only through the gap_below variant on a 0-of-5-star day: the session opened under the 2024-04-19 flush low, and that flush counts only because the cascade is borrowed from today. The sibling negative neg_no_cascade_NFLX_20240419 tells the member the same 04-19 flush does NOT count (out of nowhere). Shown together they contradict each other; the weakest positive in the set")
put("uct_capitulation", "neg_no_cascade_NFLX_20240419", "cut", C_DUP, "same near-miss reason as the kept GOOGL 2026-07-23 (verbatim same note); also the 04-19 half of the contradictory NFLX pair", "neg_no_cascade_GOOGL_20260723")
put("uct_capitulation", "neg_not_below_band_by_1atr_META_20240717", "cut", C_DUP, "same near-miss reason and note as the kept MSFT 2025-04-07", "neg_not_below_band_by_1atr_MSFT_20250407")
for b in ("neg_quiet_session_AMZN_20230302", "neg_quiet_session_MSFT_20230302", "neg_quiet_session_NVDA_20230302"):
    put("uct_capitulation", b, "cut", C_DUP, "fourth copy of the same 'ordinary session' negative on the same date (2023-03-02); cap is one quiet session per setup", "neg_quiet_session_AAPL_20230302")
# ── gap support ──
for b in ("pos_4_AMZN_20221118", "pos_5_META_20230224", "neg_gap_filled_MSFT_20231030", "neg_no_touch_AAPL_20240507",
          "neg_open_only_touch_NVDA_20260909", "neg_small_gap_MSFT_20230217", "neg_quiet_session_AAPL_20221011"):
    put("uct_gap_support", b, "fix", "thin_lesson")
for b, g in (("pos_1_AAPL_20240508", "7.9% gap, 3 sessions back"), ("pos_2_MSFT_20250804", "8.2% gap, 2 sessions back"),
             ("pos_3_NVDA_20230302", "12.9% gap, 5 sessions back"), ("pos_6_GOOGL_20230207", "5.3% gap, 3 sessions back")):
    put("uct_gap_support", b, "cut", C_AT, f"the detector's own extras say first_test=False ({g}): the gap had already been tested. The firm's card defines Gap Support as the FIRST controlled pullback into the gap, so 'No' is also defensible. Only AMZN 2022-11-18 and META 2023-02-24 are first tests")
put("uct_gap_support", "neg_gap_filled_NVDA_20230601", "cut", C_DUP, "same reason as the kept MSFT 2023-10-30; also five sessions from the kept HVE positive NVDA 2023-05-25 (near-identical chart)", "neg_gap_filled_MSFT_20231030")
put("uct_gap_support", "neg_no_touch_MSFT_20230524", "cut", C_DUP, "same reason and note as the kept AAPL 2024-05-07", "neg_no_touch_AAPL_20240507")
put("uct_gap_support", "neg_open_only_touch_AMZN_20221117", "cut", C_DUP, "same reason as the kept NVDA 2026-09-09, and one session before the kept AMZN 2022-11-18 positive: the two charts are nearly identical with opposite answers", "neg_open_only_touch_NVDA_20260909")
put("uct_gap_support", "neg_small_gap_AAPL_20220829", "cut", C_DUP, "same reason as the kept MSFT 2023-02-17", "neg_small_gap_MSFT_20230217")
for b in ("neg_quiet_session_AMZN_20221011", "neg_quiet_session_MSFT_20221011", "neg_quiet_session_NVDA_20221011"):
    put("uct_gap_support", b, "cut", C_DUP, "same 'ordinary session' negative, same date; the 2022-10-11 charts are also reused as quiet negatives by Kicker, Go Signal, Slingshot and Oops; cap is one per setup on a chart no other kept item uses", "neg_quiet_session_AAPL_20221011")
# ── HVE ──
for b in ("pos_3_NVDA_20230525", "neg_only_26wk_high_AAPL_20250409", "neg_second_highest_AMZN_20240802", "neg_quiet_session_MSFT_20230721"):
    put("uct_hve", b, "fix", "thin_lesson")
for b, txt in (("pos_1_AAPL_20240229", "down close (-0.4%), detector direction bearish: 'that close is now a resistance level'"),
               ("pos_2_MSFT_20241220", "down close (-0.1%), detector direction bearish (resistance)"),
               ("pos_5_META_20251030", "down close (-11.3% gap down), detector direction bearish (resistance)"),
               ("pos_6_GOOGL_20250205", "down close (-7.3%), detector direction bearish (resistance)"),
               ("pos_4_AMZN_20251031", "up close but it closed at the very low of its range (close position 0.04 of the day's range) after a 12% gap: it faded all day, the opposite of 'closing strong'")):
    put("uct_hve", b, "cut", C_AT, f"{txt}. The firm's HVE card is a LONG setup 'closing strong', so 'No' is also defensible. The detector fires on any record-volume bar either way")
put("uct_hve", "neg_only_26wk_high_MSFT_20231215", "cut", C_DUP, "same reason and note as the kept AAPL 2025-04-09", "neg_only_26wk_high_AAPL_20250409")
put("uct_hve", "neg_second_highest_MSFT_20240920", "cut", C_DUP, "same reason and note as the kept AMZN 2024-08-02", "neg_second_highest_AMZN_20240802")
for b in ("neg_quiet_session_AAPL_20230721", "neg_quiet_session_AMZN_20230721", "neg_quiet_session_NVDA_20230721"):
    put("uct_hve", b, "cut", C_DUP, "same 'ordinary session' negative, same date; AAPL and NVDA 2023-07-21 are also Oops quiet negatives", "neg_quiet_session_MSFT_20230721")
# ── kicker ──
for b in ("pos_3_NVDA_20220719", "pos_4_AMZN_20220719", "pos_5_META_20220715", "neg_gap_too_small_AAPL_20221122",
          "neg_no_break_of_prior_high_MSFT_20220629", "neg_no_gap_up_AAPL_20221013", "neg_red_prior_closed_high_AAPL_20230227",
          "neg_strong_prior_close_MSFT_20220706", "neg_quiet_session_MSFT_20221011"):
    put("uct_kicker", b, "fix", "thin_lesson")
for b, txt in (("pos_1_AAPL_20220712", "closed 145.86 under the prior high 146.64 (0.6% gap)"),
               ("pos_2_MSFT_20220718", "a red session that closed 254.25, well under the prior high 260.37"),
               ("pos_6_GOOGL_20220718", "a red session that closed 109.03, well under the prior high 113.14")):
    put("uct_kicker", b, "cut", C_AT, f"{txt}. The firm's card (and its course lesson 'the trap that closes above yesterday's high') requires a close above the prior day's high, so 'No' is also defensible. The detector only needs the high to trade through")
put("uct_kicker", "neg_gap_too_small_MSFT_20221121", "cut", C_DUP, "same reason and note as the kept AAPL 2022-11-22", "neg_gap_too_small_AAPL_20221122")
put("uct_kicker", "neg_no_break_of_prior_high_AAPL_20220628", "cut", C_DUP, "same reason as the kept MSFT 2022-06-29; one session after the AAPL 2022-06-27 strong-prior-close chart", "neg_no_break_of_prior_high_MSFT_20220629")
put("uct_kicker", "neg_no_gap_up_MSFT_20220701", "cut", C_DUP, "same reason as the kept AAPL 2022-10-13; MSFT 2022-07-01 is also an Oops negative chart", "neg_no_gap_up_AAPL_20221013")
put("uct_kicker", "neg_red_prior_closed_high_MSFT_20230725", "cut", C_DUP, "same reason and note as the kept AAPL 2023-02-27", "neg_red_prior_closed_high_AAPL_20230227")
put("uct_kicker", "neg_strong_prior_close_AAPL_20220627", "cut", C_DUP, "same reason as the kept MSFT 2022-07-06 (which also closed over the prior high, the sharper contrast)", "neg_strong_prior_close_MSFT_20220706")
for b in ("neg_quiet_session_AAPL_20221011", "neg_quiet_session_AMZN_20221011", "neg_quiet_session_NVDA_20221011"):
    put("uct_kicker", b, "cut", C_DUP, "same 'ordinary session' negative on the same 2022-10-11 charts reused across five setups", "neg_quiet_session_MSFT_20221011")
# ── oops ──
for b in ("pos_1_AAPL_20220809", "pos_3_NVDA_20220705", "pos_5_META_20220713", "neg_closed_back_under_MSFT_20220628",
          "neg_no_undercut_v3_AAPL_20220701", "neg_opened_above_AAPL_20220629", "neg_reclaimed_low_not_close_MSFT_20220630",
          "neg_quiet_session_AMZN_20231207"):
    put("uct_oops_reversal", b, "fix", "thin_lesson")
for b, txt in (("pos_2_MSFT_20220714", "opened 250.57, ABOVE the prior low 248.11"),
               ("pos_4_AMZN_20220629", "opened 107.38, above the prior low 107.04 and only 2 cents under the prior close"),
               ("pos_6_GOOGL_20220705", "opened 107.10, above the prior low 106.73")):
    put("uct_oops_reversal", b, "cut", C_AT, f"{txt}. The firm's card defines the Oops as a gap below the prior day's LOW; this one only opened under the prior close and undercut the low intraday, so 'No' is also defensible")
put("uct_oops_reversal", "neg_closed_back_under_AAPL_20220713", "cut", C_AT, "opened BELOW the prior low and closed back ABOVE the prior low (but under the prior close). By the firm's card ('a gap below the prior day's low that reverses and closes the gap') this IS an Oops, so 'Yes' is also true; the key 'No' rests only on the detector's stricter close-over-prior-close rule")
put("uct_oops_reversal", "neg_no_undercut_v3_MSFT_20220701", "cut", C_DUP, "same reason and note as the kept AAPL 2022-07-01, same date", "neg_no_undercut_v3_AAPL_20220701")
put("uct_oops_reversal", "neg_opened_above_MSFT_20220629", "cut", C_DUP, "same reason as the kept AAPL 2022-06-29; MSFT 2022-06-29 is the kept Kicker no-break chart", "neg_opened_above_AAPL_20220629")
put("uct_oops_reversal", "neg_reclaimed_low_not_close_AAPL_20220630", "cut", C_DUP, "same reason and note as the kept MSFT 2022-06-30", "neg_reclaimed_low_not_close_MSFT_20220630")
for b in ("neg_quiet_session_AAPL_20230721", "neg_quiet_session_MSFT_20221011", "neg_quiet_session_NVDA_20230721"):
    put("uct_oops_reversal", b, "cut", C_DUP, "same 'ordinary session' negative; these charts are reused as quiet negatives by HVE and the 2022-10-11 group", "neg_quiet_session_AMZN_20231207")
# ── slingshot ──
for b in ("pos_4_AMZN_20220810", "neg_below_sma50_AAPL_20220705", "neg_no_strength_day_MSFT_20220720",
          "neg_pullback_too_short_AAPL_20220719", "neg_quiet_session_NVDA_20221011"):
    put("uct_slingshot", b, "fix", "thin_lesson")
for b, txt in (("pos_1_AAPL_20221130", "50-day falling, close under the 100-bar average"),
               ("pos_2_MSFT_20220727", "50-day falling, under the 100-bar average, -11% across the chart window"),
               ("pos_3_NVDA_20220727", "50-day falling, under the 100-bar average, -26% across the chart window"),
               ("pos_5_META_20220810", "50-day falling, under the 100-bar average, -14% across the chart window"),
               ("pos_6_GOOGL_20220727", "50-day falling, under the 100-bar average, -21% across the chart window")):
    put("uct_slingshot", b, "cut", C_AT, f"a 2022 bear-market bounce ({txt}). The firm's card starts 'A strong uptrend pulls back'; the detector only needs a close over the 50-day, so 'No' is also defensible. Only AMZN 2022-08-10 sits above a rising 50-day")
put("uct_slingshot", "neg_below_sma50_MSFT_20220705", "cut", C_DUP, "same reason as the kept AAPL 2022-07-05; one session before the kept Kicker MSFT 2022-07-06 chart", "neg_below_sma50_AAPL_20220705")
put("uct_slingshot", "neg_no_strength_day_AAPL_20220714", "cut", C_DUP, "same reason and note as the kept MSFT 2022-07-20", "neg_no_strength_day_MSFT_20220720")
put("uct_slingshot", "neg_pullback_too_short_MSFT_20220803", "cut", C_DUP, "same reason and note as the kept AAPL 2022-07-19", "neg_pullback_too_short_AAPL_20220719")
for b in ("neg_quiet_session_AAPL_20221011", "neg_quiet_session_AMZN_20221011", "neg_quiet_session_MSFT_20221011"):
    put("uct_slingshot", b, "cut", C_DUP, "same 'ordinary session' negative on the shared 2022-10-11 charts", "neg_quiet_session_NVDA_20221011")

# ── lesson text (proposed fixes) ──
QUIET_NEED = {
    "uct_kicker": "A kicker needs a weak close, then a gap up over it that trades through the prior day's high",
    "uct_oops_reversal": "An Oops needs a weak open below the prior day's low and a close back above the prior close",
    "uct_hve": "A High Volume Edge needs the heaviest volume of the past year",
    "uct_gap_support": "Gap Support needs a pullback into an earlier volume gap that holds",
    "uct_capitulation": "Capitulation needs a cascade of selling, then a close far under the lower band on heavy volume",
    "uct_slingshot": "A slingshot needs a strong stock's first close back over the four-day EMA of its highs after a three-day pause",
}
POS = {
    "uct_kicker": ("Yes, this is a kicker. Look at the last two candles. The day before closed weak, near the low of its range, and looked broken. "
                   "Then the stock opened above that weak close and traded through the prior day's high, so everyone who sold the close was wrong at the open. "
                   "It also closed above that high, which is what the firm's setup card asks for and the proof the trap worked. "
                   "The firm's detector checks three things on the last bar: a weak prior close, a real gap over it (at least a tenth of the prior day's range) and a break of the prior high. "
                   "The entry is the prior day's high, or the open when it gaps over it. The stop goes under the low of the kicker day. "
                   "This is a one-day change of character, not a base breakout and not a bounce off support, so read it on those two candles."),
    "uct_oops_reversal": ("Yes, this is an Oops reversal. The stock opened below the prior day's low, which looks like a breakdown. "
                          "Stops under that low got hit and the sellers who panicked at the open got their fill. "
                          "Then it reversed and closed back above the prior close, so the breakdown failed inside one session. That is the classic Larry Williams trap on the firm's setup card. "
                          "The firm's detector reads it as an open under the prior close, a trade under the prior low and a close back over the prior close. "
                          "The entry is the reclaim of the prior close and the stop goes at the low of the day. "
                          "If the close stays under the prior close, it is not an Oops yet. The reclaim into the close is the whole signal."),
    "uct_hve": ("Yes, this is a High Volume Edge. The last bar traded more shares than any session in the past year on this chart, and it closed far above the prior day. "
                "The firm's detector is simple: the heaviest volume of roughly the last year of sessions. "
                "That close becomes a level. It is where the biggest buyers of the year committed, so price has to defend it on the pullbacks that follow. "
                "The trade comes later: the candle that holds that level, entry over its high, stop under the level. "
                "A record day that closes down is the mirror, and its close becomes resistance instead of support. "
                "Read the volume pane first, then which way the day closed."),
    "uct_gap_support": ("Yes, this is Gap Support. Earlier on this chart the stock gapped up on heavy volume and held the gap. "
                        "Now it has made its first pullback into that gap: the low tagged the gap area and the close held above the top of the gap. "
                        "The gap is support because everyone who bought it on the day still has a profit there, and they tend to defend it. "
                        "The firm's detector wants a true gap, where the gap day's low stays above the prior day's high, of real size and on about double the normal volume, with no close back inside it since. "
                        "The entry is the close, or over the high of the candle that held. The stop goes under the gap top or the day's low, whichever is lower. "
                        "A close back inside the gap means the level failed."),
    "uct_capitulation": ("Yes, this is a capitulation flush. After several days of heavy selling, the last bar closed far below its lower Bollinger band on a huge range and heavy volume. "
                         "That is forced selling, holders giving up all at once, not an orderly decline. "
                         "The firm's detector needs the close more than one ATR under the lower band, a wide range, a cascade of down days before it, and fuel: accelerating losses, record volume or a volume surge. "
                         "A one-day shock out of nowhere does not count. "
                         "This is a rubber-band long. The stock is stretched so far that a snap back is likely, but it is the hardest long there is: size it small and put the stop at the low of the flush. "
                         "The firm's Bottoms guide uses the same word for the whole market: everyone who is going to sell, sells."),
    "uct_slingshot": ("Yes, this is a slingshot. The stock had a strong up day on volume, then paused: three closes in a row under the four-day EMA of its highs. "
                      "On the last bar it closed back above that line, so momentum resumed. "
                      "The firm's detector needs that first close back over the EMA of the highs after three closes under it, a strength day in the weeks before (a big up close on above-average volume) and price above its rising fifty-day average. "
                      "The entry is the trigger close and the stop is the low of the trigger day. "
                      "A slingshot buys momentum resuming, not the low. Buying inside the pullback, before the close over the line, is the anticipation entry that gets run over."),
}
NEG_HEAD = {
    "uct_kicker": "No, this is not a kicker. A kicker needs three things on the last bar: a weak prior close, a real gap up over that close and a break of the prior day's high. The best ones also close above that high, which is what traps the sellers.",
    "uct_oops_reversal": "No, this is not an Oops reversal. The Oops is a failed breakdown inside one session: the stock opens weak, below the prior day's low, trades under that low to flush the stops, then closes back above the prior close.",
    "uct_hve": "No, this is not a High Volume Edge. The firm's HVE is the single heaviest volume day of the past year, and that day's close becomes the level price has to defend.",
    "uct_gap_support": "No, this is not Gap Support. The setup is the first controlled pullback into an earlier up-gap, where a candle tags the gap and closes above its top.",
    "uct_capitulation": "No, this is not a capitulation flush. Capitulation is forced selling after a cascade: several down days, then a close more than one ATR under the lower Bollinger band on a wide range and heavy volume.",
    "uct_slingshot": "No, this is not a slingshot. The slingshot is a strong stock's first close back above the four-day EMA of its highs after a three-day pause, in an uptrend, with a real strength day behind it.",
}
NEG_TAIL = {
    "uct_kicker": "Without all three, it is just a strong day after a weak one, and there is no trapped crowd to fuel it.",
    "uct_oops_reversal": "Without the flush and the reclaim, there is no trapped crowd behind the move.",
    "uct_hve": "So this day did not set the year's level, and there is no edge to trade off it.",
    "uct_gap_support": "Wait for a clean first test of a real gap.",
    "uct_capitulation": "Without the full stretch after a cascade, there is no rubber band to snap back.",
    "uct_slingshot": "Wait for the full pattern: strength, a real pause, then the close back over the line.",
}
REASON = {
    ("uct_kicker", "gap_too_small"): "Here the prior day closed weak and the stock opened higher and broke the prior high, but the open was barely above the close, under a tenth of the prior day's range. Nobody who sold that close was trapped by a gap that small.",
    ("uct_kicker", "no_break_of_prior_high"): "Here the prior day closed weak and the stock gapped up, but it never traded through the prior day's high. The break of the high is the moment the sellers are proven wrong, and it never came.",
    ("uct_kicker", "no_gap_up"): "Here the prior day closed weak and the stock did break the prior high, but it opened below the prior close. A day that opens lower and then rallies through the high is a strong reversal day, a different read.",
    ("uct_kicker", "red_prior_closed_high"): "Here the prior day was red, but it closed in the top 40% of its range. A red candle that finishes near its high is not a weak close: buyers already took most of the day back, so nothing looked broken.",
    ("uct_kicker", "strong_prior_close"): "Here the stock gapped up and broke the prior high, but the prior day closed strong, near its high. Nobody was leaning on a weak close, so there was no one to trap.",
    ("uct_oops_reversal", "closed_back_under"): "Here it undercut the prior low and even traded over the prior close, but it closed back under it, and it never opened below the prior day's low. The reclaim has to hold into the close, and here the sellers won the close.",
    ("uct_oops_reversal", "no_undercut_v3"): "Here it opened below the prior close and closed above it, but it never traded under the prior day's low. No undercut means no stops were flushed, so this is a red-to-green day, not an Oops.",
    ("uct_oops_reversal", "opened_above"): "Here it undercut the prior low and reclaimed it, but the session opened above the prior close. An Oops starts with a weak open, and without it the morning never looked like a breakdown.",
    ("uct_oops_reversal", "reclaimed_low_not_close"): "Here it got back above the prior day's low but finished under the prior close, and it never opened below the low in the first place. Getting back over the low is only half the reclaim.",
    ("uct_hve", "only_26wk_high"): "Here it was the heaviest volume in 26 weeks but not in 252 sessions. Some scans use a 26-week record; the firm's level is the full-year record, and the volume pane shows a bigger day inside the last year.",
    ("uct_hve", "second_highest"): "Here it was the second-highest volume of the year, not the highest. The volume pane shows a bigger day inside the last year.",
    ("uct_gap_support", "gap_filled"): "Here the stock tested the gap and closed above it, but the gap had already been closed into earlier. A gap that price has closed back inside is filled, and it is no longer the clean floor it was.",
    ("uct_gap_support", "no_touch"): "Here there is an unfilled volume gap and a pullback, but the low never reached the gap. Until price actually tags the gap, nothing has been tested. Put an alert at the gap top and wait.",
    ("uct_gap_support", "open_only_touch"): "Here the pullback only reached the gap day's open. The gap itself sits lower, between the prior day's high and the gap day's low, so the low never got into it. The firm's blind review judged these not a test.",
    ("uct_gap_support", "small_gap"): "Here the gap held its test, but it was not big enough. The firm's rule wants a gap of at least 4% on at least 2x the normal volume, the mark of a real catalyst. This one was under 4% and short of 2x volume, a common gap, and common gaps are weak support.",
    ("uct_capitulation", "no_cascade"): "Here there is a wide flush under the band on heavy volume, but it came out of nowhere, with no run of selling before it. A one-day shock is news hitting a stock, not holders running out of patience, and the firm's blind review judged those no.",
    ("uct_capitulation", "not_below_band_by_1atr"): "Here there was a cascade and a wide range, but the close stayed within 1 ATR of the lower band. It was not stretched far enough for the rubber band to snap back.",
    ("uct_slingshot", "below_sma50"): "Here the close back over the line came, but the stock was under its 50-day average. That is a bounce in a weak stock, not momentum resuming, and the firm added that test after a blind review of the misses.",
    ("uct_slingshot", "no_strength_day"): "Here there was a pullback and a reclaim in an uptrend, but no qualifying strength day in the weeks before. The firm wants proof the stock can move first: a big up close on above-average volume.",
    ("uct_slingshot", "pullback_too_short"): "Here the first close over the line came after only one close below it. One down day is a dip, not a pause. The firm wants three closes under the line before the close back over it.",
}

def reason_key(base):
    m = re.match(r"neg_(.+?)_[A-Z]{1,5}_\d{8}$", base)
    return m.group(1) if m else None

def spot_lesson(det, base, fires):
    if fires:
        return POS[det]
    rk = reason_key(base)
    if rk == "quiet_session":
        return (f"No, nothing fires here. This is an ordinary session, and none of the last three sessions qualifies as a {NAME[det]} trigger. "
                f"{QUIET_NEED[det]}. Most days on most charts no setup fires. That is the point of a setup: it is rare, so you wait for it.")
    return f"{NEG_HEAD[det]} {REASON[(det, rk)]} {NEG_TAIL[det]}"

def fx_checked(it, rec, extra=""):
    r = it["reveal_json"]
    return (f"{rec['ref']}: category={rec['cat']}, expected.fires={str(rec['fx_fires']).lower()}, key={it['answer_json']['answer']!r} matches; "
            f"note quoted verbatim; embedded bars identical to the fixture ({rec['n']} bars, last bar {it['asof']}); "
            f"real detector re-run on the fixture bars {'fires' if rec['rerun_fires'] else 'does not fire'} (agrees); no ticker in q/choices"
            + (f"; {extra}" if extra else ""))

# Go Signal / Launchpad blanket reasons
GO_REASON = ("The detector is a daily FOOTPRINT of an intraday entry (its own docstring: 'the real trigger is on the 30/65-minute chart, which the daily bar cannot see') "
             "and its rule (weak open, sweep of support, strong close) is not the firm's Go Signal: the setup card and course lesson define it as 'a catalyst gap digests into the 9 EMA, then one wide candle engulfs the pullback and closes above the catalyst high'. "
             "A member who learned the card would answer these charts differently. Detector is also INTERNAL (registry.INTERNAL_PATTERN_IDS). Hold every Go Signal chart item until the owner rules which definition is the firm's.")
LP_POS_REASON = ("Fails the firm's own Launchpad: the card asks for a pullback 'on top of a stacked cluster' of the 9/20/50/200 and the course lesson says 'the same pattern without stacked, rising MAs is explicitly NOT a Launchpad'. "
                 "On this last bar the averages are not stacked 9>20>50>200{below}. The detector (strict variant) only tests EMA8/EMA21/SMA50 convergence within 3.5% and a curling 50, never the stack or the 200, so 'No' is also defensible. None of the six positives is stacked.")
LP_NEG_REASON = ("The answer 'No' is right, but the lesson would teach the detector's Launchpad (EMA8/EMA21/SMA50 converged, close within 1 ATR, 50 curling), which drops the stacked 9>20>50>200 the firm's card and course require. "
                 "With every Launchpad positive cut, these negatives have nothing to contrast against. Detector is INTERNAL. Hold until the owner rules on the Launchpad definition.")
LP_BELOW200 = {"pos_1_AAPL_20221123", "pos_2_MSFT_20230123", "pos_3_NVDA_20230110", "pos_4_AMZN_20230315", "pos_6_GOOGL_20221205"}

def internal_note(det):
    return " Detector is INTERNAL (registry.INTERNAL_PATTERN_IDS, 'internal until the owner rules them public'); the owner must rule it public before members see it." if det in INTERNAL else ""

spot = load("spot.fixtures")
for it in spot:
    rec = FXV[it["id"]]; det = it["reveal_json"]["detector"]; base = os.path.basename(rec["ref"])[:-5]
    fires = rec["fx_fires"]
    if det == "uct_go_signal":
        V(it, "spot.fixtures", "cut", "unsupported", GO_REASON, fx_checked(it, rec, CARD[det])); continue
    if det == "uct_launch_pad":
        if fires:
            V(it, "spot.fixtures", "cut", "also_true_distractor", LP_POS_REASON.format(below=", and the close is under the 200-day" if base in LP_BELOW200 else ""),
              fx_checked(it, rec, "computed EMA9/EMA20/SMA50/SMA200 on the embedded bars: not stacked"))
        else:
            V(it, "spot.fixtures", "cut", "unsupported", LP_NEG_REASON, fx_checked(it, rec, CARD[det]))
        continue
    verdict, code, note, dupb = D[(det, base)]
    dup_id = None
    if dupb:
        dup_id = next(x["id"] for x in spot if os.path.basename(FXV[x["id"]]["ref"])[:-5] == dupb and x["reveal_json"]["detector"] == det)
    if verdict == "fix":
        lesson = spot_lesson(det, base, fires)
        reason = ("Label, fixture and chart all check out. The lesson is the generator's template (setup name, a lowercase-started copy of the fixture note) and explains nothing about the rule; "
                  "the standing rule wants a full explanation. Proposed lesson below states the verdict, the firm's rule, why this chart passes or fails, the entry and stop or what to wait for." + internal_note(det))
        if det == "uct_capitulation":
            reason += " Note: 'Capitulation' is not a setup in the firm's setup catalog; the firm's own use is the Bottoms signpost (market-level climactic selling). The question calls it 'the firm's Capitulation setup'; owner to confirm the wording."
        if base in ("pos_3_NVDA_20230525",):
            reason += " The only HVE positive kept: up close (+24%) on the year's record volume, though it closed mid-range (0.47 of the day's range); owner to judge 'closing strong' on the chart."
        if base == "pos_4_AMZN_20220810":
            reason += " The only slingshot positive kept: above a rising 50-day after a 10.4% earnings strength day 8 sessions back; owner to judge 'strong uptrend' on the chart."
        V(it, "spot.fixtures", "fix", code, reason, fx_checked(it, rec, CARD.get(det, "")), {"field": "lesson_text", "after": lesson})
    else:
        V(it, "spot.fixtures", "cut", code, note + "." + (internal_note(det) if code != "duplicate" else ""), fx_checked(it, rec, CARD.get(det, "")), None, dup_id)

# ── family ──
FAM_KEEP = {"uct_kicker": "pos_5_META_20220715", "uct_hve": "pos_3_NVDA_20230525", "uct_gap_support": "pos_5_META_20230224",
            "uct_oops_reversal": "pos_1_AAPL_20220809", "uct_slingshot": "pos_4_AMZN_20220810"}
FAM_LESSON = {
    "uct_kicker": "Gaps & Catalysts. A kicker is built on a gap: the stock opens above a weak close, usually on news, and traps everyone who sold that close. That makes it a catalyst play, in the same family as Episodic Pivot, Power Earnings Gap, High Volume Edge and Gap Support. It can look like a reversal, because yesterday looked broken, but the engine of the trade is the gap over the weak close, not a reclaim of support. A base breakout comes out of weeks of tightening; a kicker happens in one session.",
    "uct_hve": "Gaps & Catalysts. A High Volume Edge is a catalyst event: the heaviest volume of the year, usually on news or earnings, sets a level where the biggest buyers committed. This family trades what a news day leaves behind, a gap or a level, and the HVE sits beside Gap Support for that reason: both are a line price has to defend. It is not a base breakout, even when the day gaps through a base, because the level comes from the volume day itself.",
    "uct_gap_support": "Gaps & Catalysts. Gap Support lives with the gaps because the whole trade is built on an earlier gap: a news or earnings gap up on big volume creates the level, and the setup is the first pullback that holds it. It is a pullback, but it is not Momentum & Trend, because the support is the gap, not a moving average. Its family mates are Episodic Pivot, Power Earnings Gap, High Volume Edge and the Kicker.",
    "uct_oops_reversal": "Reversals & Reclaims. The Oops is a trap and a reclaim: the stock opens below yesterday's low, sellers and stops get flushed, and the close comes back above. That is this family's whole idea, buying other people's stop-outs. It sits with the 2B Reversal (the Oops is its gap-open version), the Undercut & Rally, the Slingshot and the Remount. It starts with a gap, but the gap is down and the trade is the reclaim, which is why it is not a Gaps & Catalysts play.",
    "uct_slingshot": "Reversals & Reclaims. The slingshot is a reclaim: a strong stock pulls back under the four-day EMA of its highs, then closes back above it. The firm files it with the reclaims (Oops, Undercut & Rally, 2B, Remount) because the trigger is taking back a line it lost. It is easy to read as Momentum & Trend, since the stock is in an uptrend. The difference is the trigger: a Momentum & Trend entry buys the pullback into a rising average, while the slingshot waits for the close back over the highs line.",
}
SPOT_REASON_FOR = {}  # base -> (code, note) for family positives cut
fam = load("family.fixtures")
for it in fam:
    rec = FXV[it["id"]]; det = it["reveal_json"]["detector"]; base = os.path.basename(rec["ref"])[:-5]
    ck = fx_checked(it, rec, f"family={it['answer_json']['answer']} matches skill_map.json setups[].family for {NAME[det]}")
    if det == "uct_go_signal":
        V(it, "family.fixtures", "cut", "unsupported", GO_REASON, ck); continue
    if det == "uct_launch_pad":
        V(it, "family.fixtures", "cut", "also_true_distractor",
          "Same chart as the cut Launchpad spot positive: the averages are not stacked 9>20>50>200, so by the firm's card it is not a Launchpad, and the unnamed chart reads as other families too. Hold all Launchpad items until the owner rules on the definition.", ck); continue
    keep_base = FAM_KEEP[det]
    keep_id = next(x["id"] for x in fam if os.path.basename(FXV[x["id"]]["ref"])[:-5] == keep_base and x["reveal_json"]["detector"] == det)
    if base == keep_base:
        q = f"This chart shows the firm's {NAME[det]} setup. Which family does it belong to?"
        V(it, "family.fixtures", "fix", "also_true_distractor",
          ("The question never names the setup, so the member must first guess which setup the chart is, and a chart like this also reads as another family "
           f"({'a reversal, since the prior day looked broken' if det=='uct_kicker' else 'Momentum & Trend, a pullback in an uptrend' if det in ('uct_gap_support','uct_slingshot') else 'a gap or a reversal' }). Naming the setup makes one answer clearly right. "
           "One family item per setup is enough (the answer never changes for a setup). ALSO replace the one-line template lesson with: " + FAM_LESSON[det] + internal_note(det)),
          ck, {"field": "q", "after": q})
        continue
    v, code, note, _ = D[(det, base)]
    if v == "cut" and code == "also_true_distractor":
        V(it, "family.fixtures", "cut", "also_true_distractor", "Same chart as the cut spot positive: " + note + ". As a family example it would teach a chart the firm's own card does not call this setup.", ck)
    else:
        V(it, "family.fixtures", "cut", "duplicate", f"Sixth-of-six style repeat: every {NAME[det]} family item has the same answer ({it['answer_json']['answer']}); cap is one per setup.", ck, None, keep_id)

# ════════════════════════════════════════════════════════════════════════════
# VOCAB
# ════════════════════════════════════════════════════════════════════════════
vocab = load("vocab.chart")
terms = {t["id"]: t for t in json.load(open(f"{REPO}/docs/study/terms/chart_words.json", encoding="utf-8"))}
TERM_BY_NAME = {t["term"]: t for t in terms.values()}
ex = json.load(open(f"{REPO}/docs/study/terms/examples.json", encoding="utf-8"))["examples"]
CT = {"trending": "Trending (in an uptrend)", "in a downtrend": "In a downtrend", "coiled": "Coiled (tight)", "higher lows": "Higher lows",
      "inside day": "Inside day", "gapping up": "Gapping up / gapping down", "gapping down": "Gapping up / gapping down",
      "heavy volume": "Heavy volume", "near its highs": "Near its highs", "at new highs": "Near its highs",
      "at the 20 ema": "At the 20 EMA", "shallow pullback": "Pullback", "deep pullback": "Pullback"}
PERSIST = {"Trending (in an uptrend)", "In a downtrend", "Coiled (tight)", "Higher lows", "Near its highs", "Pullback", "At the 20 EMA",
           "Leader", "Moving-average stack"}
true_at = collections.defaultdict(set); conc_at = collections.defaultdict(set)
for e in ex:
    true_at[(e["sym"], e["asof"])].add(CT[e["concept"]]); conc_at[(e["sym"], e["asof"])].add(e["concept"])
def d(s): return date.fromisoformat(s)
#: a same-stock example of concept X within 21 days (or on the same bar) makes these words likely true
IMPLIES = {"trending": {"Trending (in an uptrend)", "Moving-average stack", "Leader"},
           "near its highs": {"Near its highs", "Leader"}, "at new highs": {"Near its highs", "Leader"},
           "at the 20 ema": {"At the 20 EMA", "Pullback"}, "shallow pullback": {"Pullback"}, "deep pullback": {"Pullback"},
           "in a downtrend": {"In a downtrend"}, "coiled": {"Coiled (tight)"}, "higher lows": {"Higher lows"}}
def nearby(sym, asof, term):
    out = []
    for e in ex:
        if e["sym"] != sym or abs((d(e["asof"]) - d(asof)).days) > 21:
            continue
        if e["asof"] == asof and CT[e["concept"]] == term:
            continue   # the same bar for the same word is a PROVEN case, handled separately
        if term in IMPLIES.get(e["concept"], ()):
            out.append(f"{e['concept']} {e['asof']}")
    return out
chart_count = collections.Counter((it["sym"], it["asof"]) for it in vocab)

RS, ADR, DOWN, UP, E20, ID, GAP = "RS line", "ADR% (average daily range)", "In a downtrend", "Trending (in an uptrend)", "At the 20 EMA", "Inside day", "Gapping up / gapping down"
REPL = {UP: [DOWN, GAP, RS, ADR], DOWN: [UP, E20, RS, ADR], E20: [DOWN, RS, ADR], "Pullback": [DOWN, RS, ADR],
        "Near its highs": [DOWN, RS, ADR], ID: [GAP, RS, ADR], GAP: [ID, RS, ADR], "Heavy volume": [RS, ADR, ID],
        "Coiled (tight)": [DOWN, RS, ADR], "Higher lows": [RS, ADR, GAP]}

# explicit keep lists (term/face -> ordered (sym, asof)); everything else for that term is cut
KEEP = {
    "trending": [("MSFT", "2026-10-19"), ("AMZN", "2026-08-20"), ("META", "2026-10-15")],
    "in a downtrend": [("AAPL", "2025-06-18"), ("GOOGL", "2025-05-09"), ("MSFT", "2026-07-24")],
    "coiled": [("NVDA", "2026-10-14"), ("AMZN", "2026-10-19")],
    "higher lows": [("AAPL", "2026-10-02"), ("NVDA", "2026-07-30"), ("AMZN", "2026-07-20")],
    "inside day": [("AAPL", "2026-10-14"), ("NVDA", "2026-09-30"), ("GOOGL", "2026-10-19")],
    "gapping up": [("META", "2026-09-09"), ("AAPL", "2025-09-03")],
    "gapping down": [("AAPL", "2026-07-31"), ("META", "2026-07-30")],
    "heavy volume": [("AAPL", "2026-09-18"), ("NVDA", "2026-08-27"), ("MSFT", "2026-07-30")],
    "near its highs": [("AAPL", "2026-10-19"), ("NVDA", "2026-10-07")],
    "at new highs": [("AAPL", "2026-10-13"), ("AMZN", "2026-08-03")],
    "at the 20 ema": [("AMZN", "2026-10-13"), ("GOOGL", "2026-10-15")],
    "shallow pullback": [("AMZN", "2026-08-10"), ("META", "2026-10-13")],
    "deep pullback": [],
}
# a chart kept by one term: other items on that chart are duplicates of it
owner = {}
for c, lst in KEEP.items():
    for k in lst:
        assert k not in owner, k
        owner[k] = c
# lesson (definition) corrections from source
TERM_FIX = {
    "st_chart_coiled": ("The desk's screener calls a stock tight when the spread of its last ten closes is under 2.5% of price.",
                        "The desk's screener calls a stock tight when its last ten closes scatter less than 2.5% around their average (the standard deviation of those closes is under 2.5% of their average)."),
    "st_chart_higher_lows": ("The desk's screener counts a run of three or more consecutive higher lows as the pattern.",
                             "These example charts were picked where the last three swing lows each sit above the one before. The desk's screener runs a shorter test of its own: three or more days in a row, each with a low above the day before."),
    "st_chart_gapping": ("The stock opens well away from where it closed, leaving empty space on the chart between the two days.",
                         "The stock opens well away from where it closed. If it never trades back into the prior day's range, it leaves empty space on the chart between the two days."),
    "st_chart_near_highs": ("A stock near its highs has no overhead supply: everyone who owns it is in profit, so there are few trapped holders waiting to sell into strength.",
                            "A stock near its highs has little overhead supply: most people who bought it in the past year are in profit, so there are few trapped holders waiting to sell into strength."),
}
TERM_FIX_NOTE = {"st_chart_gapping": ("A gap up that holds its opening range and keeps going on heavy volume is a Power Earnings Gap",
                                      "A gap up on earnings that holds its opening range and keeps going on heavy volume is a Power Earnings Gap")}
TERM_ISSUE = {
    "st_chart_coiled": "definition misstates the house formula: the screener tests the coefficient of variation of the last ten closes (std/mean < 2.5%, api/services/screener/candles.py), not their spread; a 2.5% CV allows a range of several percent, and the rule fired on 5 of 6 mega-caps on the same day (2026-10-19), so owner should confirm these charts look coiled",
    "st_chart_higher_lows": "definition says 'the desk's screener counts a run of three or more consecutive higher lows'; the screener's higher_lows_run counts consecutive DAILY higher lows, while find_term_examples.py picked these charts by three rising SWING lows",
    "st_chart_gapping": "definition says the gap leaves 'empty space on the chart', but the formula is open vs prior close >= 3%, which can trade back into the prior day's range (no visible gap); 'Power Earnings Gap' is an earnings setup, not any news gap",
    "st_chart_near_highs": "'everyone who owns it is in profit' is false for a stock up to 5% under its high (buyers near the top are at a loss)",
}
def corrected_lesson(t):
    lesson = f"{t['definition']} {t['note']}"
    if t["id"] in TERM_FIX:
        a, b = TERM_FIX[t["id"]]; lesson = lesson.replace(a, b)
    if t["id"] in TERM_FIX_NOTE:
        a, b = TERM_FIX_NOTE[t["id"]]; lesson = lesson.replace(a, b)
    return lesson

vocab_debug = []
first_keep = {}
for it in vocab:
    r = it["reveal_json"]; c = r["concept"]; key = it["answer_json"]["answer"]; ch = it["prompt_json"]["choices"]
    k = (it["sym"], it["asof"]); t = TERM_BY_NAME[key]
    proven = [x for x in ch if x != key and x in true_at[k]]
    bydef = [x for x in ch if x == "Moving-average stack" and key in (UP, DOWN)]
    likely = {}
    for x in ch:
        if x != key and x in PERSIST and x not in proven:
            n = nearby(it["sym"], it["asof"], x)
            if n: likely[x] = n
    flagged = list(dict.fromkeys(proven + bydef + list(likely)))
    vocab_debug.append({"id": it["id"], "concept": c, "chart": k, "proven": proven, "bydef": bydef, "likely": likely})
    spec = it["bars"]
    checked = (f"definition: docs/study/terms/chart_words.json#{t['id']} (house formula: {t.get('house_formula')}); source quote: {t['sources'][0]['name']}; "
               f"finder rule '{c}' in scripts/study/find_term_examples.py; example in docs/study/terms/examples.json. "
               f"Bars NOT embedded: spec {spec['sym']} {spec['tf']} asof {spec['asof']} window {spec['window']} resolves on the pod (bars.db), so the chart itself was not inspected. "
               f"Same-chart examples for other words: {sorted(conc_at[k] - {c}) or 'none'}; chart used by {chart_count[k]} item(s); no ticker in q/choices")
    if c == "deep pullback":
        near_down = nearby(it["sym"], it["asof"], DOWN)
        V(it, "vocab.chart", "cut", "data_mismatch",
          ("The deep face of the finder (pullback depth >= 20% from the 60-bar high) has NO uptrend test, but the definition says a pullback is 'a short move against the trend: in an uptrend' and the Investopedia source says 'reversal in the upward price trend'. "
           "A stock 20% off its high with no uptrend check is often just falling" + (f"; the same stock has an 'in a downtrend' example {near_down[0].split(' ')[-1]}, a few weeks away" if near_down else "") +
           ". Unverifiable here (bars on the pod), so hold all six deep-pullback charts until the finder adds the uptrend gate the shallow face already has."), checked)
        continue
    if owner.get(k) == c:
        first_keep.setdefault(c, it["id"])
        lesson_bad = t["id"] in TERM_ISSUE
        if flagged:
            new = list(ch)
            pool = [p for p in REPL[key] if p not in ch]
            for i, x in enumerate(new):
                if x in flagged and pool:
                    new[i] = pool.pop(0)
            why = []
            if proven: why.append(f"{proven} also true on this exact chart (the firm's own formula found this same {it['sym']} {it['asof']} bar for {sorted(conc_at[k] - {c})})")
            if bydef: why.append("'Moving-average stack' is true by definition on a trending/downtrending chart (the stack IS the definition)")
            for x, n in likely.items(): why.append(f"{x!r} likely true: the same stock has a '{n[0].rsplit(' ', 1)[0]}' example on {n[0].rsplit(' ', 1)[1]}")
            reason = ("One clearly correct answer needs every distractor to be false on the last bar. " + "; ".join(why) +
                      ". Replacement distractors are words the key's own formula rules out (or reference words like RS line / ADR% that never describe a bar); the rest are still unverified until the finder checks them on the pod.")
            if lesson_bad: reason += f" ALSO the lesson inherits a definition error: {TERM_ISSUE[t['id']]}; corrected lesson: {corrected_lesson(t)}"
            V(it, "vocab.chart", "fix", "also_true_distractor", reason, checked, {"field": "choices", "after": new})
        elif lesson_bad:
            V(it, "vocab.chart", "fix", "unsupported", f"Choices hold up as far as the repo can show (distractors unverified on the pod). The lesson inherits a definition error: {TERM_ISSUE[t['id']]}.",
              checked, {"field": "lesson_text", "after": corrected_lesson(t)})
        else:
            V(it, "vocab.chart", "keep", "ok", ("Term is real swing-trader vocabulary; definition matches chart_words.json and its house formula and is backed by its cited source; lesson is the full definition plus the note. "
                                               "No distractor is shown true by any example in the repo, but none could be checked against the bars here, so the owner's chart review (or a pod-side check of all 13 finder rules on this bar) is still the gate."), checked)
        continue
    # not kept
    if proven:
        V(it, "vocab.chart", "cut", "also_true_distractor",
          f"{proven} is also true on this exact chart: the firm's own finder picked this same {it['sym']} {it['asof']} bar as an example of {sorted(conc_at[k] - {c})}. Two right answers.", checked)
        continue
    if k in owner:
        dup_id = next(x["id"] for x in vocab if (x["sym"], x["asof"]) == k and x["reveal_json"]["concept"] == owner[k])
        V(it, "vocab.chart", "cut", "duplicate", f"Same chart ({it['sym']} {it['asof']}) is kept for '{owner[k]}'; one chart should teach one word, or the member sees the same picture with different right answers.", checked, None, dup_id)
        continue
    if likely or bydef:
        why = [f"{x!r} likely true (same stock has a nearby example: {n[0]})" for x, n in likely.items()] + (["'Moving-average stack' true by definition"] if bydef else [])
        V(it, "vocab.chart", "cut", "also_true_distractor", "Beyond the cap and carries a probably-true distractor: " + "; ".join(why) + ".", checked)
        continue
    kept = KEEP.get(c) or []
    dup_id = None
    for kk in kept:
        dup_id = next(x["id"] for x in vocab if (x["sym"], x["asof"]) == kk and x["reveal_json"]["concept"] == c); break
    V(it, "vocab.chart", "cut", "duplicate", f"Beyond the cap for '{key}' ({c}): {len(KEEP.get(c) or [])} kept; the finder took the first six mega-caps in its candidate order, so the set is six versions of one lesson.", checked, None, dup_id)

json.dump(vocab_debug, open(os.path.join(OUT, "auditC_vocab_debug.json"), "w", encoding="utf-8"), indent=1, default=str)

# ════════════════════════════════════════════════════════════════════════════
# WALK.METHOD
# ════════════════════════════════════════════════════════════════════════════
walk = load("walk.method")
WID = {it["id"]: it for it in walk}
def wchk(it, extra=""):
    p = it["prompt_json"]
    return (f"{it['source_ref']}: all {len(p['steps'])} steps are verbatim fragments of the brief's text (dedashed, markdown stripped), longest {max(len(s.split()) for s in p['steps'])} words (limit 22); "
            f"framing term: {'yes' if p['q'] in __import__('scripts.study._common', fromlist=['FRAMING_TERMS']).FRAMING_TERMS else 'no (station bullet)'}" + (f"; {extra}" if extra else ""))
AI = "Source docs/curriculum/uct_method_presenter_brief.json was written by an AI session (2ba1d76435), not the owner."
W = {
 "si_381c8a77159b": ("fix", "model_jargon", "The Exposure Rating is the firm's real 0-150 score (dashboard + Morning Wire), worth teaching. The last step adds the brief's 'permission band: GREEN / YELLOW / ORANGE', which is a FRAMING_TERM: the product's own words for the score are the Wire's Aggressive / Constructive / Neutral / Caution / Defensive and the dashboard's colour tiers, and the band thresholds are an open owner decision (docs/curriculum/README.md). Drop that step; the first two are verbatim. The inputs claim (breadth participation, distribution days, index MA structure) is computed in the morning-wire engine, which is not in this checkout, so it is unverified here. The prompt 'Regime' is a word the owner flagged in AI-written copy; the brief's own heading question is an alternative.",
                     {"field": "steps", "after": ["The firm publishes a proprietary UCT Exposure Rating", "A 0-150 score computed daily from breadth participation, the distribution-day count, and index moving-average structure."]}, None),
 "si_93d146958810": ("cut", "model_jargon", "Presenter instructions, not member teaching: 'The doctrine you must repeat correctly on camera' and 'Say it that way every time' (the lesson_text) are notes to a video presenter. The rest teaches the brief's GREEN/YELLOW/ORANGE permission band (a FRAMING_TERM the product does not use).", None, None),
 "si_b634de8fc2f2": ("keep", "ok", "Matches the firm's own scanner: ~3,700-name universe (cap_universe 3,742), the hard ADR% gate under 4 (scanner_candidates LOW_ADR), RS trend and tightening closes. The owner would recognise it. 'About ten names in twenty minutes' is the brief's estimate.", None, None),
 "si_bcab7caa9445": ("cut", "duplicate", "Same A-list / B-list content as the framing-term walk-through, in choppier steps (a bare bracketed aside as a step, 'And a B-list ...' as the closing line).", None, "si_fdb90a4a4f6a"),
 "si_0733552ec419": ("keep", "ok", "The firm's own setup catalog and its four swing families (setupCatalog.js; the owner's curated list was '24 setups, 4 families'). Note the catalog now also carries an Intraday group, which the family quiz offers as a fifth choice; owner may want 'four swing families' wording later.", None, None),
 "si_cb1d7a93ac58": ("cut", "duplicate", "The four entry triggers are taught by the framing-term walk-through; the extra step here is the 'five-field card' (Context / Pattern / Trigger / Stop / Failure mode), a course toolkit artifact the product does not use (the Setup Library cards are Market Context / Chart Criteria / Entry Trigger / Stop / Exit-Targets).", None, "si_b86983610fb1"),
 "si_1dbe2e21d004": ("fix", "other", "The formula and the 2% ceiling with under 1% normal match docs/study/sizing_rule.md (owner's workshop answers). The first step, 'The formula is stated verbatim across the course:', is presenter framing that means nothing to a member; drop it. The remaining two steps are verbatim.",
                     {"field": "steps", "after": ["Account Risk % = Position Size % × Stop Distance %", "With a 2% hard maximum per trade and a stated preference for under 1%."]}, None),
 "si_5986239beed7": ("keep", "voice", "Worked example matches sizing_rule.md §3 exactly (1% risk, 5% stop, 20% position) and the cap table matches the app's houseSizing.json (GREEN A+ 25, YELLOW A+ 15, ORANGE A+ 8, ORANGE B 0). Voice note: 'The regime × grade table' uses 'regime' in AI-written prose (VOICE.md 7b); no verbatim alternative exists, owner to accept or reword.", None, None),
 "si_f8256f64f3e1": ("cut", "unsupported", "States portfolio heat as a hard rule ('capped at 10%, and no new buy goes on above the cap'). The owner's 2026-10-19 principles ruling: numeric caps appear only as the tools' guardrails (the 10% heat flag), 'you decide'. Both steps are mid-sentence fragments ('Is capped at 10% ...').", None, None),
 "si_ed0eb3084741": ("keep", "ok", "Stops at the pattern break and never lowered, breakeven, partials into strength: the owner's own management line ('selling partials into strength', sizing_rule.md §6, VOICE.md §2). The specific +1R and 'first third at 2-3R' numbers come from the brief, owner to confirm.", None, None),
 "si_9db07bbf682b": ("keep", "ok", "Trailing the moving averages matched to the trade, the 10/20-day for Episodic Pivots (sizing_rule.md §6, dossier CORRECTIONS) and 'never add to a loser' (a named mistake in VOICE.md). Owner would recognise it.", None, None),
 "si_58bc17fa3bde": ("cut", "model_jargon", "The 'fixed seven-field journal entry' with a 'three-axis grade (Idea / Execution / Preparation)' is a course artifact; the firm's Journal grades process on its own dimensions (setup / entry / exit / sizing / stop) and this structure appears nowhere in the product.", None, None),
 "si_5c78fcebb179": ("cut", "model_jargon", "The owner: 'i have never heard of THE LOOP' (corrections/recall.glossary.jsonl). The six stations it names are already taught by the station walk-throughs; this item only teaches the invented name.", None, None),
 "si_3bdcf5963593": ("cut", "model_jargon", "'Permission band' GREEN / YELLOW / ORANGE is a brief FRAMING_TERM; the product's words for the Exposure Rating are the Wire's five tiers and the dashboard's colours, and the band thresholds are an open owner decision.", None, None),
 "si_23fcaaa0abc5": ("cut", "model_jargon", "The five-field card (Context / Pattern / Trigger / Stop / Failure mode) is a course toolkit artifact; 'Failure mode' appears nowhere in the app, and the firm's Setup Library playbooks use Market Context / Chart Criteria / Entry Trigger / Stop / Exit-Targets.", None, None),
 "si_b86983610fb1": ("keep", "ok", "These are the firm's real entry types: the Morning Wire's Top 5 picks carry exactly BASE BREAKOUT / PREV DAY HIGH BREAK / PREV LOW RECLAIM / RED TO GREEN. 'The only ways' is strong; owner to confirm.", None, None),
 "si_862760e8a238": ("cut", "duplicate", "Same family list as the Setup station walk-through, with less context.", None, "si_0733552ec419"),
 "si_d41ded89f5ed": ("cut", "duplicate", "Same cap table as the Size station walk-through (part 2), which also carries the worked example.", None, "si_5986239beed7"),
 "si_3fee7a67d83b": ("cut", "model_jargon", "Course mechanics, not the owner's method: 'the Module 5 checkpoint, ten sizing problems at a 100% pass bar' belongs to the AI-designed course, and Study has no Module 5 gate.", None, None),
 "si_93ba89c7e8bd": ("cut", "model_jargon", "Course capstone mechanics ('the capstone commitment to two setup families'), not trading method.", None, None),
 "si_d603a34b5a21": ("cut", "model_jargon", "Course graduation-gate mechanics ('a six-row rubric where every row must pass'), not trading method.", None, None),
 "si_8c3ac349419b": ("cut", "model_jargon", "Course application-week mechanics ('closes each setup-family module'), not trading method.", None, None),
 "si_85653544c775": ("cut", "unsupported", "Contradicts the owner's own published drawdown ladder (sizing_rule.md §4, owner quote 2026-07-19: after -6% max 10%, after -8% max 8%, after -10% max 5%). The brief's 'halve at -5%, pilot-or-paper only at -10%' is not his rule.", None, None),
 "si_12ba2e0ce6b7": ("cut", "unsupported", "The ladder 'Pilot → Half → Full → Overweight' adds an Overweight rung; the owner's draft sizing rule (sizing_rule.md §5) has pilot → half → full, and nothing in the owner's material names an Overweight rung.", None, None),
 "si_fdb90a4a4f6a": ("keep", "other", "Watchlist tiering a swing trader would recognise, in two clean steps. Caution: no owner prose in the repo confirms 'A list / B list'; the only claim is VOICE.md §2's list, which also names 'the loop' the owner disowned. Owner to confirm the words.", None, None),
}
for it in walk:
    v, code, reason, fix, dup = W[it["id"]]
    V(it, "walk.method", v, code, reason + " " + AI if v == "cut" and code in ("model_jargon",) else reason, wchk(it), fix, dup)

# ════════════════════════════════════════════════════════════════════════════
# self-checks
# ════════════════════════════════════════════════════════════════════════════
problems = []
for v in verdicts:
    f = v["fix"]
    if f and f["field"] in ("lesson_text",):
        for p in SI.voice_check(f["after"], lesson=True): problems.append((v["item_id"], "lesson voice", p))
        if "—" in f["after"]: problems.append((v["item_id"], "em dash", ""))
    if f and f["field"] == "q":
        for p in SI.voice_check(f["after"], question=True): problems.append((v["item_id"], "q voice", p))
    if f and f["field"] == "steps":
        for s in f["after"]:
            if len(s.split()) > 22: problems.append((v["item_id"], "step long", s))
    if f and f["field"] == "choices":
        if len(set(f["after"])) != 4: problems.append((v["item_id"], "choices not 4 distinct", f["after"]))
    for w in ("tape", "regime", " dial"):
        if f and isinstance(f["after"], str) and w in f["after"].lower(): problems.append((v["item_id"], "house word", w))
ids_in = {it["id"] for seg in ("spot.fixtures", "family.fixtures", "vocab.chart", "walk.method") for it in load(seg) if it.get("review_status") != "approved"}
ids_out = [v["item_id"] for v in verdicts]
assert len(ids_out) == len(set(ids_out)), "duplicate verdict ids"
assert set(ids_out) == ids_in, (len(ids_in), len(ids_out), ids_in ^ set(ids_out))
for v in verdicts:
    if v["code"] == "duplicate": assert v["duplicate_of"] in ids_in and v["duplicate_of"] != v["item_id"], v
with open(os.path.join(OUT, "auditC_verdicts.jsonl"), "w", encoding="utf-8", newline="\n") as fh:
    for v in verdicts:
        fh.write(json.dumps(v, ensure_ascii=False) + "\n")
print("in scope", len(ids_in), "verdicts", len(verdicts))
print("problems", problems)
c = collections.Counter((v["segment"], v["verdict"]) for v in verdicts)
for k in sorted(c): print(k, c[k])
print(collections.Counter((v["segment"], v["code"]) for v in verdicts))
