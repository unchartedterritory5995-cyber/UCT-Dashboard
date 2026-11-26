# -*- coding: utf-8 -*-
"""THE SCRIPT TURN: Create Indicator's assistant writes Pine (S1 and the server half of S3, 2026-11-18).

A formula cannot hold a table, a drawn line, a label with text or a list of levels. The engine
already runs all of those for a pasted script, so for a request a formula cannot meet the
assistant writes a SCRIPT, from the generated document of exactly what the engine serves
(`pine_authoring.document`).

⛔ THE ENGINE JUDGES. This module never says a script runs. It returns the text; the browser puts it
through the same door a pasted script goes through and shows the member THAT door's verdict. When
the engine refuses it, the browser sends the refusal back (`script_refusal`) and the assistant
repairs it: a bounded number of rounds, counted in the same ledger as every other call.

WHO GETS ONE (all of these, or the turn is the formula turn it always was):
  * the lane is switched on (`CONVERSE_SCRIPT_ENABLED=admin`) and the account is an ADMIN: no
    member sees a script turn until its cost has been measured and a ceiling set;
  * the browser said it accepts a script (`accepts: ["script"]`), so a tab on an older build never
    meets an answer it cannot show;
  * the document can be built (`pine_authoring.available`).

SPEND. Every call is checked against the global budget and the account's daily allowance BEFORE
it is made, charged to the same ledger (`cost_guard.record`, `definition_concierge._record_spend`)
and appended to the turn's `calls`, exactly as a formula call is. A turn makes at most
`MAX_SCRIPT_CALLS` calls.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Mapping, Optional

from api.services.catalyst import cost_guard
from api.services import definition_concierge as dc
from api.services import code_paste
from api.services import pine_authoring

logger = logging.getLogger(__name__)

ACCEPTS_SCRIPT = "script"
#: The lane's switch. "admin": admin accounts only. "all": every account the Create Indicator door
#: admits. Anything else, or unset: off.
SCRIPT_ENABLED_ENV = "CONVERSE_SCRIPT_ENABLED"
SCRIPT_MODE_ADMIN, SCRIPT_MODE_ALL = "admin", "all"
TOOL_NAME = "emit_script"
#: One answer, and one more call when the answer's SHAPE is wrong (`pine_authoring.script_problem`).
MAX_SCRIPT_CALLS = 2
#: The most repair rounds a browser may ask for on one request (the engine's refusal sent back).
MAX_REPAIR_ROUNDS = 2
REFUSAL_MAX_ERRORS, REFUSAL_MAX_CHARS = 6, 300
DECLINED_GATE = "script:unsupported"
SHAPE_GATE = "script:shape"
ROUNDS_GATE = "script:rounds"
REFUSED_TOOL_USE_ID = "toolu_engine_refusal"

REASONS = {
    DECLINED_GATE: "The assistant could not build that as a script this chart can run.",
    SHAPE_GATE: "The assistant's script was not in a form this chart can check, so nothing was offered.",
    ROUNDS_GATE: "The script was sent back for repair as many times as allowed and the chart still refuses it.",
}

#: ⭐ WORDS THAT ASK FOR SOMETHING ONLY A SCRIPT CAN HOLD. A request with one of these goes to the
#: script turn first; any other request takes the formula turn it always took, and reaches a script
#: only if the formula turn declines it. Deliberately short: a word here costs a formula request
#: its cheaper path, so each is something a formula cannot draw at all.
_SCRIPT_WORDS = re.compile(
    r"\b(?:tables?|dashboards?|labels?|text|trend ?lines?|draw(?:s|n|ing)?|box(?:es)?|rectangles?|zones?|"
    r"fib(?:s|onacci)?|zig ?zags?|pivot points?|pine|scripts?)\b", re.I)

#: ⭐ 2026-11-25 -- WHAT A FORMULA CAN DRAW, BUT NOT THE WAY THE MEMBER ASKED. Measured by the Deepvue parity probe
#: (live, admin measurement): "Plot the Parabolic SAR as dots", "show its value in the status line with 2 decimals" and
#: "the close of another symbol that I choose in the settings" were each BUILT as a formula, and each reply said what
#: it could not do (a thin dotted line "reads much like the classic dots"; "I can't set a fixed 2-decimal format";
#: "the symbol is fixed in the formula"). A script holds all three (plot.style_circles / style_cross, `precision=`,
#: input.symbol) and a built formula is never followed by one (`_with_script_lane`), so the member was handed the near
#: thing. Matched over the 641 distinct requests on record: exactly the five that ask for one of them. A dotted LINE
#: is a formula's line style, and "a dot above the bar" is a formula's marker: neither is here.
_SCRIPT_ONLY_ASKS = re.compile(
    # a series drawn AS dots, circles or crosses (plot.style_circles / plot.style_cross)
    r"\b(?:as|with|in|using)\s+(?:(?:small|little|tiny|big|large|colou?red|green|red|blue|white|yellow|orange)\s+){0,2}(?:dots|circles|crosses)\b"
    r"|\b(?:dots?|circles?|cross(?:es)?)\s+style\b"
    # a value shown to a fixed number of decimals (indicator(precision=))
    r"|\b(?:\d|one|two|three|four|five|six)\s+decimals?\b|\bdecimal\s+places?\b"
    # a symbol the member chooses in the settings (input.symbol)
    r"|\b(?:symbol|ticker)s?\b[^.;!?]{0,60}\b(?:settings?|inputs?|i\s+(?:can\s+)?(?:choose|pick|select|type|enter))\b"
    r"|\b(?:choose|pick|select|change|enter|type)\w*\b[^.;!?]{0,40}\b(?:symbol|ticker)\b", re.I)

TOOL = {
    "name": TOOL_NAME,
    "description": ("Return the ONE Pine script that meets the member's request, or say that it cannot be built with "
                    "what this engine serves."),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["disposition", "reply"],
        "properties": {
            "disposition": {"type": "string", "enum": ["script", "unsupported"]},
            "name": {"type": "string", "maxLength": pine_authoring.NAME_MAX_CHARS,
                     "description": "A short name for the indicator, in the member's words."},
            "pine": {"type": "string", "maxLength": pine_authoring.SCRIPT_MAX_CHARS,
                     "description": "The complete script. Required when disposition is script."},
            "reply": {"type": "string", "maxLength": pine_authoring.REPLY_MAX_CHARS,
                      "description": ("One or two plain sentences: what the script draws and what a member can change; or, "
                                      "when unsupported, what cannot be built and the closest thing that can.")},
        },
    },
}


def lane_open(accepts: Any, admin: Any) -> bool:
    """May this request be answered with a script at all? (Module docstring: who gets one.)"""
    mode = os.environ.get(SCRIPT_ENABLED_ENV, "").strip().lower()
    # ⭐ `all` (coordinator's ruling 2026-11-19, after the admin measurement): every account the Create
    # Indicator door itself admits. A script turn spends that account's own daily allowance and the same
    # ledger as a formula turn, so there is no second ceiling. `admin`: admin accounts only.
    if not (mode == SCRIPT_MODE_ALL or (mode == SCRIPT_MODE_ADMIN and admin is True)):
        return False
    if not (isinstance(accepts, list) and ACCEPTS_SCRIPT in accepts):
        return False
    return pine_authoring.available()


def names_a_method(message: Any) -> Optional[str]:
    """⭐ 2026-11-25 (coordinator ruling B) -- the catalogue id of a METHOD, drawing, chart type or data series the
    request names (a catalogue row that is neither distinctive nor in the library: Elliott Wave, Renko, Fibonacci
    retracement, the put/call ratio), in any capitals. None when it names none.
    Measured before: such a name in lower case was BUILT FROM MEMORY as a formula with no word that UCT had not
    checked it, and in Title Case was refused as "not an indicator UCT knows by name", which the catalogue says is
    false. No single formula is any of these, so it goes to the script turn, where every script no value-checked
    recipe stands behind carries UCT's own line saying so (`pine_authoring.said_with_disclosure`). A bare short
    acronym is never matched (`indicator_names.is_short_acronym`, the same rule as the withheld names)."""
    from api.services import indicator_names
    if not isinstance(message, str):
        return None
    words = " " + indicator_names.norm(message) + " "
    in_library = indicator_names.now_in_library()
    for row in indicator_names.catalogue():
        if row["distinctive"] or row["id"] in in_library:
            continue
        for alias in row["aliases"]:
            if not indicator_names.is_short_acronym(alias) and " " + alias + " " in words:
                return row["id"]
    return None


def said_with_line(said: Any, line: str) -> str:
    """The assistant's words with UCT's own line after them: never cut, never said twice."""
    text = str(said or "").strip()
    if line in text:
        return text[:pine_authoring.REPLY_MAX_CHARS]
    return (pine_authoring._fit(text, pine_authoring.REPLY_MAX_CHARS - len(line) - 1) + " " + line).strip()


_PINE_TITLE = re.compile(r"""(?m)^\s*(?:indicator|study|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"'\n]{1,80})["']""")


def pasted_pine_turn(message: str, *, revision: int, contract: str,
                     trace: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """⭐ C (2026-11-25): a member who pasted a PINE script is answered with THEIR script, as written, and NO model
    call, when it passes the first look (`pine_authoring.script_problem`). The chart's own engine then checks it like
    any script answer, and a refusal comes back for a repair in the ordinary way. None when it does not pass: then the
    script turn rewrites it. It is the member's own code, so no "built from your description" line is added."""
    from api.services import runtime_definitions
    pine = code_paste.pine_of(message)
    if pine_authoring.script_problem(pine) is not None:
        return None
    trace = trace if trace is not None else {}
    title = _PINE_TITLE.search(pine)
    name = re.sub(r"\s+", " ", title.group(1)).strip()[:pine_authoring.NAME_MAX_CHARS] if title else "Pasted script"
    caps = pine_authoring.script_capabilities(pine)
    waits = pine_authoring.waits_for_the_bar(pine, caps=caps)
    trace["script"] = {"round": 0, "pasted": True, "chars": len(pine), "reference": None, "waits_for_the_bar": waits}
    script_out = {"name": name, "pine": pine, "round": 0, "reference": None, "waits_for_the_bar": waits}
    admission = runtime_definitions.script_answer_admission(pine, caps)
    if admission is not None:
        script_out["admission"] = admission
    said = code_paste.PINE_PASTE_REPLY
    return {"ok": True, "disposition": "answer", "turn": "script", "reply": said, "script": script_out,
            "envelope": {"contract": contract, "baseRevision": revision, "ops": [], "disposition": "answer",
                         "reply": said},
            "answered_by": "door", "not_understood": [], "unavailable": [],
            "tokens": {"input": 0, "output": 0}, "cost_usd": 0.0, "attempts": 0, "model": None}


def wants_script(message: Any) -> bool:
    """Does the request name something only a script can hold?"""
    return isinstance(message, str) and bool(_SCRIPT_WORDS.search(message) or _SCRIPT_ONLY_ASKS.search(message))


def script_refusal(raw: Any) -> Optional[Dict[str, Any]]:
    """The browser engine's refusal of a script this door offered for this same request:
    ``{pine, errors, round}`` bounded, or None when it is not usable (then the turn is ordinary).
    Untrusted input: the script must itself pass the server's first look, the errors are short
    strings, and the round is a small whole number."""
    if not isinstance(raw, Mapping):
        return None
    pine = raw.get("pine")
    if pine_authoring.script_problem(pine) is not None:
        return None
    errors = [re.sub(r"\s+", " ", e).strip()[:REFUSAL_MAX_CHARS] for e in (raw.get("errors") or [])
              if isinstance(e, str) and e.strip()] if isinstance(raw.get("errors"), list) else []
    errors = errors[:REFUSAL_MAX_ERRORS]
    if not errors:
        return None
    rnd = raw.get("round")
    rnd = rnd if isinstance(rnd, int) and not isinstance(rnd, bool) and rnd >= 1 else 1
    return {"pine": pine, "errors": errors, "round": rnd}


def system_blocks() -> List[Dict[str, Any]]:
    """The document, as ONE cached block (a constant for a given reference)."""
    return [{"type": "text", "text": pine_authoring.document(), "cache_control": {"type": "ephemeral"}}]


def _request_text(message: str, chart: Any) -> str:
    sym = chart.get("sym") if isinstance(chart, Mapping) else None
    tf = chart.get("tf") if isinstance(chart, Mapping) else None
    on = f" The member's chart shows {sym}" + (f" on the {tf} timeframe." if tf else ".") if sym else ""
    # ⭐ C (2026-11-25): a pasted Deepvue indicator is TRANSLATED, its code carried as DATA (`code_paste.IMPORT_TASK`)
    if code_paste.kind_of(message) == code_paste.DEEPVUE:
        return (f"<uct_import_source>{dc.escape_json(message)}</uct_import_source>{on} {code_paste.IMPORT_TASK} "
                "Write the script with the emit_script tool.")
    # ⭐ the recipes this request NAMES (`pine_authoring.recipes_for`): whole scripts the engine is known
    # to run, as data beside the request. Our own text, never the member's.
    found = pine_authoring.recipes_text(pine_authoring.recipes_for(message))
    return (f"<member_request>{dc.escape_json(message)}</member_request>{on} "
            "Write the script with the emit_script tool." + (f"\n\n{found}" if found else ""))


#: ⭐ A REFUSED SCRIPT GOES BACK TO ITS RECIPE (found live 2026-11-19). Two requests that each have a proven
#: recipe were answered, after a refusal, with something else: a ROLLING average where the session's was asked
#: for, and a formula too long for a plot where the recipe's loop runs. The recipe rides every turn of the
#: request (`_request_text`); what was missing is saying, at the moment of the refusal, that it is the way
#: back. Which line is said is decided by counting (`pine_authoring.backed_by`), never by the assistant.
#: ⛔ A recipe is handed on a WORD of the request ("divergence", "zones"), so the line names the recipe and is
#: conditional: "if that is what the member asked for". Told flatly to "go back to it", a request for a MACD
#: divergence was steered onto the RSI recipe (review 2026-11-19). `{recipes}` is the handed recipes' titles.
RECIPE_BACK_LINE = (" A RECIPE is above ({recipes}): it runs on this engine as written and its numbers were checked. IF "
                    "it is what the member asked for, go back to it: keep its structure and change only the numbers and "
                    "words the member asked for. If the member asked for something else, it is only an example of "
                    "what runs here. Either way, do not answer with a different indicator than the one asked for.")
RECIPE_KEPT_LINE = (" This script IS the recipe {recipes} above, which is proven on this engine, so the refusal is about "
                    "the member's chart or a number you changed, not about the recipe. Do not rewrite it into a "
                    "different indicator to make the refusal go away. If what the engine names can be fixed without "
                    "changing what the script computes, fix only that; otherwise return the recipe as it was and say in "
                    "`reply` what the engine named.")


def _recipe_line(message: str, refused: Mapping[str, Any]) -> str:
    """What a repair is told about the recipe handed with this request: nothing when none was."""
    handed = pine_authoring.recipes_for(message)
    if not handed:
        return ""
    kept = pine_authoring.backed_by(message, refused.get("pine"))
    if kept is not None:
        title = next((r["title"] for r in handed if r["id"] == kept), kept)
        return RECIPE_KEPT_LINE.replace("{recipes}", f"`{title}`")
    return RECIPE_BACK_LINE.replace("{recipes}", " / ".join(f"`{r['title']}`" for r in handed))


def _messages(message: str, chart: Any, refused: Optional[Mapping[str, Any]]) -> List[dict]:
    out: List[dict] = [{"role": "user", "content": _request_text(message, chart)}]
    if refused:
        words = " ".join(f"({i + 1}) {e}" for i, e in enumerate(refused["errors"]))
        out += [
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": REFUSED_TOOL_USE_ID, "name": TOOL_NAME,
                 "input": {"disposition": "script", "pine": refused["pine"], "reply": ""}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": REFUSED_TOOL_USE_ID, "is_error": True,
                 "content": (f"[engine:refused] UCT's engine checked this script and does not run it as written: {words} "
                             "Fix exactly what the engine names and return the WHOLE corrected script. If the engine "
                             "cannot do what was asked, say so (disposition unsupported)."
                             + _recipe_line(message, refused))}]},
        ]
    return out


def _call_model(messages: List[dict]):
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client().with_options(max_retries=dc.MAX_HTTP_RETRIES)
    msg = client.messages.create(
        model=dc.MODEL, max_tokens=dc.MAX_TOKENS, system=system_blocks(), tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL_NAME}, messages=messages)
    usage = getattr(msg, "usage", None)
    return msg, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0)


def _tool_use(msg: Any):
    for block in getattr(msg, "content", None) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == TOOL_NAME:
            value = getattr(block, "input", None)
            if isinstance(value, dict):
                return getattr(block, "id", None), value
    return None, None


def _refused(gate: str, reason: Optional[str] = None, **extra: Any) -> Dict[str, Any]:
    return {"ok": False, "gate": gate, "reason": reason or REASONS.get(gate) or dc.REFUSALS.get(gate) or gate, **extra}


def script_turn(message: str, *, user_id: Any, chart: Any, cap_usd: float, calls: List[Dict[str, Any]],
                revision: int, contract: str, trace: Optional[Dict[str, Any]] = None,
                refused: Optional[Mapping[str, Any]] = None, cancelled: Any = None) -> Dict[str, Any]:
    """One script turn. NEVER raises. Returns the door's result dict: on success
    ``{ok, disposition: "answer", turn: "script", reply, script: {name, pine, round}, envelope, ...}``;
    the envelope is an answer that changes nothing (the script is not a patch: the browser's engine
    decides what becomes of it)."""
    trace = trace if trace is not None else {}
    rnd = int(refused["round"]) if refused else 0
    trace["script"] = {"round": rnd}
    if refused and rnd > MAX_REPAIR_ROUNDS:
        return _refused(ROUNDS_GATE)
    market_date = dc._market_date()
    messages = _messages(message, chart, refused)
    tokens = {"input": 0, "output": 0}
    cost_usd, attempts = 0.0, 0
    other_read_repaired = False
    extra = lambda: {"tokens": dict(tokens), "cost_usd": round(cost_usd, 6), "attempts": attempts, "model": dc.MODEL}  # noqa: E731
    if dc.forced_tool_choice_unsupported():
        # refused BY NAME, before any call and any charge: the configured model rejects the forced call below
        return _refused(dc.FORCED_TOOL_CHOICE_GATE, **extra())
    while attempts < MAX_SCRIPT_CALLS:
        if cancelled is not None and cancelled.is_set():
            return _refused("internal:timeout", **extra())
        # ⭐ THE CAPS ARE CONSULTED BEFORE EVERY SPEND, the shape repair included.
        if not cost_guard.may_member_spend(market_date):
            return _refused("cost:global", **extra())
        if dc.spend_for(user_id, market_date) >= cap_usd:
            return _refused("cost:user", **extra())
        attempts += 1
        request = {"system": system_blocks(), "tools": [TOOL], "messages": messages}
        try:
            msg, in_tokens, out_tokens = _call_model(messages)
            dc.note_model_answered()
        except Exception as exc:                   # noqa: BLE001 -- never raises out
            gate = dc.model_failure_gate(exc)
            # ⭐ 2026-11-20: the script turn logged an account refusal as a WARNING "model call failed", the one
            # door of three that did; it says what the others say now (ERROR, with the kind of refusal)
            if gate == "model:unavailable":
                dc.log_account_refusal(logger, "converse:script", exc)
            else:
                logger.warning("[converse:script] model call failed: %s", type(exc).__name__)
            dc.charge_unreported(exc, user_id, market_date, dc.MODEL, dc.MAX_TOKENS, request)
            return _refused(gate, **extra())
        usage = getattr(msg, "usage", None)
        cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
        tokens["input"] += in_tokens
        tokens["output"] += out_tokens
        if not (in_tokens or out_tokens or cache_read or cache_write):
            spent = dc.charge_unreported(None, user_id, market_date, dc.MODEL, dc.MAX_TOKENS, request)
        else:
            spent = cost_guard.record(market_date, f"concierge:{user_id}", dc.MODEL, in_tokens, out_tokens,
                                      cache_read_tokens=cache_read, cache_creation_tokens=cache_write)
            dc._record_spend(user_id, market_date, spent)
        cost_usd += spent
        calls.append({"input_tokens": in_tokens, "output_tokens": out_tokens, "cache_read_tokens": cache_read,
                      "cache_creation_tokens": cache_write, "usd": round(spent, 6), "script": True})

        tool_use_id, answer = _tool_use(msg)
        reply = answer.get("reply") if isinstance(answer, dict) else None
        reply = reply.strip()[:pine_authoring.REPLY_MAX_CHARS] if isinstance(reply, str) else ""
        if isinstance(answer, dict) and answer.get("disposition") == "unsupported":
            trace["script"]["declined"] = True
            return _refused(DECLINED_GATE, reply or None, disposition="unsupported", **extra())
        pine = answer.get("pine") if isinstance(answer, dict) and answer.get("disposition") == "script" else None
        problem = pine_authoring.script_problem(pine)
        # ⭐ A READ OF ANOTHER SYMBOL OR TIMEFRAME NOBODY ASKED FOR GETS ONE REPAIR (2026-11-22, the rule and its
        # reasons at `pine_authoring.other_read_asked`). Decided by reading THIS script's own requests against the
        # member's words and the chart. ONE repair, inside this turn's own call limit; a second answer that still
        # reads it is KEPT (the window says what the limit is), and "unsure" is never repaired.
        if problem is None and not other_read_repaired and attempts < MAX_SCRIPT_CALLS and tool_use_id:
            asked, unasked = pine_authoring.other_read_asked(message, pine, chart)
            # ⛔ NEVER AWAY FROM A CHECKED RECIPE'S OWN READ. A script backed by one of UCT's recipes for these
            # words whose requests are EXACTLY the recipe's (`recipe_whose_requests_these_are`: identity, not
            # resemblance) was checked with those requests in it, on every timeframe it is for: its daily read
            # on a daily chart is yesterday's bar and right. Sending it back would trade a checked script for an
            # unchecked rewrite. One request more, or one changed, and it is sent back like any other.
            if (asked == pine_authoring.OTHER_READ_NOT_ASKED
                    and pine_authoring.recipe_whose_requests_these_are(message, pine) is not None):
                trace["script"]["other_read"] = {"repaired": False, "recipe": True}
                asked = pine_authoring.OTHER_READ_ASKED
            if asked == pine_authoring.OTHER_READ_NOT_ASKED:
                other_read_repaired = True
                trace["script"]["other_read"] = {"repaired": True, "unasked": list(unasked)}
                messages = messages + [
                    {"role": "assistant", "content": [{"type": "tool_use", "id": tool_use_id, "name": TOOL_NAME,
                                                       "input": answer or {}}]},
                    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "is_error": True,
                                                  "content": pine_authoring.other_read_repair(unasked, chart)}]},
                ]
                continue
        if problem is None:
            if other_read_repaired:
                trace["script"]["other_read"]["still_reads"] = (
                    pine_authoring.other_read_asked(message, pine, chart)[0] == pine_authoring.OTHER_READ_NOT_ASKED)
            name = answer.get("name")
            name = re.sub(r"\s+", " ", name).strip()[:pine_authoring.NAME_MAX_CHARS] if isinstance(name, str) else ""
            said = reply or "Here is a script for that. The chart's own check decides whether it runs."
            # ⭐ THE DISCLOSURE (ruling 2026-11-19): a script with no value-checked recipe behind it says
            # so, in UCT's own words, whatever the assistant wrote. Decided by counting
            # (`pine_authoring.backed_by`), on THIS script: a repair is judged again.
            reference = pine_authoring.backed_by(message, pine)
            # ⭐ C: a translated Deepvue indicator says what it is (`code_paste.IMPORT_LINE`) in place of the
            # unchecked line: nobody graded its values against Deepvue's, and that is the honest sentence for it
            if reference is None and code_paste.kind_of(message) == code_paste.DEEPVUE:
                said = said_with_line(said, code_paste.IMPORT_LINE)
            else:
                said = pine_authoring.said_with_disclosure(said, reference)
            # ⭐ AND WHETHER IT READS WHERE THE CHART ENDS (found live 2026-11-19): such a script is drawn
            # only on a finished bar WHEN THE BAR-BY-BAR LANE DRAWS IT. The server's own detector decides the
            # fact, on THIS script, and sends it (`waits_for_the_bar`). ⛔ The SENTENCE is the window's to say
            # (`scriptAnswer.js`): only the window knows which lane draws the script, and the lanes that draw a
            # lone table, box or label are not asked the forming-bar question. Said here, it was said of
            # scripts that are drawn all session (the same evening's own in-session measurement).
            # ⭐ ONE detector run per script answer (2026-11-19): its set answers this and the admission below.
            caps = pine_authoring.script_capabilities(pine)
            waits = pine_authoring.waits_for_the_bar(pine, caps=caps)
            trace["script"]["chars"] = len(pine)
            trace["script"]["reference"] = reference
            trace["script"]["waits_for_the_bar"] = waits
            logger.info("[converse:script] a script of %d characters (round %d, %d call(s), reference %s)",
                        len(pine), rnd, attempts, reference or "none")
            script_out = {"name": name, "pine": pine, "round": rnd, "reference": reference,
                          "waits_for_the_bar": waits}
            # ⭐ AND ITS ADMISSION VERDICT, from that same set (`runtime_definitions.admission_verdict`, the
            # rule the verdict door reads): the window latches it when its sha256 matches the script, so it
            # never waits on the verdict door's shared budgets for a script this request already checked.
            # The set goes into this process's LRU only; nothing is stored. ABSENT while capability
            # admission is off, so that answer is byte for byte what it was.
            from api.services import runtime_definitions
            admission = runtime_definitions.script_answer_admission(pine, caps)
            if admission is not None:
                script_out["admission"] = admission
                trace["script"]["admission"] = {"admitted": admission["admitted"],
                                                "missing": list(admission["missing"])}
            return {"ok": True, "disposition": "answer", "turn": "script", "reply": said,
                    "script": script_out,
                    "envelope": {"contract": contract, "baseRevision": revision, "ops": [], "disposition": "answer",
                                 "reply": said},
                    "answered_by": "assistant", "not_understood": [], "unavailable": [], **extra()}
        trace["script"]["shape"] = problem
        if tool_use_id:
            messages = messages + [
                {"role": "assistant", "content": [{"type": "tool_use", "id": tool_use_id, "name": TOOL_NAME,
                                                   "input": answer or {}}]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "is_error": True,
                                              "content": f"[script:shape] {problem}. Return the whole corrected script."}]},
            ]
        else:
            messages = messages + [{"role": "user", "content": f"[script:shape] {problem}. Use the emit_script tool."}]
    return _refused(SHAPE_GATE, **extra())
