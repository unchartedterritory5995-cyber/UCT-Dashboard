---
role: the owner's own action list. Every open item an agent cannot close, why, and exactly what
  to do. ⛔ Rewritten in full 2026-09-26 (fourth revision of the day) because most of the previous
  list is now CLOSED, and a short accurate list is worth more than a long one full of
  strikethroughs. Closed items keep one line each so nothing reads as forgotten.
---

# What needs you — 2026-09-26

✅✅ **FOUR THINGS. None urgent, and one is new.**

| # | item | why it is yours | cost |
|---|---|---|---|
| 1 | **Name a non-builder who will actually use the terminal** | ⭐ NEW, from CARD 22's panel. You cannot supply the verdict on your own definition of done | one name, or the honest answer that there isn't one |
| 2 | **The OI-04 contract answer** | it comes from outside the company | one email |
| 3 | **Watch yourself work one trading morning** | an observation, not a decision | one morning, nothing waits on it |
| 4 | **Price, trial, seat model** | revenue decisions with no engineering dependency | whenever |

**Everything else that was on this list is closed.** The quiet window is scheduled and your partner
is notified. The CDN question is answered, fixed and verified. The browser measurements are taken.
Tiers are ruled. The stale claim on master is corrected and pushed.

---

## 1 · ⭐ NAME A NON-BUILDER SUBJECT — the one genuinely new ask

**Where this came from.** You delegated the definition-of-done question with *"you do, based on
simulated beta tests and judgement as a team of decision makers."* I convened three independent
reviewers — a working trader, an evaluation methodologist, and an adversarial reviewer whose only
job was to break it. The ruling is **CARD 22** in `12-decisions/DECISION_CARDS_2026-09-26.md`.

⛔ **I refused the simulation half, and the reason is the ruling's spine.** *"Do our own traders
voluntarily prefer it"* is a claim about real behaviour. A simulated trader preferring a simulated
terminal is evidence about the simulation, and reporting that as a verdict would be this
programme's signature failure committed on the definition of done itself.

⛔⛔ **All three reviewers concluded independently that you cannot supply the YES**, and the
sharpest version is not about honesty: **your switching cost is near zero and you need no
onboarding, which makes you the worst available subject rather than the most convenient one.** A
builder's session is QA, and in any log QA is indistinguishable from preference.

**So: who, other than you, will actually use it for a real workflow?**

⚠️ **If the honest answer is "nobody", say so — that is a finding, not a blocker.** The output
then becomes a verdict labelled **inconclusive by construction**, which is worth far more than a
pass nobody was in a position to contradict.

⭐ **Two reviewers independently invented the same test**, with no contact between them, and it is
cheap: **withdraw the terminal for one session, unannounced. If nobody asks for it back before the
close, it was tolerated rather than preferred.**

---

## 2 · The OI-04 contract answer

Still the last thing holding the provider ledger at amber, and still from outside the company.
Nothing else in the programme waits on it.

## 3 · Watch yourself work one trading morning

The only remaining signal that could overturn the hybrid workspace lock. ⛔ **Do not hold anything
for this** — every commitment in that document is true under both shapes, so building continues
either way. The tell is whether you ever want a market-wide page to *stop* being arrangeable.

## 4 · Price, trial, seat model

⭐ A correction to something I told my own agents: **a price does exist in your code**, $200/mo or
$2,000/yr. So the accurate statement is not *"there is no price"* but **"there is no owner-ratified
price and no cost ceiling"**, and that is what leaves this open. No engineering work depends on it.

---

## ✅ Closed today, one line each

- **Tiers** — you ruled **one paid tier**, vetoing my two-tier default. ⛔ It forecloses any
  tier-comparison surface and collapses the entitlement axis to a binary (CARD 17).
- **The CDN question** — ✅ **answered, fixed and verified.** The edge was already caching; a
  **zone-wide setting, not a cache rule**, was overriding your code's `max-age=0` to four hours.
  One scoped action was added to the rule matching those two paths, and the wire now reads
  `max-age=0` **with the second request still a HIT** — browser lifetime gone, edge cache intact
  (CARD 20-EXEC). ⚠️ **Still open, not urgent:** the zone-wide 4-hour setting remains, so any
  other route asking for a shorter browser lifetime is presumably raised the same way. Two
  responses were measured; the blast radius was not.
- **The browser measurements** — ✅ taken once you brought that window forward. The 16-panel board
  figure this programme had quoted for months was wrong **in both directions**, and the
  options-flow load puzzle is solved: **31 MB of cold packs** whose first two requests cost eight
  to eleven seconds of *server* time each.
- **The quiet window** — ✅ Tuesday 2026-09-29, 09:15–12:15 ET, run sheet written, **Bracco tagged
  in `#deploys`** with an invitation to move it. ⚠️ Treat the date as proposed until he replies.
- **The master push** — ✅ landed. Your guidance file said the print explainer was unmounted by
  design and that mounting it needed coordination; it is mounted in production, so that paragraph
  was issuing an instruction about a decision already taken.
- **The pod-read permission** — ⭐ no longer worth granting. The boundary turned out to be
  precise: reads through your app's own HTTP API are allowed, reads via `railway ssh` are not.
  **Three of the four fields that needed a pod read came out of your own admin API instead.**

---

## One thing to know that is not an action

⭐⭐ **Your highest-leverage alert question got much smaller overnight.** The one predicate
carrying all 2,344 disagreements has **one span**, covering five consecutive sessions that ended
**18 September**, and it has gained none of the sessions since. One span means that number is
**one alert's evaluations, about 469 a session** — a tick rate, not a delivery rate.

⛔ Read alongside zero agreements over those same days, it inverts what the counter's name
implies: **those are alerts a member would have been spammed with, which the new rule correctly
declines to send.** On that predicate, "lost" is the outcome you want — which is why CARD 21
re-cut the flip bar that had been treating it as a defect.
