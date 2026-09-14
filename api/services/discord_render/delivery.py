"""Discord delivery for the V2 runtime: every call returns a RESULT with a named class,
never a bare bool.

⛔ The pre-V2 jobs call `edit_original` and ignore what it returns. Over 2026-08-30..09-13
that dropped 23 `10015 Unknown Webhook` and 23 double-failed `ATTACHMENT_NOT_FOUND` edits
on the floor: the job reported "ok" and the member sat on "thinking…". A result that
nobody reads is the same as no result, so here the result is a value the caller has
to unpack (**C-11**: those 46 finals produced no member message at all).

Step 2.1 shipped the two calls the runtime itself needs (a text edit of @original and a
follow-up). Step 2.6 adds the policy, and every rule below is one measured failure class
from `docs/discord-render/01-failure-forensics.md`:

  * **429 — honour `retry_after`, bounded by the caller's budget.** A delivery that sleeps
    30 s inside a 15 s deadline has already lost: the watchdog has told the member
    something else by then and the worker was held for nothing. The wait is taken only
    when it FITS; otherwise the result says `rate_limited` honestly and now.
  * **5xx / transport — bounded retries with JITTER**, from `breakers.retry_delay`, which
    is the one delay authority on this path. A fixed delay (the bars path's 1.5 s)
    re-synchronises every caller that failed together, so the retry storm arrives in one
    spike (03 §3.8).
  * **`10015 Unknown Webhook` — TERMINAL, never retried.** 23 of these in the fortnight,
    22 of them in RTH: the interaction token expired or the message is gone, and a retry
    spends budget on something that can never succeed. It is classified apart from every
    other 4xx, and `token_dead` is what `runtime._finalize` reads to answer `ack_late`
    rather than `internal`.
  * **Component trees are validated HERE, before they are sent.** `COMPONENT_INVALID_EMOJI`
    made Discord refuse the WHOLE tree **33** times (**C-03**): every expanded chart lost
    its controls for a week because one collapse button carried ▲ (U+25B2), a text symbol
    that is not an emoji. An invalid tree is dropped with the class recorded and the
    message is still delivered — losing a button beats losing the message.
  * **`attachments` are re-declared, so a TEXT-ONLY edit cannot drop the chart.** A PATCH
    that names no attachments is a PATCH that keeps none of them. ⛔ The other direction is
    **C-04**: re-declaring ids the message no longer has produced 23 double-failed edits
    with **0 %** correlation to load — a deterministic payload fault — which is why
    `ATTACHMENT_NOT_FOUND` is terminal and carries its own reason instead of being retried.

⛔⛔ THE TOKEN MUST NEVER REACH A LOG. The edit URL is
`/webhooks/<app>/<interaction token>/messages/@original`, and that token is a live
15-minute bearer credential — so an httpx error's traceback IS the credential, printed with
the request URL in it. `log.exception` is forbidden on this path (AST rail:
`tests/test_discord_render_observe.py::test_no_module_in_the_v2_package_calls_log_exception`);
every exception here goes through `observe.exception`, which scrubs, and no event this
module emits carries a URL or a token at all. That is **C-13** — the chart-renderer logged
its render token in plaintext 142 times — kept out of a second place.
"""
from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass, replace

from api.services.discord_render import breakers, contract, observe

DISCORD_API = "https://discord.com/api/v10"
EPHEMERAL = 64
#: Ceiling on ONE request. The effective timeout is the smaller of this and what is left of
#: the caller's budget — a per-call constant answers "how long may Discord take", only the
#: caller knows "how long is there left" (`runtime.Job.remaining_s`).
TIMEOUT_S = 10.0
#: Total wall clock one delivery may spend when the caller does not say. Deliberately small:
#: this module runs on a render worker, and a worker held here is a worker not rendering.
DEFAULT_BUDGET_S = 8.0
#: Below this there is not enough time left for a round trip to be worth starting.
MIN_USEFUL_S = 0.25
#: Total tries, first attempt included. 03 §3.4: "max 3 tries, bounded by the deadline".
MAX_ATTEMPTS = 3

#: One image PATCH may take longer than one JSON PATCH, because it is carrying the chart.
#: Measured basis: the pre-V2 `discord_interactions.edit_original` used a flat 15 s client
#: timeout for the same request and produced no timeout failures in the fortnight `01` covers —
#: the 23 failures were 4xx refusals, not slow uploads. 20 s is that number with headroom, and
#: like every other timeout on this path it is a CEILING: `min(this, the budget left)` wins.
IMAGE_TIMEOUT_S = 20.0

#: The image delivery's own default budget. Larger than `DEFAULT_BUDGET_S` for the same reason,
#: and still only a default — the job's remaining time is passed in as `deadline_s` and is the
#: number that actually binds.
IMAGE_BUDGET_S = 20.0

#: Refuse an upload Discord would refuse, before spending a round trip on it.
#:
#: ⛔ 25 MiB IS DISCORD'S **BASELINE** (Tier-0) ATTACHMENT LIMIT, SO THIS GUARD CAN ONLY EVER
#: REFUSE SOMETHING THE UNBOOSTED CASE WOULD ALSO REFUSE. A boosted guild allows more; refusing
#: at the baseline is therefore conservative in the one direction that costs a member nothing,
#: because a refusal here does NOT mean silence — `edit_image` falls back to a text edit that
#: says what happened (C-11: a delivery failure must still end in a sentence).
#:
#: ⚠️ It is not a substitute for measuring. A house chart PNG is ~100-500 KB; anything within two
#: orders of magnitude of this ceiling is a render defect, and `image_too_large` is the event that
#: says so rather than a 40005 nobody can attribute.
ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
#: Spread added to a server-dictated `retry_after`, drawn through `breakers.retry_delay` so
#: there is still exactly one jitter authority. Without it every caller Discord rate-limited
#: in the same bucket comes back in the same millisecond.
RETRY_AFTER_JITTER_S = 0.25

# ── Discord JSON error codes (the ones this path has actually seen) ─────────
UNKNOWN_WEBHOOK = 10015          # the interaction token no longer accepts edits
UNKNOWN_MESSAGE = 10008          # the message itself is gone
INVALID_FORM_BODY = 50035        # the payload was refused; `errors` says which part
REQUEST_TOO_LARGE = 40005
MISSING_PERMISSIONS = 50013

# ── reasons: finer than the §3.5 classes, and deliberately so ──────────────
# A member is told one of thirteen sentences (`contract.FAILURE_CLASSES`). An engineer needs
# to know which of five different things went wrong behind the same sentence, and the jobs
# table needs the finer one to make the next fortnight's forensics a query rather than a
# fortnight. ⛔ `contract` stays the single owner of what is SAID; this is what happened.
OK = "ok"
TOKEN_DEAD = "token_dead"
RATE_LIMITED = "rate_limited"
RATE_LIMIT_OVER_DEADLINE = "rate_limit_over_deadline"
COMPONENTS_REJECTED = "components_rejected"
ATTACHMENT_NOT_FOUND = "attachment_not_found"
TOO_LARGE = "too_large"
FORBIDDEN = "forbidden"
REJECTED = "rejected"
SERVER_ERROR = "server_error"
TRANSPORT = "transport"

#: reason → the §3.5 class the member is told. Several reasons share a sentence; that is the
#: point of the table — "Discord refused the message" is true of all four rejections and is
#: the only one of them a member can act on.
_CLASS_FOR = {
    TOKEN_DEAD: "ack_late",
    RATE_LIMITED: "rate_limited",
    RATE_LIMIT_OVER_DEADLINE: "rate_limited",
    COMPONENTS_REJECTED: "discord_rejected",
    ATTACHMENT_NOT_FOUND: "discord_rejected",
    TOO_LARGE: "discord_rejected",
    FORBIDDEN: "discord_rejected",
    REJECTED: "discord_rejected",
    SERVER_ERROR: "internal",
    TRANSPORT: "internal",
}

#: ⛔ A code that can never succeed on a second attempt. 10015 is the whole reason this set
#: exists: retrying a dead interaction token burns the job's remaining budget on a request
#: whose answer is already known.
TERMINAL_CODES = frozenset({UNKNOWN_WEBHOOK, UNKNOWN_MESSAGE, INVALID_FORM_BODY,
                            REQUEST_TOO_LARGE, MISSING_PERMISSIONS})


def class_for(reason: str) -> str:
    """The member-visible class for a delivery reason. Always one `contract` can speak."""
    return contract.normalize_class(_CLASS_FOR.get(reason))


@dataclass(frozen=True)
class DeliveryResult:
    ok: bool
    status: int | None = None          # HTTP status; None = no response (transport failure)
    code: int | None = None            # Discord JSON error code, when there was one
    detail: str = ""                   # short, scrubbed, never contains the token
    reason: str = ""                   # what happened here (the finer taxonomy above)
    cls: str = ""                      # what the member is told (`contract.FAILURE_CLASSES`)
    attempts: int = 0
    waited_s: float = 0.0              # seconds actually slept honouring a retry
    retryable: bool = False
    retry_after: float | None = None   # what Discord asked for, when it asked
    dropped: tuple = ()                # parts refused pre-flight, e.g. ("components",)
    #: The message Discord returned on a 2xx, when it returned a readable one.
    #: ⛔ THIS EXISTS FOR ONE CALLER AND IT IS NOT AN INVITATION. `run_chart_job`'s context
    #: follow-up reads `attachments` off the first edit's response to decide what to re-declare,
    #: and that is the C-04 path. `edit_fn` hands this back so the pre-V2 call site keeps the
    #: exact contract it has always had — while the wrapper above it makes the ids it derives
    #: irrelevant by re-uploading the bytes. Do not start a second consumer of it.
    message: dict | None = None

    @property
    def token_dead(self) -> bool:
        """10015 Unknown Webhook / 404: the interaction token no longer accepts edits."""
        return self.code in (UNKNOWN_WEBHOOK, UNKNOWN_MESSAGE) or self.status == 404


# ── pre-flight validation (C-03) ────────────────────────────────────────────

MAX_ROWS = 5
MAX_BUTTONS_PER_ROW = 5
MAX_SELECT_OPTIONS = 25
MAX_SELECT_DEFAULTS = 1
MAX_CUSTOM_ID = 100
MAX_LABEL = 80
MAX_PLACEHOLDER = 150

ACTION_ROW, BUTTON, STRING_SELECT = 1, 2, 3
LINK_STYLE = 5

#: The emoji this product actually puts on a component. ⛔ An ALLOW-LIST, not a plausibility
#: test: ▲ (U+25B2) looks exactly as emoji-ish as 🔼 (U+1F53C) to any rule short of Unicode's
#: own emoji property table, and it is the one that stripped every chart's controls for a
#: week. `tests/test_discord_render_delivery.py` DERIVES the emoji the component builders use
#: from their AST and fails if any of them is missing here, so this cannot silently drift
#: behind the code it guards.
EMOJI_ALLOWED = frozenset({
    "\U0001F4C8",          # 📈 View chart
    "⚙️",        # settings (with the VS-16 Discord needs to read it as an emoji)
    "\U0001F30A",          # 🌊 Dark Pools
    "\U0001F53C",          # 🔼 collapse — the ▲ it replaced is exactly what this list refuses
})


def validate_components(components) -> list[str]:
    """Every problem Discord would refuse the whole tree for, found HERE. [] = the tree is fine.

    ⛔ Discord validates the WHOLE message: one bad emoji four buttons deep does not lose that
    button, it loses the message. That is why this is a pre-flight and not a repair."""
    if components is None:
        return []
    if not isinstance(components, list):
        return ["components must be a list of action rows"]
    problems: list[str] = []
    if len(components) > MAX_ROWS:
        problems.append(f"{len(components)} rows (max {MAX_ROWS})")
    seen_ids: set[str] = set()
    for i, row in enumerate(components):
        if not isinstance(row, dict) or row.get("type") != ACTION_ROW:
            problems.append(f"row {i} is not an action row")
            continue
        children = row.get("components")
        if not isinstance(children, list):
            problems.append(f"row {i} has no component list")
            continue
        buttons = [c for c in children if isinstance(c, dict) and c.get("type") == BUTTON]
        if len(buttons) > MAX_BUTTONS_PER_ROW:
            problems.append(f"row {i} has {len(buttons)} buttons (max {MAX_BUTTONS_PER_ROW})")
        for j, c in enumerate(children):
            problems += _validate_child(c, f"{i}.{j}", seen_ids)
    return problems


def _validate_child(c, where: str, seen_ids: set[str]) -> list[str]:
    problems: list[str] = []
    if not isinstance(c, dict):
        return [f"component {where} is not an object"]
    cid = c.get("custom_id")
    if cid is not None:
        cid = str(cid)
        if len(cid) > MAX_CUSTOM_ID:
            problems.append(f"component {where} custom_id is {len(cid)} chars (max {MAX_CUSTOM_ID})")
        if cid in seen_ids:
            # Discord requires every custom_id in ONE message to be unique; a duplicate is
            # refused at the message level, not silently deduplicated.
            problems.append(f"component {where} repeats custom_id {cid[:40]!r}")
        seen_ids.add(cid)
    label = c.get("label")
    if label is not None and len(str(label)) > MAX_LABEL:
        problems.append(f"component {where} label is {len(str(label))} chars (max {MAX_LABEL})")
    placeholder = c.get("placeholder")
    if placeholder is not None and len(str(placeholder)) > MAX_PLACEHOLDER:
        problems.append(f"component {where} placeholder is {len(str(placeholder))} chars "
                        f"(max {MAX_PLACEHOLDER})")
    emoji = c.get("emoji")
    if emoji is not None:
        name = emoji.get("name") if isinstance(emoji, dict) else None
        if not (isinstance(emoji, dict) and emoji.get("id")) and name not in EMOJI_ALLOWED:
            # ⛔ THE ONE THAT COST A WEEK. Never widen this by adding the offending character;
            # add the emoji to EMOJI_ALLOWED only when it is a real emoji Discord accepts.
            problems.append(f"component {where} emoji {name!r} is not in the allow-list")
    if c.get("type") == BUTTON and c.get("style") != LINK_STYLE and not c.get("custom_id"):
        problems.append(f"component {where} is a button with no custom_id")
    if c.get("type") == STRING_SELECT:
        options = c.get("options")
        if not isinstance(options, list) or not options:
            problems.append(f"component {where} is a select with no options")
        else:
            if len(options) > MAX_SELECT_OPTIONS:
                problems.append(f"component {where} has {len(options)} options "
                                f"(max {MAX_SELECT_OPTIONS})")
            defaults = sum(1 for o in options if isinstance(o, dict) and o.get("default"))
            if defaults > MAX_SELECT_DEFAULTS:
                problems.append(f"component {where} has {defaults} defaults "
                                f"(max {MAX_SELECT_DEFAULTS})")
    return problems


def _safe_components(components, *, cid: str = "") -> tuple[list | None, tuple]:
    """The tree if Discord would take it; otherwise None and a recorded drop.

    ⛔ Dropping the tree and SENDING is the deliberate trade. C-03's members got the chart
    with no controls AND a private apology because Discord refused the payload; the message
    surviving without a button is strictly better than the message not arriving."""
    problems = validate_components(components)
    if not problems:
        return components, ()
    observe.event("components_invalid", cid=cid, cls=class_for(COMPONENTS_REJECTED),
                  outcome="dropped", detail="; ".join(problems)[:200])
    return None, ("components",)


# ── attachments ─────────────────────────────────────────────────────────────

def attachments_payload(attachments) -> list:
    """`[{"id": "0"}, …]` — the ids a PATCH means to KEEP.

    Discord treats the `attachments` array of an edit as the full list the message should end
    up with, so a text-only edit that omits an id it already has DROPS that file. Passing the
    ids through is how a context line lands under a chart instead of replacing it.

    ⛔ Only pass ids the message provably still has. Re-declaring a stale id is C-04:
    `ATTACHMENT_NOT_FOUND`, both attempts, 23 times, and the member got no chart at all."""
    out = []
    for a in attachments or []:
        aid = a.get("id") if isinstance(a, dict) else a
        if aid is None:
            continue
        item = {"id": str(aid)}
        if isinstance(a, dict) and a.get("filename"):
            item["filename"] = str(a["filename"])
        out.append(item)
    return out


# ── the two calls the runtime makes ─────────────────────────────────────────

def edit_text(app_id: str, token: str, *, content: str, components: list | None = None,
              attachments: list | None = None, client=None, deadline_s: float | None = None,
              cid: str = "", **policy) -> DeliveryResult:
    """PATCH @original with text (and optionally component rows). Never raises.

    `attachments` re-declares the ids this edit means to keep — omit it to say nothing about
    attachments at all, pass `[]` to deliberately clear them. `deadline_s` is how long this
    delivery may spend in total; see `DEFAULT_BUDGET_S` for what it does without one."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    comps, dropped = _safe_components(components, cid=cid)
    payload: dict = {"content": content[:contract.CONTENT_MAX], "allowed_mentions": {"parse": []}}
    if comps is not None:
        payload["components"] = comps
    if attachments is not None:
        payload["attachments"] = attachments_payload(attachments)
    return _send("patch", url, payload, client, deadline_s=deadline_s, cid=cid,
                 dropped=dropped, **policy)


def edit_image(app_id: str, token: str, *, content: str, images, components: list | None = None,
               client=None, deadline_s: float | None = None, cid: str = "",
               **policy) -> DeliveryResult:
    """PATCH @original with the chart **and** its text, in ONE multipart request (OI-29, C-04).

    `images` is `[(png_bytes, filename), …]`. Returns a `DeliveryResult` whose `.message` is the
    message Discord answered with, so the caller keeps the shape `edit_original` always returned.

    ⛔⛔ THIS EXISTS BECAUSE 2.6 HARDENED THE TEXT PATH AND THE EVIDENCE IS ALL ON THE IMAGE PATH.
    Every one of `01`'s 23 `ATTACHMENT_NOT_FOUND` refusals and 23 `10015` finals is image-PATCH
    traffic, and none of it went through `delivery.py` — `discord_interactions.edit_original`
    builds its own multipart with its own client, its own 4xx handling and **no retry policy at
    all**. A delivery layer is only as wide as the call sites routed through it; "2.6 is done" was
    true of the module and false of the class.

    ⛔⛔ THE CONTENT AND THE IMAGE TRAVEL TOGETHER, AND THAT IS THE FIX, NOT AN OPTIMISATION.
    C-04 is a SECOND PATCH that re-declares attachment ids read off the FIRST patch's response,
    carrying none of the file bytes; if anything replaced the attachment in between, those ids are
    stale and Discord answers `ATTACHMENT_NOT_FOUND` — 23 times, on both attempts, deterministically
    (0 % load correlation). **An id that names a part present in the same request cannot be stale.**
    So the way to close the class is not to validate the ids better; it is to stop sending ids that
    refer to something we are not uploading.

    ⛔ AND A REFUSED IMAGE STILL ENDS IN A SENTENCE. Too large, no Attach Files permission, a
    component tree Discord will not take — every one of those falls back to a text edit naming the
    class. C-11 measured 46 failures that produced no member message at all; a delivery that
    declines to say anything is the defect, not the safe option.
    """
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    files, parts, oversize = _image_parts(images, cid=cid)
    comps, dropped = _safe_components(components, cid=cid)
    text = content[:contract.CONTENT_MAX]

    if oversize or not files:
        # ⛔ NO IMAGE TO SEND IS NOT THE SAME AS AN IMAGE WE REFUSED, and the two must not share a
        # branch. `oversize` is a defect we name; an empty `images` is a caller asking for a text
        # edit and is answered as one, with nothing dropped and nothing to apologise for.
        if not oversize:
            return edit_text(app_id, token, content=text, components=components, client=client,
                             deadline_s=deadline_s, cid=cid, **policy)
        observe.event("image_too_large", cid=cid, cls=class_for(TOO_LARGE), outcome="dropped",
                      detail=f"{oversize} bytes > {ATTACHMENT_MAX_BYTES}")
        res = edit_text(app_id, token, content=_no_image_text(text), components=components,
                        client=client, deadline_s=deadline_s, cid=cid, **policy)
        return replace(res, reason=TOO_LARGE, cls=class_for(TOO_LARGE),
                       dropped=tuple(res.dropped) + ("image",))

    payload: dict = {"content": text, "allowed_mentions": {"parse": []},
                     "attachments": parts}
    if comps is not None:
        payload["components"] = comps
    res = _send("patch", url, payload, client, files=files, cid=cid,
                dropped=dropped, ceiling_s=IMAGE_TIMEOUT_S,
                deadline_s=(IMAGE_BUDGET_S if deadline_s is None else deadline_s), **policy)
    if res.ok or res.token_dead:
        # ⛔ A DEAD TOKEN IS NOT RECOVERABLE BY SENDING SOMETHING ELSE THROUGH IT. Falling back to
        # a text edit on a 10015 spends another round trip to be told the same thing.
        return res

    # The chart was refused, not the render. Say so — the member is the one waiting.
    observe.event("image_refused", cid=cid, cls=res.cls, outcome=res.reason,
                  status=str(res.status), detail=res.detail)
    alt = edit_text(app_id, token, content=_no_image_text(text), client=client,
                    deadline_s=deadline_s, cid=cid, **policy)
    return replace(alt, reason=res.reason, cls=res.cls,
                   dropped=tuple(alt.dropped) + tuple(dropped) + ("image",))


def _image_parts(images, *, cid: str = "") -> tuple[dict, list, int]:
    """`(files, attachments, oversize_bytes)`.

    The attachment ids are the INDEXES of the parts in this same request, so they cannot name
    something Discord no longer has — see `edit_image`'s second ⛔."""
    files: dict = {}
    parts: list = []
    total = 0
    for i, item in enumerate(images or []):
        try:
            data, filename = item
        except (TypeError, ValueError):  # a caller handed us something that is not a pair
            observe.event("image_bad_shape", cid=cid, outcome="dropped", detail=type(item).__name__)
            continue
        if not data:
            continue
        total += len(data)
        files[f"files[{i}]"] = (str(filename), data, "image/png")
        parts.append({"id": i, "filename": str(filename)})
    if total > ATTACHMENT_MAX_BYTES:
        return {}, [], total
    return files, parts, 0


#: What a member is told when the picture could not be attached but the reply still can be.
#: ⛔ It names no exception and no status code — same rule as `contract.py`'s failure copy.
NO_IMAGE_NOTE = "The chart could not be attached to this reply."


def _no_image_text(content: str) -> str:
    note = NO_IMAGE_NOTE
    if not content:
        return note
    if content.endswith(note):
        return content[:contract.CONTENT_MAX]
    joined = f"{content}\n{note}"
    if len(joined) <= contract.CONTENT_MAX:
        return joined
    # ⛔ THE NOTE IS KEPT AND THE CONTENT IS TRIMMED, never the other way round — the same rule
    # `badge.stamp` states, for the same reason: the sentence that explains the degradation is
    # exactly the one that must not be the casualty of a long reply.
    keep = contract.CONTENT_MAX - len(note) - 1
    return (content[:max(0, keep)].rstrip() + "\n" + note) if keep > 0 else note


def followup(app_id: str, token: str, *, content: str, components: list | None = None,
             ephemeral: bool = True, attachments: list | None = None, client=None,
             deadline_s: float | None = None, cid: str = "", **policy) -> DeliveryResult:
    """POST a follow-up message to an interaction. Used when editing @original would
    overwrite something the member is looking at (a chart under a control click)."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}"
    comps, dropped = _safe_components(components, cid=cid)
    payload: dict = {"content": content[:contract.CONTENT_MAX], "allowed_mentions": {"parse": []}}
    if ephemeral:
        payload["flags"] = EPHEMERAL
    if comps is not None:
        payload["components"] = comps
    if attachments is not None:
        payload["attachments"] = attachments_payload(attachments)
    return _send("post", url, payload, client, deadline_s=deadline_s, cid=cid,
                 dropped=dropped, **policy)


# ── the transport, with the policy on top ───────────────────────────────────

def retry_after_s(resp) -> float | None:
    """What Discord asked us to wait, in seconds. Body first (`retry_after`, a float), then
    the `Retry-After` header. None when it said nothing."""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001 — an unparseable body is not an answer
        body = None
    if isinstance(body, dict) and body.get("retry_after") is not None:
        try:
            return max(0.0, float(body["retry_after"]))
        except (TypeError, ValueError):
            pass
    header = (getattr(resp, "headers", None) or {})
    raw = header.get("Retry-After") or header.get("retry-after")
    if raw is not None:
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            return None
    return None


def _errors_mentions(body, key: str) -> bool:
    errors = body.get("errors") if isinstance(body, dict) else None
    return isinstance(errors, dict) and key in errors


def _reason_for(status: int, code, body) -> str:
    if code in (UNKNOWN_WEBHOOK, UNKNOWN_MESSAGE) or status == 404:
        return TOKEN_DEAD
    if status == 429:
        return RATE_LIMITED
    if code == REQUEST_TOO_LARGE or status == 413:
        return TOO_LARGE
    if code == MISSING_PERMISSIONS or status in (401, 403):
        return FORBIDDEN
    if code == INVALID_FORM_BODY:
        if _errors_mentions(body, "attachments"):
            return ATTACHMENT_NOT_FOUND
        if _errors_mentions(body, "components"):
            return COMPONENTS_REJECTED
        return REJECTED
    if status >= 500:
        return SERVER_ERROR
    return REJECTED


def _retryable(status, code, reason: str) -> bool:
    """⛔ TERMINAL FIRST. A `10015` can carry any status Discord likes; what makes it pointless
    to retry is the code, not the number in front of it."""
    if code in TERMINAL_CODES or reason in (TOKEN_DEAD, ATTACHMENT_NOT_FOUND,
                                            COMPONENTS_REJECTED, TOO_LARGE, FORBIDDEN):
        return False
    if status is None:
        return True                     # transport: nothing was answered, so nothing is known
    if status == 429:
        return True                     # honoured only if the wait fits — see `_send`
    return status >= 500


def _result(resp) -> DeliveryResult:
    code = None
    body = None
    try:
        body = resp.json()
        code = body.get("code") if isinstance(body, dict) else None
    except Exception:  # noqa: BLE001
        body = None
    if resp.is_success:
        return DeliveryResult(True, resp.status_code, None, "", reason=OK,
                              message=body if isinstance(body, dict) else None)
    reason = _reason_for(int(resp.status_code), code, body)
    return DeliveryResult(
        False, resp.status_code, code,
        # ⛔ SCRUBBED: this string is written to the jobs table and read back by /renderhealth.
        observe.scrub(getattr(resp, "text", "") or "")[:200],
        reason=reason, cls=class_for(reason),
        retryable=_retryable(int(resp.status_code), code, reason),
        retry_after=retry_after_s(resp) if resp.status_code == 429 else None)


def _once(method: str, url: str, payload: dict, client, *, timeout_s: float,
          attempt: int, cid: str, files: dict | None = None) -> DeliveryResult:
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=timeout_s)
        try:
            if files:
                # ⛔ MULTIPART, AND THE CONTENT-TYPE IS NOT OURS TO SET. httpx generates the
                # boundary; writing a `Content-Type: multipart/form-data` header by hand omits it
                # and Discord answers 400 on a body that is otherwise perfectly correct.
                resp = getattr(c, method)(url, data={"payload_json": json.dumps(payload)},
                                          files=files, timeout=timeout_s)
            else:
                resp = getattr(c, method)(url, content=json.dumps(payload),
                                          headers={"Content-Type": "application/json"},
                                          timeout=timeout_s)
            return _result(resp)
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001 — delivery never raises into a job
        # ⛔⛔ `observe.exception`, NEVER `log.exception`. An httpx error's traceback prints the
        # request URL, and this URL carries the interaction token. `detail` is the exception's
        # TYPE only, for the same reason.
        observe.exception("delivery_error", cid=cid, attempt=attempt, hop=method)
        return DeliveryResult(False, None, None, type(e).__name__, reason=TRANSPORT,
                              cls=class_for(TRANSPORT), retryable=True)


def _wait_for(res: DeliveryResult, attempt: int, rand) -> float:
    """How long before the next attempt. Discord's own `retry_after` when it gave one;
    otherwise `breakers.retry_delay` — the single backoff authority on this path.

    The jitter on a 429 comes through the same function (`base_s=0`, so it contributes the
    spread and nothing else): every caller in one rate-limit bucket is told the same reset,
    and without a spread they all come back in the same millisecond."""
    if res.status == 429 and res.retry_after is not None:
        return res.retry_after + breakers.retry_delay(attempt, base_s=0.0,
                                                      spread_s=RETRY_AFTER_JITTER_S, rand=rand)
    return breakers.retry_delay(attempt, rand=rand)


def _send(method: str, url: str, payload: dict, client=None, *, deadline_s: float | None = None,
          cid: str = "", dropped: tuple = (), files: dict | None = None,
          ceiling_s: float = TIMEOUT_S, sleep=time.sleep,
          rand=random.random, clock=time.monotonic) -> DeliveryResult:
    """One delivery: up to `MAX_ATTEMPTS` tries, every wait bounded by the budget.

    ⛔ THE FIRST ATTEMPT ALWAYS RUNS, even with no budget left. Refusing it would be C-11 with
    extra steps: the message the member is owed is exactly the one sent after a deadline has
    already passed, and a delivery that declines to try delivers nothing.

    ⛔ A RETRY IS ONLY TAKEN WHEN THE WAIT *AND* A ROUND TRIP STILL FIT. Sleeping out the rest
    of the budget and then failing is strictly worse than failing now with a named class."""
    budget = DEFAULT_BUDGET_S if deadline_s is None else max(0.0, float(deadline_s))
    started = clock()
    waited = 0.0
    attempt = 0
    res = DeliveryResult(False, None, None, "no attempt ran", reason=TRANSPORT,
                         cls=class_for(TRANSPORT))
    for attempt in range(1, max(1, MAX_ATTEMPTS) + 1):
        left = budget - (clock() - started)
        res = _once(method, url, payload, client, files=files,
                    timeout_s=min(ceiling_s, max(MIN_USEFUL_S, left)), attempt=attempt, cid=cid)
        if res.ok or not res.retryable or attempt >= max(1, MAX_ATTEMPTS):
            break
        wait = _wait_for(res, attempt, rand)
        left = budget - (clock() - started)
        if wait + MIN_USEFUL_S > left:
            if res.status == 429:
                res = replace(res, reason=RATE_LIMIT_OVER_DEADLINE,
                              cls=class_for(RATE_LIMIT_OVER_DEADLINE))
            observe.event("delivery_gave_up", cid=cid, attempt=attempt, status=str(res.status),
                          cls=res.cls, outcome=res.reason, ms=max(0.0, left) * 1000.0)
            break
        observe.event("delivery_retry", cid=cid, attempt=attempt, status=str(res.status),
                      outcome=res.reason, ms=wait * 1000.0)
        sleep(wait)
        waited += wait
    out = replace(res, attempts=attempt, waited_s=round(waited, 3), dropped=dropped)
    if not out.ok:
        observe.event("delivery_failed", cid=cid, attempt=out.attempts, status=str(out.status),
                      cls=out.cls, outcome=out.reason, detail=out.detail)
    return out
