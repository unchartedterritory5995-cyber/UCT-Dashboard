# UCT Agent — present-tense (intraday) breadth: release notes, activation, smoke test

Status: local release candidate, NOT pushed, NOT active. Owner decision 2026-10-12: present-tense
breadth uses the latest valid intraday reading; history, closes, comparisons and ranges stay finalized.

## What ships (and what it does while OFF)

| piece | where | while `AGENT_BREADTH_CURRENT` is OFF (default) |
|---|---|---|
| Breadth current-reading contract `breadth_current.reading()` | Breadth dep `ca00e169a6` + `237111ebd4` | unused by the Agent; ops-only routes stay push-secret gated |
| Present-tense overlay | `api/services/uct_agent/breadth_now.py`, called in-process by `POST /api/agent/breadth` (admin-only) | **not called**: answers are the finalized close exactly as before |
| `basis: "close"` argument | `breadth.show` manifest | planned, harmless (finalized either way) |
| Deterministic routing of obvious wording | `breadth.show` `fast` phrase (fast path; same planner/policy/runtime) | active: the same finalized answer, with no model call |
| "Latest close" label on comparisons | `breadth_present.py` | active |

## Rules (ON)

- **Present tense** ("now", "today", or no date, and not an explicit close): each measure comes from
  `reading()`. It is shown as current only when `current` is True, with the contract's own `label`,
  e.g. "Intraday · 11:51 AM ET" or "Provisional close · Oct 9". The label carries the market DATA's
  time, never the compute time.
- **Measure tiers.**
  - `approximate` counts say "approximate count".
  - The `finalized_only` new-high / new-low family shows "Finalized close · Oct 8 (finalized only)".
  - An overview with mixed statuses says "Each measure shows its own time and status."
- **Not current** (stale, delayed feed, unknown data time, feed down, population drift, or the
  dependency missing): "No current breadth reading is available right now — this is the latest
  finalized close, shown as historical context." The finalized close carries its date.
- **Dates, `basis: "close"`, comparisons and ranges**: MI's finalized read (D5), unchanged.

## Feature-flag activation procedure (each step needs the owner's explicit approval)

1. **Release.** Ship the Breadth dependency (`ca00e169a6`, `237111ebd4`) and this Agent branch in
   ONE release through the standard procedure:
   - fetch; confirm the fast-forward;
   - run `tools/pre_push_guard.py` ALONE and check its exit code;
   - `git push origin <sha>:master`;
   - Agent deploy gate, then promote-production.
   Without `237111ebd4`, the production live payload has no `data_as_of`, so every intraday reading
   is "observation time unknown" and not current. That fails closed, but it is not the feature.
2. **Verify OFF.** In production, as an admin, ask "What % of stocks are above their 50-day?". The
   answer must be the finalized close ("As of … close"), with no "Intraday" label.
3. **Verify the Breadth side read-only.** The push-secret
   `GET /api/breadth-monitor/current?universe=us&metric=pct_above_50sma` returns `current: true` with
   `observation_basis: "vendor_snapshot"` and a small `data_age_s` during market hours. Done by the
   Breadth owner or with the owner's push secret; the Agent never calls it.
4. **Enable.** On the Railway service that serves `/api/agent/*` (web), set `AGENT_BREADTH_CURRENT=1`.
   Accepted values are `1`, `true`, `on` or `yes`, in any case; anything else, or unset, is OFF. Then
   redeploy or restart the service.
5. **Smoke.** Run the manual checks below in the admin panel. A real-model run needs separate
   approval of the paid smoke test.
6. **Roll back** without a deploy: set `AGENT_BREADTH_CURRENT=0`, or delete the variable, and restart.
   Answers return to finalized-only immediately.

The display-entitlement sign-off for intraday data (Breadth pre-activation item) must be on record
before step 4.

## Real-model smoke-test plan (NOT run; needs owner approval — paid)

- **Setup:** the admin account; production or staging with the release deployed and the flag ON;
  during market hours, plus one run after 16:00 ET.
- **Size:** about 10 turns on the default Agent model. Estimated well under $0.25; stop at the cap.
- **Pass:** every row matches; no breadth figure appears in any model request, reply or chat name
  (server logs show statuses only).
- **Note:** rows 1, 2 and 4 are DETERMINISTIC (fast path, no model call) when worded exactly. The
  model smoke uses the variants in brackets so the planner is exercised too.

| # | member says | expected plan (`breadth.show` args) | expected card |
|---|---|---|---|
| 1 | "What % of stocks are above their 50-day?" [variant: "roughly what share of stocks sit above the 50-day these days?"] | value, `pct_above_50sma`, date null, basis null | "Intraday · HH:MM ET" (or "Provisional close · …" after hours) |
| 2 | "How's breadth today?" [variant: "give me a quick read on market breadth"] | value, `metrics: []`, basis null | overview: 50/200-day intraday, NH−NL "(finalized only)", A/D "approximate count", mixed-status note |
| 3 | "What was the % above the 50-day at Friday's close?" | value, `pct_above_50sma`, date = Friday, basis close | "As of <Friday> close" (finalized) |
| 4 | "What was the % above the 200-day at the latest close?" [variant: "where did the 200-day participation finish yesterday?"] | value, `pct_above_200sma`, basis "close" | "As of … close" (finalized), no Intraday label |
| 5 | "What % of Nasdaq stocks were above their 20-day on Sept 15?" | value, nasdaq, `pct_above_20sma`, date 2026-09-15 | finalized, dated |
| 6 | "How does that compare with a month ago?" (follow-up to 1) | compare, date null, compare_date about a month back | finalized comparison: Earlier → "Latest close" → Change with sign |
| 7 | "Show % above the 50-day from Sept 1 to today" | series | finalized range |
| 8 | "What's breadth today and the latest NVDA news?" | breadth.show (`[]`) + news.latest | both sections; no limit refusal; 5 headlines |
| 9 | "Why is breadth so weak today?" | breadth.show (current) + the fixed "not explained" notice | no model-written figures |
| 10 | "Name this chat" / chat auto-naming after rows 1–9 | — | the title holds no number |

## Future enhancement (NOT in this release): live-versus-historical comparisons

Comparisons and ranges stay **finalized-only** in this release. Their newest tile reads "Latest close"
so it is never mistaken for a live value. A future "how does breadth NOW compare with a month ago?"
would put an intraday reading beside a finalized close.

**Requirements:**
- each tile carries its own observation type and time ("Intraday · 11:51 AM ET" vs
  "Finalized close · Sep 12");
- the change tile says it spans two bases ("intraday vs finalized close");
- the change is the difference of the two shown values, using MI's unit formatting;
- it is never shown when the intraday reading is not `current`.

It needs its own owner decision and tests.
