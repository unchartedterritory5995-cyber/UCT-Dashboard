"""
Journal taxonomy — mistake library, emotion tags, review statuses, and setup groups.
Constants used by journal service and exposed via API.
"""

MISTAKE_TAXONOMY = [
    {"id": "overtrading", "label": "Overtrading", "category": "discipline"},
    {"id": "fomo", "label": "FOMO Entry", "category": "psychology"},
    {"id": "chasing", "label": "Chasing Extended", "category": "entry"},
    {"id": "early_exit", "label": "Early Exit", "category": "exit"},
    {"id": "late_entry", "label": "Late Entry", "category": "entry"},
    {"id": "no_stop", "label": "No Stop Loss", "category": "risk"},
    {"id": "oversized", "label": "Oversized Position", "category": "risk"},
    {"id": "countertrend", "label": "Countertrend Impulse", "category": "strategy"},
    {"id": "revenge", "label": "Revenge Trade", "category": "psychology"},
    {"id": "ignored_thesis", "label": "Ignored Thesis", "category": "discipline"},
    {"id": "added_to_loser", "label": "Added to Loser", "category": "risk"},
    {"id": "cut_winner", "label": "Cut Winner Too Early", "category": "exit"},
    {"id": "broke_loss_rule", "label": "Broke Daily Loss Rule", "category": "discipline"},
    {"id": "broke_size_rule", "label": "Broke Max Size Rule", "category": "risk"},
    {"id": "broke_checklist", "label": "Broke Process Checklist", "category": "discipline"},
    {"id": "boredom", "label": "Entered from Boredom", "category": "psychology"},
    {"id": "hesitation", "label": "Hesitation / Missed Entry", "category": "psychology"},
]

EMOTION_TAGS = [
    "confident", "anxious", "greedy", "fearful", "calm",
    "frustrated", "euphoric", "bored", "disciplined", "impulsive",
    "patient", "rushed", "focused", "distracted", "revenge-driven",
]

REVIEW_STATUSES = ["draft", "logged", "partial", "reviewed", "flagged", "follow_up"]

VALID_DIRECTIONS = {"long", "short"}
VALID_STATUSES = {"open", "closed", "stopped"}
VALID_ASSET_CLASSES = {"equity", "options", "futures"}
VALID_SESSIONS = {"pre-market", "regular", "after-hours", "overnight"}

SCREENSHOT_SLOTS = ["pre_entry", "in_trade", "exit", "higher_tf", "lower_tf"]

SETUP_GROUPS = [
    {
        "label": "Swing",
        "setups": [
            "High Tight Flag (Powerplay)", "Classic Flag/Pullback", "VCP",
            "Flat Base Breakout", "IPO Base", "Parabolic Short", "Parabolic Long",
            "Wedge Pop", "Wedge Drop", "Episodic Pivot", "2B Reversal",
            "Kicker Candle", "Power Earnings Gap", "News Gappers",
            "4B Setup (Stan Weinstein)", "Failed H&S/Rounded Top",
            "Classic U&R", "Launchpad", "Go Signal", "HVC",
            "Wick Play", "Slingshot", "Oops Reversal", "News Failure",
            "Remount", "Red to Green",
        ],
    },
    {
        "label": "Intraday",
        "setups": [
            "Opening Range Breakout", "Opening Range Breakdown",
            "Red to Green (Intraday)", "Green to Red",
            "30min Pivot", "Mean Reversion L/S",
        ],
    },
]

MISTAKE_BY_ID = {m["id"]: m for m in MISTAKE_TAXONOMY}


def compute_review_status(entry: dict) -> str:
    """Auto-compute review status from field completeness."""
    # Has follow-up action item open?
    if entry.get("follow_up") and entry.get("review_status") != "reviewed":
        return "follow_up"

    # Manually flagged?
    if entry.get("review_status") == "flagged":
        return "flagged"

    # Missing core fields?
    if not entry.get("sym") or entry.get("entry_price") is None:
        return "draft"

    # Check review completeness
    has_process = entry.get("process_score") is not None
    has_notes = bool(entry.get("notes") or entry.get("lesson"))
    has_mistakes_reviewed = entry.get("mistake_tags") is not None  # even empty string = reviewed

    if has_process and has_notes and has_mistakes_reviewed:
        return "reviewed"
    elif has_process or has_notes or has_mistakes_reviewed:
        return "partial"
    else:
        return "logged"
