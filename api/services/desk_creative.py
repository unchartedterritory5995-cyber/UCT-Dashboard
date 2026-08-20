"""Per-session creative titles + covers for The Desk — the Morning Wire's
headline-desk / cover-director pattern, ported into the session publish path.

Two composers, both fed the day's story (the wire brief already sitting on this
pod at /data/wire_data.json) plus the routed show, both behind deterministic
gates, and both structurally unable to break a publish:

  compose_title(...)  -> "Hook | Show — Month D, YYYY"; ANY failure returns the
                         classic "Show — Month D, YYYY" (a title always exists).
  render_cover(...)   -> framed 1280x720 JPEG bytes, or None; the caller falls
                         back to the existing per-show themed card on None.

Flags (blank/unset = exactly today's behavior; rollback is an env var):
  DESK_CREATIVE_TITLES=1   DESK_CREATIVE_THUMBS=1

The gates are the trust layer, not the prompt: a YouTube title is public
marketing, so corn, invented numbers, market-direction lies on a cautious tape,
and opener echo against recent titles are all cut deterministically — a cut
candidate costs nothing, the slate walks down, and an exhausted slate ships the
classic format. Anti-repetition is structural (history JSON on the volume),
mirroring morning-wire's substack/title_desk.py + cover_director.py.
"""
from __future__ import annotations

import io
import json
import os
import re
import zlib
from pathlib import Path

_UNSET = object()

HISTORY_KEEP = 60
RECENT_STYLE_BAN = 3        # a cover may not reuse any of the last 3 style lanes
RECENT_TITLES_SHOWN = 10    # titles shown to the desk + checked for opener echo
MAX_TITLE_LEN = 100         # YouTube hard cap
MAX_HOOK_LEN = 60

_ASSETS = Path(__file__).resolve().parent / "desk_assets"


def _data_dir() -> str:
    return os.environ.get("DESK_CREATIVE_DATA_DIR", "/data")


def date_suffix(date_text: str) -> str:
    """THE one owner of the structural '— {date}' tail every session title ends
    with, classic and creative alike. desk_daily_session derives its titles AND
    the 18:00 safety net's match from here — never restate this format."""
    return f"— {date_text}"


def classic_title(title_prefix: str, date_text: str) -> str:
    """Today's exact title format — the fallback every creative failure lands on."""
    return f"{title_prefix} {date_suffix(date_text)}"


def parse_session_title(title: str) -> tuple[str, str] | None:
    """(show, date_text) recovered from a PUBLISHED session title, classic or
    creative. Hooks are dedashed at compose time, so the last ' — ' in any
    shipped title is the structural separator by construction."""
    t = str(title or "")
    if " — " not in t:
        return None
    left, date_text = t.rsplit(" — ", 1)
    show = left.split(" | ")[-1].strip()
    date_text = date_text.strip()
    if not show or not date_text:
        return None
    return show, date_text


def titles_enabled() -> bool:
    return os.environ.get("DESK_CREATIVE_TITLES", "").strip().lower() in ("1", "true", "yes")


def thumbs_enabled() -> bool:
    return os.environ.get("DESK_CREATIVE_THUMBS", "").strip().lower() in ("1", "true", "yes")


# ---------------------------------------------------------------------------
# The day's story — distilled from the wire payload the pod already holds
# ---------------------------------------------------------------------------

def day_context() -> dict | None:
    """The compact brief both composers write against. None when the pod has
    no wire data (fresh volume) — callers then ship today's exact behavior."""
    try:
        from api.services.engine import _load_wire_data
        w = _load_wire_data()
    except Exception:
        return None
    if not w:
        return None
    exp_score = (w.get("exposure") or {}).get("score")
    if isinstance(exp_score, (int, float)):
        tone = ("risk-on" if exp_score >= 70 else
                "cautious" if exp_score >= 40 else "defensive")
        exposure = f"{int(exp_score)}%"
    else:
        tone, exposure = "cautious", ""
    gp = w.get("game_plan") or {}
    ranked = sorted(w.get("leadership") or [], key=lambda r: r.get("score", 0), reverse=True)
    leaders = [r.get("sym", "") for r in ranked[:3] if r.get("sym")]
    big_mover = ""
    for m in (w.get("movers") or {}).get("ripping") or []:
        if m.get("headline"):
            big_mover = f"{m.get('sym')} {m.get('pct')} — {m.get('headline')}"
            break
    themes = [t for t in (w.get("themes") or {}).values()
              if isinstance(t, dict) and isinstance(t.get("1W"), (int, float)) and t.get("name")]
    hot_week = ""
    if themes:
        top = max(themes, key=lambda t: t["1W"])
        hot_week = f"{top['name']} ({top['1W']:+.1f}% on the week)"
    return {
        "date": str(w.get("date") or ""),
        "phase": str((w.get("breadth") or {}).get("market_phase") or ""),
        "tone": tone,
        "exposure": exposure,
        "market_line": str(gp.get("market_line") or "").strip(),
        "tech_check": str(gp.get("tech_check") or "").strip(),
        "leaders": leaders,
        "big_mover": big_mover,
        "our_watchlist_sectors": [s for s in (w.get("leading_sectors") or [])][:3]
                                 if isinstance(w.get("leading_sectors"), list) else [],
        "background_hot_theme_this_week": hot_week,
    }


# ---------------------------------------------------------------------------
# Shared plumbing — history + the pod's LLM client
# ---------------------------------------------------------------------------

def _load_history(path) -> list:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _record(path, entry: dict, *, dedupe_keys: tuple = ()) -> None:
    try:
        hist = _load_history(path)
        if dedupe_keys:
            # One entry per session: a transcript-time cover refresh REPLACES
            # the upload-time entry (same date+show) instead of appending, so
            # RECENT_STYLE_BAN keeps spanning N sessions, not N/2.
            hist = [h for h in hist
                    if any(h.get(k) != entry.get(k) for k in dedupe_keys)]
        hist.append(entry)
        Path(path).write_text(json.dumps(hist[-HISTORY_KEEP:], ensure_ascii=False),
                              encoding="utf-8")
    except OSError:
        pass  # history is an optimization, never a failure


def _llm(system: str, user: str) -> str:
    """Claude on the pod's shared client. Runs on the scheduler thread (never
    the request path) so a longer bounded timeout than the shared 60s is safe."""
    from api.services.engine import _get_anthropic_client
    timeout = float(os.environ.get("DESK_CREATIVE_LLM_TIMEOUT_SECS", "90"))
    client = _get_anthropic_client().with_options(timeout=timeout)
    msg = client.messages.create(
        model=os.environ.get("DESK_CREATIVE_MODEL", "claude-sonnet-5"),
        max_tokens=800,
        temperature=1.0,
        # Claude 5 emits a thinking block by default, which eats max_tokens and
        # truncates the structured JSON (same trap the wire's title desk hit).
        thinking={"type": "disabled"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    # engine's hardened extractor concatenates ALL text blocks — a reply split
    # across blocks silently truncated JSON when only the first was read.
    from api.services.engine import _anthropic_text
    return _anthropic_text(msg)


def _parse_json(raw: str) -> dict:
    # engine._parse_json_block owns the resilient parse (code fences, lead-in
    # sentences, outermost {...} fallback) — its docstring records the exact
    # Sonnet-5 production incident. One owner, not a second fragile copy.
    from api.services.engine import _parse_json_block
    return _parse_json_block(raw)


# Per-show creative flavor, matched against the routed section (lowercased).
_SHOW_FLAVOR = [
    ("live trading", "in-the-arena energy: trading the live open, real positions, decisive moments"),
    ("evening", "dusk / closing-bell verdict: what today's tape actually said, what matters into tomorrow"),
    ("post-market", "dusk / closing-bell verdict: what today's tape actually said"),
    ("sunday", "pre-dawn, maps and the hunt: scanning the week's best setups before Monday opens"),
    ("workshop", "the craft: an educational deep-dive, blueprint / masterclass mood"),
    ("thoughts", "editorial macro reflection: one considered read on the tape"),
]


def _flavor(section: str) -> str:
    low = (section or "").lower()
    for kw, flavor in _SHOW_FLAVOR:
        if kw in low:
            return flavor
    return "a daily session at a professional swing-trading desk"


# ---------------------------------------------------------------------------
# The headline desk
# ---------------------------------------------------------------------------

_TITLE_SYSTEM = (
    "You title the daily session recordings of UCT Intelligence (Uncharted "
    "Territory), a swing-trading desk, the way Qullamaggie titles his streams: "
    "cool, funny, topical, a little irreverent, unmistakably written TODAY. "
    "Trader culture is the register — tickers, tape talk, market slang all "
    "welcome. Never corny clickbait, never breathless.\n"
    "THE CRAFT:\n"
    "- The hook could ONLY have been written today, from TODAY'S DATA below.\n"
    "- Tickers, sectors and events from the data are fair game and encouraged.\n"
    "- DIRECTIONAL HONESTY: the tone field is the day's read. A cautious or "
    "defensive tape is not a rally — never claim the market or a sector is "
    "ripping unless the tone backs it. A single stock's real move is fine.\n"
    "- Use no numbers that don't literally appear in the data.\n"
    "- Hook <= 55 characters. No emoji. No em-dashes.\n"
    "- Match the SHOW described below.\n"
    'Return STRICT JSON only: {"slate": ["hook1", ..., "hook6"]} — 6 distinct '
    "hooks in different forms (deadpan, stakes, image, question, contrast, "
    "declarative)."
)

# Corn that must never ship + emoji (ported from morning-wire title_desk).
_BLOCKLIST = re.compile(
    r"(?i)\b(buckle up|wild ride|brace yourself|hold on tight|shocking|insane|"
    r"unbelievable|jaw-dropping|you won'?t believe|must[- ]see|urgent|epic|"
    r"game[- ]?changer)\b")
# Wide symbol net: ‼/⁉ (general punctuation), the full arrows→dingbats→misc
# symbols range (⭐ lives in U+2B00-2BFF), variation selector, and the emoji
# planes — a narrow class let ⭐ ship past a "No emoji" gate.
_EMOJI = re.compile("[‼⁉←-⯿️\U0001F000-\U0001FAFF]")

# A MARKET/INDEX/SECTOR-subject rally claim (single-stock claims deliberately
# pass — "MRNA Rips 73%" is a fact; "The Market Is Ripping" on a cautious tape
# is a lie a member would act on).
_MKT_SUBJ = (r"(?:the\s+)?(?:market|tape|indexes?|indices|bulls?|spy|qqq|iwm|dia|"
             r"s&p|nasdaq|dow|tech|semis?|small[\s-]?caps?|megacaps?|stocks)")
_MKT_BULLISH = re.compile(
    r"(?i)\b" + _MKT_SUBJ + r"\b[^.,!?|]{0,24}?"
    r"\b(?:rip(?:s|ping|ped)?|soar\w*|surg\w*|melt(?:s|ing)?[- ]?up|rocket\w*|"
    r"explod\w*|scream\w*|skyrocket\w*|rall(?:y|ies|ying)|on\s+fire)")

_NUM = re.compile(r"\d+(?:\.\d+)?")
_WS = re.compile(r"\s+")


def _dedash(text: str) -> str:
    """Em/en-dashes out of a hook (the owner's dead-giveaway tell); the
    structural ' — date' separator is appended AFTER this, so it survives."""
    return _WS.sub(" ", re.sub(r"\s*[—–]\s*", ", ", text)).strip(" ,")


def _opener(title: str) -> str:
    words = re.sub(r"[^\w\s%$.]", "", title.lower()).split()
    return " ".join(words[:3])


def _ctx_number_tokens(ctx_text: str) -> set[str]:
    """Complete number tokens in the day's data, plus their integer parts —
    a hook saying '767' off a real 767.63 is honest rounding; '74' hiding
    inside '749.53' is a fabrication (naive substring containment let it ship)."""
    toks = set(_NUM.findall(ctx_text))
    toks |= {t.split(".")[0] for t in toks}
    return toks


def _cut_reason(hook: str, suffix: str, ctx_nums: set, tone: str,
                recent_openers: set) -> str | None:
    if not hook:
        return "empty"
    if "|" in hook:
        return "pipe (our structural separator) inside the hook"
    if len(hook) > MAX_HOOK_LEN or len(hook) + len(suffix) > MAX_TITLE_LEN:
        return "too long"
    if _EMOJI.search(hook):
        return "emoji"
    if _BLOCKLIST.search(hook):
        return "corn"
    if tone in ("cautious", "defensive") and _MKT_BULLISH.search(hook):
        return "market rally claim on a %s tape" % tone
    for num in _NUM.findall(hook):
        if num not in ctx_nums:
            return f"invented number {num}"
    if _opener(hook) in recent_openers:
        return "opener echoes a recent title"
    return None


def compose_title(*, section: str, title_prefix: str, date_text: str,
                  ctx=_UNSET, llm=None, history_path=None, record: bool = True) -> str:
    """Today's title for this session. NEVER raises — any failure ships the
    classic '{Show} — {date}' format, which is exactly today's behavior.

    record=False composes without touching history — the publish pipeline
    records via record_shipped_title() only AFTER the upload confirms, so a
    failed/retried job can't pollute the anti-echo ledger with titles that
    never shipped."""
    classic = classic_title(title_prefix, date_text)
    try:
        if ctx is _UNSET:
            ctx = day_context()
        if not ctx:
            return classic
        history_path = history_path or os.path.join(_data_dir(), "desk_title_history.json")
        hist = _load_history(history_path)
        recent = [h.get("title", "") for h in hist[-RECENT_TITLES_SHOWN:]]
        # The echo set derives from the recorded HOOK opener (fallback: strip
        # the show tail) — deriving it from the full stored title let a short
        # hook repeat verbatim because the show's first word padded the 3-gram.
        recent_openers = {h.get("opener") or _opener(str(h.get("title") or "").split(" | ")[0])
                          for h in hist[-RECENT_TITLES_SHOWN:] if h.get("title")}
        suffix = " | " + classic
        user = (f"SHOW: {title_prefix} — {_flavor(section)}\n"
                f"SESSION DATE: {date_text}\n"
                f"TODAY'S DATA (as of {ctx.get('date', '?')}):\n"
                + json.dumps(ctx, indent=1)
                + "\n\nRECENT TITLES (do not echo these, especially their opening words):\n"
                + ("\n".join(f"- {t}" for t in recent if t) or "- none"))
        raw = (llm or _llm)(_TITLE_SYSTEM, user)
        slate = _parse_json(raw).get("slate") or []
        ctx_nums = _ctx_number_tokens(json.dumps(ctx))
        tone = str(ctx.get("tone") or "")
        for cand in slate:
            hook = _dedash(str(cand).strip())
            why = _cut_reason(hook, suffix, ctx_nums, tone, recent_openers)
            if why:
                print(f"[desk-creative] title cut: {hook!r} ({why})")
                continue
            title = hook + suffix
            if record:
                _record(history_path, {"date": str(ctx.get("date") or ""),
                                       "show": title_prefix, "title": title,
                                       "opener": _opener(hook)})
            return title
        print("[desk-creative] title slate exhausted — classic format ships")
    except Exception as e:  # noqa: BLE001 — a title must always exist
        print(f"[desk-creative] title desk unavailable ({type(e).__name__}: {e}) — classic ships")
    return classic


def record_shipped_title(title: str, *, show: str, history_path=None) -> None:
    """Record a title that ACTUALLY shipped (called after the YouTube upload
    confirms). Feeds the anti-echo ledger and recall_title. Never raises."""
    try:
        history_path = history_path or os.path.join(_data_dir(), "desk_title_history.json")
        hook = title.split(" | ")[0]
        _record(history_path, {"date": "", "show": show, "title": title,
                               "opener": _opener(hook)})
    except Exception:
        pass


def recall_title(title_prefix: str, date_text: str, history_path=None) -> str | None:
    """The creative title the uploading attempt actually shipped for this
    show + date, if recorded — a re-claimed job (crash between upload and
    publish) labels the library row with the SAME title the YouTube video
    carries instead of recomposing a different one. None when unrecorded
    (the classic format then ships, which every title style ends with)."""
    try:
        history_path = history_path or os.path.join(_data_dir(), "desk_title_history.json")
        tail = " | " + classic_title(title_prefix, date_text)
        for h in reversed(_load_history(history_path)):
            t = str(h.get("title") or "")
            if t.endswith(tail):
                return t
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# The cover director
# ---------------------------------------------------------------------------

# Style lanes (ported from morning-wire cover_director — names are stable
# history/rotation keys; the scene inside a lane is invented per session).
ART_DIRECTIONS = {
    "cinematic-3d": "hyper-real 3D cinematic scene on a trading-floor / Wall Street stage, "
                    "dramatic depth of field, physical objects acting out the market story",
    "macro-still": "photoreal macro still-life — one physical object metaphor shot close on a "
                   "moody studio background (a coiled spring, a fuse, a compass, a chess piece)",
    "neon-noir": "rain-slick neon noir cityscape at night, glowing tickers and price levels in "
                 "signage, blade-runner palette",
    "nature-force": "vast natural-forces landscape as market metaphor — storm front, breaking "
                    "dawn, tidal wave, summit ridge — tiny human figure for scale",
    "isometric-diorama": "clean isometric 3D diorama of a miniature market world, toy-like "
                         "precision, one clear story happening in it",
    "vintage-poster": "1930s-1960s vintage travel-poster illustration style, bold shapes, "
                      "screen-print texture, market story as heroic scene",
    "blueprint": "engineer's blueprint / technical schematic aesthetic — the day's setup drawn "
                 "as a machine with annotated parts, cyanotype or dark-graphite paper",
    "surreal-collage": "high-end surrealist photo-collage — impossible scale juxtapositions "
                       "telling the market story, editorial-magazine finish",
    "arena": "stadium / arena / prizefight moment as market metaphor — spotlight drama, crowd "
             "in shadow, the decisive instant",
    "expedition-map": "aged explorer's map world with compass rose and charted route — the "
                      "uncharted-territory brand made literal, candlesticks as mountain ranges",
}

# Automated brand safety: an unattended pipeline may never render real people,
# politicians, or third-party brands (ported from cover_director).
_FORBIDDEN = re.compile(
    r"(?i)\b(trump|biden|obama|musk|elon|powell|yellen|bezos|zuckerberg|buffett|"
    r"celebrity|president|politician|real person|likeness|apple logo|nvidia logo|"
    r"tesla logo|company logo|nike|coca-cola|disney)\b")

_COVER_SYSTEM = (
    "You are the art director for THE DESK — the daily video library of UCT "
    "Intelligence (brand: Uncharted Territory; motifs: compass, charts, "
    "gold-on-dark). Every session gets a UNIQUE cover: one bold visual metaphor "
    "for TODAY'S market story, executed in the assigned style lane and flavored "
    "to the SHOW.\n"
    "Rules:\n"
    "- ONE clear metaphor. A cover is a poster, not a mural.\n"
    "- The metaphor must depict the day's PRIMARY story (the big mover, the "
    "leading theme, the tape's tension) — background_hot_theme_this_week is "
    "optional garnish, never the subject.\n"
    "- NO real people, NO politicians, NO celebrity likenesses, NO third-party "
    "logos or brand marks. Bulls, bears, traders-from-behind, hands, objects, "
    "cities, nature — all fine.\n"
    "- The art may work the SHOW NAME (short, all-caps) into the scene like a "
    "title card — positioned in the UPPER HALF, fully inside the central safe "
    "area, at least 15% away from every edge (the final crop is 16:9).\n"
    "- Text discipline: besides the show name, at most ONE short label. No "
    "signage full of words, no paragraphs, no tiny lettering (it renders as "
    "gibberish). NO numbers unless the exact figure appears in TODAY'S DATA "
    "verbatim.\n"
    "- scene = a single 60-120 word image-generation prompt: subject, action, "
    "setting, lighting, palette, camera, finish. End with: 'wide 16:9 "
    "composition, all text within the central safe area, ultra-detailed, no "
    "watermark'.\n"
    'Return STRICT JSON only: {"style": "<lane>", "metaphor": "<max 8 words>", '
    '"scene": "<the prompt>"}')


def _seed(text: str) -> int:
    return zlib.crc32(text.encode("utf-8"))


def _openai_generate(scene: str) -> bytes | None:
    """gpt-image-1 → PNG bytes. Bounded; None on any failure (scheduler-thread
    only — this call never sits on the request path)."""
    import base64
    import requests
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        return None
    timeout = float(os.environ.get("DESK_CREATIVE_IMAGE_TIMEOUT_SECS", "180"))
    r = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": "gpt-image-1", "prompt": scene, "size": "1536x1024",
              "quality": "medium", "n": 1},
        timeout=timeout)
    r.raise_for_status()
    b64 = (r.json().get("data") or [{}])[0].get("b64_json")
    return base64.b64decode(b64) if b64 else None


GOLD = (201, 168, 76)
CREAM = (240, 234, 216)


def _frame(png_bytes: bytes, eyebrow: str, date_text: str) -> bytes:
    """Crop to 16:9 (top-biased — mastheads live in the upper half) and stamp
    the minimal brand frame: eyebrow pill, bottom scrim, date, wordmark."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    target = 16 / 9
    if w / h > target:                       # too wide -> trim sides evenly
        nw = int(h * target)
        x = (w - nw) // 2
        img = img.crop((x, 0, x + nw, h))
    else:                                    # too tall -> keep the upper region
        nh = int(w / target)
        # The image model keeps painting the masthead flush to the TOP edge no
        # matter what the safe-area prompt says (observed on every sample), so
        # nearly all of the excess comes off the bottom — which the brand
        # scrim covers anyway.
        y = int((h - nh) * 0.08)
        img = img.crop((0, y, w, y + nh))
    img = img.resize((1280, 720), Image.LANCZOS)
    d = ImageDraw.Draw(img, "RGBA")
    fb = ImageFont.truetype(str(_ASSETS / "DejaVuSans-Bold.ttf"), 30)
    fs = ImageFont.truetype(str(_ASSETS / "DejaVuSans.ttf"), 26)
    tw = d.textlength(eyebrow, font=fb)
    d.rounded_rectangle([36, 34, 36 + tw + 44, 96], 31,
                        fill=(12, 12, 10, 215), outline=GOLD, width=2)
    d.text((58, 48), eyebrow, font=fb, fill=GOLD)
    scrim = Image.new("RGBA", (1280, 110), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for i in range(110):
        sd.line([(0, i), (1280, i)], fill=(8, 8, 6, int(170 * i / 110)))
    img.paste(Image.alpha_composite(
        img.crop((0, 610, 1280, 720)).convert("RGBA"), scrim).convert("RGB"), (0, 610))
    d = ImageDraw.Draw(img)
    d.text((40, 664), date_text, font=fb, fill=CREAM)
    wm = "UNCHARTED TERRITORY"
    d.text((1240 - d.textlength(wm, font=fs), 668), wm, font=fs, fill=GOLD)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def _direct(ctx: dict, eyebrow: str, section: str, date_text: str,
            banned: list, llm) -> dict | None:
    """One art-director call; brand-safety validated with ONE re-ask."""
    user = (f"SHOW: {eyebrow} — {_flavor(section)}\n"
            f"SESSION DATE: {date_text}\n"
            f"STYLE LANES (pick ONE; these are BANNED, used recently: {banned or 'none'}):\n"
            + json.dumps(ART_DIRECTIONS, indent=1)
            + f"\n\nTODAY'S DATA (as of {ctx.get('date', '?')}):\n"
            + json.dumps(ctx, indent=1))
    for attempt in range(2):
        spec = _parse_json(llm(_COVER_SYSTEM, user))
        scene = str(spec.get("scene") or "")
        if scene and not _FORBIDDEN.search(scene + " " + str(spec.get("metaphor") or "")):
            return spec
        print(f"[desk-creative] cover scene rejected (brand safety), attempt {attempt + 1}")
        user += "\n\nYour previous scene violated brand safety (no real people/brands). Try again."
    return None


def render_cover(*, section: str, eyebrow: str, date_text: str,
                 ctx=_UNSET, llm=None, imagegen=None, history_path=None,
                 facts: dict | None = None) -> bytes | None:
    """A unique framed cover for this session, or None (caller then ships the
    existing per-show themed card). NEVER raises.

    facts: optional session-specific truths merged into the day brief — the
    insights pass uses this to re-skin a cover with what the session ACTUALLY
    discussed once the transcript lands (headline + tickers)."""
    try:
        if ctx is _UNSET:
            ctx = day_context()
        if not ctx:
            return None
        if facts:
            ctx = {**ctx, **facts}
        history_path = history_path or os.path.join(_data_dir(), "desk_cover_history.json")
        hist = _load_history(history_path)
        banned = [h.get("style") for h in hist[-RECENT_STYLE_BAN:] if h.get("style")]
        spec = _direct(ctx, eyebrow, section, date_text, banned, llm or _llm)
        if not spec:
            return None
        style = str(spec.get("style") or "")
        scene = str(spec.get("scene") or "")
        if style not in ART_DIRECTIONS or style in banned:
            # The director ignored the ban (or invented a lane). Steer the
            # RENDER, not just the record: a date-seeded allowed lane replaces
            # it and its art direction LEADS the scene prompt, so the image
            # actually leaves the banned lane rather than shipping the exact
            # repetition RECENT_STYLE_BAN exists to stop.
            lanes = [k for k in ART_DIRECTIONS if k not in set(banned)] or list(ART_DIRECTIONS)
            style = lanes[_seed(f"{date_text}|{eyebrow}") % len(lanes)]
            scene = f"{ART_DIRECTIONS[style]}. {scene}"
        png = (imagegen or _openai_generate)(scene)
        if not png:
            return None
        jpeg = _frame(png, eyebrow, date_text)
        _record(history_path, {"date": str(ctx.get("date") or ""), "show": eyebrow,
                               "style": style, "metaphor": str(spec.get("metaphor") or "")},
                dedupe_keys=("date", "show"))
        return jpeg
    except Exception as e:  # noqa: BLE001 — cosmetic, never breaks publish
        print(f"[desk-creative] cover director unavailable ({type(e).__name__}: {e})")
        return None
