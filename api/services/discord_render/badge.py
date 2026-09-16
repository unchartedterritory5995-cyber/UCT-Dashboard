"""The ONE owner of what a member reads about a degraded delivery (step 2.7, `04-visual-spec.md`).

`contracts.BadgeRenderer` is the shape; this module is the implementation, and it is the only place
the badge, the provenance clause, the footer order and the stand-in label are decided.

⛔⛔ **ONE OWNER, BECAUSE C-06 IS WHAT TWO OWNERS LOOK LIKE.** 258 blank renders and 84 near-empty
ones produced three stand-ins, two of which never healed — and none of the three was labelled,
because labelling was something each call site had to remember. A member was handed a lower-quality
chart and told nothing, so they read it as the product. An unlabelled stand-in is worse than a
failure message: a failure is honest and a silent substitution is not.

⛔⛔ **AND IT MUST BE RARE, OR IT IS FURNITURE.** Every function here returns nothing at all on a
healthy path — which is every delivery where the upstreams answered at house quality. The first
freshness design used a fixed age budget and would have drawn a STALE badge on every chart all
weekend (§3.8b); a badge that shows when nothing is wrong teaches everyone to ignore it, and then it
is not there on the day it matters. **Every rule below answers "how often does this appear when the
system is healthy?" with "almost never".**

Three independent things can be off, and they do not collapse into one "degraded" flag (04 §1):

  * **vintage** — the DATA is behind the session it should be at (`render_badge`);
  * **provenance** — the answer did not come from the usual source (`BACKUP_CLAUSE`);
  * **quality** — the picture is not the house render (`standin_label`).

⛔ **NOT ONE SENTENCE, AND NOT A SECOND COPY OF ANY OF THEM.** The STALE sentence has exactly one
owner, `freshness.Envelope.badge`; this module *selects* it and never rewrites it. The failure copy
has exactly one owner, `contract.FAILURE_CLASSES`; `standin_label` reads that table and never
restates a class in its own words.
"""
from __future__ import annotations

from api.services.discord_render import contract, contracts, freshness
from api.services.discord_render.adapters.result import CACHED

#: Discord's hard limit. Named here from the frozen contract rather than typed again, because two
#: spellings of one limit is the second-authority defect landing on the one string a member reads.
CONTENT_MAX = contracts.CONTENT_MAX

#: Serve layers that are NOT the usual source. `in_process` is `/flow`'s local fallback leg;
#: `cache` is our own last-good copy. Both are a delivery (S8), both are labelled.
BACKUP_PROVIDERS = frozenset({"in_process", "cache"})

#: ⭐ NAMED, NOT "degraded". "a slower backup source" is something a member can act on; "degraded"
#: is a word that means nothing to them and everything to us.
BACKUP_CLAUSE = "served from a slower backup source"

#: What a stand-in says it is, before the class explains why. The word a member needs is that the
#: PICTURE is not the house one — the class explains which upstream let us down.
STANDIN_PREFIX = "⚠ simplified chart"

#: The classes that actually produce a stand-in rather than a failure message (04 §3). Kept as a
#: name so a test can assert the copy for each of them; it is a SUBSET of `contract.FAILURE_CLASSES`,
#: never a second table — `standin_label` accepts any class in that table.
STANDIN_CLASSES = ("renderer_unavailable", "deadline")

_ID = " · id "
_SEP = " · "


# ── vintage ─────────────────────────────────────────────────────────────────

def render_badge(result) -> str | None:
    """The STALE badge for ONE upstream's answer, or `None` when there is nothing to tell a member.

    ⛔⛔ **DRAWN ONLY WHEN `stale is True` — NEVER ON `None`.** Unknown vintage draws NOTHING: an
    absent badge means "we have nothing to tell you", and a badge that says "fresh" when nobody
    measured is the failure this exists to prevent. `stale` is three-valued on purpose (§3.8b) and
    `is True` is the whole guard — `if result.stale:` would read `None` as falsey and happen to be
    right, until somebody makes the unknown case explicit and inverts it.

    ⛔ **THE SENTENCE IS `Envelope.badge`, NEVER A SECOND COPY.** This returns it; it does not
    compose it. When the envelope has a stale verdict but no readable `as_of_et` there is no
    sentence to return, and we do not invent one — a warning with no timestamp in it tells a member
    that something is wrong and nothing about what.

    Takes a `Result`, but duck-typed on `.stale` / `.badge`, so a bare `freshness.Envelope` or a
    cache artifact's envelope works too. One accessor, one answer, wherever the stamp comes from.
    """
    if result is None or getattr(result, "stale", None) is not True:
        return None
    badge = getattr(result, "badge", None)
    return badge or None


def _vintage_clause(results: dict) -> str | None:
    """The badge to print when more than one upstream is stale.

    ⛔ **DETERMINISTIC, BECAUSE §3.10 SAYS THE SAME INPUT RENDERS THE SAME PIXELS.** Picking "the
    first stale one" makes the sentence depend on the order the adapters happened to be called in,
    which is not part of the input. The rule is the OLDEST vintage — the delivery is as old as its
    oldest stale part, which is the honest thing to tell a member — with the upstream's name as the
    tiebreak so two stamps of the same age still resolve the same way every time.
    """
    stale = [(getattr(r, "as_of_utc", None) or getattr(r, "as_of", None) or "", str(name), badge)
             for name, r in (results or {}).items()
             if (badge := render_badge(r))]
    return min(stale)[2] if stale else None


def vintage_param(options) -> str | None:
    """What `?stale=` carries on the house render URL, or `None` when there is nothing to say.

    C-07's structural fix is **vintage, not wall clock** (03 §3.10): the page is told the DATA's
    vintage and stamps that, so the same closed-market input renders the same pixels. The seam that
    decides it is the URL the renderer is pointed at — `discord_chart_house.build_render_url` — and
    this is the one function that turns a freshness verdict into the value it puts there.

    ⛔⛔ **THE SENTENCE TRAVELS, NOT THE DATE.** The page draws what it is handed, verbatim. Sending
    a bare `as_of` would mean the page composing `⚠ data as of … (stale)` for itself, which is a
    second author for the one sentence a member reads — and two authors over one value is exactly
    how the footer and the stats strip came to disagree on 2026-08-31. The sentence has ONE owner,
    `freshness.Envelope.badge`; `render_badge` selects it and this hands it on unchanged.

    ⛔ **AND IT IS COMPOSED BY THE ENVELOPE, NOT SPELLED AGAIN HERE.** The verdict arrives as the
    tri-state `options["stale"]` with `options["as_of"]` beside it (what a caller holding an
    `Envelope` already has: `env.stale` / `env.as_of_et`). Rather than interpolate the format
    string a second time, that pair is put back into an `Envelope` and its own `badge` is read — so
    a change to the wording still has exactly one place to happen.

    ⛔ **UNKNOWN IS NOT STALE AND FRESH IS NOT A BADGE.** `stale=False` and `stale=None` both emit
    nothing, via `render_badge`'s `is True` guard; so does a stale verdict with no readable `as_of`
    (04 §2 — a warning with no timestamp in it says something is wrong and nothing about what).
    Nothing emitted means no parameter at all, which is why the pre-V2 URL is byte-for-byte what it
    was: that path passes neither key.
    """
    opts = options or {}
    return render_badge(freshness.Envelope(
        as_of_utc=None, as_of_et=(str(opts.get("as_of")).strip() if opts.get("as_of") else None),
        provider=None, session_state="", age_s=None, budget_s=None, stale=opts.get("stale")))


# ── provenance ──────────────────────────────────────────────────────────────

def _is_backup(result) -> bool:
    """Did this answer come from somewhere other than the usual source?

    Two independent signals and BOTH are read (04 §1): the serve layer that answered
    (`Result.provider`) and the named reason a caller attached (`cached`). A cache hit is labelled
    `CACHED` by the layer that CHOSE the cache, which is not always the layer that reports itself as
    the provider — reading only one of the two loses half the cases.
    """
    if result is None or not getattr(result, "ok", False):
        return False
    if getattr(result, "provider", None) in BACKUP_PROVIDERS:
        return True
    return CACHED in (getattr(result, "degraded_reasons", ()) or ())


# ── quality ─────────────────────────────────────────────────────────────────

def standin_label(cls: str | None) -> str:
    """What a member reads on a stand-in, for one failure class.

    ⛔ **THE LABEL NAMES THE CLASS, AND THE CLASS TABLE IS `contract.FAILURE_CLASSES`.** There is no
    second table here and there must never be one: a sentence per call site is exactly how `/flow`
    spent two weeks answering "the flow feed is reconnecting" to four different causes (C-08). An
    unknown class normalises to `internal` rather than being interpolated raw, so there is nothing
    for an exception string, a URL or a traceback to leak through.

    ⛔ **AND IT GOES IN THE MESSAGE CONTENT, NOT ONLY IN THE IMAGE.** An image label is invisible to
    a screen reader and to anyone with images off — which is the same member C-06 failed.
    """
    return f"{STANDIN_PREFIX} — {contract.plain(contract.normalize_class(cls))}"


# ── the footer ──────────────────────────────────────────────────────────────

def render_footer(results: dict, corr_id: str | None, *, quality: str | None = None) -> str:
    """The ONE line appended to a degraded delivery, or `""` when there is nothing to say.

    Order is **quality · vintage · provenance · id** (04 §4), and it is that order because it is the
    order a member needs it in: what the PICTURE is, then what is wrong with the data, then where
    the answer came from, then the string they quote back to us.

    ⛔⛔ **`quality` SHARES THIS LINE; IT DOES NOT GET ONE OF ITS OWN.** `produce_chart` edits the
    same message twice — a stand-in, then the real chart — and `_drop_previous_stamp` recognises our
    previous stamp by its trailing `· id <x>` and cuts exactly ONE line. A stand-in label on a
    second line would therefore survive the edit that healed it, leaving "⚠ simplified chart" under
    a chart that is no longer simplified: C-06 inverted, and worse than C-06, because a member who
    has learnt to trust the label is now being lied to by it. Composing the clause at the call site
    instead would mean re-typing `_SEP` and `_ID` — a second authority over the one string a member
    reads, which is the defect `standin_label` exists to prevent. So it arrives here, and the one
    place that composes this line composes all of it. (Lane A, C-06 closure.)

    ⚠️ `quality=None` is the whole of the pre-existing behaviour: every call site that does not
    pass it produces the byte-identical line it produced before the parameter existed.

    ⛔ **`id` IS ALWAYS PRESENT ON A DEGRADED DELIVERY.** It is the join to the durable jobs row and
    the only thing a member can give us that identifies their request. It is printed whenever we
    have one — never filtered through a format check, because dropping the id for failing a regex
    loses the one thing this line exists to carry.

    ⛔ **AND NOTHING AT ALL WHEN NOTHING IS WRONG.** No `as_of` on a healthy chart, no "checked", no
    reassurance. An id on every delivery would be furniture with an id in it.
    """
    parts = [p for p in (quality,
                         _vintage_clause(results),
                         BACKUP_CLAUSE if any(_is_backup(r) for r in (results or {}).values()) else None)
             if p]
    if not parts:
        return ""
    return _SEP.join(parts) + (f"{_ID}{corr_id}" if corr_id else "")


def stamp(content, footer: str) -> str:
    """Put `footer` on `content`, once, within `CONTENT_MAX`.

    ⛔⛔ **WHEN IT DOES NOT FIT, THE CONTENT IS TRIMMED AND THE STAMP IS KEPT.** The other way round
    is the S8 violation with extra steps: a full-length reply whose last clause fell off is exactly
    the unlabelled stand-in C-06 describes, and it happens only on the longest replies — which are
    usually the most degraded ones, so the failure is concentrated precisely where the label matters
    most.

    ⛔ **IDEMPOTENT, AND MORE THAN IDEMPOTENT.** `produce_chart` edits the same message more than
    once (a stand-in, then the real chart). Appending on each pass warns the member twice, and a
    test that calls it once cannot see that. A stamp we wrote on an earlier edit is REPLACED rather
    than repeated, so a second pass whose vintage or provenance has changed leaves one line and not
    two. We recognise our own by the id clause — the failure contract's own copy ends in "retry?",
    so a trailing `· id <x>` line is ours.

    ⚠️ A previous stamp is only removed when there is a new one to put in its place: with no id in
    hand there is nothing that distinguishes our line from a member-facing sentence, and guessing
    would eat somebody's content.
    """
    text = _drop_previous_stamp(str(content or ""), footer)
    if not footer:
        return text
    joined = f"{text}\n{footer}" if text else footer
    if len(joined) <= CONTENT_MAX:
        return joined
    keep = CONTENT_MAX - len(footer) - 2
    return (text[:max(0, keep)].rstrip() + "\n" + footer) if keep > 0 else footer[:CONTENT_MAX]


def _drop_previous_stamp(text: str, footer: str) -> str:
    """Strip a stamp this module wrote on an earlier edit of the same message."""
    _, sep, cid = (footer or "").rpartition(_ID)
    if not sep or not cid or not text.endswith(f"{_ID}{cid}"):
        return text
    cut = text.rfind("\n")
    return text[:cut].rstrip() if cut >= 0 else ""


# ── the shape `contracts.BadgeRenderer` names ───────────────────────────────

class Badge:
    """The protocol shape as an object, for a caller that wants to hold one.

    The module itself already satisfies `contracts.BadgeRenderer`; this exists so a call site can be
    handed a renderer rather than importing one, without either of them becoming a second place the
    copy is decided — both delegate to the functions above.
    """

    def render_badge(self, result) -> str | None:
        return render_badge(result)

    def render_footer(self, results: dict, corr_id: str | None, *, quality: str | None = None) -> str:
        return render_footer(results, corr_id, quality=quality)

    def vintage_param(self, options) -> str | None:
        return vintage_param(options)

    def standin_label(self, cls: str | None) -> str:
        return standin_label(cls)

    def stamp(self, content, footer: str) -> str:
        return stamp(content, footer)


RENDERER = Badge()
