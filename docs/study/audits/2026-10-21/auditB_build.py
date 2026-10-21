"""auditB_build: write auditB_verdicts.jsonl for regime.bottoms + size.house_rule.

Read-only on the repo. Every proposed lesson is generated from the item's own
facts and checked: every number must appear in answer_json / reveal_json.facts,
sentences <= 22 words, no em-dash, no banned phrase.
"""
import datetime as dt
import json
import math
import re
import sys
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_FLOOR

REPO = r"C:\Users\pgosz\uct-worktrees\study-import"
OUT = r"C:\Users\pgosz\AppData\Local\Temp\claude\C--Users-pgosz\e53aca68-7b0c-4e23-87db-a74a97087865\scratchpad"
D = Decimal

# ───────────────────────── helpers ─────────────────────────


def fmt(v):
    return format(D(str(v)).normalize(), "f")


def money(v):
    return "$" + fmt(v)


def sw(n):
    return f"{fmt(n)} share" if float(n) == 1 else f"{fmt(n)} shares"


def art(word):
    return "an" if word[:1] in "AEIOU8" or word.startswith("A+") else "a"


def nums_in(obj, acc):
    if isinstance(obj, bool):
        return acc
    if isinstance(obj, (int, float)):
        acc.add(D(str(obj)).normalize())
    elif isinstance(obj, dict):
        for v in obj.values():
            nums_in(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            nums_in(v, acc)
    return acc


BANNED = ["may potentially", "it's important to", "in order to", "leverage", "utilize", "journey", "robust",
          "seamless", "dive in", "dive into", "great job", "let's explore", "in this scenario", "as a trader, you",
          "it is worth noting", "key takeaway", "comprehensive", "crucial", "essential component", "framework",
          "traders should", "successful traders", " tape", "regime", " dial"]


def check_text(text, facts_nums, *, is_q=False):
    probs = []
    if "\u2014" in text:
        probs.append("em-dash")
    low = text.lower()
    for b in BANNED:
        if b in low:
            probs.append(f"banned:{b.strip()}")
    for s in re.split(r"(?<=[.!?])\s+", text.strip()):
        n = len(s.split())
        if n > 22:
            probs.append(f"sentence {n} words: {s[:60]}")
    if not is_q:
        if "?" in text:
            probs.append("question mark in lesson")
        for tok in re.findall(r"\d+(?:\.\d+)?", text):
            if D(tok).normalize() not in facts_nums:
                probs.append(f"ungrounded number {tok}")
    if re.search(r"\ba [8AEIO]", text):
        probs.append("article a/an")
    return probs


# ───────────────────────── sizing ─────────────────────────

SIZE_BANK = REPO + r"\docs\study\bank\size.house_rule.json"

# verdict table: id -> (verdict, code, duplicate_of, reason, fix_kind)
# fix_kind: None | "lesson" (template by item kind) | "monster" | ("q", text)
V = {}


def sv(i, verdict, code, reason, fix=None, dup=None):
    V[i] = (verdict, code, dup, reason, fix)


# forward, original batch (drafts)
sv("si_50d28d98a52a", "keep", "ok", "Math checks. 15% stop; the lesson is the owner's own fix text (wide-stop caveat), already applied. Status is still draft only because his fix was recorded as proposed; confirm and approve.")
sv("si_7417247555f3", "keep", "ok", "Math checks. 37.3% position; the lesson is the owner's own fix text (past the 20% max, trim toward 20-25% quickly), already applied. Confirm and approve.")
sv("si_f01a3aa596c3", "keep", "ok", "Math checks. 8% stop, 6.2% position, no ruling note needed.")
sv("si_d629ce42cc44", "keep", "ok", "Math checks. Stop is exactly 10% (the ruling's note starts above 10%), 9.8% position. The one 10% example left in the forward pool.")
sv("si_9d6c5e3ec222", "keep", "ok", "Math checks. 3.99% stop, 18.8% position, under the 20% max.")
sv("si_d0c4fcd38430", "fix", "thin_lesson", "Math checks and the trim note is present, but the formula hands out 49.7% of the account. The lesson should also carry sizing_rule 2.5 (a tight stop never licenses a monster position; a stop can't catch a gap) so the obvious follow-up, why trim if the stop is tight, is answered.", "monster")
sv("si_b60168235fb2", "fix", "thin_lesson", "Math checks and the trim note is present, but the position is 49.9% of the account. Add the sizing_rule 2.5 gap line so the lesson answers why the trim matters.", "monster")
sv("si_b76345801661", "cut", "duplicate", "Math checks, but this is a 1% risk / 12% stop item, the same percentages as the approved si_c049b16f2ba8. The owner asked for only two or three wide-stop (12-15%) math examples; four are already owner-reviewed (si_9d442ebbc314, si_718773c087f6, si_c049b16f2ba8, si_50d28d98a52a).", dup="si_c049b16f2ba8")
sv("si_b0a7844cbd8b", "keep", "ok", "Math checks. 2% stop, 24.3% position with the trim note.")
sv("si_631b66603744", "keep", "ok", "Math checks. 8% stop, 12.3% position.")
sv("si_8f5d0d2b5033", "cut", "duplicate", "Math checks, but it is a fifth 12-15% wide-stop example; the owner's quota is two or three and four are already reviewed.", dup="si_718773c087f6")
sv("si_d90f379c5a7a", "cut", "degenerate", "Math checks but the answer is 2 shares ($164.80, 1.6% of the account) on a 12% stop: tiny account, expensive stock, the round-down decides the answer. Also over the wide-stop quota.")
sv("si_8a029aac484b", "cut", "degenerate", "Math checks but the answer is 1 share on a 15% stop ($25 of risk vs $23.05 a share). Degenerate and over the wide-stop quota.")
sv("si_72f548651a72", "cut", "degenerate", "Math checks but the answer is 2 shares on a 10% stop ($40 of risk vs $18.36 a share); the round-down decides it and only 92% of a tiny budget is used.")
# reverse
for _id in ("si_3d9de1002380", "si_e5cb7bdae19b", "si_c0c1d32a97e9", "si_428c79a8cdbd", "si_c7866e308482",
            "si_dfd4afd52613", "si_eaade686d4d7", "si_aec045f3436b", "si_5172ca2c6b30", "si_e19d8eaa82f2",
            "si_991374a12785"):
    sv(_id, "fix", "thin_lesson", "Key is right (position % x stop % / 100) and no distractor equals the key. The lesson is one line; it should say why risk is size times stop, that this is the formula run backwards, where it sits against the 2% ceiling, and that a gap can cost more.", "lesson")
sv("si_b7aa411baac5", "fix", "voice", "Key is right (20% x 8% = 1.6%). The question reads 'A 8% stop'. The lesson is also the one-line reverse template; use the reverse lesson template in the summary for it too.", ("q", "An 8% stop at a 20% position. What is the account risk?"))
# cap table
sv("si_ce71798c63a3", "cut", "duplicate", "Math checks (cap 25% of $8000 / $363.02 = 5 shares). Same cap and band/grade as si_6b9f0ef18b5a (GREEN A+, 2% risk, 3% stop); for a cap item the shares depend only on cap x account / entry, so the two are the same computation.", dup="si_6b9f0ef18b5a")
for _id in ("si_ee92b326f4c4", "si_0743466210e8", "si_6b9f0ef18b5a", "si_f3b9a4a34b48", "si_f21eb0e75209", "si_4eef9d28428f"):
    sv(_id, "fix", "thin_lesson", "Capped shares recompute exactly (floor(cap% x account / entry)). The lesson states the cap but never shows how the capped shares come out or that the risk then falls under budget (capped_risk_pct is in the facts). The question relies on the member knowing the app cap table (houseSizing.json); fine if M13 teaches it first, otherwise state the cap in the question.", "lesson")
sv("si_92516dd2a564", "cut", "degenerate", "Math checks but the capped answer is 1 share ($219.40, 2.7% of an $8000 account against a 5% cap): the round-down, not the cap, decides it. si_f3b9a4a34b48 covers ORANGE A cleanly.")
sv("si_b61887f73965", "fix", "thin_lesson", "Key (skip) is right: ORANGE B caps at 0%. Lesson is thin and the item relies on the app cap table; the rewrite says plainly why there is no size to take.", "lesson")
sv("si_6377af818f62", "cut", "duplicate", "Math checks (12% of $25000 / $82.67 = 36 shares). Same YELLOW A cap and same $25000 account as si_ee92b326f4c4, so the capped computation is identical in form.", dup="si_ee92b326f4c4")
# skip
sv("si_1008719b6385", "cut", "duplicate", "Key (skip) is right: $20 of risk vs $41.51 a share. One of six skip items built the same way (small account, tiny risk, expensive stock, 10-15% stop). Keep the three closest calls.", dup="si_244e3ca4d58b")
sv("si_244e3ca4d58b", "fix", "missing_wide_stop_note", "Key (skip) is right: $50 of risk vs $52.43 a share, 0.95 of a share, so rounding up would break the budget. The stop is 15%, so the owner's wide-stop ruling applies and the lesson lacks it.", "lesson")
sv("si_2252b03c12db", "cut", "duplicate", "Key (skip) is right: $12.50 of risk vs $37.06 a share. Same 0.25% risk / 10% stop as si_b2977d4b72c8, which is the closer call.", dup="si_b2977d4b72c8")
sv("si_131e40ba1384", "fix", "missing_wide_stop_note", "Key (skip) is right: $20 of risk vs $21.58 a share, 0.93 of a share. 12% stop, so the lesson needs the wide-stop caveat.", "lesson")
sv("si_fa714b679ff6", "cut", "duplicate", "Key (skip) is right: $25 vs $59.78 a share. Same 15% stop skip as si_244e3ca4d58b, which is the closer call.", dup="si_244e3ca4d58b")
sv("si_b2977d4b72c8", "fix", "thin_lesson", "Key (skip) is right: $20 of risk vs $25.60 a share. Stop rounds to 10.0% (10.002% raw), so the wide-stop note is not required. Lesson is one line; it should explain why rounding up or tightening the stop are both wrong.", "lesson")
# flat vs scaled
sv("si_55e936fe14d1", "fix", "thin_lesson", "Math checks (90 shares, $9307.80, 12.4%). Lesson gives the division only; it should show where $750 and $8.27 come from and what the flat/scaled choice is.", "lesson")
sv("si_523f7722aefb", "fix", "other", "Math checks (136 shares). The lesson says 'a A+ setup gets 1.5%', which states a grade-to-risk mapping that is not in sizing_rule.md (the rule gives a 0.25-2% range chosen by quality, performance and market). Rewrite says this plan puts 1.5% on it.", "lesson")
sv("si_8830e2ad942b", "fix", "thin_lesson", "Math checks (9 shares). Lesson is one line.", "lesson")
sv("si_7304a5f7bce3", "fix", "other", "Math checks (4 shares). Lesson asserts 'a B setup gets 0.5%', a mapping not in sizing_rule.md.", "lesson")
sv("si_6860961522ed", "cut", "duplicate", "Math checks (7 shares). Pair 3 (B setup, 8% stop, flat 1% vs scaled 0.5%) repeats pair 2 (si_8830e2ad942b / si_7304a5f7bce3) exactly in shape.", dup="si_8830e2ad942b")
sv("si_fdb6e773bfe3", "cut", "duplicate", "Math checks (3 shares). Second half of the repeated pair 3; 3 shares is also near-degenerate.", dup="si_7304a5f7bce3")
sv("si_c1ed9544faae", "fix", "thin_lesson", "Math checks (23 shares, 6% stop). Lesson is one line.", "lesson")
sv("si_57e2e6ac255b", "fix", "other", "Math checks (11 shares). Lesson asserts 'a B setup gets 0.5%', a mapping not in sizing_rule.md.", "lesson")
# drawdown recall
sv("si_e576f9b41325", "fix", "thin_lesson", "Key right (8% drawdown -> 8% max). Lesson says 'a 8%' and does not explain why the ladder cuts size. Ladder numbers are still flagged owner-to-confirm (sizing_rule 8 #1).", "lesson")
sv("si_3b8104a97b70", "cut", "duplicate", "Key right (3% -> 20%). Same 'inside the normal band' case as si_940371f91ca8, which (5%) is the closer call to the 6% step.", dup="si_940371f91ca8")
sv("si_8177461b7e7a", "fix", "thin_lesson", "Key right (10% -> 5%). Lesson thin. Ladder still owner-to-confirm.", "lesson")
sv("si_940371f91ca8", "fix", "thin_lesson", "Key right (5% -> 20%). Lesson thin. Ladder still owner-to-confirm.", "lesson")
sv("si_94273f4d761e", "fix", "thin_lesson", "Key right (7% -> 10%). Lesson thin. Ladder still owner-to-confirm.", "lesson")
sv("si_c0136c9593b7", "fix", "thin_lesson", "Key right (6% -> 10%, at the step). Lesson thin. Ladder still owner-to-confirm.", "lesson")
sv("si_7d94be79f077", "cut", "duplicate", "Key right (15% -> 5%). Same 'past the last step' case as si_955eb9512c0e.", dup="si_955eb9512c0e")
sv("si_955eb9512c0e", "fix", "thin_lesson", "Key right (12% -> 5%). Lesson thin. Ladder still owner-to-confirm.", "lesson")
# ladder + size
sv("si_470a13a70731", "fix", "thin_lesson", "Capped shares recompute exactly (10% of $25000 / $252.89 = 9). Lesson does not show how 9 shares come out or why the lowest cap wins.", "lesson")
sv("si_00503cd67d33", "fix", "thin_lesson", "Capped shares recompute exactly (8% of $5000 / $13.14 = 30). Lesson thin.", "lesson")
sv("si_2141fef66a3a", "fix", "thin_lesson", "Capped shares recompute exactly (5% of $75000 / $269.72 = 13). Lesson thin.", "lesson")
sv("si_5d9c8828170c", "cut", "duplicate", "Capped shares recompute exactly (10% of $100000 / $42.32 = 236). Same 1.5% risk / 2% stop / 10% ladder cap as si_470a13a70731.", dup="si_470a13a70731")
# forward, tight batch
sv("si_47fdf43a3b0d", "keep", "ok", "Math checks. 6% stop, 9.97 shares rounds down to 9 (good round-down test), 11.3% position.")
sv("si_f5eee0504e45", "keep", "ok", "Math checks. 3.5% stop, 3 shares using 92% of the budget, 13.2% position. Small but not degenerate.")
sv("si_303c63739664", "fix", "thin_lesson", "Math checks; trim note present; position is 59.7% of the account. Add the sizing_rule 2.5 gap line.", "monster")
sv("si_5fc8baf75dcb", "cut", "degenerate", "Math checks but the answer is 2 shares ($25 of risk vs $8.66 a share) on a $5000 account; a poor example of the tight-stop math the owner asked for.")
sv("si_c5d8b72698c1", "cut", "degenerate", "Math checks but the answer is 2 shares ($20 vs $7.13); same 0.25% / 3% shape as the approved si_a811f438b0f5, which teaches it with 23 shares.", dup="si_a811f438b0f5")
sv("si_aaa9600701b7", "fix", "thin_lesson", "Math checks; trim note present; position is 74.7% of the account. Add the sizing_rule 2.5 gap line.", "monster")
sv("si_64c7c21fadcb", "keep", "ok", "Math checks. 0.25% risk / 8% stop like the approved si_4f7a0c7a1af7, but with a real answer (23 shares) instead of 1 share; keep as the clean version.")
sv("si_05ea5ee88915", "cut", "degenerate", "Math checks but risk % equals stop % (2% and 2%), so the formula puts 99.7% of the account in one stock and the lesson tells the member 'you can take the trade this size'. Degenerate by construction.")
sv("si_7a707a85f1c3", "cut", "duplicate", "Math checks (5 shares). Same 1.5% risk / 4% stop as si_7417247555f3, which carries the owner's own trim text.", dup="si_7417247555f3")
sv("si_162bd1cdc4ba", "fix", "thin_lesson", "Math checks; trim note present; position is 50% of the account on a 1.5% stop. Add the sizing_rule 2.5 gap line.", "monster")
sv("si_4612795ed656", "cut", "duplicate", "Math checks (6 shares). 2% risk / 8% stop again: the owner reviewed exactly this shape (si_111811fac905) and asked for tighter stops instead.", dup="si_111811fac905")
sv("si_fee1babd47be", "cut", "duplicate", "Math checks (32 shares). Third 2% risk / 8% stop item; see si_111811fac905.", dup="si_111811fac905")
sv("si_06bdc596f418", "keep", "ok", "Math checks. 6% stop, 25.0% position with the trim note (note reads a little odd at exactly 25%, the top of the 20-25% band; owner accepted the same note at 23.8%).")
sv("si_4e16188de05d", "keep", "ok", "Math checks. 1.5% stop, 33% position with the trim note.")
sv("si_68f685772e22", "keep", "ok", "Math checks. 5% stop, 29.9% position with the trim note.")
sv("si_651fe72ed8d6", "keep", "ok", "Math checks. 4% stop, 4 shares using 92% of the $62.50 budget, 5.7% position.")

MONSTER = (" A tight stop never licenses a monster position. A stop can't catch an overnight gap. "
           "With {pos}% of the account in one name, a gap through the stop costs far more than the {r}% you planned. "
           "That's why the trim isn't optional.")


def size_kind(ref):
    tail = ref.split("#", 1)[1]
    for k in ("forward-tight", "forward", "reverse", "cap", "skip", "flat", "scaled", "ladder-size", "ladder"):
        if re.match(rf"^\d-{k}-\d+$", tail):
            return k
    raise ValueError(ref)


def size_lesson(it, kind):
    f = it["reveal_json"]["facts"]
    if kind == "reverse":
        s, p, r, c = fmt(f["stop_pct"]), fmt(f["position_pct"]), fmt(f["risk_pct"]), fmt(f["ceiling_pct"])
        t = (f"{r}% of the account is at risk. If the stop hits, the stock drops {s}% from your entry. "
             f"The position is {p}% of the account, so the account loses {s}% of {p}%, which is {r}%. "
             f"That's the sizing formula run backwards. Forward, position % is risk % divided by stop %. "
             f"Backwards, risk % is position % times stop %.")
        if f["over_ceiling"]:
            t += (f" {r}% is over the desk's {c}% ceiling per trade. Keep the stop where the chart puts it and make "
                  f"the position smaller, or skip the trade.")
        else:
            t += f" {r}% is inside the desk's {c}% ceiling per trade."
        t += f" One warning: a stop can't catch an overnight gap. If the stock opens below your stop, you lose more than {r}%."
        return t
    if kind == "cap":
        if f["cap_pct"] == 0:
            return (f"Skip it. The formula says {fmt(f['formula_pct'])}% of the account, but the firm's cap for "
                    f"{art(f['grade'])} {f['grade']} setup in {art(f['band'])} {f['band']} market is {fmt(f['cap_pct'])}%. "
                    f"No B setups in {f['band']}. When the cap is zero, the stop and the risk budget don't matter. "
                    f"There's no size to take. Wait for a better setup or a better market.")
        return (f"Cap it: {sw(f['capped_shares'])}, {money(f['capped_dollars'])}. The formula alone says "
                f"{fmt(f['formula_pct'])}% of the account, {fmt(f['risk_pct'])}% risk over a {fmt(f['stop_pct'])}% stop. "
                f"The firm's cap for {art(f['grade'])} {f['grade']} setup in {art(f['band'])} {f['band']} market is "
                f"{fmt(f['cap_pct'])}% of the account. When the formula and the cap disagree, the smaller number wins. "
                f"Take {fmt(f['cap_pct'])}% of the account, divide by the {money(f['entry'])} entry and round down: "
                f"{sw(f['capped_shares'])}. Your risk drops to {fmt(f['capped_risk_pct'])}% of the account, under the "
                f"{fmt(f['risk_pct'])}% you planned. That's fine. A tight stop never licenses a monster position, "
                f"because a stop can't catch an overnight gap.")
    if kind == "skip":
        wide = ", far wider than the desk would ever use" if f["stop_pct"] > 10 else ""
        return (f"Skip it. Your risk budget is {money(f['risk_dollars'])}, {fmt(f['risk_pct'])}% of {money(f['account'])}. "
                f"The stop is {fmt(f['stop_pct'])}% below the entry{wide}. That's {money(f['per_share'])} of risk on every share. "
                f"{money(f['risk_dollars'])} doesn't cover even one share, and rounding up would break the budget. "
                f"Don't tighten the stop to make it fit. The stop sits where the chart says the idea is wrong. "
                f"Pull it closer and you get stopped out on noise. Skip it and wait for a setup whose honest stop fits.")
    if kind == "flat":
        return (f"{sw(f['shares'])}. Flat risk means the same {fmt(f['risk_pct'])}% on every trade, whatever the grade. "
                f"{fmt(f['risk_pct'])}% of {money(f['account'])} is {money(f['risk_dollars'])}. The stop is "
                f"{money(f['per_share'])} a share below the entry, {fmt(f['stop_pct'])}% away. {money(f['risk_dollars'])} "
                f"divided by {money(f['per_share'])} is {sw(f['shares'])}, rounded down. That's {money(f['dollars'])} in "
                f"the stock, {fmt(f['position_pct'])}% of the account. The other way is quality-scaled: setup quality, "
                f"your recent trading and the market move the risk up or down. Both ways are taught. Pick one and write "
                f"it in your plan.")
    if kind == "scaled":
        g = f["grade"]
        side = "more than you'd put on an average idea" if g == "A+" else "less than you'd put on your best ideas"
        return (f"{sw(f['shares'])}. Quality-scaled means the risk moves with the setup, your recent trading and the "
                f"market. This plan puts {fmt(f['risk_pct'])}% on {art(g)} {g} setup, {side}. {fmt(f['risk_pct'])}% of "
                f"{money(f['account'])} is {money(f['risk_dollars'])}. The stop is {money(f['per_share'])} a share below "
                f"the entry, {fmt(f['stop_pct'])}% away. {money(f['risk_dollars'])} divided by {money(f['per_share'])} is "
                f"{sw(f['shares'])}, rounded down: {money(f['dollars'])} in the stock, {fmt(f['position_pct'])}% of the "
                f"account. The flat way uses the same percent on every trade. Both ways are taught. Pick one and write "
                f"it in your plan.")
    if kind == "ladder":
        dd, t, m = f["drawdown_pct"], f["threshold_pct"], f["max_pct"]
        lad = {int(x["after_drawdown_pct"]): x["max_pct"] for x in f["ladder"]}
        line = (f"The max position steps down as the drawdown grows: {fmt(lad[0])}% normally, {fmt(lad[6])}% after "
                f"a {6}% drawdown, {fmt(lad[8])}% after {8}%, {fmt(lad[10])}% after {10}%.")
        if t == 0:
            place = f"{fmt(dd)}% is short of the first step at {6}%, so the max stays {fmt(m)}%."
        elif dd == t:
            place = f"That's right at the {fmt(t)}% step, so the max drops to {fmt(m)}% now."
        elif t == 10:
            place = f"{fmt(dd)}% is past the last step at {fmt(t)}%, so the max is {fmt(m)}%."
        else:
            nxt = {6: 8, 8: 10}[int(t)]
            place = f"{fmt(dd)}% is past the {fmt(t)}% step but short of {nxt}%, so the max is {fmt(m)}%."
        return (f"Your max position is {fmt(m)}% of the account. You are {fmt(dd)}% off your peak. {line} {place} "
                f"The ladder cuts position size, not just the risk per trade. Smaller positions make every mistake "
                f"cheaper while you are off your game. As I put it: those who can control their drawdown best are best.")
    if kind == "ladder-size":
        g = f["grade"]
        return (f"Cap it: {sw(f['capped_shares'])}, {money(f['capped_dollars'])}. The formula alone says "
                f"{fmt(f['formula_pct'])}% of the account, {fmt(f['risk_pct'])}% risk over a {fmt(f['stop_pct'])}% stop. "
                f"{art(g).capitalize()} {g} setup in {art(f['band'])} {f['band']} market caps at {fmt(f['table_cap_pct'])}% "
                f"on the firm's table. But you are {fmt(f['drawdown_pct'])}% off your peak, and the drawdown ladder puts "
                f"the max at {fmt(f['ladder_max_pct'])}%. The lowest cap wins. Take {fmt(f['ladder_max_pct'])}% of the "
                f"account, divide by the {money(f['entry'])} entry and round down: {sw(f['capped_shares'])}. Your risk "
                f"ends up well under the {fmt(f['risk_pct'])}% you planned. That's the point of the ladder: while you "
                f"are in a drawdown, every mistake costs less.")
    raise ValueError(kind)


def size_checked(it, kind):
    p, a = it["prompt_json"], it["answer_json"]
    f = it.get("reveal_json", {}).get("facts", {})
    if it["type"] == "size":
        rd = D(str(p["account"])) * D(str(p["risk_pct"])) / 100
        ps = D(str(p["entry"])) - D(str(p["stop"]))
        raw = rd / ps
        sh = int(raw.to_integral_value(rounding=ROUND_FLOOR))
        sp = ps / D(str(p["entry"])) * 100
        s = (f"risk $ = {fmt(p['account'])} x {fmt(p['risk_pct'])}% = {fmt(rd)}; per share = {fmt(p['entry'])} - "
             f"{fmt(p['stop'])} = {fmt(ps)} ({sp:.2f}% stop); {fmt(rd)} / {fmt(ps)} = {raw:.3f} -> {sh} shares")
        if sh >= 1:
            dol = D(sh) * D(str(p["entry"]))
            s += f"; $ = {sh} x {fmt(p['entry'])} = {fmt(dol)} ({dol / D(str(p['account'])) * 100:.2f}% of account)"
        if kind in ("cap", "ladder-size"):
            cap = f["cap_pct"]
            if cap == 0:
                s += f"; cap {band_grade(p)} = 0% -> skip"
            else:
                cs = math.floor(D(cap) / 100 * D(str(p["account"])) / D(str(p["entry"])))
                cd = D(cs) * D(str(p["entry"]))
                s += (f"; formula {D(str(p['risk_pct'])) / sp * 100:.1f}% > cap {cap}% ({band_grade(p)}"
                      + (f", ladder at {fmt(p['drawdown_pct'])}% dd" if kind == "ladder-size" else "")
                      + f") -> floor({cap}% x {fmt(p['account'])} / {fmt(p['entry'])}) = {cs} shares, ${fmt(cd)}; "
                      f"capped risk {D(cs) * ps / D(str(p['account'])) * 100:.3f}%")
        elif sh < 1:
            s += " -> skip"
        s += f"; key {json.dumps(a, sort_keys=True)} MATCHES"
        return s
    if kind == "reverse":
        r = D(str(f["position_pct"])) * D(str(f["stop_pct"])) / 100
        others = [c for c in p["choices"] if c != a["answer"]]
        return (f"risk = {fmt(f['position_pct'])}% x {fmt(f['stop_pct'])}% / 100 = {fmt(r)}%; key {a['answer']} MATCHES; "
                f"distractors {others} all differ from the key")
    if kind == "ladder":
        return (f"ladder (>=10 -> 5, >=8 -> 8, >=6 -> 10, else 20) at {fmt(f['drawdown_pct'])}% -> "
                f"{fmt(f['max_pct'])}%; key {a['answer']} MATCHES; choices {p['choices']}")
    raise ValueError(kind)


def band_grade(p):
    return f"{p.get('band')} {p.get('grade')}"


# ───────────────────────── bottoms ─────────────────────────

BOT_BANK = REPO + r"\docs\study\bank\regime.bottoms.json"
CATALOG = REPO + r"\app\src\pages\modelbook\bottomsCatalog.js"


def _str(block, key):
    m = re.search(rf"\b{key}:\s*'((?:[^'\\]|\\.)*)'", block)
    return m.group(1).replace("\\'", "'") if m else None


def _num(block, key):
    m = re.search(rf"\b{key}:\s*(-?\d+(?:\.\d+)?)", block)
    return float(m.group(1)) if m else None


def parse_catalog():
    js = open(CATALOG, encoding="utf-8").read()
    m = re.search(r"export const BOTTOM_SIGNPOSTS = \[(.*?)\n\];?", js, re.S)
    names = {}
    for blk in re.findall(r"\{(.*?)\n  \}", m.group(1), re.S):
        names[_str(blk, "key")] = _str(blk, "name")
    m = re.search(r"export const BOTTOMS = \[(.*)\n\];?", js, re.S)
    out = {}
    for blk in re.split(r"\n  \},?\n  \{", m.group(1)):
        bid = _str(blk, "id")
        if not bid:
            continue
        sp = []
        sm = re.search(r"signposts:\s*\[(.*?)\]", blk, re.S)
        for i, s in enumerate(re.findall(r"\{(.*?)\}", sm.group(1), re.S)):
            sp.append({"i": i, "key": _str(s, "key"), "date": _str(s, "date"), "note": _str(s, "note")})
        out[bid] = {"name": _str(blk, "name"), "index": _str(blk, "index"), "chartSym": _str(blk, "chartSym"),
                    "peakDate": _str(blk, "peakDate"), "lowDate": _str(blk, "lowDate"),
                    "drawdownPct": _num(blk, "drawdownPct"), "signposts": sp,
                    "execution": _str(blk, "execution") or ""}
    return names, out


CHECK_WITH = {
    "capitulation": "index daily bars (% change, volume vs its average)",
    "volatility": "VIX daily history (VXO before 1990; no implied-vol index exists for 1974)",
    "breadth_washout": "breadth data (52-week new lows, % of members above the 200-day); not visible in index bars",
    "news_failure": "index daily bars (gap, undercut of the prior low, intraday reversal, close) plus the news record",
    "follow_through": "index daily bars (% gain, volume vs the prior session, session count from the low)",
    "leadership": "daily bars of the named leader stocks (breakout dates); not visible in index bars",
}

# auditor notes keyed (bottom id, signpost key) or (bottom id, "drawdown")
# Every note is a recollection or an internal inconsistency, NOT a correction.
NOTE = {
    ("2022-bear", "breadth_washout"): "Auditor recollection (verify): the 2022 low for % of S&P 500 members above the 200-day was in the low teens, not single digits.",
    ("2022-bear", "volatility"): "VIX closed higher earlier in 2022 than in October (auditor recollection); 'Volatility Peak' on 10-11 is arguable even if the mid-30s reading holds.",
    ("2022-bear", "follow_through"): "Auditor recollection (verify): counting from the 10-13 low, a qualifying follow-through day may have come in late October, weeks before the 11-10 CPI day.",
    ("2022-bear", "leadership"): "2023-01-15 is a SUNDAY and 2023-01-16 was a market holiday (MLK Day, the third Monday of January). Not a trading session: a fabrication tell.",
    ("2022-bear", "drawdown"): "Catalog low date 10-13 is the intraday-low session; auditor recalls the closing low was 10-12. Basis (close vs intraday) is unstated.",
    ("2020-covid", "news_failure"): "Internal: the catalog tags the low day itself as the News Failure, but its own definition is bad news that fails to make a new low; 03-23 made the new low. Auditor recollection (verify): the Fed's open-ended QE was announced the morning of 03-23, not 'the day before'.",
    ("2020-covid", "follow_through"): "Internal contradiction: the catalog's execution text says 'the follow-through fired six days off the low', but 03-26 is the 3rd session after the 03-23 low, and the framework says 'several days into the bounce'.",
    ("2018-christmas", "capitulation"): "'Record December volume' needs exchange volume, not SPY volume.",
    ("2018-christmas", "news_failure"): "Internal: a +5% rally day with no bad news recorded; the framework defines News Failure as bad news failing to make a new low. 'Largest Dow point gain' is a Dow claim in an S&P case.",
    ("2016-feb", "news_failure"): "Auditor recollection (verify): 02-11 closed down; the reversal session was 02-12.",
    ("2016-feb", "breadth_washout"): "Auditor recollection (verify): new lows were FEWER at the February retest than in January (a positive divergence), the opposite of 'peaked at the retest'.",
    ("2016-feb", "drawdown"): "Peak date 2015-05-20 is the intraday-high session; close-to-close may round to -14%. Basis unstated.",
    ("2011-summer", "drawdown"): "Key -19% sits beside a -20% distractor; intraday peak-to-trough is wider than close-to-close, so the basis decides which is right.",
    ("2009-gfc", "breadth_washout"): "Internal contradiction: the note says March had FEWER new lows than November, so by the framework's own definition (new lows peak) the breadth washout was November, not 03-09.",
    ("2009-gfc", "capitulation"): "By the catalog's own 2009 note, Breadth Washout also fired in November; as a distractor here it is defensible.",
    ("2002-dotcom", "capitulation"): "Case is the Nasdaq Composite but the item's chart is SPY. Auditor recollection (verify): the reversal session was 07-24, not 07-23.",
    ("2002-dotcom", "news_failure"): "Auditor recollection (verify): 10-09 closed at the low and the reversal came 10-10. Chart is SPY for a Nasdaq case.",
    ("2002-dotcom", "follow_through"): "'+4% thrust': the S&P and Nasdaq gains differed that day; which index? Chart is SPY for a Nasdaq case.",
    ("2002-dotcom", "leadership"): "2003-03-15 is a SATURDAY. Not a trading session: a fabrication tell.",
    ("1987-crash", "capitulation"): "Auditor recollection (verify): -22.6% is the Dow's Black Monday drop; the S&P 500 (this case's index) fell about 20.5%.",
    ("1987-crash", "volatility"): "VIX did not exist in 1987 (VXO back-calculated); 'never seen before or matched until 2008/2020' cannot be checked as written.",
    ("1987-crash", "news_failure"): "Internal contradiction: the catalog's low date (the drawdown low) is 1987-12-04, yet the note says the December retest 'held above the crash low'.",
    ("1974-secular", "volatility"): "No volatility index exists for 1974; 'realized volatility peaked' is undefined. Catalog LISTS capitulation before volatility; the key follows date order, so the member-facing timeline and the key may disagree.",
    ("1974-secular", "capitulation"): "Capitulation date equals the catalog low date; the catalog lists it first while the key (date order) makes it second.",
}

# bottoms verdict table: id -> (verdict, code, reason)
BV = {}
HOLD_Q = "{name}. The chart ends on the day one signpost fired. Which one?"
TRIVIA_SP = ("Trivia: the member can only answer by memorizing the catalog's curated order for this one bottom, and "
             "this signpost ({sp}) is not visible on an index price chart, so the item teaches no read.")
CHART_HOLD = ("Teachable only as a chart read: {sp} is visible on the index's own daily price and volume, and the item "
              "ships a chart cut at that date. As written ('which fired {ordw}?') it is memorization, so reword the "
              "question to a chart read (fix). Then the date and the note must be checked on real bars: if the last "
              "bar does not show the event, cut it. Lesson is the thin template ('Count the signposts, not the days'); "
              "replace it with the lesson for '{sp}' in the summary after the check.")


def bset(i, verdict, code, reason):
    BV[i] = (verdict, code, reason)


def build_bottoms():
    names, cat = parse_catalog()
    items = json.load(open(BOT_BANK, encoding="utf-8"))
    rows = []
    for it in items:
        r, p = it["reveal_json"], it["prompt_json"]
        subj = p.get("subject", "")
        bid = subj.split(" ")[0]
        b = cat[bid]
        claims = []
        ordw = None
        if "signpost" in subj:
            ordinal = r["ordinal"]
            ordw = ("first", "second", "third", "fourth", "fifth", "sixth")[ordinal - 1]
            date = r["date"]
            sp_rec = [s for s in b["signposts"] if s["date"] == date]
            key_s = sp_rec[0]
            # recompute the date-sorted order from the catalog file itself
            dates = sorted({s["date"] for s in b["signposts"]})
            cat_key_name = names[key_s["key"]]
            match = (dates.index(date) + 1 == ordinal and it["answer_json"]["answer"] == cat_key_name)
            co = [names[s["key"]] for s in sp_rec[1:]]
            acc = it["answer_json"].get("accept", [])
            match = match and sorted(co) == sorted(acc)
            listed = [names[s["key"]] for s in sorted(b["signposts"], key=lambda s: s["i"])]
            bydate = [names[s["key"]] for s in sorted(b["signposts"], key=lambda s: (s["date"], s["i"]))]
            wd = dt.date.fromisoformat(date).strftime("%a")
            checked = (f"bottomsCatalog.js BOTTOMS[{bid}].signposts[{key_s['i']}] = {{key:'{key_s['key']}', "
                       f"date:'{date}'}}; date order {[(s['date'], s['key']) for s in sorted(b['signposts'], key=lambda s: (s['date'], s['i']))]} "
                       f"puts it #{dates.index(date) + 1}; key '{it['answer_json']['answer']}'"
                       + (f", accept {acc}" if acc else "")
                       + (" MATCHES the catalog exactly" if match else " DOES NOT MATCH")
                       + ("" if listed == bydate else f"; NOTE catalog LISTS them as {listed}, the key follows date order"))
            claims.append({"claim": f"{cat_key_name} fired on {date} ({wd})", "check_with": CHECK_WITH[key_s["key"]],
                           "must_check_before_showing": True})
            claims.append({"claim": f"Catalog note: {key_s['note']}", "check_with": CHECK_WITH[key_s["key"]],
                           "must_check_before_showing": True})
            for s in sp_rec[1:]:
                claims.append({"claim": f"{names[s['key']]} also fired on {date}: {s['note']}",
                               "check_with": CHECK_WITH[s["key"]], "must_check_before_showing": True})
            claims.append({"claim": f"Order: of this bottom's recorded signposts, {cat_key_name} is #{ordinal} by date "
                                    f"({' > '.join(bydate)})",
                           "check_with": "all the other signpost dates in this case (the order is only as good as each date)",
                           "must_check_before_showing": True})
            if key_s["key"] in ("news_failure", "capitulation", "breadth_washout") and date == b["lowDate"]:
                claims.append({"claim": f"{b['index']} low of the decline was {b['lowDate']}",
                               "check_with": "index daily bars", "must_check_before_showing": True})
            note = NOTE.get((bid, key_s["key"]))
            if note:
                claims.append({"claim": "AUDITOR FLAG: " + note, "check_with": "see flag", "must_check_before_showing": True})
            sp_name = cat_key_name
        else:
            key = it["answer_json"]["answer"]
            match = key == f"{b['drawdownPct']:g}%"
            checked = (f"bottomsCatalog.js BOTTOMS[{bid}] drawdownPct {b['drawdownPct']:g}, peakDate {b['peakDate']}, "
                       f"lowDate {b['lowDate']}; key '{key}'" + (" MATCHES the catalog exactly" if match else " DOES NOT MATCH")
                       + f"; choices {p['choices']}")
            claims.append({"claim": f"{b['index']} peak on {b['peakDate']}", "check_with": "index daily bars",
                           "must_check_before_showing": True})
            claims.append({"claim": f"{b['index']} low on {b['lowDate']}", "check_with": "index daily bars",
                           "must_check_before_showing": True})
            claims.append({"claim": f"Peak-to-low fall of {b['drawdownPct']:g}% (basis, close or intraday, not stated)",
                           "check_with": "index daily bars", "must_check_before_showing": True})
            note = NOTE.get((bid, "drawdown"))
            if note:
                claims.append({"claim": "AUDITOR FLAG: " + note, "check_with": "see flag", "must_check_before_showing": True})
            sp_name = None
        verdict, code, reason = BV[it["id"]]
        reason = reason.format(sp=sp_name, ordw=ordw)
        fix = None
        if verdict == "hold":
            fix = {"field": "q", "after": HOLD_Q.format(name=b["name"])}
            if bid == "2002-dotcom":
                reason += " Chart symbol: the case is the Nasdaq Composite but bars.sym is SPY; QQQ has daily bars from 1999 and fits the case."
        rows.append({"item_id": it["id"], "segment": "regime.bottoms", "skill_id": it["skill_id"], "verdict": verdict,
                     "code": code, "reason": reason, "checked": checked, "claims": claims, "fix": fix,
                     "duplicate_of": None})
    return rows


# bottoms verdicts
H = CHART_HOLD
for _id in ("si_c2c8c906e852", "si_8824aded5eb6", "si_553b9a890157", "si_94495d8da54e", "si_e1c2559e50cb",
            "si_a37391a802da", "si_9d2e9f0dbbbf", "si_85520092d6ac", "si_e8febf0f81b0", "si_f57df1bb386c",
            "si_7f5d712143b3", "si_28c4e2396923", "si_07141dea361c", "si_2f527b374a59", "si_3b80b6bc1543",
            "si_24d4b19957f4", "si_2c5cf5fe2b7e"):
    bset(_id, "hold", "unverified_fact", H)
EXTRA = {
    "si_c2c8c906e852": " On a chart read, Capitulation and Volatility Peak are defensible for a gap-to-new-low reversal day; consider dropping one.",
    "si_8824aded5eb6": " Highest-risk date in this case: the classic follow-through count from 10-13 may land earlier than 11-10.",
    "si_553b9a890157": " On a chart read of a -9.5% day, Volatility Peak and Breadth Washout are both defensible distractors; swap them for News Failure and The Follow-Through Day.",
    "si_94495d8da54e": " The catalog contradicts itself on this date (execution text: 'six days off the low'; 03-26 is the 3rd session).",
    "si_e1c2559e50cb": " Choice set is clean for a chart read.",
    "si_9d2e9f0dbbbf": " Volatility Peak and Breadth Washout are defensible on a flush day; swap them out.",
    "si_85520092d6ac": " Auditor recalls 02-11 closed red; if the bar shows no reversal, the chart reads as Capitulation and the item must be cut.",
    "si_f57df1bb386c": " Breadth Washout is a defensible distractor on a -6.7% day.",
    "si_07141dea361c": " Breadth Washout is also true here by the catalog's own words (its 2009-03-09 note says November had more new lows); replace that distractor.",
    "si_3b80b6bc1543": " Breadth Washout is defensible on a flush day.",
    "si_24d4b19957f4": " If 10-09 closed at the low (auditor recollection), the bar reads as Capitulation and the item must be cut.",
}
for k, v in EXTRA.items():
    verdict, code, reason = BV[k]
    BV[k] = (verdict, code, reason + v)
for _id in ("si_2ee13fc208f1", "si_7f26d3ea3d74", "si_6ce02e088018", "si_de464060f58c", "si_32ab45ea72c1",
            "si_ff78e762b1f9", "si_adc7d4780c8a", "si_230eb19f8042", "si_ce815e25338a"):
    bset(_id, "cut", "trivia", TRIVIA_SP)
bset("si_f5caf9304056", "cut", "unverified_fact", "The key date 2023-01-15 is a Sunday (and Monday 2023-01-16 was MLK Day), so the signpost cannot have 'fired' that day; the catalog date is invented. Also trivia: leadership is not visible on an index chart.")
bset("si_a1d20dfdeb3f", "cut", "unverified_fact", "The key date 2003-03-15 is a Saturday, so the catalog date is invented. Also trivia: leadership is not visible on an index chart.")
bset("si_e5b4c30e2c31", "cut", "ambiguous", "The catalog labels the low day itself (03-23) a News Failure, but its own definition is bad news that fails to make a new low; on 03-23 price made the new low, so a member reading the chart would say Capitulation. Auditor also recalls the Fed's 'unlimited' QE came the morning of 03-23, not the day after, which would undo the note.")
bset("si_df56e767e22f", "cut", "ambiguous", "The record labels a +5% rally day with no recorded bad news (12-26) a News Failure; the framework's definition is bad news that fails to push price lower. The key is the catalog's label, not something a member can reason to, and it teaches a muddled definition.")
bset("si_93fd1ef89b1b", "cut", "ambiguous", "Contradicted by its own note: 'fewer new lows than November' means the new-lows crescendo (the framework's breadth washout) came in November 2008, not on 03-09. Also not visible on an index chart.")
bset("si_48e07bc89a04", "cut", "ambiguous", "Self-contradictory catalog: lowDate (the drawdown low) is 1987-12-04, yet this note says the 12-04 retest 'held above the crash low'. No chart either (pre-SPY), so it is pure memorization.")
for _id in ("si_87edcd93bfab", "si_e9557dfe8a82", "si_40b7b36c5867", "si_1ba062459c8b", "si_66a609b9e7e7",
            "si_7f662d199d05", "si_cd8f88b08fae"):
    bset(_id, "cut", "trivia", "Pre-1993 case: no SPY bars, so the item ships with no chart and can only be answered by memorizing the catalog's dates for one bottom. See the claims for the specific problems with this date.")
for _id in ("si_8a2c93d413b3", "si_2bbc4193c5fc", "si_96a3f53ddbef", "si_8f25c1a8e15c", "si_e0fdc026ee72",
            "si_c282cba75951", "si_928fd509b992", "si_b2185c256176"):
    bset(_id, "cut", "trivia", "Trivia: memorizing one historical drawdown number teaches no read or rule. The question also prints ISO dates and leaves the basis (close or intraday) unstated, and the lesson says 'fell -X%'.")
bset("si_38cd1c8524b8", "cut", "trivia", "Trivia, and the key -19% sits beside a -20% distractor that is defensible on an intraday basis (the basis is unstated).")


# ───────────────────────── run ─────────────────────────

def build_size():
    items = json.load(open(SIZE_BANK, encoding="utf-8"))
    rows, problems = [], []
    for it in items:
        if it.get("review_status") == "approved":
            continue
        kind = size_kind(it["source_ref"])
        verdict, code, dup, reason, fixk = V[it["id"]]
        f = it.get("reveal_json", {}).get("facts", {})
        facts_nums = nums_in(it["answer_json"], set()) | nums_in(f, set())
        fix = None
        if fixk == "lesson":
            after = size_lesson(it, kind)
            fix = {"field": "lesson_text", "after": after}
        elif fixk == "monster":
            after = it["lesson_text"] + MONSTER.format(pos=fmt(f["position_pct"]), r=fmt(f["risk_pct"]))
            fix = {"field": "lesson_text", "after": after}
        elif isinstance(fixk, tuple):
            fix = {"field": fixk[0], "after": fixk[1]}
        if fix:
            pr = check_text(fix["after"], facts_nums, is_q=fix["field"] == "q")
            if pr:
                problems.append((it["id"], pr))
        rows.append({"item_id": it["id"], "segment": "size.house_rule", "skill_id": it["skill_id"], "verdict": verdict,
                     "code": code, "reason": reason, "checked": size_checked(it, kind), "claims": None, "fix": fix,
                     "duplicate_of": dup, "_kind": kind})
    return rows, problems, items


def main():
    brows = build_bottoms()
    srows, problems, sitems = build_size()
    assert len(V) == len(srows), (len(V), len(srows))
    assert len(BV) == len(brows), (len(BV), len(brows))
    if problems:
        for p in problems:
            print("PROBLEM", p)
    path = OUT + r"\auditB_verdicts.jsonl"
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        for r in brows + srows:
            r = {k: v for k, v in r.items() if not k.startswith("_")}
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("wrote", path, len(brows) + len(srows), "lines")
    for seg, rows in (("regime.bottoms", brows), ("size.house_rule", srows)):
        print(seg, len(rows), Counter(r["verdict"] for r in rows), Counter(r["code"] for r in rows))
    # sizing distributions
    print("\nkind x verdict")
    kv = defaultdict(Counter)
    for r in srows:
        kv[r["_kind"]][r["verdict"]] += 1
    for k, c in kv.items():
        print(" ", k, dict(c))
    dist = {"all": [], "reaching": []}
    vmap = {r["item_id"]: r["verdict"] for r in srows}
    for it in sitems:
        if it["type"] != "size":
            continue
        p = it["prompt_json"]
        ps = D(str(p["entry"])) - D(str(p["stop"]))
        sp = float(ps / D(str(p["entry"])) * 100)
        sh = math.floor(D(str(p["account"])) * D(str(p["risk_pct"])) / 100 / ps)
        pos = float(D(sh) * D(str(p["entry"])) / D(str(p["account"])) * 100) if sh >= 1 else 0.0
        kind = size_kind(it["source_ref"])
        rec = (it["id"], kind, round(sp, 2), round(pos, 1), sh, it.get("review_status"))
        dist["all"].append(rec)
        if it.get("review_status") == "approved" or vmap.get(it["id"]) in ("keep", "fix"):
            dist["reaching"].append(rec)
    json.dump(dist, open(OUT + r"\auditB_size_dist.json", "w", encoding="utf-8"), indent=1)

    def bucket_stop(s):
        for lo, hi, lab in ((0, 2.25, "1.5-2%"), (2.25, 3.25, "2.5-3%"), (3.25, 4.25, "3.5-4%"), (4.25, 6.25, "5-6%"),
                            (6.25, 9, "8%"), (9, 10.5, "10%"), (10.5, 13, "12%"), (13, 99, "15%")):
            if lo <= s < hi:
                return lab

    def bucket_pos(x):
        for lo, hi, lab in ((-1, 0.01, "0 (skip)"), (0.01, 10, "<10%"), (10, 20.0001, "10-20%"), (20.0001, 25.0001, "20-25%"),
                            (25.0001, 50.0001, "25-50%"), (50.0001, 75.0001, "50-75%"), (75.0001, 101, "75-100%")):
            if lo <= x < hi:
                return lab
    order_s = ["1.5-2%", "2.5-3%", "3.5-4%", "5-6%", "8%", "10%", "12%", "15%"]
    order_p = ["0 (skip)", "<10%", "10-20%", "20-25%", "25-50%", "50-75%", "75-100%"]
    for name in ("all", "reaching"):
        print(f"\n{name}: n={len(dist[name])}")
        cs = Counter(bucket_stop(r[2]) for r in dist[name])
        print("  stops:", [(k, cs.get(k, 0)) for k in order_s])
        fwd = [r for r in dist[name] if r[1] in ("forward", "forward-tight", "flat", "scaled")]
        cp = Counter(bucket_pos(r[3]) for r in fwd)
        print("  forward-type n=%d formula positions:" % len(fwd), [(k, cp.get(k, 0)) for k in order_p])
        cs2 = Counter(bucket_stop(r[2]) for r in fwd)
        print("  forward-type stops:", [(k, cs2.get(k, 0)) for k in order_s])
        print("  shares<=3:", [(r[0], r[4]) for r in dist[name] if 1 <= r[4] <= 3])


if __name__ == "__main__":
    main()
