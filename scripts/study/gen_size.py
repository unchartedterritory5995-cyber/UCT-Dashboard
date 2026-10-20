"""gen_size — sizing items from the house rule (docs/study/sizing_rule.md,
spec §4.11, §6.3 gen_size, §8.5, §13.3 C11): forward, reverse,
ceiling-capped, skip, flat-risk vs quality-scaled, and drawdown-ladder cases.

Every answer is computed by `study_scoring.size_from_stop` (the same
function that scores the member) plus the caps in sizing_rule.md §4; the
reveal carries the arithmetic as facts and the lesson writes only those
numbers. Inputs are drawn from a seeded RNG so the segment is identical on
every run (deterministic ids).

Every size item carries an entry AND a stop (§8.5), and no key ever risks
more than the 2% ceiling.

Owner rulings 2026-10-19 (docs/study/corrections/size.house_rule.jsonl):
  * a stop wider than 10% keeps the math, but the lesson says the desk would
    never use a stop that wide (WIDE_STOP_PCT);
  * a formula position past 20% of the account keeps the formula answer and
    the lesson adds the trim-to-20-25% account-management note (DESK_MAX_PCT);
  * "we would benefit from some quick math on tighter stops": a second forward
    batch with stops between 1.5% and 6% plus a few at 8% (STOP_PCTS_TIGHT),
    ADDED on its own RNG stream so every existing item keeps its id;
  * "1 shares" is never written: shares_word().
"""
from __future__ import annotations

import math
import pathlib
import random
import sys
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from api.services.study_scoring import RISK_CEILING_PCT, size_from_stop  # noqa: E402
from scripts.study._common import make_item, shuffled_choices, write_segment  # noqa: E402

SOURCE = "docs/study/sizing_rule.md"
SEED = 20261017

#: sizing_rule.md §4: the app's cap table (houseSizing.json), band × grade → max position %.
CAP_TABLE = {
    "GREEN": {"A+": 25, "A": 20, "B": 10},
    "YELLOW": {"A+": 15, "A": 12, "B": 6},
    "ORANGE": {"A+": 8, "A": 5, "B": 0},
    "RED": {"A+": 0, "A": 0, "B": 0},
}
#: sizing_rule.md §4: the owner's drawdown ladder (owner to confirm, §8 #1).
DRAWDOWN_LADDER = ((10.0, 5), (8.0, 8), (6.0, 10), (0.0, 20))   # (drawdown ≥ x% → max position %)
LADDER_QUOTE = ("I lowered my max sizing to 5% down from 10% which is down from 20%. After a 6% drawdown I "
                "immediately reduce to 10% max. After an 8% drawdown I reduce to 8% max. And after 10% "
                "drawdown I reduce to 5% max.")
ACCOUNTS = (5000, 8000, 10000, 25000, 50000, 75000, 100000, 250000)
RISKS = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0)
STOP_PCTS = (2, 3, 4, 5, 6, 8, 10, 12, 15)
#: the tight batch (owner 2026-10-19): LOD / prior-LOD widths, a few at 8%
STOP_PCTS_TIGHT = (1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8)
TIGHT_SEED = SEED + 1          # its own stream: the original items keep their ids
WIDE_STOP_PCT = 10             # wider than this: "the desk would never use a stop that wide"
DESK_MAX_PCT = 20              # a formula position past this gets the trim note
TRIM_TO_PCT = (20, 25)


def fmt(v) -> str:
    """A number exactly as the facts hold it (so grounding sees one token)."""
    d = Decimal(str(v))
    return format(d.normalize(), "f")


def money(v) -> str:
    return f"${fmt(v)}"


def shares_word(n) -> str:
    """'1 share', '66 shares' (owner: never '1 shares')."""
    return f"{fmt(n)} share" if float(n) == 1 else f"{fmt(n)} shares"


def forward_lesson(f: dict) -> str:
    """The forward lesson under the three 2026-10-19 rulings. Every number it
    writes is in `f` (the grounding check reads the facts)."""
    stop_part = f"The stop is {fmt(f['stop_pct'])}% away"
    if f["stop_pct"] > WIDE_STOP_PCT:
        stop_part += ", far wider than the desk would ever use, but the math is the same"
    text = (f"Stop first. {stop_part}. Risk {money(f['risk_dollars'])} divided by "
            f"{money(f['per_share'])} a share is {shares_word(f['shares'])}, {money(f['dollars'])} in the stock, "
            f"{fmt(f['position_pct'])}% of the account.")
    if f["position_pct"] > DESK_MAX_PCT:
        text += (f" That is past the desk's {fmt(DESK_MAX_PCT)}% max. You can take the trade this size on the "
                 f"entry, but trim it down toward {fmt(TRIM_TO_PCT[0])}-{fmt(TRIM_TO_PCT[1])}% of the account "
                 f"quickly as it moves, so one name never owns the book.")
    return text


def ladder_max(drawdown_pct: float) -> tuple[float, int]:
    for threshold, cap in DRAWDOWN_LADDER:
        if drawdown_pct >= threshold:
            return threshold, cap
    return 0.0, 20


def _price(rng: random.Random) -> float:
    return round(rng.uniform(5, 400), 2)


def _stop_for(entry: float, stop_pct: float) -> float:
    return round(entry * (1 - stop_pct / 100.0), 2)


def _facts(account, risk_pct, entry, stop) -> dict:
    res = size_from_stop(account, risk_pct, entry, stop)
    per_share = round(entry - stop, 2)
    stop_pct = round((entry - stop) / entry * 100, 2)
    f = {"account": account, "risk_pct": risk_pct, "entry": entry, "stop": stop,
         "risk_dollars": res["risk_dollars"], "per_share": per_share, "stop_pct": stop_pct,
         "shares": res["shares"], "dollars": res["dollars"], "skip": res["skip"]}
    if not res["skip"]:
        f["position_pct"] = round(res["dollars"] / account * 100, 1)
        f["formula_pct"] = round(risk_pct / stop_pct * 100, 1)
        f["desk_max_pct"] = DESK_MAX_PCT
        f["trim_to_pct"] = list(TRIM_TO_PCT)
        f["wide_stop"] = stop_pct > WIDE_STOP_PCT
    return f


def _q(account, risk_pct, entry, stop, lead="") -> str:
    return (f"{lead}Account {money(account)}. Risk {fmt(risk_pct)}%. Entry {money(entry)}. "
            f"Stop {money(stop)}. How many shares?").strip()


def forward_items(rng: random.Random, n: int = 20, *, stop_pcts: tuple = STOP_PCTS, tag: str = "forward") -> list[dict]:
    out = []
    i = 0
    while len(out) < n:
        i += 1
        account = rng.choice(ACCOUNTS)
        risk = rng.choice(RISKS)
        entry = _price(rng)
        stop = _stop_for(entry, rng.choice(stop_pcts))
        f = _facts(account, risk, entry, stop)
        if f["skip"]:
            continue
        ref = f"{SOURCE}#3-{tag}-{i}"
        lesson = forward_lesson(f)
        out.append(make_item(
            type="size", skill_id="size.formula", module="M5", q=_q(account, risk, entry, stop),
            answer=None, answer_json={"shares": f["shares"], "dollars": f["dollars"]},
            prompt_extra={"account": account, "risk_pct": risk, "entry": entry, "stop": stop, "format": "size"},
            reveal={"facts": f, "rule": "Position % = risk % / stop distance %; shares round down", "source": SOURCE},
            source_kind="toolkit", source_ref=ref, difficulty=2, lesson_text=lesson, lesson_origin="template"))
    return out


def tight_forward_items(n: int = 16) -> list[dict]:
    """The owner's tighter-stop batch, on its own RNG stream (ADDED, never a
    reshuffle: the original forward items keep their ids and his verdicts)."""
    return forward_items(random.Random(TIGHT_SEED), n, stop_pcts=STOP_PCTS_TIGHT, tag="forward-tight")


def reverse_items(rng: random.Random, n: int = 12) -> list[dict]:
    out = []
    pairs = [(s, p) for s in (1, 2, 3, 4, 5, 8, 10) for p in (5, 10, 12.5, 15, 20, 25, 50)]
    for i, (stop_pct, position_pct) in enumerate(rng.sample(pairs, n), start=1):   # distinct pairs
        risk = round(position_pct * stop_pct / 100, 2)
        if risk > RISK_CEILING_PCT * 2:
            risk = round(risk, 2)
        f = {"stop_pct": stop_pct, "position_pct": position_pct, "risk_pct": risk,
             "over_ceiling": risk > RISK_CEILING_PCT, "ceiling_pct": RISK_CEILING_PCT}
        ref = f"{SOURCE}#3-reverse-{i}"
        key = f"{fmt(risk)}%"
        wrong = {f"{fmt(round(risk * 2, 2))}%", f"{fmt(round(risk / 2, 2))}%", f"{fmt(round(risk + 0.5, 2))}%",
                 f"{fmt(stop_pct)}%", f"{fmt(position_pct)}%"} - {key}
        choices = shuffled_choices(key, sorted(wrong)[:3], ref)
        lesson = (f"Risk is size times stop distance. {fmt(position_pct)}% of the account with a {fmt(stop_pct)}% "
                  f"stop is {fmt(risk)}% at risk.")
        if f["over_ceiling"]:
            lesson += f" That is over the {fmt(RISK_CEILING_PCT)}% ceiling. Size down or skip."
        out.append(make_item(
            type="recall", skill_id="size.formula", module="M5",
            q=f"A {fmt(stop_pct)}% stop at a {fmt(position_pct)}% position. What is the account risk?",
            answer=key, choices=choices, reveal={"facts": f, "source": SOURCE},
            source_kind="toolkit", source_ref=ref, difficulty=2, lesson_text=lesson, lesson_origin="template"))
    return out


def capped_items(rng: random.Random, n: int = 10) -> list[dict]:
    out = []
    i = 0
    while len(out) < n:
        i += 1
        band = rng.choice(("GREEN", "YELLOW", "ORANGE"))
        grade = rng.choice(("A+", "A", "B"))
        cap = CAP_TABLE[band][grade]
        account = rng.choice(ACCOUNTS)
        risk = rng.choice((1.0, 1.5, 2.0))
        entry = _price(rng)
        stop = _stop_for(entry, rng.choice((2, 3, 4)))        # tight stops make the formula exceed the cap
        f = _facts(account, risk, entry, stop)
        if f["skip"] or f["formula_pct"] <= cap:
            continue
        ref = f"{SOURCE}#4-cap-{i}"
        f.update({"band": band, "grade": grade, "cap_pct": cap})
        q = (f"{band}, {grade} setup. Account {money(account)}. Risk {fmt(risk)}%. Entry {money(entry)}. "
             f"Stop {money(stop)}. Check the cap. How many shares?")
        if cap == 0:
            f["capped_shares"] = 0
            lesson = (f"The formula says {fmt(f['formula_pct'])}%. The cap for {band} {grade} is {fmt(cap)}%. "
                      f"No B setups in {band}. Skip it.")
            key = {"skip": True}
        else:
            capped_shares = math.floor(cap / 100 * account / entry)
            capped_dollars = round(capped_shares * entry, 2)
            f.update({"capped_shares": capped_shares, "capped_dollars": capped_dollars,
                      "capped_risk_pct": round(capped_shares * f["per_share"] / account * 100, 2)})
            lesson = (f"The formula says {fmt(f['formula_pct'])}%. The cap for {band} {grade} is {fmt(cap)}%. "
                      f"Cap it: {shares_word(capped_shares)}, {money(capped_dollars)}. "
                      f"A tight stop never licenses a monster position.")
            key = {"shares": capped_shares, "dollars": capped_dollars}
        out.append(make_item(
            type="size", skill_id="size.cap_table", module="M13", q=q, answer=None, answer_json=key,
            prompt_extra={"account": account, "risk_pct": risk, "entry": entry, "stop": stop,
                          "band": band, "grade": grade, "format": "size"},
            reveal={"facts": f, "cap_table": CAP_TABLE, "source": SOURCE + "#4"},
            source_kind="toolkit", source_ref=ref, difficulty=3, lesson_text=lesson, lesson_origin="template"))
    return out


def skip_items(rng: random.Random, n: int = 6) -> list[dict]:
    out = []
    i = 0
    while len(out) < n:
        i += 1
        account = rng.choice((5000, 8000, 10000))
        risk = rng.choice((0.25, 0.5))
        entry = round(rng.uniform(150, 400), 2)
        stop = _stop_for(entry, rng.choice((10, 12, 15)))
        f = _facts(account, risk, entry, stop)
        if not f["skip"]:
            continue
        ref = f"{SOURCE}#2-skip-{i}"
        lesson = (f"The honest stop is {fmt(f['stop_pct'])}% away. {money(f['risk_dollars'])} of risk buys "
                  f"{shares_word(f['shares'])}. Skip it. Never tighten the stop to make it fit.")
        out.append(make_item(
            type="size", skill_id="size.gate", module="M5",
            q=_q(account, risk, entry, stop, lead="The stop under the base is honest. "),
            answer=None, answer_json={"skip": True},
            prompt_extra={"account": account, "risk_pct": risk, "entry": entry, "stop": stop,
                          "format": "size", "skip_allowed": True},
            reveal={"facts": f, "rule": "If the honest stop does not fit the risk budget: skip, never tighten.",
                    "source": SOURCE + "#2"},
            source_kind="toolkit", source_ref=ref, difficulty=3, lesson_text=lesson, lesson_origin="template"))
    return out


def flat_vs_scaled_items(rng: random.Random, n_pairs: int = 4) -> list[dict]:
    out = []
    i = 0
    while len(out) < n_pairs * 2:
        i += 1
        account = rng.choice(ACCOUNTS)
        entry = _price(rng)
        stop = _stop_for(entry, rng.choice((4, 5, 6, 8)))
        grade = rng.choice(("A+", "B"))
        scaled_risk = 1.5 if grade == "A+" else 0.5
        flat = _facts(account, 1.0, entry, stop)
        scaled = _facts(account, scaled_risk, entry, stop)
        if flat["skip"] or scaled["skip"]:
            continue
        for mode, f, risk in (("flat", flat, 1.0), ("scaled", scaled, scaled_risk)):
            ref = f"{SOURCE}#1-{mode}-{i}"
            if mode == "flat":
                lead = "Flat risk, the same percent every trade. "
                lesson = (f"Flat risk: {fmt(risk)}% on every trade, whatever the grade. "
                          f"{money(f['risk_dollars'])} divided by {money(f['per_share'])} is {shares_word(f['shares'])}.")
            else:
                lead = f"Quality-scaled, {grade} setup. "
                lesson = (f"Quality-scaled: a {grade} setup gets {fmt(risk)}%. "
                          f"{money(f['risk_dollars'])} divided by {money(f['per_share'])} is {shares_word(f['shares'])}. "
                          f"Both ways are taught. Pick one and write it in the plan.")
            f = dict(f, mode=mode, grade=grade)
            out.append(make_item(
                type="size", skill_id="size.gate", module="M5", q=_q(account, risk, entry, stop, lead=lead),
                answer=None, answer_json={"shares": f["shares"], "dollars": f["dollars"]},
                prompt_extra={"account": account, "risk_pct": risk, "entry": entry, "stop": stop,
                              "mode": mode, "grade": grade, "format": "size"},
                reveal={"facts": f, "source": SOURCE + "#1"},
                source_kind="toolkit", source_ref=ref, difficulty=3, lesson_text=lesson, lesson_origin="template"))
    return out


def drawdown_items(rng: random.Random, n: int = 8) -> list[dict]:
    out = []
    for i, dd in enumerate(rng.sample((2, 3, 5, 6, 7, 8, 9, 10, 12, 15), n), start=1):   # distinct drawdowns
        threshold, cap = ladder_max(dd)
        f = {"drawdown_pct": dd, "threshold_pct": threshold, "max_pct": cap,
             "ladder": [{"after_drawdown_pct": t, "max_pct": c} for t, c in DRAWDOWN_LADDER]}
        ref = f"{SOURCE}#4-ladder-{i}"
        key = f"{fmt(cap)}%"
        choices = shuffled_choices(key, [c for c in ("20%", "10%", "8%", "5%") if c != key], ref)
        if threshold > 0:
            lesson = (f"After a {fmt(threshold)}% drawdown the max is {fmt(cap)}%. You are {fmt(dd)}% down, "
                      f"so {fmt(cap)}% is the ceiling. Those who control their drawdown best are best.")
        else:
            lesson = (f"You are {fmt(dd)}% down, inside the normal band. The max stays {fmt(cap)}%. "
                      f"The ladder starts at a {fmt(DRAWDOWN_LADDER[2][0])}% drawdown.")
        out.append(make_item(
            type="recall", skill_id="size.drawdown", module="M13",
            q=f"You are {fmt(dd)}% off your peak. What is your max position size under the firm's drawdown protocol?",
            answer=key, choices=choices,
            reveal={"facts": f, "quote": LADDER_QUOTE, "quote_date": "2026-07-19",
                    "owner_confirm_pending": True, "source": SOURCE + "#4"},
            source_kind="toolkit", source_ref=ref, difficulty=2, lesson_text=lesson, lesson_origin="template"))
    return out


def ladder_size_items(rng: random.Random, n: int = 4) -> list[dict]:
    """The drawdown ladder combined with the cap table and the formula."""
    out = []
    i = 0
    while len(out) < n:
        i += 1
        dd = rng.choice((6, 7, 8, 9, 10, 12))
        threshold, ladder_cap = ladder_max(dd)
        band, grade = "GREEN", "A+"
        cap = min(CAP_TABLE[band][grade], ladder_cap)
        account = rng.choice(ACCOUNTS)
        risk = rng.choice((1.0, 1.5))
        entry = _price(rng)
        stop = _stop_for(entry, rng.choice((2, 3)))
        f = _facts(account, risk, entry, stop)
        if f["skip"] or f["formula_pct"] <= cap:
            continue
        ref = f"{SOURCE}#4-ladder-size-{i}"
        capped_shares = math.floor(cap / 100 * account / entry)
        capped_dollars = round(capped_shares * entry, 2)
        f.update({"drawdown_pct": dd, "threshold_pct": threshold, "ladder_max_pct": ladder_cap, "band": band,
                  "grade": grade, "table_cap_pct": CAP_TABLE[band][grade], "cap_pct": cap,
                  "capped_shares": capped_shares, "capped_dollars": capped_dollars})
        q = (f"You are {fmt(dd)}% off your peak. {band}, {grade} setup. Account {money(account)}. Risk {fmt(risk)}%. "
             f"Entry {money(entry)}. Stop {money(stop)}. How many shares?")
        lesson = (f"The formula says {fmt(f['formula_pct'])}%. {fmt(dd)}% down puts the ladder max at "
                  f"{fmt(ladder_cap)}%. Cap it: {shares_word(capped_shares)}, {money(capped_dollars)}.")
        out.append(make_item(
            type="size", skill_id="size.drawdown", module="M13", q=q, answer=None,
            answer_json={"shares": capped_shares, "dollars": capped_dollars},
            prompt_extra={"account": account, "risk_pct": risk, "entry": entry, "stop": stop,
                          "drawdown_pct": dd, "band": band, "grade": grade, "format": "size"},
            reveal={"facts": f, "quote": LADDER_QUOTE, "owner_confirm_pending": True, "source": SOURCE + "#4"},
            source_kind="toolkit", source_ref=ref, difficulty=4, lesson_text=lesson, lesson_origin="template"))
    return out


def generate() -> dict[str, list[dict]]:
    rng = random.Random(SEED)
    items = (forward_items(rng) + reverse_items(rng) + capped_items(rng) + skip_items(rng)
             + flat_vs_scaled_items(rng) + drawdown_items(rng) + ladder_size_items(rng)
             + tight_forward_items())          # appended last: the owner's tight-stop batch
    for it in items:
        if it["type"] == "size":
            assert it["prompt_json"].get("entry") and it["prompt_json"].get("stop"), it["id"]     # §8.5
            assert float(it["prompt_json"]["risk_pct"]) <= RISK_CEILING_PCT, it["id"]
    return {"size.house_rule": items}


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
