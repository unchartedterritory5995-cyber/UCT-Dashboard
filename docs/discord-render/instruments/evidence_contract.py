"""A2 — THE EVIDENCE ELIGIBILITY CONTRACT. One place, and every gate row reads it.

⛔⛔ SELECTING EVIDENCE BY FILENAME IS NOT SELECTING EVIDENCE.

⚰️ 2026-09-14, measured, not argued. The flip gate's S2 row chose its inputs with
`glob("*real*.json")` minus anything whose name contained "chaos". On the evidence directory as it
actually stood that expression:

  · **admitted `determinism-real-20runs.json`** — a determinism artifact with no load in it at all,
    matched purely because somebody put the word "real" in its name;
  · **admitted `load-real-a-concurrent30.json`** — the run whose own report calls it VOID: its name
    says *concurrent30*, its content says `rate=30.0` with no load model, i.e. thirty arrivals per
    second, fifty times the derived design burst. Its p50 of 14,855 ms then decided the row;
  · **EXCLUDED `load-closedloop-30.json`** — the run that SUPERSEDES it, measured at the specified
    load (closed loop, concurrency 30), because nobody typed "real" into its filename.

One glob, both directions of error at once: the void run judged the row, and the run that replaced
it was invisible. ⭐ A filename is a claim somebody typed; the artifact's own labels are what the
run recorded about itself. **This module is the only place that decides what an artifact IS and
what it may be used FOR**, so a row cannot quietly disagree with another row.

⛔ REJECTED INFERENCE, WRITTEN DOWN SO IT IS NOT RE-DERIVED: "cache hits + misses == 0 while charts
were delivered ⇒ the house renderer never ran ⇒ this is the fallback." The first half is real —
`_cached_render` is reachable only through `bindings.house_fn`, which `commands.py` passes only when
`house_enabled()` — but `_cached_render` returns `produce()` untouched when `artifact_cache.enabled()`
is False, so zero counters are equally consistent with *the house ran with the cache flag off*. An
artifact that does not carry a renderer label is **UNKNOWN**, and unknown is not fallback. Guessing
here would be an instrument reporting a property of itself as a property of what it measured.

⛔ THREE DISPOSITIONS ARE NOT TWO, AND "VOID" IS THE FOURTH ON PURPOSE. A row must be able to say
"I skipped 1 void artifact and 2 I could not interpret, and judged 1" — collapsing those into
"1 judged" is how a gate reports a clean verdict over a set it never read.
"""
from __future__ import annotations

import dataclasses
import json
import pathlib

# ── the label vocabulary ────────────────────────────────────────────────────

#: What a run artifact IS. `meta.kind` carries it going forward; `kind_of` derives it from SHAPE for
#: everything written before the label existed, because a re-run is not always available and a
#: filename is not a label.
KIND_LOAD = "load"
KIND_CHAOS = "chaos"
KIND_DETERMINISM = "determinism"
KIND_CLOCK_SWEEP = "clock_sweep"
KIND_UNKNOWN = "unknown"
KINDS = (KIND_LOAD, KIND_CHAOS, KIND_DETERMINISM, KIND_CLOCK_SWEEP)

#: Which renderer actually drew the charts. ⛔ UNKNOWN IS NOT FALLBACK — a reader must be able to
#: tell "we measured the inferior renderer" from "we cannot say what we measured", and collapsing
#: them promotes an unlabelled run to the more flattering of the two readings.
RENDERER_PRODUCTION = "chart-renderer"
RENDERER_FALLBACK = "fallback"
RENDERER_UNKNOWN = "unknown"
RENDERERS = (RENDERER_PRODUCTION, RENDERER_FALLBACK, RENDERER_UNKNOWN)

#: The load model. Pre-OI-37 artifacts carry `rate` alone and are AMBIGUOUS by construction:
#: `rate=30` cannot distinguish thirty arrivals per second from thirty concurrent members, and for a
#: whole programme nobody noticed which one they were reading.
OPEN_LOOP = "open_loop"
CLOSED_LOOP = "closed_loop"
MODELS = (OPEN_LOOP, CLOSED_LOOP)

# ── what a row may want evidence FOR ────────────────────────────────────────

#: Delivery latency: the member's wait from command to chart. Renderer-dependent by definition.
PURPOSE_S2_LATENCY = "s2_latency"
#: The acknowledgement path only. Runs before any renderer is chosen, so the renderer is irrelevant.
PURPOSE_S1_ACK = "s1_ack"
#: Admission behaviour — success rate, refusals, `queue_full`. A refusal happens at the queue, which
#: is upstream of every renderer, so a fallback run is first-class evidence here.
PURPOSE_ADMISSION = "admission"
#: Fault injection exercised against the production path rather than a rig stub.
PURPOSE_CHAOS_REAL = "chaos_real"
PURPOSES = (PURPOSE_S2_LATENCY, PURPOSE_S1_ACK, PURPOSE_ADMISSION, PURPOSE_CHAOS_REAL)

# ── dispositions ────────────────────────────────────────────────────────────

#: This artifact counts toward the row's verdict.
ADMIT = "admit"
#: Marked void in its own file. Skipped, COUNTED and NAMED — never silently dropped, because a void
#: artifact is retained evidence about something else, not a mistake to be tidied away.
VOID = "void"
#: Not this row's business at all (a chaos artifact offered to the S2 row).
OUT_OF_SCOPE = "out_of_scope"
#: In scope, and cannot yield a verdict for this purpose. The row must carry the reason out loud.
INCONCLUSIVE = "inconclusive"
#: A deliberate overload. REPORTED by the row, never judged by it.
#
# ⛔⛔ THE LABEL IS SET WHEN THE RUN IS PRODUCED, NEVER APPLIED TO AN ARTIFACT AFTERWARDS. What a run
# was FOR is known only to whoever ran it; inferring it from the numbers would mean an artifact
# becomes characterisation exactly when its numbers are inconvenient, which is how a gate learns to
# excuse its own reds. `load_harness --characterisation` writes it in band at the moment of the run.
#
# ⚠️ AND IT IS NOT A WAY OUT OF A RED. Relabelling an existing artifact to quieten a row is the
# temptation this comment exists to name: if a run was produced as an SLO measurement, it stays one.
INFORMATIONAL = "informational"

PURPOSE_SLO, PURPOSE_CHARACTERISATION = "slo", "characterisation"


@dataclasses.dataclass(frozen=True)
class Artifact:
    """Everything the contract knows about one file, derived from its CONTENT."""
    path: pathlib.Path
    kind: str
    model: str | None
    renderer: str
    void: bool
    void_reason: str
    superseded_by: str
    purpose: str             # "slo" (judge it) or "characterisation" (report it, never judge)
    labelled: bool           # did it declare `meta.kind`, or did we derive the kind from shape?
    unreadable: str          # non-empty ⇒ the file could not be parsed, and that is a finding

    @property
    def name(self) -> str:
        return self.path.name


@dataclasses.dataclass(frozen=True)
class Ruling:
    disposition: str
    reason: str


def _meta(doc) -> dict:
    m = doc.get("meta") if isinstance(doc, dict) else None
    return m if isinstance(m, dict) else {}


def kind_of(doc) -> str:
    """What this artifact IS, from its declared label first and its SHAPE second.

    ⛔ Order is load-bearing. A determinism artifact also has a `meta`, so `meta` alone cannot mean
    "load"; the discriminator is the `stats` block a load run writes. Every branch below was read off
    the files on disk rather than imagined."""
    if not isinstance(doc, dict) or not doc:
        return KIND_UNKNOWN
    declared = _meta(doc).get("kind")
    if declared in KINDS:
        return declared
    has_meta = isinstance(doc.get("meta"), dict)
    if has_meta and isinstance(doc.get("stats"), dict):
        return KIND_LOAD
    if has_meta and "per_component" in doc:
        return KIND_DETERMINISM
    if {"instants", "results", "clock_dependent"} <= set(doc):
        return KIND_CLOCK_SWEEP
    # ⛔ `any`, never `all`: a chaos artifact that grows a summary field (`"ran": 13`) is still a
    # chaos artifact, and an `all()` test would quietly reclassify it as UNKNOWN the day somebody
    # adds one. The guard against a false positive is the absence of a load/determinism block above.
    if not has_meta and any(isinstance(v, dict) and "state" in v for v in doc.values()):
        return KIND_CHAOS
    return KIND_UNKNOWN


def renderer_of(doc) -> str:
    r = _meta(doc).get("renderer")
    return r if r in RENDERERS else RENDERER_UNKNOWN


def model_of(doc) -> str | None:
    m = _meta(doc).get("model")
    return m if m in MODELS else None


def real_block(doc) -> dict | None:
    """The `--real` half of a load artifact: delivery happened and was measured.

    ⛔ Derived from the block, never from the string "real" in a filename — `load-closedloop-30.json`
    has no such string and is the best real run this programme has."""
    r = doc.get("real") if isinstance(doc, dict) else None
    return r if isinstance(r, dict) else None


def is_wire_hop(doc) -> bool:
    """Did this run write to real Discord through the deliberate per-channel throttle?

    ⛔ A wire-hop run's END-TO-END LATENCY IS THE THROTTLE. Measured 2026-09-14: 23 jobs carrying
    38.6 s of intentional sleep came out at p50 12,370 ms — a number about Discord's rate limiter
    wearing an S2 label. Its DELIVERY result is still the strongest evidence there is that the wire
    hop works at all, which is why this is a per-purpose ruling and not an exclusion."""
    return float(((real_block(doc) or {}).get("deliver") or {}).get("throttle_s") or 0) > 0


def load(path) -> tuple[Artifact, object | None]:
    """Read one artifact and label it. A parse failure is RECORDED, never swallowed."""
    p = pathlib.Path(path)
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        # ⛔ KEYWORDS, NOT POSITION. This call was positional and a new field inserted mid-dataclass
        # broke it instantly — caught by the self-check, which is the system working, but a
        # positional constructor over ten fields is a trap that will be re-set by the next field.
        return Artifact(path=p, kind=KIND_UNKNOWN, model=None, renderer=RENDERER_UNKNOWN,
                        void=False, void_reason="", superseded_by="", purpose=PURPOSE_SLO,
                        labelled=False, unreadable=f"{type(e).__name__}: {e}"), None
    meta = _meta(doc)
    return Artifact(
        path=p, kind=kind_of(doc), model=model_of(doc), renderer=renderer_of(doc),
        void=bool(meta.get("void")), void_reason=str(meta.get("void_reason") or ""),
        purpose=str(meta.get("purpose") or "slo"),
        superseded_by=str(meta.get("superseded_by") or ""),
        labelled=meta.get("kind") in KINDS, unreadable="",
    ), doc


def describe(art: Artifact, doc=None) -> str:
    """The one-line identity that must sit beside any number taken from this artifact."""
    if art.unreadable:
        return f"{art.name} UNREADABLE ({art.unreadable})"
    bits = [art.kind]
    if art.kind == KIND_LOAD:
        meta = _meta(doc or {})
        if art.model == CLOSED_LOOP:
            bits.append(f"closed loop c={meta.get('concurrency')}")
        elif art.model == OPEN_LOOP:
            bits.append(f"open loop {meta.get('arrival_rate')}/s")
        else:
            bits.append("UNLABELLED model")
        bits.append(f"renderer={art.renderer}")
    # ⛔ An EXPRESSION, not an `if` statement, and that is deliberate: `_load_prelude`'s void GUARD
    # is the line a mutation control has to be able to address on its own, and a second
    # `if art.void:` in this display helper made the anchor ambiguous. Two textually identical lines
    # where only one is load-bearing is how a mutation proves the wrong copy.
    bits += ["VOID"] if art.void else []
    return f"{art.name} [{', '.join(bits)}]"


# ── the rulings ─────────────────────────────────────────────────────────────

def _load_prelude(art: Artifact, doc) -> Ruling | None:
    """Everything the three load-artifact purposes refuse for the SAME reason, decided once."""
    if art.unreadable:
        return Ruling(INCONCLUSIVE, f"{art.name}: unreadable — {art.unreadable}")
    if art.kind != KIND_LOAD:
        return Ruling(OUT_OF_SCOPE, f"{art.name}: kind={art.kind}, not a load run")
    if art.void:
        return Ruling(VOID, f"{art.name}: marked void — {art.void_reason or 'no reason recorded'}"
                      + (f" (superseded by {art.superseded_by})" if art.superseded_by else ""))
    if art.purpose == PURPOSE_CHARACTERISATION:
        return Ruling(INFORMATIONAL,
                      f"{art.name}: labelled a deliberate overload when it was produced — its "
                      f"numbers describe behaviour far above the design burst and are reported, "
                      f"never judged against an SLO")
    return None


def admits(art: Artifact, doc, purpose: str) -> Ruling:
    """May this artifact inform this row, and if not, WHY NOT — in the row's own words."""
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}; expected one of {PURPOSES}")

    if purpose == PURPOSE_CHAOS_REAL:
        if art.unreadable:
            return Ruling(INCONCLUSIVE, f"{art.name}: unreadable — {art.unreadable}")
        if art.kind != KIND_CHAOS:
            return Ruling(OUT_OF_SCOPE, f"{art.name}: kind={art.kind}, not a chaos run")
        if art.void:
            return Ruling(VOID, f"{art.name}: marked void — {art.void_reason or 'no reason'}")
        # ⛔ REAL vs RIG IS READ OFF EACH SCENARIO'S OWN `mode`, not the filename. `chaos-full.json`
        # says `mode="rig"` on all thirteen and passed all thirteen; a name-based selector that let
        # it in would report thirteen passes for a run where nothing production-shaped executed.
        modes = {str((v or {}).get("mode") or "") for v in (doc or {}).values()
                 if isinstance(v, dict)}
        if not any(m.startswith("real") for m in modes):
            return Ruling(OUT_OF_SCOPE,
                          f"{art.name}: every scenario ran against the rig "
                          f"(modes={sorted(m or '<unset>' for m in modes)}) — stubs are not evidence "
                          f"for renderer_down, bars_api_502, discord_429 or mid_job_restart")
        return Ruling(ADMIT, f"{art.name}: real-mode chaos run")

    ruling = _load_prelude(art, doc)
    if ruling is not None:
        return ruling

    if purpose == PURPOSE_S1_ACK:
        # The ack path runs before a renderer is chosen, so `renderer` is irrelevant here BY
        # CONSTRUCTION — stated rather than left as an omission, because a reader will ask.
        stats = (doc or {}).get("stats")
        if not isinstance(stats, dict) or not isinstance(stats.get("n"), int) or stats["n"] <= 0:
            return Ruling(INCONCLUSIVE, f"{art.name}: no ack samples (stats.n)")
        if art.model is None:
            return Ruling(INCONCLUSIVE,
                          f"{art.name}: unlabelled load model — an ack percentile without the load "
                          f"that produced it cannot be compared to anything")
        return Ruling(ADMIT, f"{art.name}: {stats['n']} ack sample(s)")

    real = real_block(doc)
    if real is None:
        return Ruling(INCONCLUSIVE,
                      f"{art.name}: ACK-PATH ONLY (no `real` block) — stub symbols and a zero-cost "
                      f"handler say nothing about delivery")
    # ⛔ `not in MODELS`, deliberately spelled differently from the `is None` test in the S1 branch
    # above. They are the same predicate and they are two SEPARATE rails, so each needs an anchor a
    # single-line mutation can address on its own — a mutation that silently matched both would
    # prove one guard while cancelling the other (`lesson_mutations_can_cancel_each_other`).
    if art.model not in MODELS:
        return Ruling(INCONCLUSIVE,
                      f"{art.name}: unlabelled load model — `rate` alone cannot distinguish "
                      f"arrivals/second from concurrency, so this number describes no known load")

    if purpose == PURPOSE_ADMISSION:
        if not isinstance(real.get("success_rate"), (int, float)):
            return Ruling(INCONCLUSIVE, f"{art.name}: no success_rate recorded")
        if not real.get("jobs"):
            return Ruling(INCONCLUSIVE, f"{art.name}: zero jobs offered — nothing was admitted or "
                                        f"refused, and an empty set is not a clean run")
        return Ruling(ADMIT, f"{art.name}: {real['jobs']} job(s) offered")

    # PURPOSE_S2_LATENCY
    if is_wire_hop(doc):
        d = real.get("deliver") or {}
        return Ruling(INCONCLUSIVE,
                      f"{art.name}: wire-hop run — its end-to-end latency is Discord's throttle "
                      f"({float(d.get('throttle_s') or 0):.0f}s deliberate sleep over "
                      f"{d.get('http_200', 0)}×200), not the system's")
    if art.renderer != RENDERER_PRODUCTION:
        why = ("renderer=fallback; needs chart-renderer" if art.renderer == RENDERER_FALLBACK else
               "renderer=unknown; this artifact predates the renderer label and cannot say which "
               "renderer drew the charts — needs a re-run against chart-renderer")
        return Ruling(INCONCLUSIVE, f"{art.name}: {why}")
    e2e = real.get("end_to_end_ms") or {}
    stated = [k for k in ("p50", "p95", "p99") if isinstance(e2e.get(k), (int, float))]
    if not stated or not real.get("jobs"):
        # ⛔ NON-VACUITY. A run whose percentiles are all null breaches no ceiling — every comparison
        # is skipped — and the old shape counted that as JUDGED. "Nothing exceeded the ceiling" and
        # "nothing was measured" must never render as the same sentence.
        return Ruling(INCONCLUSIVE,
                      f"{art.name}: states {len(stated)}/3 percentile(s), jobs={real.get('jobs')!r}")
    return Ruling(ADMIT, f"{art.name}: {len(stated)}/3 percentiles over {real['jobs']} job(s)")


@dataclasses.dataclass
class Selection:
    """What a row is allowed to judge, and everything it is not — each named, never a bare count."""
    purpose: str
    admitted: list = dataclasses.field(default_factory=list)      # [(Artifact, doc, Ruling)]
    informational: list = dataclasses.field(default_factory=list)  # [(Artifact, doc, Ruling)]
    voided: list = dataclasses.field(default_factory=list)        # [Ruling]
    inconclusive: list = dataclasses.field(default_factory=list)  # [Ruling]
    out_of_scope: list = dataclasses.field(default_factory=list)  # [Ruling]
    scanned: int = 0

    def excluded_note(self, limit: int = 3, width: int = 110) -> str:
        """The sentence a row appends so an exclusion is never invisible.

        ⛔ TRUNCATED PER REASON, NEVER PER LIST. A void artifact's recorded reason is a paragraph —
        it has to be, because it is the thing that stops a future reader re-admitting the file — and
        pasted whole it buried the row's own verdict in a wall of text. Cutting the LIST instead
        would drop artifact NAMES, which is the half a reader needs to go look
        (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`). Each reason is clipped;
        every excluded artifact is still named."""
        parts = []
        for label, rulings in (("void", self.voided), ("inconclusive", self.inconclusive)):
            if rulings:
                shown = " · ".join(
                    (r.reason if len(r.reason) <= width else r.reason[:width - 1].rstrip() + "…")
                    for r in rulings[:limit])
                more = f" (+{len(rulings) - limit} more)" if len(rulings) > limit else ""
                parts.append(f"{len(rulings)} {label}: {shown}{more}")
        return " | ".join(parts)


def select(directory, purpose: str, *, pattern: str = "*.json") -> Selection:
    """Every artifact in `directory`, ruled on for `purpose`. CONTENT decides; the glob is a file
    walk, not a filter — `*.json` matches everything and the contract does the choosing."""
    sel = Selection(purpose=purpose)
    d = pathlib.Path(directory)
    if not d.exists():
        return sel
    for p in sorted(d.glob(pattern)):
        art, doc = load(p)
        sel.scanned += 1
        ruling = admits(art, doc, purpose)
        if ruling.disposition == ADMIT:
            sel.admitted.append((art, doc, ruling))
        elif ruling.disposition == INFORMATIONAL:
            sel.informational.append((art, doc, ruling))
        elif ruling.disposition == VOID:
            sel.voided.append(ruling)
        elif ruling.disposition == INCONCLUSIVE:
            sel.inconclusive.append(ruling)
        else:
            sel.out_of_scope.append(ruling)
    return sel
