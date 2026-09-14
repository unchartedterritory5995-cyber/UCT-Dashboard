# 3.5 — the real-Discord smoke, run 2026-09-14 in `#render-smoke`

**Channel:** `#render-smoke` = `1549129739048853544`, created today under ADMIN CHAT.
Discord holds: bot role `1474903498700230668` `allow=[VIEW_CHANNEL]`, `@everyone` `deny=[VIEW_CHANNEL]`.
**Organic members exposed: 0.** The only non-bot readers are the 5 `ADMIN` members and the server
owner, who see it via `ADMINISTRATOR`, not via an overwrite.

**Flag state for every row below:** `DISCORD_RENDER_V2_ENABLED` **absent** — the pre-V2 path, which
is what members are on today. These rows are the CONTROL. Running web commit: `beace00e0024`,
read out of the running process by `/renderhealth` itself.

---

## Rows attempted

| # | Step | Result | Evidence |
|---|---|---|---|
| 9 | `/renderhealth` | ✅ **PASS** — ephemeral, named the flag state and the running commit | `step09-renderhealth.png` |
| 8 | `/buzz` | 🔴 **FAIL — "The application did not respond"** | `step08-buzz-no-response.png`, log lines below |
| 1–7, 10–15 | `/chart`, `/charts`, `/flow` and everything downstream of them | ⛔ **NOT RUN — blocked, reason below** | — |

---

## 🔴 Row 8 — an ack that missed 3 s while the render succeeded (the C-02 family, pre-V2)

⚠️ **This was first written up as "C-11 reproduced live". That was an over-claim and is corrected
here.** C-11 is *"a delivery failure or crash ends with nothing said"* and is ✅ CLOSED on the **V2
runtime** (`test_C11_*`, mutation-proved). What happened here is on the **pre-V2** path and is an
**ack that missed Discord's 3 s deadline** — which is **C-02**, *"`web` saturation → Discord acks
miss 3 s"*, the class whose load half is explicitly still open pending 3.1 in `--real`.

⛔ **The distinction is not pedantic.** Filing this against a CLOSED class asserts a regression in
work that was mutation-proved; filing it against C-02 says the open half is real and reachable.
Those point at different code and at different people.

```
19:10:20Z  drender  {"evt":"shadow","cmd":"buzz","ms":0.0,"outcome":"agree","detail":"n=0 ... pre=5"}
19:10:31Z  chart-renderer  render cid=- path=/r/buzz status=200 ms=10738 prio=interactive bytes=346078
```

The board **rendered correctly** — HTTP 200, a 346 KB PNG — and took **10,738 ms**. Discord's
initial-ack deadline is **3 s**. The member saw `The application did not respond.`

⭐ **The shadow recorded `outcome=agree`, so V2 would have done the same thing.** This is not a
defect the flip fixes, and it must not be counted as one.

⚠️ **What is NOT established:** why the ack missed. The handler's documented shape is to return a
type-5 defer immediately and edit later, and the shadow line records `pre=5` — so a defer *was*
chosen. Whether it was returned late, or returned and not accepted, is not decidable from one
observation, and no mechanism is asserted here. The renderer being 10.7 s deep in an `interactive`
render at that moment is suggestive of contention (**C-09**), not proof of it.

⚠️ **n = 1.** One observation is not a rate (`lesson_two_points_do_not_establish_a_rate`). What is
established is that the failure is *reachable*, not how often it happens. The web pod had booted at
19:04:27Z, ~6 minutes earlier, so this was not a cold-start artifact.

⚠️ `prio=interactive` — this was a member-facing priority render, competing with the warm cycle
that C-09 shows blowing its 20 s budget continuously through RTH.

**Filed as OI-36.** Recommendation: the `/buzz` on-demand path must ack before it renders, and the
render budget for `prio=interactive` must be bounded by the remaining ack deadline the same way the
chart path now is. Not fixed tonight — it is a pre-V2 defect, it is not a flip precondition, and
changing the buzz path during RTH buys nothing that waiting until after the close does not.

---

## ⛔ Rows 1–7 and 10–15 — NOT RUN, and the reason is structural

`/chart`, `/charts` and `/flow` are refused outside one channel:

> Please use `#📈丨chart-flow-requests` for chart & flow requests.

`cmd_channel_ok` compared the interaction's channel against a **single** id
(`CHART_FLOW_CHANNEL_ID=1546563720702853280`). Repointing it does not ADD a channel — it MOVES the
command, taking `/chart`, `/charts` and `/flow` away from all 1,558 members for the duration. So the
posting half of 3.5 could not run at all without a member-visible outage.

**OI-34** makes that variable an allowlist. Once it is merged and deployed, `#render-smoke` is added
as a SECOND entry, members keep `#chart-flow-requests`, and rows 1–7 run here with organic members
exposed still 0.

⭐ **This also closes Gap 3.** The `/chart` shadow saw no traffic because a member can only run
`/chart` in one channel. The shadow report says in its own output that it cannot tell "nobody ran
it" from "it is not being shadowed"; the channel gate is what tells them apart.

---

## ⚠️ A method constraint 3.5's script does not mention: ephemeral replies do not survive a reload

`/renderhealth`, `/buzz` and every refusal reply are **ephemeral**. Discord renders those
client-side only — they are **gone after any page reload or navigation**, and the channel then looks
empty. Both rows above were read live and are described here verbatim; the screenshots were lost to
a reload before they were written to disk, which is a mistake in method, not in the result.

⛔ **For the remaining rows: save each screenshot to disk in the same action that takes it, before
any navigation.** And keep the log line beside it — the `drender` event and the `chart-renderer`
line are the durable half, they carry the timings a screenshot cannot, and they survive everything.

⭐ This is also why row 8's finding is solid despite the lost image: `status=200 ms=10738` and
`The application did not respond` are two independent observations of the same event, and the log
one is the one that says *why*.

## What "done" means, and what this run is

Not done. Two of fifteen rows attempted, one pass, one real failure found. The remaining thirteen
are blocked on a merge, not on a decision. Recorded here rather than quietly re-scoped, because the
whole value of 3.5 is that it is the only evidence in the programme that is not about a rig.
