# W1 / R53 — acceptance on production, and the cause the fix did NOT reach

**Merge `16e161f5f` deployed 18:32:48Z SUCCESS.** Running SHA verified **two ways**, as R58 requires:

1. **ancestry** — `git merge-base --is-ancestor 16e161f5f origin/production` → true, and it is
   `origin/production`'s tip;
2. **in-process** — the pod reports `16e161f5fcba` at uptime 62 s, with `stall_record` and
   `token_slots` still non-null (OI-47 holding across the deploy).

---

## 1 · The sentence half — **PASS**

Verbatim, in `#render-smoke`, from the live pod:

> ⚠️ **SPY** — the options-flow service didn't answer in time. Try again in a moment.

The catch-all is **gone**. This is `contract.plain("flow_timeout")`, the same table V2 reads,
reached because the pre-V2 branch stopped discarding the class the fetch had already computed.
A member is now told *which* thing failed, and the retry offer survives because a timeout is one
of the two classes where retrying can work.

## 2 · The partition half — **the card did NOT render**

```
18:35:51,947 WARNING [flow] fetch failed SPY (30): timed out
18:37:09,565 WARNING [flow] fetch failed SPY (30): timed out
```

So the read still exceeds 30 s. ⛔ **The acceptance criterion — "renders a card" — is NOT met**,
and the partition fix, while correct, was not sufficient.

## 3 · ⭐⭐ THE CAUSE, READ OFF FLOW-WORKER (read-only, R53/D-16)

```
2026-09-17 18:35:37  [massive-oi] SPY: 41 pages, 10000 total results, 7984 indexed with OI>0
2026-09-17 18:36:47  [massive-oi] SPY: 41 pages, 10000 total results, 7984 indexed with OI>0
2026-09-17 18:37:37  [massive-oi] SPY: 41 pages, 10000 total results, 7984 indexed with OI>0
```

**Every `/flow SPY` makes flow-worker walk 41 pages and 10,000 option contracts** to build the
OI snapshot — once per attempt, three attempts, three fetches. SPY is the most heavily-optioned
symbol in the US market; NVDA is not, which is exactly why NVDA has rendered all along and SPY
has not, pre-market and in RTH alike.

⭐ **This also explains the drift the R53 verdict could only label INFERRED.** On 2026-09-13 the
same call returned inside the budget; four days of contract growth later it does not. Nothing
about the code changed — the *data volume* crossed the client's 30 s `timeout_s`.

⛔ **And it means the partition was never the whole story.** Moving SPY to `etfs` is right — that
is where its 182 contracts live — but the cost is dominated by the OI walk, which happens
regardless of partition. §2 of the R53 verdict said links 1-6 were "enough to act on"; they were
enough to *fix a real defect*, and not enough to *restore the card*. Both statements are true and
I should have separated them earlier.

## 4 · What else this run measured

⭐ **R54 is live and load-bearing, on its first day.** The acks now carry the interaction type,
and the distinction was immediately necessary:

```
18:33:38  {"evt":"ack","cmd":"flow","hop":"entry_to_ack","ms":143.8,"itype":4}   <- autocomplete
18:33:43  {"evt":"ack","cmd":"flow","hop":"entry_to_ack","ms":196.4,"itype":4}   <- autocomplete
18:33:59  {"evt":"ack","cmd":"flow","hop":"entry_to_ack","ms":16.0,"itype":4}    <- autocomplete
18:35:21  {"evt":"ack","cmd":"flow","hop":"entry_to_ack","ms":65462.6,"itype":2} <- the COMMAND
```

Without `itype` those first three would have read as three `/flow` commands at 16-196 ms, and the
first acceptance attempt would have looked like a fast, healthy run that simply produced no card.

⛔⛔ **AND THERE IS A 65,462 ms `entry_to_ack` IN THAT LIST.** Sixty-five seconds from handler
entry to ack, on a pod two minutes into its boot — which is why the first attempt returned
Discord's own *"The application did not respond"*. **That is C-02 measured directly on the ack
path**, it is 21× the 3,000 ms budget, and it is not the screener sweep (§6 of the D-15 evidence
refuted that) and not the flow read (this is *before* the fetch). It is the largest single ack
measurement this programme has taken.
⚠️ The first attempt is therefore **INCONCLUSIVE-TRANSPORT, not a failure of W1** — the command
never reached the flow path. Recorded as such rather than counted against the fix.

## 5 · Where the remaining fix lives, and why it is not being shipped from here

The 41-page OI walk is **flow-worker's**. D-16: *"any fix that lives there is written, proven
locally, and DEFERRED with the safe deploy procedure in the owner pack — never deployed from
here."* So it is deferred, and the shape of it is:

- **cache the OI snapshot per symbol** (it is already computed per request and thrown away — the
  three identical lines above are three identical walks in under two minutes), or
- **bound the walk** for symbols above a contract-count threshold, or
- **raise `timeout_s` for known-heavy symbols** — the weakest of the three, because it spends the
  member's patience rather than fixing the work.

⛔ A flow-worker deploy drops the Massive OPRA socket and the gap is permanent until the T+1 flat
file, so it is an after-hours change with the owner's word, not a convenience.
