# UCT Agent W1.1 — independent security + integration review (diff only)
Reviewed 2026-11-03. #725 agent/w11/args @ d338b2fe64, #727 agent/w11/routing-f16 @ b923e69f8c, base origin/agent/int e47b636d9c.
Both heads are 131 commits behind agent/int, but those commits touch no Agent path (journal_two, tools, docs, CLAUDE.md, api/main.py). Neither PR conflicts with agent/int.

## Tests run (targeted only, no paid calls, no market values printed)
- #725: pytest args_live_shapes + contract: 138 passed. vitest agentW11RepairA + agentCore: 45 passed.
- #727: pytest w11_repair_b + scan_sat_section_b: 95 passed. scan_hidden: 34 passed. vitest agentRouting, agentScanSat1Requests, agentNl1Selection, agentW11RepairB, qa/f16Phrases: 167 passed.
- Mirror: hidden.mirror_text() == scanHidden.js byte for byte: True.
- Merged tree (git merge-tree c9c4fc52, extracted to scratch): args_live_shapes + w11_repair_b + contract + scan_hidden + nl1: 286 passed.

## #725 (repair-a): APPROVE WITH CHANGES (nothing blocking)
(a) Coercion rules. The server's normalize_args (turn.py) and the client's normalizeArgs (capabilities.js) apply the same rules:
  1. argAliases: an alias key, dotted for nested, is moved to the canonical key only when the canonical key is absent. An emptied container is dropped.
  2. coerce: a per-arg word table, matched case-insensitively. Declared for: replay exit/off/stop/end/false/clear → null; screener sort_dir and mode words; addCharts timeframe and chart_type words.
  3. defaults: fills a REQUIRED non-nullable arg that is absent or null. The only one declared is screener.run filters: [].
  4. Schema rules every action gets:
     - a null word (null/none/nil/nothing/"") becomes null when the schema allows null;
     - a string becomes a boolean (true/on/yes/enabled/enable/show/1 and the opposites), and a string becomes a number ("$1,234", "90%"), only when the schema does NOT allow a string;
     - enum case-folding, only when the value is not already in the enum;
     - a boolean becomes its enum string;
     - a number becomes its enum string (15 → "15") only when that string is in the enum;
     - arrays and anyOf object branches are handled recursively;
     - an absent nullable arg becomes null.

  No rule invents a value except the declared defaults and absent→null. An explicit valid value is kept, with one exception (NB-1):
  - "90%" stays "90%" for chart.setSetting.value, because that schema allows a string. The dialog's range check decides.
  - "off" becomes a boolean only for non-string schemas.
  - A number becomes an enum string only on an exact enum hit.

  - NB-1: a NULL word overrides an explicit string in a [string,null] field. within:"none", as:"Nothing" and replay date:"none" all become null, so a list or screen literally named "None" is lost. Low impact. Suggestion: apply null words only when the schema has no string type, or only through a declared coerce.
  - NB-2: defaults.filters=[] also applies to mode "new". A new screen with no filters now runs universe-wide where it used to be refused as off-schema. It is read-only, but it does invent a value. Suggestion: apply the default only when mode is "refine" or a sort_field is present.

(b) Order. The client normalizes in planOps BEFORE shapeError and check(), so check() still sees the canonical args and no refusal is skipped. Replay exit (null) is a real exit.
  - NB-3: useAgent calls protectionRefusal(host, plan, ops) with the RAW ops. A layout.rename sent as {id:<protected>} would be missed by that guard, but planOps would then turn it into `layout`. This is not reachable today, because every model path (compact, strict, v2) is normalized on the server before the browser sees it. For defense in depth, pass the normalized ops (return them from planOps).

(c) Empty-board rule. It fires only when host.charts.list() is empty and the plan is 1–3 symbol/timeframe/type ops on one target with a valid ticker. It cannot fire on a board that has a chart.
  - NB-4: if list() throws, the board is treated as empty. This is the existing pattern. It fails toward one new chart, which is reversible and still goes through check() and the protection guard. Acceptable.

(d) Protected list source. It is built-in names plus a client localStorage list. A member can only add names to it (fail-closed for them), and deleting the key only removes their own added protection. The built-in names are hard-coded, and the server never trusts the list. Acceptable; noted.

(e) A 5xx or unreadable reply cannot be masked as the nonsense clarify. looks_like_nonsense is decided from the message SHAPE before the model call, and it never looks at a reply. Test test_a_real_messages_unreadable_plan_keeps_its_own_sentence covers this.
  - NB-5: false positives on real tickers. Bare "MMM", "RTY", "$RTY" and "AAA" get the clarify instead of a request. Suggestion: exclude $-prefixed tokens and all-caps 3–5 letter tokens.

(f) Outside-Agent files.
  - chartSettingsDescriptors.js: the bgMode row is added to ELIGIBLE and removed from SPECIALIZED. Only Agent modules consume ELIGIBLE (ChartSettingsModal imports only the option lists), so this is data-only, minimal, and within LT-3.
  - CAPABILITY-CONTRACT.md: a one-line note on the entry keys.
  Both are justified.

(g) The tests are non-vacuous:
  - each live shape has a matching "invalid shapes still refuse" list (invented ids, extra keys, booleans for dates, nested junk);
  - logging is by key, never by value;
  - the model's object is never mutated;
  - refusals are unchanged for capabilities that declare nothing;
  - the empty-board rule has negative cases: a chart exists, two targets, no symbol, another op, a non-native timeframe.

  Note: the nl1 rail test_legacy_never_coerces was intentionally INVERTED. It now asserts that 15 → "15" and that 7 is still refused. Record it as an intended rail change.

## #727 (repair-b): APPROVE WITH CHANGES (2 blocking)
(a) Routing. I probed the new indicatorAlerts words against a pre-change tree:
  - Price-alert phrases route as before: "alert me when NVDA crosses above 150", "set an alert at 200", "let me know if TSLA drops below 180".
  - Routine chart phrases route as before: "add the 50 day sma", "put a 9 and 20 ema on the chart".
  - The group is only ever ADDED. "show me where the 9 ema crossed the 20" gains indicatorAlerts, which costs tokens only.
  The requested vitest suites are green. Nothing is stolen.

(b) false_capability_claim. Cost is bounded: at most ONE repair call per turn (round 0, not already repaired, not asks_groups, meter.calls_left ≥ 1). The F-16 refusals do not trigger it (verified for 6 hidden keys).
  - BLOCKING-1: honest limits on part of a feature are caught. After the repair, sanitize_envelope REPLACES them with a misleading clarify. Probed:

    | Model reply | Family caught |
    |---|---|
    | "Screens run on end-of-day data, so a live intraday count isn't available." (the sentence SCREEN_RULE itself requires) | screener |
    | "Alerts by SMS aren't supported yet…" | alerts |
    | "Exporting a layout to a file isn't possible from here." | layouts |
    | "Sharing drawings with other members isn't available from here." | drawings |
    | "I can't share a watchlist with another member from here." | lists |
    | "I can't place trades from here, but I can set a price alert…" (one sentence) | alerts |

    Each costs a paid repair call and then turns a true answer into a false offer.
    Fix:
    - restrict the check to the observed LT-4/LT-9 families (indicatorAlerts, rename), or require the family word to be the object of a create/set/add/make/rename verb with no qualifier;
    - on a repeated claim, serve the model's reply (logged) instead of the clarify;
    - add these probes as negative tests.

(c) Hidden phrases. The phrases map to 24 of the 35 hidden keys, and every key they map to is hidden. The 11 keys with no phrase (dp_*_5d, opt_bull_pct, pattern_engine_*…) are still refused at key level. These public phrasings are NOT refused: "rs line", "relative strength line", "volume", "rsi over 70", "new rs line high".
  - BLOCKING-2: some public phrasings ARE wrongly refused:
    - "sort by highest rs line" → rs_rank (`\bhighest[\s-]rs\b` matches before " line");
    - "stocks outperforming / above the nasdaq composite" → uct_composite (bare `composites?`).
    Fix: add (?![\s-]line) to the rs patterns, and require a "uct" prefix or a rating/score word for "composite". Add both as negative tests.
  - NB: "accumulation distribution line rising" is refused as accdis. Confirm with the owner whether the A/D line is a public field.

(d) The mirror is byte-identical and the scan_hidden test passes.

(e) The "scheduled" wording is honest. It reuses the server's own kind:"scheduled" (marketdata/earnings.py) and the existing body line ("a scheduled event, not a result"). It says "confirmed" or "estimated" only if the gateway does. stock.js hard-codes "scheduled" next to next_report_label, which is acceptable because it uses the dated row only.

(f) The measurement changes are explained and limited:
  - d02 ("stocks with RS rank above 90", expect_refusal) is now a 0-call fast refusal. Model calls drop 64→62 and browser requests 31→30. Discovery fast path: passed 0→1 (d02).
  - SAT capture: a null body is allowed only for expect_refusal questions. The DRY-RUN tests moved from d02 to d05.
  - The agentScanPanel test input was rephrased. That is the budget test, not a rail.
  - Minor: d02 is counted under "answerable passed" though it expects a refusal. Fix the label only.

(g) All files are under Agent paths (api/services/uct_agent/**, app/src/agent/**, tests/**). Neither PR changes env, flags, budget, auth, the store or migrations, or deletes a file.

## Cross-PR
`git merge-tree --write-tree origin/agent/w11/args origin/agent/w11/routing-f16` reports ONE conflict: api/services/uct_agent/scan/sat/section_b_requests.json, a generated capture that both PRs regenerated. turn.py, screener.js and routing.js auto-merge, and the merged tree passes 286 targeted python tests.

Merge order: #725 first (it changes the manifest and golden), then rebase #727. In #727, regenerate the SAT capture rather than hand-resolving it.

Re-bless after both merges:
- section_b_requests.json;
- manifest.golden.json (check it equals the merged manifest);
- nl1_assemble_parity.json;
- cost-baseline, discovery-fastpath-baseline and fastpath-candidates (check whether #725's SHAPE lines or fast paths move any count).
Then run the full agent-ci union on the combined RC.

## RELEASE-W11-CHECKLIST
- Condition 1 (scope): MET for both PRs. Every change maps to LT-1/3/9/10 (#725) or to LT-4/8/11/12 + F-16 (#727), plus their tests. The two outside-Agent files in #725 are justified and minimal.
- Condition 4 (no unrelated change, security weakening, migration or destructive operation): MET.
  - No store, budget, limits, auth or flag change; no migration; no deleted rails.
  - One rail is intentionally inverted (nl1 legacy coercion): record it.
  - The coercion layer does not weaken refusals, because check() runs on the normalized args. NB-3 is recommended defense in depth, not required.
- Condition 2 (combined approval) is NOT given yet. It waits on #727 BLOCKING-1 and BLOCKING-2, the merge, the re-bless above, and a review of the final combined RC head.
