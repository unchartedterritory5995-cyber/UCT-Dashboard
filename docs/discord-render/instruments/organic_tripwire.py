"""R10 — the S2 organic-arrival tripwire.

⛔⛔ WHAT IT IS FOR. An S2 load run drives synthetic interactions against PRODUCTION. If a
real member (or the owner, or a scheduled job) uses a chart command while that run is in
flight, two things are true at once and neither is acceptable: the member's latency is
polluted by our load, and our percentiles are polluted by their arrival. The run must stop.

⛔ AND IT MUST STOP ON THE FIRST ONE, NOT THE SECOND. A tripwire that tolerates "a little"
organic traffic is a tripwire that has decided how much member harm is acceptable, which is
not a decision an instrument gets to make. First organic arrival -> PAUSE. A second inside
`ABORT_WINDOW_S` -> ABORT, because two arrivals in a minute is a room that is awake.

⭐ WHY SNOWFLAKES AND NOT TIMESTAMPS. Every Discord message id IS a timestamp — bits 22+ are
milliseconds since the Discord epoch. So "has anything new appeared since I last looked" is a
single integer comparison against the last id we saw, with no clock of ours involved and no
dependence on the channel's own ordering guarantees. A wall-clock cutoff would need OUR clock
to agree with Discord's, which is exactly the assumption `_emit_ack_timing` had to disclaim.

⛔ THE HARNESS TAG IS WHAT MAKES OUR OWN TRAFFIC INVISIBLE, AND IT IS CHECKED POSITIVELY.
A message is ours only if it CARRIES the tag. Anything else — a member, a cron post, a
message whose shape we did not anticipate — is organic. Failing toward "organic" means the
worst case is a run that stops when it did not have to; failing the other way means a run
that keeps driving load at a member.

Run the controls:  python docs/discord-render/instruments/organic_tripwire.py
"""
from __future__ import annotations

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
for _p in (str(HERE),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

#: Discord's epoch, ms. A snowflake's upper 42 bits are ms since this instant.
DISCORD_EPOCH_MS = 1420070400000
#: How often to look. R10 fixes this at 10 s.
POLL_INTERVAL_S = 10.0
#: A second organic arrival inside this window escalates PAUSE to ABORT.
ABORT_WINDOW_S = 60.0

RUNNING, PAUSED, ABORTED = "RUNNING", "PAUSED", "ABORTED"


class HotSpin(ValueError):
    """Raised when the poll interval would busy-loop.

    ⛔ A zero or negative interval is not "poll as fast as possible" — it is a tight loop on
    the operator's box hammering Discord's API, which earns a 429 and makes the tripwire the
    thing that disturbs the room it is watching."""


def snowflake_ms(snowflake) -> int:
    """The millisecond timestamp carried inside a Discord snowflake."""
    return (int(snowflake) >> 22) + DISCORD_EPOCH_MS


def is_ours(message: dict, tag: str) -> bool:
    """True only if the message CARRIES the harness tag. Absence is organic, by design."""
    if not tag:
        return False
    for field in ("content", "nonce"):
        if tag in str(message.get(field) or ""):
            return True
    for embed in (message.get("embeds") or []):
        if tag in str(embed.get("footer", {}).get("text") or ""):
            return True
    return False


class Tripwire:
    """Watches a set of channels for organic arrivals. Pure: you feed it messages."""

    def __init__(self, channels, tag: str, *, poll_interval_s: float = POLL_INTERVAL_S,
                 abort_window_s: float = ABORT_WINDOW_S):
        if poll_interval_s <= 0:
            raise HotSpin(f"poll interval {poll_interval_s!r} would busy-loop; R10 fixes it at "
                          f"{POLL_INTERVAL_S}s")
        self.channels = tuple(str(c) for c in channels if str(c or "").strip())
        self.tag = tag
        self.poll_interval_s = poll_interval_s
        self.abort_window_s = abort_window_s
        self.state = RUNNING
        self.seen_since = {c: 0 for c in self.channels}
        self.organic: list = []          # (channel, snowflake, ms) of every organic arrival

    def observe(self, channel: str, messages) -> str:
        """Feed one channel's newest messages. Returns the state after looking."""
        channel = str(channel)
        floor = self.seen_since.get(channel, 0)
        for m in sorted(messages, key=lambda m: int(m["id"])):
            sf = int(m["id"])
            if sf <= floor:
                continue                      # already accounted for
            self.seen_since[channel] = max(self.seen_since.get(channel, 0), sf)
            if is_ours(m, self.tag):
                continue
            ms = snowflake_ms(sf)
            self.organic.append((channel, sf, ms))
            if self.state == RUNNING:
                self.state = PAUSED
            elif self.state == PAUSED:
                first_ms = self.organic[0][2]
                if (ms - first_ms) / 1000.0 <= self.abort_window_s:
                    self.state = ABORTED
        return self.state

    def citation(self) -> str:
        """The snowflake to quote in the report. An arrival with no snowflake is an anecdote."""
        if not self.organic:
            return "none"
        ch, sf, ms = self.organic[0]
        return f"channel={ch} snowflake={sf} ms={ms}"


def watched_channels(env: dict) -> tuple:
    """Every channel an S2 run must watch: the allowlist plus the smoke channel.

    ⛔ BOTH ENTRIES OF THE ALLOWLIST, NOT JUST THE PRIMARY. `CHART_FLOW_CHANNEL_ID` is
    comma-separated and its SECOND entry is `#render-smoke`; watching only the first would
    leave the very channel the run drives unwatched."""
    raw = (env.get("CHART_FLOW_CHANNEL_ID") or env.get("FLOW_CMD_CHANNEL_ID") or "")
    out = [p.strip() for p in raw.split(",") if p.strip()]
    fallback = (env.get("FLOW_CMD_CHANNEL_ID") or "").strip()
    if fallback and fallback not in out:
        out.append(fallback)
    smoke = (env.get("DISCORD_RENDER_SMOKE_CHANNEL") or "1549129739048853544").strip()
    if smoke and smoke not in out:
        out.append(smoke)
    return tuple(out)


def _sf(ms_offset: int, base: int = 1_100_000_000_000_000_000) -> int:
    """A synthetic snowflake `ms_offset` ms after a base one."""
    return base + (ms_offset << 22)


def self_check(out=print) -> int:
    from selfcheck import Cases
    cases = Cases("organic_tripwire")
    TAG = "uct-s2-harness"
    CH = "1549129739048853544"

    # ── the three fixtures R10 names ──────────────────────────────────────────
    t = Tripwire([CH], TAG)
    t.observe(CH, [{"id": _sf(0), "content": f"chart {TAG}"}])
    cases.add("harness-tagged traffic only -> no pause", t.state == RUNNING)

    t = Tripwire([CH], TAG)
    t.observe(CH, [])
    cases.add("no messages at all -> no pause", t.state == RUNNING)

    t = Tripwire([CH], TAG)
    t.observe(CH, [{"id": _sf(0), "content": "hey what's NVDA doing"}])
    cases.add("ONE organic message -> PAUSE", t.state == PAUSED)
    cases.add("...and the pause cites a snowflake", "snowflake=" in t.citation())

    # ── escalation ────────────────────────────────────────────────────────────
    t = Tripwire([CH], TAG)
    t.observe(CH, [{"id": _sf(0), "content": "one"}])
    t.observe(CH, [{"id": _sf(30_000), "content": "two"}])
    cases.add("a SECOND organic inside 60 s -> ABORT", t.state == ABORTED)

    t = Tripwire([CH], TAG)
    t.observe(CH, [{"id": _sf(0), "content": "one"}])
    t.observe(CH, [{"id": _sf(90_000), "content": "two"}])
    cases.add("a second organic AFTER 60 s stays PAUSED, not ABORTED", t.state == PAUSED)

    # ── non-vacuity: the tag check must be able to say BOTH things ────────────
    cases.add("CONTROL: is_ours sees a tagged message", is_ours({"content": f"x {TAG}"}, TAG))
    cases.add("CONTROL: is_ours rejects an untagged one", not is_ours({"content": "x"}, TAG))
    cases.add("CONTROL: an empty tag makes NOTHING ours (fails toward organic)",
              not is_ours({"content": "anything"}, ""))

    # ── the floor really does suppress re-counting ────────────────────────────
    t = Tripwire([CH], TAG)
    m = {"id": _sf(0), "content": "one"}
    t.observe(CH, [m]); t.observe(CH, [m])
    cases.add("the same message seen twice counts ONCE (no false ABORT)",
              t.state == PAUSED and len(t.organic) == 1)

    # ── the hot-spin rail ─────────────────────────────────────────────────────
    refused = False
    try:
        Tripwire([CH], TAG, poll_interval_s=0)
    except HotSpin:
        refused = True
    cases.add("a poll interval of 0 is REFUSED (hot-spin rail)", refused)
    cases.add("CONTROL: the normal interval is accepted",
              Tripwire([CH], TAG, poll_interval_s=POLL_INTERVAL_S).poll_interval_s == 10.0)

    # ── the watch list covers BOTH allowlist entries plus the smoke channel ───
    ch = watched_channels({"CHART_FLOW_CHANNEL_ID": "1546563720702853280,1549129739048853544",
                           "FLOW_CMD_CHANNEL_ID": "1546563720702853280"})
    cases.add("watch list includes the member-facing channel", "1546563720702853280" in ch)
    cases.add("watch list includes #render-smoke", "1549129739048853544" in ch)
    cases.add("watch list has no duplicates", len(ch) == len(set(ch)))

    # ── snowflake arithmetic ──────────────────────────────────────────────────
    cases.add("snowflake_ms is monotonic in the snowflake",
              snowflake_ms(_sf(0)) < snowflake_ms(_sf(1000)))
    cases.add("snowflake_ms lands in a sane epoch (> 2015)",
              snowflake_ms(_sf(0)) > DISCORD_EPOCH_MS)

    return 0 if cases.report(out) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(self_check())
