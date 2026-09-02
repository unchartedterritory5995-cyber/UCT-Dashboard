# tools/buzz_derive_collisions.py
"""Regenerate api/data/buzz_collisions.json from a real message corpus.

This is the reproducibility half of Task 5's Ruling 21: `CHAT_WORDS` used to
be a hand-typed guess; the fix is DERIVED, and derived means "a script anyone
can re-run on a fresh corpus," not "a one-off scratch measurement." Do not
hand-edit the output file -- run this instead.

The rule (measured, not guessed): a token that is a real ticker AND an
ordinary word appears in chat mostly LOWERCASE ("big spot to breakout"); a
token used as a ticker appears mostly UPPERCASE. So for every symbol in the
universe, count how many times the corpus writes it in EXACTLY its uppercase
ticker form ("as_ticker") versus any other casing ("as_word"). A token seen
>= MIN_SEEN times total with < MAX_UPPER_PCT of those uppercase is a word --
i.e. a genuine collision -- and gets written to the output file.

⛔ What this CANNOT catch, by design: uppercase-by-convention acronyms (AI,
RS, EMA, SMA, MA, DD, OI, RSI, PEG ...) are written uppercase whether the room
means the acronym or the ticker, so casing carries no signal for them. Those
stay hand-curated in `buzz_universe.HOUSE_VOCAB` -- this script must never
write to that set, and its output must never be merged into it.

Usage:
  python tools/buzz_derive_collisions.py
  python tools/buzz_derive_collisions.py --corpus path/to/messages.json --out api/data/buzz_collisions.json
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import os
import pathlib
import re
import sys

MIN_SEEN = 8
MAX_UPPER_PCT = 35.0
DEFAULT_CORPUS = "uct_intelligence/data/processed/processed_messages.json"
DEFAULT_OUT = "api/data/buzz_collisions.json"

_TOKEN = re.compile(r"[A-Za-z]+")


def _load_corpus_texts(path: pathlib.Path) -> list[str]:
    """Accept whatever shape the corpus ships in: a bare list of strings, a
    list of message dicts (content/text/message/clean_content), or either of
    those wrapped in a dict under 'messages'/'data'. Mirrors the defensive
    shape-handling `buzz_universe._syms_from` already uses for universe
    files -- a corpus we cannot parse must never look like an empty corpus
    that measured zero collisions."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("messages") or payload.get("data") or []
    out: list[str] = []
    for item in payload or []:
        if isinstance(item, str):
            if item:
                out.append(item)
        elif isinstance(item, dict):
            text = (
                item.get("content") or item.get("text")
                or item.get("message") or item.get("clean_content") or ""
            )
            text = str(text).strip()
            if text:
                out.append(text)
    return out


def _count_tokens(texts: list[str]) -> dict[str, tuple[int, int]]:
    """One pass over the corpus. Returns {UPPER_FORM: (as_word, as_ticker)}
    for every alpha token 2-6 chars long, regardless of universe membership
    -- filtering to real symbols happens in `derive()` so this stays a pure
    tokenizer, testable on its own."""
    counts: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    for text in texts:
        for m in _TOKEN.finditer(text):
            raw = m.group(0)
            if not (2 <= len(raw) <= 6):
                continue
            upper = raw.upper()
            if raw == upper:
                counts[upper][1] += 1      # written exactly uppercase -> ticker-shaped use
            else:
                counts[upper][0] += 1      # any other casing -> word-shaped use
    return {k: (v[0], v[1]) for k, v in counts.items()}


def derive(
    texts: list[str],
    universe: set[str],
    *,
    min_seen: int = MIN_SEEN,
    max_upper_pct: float = MAX_UPPER_PCT,
) -> dict[str, dict]:
    """The measurement itself: universe INTERSECT casing-skewed corpus tokens.
    A token not in the universe can never appear here -- same "derive by
    intersection, never by typing" contract as `buzz_universe.ambiguous()`."""
    counts = _count_tokens(texts)
    tokens: dict[str, dict] = {}
    for sym, (as_word, as_ticker) in counts.items():
        if sym not in universe:
            continue
        total = as_word + as_ticker
        if total < min_seen:
            continue
        upper_pct = round(as_ticker / total * 100, 1)
        if upper_pct >= max_upper_pct:
            continue
        tokens[sym] = {"as_word": as_word, "as_ticker": as_ticker, "upper_pct": upper_pct}
    # Largest word-collision first, matching the committed file's ordering --
    # the entries a reviewer most needs to eyeball sort to the top.
    return dict(sorted(tokens.items(), key=lambda kv: kv[1]["as_word"], reverse=True))


def _measure_effect(texts: list[str], tokens: dict[str, dict]) -> dict:
    """Before/after tier counts, run through the REAL extractor (not a
    reimplementation of its tier logic -- that would be a second hand-written
    copy of the same grammar, exactly the class of bug this repo's own
    lessons warn about). 'Before' = HOUSE_VOCAB only, no derived word gate;
    'after' = HOUSE_VOCAB plus this run's derived tokens. The swap is done by
    replacing `buzz_universe.ambiguous` for the duration of the measurement
    and restoring it before returning, win or lose."""
    from api.services import buzz_extract, buzz_universe as uni

    before_ambiguous = frozenset(uni.HOUSE_VOCAB & uni.symbols())
    after_ambiguous = frozenset((set(tokens) | uni.HOUSE_VOCAB) & uni.symbols())

    orig_ambiguous = uni.ambiguous

    def _tier_counts(ambiguous_set: frozenset) -> collections.Counter:
        uni.ambiguous = lambda: ambiguous_set
        try:
            tiers: collections.Counter = collections.Counter()
            for text in texts:
                for _, tier in buzz_extract.extract(text):
                    tiers[tier] += 1
            return tiers
        finally:
            uni.ambiguous = orig_ambiguous

    before = _tier_counts(before_ambiguous)
    after = _tier_counts(after_ambiguous)

    contextual_before, contextual_after = before.get("contextual", 0), after.get("contextual", 0)
    exact_before, exact_after = before.get("exact", 0), after.get("exact", 0)
    cashtag_before, cashtag_after = before.get("cashtag", 0), after.get("cashtag", 0)
    total_before = sum(before.values())
    removed = (contextual_before - contextual_after) + (exact_before - exact_after)
    return {
        "_comment": (
            "Baseline is NO COLLISION GATE AT ALL (chat_words empty, "
            "HOUSE_VOCAB only) -- the total value of gating, not the "
            "marginal gain over whatever list was previously shipped. A "
            "figure quoted elsewhere as the improvement over a prior "
            "hand-typed or previously-committed list is answering a "
            "DIFFERENT question and will not match these numbers."
        ),
        "contextual_tier_mentions_before": contextual_before,
        "contextual_tier_mentions_after": contextual_after,
        "cashtag_tier_before_after": [cashtag_before, cashtag_after],
        "exact_tier_before_after": [exact_before, exact_after],
        "removed_vs_no_gate": removed,
        "share_of_all_bookings_removed_pct_vs_no_gate": (
            round(removed / total_before * 100, 1) if total_before else 0.0
        ),
    }


def _atomic_write_json(path: pathlib.Path, payload: dict) -> None:
    """encode -> tmp -> os.replace, never a bare open('w') -- a truncated
    write must never leave a half-written collision file on disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=DEFAULT_CORPUS)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--min-seen", type=int, default=MIN_SEEN)
    ap.add_argument("--max-upper-pct", type=float, default=MAX_UPPER_PCT)
    args = ap.parse_args()

    corpus_path = pathlib.Path(args.corpus)
    if not corpus_path.exists():
        print(f"corpus not found: {corpus_path}")
        return 2

    from api.services import buzz_universe as uni

    texts = _load_corpus_texts(corpus_path)
    if not texts:
        print(f"corpus at {corpus_path} yielded zero messages -- refusing to write an empty result")
        return 2

    universe = set(uni.symbols())
    tokens = derive(texts, universe, min_seen=args.min_seen, max_upper_pct=args.max_upper_pct)
    measured_effect = _measure_effect(texts, tokens)

    payload = {
        "_comment": (
            "DERIVED, never hand-typed. A token that is a real ticker AND an "
            "ordinary word appears in chat mostly in lowercase ('big spot to "
            "breakout'); a token used as a ticker appears mostly uppercase. "
            "Regenerate with tools/buzz_derive_collisions.py after any corpus "
            "refresh. Do not edit by hand -- add house ACRONYMS (AI, RS, EMA, "
            "PEG...) to HOUSE_VOCAB instead, since those are uppercase by "
            "convention and casing cannot separate them."
        ),
        "derived_from": {
            "corpus": args.corpus,
            "messages": len(texts),
            "chars": sum(len(t) for t in texts),
            "measured": datetime.date.today().isoformat(),
            "min_seen": args.min_seen,
            "max_upper_share": args.max_upper_pct / 100.0,
        },
        "measured_effect": measured_effect,
        "tokens": tokens,
    }

    out_path = pathlib.Path(args.out)
    _atomic_write_json(out_path, payload)

    print(f"corpus: {len(texts)} messages, {payload['derived_from']['chars']} chars")
    print(f"derived {len(tokens)} word-collision token(s) -> {out_path}")
    print(f"measured effect: {json.dumps(measured_effect, indent=1)}")
    print("Re-run tests/test_buzz_universe.py + tests/test_buzz_extract.py before committing.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
