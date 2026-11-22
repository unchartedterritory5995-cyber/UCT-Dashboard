# api/services/buzz_reply.py
"""Text replies for /buzz. The image is a separate, optional layer -- if the
renderer is busy or off, the member still gets the numbers."""
from __future__ import annotations

import re

from api.services import buzz_boards

BAR_W = 18


def _bar(n: int, top: int) -> str:
    if top <= 0:
        return ""
    return "█" * max(1, round(BAR_W * n / top))


def build_board_text(now: int, window: str = "open") -> str:
    rows = buzz_boards.top_board(window, now, limit=5)
    label = buzz_boards.WINDOW_LABEL.get(window, window)
    if not rows:
        return f"No mentions counted yet for **{label}**. {buzz_boards.coverage(now)}."

    # ⛔ Scaled to the RANKED quantity -- mentions (owner ruling 2026-09-02).
    # The bar must never come from a different number than the sort, or a row
    # draws a longer bar than the row above it and the board reads as a
    # sorting bug. The RENDERED board obeys the same rule; these two lanes draw
    # one quantity and must not drift (lesson_rail_the_mirror_not_just_the_lane
    # -- that defect was fixed in the image and not here, and shipped ragged
    # text for a day).
    #
    # ⛔ max(), not rows[0]. Mentions-descending makes rows[0] the maximum
    # TODAY, but reading the first row as the maximum is an assumption about
    # the ORDER, and this quantity has already changed once. Under the earlier
    # people-led ranking rows[0] was NOT the mentions maximum, every louder row
    # drew more than BAR_W blocks, and the block ran ragged past the column
    # (2026-09-02: SNDK led on people with 25 mentions while MU had 37 -- MU
    # drew 27 blocks in an 18-wide column). max() stays correct whatever the
    # ranking does next; the same argument is written out in BuzzRender.jsx.
    #
    # ⚰️ The comment here used to OPEN with "the board ranks by distinct
    # PEOPLE, so rows[0] is not the mentions maximum". That premise died the
    # same day the ranking became mentions-led, and it is the more dangerous
    # half of a stale comment: it does not merely misinform, it argues FOR a
    # simplification to rows[0] once a reader notices the premise is false.
    top = max(r["mentions"] for r in rows)
    lines = [f"**Most talked about — {label}**", "```"]
    for r in rows:
        lines.append(f"{r['ticker']:<6}{_bar(r['mentions'], top):<{BAR_W}}  "
                     f"{r['mentions']:>3}   {r['people']:>2} ppl")
    lines.append("```")

    heat = buzz_boards.heat_board(now, limit=buzz_boards.HEAT_MARKS)
    if heat:
        # ⛔ "today" is load-bearing, not filler. heat_board is ALWAYS a
        # today-vs-30-sessions measure, so on `/buzz month` this line sits
        # under monthly totals; without the word, one header would cover
        # two different denominators.
        lines.append("\U0001f525 **Heating up today** — " +
                     " · ".join(f"{h['ticker']} {h['ratio']}x" for h in heat))
    lines.append(f"_{buzz_boards.coverage(now)}_")
    return "\n".join(lines)


def as_card(text: str, window: str = "open", *, image: str | None = None) -> dict:
    """The on-demand /buzz reply as a card in the bot's one style (discord_cards).

    Built FROM the text above, never from a second query: the numbers have one source,
    and the scheduled board, which still posts that text, cannot disagree with this card.
    The text's own shape is read back here, next to the code that writes it:

      board   "**Most talked about — <label>**", a ``` table ```, maybe a 🔥 line, "_<coverage>_"
      ticker  "**<T>** — N mention(s) from M member(s)", a `spark`, maybe a link, "_<coverage>_"
      empty   one sentence

    With `image` the rendered board is shown inside the card, so the table is left out:
    the picture IS the table, and both at once is the clutter this card replaced. Any other
    text (a builder this does not know) is shown whole, under a plain title."""
    from api.services import discord_cards
    label = buzz_boards.WINDOW_LABEL.get(window, window)
    lines = [ln for ln in str(text or "").split("\n")]
    footer_bits: list[str] = []
    if lines and lines[-1].startswith("_") and lines[-1].endswith("_") and len(lines[-1]) > 2:
        footer_bits.append(lines.pop()[1:-1])
    head = lines[0] if lines else ""
    board = head.startswith("**Most talked about")
    ticker = re.match(r"^\*\*([A-Z0-9.\-]{1,10})\*\* — (.+)$", head)
    if head.startswith("No mentions counted yet") and len(lines) == 1:
        # "No mentions counted yet for **since the open**. counted through 11:21a."
        sentence, _, rest = head.partition(". ")
        title = f"Most talked about — {label}"
        description = "No mentions counted yet."
        if rest and not footer_bits:
            footer_bits.append(rest.rstrip("."))
    elif board:
        title = head.strip("*")
        body = lines[1:]
        if image:
            out, inside = [], False
            for ln in body:
                if ln.startswith("```"):
                    inside = not inside
                    continue
                if not inside:
                    out.append(ln)
            body = out
        description = "\n".join(body).strip()
    elif ticker:
        mentions = ticker.group(2).rstrip(".")
        title = f"${ticker.group(1)} · Buzz · {label[:1].upper()}{label[1:]}"
        if mentions.startswith("no mentions"):
            # "no mentions in that window. counted through 11:21a." - the coverage rides at the end
            sentence, _, rest = mentions.partition(". ")
            description = sentence[:1].upper() + sentence[1:] + "."
            if rest and not footer_bits:
                footer_bits.append(rest.rstrip("."))
        else:
            description = "\n".join([mentions[:1].upper() + mentions[1:]] + lines[1:]).strip()
            description = description.replace("[jump to the latest]", "[Jump to the latest message]")
    else:
        title = f"Buzz · {label[:1].upper()}{label[1:]}"
        description = "\n".join(lines).strip()
    # "1 mention(s) from 1 member(s)" is the text board's shorthand; a card says it properly.
    description = re.sub(r"\b(\d+) (mention|member)\(s\)",
                         lambda m: discord_cards.plural(int(m.group(1)), m.group(2)), description)
    return discord_cards.card("buzz", title=title, description=description,
                              footer=footer_bits + ["from the room's chat"], image=image)


def build_ticker_text(ticker: str, window: str, now: int) -> str:
    d = buzz_boards.ticker_detail(ticker, window, now)
    if not d["mentions"]:
        return f"**{d['ticker']}** — no mentions in that window. {buzz_boards.coverage(now)}."
    spark = "".join("▁▂▃▅▆▇█"[min(6, v)] for v in d["spark"])
    out = [f"**{d['ticker']}** — {d['mentions']} mention(s) from {d['people']} member(s)",
           f"`{spark}`"]
    if d["link"]:
        out.append(f"[jump to the latest]({d['link']})")
    out.append(f"_{buzz_boards.coverage(now)}_")
    return "\n".join(out)
