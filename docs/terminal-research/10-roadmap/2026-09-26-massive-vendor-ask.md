---
id: VENDOR-ASK-MASSIVE-1
title: The Massive vendor ask - ready to send
role: >
  Roadmap item RM-N02. One email, four register items, zero engineering, and the only
  thing that can move BRK-01 - the largest coverage gap in the product. Written to be
  sent as-is; the owner supplies the recipient and presses send.
status: ready to send
date: 2026-09-26
---

# The Massive ask

**Why one email and not four.** These are four register items (LCQ-01, LCQ-02, TERM-002
and BRK-01's data precondition) and they are all questions for the same account manager.
Sending them separately invites four partial answers on four timelines.

---

## Subject

`UCT Intelligence - options chain history, IV history, and a second OPRA connection`

## Body

> Hi <name>,
>
> Four related questions about our current plan, all pointed at the same project.
>
> **1. Historical option chains.** Do you offer historical end-of-day option chains, and
> how far back does coverage go? We need strikes, expiries, bid/ask and open interest per
> contract, not just aggregates.
>
> **2. Implied volatility history.** Is IV available historically - per contract, or as a
> surface, or an ATM term structure? If you publish any of those, which, and from when?
>
> **3. A second OPRA connection.** We currently hold one. What does adding a second
> connection cost, and does our existing Third-Party Agreement already cover display on a
> second one, or does it need an amendment?
>
> **4. One check on what we already have.** We currently compute a gamma-exposure view
> from a chain sourced elsewhere. Can the same view be served entirely from our Massive
> entitlement instead - i.e. is the chain data we would need for it inside the plan we
> already pay for?
>
> Happy to get on a call if that is faster.
>
> Thanks,
> Patrick

---

## What each answer unblocks

| answer | unblocks |
|---|---|
| **1 + 2** | `BRK-01`, pre-trade options analysis - the biggest single reason a member keeps another tab open, and in charter per CARD 28 |
| **3** | `TERM-002`, and it is a licensing question as much as a cost one |
| **4** | `LCQ-02` - re-sourcing an existing surface off one entitlement instead of two, which **closes a licensing exposure rather than opening one** |

⛔ **Do NOT treat a silence on 1 or 2 as a no.** If the answer is that they do not carry
option history, that is itself the finding the roadmap needs: it moves `BRK-01` from
"buy the data" to "accumulate it ourselves from today forward", which is a different and
much slower shape, and one worth knowing before a lane is spent.

⚠️ **Licensing:** any new feed here is an **OPEN** licensing question. CARD 26 cleared the
existing estate only - "cleared for what we already access, open per new source".
