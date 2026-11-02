# SC-1 field exposure tag — design proposal (DRAFT 0.1)

- **Owner of this proposal:** agent-sc.
- **Owner of the change it asks for:** the **Screener** workstream (`api/services/screener/**`, OWNERSHIP.md). agent-lead routes it.
- **Status:** design only, for review. Nothing here is merged, deployed or enabled. It exposes nothing currently hidden from the Agent, and changes nothing a member sees on the Screener page.
- **Why:** owner F-16 ruling (Sprint 2). The Agent must never reach UCT's proprietary scores, rankings, classifications and internal research fields, or options-flow and dark-pool data. Today's enforcement (SC-1 §2d, `api/services/uct_agent/scan/hidden.py`) derives what it can, but has to **name** the rest by hand, because the field catalog carries no metadata that says what a field is.

## 1. What exists today, and why it isn't enough

| Source of truth today | Covers | Gap |
|---|---|---|
| `enrich.ratings_fields()` constant `out["…"]` keys, by AST | the 9 UCT Ratings columns | only ratings written there |
| catalog `category == "flow"` | the 7 dark-pool and options-flow fields | a flow field filed under another category would be missed |
| hand-named in `hidden.py` (with comments) | rs_rank, rs_return, candle_score, earnings_setup_grade, in_uct20, archive_calls_n, every pattern-engine field, base_structure, base_relation_count, hvc_52w, theme | **a list**; a new proprietary field is EXPOSED until someone adds it |
| catalog-only rule (SC-1 §2d) | the 33 raw snapshot columns outside the catalog (archive_*, base_*, …) | relies on the catalog being the only door |

The structural problem is **default-allow**: a field added to the catalog tomorrow is visible to the Agent unless someone remembers to list it. The owner wants **default-deny**: unclassified means unavailable to the Agent until reviewed.

## 2. The tag (Screener-side change)

Every field definition in `screener/filters.py` (the registry `field_catalog()` and `FILTERS` read) carries one required attribute:

```python
exposure: "public" | "proprietary" | "restricted"
```

| Value | Meaning | Examples (today's classification) |
|---|---|---|
| `public` | an ordinary market or fundamental measurement any data vendor sells, computed by a published or standard method | price, chg_pct_*, volume, vol_ratio, rvol_live, moving-average relations, RSI, ADR/ATR, standard candlestick properties, gap_pct, market_cap, PEG, eps_growth, rev_growth, margins, inst_pct, short interest, earnings dates, analyst data, sector, industry, index membership, stage2/stage4 |
| `proprietary` | a UCT score, ranking, grade, classification, list or internal research output | uct_composite, rating_*, accdis, sponsorship, sector_rs_pct, blended_growth, rs_rank, rs_return, candle_score, earnings_setup_grade, in_uct20, archive_calls_n, pattern_engine_* + pattern_entry/stop_dist_pct + pattern_expectancy_r, base_structure, base_relation_count, hvc_52w, theme |
| `restricted` | licensed or sensitive data the owner has not released to the Agent | dp_* (dark pool), opt_* (options flow) |

**Rules for the tag**
- **Required, with no default.** A field defined without `exposure` fails the Screener's own registry test. That's the Screener owner's rail, so a new field cannot ship unclassified.
- **The Agent reads `exposure == "public"` and nothing else.** A missing, misspelled or unknown value is NOT public: it's hidden from the Agent (default-deny). The Agent never trusts a field it can't classify.
- **Who sets it:** the Screener owner, when a field is added. Changing a field from `proprietary` or `restricted` to `public` is an **owner decision**, recorded in the PR (the same discipline as a feature flag's `owner_decision`). agent-sc and agent-qa review, but never set it.
- **Derived fields inherit the most restrictive input.** A field computed from a proprietary input (sector_rs_pct from rs_return, blended_growth into the Growth Rating) is `proprietary` even if its formula looks generic.
- **Member-facing behaviour is unchanged.** The tag is metadata only. `/api/screener/fields`, `/scan`, saved screens and the Screener page ignore it, so the member's Screener is byte-identical. agent-qa rails that.

**Also on the Screener side**
1. **Expose it.** `field_catalog()` entries include `exposure`. The member page ignores it.
2. **Aliases.** Three catalog keys read a different column (`candle_type` → `candle_matches`, `base_structure` → `base_matches`, `pattern_engine_id` → `pattern_engine_ids`). The tag lives on the key, and `filters.column_for(key)` stays the only key-to-column map. The Agent never names a column directly.
3. **Raw columns.** The 33 snapshot columns outside the catalog get no tag and stay unreachable to the Agent (the SC-1 §2d catalog-only rule). Requested: the Screener owner confirms no Agent-facing route ever accepts a raw column name.
4. **Views.** `filters.VIEWS` is unchanged. The Agent refuses a named view that shows any non-public column, and drops non-public columns from the default view's rows.
5. **Provider measures** (`registerScreenMeasures`, e.g. the client's `session` measures) declare `exposure` the same way. Today's session measures are public.

## 3. How `hidden.py` derives from it (agent-sc side, after the tag lands)

```python
def agent_fields() -> frozenset:          # the ONLY fields the Agent may reach
    return frozenset(f["key"] for f in filters.field_catalog() if f.get("exposure") == "public")

def rating_keys():   # refusal wording only, never the gate
    return {f["key"] for f in catalog if f.get("exposure") == "proprietary"} | (non-public, non-restricted unknowns)
def flow_keys():
    return {f["key"] for f in catalog if f.get("exposure") == "restricted"}
```

- **The gate is the allowlist** (`agent_fields()`), not the denylist. `spec.validate` refuses any filter key, `other` comparison, logic leaf, arithmetic term (`{"f": …}`), sort key, rank criterion, requested column or named-view column that is not in `agent_fields()` (plus the row identity `ticker`/`company`).
  - It refuses with the proprietary sentence for `proprietary` or unclassified fields, the flow sentence for `restricted`, and the ordinary "no field" sentence for anything not in the catalog at all.
- **The cross-checks stay as tests, not as the gate:**
  - every `enrich.ratings_fields()` constant key must be tagged `proprietary`;
  - every `category == "flow"` field must be `restricted`;
  - today's hand-named set must be tagged non-public.
  - A disagreement fails CI, so the tag and the code that produces a field can't drift.
- **The hand-named lists in `hidden.py` are deleted** once those tests are green, leaving one authority.
- **The browser mirror** (`capabilities/scanHidden.js`) becomes an allowlist generated the same way and pinned by the same parity test. The client also refuses anything outside it, as defence in depth. The server remains the enforcement point.

## 4. Every path, and how it's closed

| Path | Closed by |
|---|---|
| filter / logic leaf / `other` comparison | `spec.validate`: key ∈ `agent_fields()` |
| arithmetic (calculated) filter | every `{"f": key}` term walked, the same check |
| alias | the tag is on the key; the Agent names keys only, never columns |
| sort / rank criterion | the same check; raw columns refused |
| requested columns / named view | the same check; the default view's non-public columns are not returned |
| counts (`screen.count`) | the same `spec.validate` |
| saved screens (`screen.saved`, run by id) | listed `runnable:false`, `spec:null`, reason; running is refused |
| criteria text (grammar) | compiled, then the same `spec.validate` |
| follow-ups (refine) | the refined spec is validated whole; a hidden key can't be added, and can't be kept, because no screen holding one ever ran |
| default order | explicit `market_cap desc` (the Screener's own default is UCT Composite) |
| the planner's catalog context | the client builds it from `agent_fields()` only |
| result rows / memory / `lastScreen` | built from validated specs and public columns only |

## 5. What stays true regardless (the owner's accepted position)

Hiding UCT's outputs does not make them impossible to reconstruct: public inputs can produce similar, or for some ratings identical, orderings (a return blend for RS; earnings growth, PEG or institutional ownership for component ratings). The tag controls what the Agent **reads and shows**. Separately, the Agent never reproduces or describes UCT's rating formulas (SC-1 §2d).

## 6. Rollout

1. **Screener owner:** add `exposure` to every field definition, with today's classification in §2's table, and the required-attribute registry test. No behaviour change for members.
2. **agent-sc:** switch `hidden.py` to the allowlist, keep the cross-check tests, delete the hand-named lists, regenerate the JS mirror. Lands with agent-qa's rails.
3. **Anything newly classified `public`** in step 1 that is hidden today: none is proposed.
   - **Open for the owner:** `base_pivot_px` ("Base Pivot Price") also comes from UCT's base detector, like `base_structure`. It is visible today and not yet ruled on. agent-sc recommends `proprietary`.
