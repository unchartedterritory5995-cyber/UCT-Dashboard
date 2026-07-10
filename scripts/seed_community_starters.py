"""One-shot: seed The Floor with a pinned Welcome/Rules thread + a facilitation
starter in each member space, so the room is populated and judge-ready.

These are ADMINISTRATIVE / community-facilitation posts authored as "UCT Mentor"
(author_id NULL) — deliberately NOT fabricated trading advice. Real mentor/teaching
content comes from the Desk-session backfill (scripts/backfill_community_desk_threads.py).

Idempotent: keyed by title within a space — re-running won't duplicate.

Run ON THE RAILWAY WEB POD (the DB lives on its /data volume):
  railway ssh --service web -- /opt/venv/bin/python scripts/seed_community_starters.py
(Plain python3 on the pod is Nix system python without app deps — always /opt/venv/bin/python.)
"""
import json
import sys

sys.path.insert(0, ".")

from api.services import community_store as store


def _doc(paragraphs):
    """Build a minimal TipTap doc from a list of paragraph strings (plain text)."""
    content = []
    for p in paragraphs:
        if p == "---BULLETS---":
            continue
        content.append({"type": "paragraph",
                        "content": [{"type": "text", "text": p}]})
    return json.dumps({"type": "doc", "content": content})


def _bullet_doc(intro, bullets, outro=None):
    content = [{"type": "paragraph", "content": [{"type": "text", "text": intro}]}]
    content.append({"type": "bulletList", "content": [
        {"type": "listItem", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": b}]}]}
        for b in bullets]})
    if outro:
        content.append({"type": "paragraph", "content": [{"type": "text", "text": outro}]})
    return json.dumps({"type": "doc", "content": content})


# (space, title, body, pinned)
STARTERS = [
    (
        "mentor-desk",
        "Welcome to The Floor",
        _bullet_doc(
            "This is The Floor — the home for the Uncharted Territory community. "
            "It's where we think out loud together, learn from every session, and hold "
            "each other to a higher standard. A few house rules so this stays a signal-rich room:",
            [
                "Be constructive and specific. \"NVDA reclaimed the 20 EMA on volume\" beats \"NVDA looks good.\"",
                "This is not financial advice. Everything here is a member opinion — do your own research and manage your own risk.",
                "No spam, no promotion, no sharing anyone else's personal information.",
                "Grade the process, not just the P&L. Wins and losses both teach.",
                "Report anything that breaks the rules — a moderator will review it.",
            ],
            "Every live session and workshop posts a discussion thread here automatically — "
            "jump in with your takeaways. Glad you're here.",
        ),
        True,
    ),
    (
        "trade-ideas",
        "What are you watching this week?",
        _doc([
            "Drop the setups on your radar — ticker, the pattern, and the level that would "
            "confirm or invalidate it. Tag tickers with $ so others can pull the chart.",
            "Keep it about the process: what's the trigger, where's the stop, what's the risk?",
        ]),
        False,
    ),
    (
        "questions",
        "How this space works",
        _doc([
            "Ask anything — a setup you're unsure about, a process question, or \"grade my trade.\"",
            "When a thread has been answered well, a mentor can mark it Answered so it's easy to find later.",
            "No question is too basic. The trader who asks learns faster than the one who guesses.",
        ]),
        False,
    ),
    (
        "wins-lessons",
        "Share a win or a lesson",
        _doc([
            "Post a trade that went right — or one that didn't — and what you took from it.",
            "The reds are worth as much as the greens here. Honest reflection is how the whole room levels up.",
        ]),
        False,
    ),
]


def _existing_titles(space):
    return {t["title"] for t in store.list_threads(space, limit=1000)}


def main():
    store._init_db()
    created = 0
    for space, title, body, pinned in STARTERS:
        if title in _existing_titles(space):
            print(f"skip (exists): [{space}] {title}")
            continue
        tid = store.create_thread(space, None, title, body=body,
                                  pinned=1 if pinned else 0)
        created += 1
        print(f"created: [{space}] {title} -> thread {tid}{' (pinned)' if pinned else ''}")
    print(f"\ndone: {created} starter thread(s) created")


if __name__ == "__main__":
    main()
