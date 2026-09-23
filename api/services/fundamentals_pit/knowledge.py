"""What was KNOWN at an instant: the point-in-time selection rule.

For a period key (tag, unit, start, end) the value known at T is the value from
the filing with the LATEST `public_at` that is <= T and that reported the key.

  * An original filing at T1 reporting A, then a restatement at T2 reporting B:
      T < T1        -> nothing (or whatever an even earlier filing said)
      T1 <= T < T2  -> A
      T >= T2       -> B
    B is NEVER visible before T2, and A stays reconstructable forever because no
    fact is ever discarded.
  * A later filing that simply does not repeat a period leaves the last
    disclosed value standing (silence is not a retraction).

Every fact must be joined to its filing's `public_at` through `accn`. A fact
whose accession is missing from the submissions history cannot be dated, and is
EXCLUDED rather than guessed -- `unjoined` records every such fact.

Conflict rule: one filing reporting two DIFFERENT values for one key is a source
ambiguity. The key is withheld at that filing (the previous knowledge stands)
and the conflict is recorded; it is never resolved by picking one.
"""
from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from .facts import Fact
from .filings import Filing


def _scale(v: float) -> float:
    """The rounding unit a reported value was apparently stated in (1, 1e3, 1e6...)."""
    v = abs(v)
    if v == 0 or v != int(v):
        return 0.0
    sc = 1.0
    while v % (sc * 10) == 0 and sc < 1e9:
        sc *= 10
    return sc


def values_equivalent(a: float, b: float) -> bool:
    """Equal, or equal once the more precise value is rounded to the coarser
    value's reporting unit -- PLUG re-reported -46,958,921 as -47,000,000 when
    it moved its statements to millions. That is a presentation change, not a
    restatement, and must not open a restatement epoch."""
    if a == b:
        return True
    sc = max(_scale(a), _scale(b))
    if sc >= 1000:
        return round(a / sc) * sc == round(b / sc) * sc
    return False


def is_sign_flip(prev: float, new: float) -> bool:
    """A value re-reported with the same magnitude and the opposite sign is a
    TAGGING ERROR, not a restatement (MEASURED: PLUG FY2010 net loss read
    -47.0M, +47.0M, -47.0M across three consecutive 10-Qs; CELH Q2 2019 net
    loss flipped to +1.47M in one comparative and back)."""
    return prev != 0 and new == -prev


MATERIALITY = 0.005


def is_material(a: float, b: float) -> bool:
    """A revision opens a restatement EPOCH only above 0.5% of the larger value.

    Every revision, however small, is still applied to ITS OWN period from its
    filing onward -- this only decides whether OTHER facts overlapping it are
    treated as stale. MEASURED: SMCI's May 2025 10-Q revised 9M FY24 operating
    cash flow by $6M (0.24%); treating that as an epoch voided the FY24 10-K
    and blanked TTM cash flow for 3.5 months. The mixing error a sub-threshold
    revision can leave in a derived value is bounded by the revision itself."""
    m = max(abs(a), abs(b))
    return m > 0 and abs(a - b) / m > MATERIALITY


def is_scale_error(prev: float, new: float) -> bool:
    """A value re-reported at 1/1,000 or 1/1,000,000 (or x1,000 / x1,000,000)
    of the previous one, equal after rounding, is a SCALE TAGGING ERROR (the
    filer tagged "in thousands" numbers without the scale). MEASURED: CELH's
    May 2022 10-Q re-reported Q1 2021 net income available to common as 585.0
    where every other filing says 585,424; taken as a restatement it opened an
    epoch that voided the correct FY2021 value."""
    if prev == 0 or new == 0 or (prev > 0) != (new > 0) or prev == new:
        return False
    big, small = max(abs(prev), abs(new)), min(abs(prev), abs(new))
    r = big / small
    return any(abs(r / k - 1.0) <= 0.005 for k in (1e3, 1e6))


@dataclass(frozen=True)
class KnownFact:
    fact: Fact
    public_at: datetime
    form: str


@dataclass
class Knowledge:
    """Immutable-after-build index of dated facts."""
    history: dict[tuple, list[KnownFact]]           # key -> ascending public_at
    events: list[datetime]                          # distinct public_at, ascending
    unjoined: list[Fact] = field(default_factory=list)
    conflicts: list[tuple] = field(default_factory=list)   # (key, accn, values)
    quarantined: list[tuple] = field(default_factory=list) # (key, accn, prev, new)
    # Restating FILINGS detected outside companyfacts (restatement_signals.py):
    # [(public_at, start, end[, tag])] epochs; without a tag they apply to
    # every tag, with one only to that concept. companyfacts
    # holds only non-dimensional facts, so a 10-K that tags its restated
    # quarters under srt:RestatementAdjustmentMember is invisible to the
    # value-change detector -- MEASURED on CELH's FY2021 10-K (2022-03-16).
    filing_epochs: list[tuple] = field(default_factory=list)

    # ── queries ────────────────────────────────────────────────────────────
    def known(self, key: tuple, t: datetime) -> KnownFact | None:
        rows = self.history.get(key)
        if not rows:
            return None
        i = bisect_right([r.public_at for r in rows], t)
        return rows[i - 1] if i else None

    def state_at(self, t: datetime, tag: str | None = None) -> dict[tuple, KnownFact]:
        out = {}
        for key, rows in self.history.items():
            if tag is not None and key[0] != tag:
                continue
            k = self.known(key, t)
            if k is not None:
                out[key] = k
        return out

    def tags(self) -> set[str]:
        return {k[0] for k in self.history}

    def _changes(self, tag: str, same) -> list[tuple]:
        cache = self.__dict__.setdefault("_chg_cache", {})
        ck = (tag, same)
        if ck not in cache:
            same_ = same or (lambda a, b: values_equivalent(a.fact.val, b.fact.val))
            out = []
            for key, rows in self.history.items():
                if key[0] != tag:
                    continue
                for a, b in zip(rows, rows[1:]):
                    if not same_(a, b) and is_material(a.fact.val, b.fact.val):
                        out.append((b.public_at, key[2] or key[3], key[3], a.public_at))
            out.sort()
            cache[ck] = out
        return cache[ck]

    def restatements(self, tag: str, t: datetime, same=None, seed_tags: frozenset | None = None) -> list[tuple]:
        """Restatement EPOCHS of `tag` public at or before t: [(public_at, start, end)].

        A filing that reports a value for a key DIFFERENT from the value
        previously known is a change. Not every change opens an epoch:

          * GENUINE -- the value it replaces was itself on the current basis
            (known at or after the latest overlapping epoch). AAPL's FY2009
            10-K/A (2010-01-25) replacing the original 10-K's revenue.
          * CATCH-UP -- the value it replaces was already stale (known before
            the latest overlapping epoch). AAPL's July 2010 10-Q re-reporting
            9M FY2009 on the basis the 10-K/A had already established.

        Only genuine changes are epochs; treating catch-ups as epochs would
        invalidate the very values that are already correct. Epochs are a pure
        function of the change history, so they are computed once per tag and
        filtered by t (an epoch's status never depends on anything after it).
        `same(a_row, b_row)` decides equality (per-share values compare on one
        share basis, so a split re-basing is not a change at all).
        """
        cache = self.__dict__.setdefault("_epoch_cache", {})
        seeds_for = frozenset(seed_tags or ()) | {tag}
        ck = (tag, same, tuple(self.filing_epochs), seeds_for)
        if ck not in cache:
            # Filing-signal epochs are epochs too: a later value change that only
            # brings a period onto the basis a restating filing already
            # established is a CATCH-UP, not a new restatement.
            # (public_at, start, end[, tag]) -- a 4th element scopes the epoch to
            # ONE concept: MEASURED in the SEC FS data set 2022q1, 628 of 4,862
            # 10-Ks carried restatement-axis facts (the SPAC-warrant wave), almost
            # all about liabilities/equity. Voiding every tag for them would
            # withhold revenue and margins that were never restated.
            # `seed_tags`: tags pooled with this one as ONE concept (metrics.
            # _equivalent_pools) share their filing-signal epochs -- CELH's
            # signal names NetIncomeLoss; its pooled twin ...AvailableToCommon...
            # must not treat the same catch-up as a new restatement.
            seeded = sorted((ep[0], ep[1], ep[2]) for ep in self.filing_epochs
                            if len(ep) < 4 or ep[3] is None or ep[3] in seeds_for)
            epochs: list[tuple] = []
            for r, s, e, prev in self._changes(tag, same):
                prior = [er for er, es, ee in seeded + epochs if er < r and es <= e and s <= ee]
                latest = max(prior, default=None)
                if latest is None or prev >= latest:
                    epochs.append((r, s, e))
            cache[ck] = sorted(seeded + epochs)
        return [ep for ep in cache[ck] if ep[0] <= t]

    def events_for(self, tags: set[str]) -> list[datetime]:
        return sorted({r.public_at for k, rows in self.history.items() if k[0] in tags for r in rows})

    def iter_states(self, tags: set[str]):
        """Yield (t, state) at every instant knowledge of `tags` changed.
        `state` is ONE dict mutated in place -- consume it before advancing."""
        by_t: dict[datetime, list[tuple]] = defaultdict(list)
        for key, rows in self.history.items():
            if key[0] in tags:
                for r in rows:
                    by_t[r.public_at].append((key, r))
        state: dict[tuple, KnownFact] = {}
        for t in sorted(by_t):
            for key, r in by_t[t]:
                state[key] = r
            yield t, state


# Forms whose XBRL states the FINANCIAL STATEMENTS. Excluded on purpose:
#   DEF 14A  pay-versus-performance tables re-tag NetIncomeLoss ROUNDED (JPM's
#            April 2026 proxy restated FY2025 net income 57,048M as 57,000M, and
#            "latest disclosure wins" turned a derived Q4 of 13,025M into 12,977M);
#   424B* / S-* prospectus and registration exhibits (JPM: 3,725 424B2 facts).
KNOWLEDGE_FORMS = frozenset({
    "10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-KT/A", "10-QT", "10-QT/A",
    "8-K", "8-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A",
})


def _coarser_rounding(prev: float, new: float) -> bool:
    """`new` restates `prev` only by rounding it more coarsely."""
    return prev != new and values_equivalent(prev, new) and _scale(new) > _scale(prev)


def build(facts: list[Fact], filings: dict[str, Filing],
          forms: frozenset = KNOWLEDGE_FORMS) -> Knowledge:
    by_key_accn: dict[tuple, dict[str, set[float]]] = defaultdict(lambda: defaultdict(set))
    unjoined: list[Fact] = []
    first_fact: dict[tuple, Fact] = {}
    for f in facts:
        if f.accn not in filings:
            unjoined.append(f)
            continue
        if filings[f.accn].form not in forms:
            continue
        by_key_accn[f.period_key][f.accn].add(f.val)
        first_fact.setdefault((f.period_key, f.accn, f.val), f)

    history: dict[tuple, list[KnownFact]] = {}
    conflicts: list[tuple] = []
    quarantined: list[tuple] = []
    for key, per_accn in by_key_accn.items():
        rows: list[KnownFact] = []
        for accn, vals in per_accn.items():
            if len(vals) != 1:
                conflicts.append((key, accn, tuple(sorted(vals))))
                continue
            (v,) = vals
            fil = filings[accn]
            rows.append(KnownFact(first_fact[(key, accn, v)], fil.public_at, fil.form))
        # Same instant from two filings (rare): order by accession for determinism.
        rows.sort(key=lambda r: (r.public_at, r.fact.accn))
        kept: list[KnownFact] = []
        for r in rows:
            if kept and (is_sign_flip(kept[-1].fact.val, r.fact.val)
                         or is_scale_error(kept[-1].fact.val, r.fact.val)):
                quarantined.append((key, r.fact.accn, kept[-1].fact.val, r.fact.val))
                continue
            if kept and _coarser_rounding(kept[-1].fact.val, r.fact.val):
                continue            # a rounder copy never replaces a precise value
            kept.append(r)
        if kept:
            history[key] = kept
    events = sorted({r.public_at for rows in history.values() for r in rows})
    return Knowledge(history=history, events=events, unjoined=unjoined, conflicts=conflicts,
                     quarantined=quarantined)
