"""THE transcript-coverage rule. One implementation, two policies on top of it.

Owner ruling, 2026-09-14, verbatim:

    "Coverage gate = internal gaps only (any gap > 30s between the first and last
     speech cue); trailing dead air after a sign-off is not a shortfall. Re-run the
     under-98% audit under the new rule and update the list."
    "VAD is never disabled to raise coverage; hallucination probe recorded as the
     reason. Add a test that a silent tail produces zero cues."

⚰️ WHY THE OLD RULE HAD TO GO. `last_cue_start / duration` answers "does speech reach
the end of the file", not "did we capture the speech". Measured overnight 2026-09-13/14
(docs/wisdom/OVERNIGHT-CHECKPOINTS.md checkpoint 11), three Desk videos re-transcribed
with faster-whisper base.en, int8, VAD on, condition_on_previous_text=False:

    id   video          duration   span rule   internal gaps >= 30s   what it actually was
    356  rKVAkk3811Q     6830 s    4.2 %  ->  100.0 %          0      A REAL DEFECT: one
                                                                      segment's transcript
                                                                      paired to another
                                                                      segment's MP4
    254  G80NM-hRoas     4532 s   68.7 %  ->   61.6 %          0      complete; 1742 s of
                                                                      dead air after the
                                                                      sign-off
    221  myuRq5qVOgI     4386 s   92.8 %  ->   92.3 %          0      complete;  335 s of
                                                                      dead air after the
                                                                      sign-off

Two of the three videos on the re-transcription list were already complete. The recording
keeps rolling after everyone says goodbye; charging that to the transcript re-transcribes
healthy sessions and, worse, teaches everyone to mute the alert.

⛔⛔ AND THE DANGEROUS "FIX" IS THE OBVIOUS ONE. Turning VAD off raises the span number by
MANUFACTURING TEXT OUT OF SILENCE — see STT_VAD_RATIONALE below, which carries the measured
evidence. Text invented from dead air would then be segmented, extracted, scored and
attributed to a NAMED AUTHOR. A number that improves while the artifact gets worse.

─────────────────────────────────────────────────────────────────────────────────────────
LEADING SILENCE — the judgement call, and it is not a detail
─────────────────────────────────────────────────────────────────────────────────────────
The ruling says "internal gaps only" and is silent on the run-up to the first cue. Read
literally, leading silence is free. ⛔ THAT READING PASSES VIDEO 356 — the defect this
entire guard was built for. Its stored transcript ran 57 s .. 345 s of a 6,830 s session:
76 dense cues, NO internal gap over 30 s, leading silence 57 s. "Internal gaps only" calls
it complete and authorises the delete of the only copy.

DECISION: leading silence over the same threshold is a shortfall, reported under its own
reason (`leading_silence`), never merged into the internal-gap count.

WHY THE TWO TAILS ARE NOT SYMMETRIC, which is the whole argument:
  * A trailing tail has an observed, benign, universal cause — the sign-off. 254 and 221
    both end on one ("...have a great night", "...catch you later guys") and a VAD-off
    probe of both tails found no speech after it.
  * There is no equivalent for the head. A session opens with speech (356's repaired
    transcript opens at 0 s with "we got some people joining in here"); nobody records ten
    silent minutes and then starts. Leading silence at scale means the transcript begins
    late, and a transcript that begins late is A LOST BEGINNING.
  * The error directions are opposite. A false positive here re-transcribes a healthy
    video — cheap, and visible. A false negative deletes a Zoom recording that has no
    trash and no recovery.
⚠️ It is still a judgement, so it is MEASURED, not assumed: `leading_silence_s` is on every
result, `LEADING_SILENCE_COUNTS` names the choice in one place, and the audit reports a
leading-silence failure separately from a gap failure so a false positive is diagnosable
instead of mysterious.

─────────────────────────────────────────────────────────────────────────────────────────
WHAT THIS RULE STRUCTURALLY CANNOT SEE — read before wiring it to anything irreversible
─────────────────────────────────────────────────────────────────────────────────────────
⛔⛔ A TRANSCRIPT TRUNCATED AT THE END IS INDISTINGUISHABLE FROM A LONG OUTRO. That is
inherent in the ruling, not a gap in this code, and knowing `duration_s` does not fix it:
duration tells you HOW MUCH trailing silence there is, never whether it was speech you
lost. `verdict="complete"` therefore means "no hole between the first and last word we
have", and `end_verified` records whether the tail was even measurable.

CONSEQUENCE, and it is the reason `SPAN_THRESHOLD` still exists in this file: the Zoom
delete gate (`desk_session_insights._trash_gate`, CONTRACTS §8a.6a) must NOT adopt this
verdict as its authorisation. See the comment at that gate.

Ownership: stream S-C (CONTRACTS §2), the same owner as
`api/services/desk_session_insights.py` and `api/services/wisdom/sources/transcripts.py` —
the two call sites that each had their own copy of the arithmetic until this file existed.
"""
from __future__ import annotations

#: A gap longer than this between consecutive speech cues is a hole. Owner ruling.
MAX_INTERNAL_GAP_S = 30

#: ⛔ The LEGACY span rule (last cue start / media duration). It is NOT the coverage
#: verdict any more and must never be re-described as one. It survives for exactly one
#: consumer: the Zoom delete gate, which needs "speech reaches the end of the file"
#: precisely because the gap rule cannot see an end-truncation (see the header).
SPAN_THRESHOLD = 0.98

#: The leading-silence decision, in ONE place so it can be found, cited and changed.
LEADING_SILENCE_COUNTS = True

#: How many over-threshold gaps a result enumerates. Names, not just a count — but
#: bounded, because a shredded transcript can produce hundreds.
MAX_REPORTED_GAPS = 5

# ── The STT settings this rule assumes, and the measurement behind each ──────────────
#: ⛔⛔ NEVER FLIP THIS TO RAISE COVERAGE. Owner ruling 2026-09-14.
STT_REQUIRED_VAD_FILTER = True
#: ⭐ The measured evidence, kept beside the setting rather than in a report nobody opens.
STT_VAD_RATIONALE = (
    "2026-09-14: video 221 (myuRq5qVOgI) has 335 s of dead air after its sign-off. Driving "
    "that tail again with vad_filter=False did not find missed speech — it produced the "
    'string "All right." ELEVEN times, whisper hallucinating on silence. Disabling VAD '
    "would push 221's span number toward 100% by manufacturing transcript text out of dead "
    "air, and that text would then be extracted, scored and attributed to a named author. "
    "Trailing dead air is not a shortfall (MAX_INTERNAL_GAP_S is the gate), so there is no "
    "coverage number VAD-off could legitimately buy."
)
#: Measured 2026-09-11 on the render pipeline and re-used by the overnight STT run: the
#: hallucination LOOP class VAD does not cover. N=12 -> 1/12 distinct and clean.
STT_CONDITION_ON_PREVIOUS_TEXT = False

_VERDICTS = ("complete", "incomplete", "inconclusive")


def _prepared(cues) -> tuple[list, int, int]:
    """[(start, end|None)] sorted by start, plus (pairs_with_end, pairs_total).

    ⚠️ Cues are documented as time-ordered and that is an upstream parser's assumption,
    not a guarantee — sort rather than trust the order (same reason
    `desk_session_insights._max_cue_t` verifies ordering before reading cues[-1])."""
    out: list = []
    for c in cues or []:
        if not isinstance(c, dict):
            continue
        try:
            t = float(c.get("t"))
        except (TypeError, ValueError):
            continue
        if t != t or t < 0:  # NaN, or a stamp that is not a time
            continue
        end = c.get("end")
        try:
            end = float(end) if end is not None else None
        except (TypeError, ValueError):
            end = None
        if end is not None and (end != end or end < t):
            end = None
        out.append((t, end))
    out.sort(key=lambda p: p[0])
    with_end = sum(1 for _, e in out[:-1] if e is not None) if len(out) > 1 else 0
    return out, with_end, max(len(out) - 1, 0)


def _duration(duration_s):
    try:
        d = float(duration_s)
    except (TypeError, ValueError):
        return None
    return d if d > 0 else None


def transcript_coverage(cues, duration_s=None, *, max_internal_gap_s: int = MAX_INTERNAL_GAP_S) -> dict:
    """Measure one transcript against the owner's rule. Pure; never raises.

    `cues` are `{"t": seconds}` dicts, optionally carrying `"end"`. `duration_s` is the
    media duration and is OPTIONAL — the verdict does not need it, which is the point:
    the audit catalog has 314 rows and a duration for none of them.

    Returns every fact, the verdict and the WHY:

      verdict   "complete"     no internal gap over the threshold, and (see the header)
                               no leading silence over it either
                "incomplete"   a hole was measured; `reasons` names which kind
                "inconclusive" the inputs cannot answer the question (no cues at all is
                               NOT this — see below)
      passes    True / False / None, mirroring the verdict. ⛔ `None` is not a pass.
      reason    one sentence, for an alert or an audit row
      reasons   machine-readable: 'internal_gap' | 'leading_silence' | 'no_cues' |
                'single_cue'

    ⛔ ZERO CUES IS `incomplete`, NOT `inconclusive`. A probe over a silent REGION
    returning nothing is correct and expected (that is what VAD is for); a whole SESSION
    with no speech cue is a transcript that captured nothing. The two questions are asked
    of different things, and only the second one reaches this function.
    ⛔ A SINGLE CUE IS `inconclusive`: one cue cannot establish continuity, and a
    `largest_internal_gap_s` of 0 computed over zero pairs is a saturated instrument
    reporting "no problem" — `lesson_a_saturated_instrument_reports_zero`.
    """
    threshold = float(max_internal_gap_s)
    prepared, pairs_with_end, pairs_total = _prepared(cues)
    duration = _duration(duration_s)

    facts: dict = {
        "n_cues": len(prepared),
        "first_cue_t": None,
        "last_cue_t": None,
        "last_cue_end": None,
        "cue_span_s": None,
        "duration_s": duration,
        "leading_silence_s": None,
        "trailing_silence_s": None,
        "trailing_silence_ratio": None,
        "internal_gaps": [],
        "internal_gap_count": 0,
        "internal_gap_total_s": 0.0,
        "largest_internal_gap_s": None,
        "gap_basis": "none",
        "span_ratio": None,
        "end_verified": False,
        "threshold_s": threshold,
        "leading_silence_counts": LEADING_SILENCE_COUNTS,
        "verdict": "incomplete",
        "passes": False,
        "reasons": ["no_cues"],
        "reason": "no speech cues at all: the transcript captured nothing",
    }
    if not prepared:
        # ⛔ "No cues at all" is MEASURED, not unmeasurable, whenever a duration exists —
        # span 0.0, tail = the whole file. The delete gate branches on `span_ratio is None`
        # to mean "we could not take the measurement", and collapsing the two would page
        # "could not be measured" for a transcript that demonstrably captured nothing.
        if duration is not None:
            facts.update(span_ratio=0.0, trailing_silence_s=round(duration, 2),
                         trailing_silence_ratio=1.0, end_verified=True)
        return facts

    first_t = prepared[0][0]
    last_t = prepared[-1][0]
    last_end = prepared[-1][1] if prepared[-1][1] is not None else last_t
    facts.update(first_cue_t=round(first_t, 2), last_cue_t=round(last_t, 2),
                 last_cue_end=round(last_end, 2), cue_span_s=round(last_end - first_t, 2),
                 leading_silence_s=round(first_t, 2))

    if duration is not None:
        trailing = max(0.0, duration - last_end)
        facts.update(trailing_silence_s=round(trailing, 2),
                     trailing_silence_ratio=round(trailing / duration, 4),
                     # ⛔ span_ratio is the LEGACY number and deliberately keeps the legacy
                     # numerator (the last cue START, what education_service cues carry),
                     # so a stored coverage_ratio does not silently change meaning.
                     # ⛔ AND IT IS NOT ROUNDED HERE. The Zoom delete gate compares it to
                     # 0.98; rounding to 4dp turns 0.97996 into 0.98 and authorises a
                     # delete the old arithmetic refused. Callers that STORE it round;
                     # the caller that DECIDES on it must not.
                     span_ratio=min(1.0, last_t / duration),
                     end_verified=True)

    gaps = []
    for i in range(len(prepared) - 1):
        prev_t, prev_end = prepared[i]
        nxt_t = prepared[i + 1][0]
        silent_from = prev_end if prev_end is not None else prev_t
        gaps.append((max(0.0, nxt_t - silent_from), round(silent_from, 2)))
    if gaps:
        over = sorted(((g, after) for g, after in gaps if g > threshold), reverse=True)
        facts.update(
            largest_internal_gap_s=round(max(g for g, _ in gaps), 2),
            internal_gap_count=len(over),
            internal_gap_total_s=round(sum(g for g, _ in over), 2),
            internal_gaps=[{"gap_s": round(g, 2), "after_t": after}
                           for g, after in over[:MAX_REPORTED_GAPS]],
            gap_basis=("cue_end_to_next_start" if pairs_with_end == pairs_total else
                       "cue_start_to_next_start" if pairs_with_end == 0 else "mixed"),
        )

    # ⚠️ A start-to-start basis OVER-states silence by the length of the speech in the
    # preceding cue, so it errs toward flagging. That is the safe direction for a "did we
    # lose speech" test and it is recorded rather than corrected, because correcting it
    # would need cue durations the stored '[m:ss] text' format does not carry.

    reasons: list[str] = []
    if len(prepared) == 1:
        facts.update(verdict="inconclusive", passes=None, reasons=["single_cue"],
                     reason="a single cue cannot establish internal continuity")
        return facts
    if facts["internal_gap_count"]:
        reasons.append("internal_gap")
    if LEADING_SILENCE_COUNTS and first_t > threshold:
        reasons.append("leading_silence")

    if reasons:
        parts = []
        if "internal_gap" in reasons:
            parts.append(f"{facts['internal_gap_count']} internal gap(s) over {threshold:g}s "
                         f"(largest {facts['largest_internal_gap_s']:g}s, "
                         f"{facts['internal_gap_total_s']:g}s total)")
        if "leading_silence" in reasons:
            parts.append(f"{facts['leading_silence_s']:g}s of silence before the first cue "
                         f"(over {threshold:g}s): the transcript begins late")
        facts.update(verdict="incomplete", passes=False, reasons=reasons,
                     reason="; ".join(parts))
        return facts

    tail = ("" if not facts["end_verified"] else
            f"; {facts['trailing_silence_s']:g}s of trailing dead air is not a shortfall")
    unverified = ("" if facts["end_verified"] else
                  "; the END was NOT checked (no media duration) and an end-truncation is "
                  "invisible to this rule either way")
    facts.update(verdict="complete", passes=True, reasons=[],
                 reason=f"no internal gap over {threshold:g}s between the first and last "
                        f"cue{tail}{unverified}")
    return facts


def span_ratio(cues, duration_s):
    """⛔ LEGACY ONLY: last cue start / duration, capped at 1.0. None = not measurable.

    Kept as a named function so the two consumers that still need the old number get it
    from the SAME arithmetic as the verdict — `lesson_a_second_authority_over_one_value`.
    Do not reach for this to decide whether a transcript is complete."""
    return transcript_coverage(cues, duration_s)["span_ratio"]
