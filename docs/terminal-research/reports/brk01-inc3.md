# BRK-01 increment 3: the implied-vol surface (RM-L01)

Branch `lane/brk01-inc3`, cut from `integrate/terminal-fixes` at `52952fef1f`.
Commits: `4e765f16db` (backend), `b8d7b0ee7c` (frontend), plus the docs commit that adds this report.

## What renders

Under the payoff panel on Research > Options, only while `options_vol_surface_enabled` is true:

1. **Smile** for the expiration selected in the chain's picker. IV by strike, with one line for calls and one for puts, and a dashed spot marker. It uses an ECharts line through the research-kit `EChart` host. `LineChart` is now registered there and its pin test is updated. No dependency was added.
2. **Term structure**: at-the-money IV plotted against days to expiration (value axis), with a text list of each point (expiration, DTE, ATM strike, IV, basis, quote time).
3. **Strike x expiration grid**: the out-of-the-money side (puts below spot, calls at or above), tinted within its own range. A cell with no valid quote is a dash and is never interpolated.
4. Statements on the surface:
   - "Today's live chain only, not history"
   - the vendor-IV sentence
   - the quote-time span of the smile
   - the strikes that were left out and why
   - the sides and expirations that were not drawn and why
   - "N of M listed expirations sampled", plus the expirations that could not be fetched
   - the refresh cadence and served-at time

## IV source

**Vendor.** The plotted IV is `implied_volatility` from the Massive (OPRA) snapshot. Nothing inverts Black-Scholes. The payload has `iv_source: "vendor"` and the sentence that the page prints.

## Honesty rules and their rails

| rule | backend rail (`tests/test_vol_surface.py`) | frontend rail (`VolSurfacePanel.test.jsx`) |
|---|---|---|
| vendor IV, stated | `test_iv_is_the_vendors_field_and_the_payload_says_so` | "says it is today's chain ... IV is the vendor's" |
| no two-sided quote: refused in a sentence, never priced off the last trade | `test_a_strike_with_no_two_sided_quote_...`, `test_a_crossed_quote_or_missing_vendor_iv_...` | "refused strikes are named" |
| every point carries its quote time | `test_every_point_carries_its_quote_time_and_one_without_is_refused`, `test_quote_time_is_read_from_the_snapshot_in_nanoseconds` | "every point carries its quote time" (tooltip, list, grid title) |
| a thin expiration says so and is not a line | `test_a_thin_expiration_says_so_and_is_not_a_line`, `test_term_structure_needs_two_...` | "draws only the drawable side", "an expiration without an ATM read is named" |
| today's chain, not history | `test_the_surface_states_it_is_todays_chain_not_history` | basis test |
| no trade, run or send action | (none) | "still offers no trade, run or send action" (surface on); the existing chain test is unchanged and still passes |

`_normalize_contract` now reads `last_quote.last_updated` (Unix ns) into `quote_time` (ISO UTC) and `last_quote.timeframe` into `quote_timeframe`. A missing stamp is `None`, never a guessed "now".

## Request budget

- At most 8 sampled expirations, plus the member's selected one. The sample is the nearest 3, then the rest spaced evenly through the list, ending on the farthest listed expiration.
- Fetches run on 4 worker threads with a 25 s wall clock. A late or failed expiration is listed in `missing` with its reason.
- Each chain call is `get_chain(sym, exp, 10)`: the same `n` the chain tab uses, so the selected expiration hits the chain's existing 60 s cache.
- The whole surface is cached 60 s per (symbol, selected expiration).
- Polling: bare `useSWR` at 60 s with `revalidateOnFocus: false`, which is the same decision the chain grid made. ⚠️ `OptionsChainTab.jsx` had no row in `pollingSites.rail.test.js`, so that rail was **red on the base**. Both sites now have rows, with the reason (pinned to the server's 60 s cache).

## Gate

`GET /api/research/options/{sym}/surface` is a plain `def`.

- 404 unless both `OPTIONS_CHAIN_ENABLED` and `OPTIONS_VOL_SURFACE_ENABLED` are `1`.
- 402 for a free plan.
- 503 on a provider failure.
- 422 on a malformed expiration.

The flag is registered as `pending` in `docs/feature_flags.json`. The member-API whitelist and `skill.md` were regenerated (+1 route).

## Tests (scoped)

- `python -m pytest tests/test_feature_flag_ledger.py tests/test_async_routes_do_not_block.py tests/test_vol_surface.py tests/test_options_chain_route.py tests/test_skill_whitelist.py tests/test_entitlements_manifest.py -q` gives **294 passed**.
- `npx vitest run src/pages/research src/hooks/pollingSites.rail.test.js src/components/research-kit/charts/echartsCore.test.jsx --maxWorkers=2` gives **37 files / 297 passed**.
- The wider run (adding research-kit, ui/provenance censuses and `src/__tests__`) gave 878 passed and 2 failed. Both failures are in `entryExcludesChartEngine.test.js`, they are **pre-existing on the base** (`usePreferences -> chart/instanceShape -> chart/engine`), and this lane touches neither file.

## Mutation proofs

Each mutation was broken with an editor, went red, and was restored with an editor. The pycache was cleared between backend runs.

1. Two-sided check reduced to `ask > 0`: 2 red (`no_two_sided_quote`, `crossed_quote_or_missing_vendor_iv`).
2. Quote-time refusal removed: 1 red (`every_point_carries_its_quote_time`).
3. `drawable` threshold `MIN_STRIKES` changed to `2`: 1 red (`thin_expiration_says_so`).
4. Frontend `buildSmileOption` draws any side that has points instead of only drawable ones: 2 red.
5. A `<button>Trade the skew</button>` planted in the panel: 1 red (`still offers no trade, run or send action`).

## Open

- **Live check of `quote_time` coverage.** The Massive snapshot's `last_quote.last_updated` has not been read live. If the plan omits it, every point is refused with "no quote time". The page will say so; it will not be silently empty. Do this before arming.
- Arming `OPTIONS_VOL_SURFACE_ENABLED` is the owner's call.
- Not built: IV rank, IV history, past surfaces, increment 4 (backtester). All of these wait on the vendor answer.
