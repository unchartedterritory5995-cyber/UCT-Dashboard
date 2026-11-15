"""One card style for every text answer the UCT Intelligence bot gives in Discord.

Owner ask 2026-11-14: "perfect and organized and wonderful and consistent on the cards
throughout all of them". /news already answered with a branded embed; /lesson answered
with plain text and /buzz with a code block over an image. They now all come from
`card()`, so they share one frame:

    UCT INTELLIGENCE · <SECTION>            (the UCT mark, same as the UCT News cards)
    <title>
    <body>
    <count> · <what it is> · uctintelligence.com          <time>

in UCT gold. The section names the command family (NEWS, LESSONS, BUZZ), the title says
what was asked, the footer says how much there is and where it came from.

⛔ This is the ONE place the brand lives. A command that builds its own author line,
colour or footer is a second authority over the same look, and the two drift: change
it here.

Image answers (/chart, /flow, /cot) are rendered cards already, and stay as they are:
an embed would shrink the picture.
"""
from __future__ import annotations

import datetime as dt

#: UCT gold: the UCT News cards, recaps and this frame.
GOLD = 0xDCBB5E
#: The UCT mark, served by the dashboard as a real PNG (the /UCT_logo_*.png paths return
#: the SPA's HTML).
MARK_URL = "https://uctintelligence.com/live-trading-room/mark-256.png"
SITE = "uctintelligence.com"
#: Discord's own limits for an embed.
TITLE_MAX = 256
DESCRIPTION_MAX = 4096
FOOTER_MAX = 2048


def card(section: str, *, title: str, description: str, footer: list[str],
         now: dt.datetime | None = None, image: str | None = None) -> dict:
    """A branded embed. `footer` is the short facts before the site name, e.g.
    ["3 lessons", "TSDR & Bracco video lessons"]. `image` is the filename of a PNG sent
    with the same message; it is shown inside the card (attachment://<image>)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    out = {
        "author": {"name": f"UCT INTELLIGENCE · {section.upper()}", "icon_url": MARK_URL},
        "title": title[:TITLE_MAX],
        "color": GOLD,
        "footer": {"text": " · ".join([b for b in footer if b] + [SITE])[:FOOTER_MAX],
                   "icon_url": MARK_URL},
        "timestamp": now.astimezone(dt.timezone.utc).isoformat(),
    }
    # No body is no body: a placeholder character draws an empty line under the title
    # (seen on the /buzz board card in Discord, 2026-11-14), and Discord accepts a card
    # with a title and no description.
    if description and description.strip("​ \n"):
        out["description"] = description[:DESCRIPTION_MAX]
    if image:
        out["image"] = {"url": f"attachment://{image}"}
    return out


def without_image(embed: dict) -> dict:
    """The same card with no picture: for a reply whose image Discord refused."""
    return {k: v for k, v in embed.items() if k != "image"}


def plural(n: int, one: str, many: str | None = None) -> str:
    """'1 lesson', '3 lessons'."""
    return f"{n} {one if n == 1 else (many or one + 's')}"
