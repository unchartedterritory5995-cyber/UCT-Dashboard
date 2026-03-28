"""
Seed realistic trade journal data for development/demo purposes.
Usage: python scripts/seed_journal_data.py --user-id USER_ID [--clear]
"""

import argparse
import os
import random
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# DB path resolution (mirrors auth_db.py logic)
# ---------------------------------------------------------------------------
_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
if not os.path.exists(os.path.dirname(_DB_PATH) if os.path.dirname(_DB_PATH) else "."):
    _DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "auth.db")
# For local dev, the fallback is always relative to this script
if not os.path.exists(_DB_PATH):
    _DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "auth.db")


def get_connection():
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def uid():
    return str(uuid.uuid4())[:12]


# ---------------------------------------------------------------------------
# Symbol universe with realistic price ranges
# ---------------------------------------------------------------------------
SYMBOLS = {
    "SMCI": (40, 95), "NVDA": (110, 145), "PLTR": (70, 100), "APP": (280, 380),
    "CRWD": (310, 390), "META": (560, 640), "TSLA": (220, 340), "AAPL": (215, 245),
    "MSFT": (395, 435), "AMD": (100, 145), "AVGO": (170, 220), "MSTR": (260, 380),
    "COIN": (180, 260), "SQ": (68, 88), "SHOP": (95, 120), "NET": (95, 125),
    "SNOW": (145, 180), "DDOG": (115, 150), "MDB": (210, 270), "TTD": (85, 115),
    "CELH": (28, 42), "HIMS": (48, 68), "DUOL": (310, 380), "RKLB": (22, 35),
    "IONQ": (28, 45), "RGTI": (12, 22),
}

SWING_SETUPS = [
    "VCP", "Classic Flag/Pullback", "Episodic Pivot", "Flat Base Breakout",
    "Wedge Pop", "Red to Green", "High Tight Flag (Powerplay)", "Kicker Candle",
    "Power Earnings Gap", "Launchpad", "Go Signal", "HVC", "Remount",
    "Slingshot", "IPO Base", "2B Reversal", "Parabolic Short",
]
INTRADAY_SETUPS = [
    "Opening Range Breakout", "Opening Range Breakdown",
    "Red to Green (Intraday)", "30min Pivot", "Mean Reversion L/S",
]

MISTAKE_IDS = [
    "fomo", "chasing", "early_exit", "oversized", "late_entry", "no_stop",
    "revenge", "ignored_thesis", "added_to_loser", "cut_winner",
    "broke_loss_rule", "broke_size_rule", "broke_checklist", "boredom",
    "hesitation", "countertrend", "overtrading",
]

EMOTION_TAGS = [
    "confident", "anxious", "greedy", "fearful", "calm",
    "frustrated", "euphoric", "disciplined", "impulsive",
    "patient", "rushed", "focused", "distracted",
]

NOTES_POOL = [
    "Clean breakout above {price} resistance on 2x avg volume. Textbook setup.",
    "Cut early due to sector rotation out of semis. Thesis was right, timing was off.",
    "Should have held through the shakeout -- thesis was intact and volume dried up on pullback.",
    "Entered on the retest of the breakout level. Volume confirmed. Held for the measured move.",
    "Got in a bit late after hesitating at the trigger. Still worked but reduced R.",
    "Perfect VCP contraction -- each pullback shallower than the last. Pivoted on volume.",
    "News gapper that held green all day. Added on the first 30min pullback to VWAP.",
    "Earnings gap-up with institutional accumulation. Bought the first orderly flag.",
    "Stopped out on a market-wide flush. Individual setup was fine, macro killed it.",
    "Took profits too early -- left another 8% on the table. Need to trail stops wider.",
    "Short thesis played out perfectly. Breakdown below support with heavy volume.",
    "Caught the exact pivot. EMA10 touch with volume dry-up. Best entry of the week.",
    "Added to winner on the first pullback after breakout. Scale-in worked well here.",
    "Wedge tightened for 3 weeks then popped. Patience rewarded on this one.",
    "Gap-and-go that stalled at prior resistance. Managed to scratch it near breakeven.",
    "Relative strength was obvious -- held green while QQQ dropped 1.5%. Strong name.",
    "Failed breakout -- reversed hard after tagging the level. Stopped out quickly.",
    "Parabolic short setup. Extended 40%+ above 50MA with climax volume. Easy short.",
    "Red to green move with massive volume reversal. Classic intraday momentum trade.",
    "Base breakout after 6 weeks of sideways. Volume expansion confirmed demand.",
    "Earnings beat but sold off -- classic buy-the-rumor setup. Took the short.",
    "Tight range for 8 days near highs, then broke out on sector catalyst. Textbook.",
    "Caught the morning gap fill. Shorted into resistance, covered at support.",
    "This was a revenge trade after the morning loss. Recognized it too late.",
    "Great process on this one -- followed the plan exactly even though it lost.",
]

THESIS_POOL = [
    "Multi-week VCP with 3 contractions. Volume declining steadily. Expecting breakout above {price} on sector tailwind.",
    "Episodic pivot after strong earnings beat. Institutional accumulation evident in block trades. Target the measured move.",
    "Classic flag pullback to 10EMA after a 25% run. Volume dried up on the pullback -- healthy consolidation.",
    "Sector rotation into AI/cloud names accelerating. This is the leader with best RS rank. Breakout imminent.",
    "Post-earnings base building for 4 weeks. Shakeout candle cleared weak hands. Ready for continuation.",
    "Short thesis: parabolic extension 45% above 50MA. Climax volume with bearish engulfing. Mean reversion trade.",
    "IPO base completing after 6-month consolidation. First proper setup since listing. Watching {price} pivot.",
    "Breakout-retest of prior resistance now turned support. Volume confirming on the bounce. Low-risk entry.",
    "Market regime shifting bullish -- breadth expanding, new highs increasing. This is a beta play on the turn.",
    "Tight weekly range near ATH with declining volume. Coiling for a move. Bias long given market context.",
]

LESSON_POOL = [
    "When the market flushes, even the best setups fail. Position sizing saves you.",
    "Holding through the shakeout only works when volume confirms. Trust the volume.",
    "Taking partial profits at 1R removes the emotional pressure. Do it more often.",
    "The best trades feel boring at entry. Excitement usually means chasing.",
    "Process over outcome. This was a good loss -- followed every rule.",
    "Need to stop adding to losers. The thesis changes when the stop is hit.",
    "Intraday noise is not signal. Zoom out to the daily when in doubt.",
    "The first pullback to the breakout level is almost always the best re-entry.",
]

MARKET_CONTEXT_POOL = [
    "SPY above all MAs, breadth expanding. Risk-on environment.",
    "QQQ pulling back to 20EMA. Rotation into value/small caps. Choppy for growth.",
    "VIX elevated at 22. Distribution day count rising. Defensive positioning.",
    "Broad market breakout on expanding breadth. New highs outpacing new lows 4:1.",
    "Sector rotation day -- semis weak, energy strong. Mixed signals.",
    "Post-FOMC rally. Market digesting dovish pivot. Momentum stocks leading.",
]

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def _trading_days(start_date, count):
    """Generate `count` trading days going backwards from start_date."""
    days = []
    d = start_date
    while len(days) < count:
        if d.weekday() < 5:  # Mon-Fri
            days.append(d)
        d -= timedelta(days=1)
    return list(reversed(days))


def _random_time(session):
    if session == "pre-market":
        h = random.randint(7, 9)
        m = random.randint(0, 59)
    elif session == "after-hours":
        h = random.randint(16, 18)
        m = random.randint(0, 59)
    else:
        h = random.randint(9, 15)
        m = random.randint(0, 59)
    return f"{h:02d}:{m:02d}"


def generate_trades(user_id, trading_days):
    """Generate 60 trades spread across ~45 trading days."""
    trades = []
    # Pick ~45 active days from the available trading days
    active_days = sorted(random.sample(trading_days, min(45, len(trading_days))))

    # Distribute 60 trades: some days 1, some 2, some 3
    trade_slots = []
    remaining = 60
    for i, day in enumerate(active_days):
        if remaining <= 0:
            break
        if remaining <= len(active_days) - i:
            n = 1
        else:
            n = random.choices([1, 2, 3], weights=[50, 35, 15])[0]
            n = min(n, remaining)
        for _ in range(n):
            trade_slots.append(day)
        remaining -= n

    # Fill remaining if any
    while len(trade_slots) < 60:
        trade_slots.append(random.choice(active_days))
    trade_slots = sorted(trade_slots[:60])

    # Status distribution: 45 closed, 10 open, 5 stopped
    status_pool = ["closed"] * 45 + ["open"] * 10 + ["stopped"] * 5
    random.shuffle(status_pool)

    # Review status distribution: 15 reviewed, 10 partial, 20 logged, 10 draft, 5 follow_up
    review_pool = (
        ["reviewed"] * 15 + ["partial"] * 10 + ["logged"] * 20
        + ["draft"] * 10 + ["follow_up"] * 5
    )
    random.shuffle(review_pool)

    for i, entry_day in enumerate(trade_slots):
        sym = random.choice(list(SYMBOLS.keys()))
        lo, hi = SYMBOLS[sym]
        entry_price = round(random.uniform(lo, hi), 2)

        # Direction: 70% long, 30% short
        direction = "long" if random.random() < 0.70 else "short"

        # Stop: 3-8% away
        stop_pct = random.uniform(0.03, 0.08)
        if direction == "long":
            stop_price = round(entry_price * (1 - stop_pct), 2)
            target_price = round(entry_price * (1 + random.uniform(0.05, 0.15)), 2)
        else:
            stop_price = round(entry_price * (1 + stop_pct), 2)
            target_price = round(entry_price * (1 - random.uniform(0.05, 0.15)), 2)

        status = status_pool[i]
        review_status = review_pool[i]

        # Setup selection
        if random.random() < 0.80:
            setup = random.choice(SWING_SETUPS)
        else:
            setup = random.choice(INTRADAY_SETUPS)

        # Session: 60% regular, 20% pre-market, 15% after-hours, 5% blank
        session_roll = random.random()
        if session_roll < 0.60:
            session = "regular"
        elif session_roll < 0.80:
            session = "pre-market"
        elif session_roll < 0.95:
            session = "after-hours"
        else:
            session = ""

        # Shares: 50-500
        shares = random.randint(50, 500)

        # Fees
        fees = round(random.uniform(0.50, 2.00), 2)

        # Holding time
        is_intraday = setup in INTRADAY_SETUPS or random.random() < 0.15
        if is_intraday:
            holding_minutes = random.randint(30, 360)
        else:
            holding_days = random.randint(1, 15)
            holding_minutes = holding_days * 6 * 60 + random.randint(0, 360)  # ~6hr trading days

        entry_date = entry_day.strftime("%Y-%m-%d")
        day_of_week = DAY_NAMES[entry_day.weekday()]

        # Entry/exit times
        entry_time = _random_time(session) if random.random() < 0.70 else None
        exit_time = None
        exit_date = None
        exit_price = None
        pnl_pct = None
        pnl_dollar = None
        realized_r = None

        if status in ("closed", "stopped"):
            if is_intraday:
                exit_date = entry_date
            else:
                exit_day = entry_day + timedelta(days=max(1, holding_minutes // (6 * 60)))
                # Skip weekends
                while exit_day.weekday() >= 5:
                    exit_day += timedelta(days=1)
                exit_date = exit_day.strftime("%Y-%m-%d")
            exit_time = _random_time("regular") if entry_time else None

            if status == "stopped":
                exit_price = stop_price
            else:
                # P&L distribution: ~55% win, avg winner +3.2%, avg loser -2.1%
                is_win = random.random() < 0.55
                if is_win:
                    pnl_target = random.gauss(3.2, 2.0)
                    pnl_target = max(0.3, pnl_target)  # at least slightly positive
                else:
                    pnl_target = -random.gauss(2.1, 1.0)
                    pnl_target = min(-0.3, pnl_target)

                if direction == "long":
                    exit_price = round(entry_price * (1 + pnl_target / 100), 2)
                else:
                    exit_price = round(entry_price * (1 - pnl_target / 100), 2)

            # Compute P&L
            if direction == "long":
                pnl_pct = round(((exit_price - entry_price) / entry_price) * 100, 2)
                pnl_dollar = round((exit_price - entry_price) * shares, 2)
            else:
                pnl_pct = round(((entry_price - exit_price) / entry_price) * 100, 2)
                pnl_dollar = round((entry_price - exit_price) * shares, 2)

            # R-multiple
            risk_per_share = abs(entry_price - stop_price)
            if risk_per_share > 0:
                if direction == "long":
                    realized_r = round((exit_price - entry_price) / risk_per_share, 2)
                else:
                    realized_r = round((entry_price - exit_price) / risk_per_share, 2)

        # Planned R
        planned_r = None
        risk = abs(entry_price - stop_price)
        if risk > 0:
            if direction == "long":
                planned_r = round((target_price - entry_price) / risk, 2)
            else:
                planned_r = round((entry_price - target_price) / risk, 2)

        # Risk dollars
        risk_dollars = round(abs(entry_price - stop_price) * shares, 2)

        # Size pct (assume 100k account)
        size_pct = round((entry_price * shares) / 100000 * 100, 1)

        # Process score: 35-95 range
        # Some good losers (high score, negative pnl), some bad winners (low score, positive pnl)
        if pnl_pct is not None and pnl_pct < 0 and random.random() < 0.25:
            process_score = random.randint(75, 95)  # good loser
        elif pnl_pct is not None and pnl_pct > 0 and random.random() < 0.15:
            process_score = random.randint(35, 50)  # bad winner
        else:
            process_score = random.randint(35, 95)

        # Sub-scores (5 components, each 1-20, summing to process_score)
        if process_score is not None:
            base = process_score // 5
            remainder = process_score - base * 5
            ps_setup = min(20, max(1, base + random.randint(-3, 3)))
            ps_entry = min(20, max(1, base + random.randint(-3, 3)))
            ps_exit = min(20, max(1, base + random.randint(-3, 3)))
            ps_sizing = min(20, max(1, base + random.randint(-3, 3)))
            ps_stop = min(20, max(1, base + random.randint(-3, 3)))
            # Adjust to hit target
            process_score = ps_setup + ps_entry + ps_exit + ps_sizing + ps_stop
        else:
            ps_setup = ps_entry = ps_exit = ps_sizing = ps_stop = None

        # Outcome score
        outcome_score = None
        if pnl_pct is not None:
            if pnl_pct > 5:
                outcome_score = random.randint(80, 100)
            elif pnl_pct > 2:
                outcome_score = random.randint(60, 85)
            elif pnl_pct > 0:
                outcome_score = random.randint(45, 70)
            elif pnl_pct > -2:
                outcome_score = random.randint(25, 50)
            else:
                outcome_score = random.randint(10, 35)

        # Confidence: 1-5
        confidence = random.choices([1, 2, 3, 4, 5], weights=[5, 15, 35, 30, 15])[0]

        # Rating: 1-5
        rating = random.randint(1, 5) if random.random() < 0.6 else 0

        # Notes (40%)
        notes = ""
        if random.random() < 0.40:
            note_template = random.choice(NOTES_POOL)
            notes = note_template.replace("{price}", f"${entry_price:.2f}")

        # Thesis (30%)
        thesis = ""
        if random.random() < 0.30:
            thesis_template = random.choice(THESIS_POOL)
            thesis = thesis_template.replace("{price}", f"${entry_price:.2f}")

        # Market context (20%)
        market_context = ""
        if random.random() < 0.20:
            market_context = random.choice(MARKET_CONTEXT_POOL)

        # Mistake tags (25%)
        mistake_tags = ""
        if random.random() < 0.25:
            n_mistakes = random.choices([1, 2, 3], weights=[60, 30, 10])[0]
            mistake_tags = ",".join(random.sample(MISTAKE_IDS, min(n_mistakes, len(MISTAKE_IDS))))

        # Emotion tags (15%)
        emotion_tags = ""
        if random.random() < 0.15:
            n_emotions = random.choices([1, 2], weights=[70, 30])[0]
            emotion_tags = ",".join(random.sample(EMOTION_TAGS, min(n_emotions, len(EMOTION_TAGS))))

        # Lesson (20%)
        lesson = ""
        if random.random() < 0.20:
            lesson = random.choice(LESSON_POOL)

        # Follow-up (for follow_up review status)
        follow_up = ""
        if review_status == "follow_up":
            follow_up = random.choice([
                "Re-evaluate if the setup recurs next week.",
                "Check if sector rotation continues -- may re-enter.",
                "Review stop placement on this setup type.",
                "Watch for a re-test of the breakout level.",
                "Revisit position sizing rules for volatile names.",
            ])

        # Tags
        tags = ""
        tag_options = ["momentum", "breakout", "earnings", "sector-leader", "high-rs",
                       "volume-signal", "swing", "daytrade", "gap-play", "reversal"]
        if random.random() < 0.35:
            tags = ",".join(random.sample(tag_options, random.randint(1, 3)))

        # Review date for reviewed trades
        review_date = None
        if review_status == "reviewed":
            rev_day = entry_day + timedelta(days=random.randint(0, 3))
            while rev_day.weekday() >= 5:
                rev_day += timedelta(days=1)
            review_date = rev_day.strftime("%Y-%m-%d")

        now = datetime.utcnow().isoformat()
        trade_id = uid()

        trades.append({
            "id": trade_id,
            "user_id": user_id,
            "sym": sym,
            "direction": direction,
            "setup": setup,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "stop_price": stop_price,
            "target_price": target_price,
            "size_pct": size_pct,
            "status": status,
            "entry_date": entry_date,
            "exit_date": exit_date,
            "pnl_pct": pnl_pct,
            "pnl_dollar": pnl_dollar,
            "notes": notes,
            "rating": rating,
            "created_at": now,
            "updated_at": now,
            "account": "default",
            "asset_class": "equity",
            "strategy": setup,
            "playbook_id": None,  # filled in after playbooks created
            "tags": tags,
            "mistake_tags": mistake_tags,
            "emotion_tags": emotion_tags,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "fees": fees,
            "shares": float(shares),
            "risk_dollars": risk_dollars,
            "planned_r": planned_r,
            "realized_r": realized_r,
            "thesis": thesis,
            "market_context": market_context,
            "confidence": confidence,
            "process_score": process_score,
            "outcome_score": outcome_score,
            "ps_setup": ps_setup,
            "ps_entry": ps_entry,
            "ps_exit": ps_exit,
            "ps_sizing": ps_sizing,
            "ps_stop": ps_stop,
            "lesson": lesson,
            "follow_up": follow_up,
            "review_status": review_status,
            "review_date": review_date,
            "session": session,
            "day_of_week": day_of_week,
            "holding_minutes": holding_minutes if status != "open" else None,
        })

    return trades


def generate_daily_journals(user_id, recent_days):
    """Generate 15 daily journals across the last 3 weeks."""
    # Pick 15 trading days from last 3 weeks
    three_weeks = [d for d in recent_days if d >= recent_days[-1] - timedelta(days=21)]
    journal_days = sorted(random.sample(three_weeks, min(15, len(three_weeks))))

    journals = []
    for day in journal_days:
        is_complete = random.random() < 0.5
        date_str = day.strftime("%Y-%m-%d")

        premarket = ""
        if random.random() < 0.7:
            premarket = random.choice([
                "Futures flat. Watching NVDA for continuation above $130. Market breadth improving.",
                "Gap down overnight on tariff headlines. Will be cautious today, reduce size.",
                "Strong pre-market. SPY gapping above 20EMA. Looking for breakout setups in semis.",
                "VIX elevated. Will focus on A+ setups only. No chasing.",
                "Earnings season kicking off. Several names reporting AH today. Light morning trading.",
                "Sector rotation visible -- energy leading, tech lagging. Adjust watchlist accordingly.",
                "Clean setup in PLTR after 3-week VCP. Waiting for volume confirmation at the pivot.",
                "Market extended short-term. Looking for mean reversion shorts if we gap up.",
            ])

        focus_list = ""
        if random.random() < 0.65:
            tickers = random.sample(list(SYMBOLS.keys()), random.randint(3, 6))
            focus_list = ", ".join(tickers)

        a_plus = ""
        if random.random() < 0.5:
            a_plus = random.choice([
                "NVDA flag above $128, PLTR VCP at $82, CRWD base breakout",
                "SMCI wedge tightening, APP episodic pivot, HIMS flag pullback",
                "RKLB IPO base, IONQ breakout retest, TTD earnings gap hold",
                "MSTR red-to-green if BTC holds, SQ flat base, NET wedge pop",
            ])

        risk_plan = ""
        if random.random() < 0.55:
            risk_plan = random.choice([
                "Max 3 new positions. 1% risk per trade. Stop adding if down 1.5% on day.",
                "Reduce to half size -- market choppy. Only A+ setups.",
                "Normal sizing. Market regime supportive. Can be aggressive on leaders.",
                "No new shorts. Breadth expanding. Focus on long breakouts.",
            ])

        market_regime = random.choice([
            "Confirmed uptrend", "Uptrend under pressure", "Rally attempt",
            "Correction", "Sideways chop", "",
        ])

        emotional_state = random.choice([
            "Calm and focused", "Slightly anxious after yesterday's losses",
            "Confident -- on a good streak", "Disciplined but bored",
            "Frustrated with chop", "Energized and patient", "",
        ])

        midday = ""
        if random.random() < 0.4:
            midday = random.choice([
                "Morning breakout in NVDA worked. Holding 2/3 position. Market turning over midday.",
                "Flat so far. Nothing triggering. Good discipline not forcing trades.",
                "Got stopped on PLTR. Market flushed at 10:30. Regrouping.",
                "Two winners this morning. Taking the foot off the gas into lunch.",
            ])

        eod_recap = ""
        if is_complete or random.random() < 0.5:
            eod_recap = random.choice([
                "Solid day. +1.2% on the account. Two clean winners, one scratch.",
                "Tough day. Stopped out twice on market-wide selling. Process was good though.",
                "Breakeven day. Missed the NVDA move by hesitating. Need to trust the setup.",
                "Best day of the week. Three winners, all from the focus list. Preparation paid off.",
                "Small loss. One oversize position dragged me down. Lesson: stick to the sizing rules.",
                "No trades today. Nothing met criteria. That IS good trading.",
            ])

        did_well = ""
        if is_complete or random.random() < 0.4:
            did_well = random.choice([
                "Stuck to the plan. Didn't chase. Cut losers quickly.",
                "Waited for confirmation volume before entering. Patience paid off.",
                "Kept position size in check despite conviction. Good discipline.",
                "Identified the sector rotation early and positioned accordingly.",
            ])

        did_poorly = ""
        if is_complete or random.random() < 0.4:
            did_poorly = random.choice([
                "Hesitated on the NVDA entry. Need to be faster when the setup triggers.",
                "Held a loser too long hoping for a bounce. Should have honored the stop.",
                "Took a boredom trade in the afternoon. Gave back morning gains.",
                "Position sized too large on the first trade. Let confidence override rules.",
            ])

        learned = ""
        if is_complete or random.random() < 0.3:
            learned = random.choice([
                "The best entries feel boring. Excitement = chasing.",
                "Volume is the confirmation. No volume = no trade.",
                "Morning trades have the best follow-through. Afternoon is chop.",
                "When breadth is narrowing, reduce exposure. Don't fight the tape.",
            ])

        tomorrow_focus = ""
        if random.random() < 0.4:
            tomorrow_focus = random.choice([
                "Watch for follow-through on today's breakouts. Earnings reports AH could shift sentiment.",
                "If SPY holds above 20EMA, stay aggressive. If not, reduce to 50% exposure.",
                "Focus on the top 3 names from tonight's scan. No bottom-fishing.",
                "FOMC day -- lighter size, wider stops, no new positions before 2PM.",
            ])

        energy_rating = random.randint(3, 10) if random.random() < 0.7 else None
        discipline_score = random.randint(4, 10) if random.random() < 0.6 else None

        now = datetime.utcnow().isoformat()
        journals.append({
            "id": uid(),
            "user_id": user_id,
            "date": date_str,
            "premarket_thesis": premarket,
            "focus_list": focus_list,
            "a_plus_setups": a_plus,
            "risk_plan": risk_plan,
            "market_regime": market_regime,
            "emotional_state": emotional_state,
            "midday_notes": midday,
            "eod_recap": eod_recap,
            "did_well": did_well,
            "did_poorly": did_poorly,
            "learned": learned,
            "tomorrow_focus": tomorrow_focus,
            "energy_rating": energy_rating,
            "discipline_score": discipline_score,
            "review_complete": 1 if is_complete else 0,
            "created_at": now,
            "updated_at": now,
        })

    return journals


def generate_playbooks(user_id):
    """Generate 2 playbooks: VCP and Episodic Pivot."""
    now = datetime.utcnow().isoformat()
    return [
        {
            "id": uid(),
            "user_id": user_id,
            "name": "VCP (Volatility Contraction Pattern)",
            "description": "Mark Minervini's volatility contraction pattern. Multiple contractions in price and volume before a breakout. The tighter the pattern, the more powerful the move.",
            "market_condition": "Works best in confirmed uptrends with expanding breadth. Avoid in corrections or when distribution days are accumulating.",
            "trigger_criteria": "3+ contractions with each shallower than prior. Volume declining steadily through base. Final contraction <10% depth. Price within 15% of 52W high.",
            "invalidations": "Break below the deepest contraction low. Volume spike on a down day during formation. Sector rotation away from the stock's group.",
            "entry_model": "Buy on breakout above the pivot point (last contraction high) with volume 50%+ above average. Alternate: buy on intraday pullback to VWAP after breakout if volume confirms.",
            "exit_model": "Trail stop to 10EMA after 1R gain. Move to breakeven after 3 days. Take 1/3 at 2R, 1/3 at 3R, let final 1/3 ride with 20EMA trail.",
            "sizing_rules": "Standard 1% risk. Can increase to 1.5% for A+ setups with market regime support. Never exceed 8% of portfolio in single position.",
            "common_mistakes": "Buying before the pivot triggers. Not waiting for volume confirmation. Sizing too large because the pattern looks perfect.",
            "best_practices": "Scan for VCPs on Sunday night. Put alerts at pivot levels. Let the stock come to you. The best VCPs resolve quickly after breakout.",
            "ideal_time": "Mid-morning breakouts (10:00-11:00 AM) have the best follow-through. Avoid breakouts in the last hour.",
            "ideal_volatility": "Low to moderate volatility (VIX 12-20). High VIX environments cause false breakouts.",
            "is_active": 1,
            "trade_count": 18,
            "win_rate": 61.0,
            "avg_r": 1.8,
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": uid(),
            "user_id": user_id,
            "name": "Episodic Pivot",
            "description": "A fundamental catalyst (earnings, FDA approval, contract win) causes a gap-up on massive volume. The first orderly pullback to support after the gap is the entry.",
            "market_condition": "Works in all market conditions but best in uptrends. The catalyst must be strong enough to overcome market headwinds.",
            "trigger_criteria": "Gap-up of 5%+ on 3x average volume. Must be a fundamental catalyst, not just technical. Stock should be in a Stage 2 uptrend or transitioning from Stage 1.",
            "invalidations": "Gap fills completely (closes below pre-gap close). Volume dries up immediately after gap day. Multiple distribution days within first week.",
            "entry_model": "Buy first pullback to 10EMA or gap-day VWAP (whichever is higher). Confirm with volume dry-up on pullback. Alternate: buy gap-day close if volume >5x average.",
            "exit_model": "Initial stop below gap-day low. After 1R, trail to 10EMA. Take 1/2 at measured move target. Let remainder ride.",
            "sizing_rules": "Standard 1% risk. Gap-day entries can be 0.75% due to wider stop (gap-day low can be far). Scale in on first pullback with additional 0.5% risk.",
            "common_mistakes": "Chasing the gap-day move. Not waiting for the pullback. Using a stop that's too tight on the initial entry.",
            "best_practices": "Build a watchlist of episodic pivots each earnings season. The strongest names will pull back least. Act fast on the first pullback -- it may only last 1-2 days.",
            "ideal_time": "Gap-day entry: first 30 minutes or last 30 minutes. Pullback entry: 10:00-11:00 AM on the pullback day.",
            "ideal_volatility": "Moderate volatility preferred. The gap itself creates the volatility you need.",
            "is_active": 1,
            "trade_count": 12,
            "win_rate": 58.0,
            "avg_r": 2.1,
            "created_at": now,
            "updated_at": now,
        },
    ]


def generate_resources(user_id):
    """Generate 5 resources."""
    now = datetime.utcnow().isoformat()
    return [
        {
            "id": uid(), "user_id": user_id,
            "category": "checklist", "title": "Pre-Market Checklist",
            "content": (
                "1. Check S&P 500 futures and VIX level\n"
                "2. Review overnight news and earnings reports\n"
                "3. Check breadth indicators (advance/decline, new highs/lows)\n"
                "4. Update focus list from last night's scan\n"
                "5. Identify A+ setups with exact entry, stop, target\n"
                "6. Set alerts at pivot levels for top 5 names\n"
                "7. Review position sizes based on current exposure\n"
                "8. Check economic calendar for scheduled events\n"
                "9. Mental check: Am I calm? Any emotional baggage from yesterday?\n"
                "10. Write pre-market thesis in daily journal"
            ),
            "sort_order": 1, "is_pinned": 1, "created_at": now, "updated_at": now,
        },
        {
            "id": uid(), "user_id": user_id,
            "category": "rules", "title": "Risk Management Rules",
            "content": (
                "POSITION SIZING:\n"
                "- Max 1% account risk per trade (1.5% for A+ setups)\n"
                "- Max 8% of portfolio in single position\n"
                "- Max 25% total portfolio heat\n\n"
                "DAILY LIMITS:\n"
                "- Stop trading after 2% daily drawdown\n"
                "- Max 3 new positions per day\n"
                "- No trading in last 30 minutes (except planned exits)\n\n"
                "STOP RULES:\n"
                "- Every trade has a pre-defined stop before entry\n"
                "- Never move a stop further away\n"
                "- Honor the stop -- no hoping for a bounce\n"
                "- Move to breakeven after 1R gain"
            ),
            "sort_order": 2, "is_pinned": 1, "created_at": now, "updated_at": now,
        },
        {
            "id": uid(), "user_id": user_id,
            "category": "template", "title": "Daily Review Template",
            "content": (
                "END OF DAY REVIEW:\n\n"
                "1. What was my P&L today? ___\n"
                "2. How many trades? ___ Winners: ___ Losers: ___\n"
                "3. Did I follow my pre-market plan? Y/N\n"
                "4. Best trade of the day and why:\n"
                "5. Worst trade of the day and why:\n"
                "6. Did I break any rules? Which ones?\n"
                "7. What did I learn today?\n"
                "8. Process score (1-10): ___\n"
                "9. Energy/focus rating (1-10): ___\n"
                "10. One thing to improve tomorrow:\n"
            ),
            "sort_order": 3, "is_pinned": 0, "created_at": now, "updated_at": now,
        },
        {
            "id": uid(), "user_id": user_id,
            "category": "psychology", "title": "Psychology Reminders",
            "content": (
                "BEFORE EACH TRADE:\n"
                "- Am I following my process or reacting emotionally?\n"
                "- Is this a setup from my playbook or am I improvising?\n"
                "- Would I take this trade with half my normal size?\n\n"
                "AFTER A LOSS:\n"
                "- Was the process correct? If yes, move on. Losses are part of the game.\n"
                "- Did I break a rule? Write it down. Don't repeat it.\n"
                "- Take a 15-minute break. Walk away from the screen.\n"
                "- DO NOT take a revenge trade. Ever.\n\n"
                "AFTER A WIN:\n"
                "- Don't get overconfident. Stay humble.\n"
                "- Was the win due to skill or luck? Be honest.\n"
                "- Stick to normal sizing on the next trade."
            ),
            "sort_order": 4, "is_pinned": 0, "created_at": now, "updated_at": now,
        },
        {
            "id": uid(), "user_id": user_id,
            "category": "plan", "title": "Trading Plan - Q1 2026",
            "content": (
                "EDGE: Momentum breakouts in leading stocks during confirmed uptrends.\n\n"
                "PRIMARY SETUPS: VCP, Episodic Pivot, Flag/Pullback, Flat Base Breakout\n"
                "SECONDARY: Red to Green, Wedge Pop, Kicker Candle\n\n"
                "TIMEFRAME: Swing (1-15 day holds). Occasional intraday for ORB setups.\n\n"
                "UNIVERSE: US equities >$10, >500K avg volume, RS rank >80\n\n"
                "GOALS:\n"
                "- Win rate >50%\n"
                "- Profit factor >1.5\n"
                "- Average R >1.5\n"
                "- Max drawdown <8%\n"
                "- Process score avg >70\n\n"
                "WEEKLY ROUTINE:\n"
                "- Sunday: Full scan + focus list for the week\n"
                "- Daily: Pre-market prep (7:00 AM), trade (9:30-4:00), review (4:30 PM)\n"
                "- Friday: Weekly review + stats update"
            ),
            "sort_order": 5, "is_pinned": 1, "created_at": now, "updated_at": now,
        },
    ]


def generate_executions(user_id, trades):
    """Generate 8 trade executions for 3 trades (scale-in/out)."""
    # Pick 3 closed trades with enough shares for scaling
    closed = [t for t in trades if t["status"] == "closed" and t["shares"] >= 100]
    if len(closed) < 3:
        closed = [t for t in trades if t["status"] == "closed"]
    selected = random.sample(closed[:20], min(3, len(closed)))

    executions = []
    now = datetime.utcnow().isoformat()

    for trade in selected:
        total_shares = int(trade["shares"])
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"] or entry_price * 1.03
        direction = trade["direction"]

        # Scale-in: 2-3 buys
        n_entries = random.choice([2, 3])
        entry_shares = []
        remaining = total_shares
        for j in range(n_entries):
            if j == n_entries - 1:
                entry_shares.append(remaining)
            else:
                chunk = remaining // (n_entries - j)
                chunk += random.randint(-10, 10)
                chunk = max(10, min(chunk, remaining - 10))
                entry_shares.append(chunk)
                remaining -= chunk

        # Entry executions
        for j, sh in enumerate(entry_shares):
            price_offset = random.uniform(-0.005, 0.005) * entry_price
            exec_price = round(entry_price + price_offset * (j + 1), 2)
            exec_type = "buy" if direction == "long" else "sell_short"

            executions.append({
                "id": uid(),
                "user_id": user_id,
                "trade_id": trade["id"],
                "exec_type": exec_type,
                "exec_date": trade["entry_date"],
                "exec_time": trade["entry_time"],
                "price": exec_price,
                "shares": float(sh),
                "fees": round(random.uniform(0.25, 1.00), 2),
                "notes": ["Initial entry", "Added on pullback", "Final add at support"][j] if j < 3 else "",
                "sort_order": j,
                "created_at": now,
            })

        # Exit execution (single exit)
        exit_type = "sell" if direction == "long" else "buy_to_cover"
        executions.append({
            "id": uid(),
            "user_id": user_id,
            "trade_id": trade["id"],
            "exec_type": exit_type,
            "exec_date": trade["exit_date"],
            "exec_time": trade["exit_time"],
            "price": exit_price,
            "shares": float(total_shares),
            "fees": round(random.uniform(0.25, 1.00), 2),
            "notes": random.choice(["Closed full position", "Hit target", "Trailed stop triggered"]),
            "sort_order": n_entries,
            "created_at": now,
        })

    return executions


def generate_weekly_review(user_id, trades, recent_days):
    """Generate 1 weekly review (partially complete)."""
    # Pick a recent Monday
    mondays = [d for d in recent_days if d.weekday() == 0 and d >= recent_days[-1] - timedelta(days=14)]
    if not mondays:
        mondays = [recent_days[-7] if len(recent_days) >= 7 else recent_days[-1]]
    week_start = mondays[-1].strftime("%Y-%m-%d")

    # Find trades from that week
    week_end = (mondays[-1] + timedelta(days=4)).strftime("%Y-%m-%d")
    week_trades = [t for t in trades if t["entry_date"] >= week_start and t["entry_date"] <= week_end]
    wins = [t for t in week_trades if (t["pnl_pct"] or 0) > 0]
    losses = [t for t in week_trades if (t["pnl_pct"] or 0) <= 0 and t["pnl_pct"] is not None]
    net_pnl = sum(t["pnl_pct"] for t in week_trades if t["pnl_pct"] is not None)

    best_id = None
    worst_id = None
    if wins:
        best_id = max(wins, key=lambda t: t["pnl_pct"])["id"]
    if losses:
        worst_id = min(losses, key=lambda t: t["pnl_pct"])["id"]

    ps_values = [t["process_score"] for t in week_trades if t["process_score"] is not None]
    avg_ps = round(sum(ps_values) / len(ps_values), 1) if ps_values else None

    now = datetime.utcnow().isoformat()
    return {
        "id": uid(),
        "user_id": user_id,
        "week_start": week_start,
        "best_trade_id": best_id,
        "worst_trade_id": worst_id,
        "top_setup": "VCP",
        "worst_mistake": "early_exit",
        "wins": len(wins),
        "losses": len(losses),
        "net_pnl_pct": round(net_pnl, 2) if week_trades else None,
        "avg_process_score": avg_ps,
        "reflection": (
            "Decent week overall. Hit rate was solid but gave back gains on two trades by "
            "not honoring stops fast enough. The VCP setups continue to be the most reliable. "
            "Need to work on patience with episodic pivots -- entering before the pullback "
            "is complete keeps costing me."
        ),
        "key_lessons": (
            "1. VCPs work best when volume is truly dried up -- don't force entries on moderate volume.\n"
            "2. The first 30 minutes of a gap-up day are for watching, not trading.\n"
            "3. Reducing size on the third trade of the day saved me from a bigger drawdown."
        ),
        "next_week_focus": "Focus on A+ VCPs only. Reduce position count to max 2/day. Review stop placement.",
        "rules_to_add": "",
        "review_complete": 0,
        "created_at": now,
        "updated_at": now,
    }


def seed(user_id, clear=False):
    conn = get_connection()
    try:
        if clear:
            for table in [
                "trade_executions", "journal_screenshots", "daily_journals",
                "weekly_reviews", "playbooks", "journal_resources",
            ]:
                conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM journal_entries WHERE user_id = ?", (user_id,))
            conn.commit()
            print(f"Cleared existing journal data for user {user_id}")

        # Generate trading days (last 8 weeks ~56 calendar days)
        today = datetime.now()
        all_days = _trading_days(today, 56)

        # --- Trades ---
        trades = generate_trades(user_id, all_days)

        # --- Playbooks ---
        playbooks = generate_playbooks(user_id)
        vcp_pb_id = playbooks[0]["id"]
        ep_pb_id = playbooks[1]["id"]

        # Link some trades to playbooks
        for t in trades:
            if t["setup"] == "VCP":
                t["playbook_id"] = vcp_pb_id
            elif t["setup"] == "Episodic Pivot":
                t["playbook_id"] = ep_pb_id

        # Insert trades
        trade_cols = [
            "id", "user_id", "sym", "direction", "setup", "entry_price", "exit_price",
            "stop_price", "target_price", "size_pct", "status", "entry_date", "exit_date",
            "pnl_pct", "pnl_dollar", "notes", "rating", "created_at", "updated_at",
            "account", "asset_class", "strategy", "playbook_id", "tags", "mistake_tags",
            "emotion_tags", "entry_time", "exit_time", "fees", "shares", "risk_dollars",
            "planned_r", "realized_r", "thesis", "market_context", "confidence",
            "process_score", "outcome_score", "ps_setup", "ps_entry", "ps_exit",
            "ps_sizing", "ps_stop", "lesson", "follow_up", "review_status", "review_date",
            "session", "day_of_week", "holding_minutes",
        ]
        placeholders = ",".join(["?"] * len(trade_cols))
        col_str = ",".join(trade_cols)
        for t in trades:
            vals = [t.get(c) for c in trade_cols]
            conn.execute(f"INSERT INTO journal_entries ({col_str}) VALUES ({placeholders})", vals)
        print(f"  Inserted {len(trades)} trades")

        # --- Daily Journals ---
        journals = generate_daily_journals(user_id, all_days)
        dj_cols = [
            "id", "user_id", "date", "premarket_thesis", "focus_list", "a_plus_setups",
            "risk_plan", "market_regime", "emotional_state", "midday_notes", "eod_recap",
            "did_well", "did_poorly", "learned", "tomorrow_focus", "energy_rating",
            "discipline_score", "review_complete", "created_at", "updated_at",
        ]
        dj_ph = ",".join(["?"] * len(dj_cols))
        dj_cs = ",".join(dj_cols)
        for j in journals:
            vals = [j.get(c) for c in dj_cols]
            conn.execute(f"INSERT INTO daily_journals ({dj_cs}) VALUES ({dj_ph})", vals)
        print(f"  Inserted {len(journals)} daily journals")

        # --- Playbooks ---
        pb_cols = [
            "id", "user_id", "name", "description", "market_condition", "trigger_criteria",
            "invalidations", "entry_model", "exit_model", "sizing_rules", "common_mistakes",
            "best_practices", "ideal_time", "ideal_volatility", "is_active", "trade_count",
            "win_rate", "avg_r", "created_at", "updated_at",
        ]
        pb_ph = ",".join(["?"] * len(pb_cols))
        pb_cs = ",".join(pb_cols)
        for pb in playbooks:
            vals = [pb.get(c) for c in pb_cols]
            conn.execute(f"INSERT INTO playbooks ({pb_cs}) VALUES ({pb_ph})", vals)
        print(f"  Inserted {len(playbooks)} playbooks")

        # --- Resources ---
        resources = generate_resources(user_id)
        res_cols = [
            "id", "user_id", "category", "title", "content",
            "sort_order", "is_pinned", "created_at", "updated_at",
        ]
        res_ph = ",".join(["?"] * len(res_cols))
        res_cs = ",".join(res_cols)
        for r in resources:
            vals = [r.get(c) for c in res_cols]
            conn.execute(f"INSERT INTO journal_resources ({res_cs}) VALUES ({res_ph})", vals)
        print(f"  Inserted {len(resources)} resources")

        # --- Trade Executions ---
        executions = generate_executions(user_id, trades)
        ex_cols = [
            "id", "user_id", "trade_id", "exec_type", "exec_date", "exec_time",
            "price", "shares", "fees", "notes", "sort_order", "created_at",
        ]
        ex_ph = ",".join(["?"] * len(ex_cols))
        ex_cs = ",".join(ex_cols)
        for e in executions:
            vals = [e.get(c) for c in ex_cols]
            conn.execute(f"INSERT INTO trade_executions ({ex_cs}) VALUES ({ex_ph})", vals)
        print(f"  Inserted {len(executions)} trade executions")

        # --- Weekly Review ---
        weekly = generate_weekly_review(user_id, trades, all_days)
        wr_cols = [
            "id", "user_id", "week_start", "best_trade_id", "worst_trade_id",
            "top_setup", "worst_mistake", "wins", "losses", "net_pnl_pct",
            "avg_process_score", "reflection", "key_lessons", "next_week_focus",
            "rules_to_add", "review_complete", "created_at", "updated_at",
        ]
        wr_ph = ",".join(["?"] * len(wr_cols))
        wr_cs = ",".join(wr_cols)
        vals = [weekly.get(c) for c in wr_cols]
        conn.execute(f"INSERT INTO weekly_reviews ({wr_cs}) VALUES ({wr_ph})", vals)
        print(f"  Inserted 1 weekly review")

        conn.commit()
        print(f"\nSeeded: {len(trades)} trades, {len(journals)} daily journals, "
              f"{len(playbooks)} playbooks, {len(resources)} resources, "
              f"{len(executions)} executions, 1 weekly review")

    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed trade journal with realistic mock data")
    parser.add_argument("--user-id", required=True, help="User ID to assign trades to")
    parser.add_argument("--clear", action="store_true", help="Delete existing journal data for user first")
    args = parser.parse_args()

    print(f"Seeding journal data for user {args.user_id}")
    print(f"Database: {_DB_PATH}")
    seed(args.user_id, clear=args.clear)
