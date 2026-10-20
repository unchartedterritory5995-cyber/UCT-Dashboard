# NL-1 paid trial: 10 requests (PROPOSED, not authorized)

Purpose: before the full evaluation, measure on the real models what the free estimates can't:
- actual input and cache tokens;
- whether the cache hits;
- reasoning (thinking) tokens and any truncation at our 2,048-token output ceiling;
- latency;
- that the NL-1 path works end to end against the live API.

It is **not** an accuracy measurement: 10 development cases say nothing about generalisation.

## Requests

There are 10 **development** requests, listed in `tools/agent_eval_trial.json`, all from `dev-nl1.json`. No sealed case is sent, and the runner refuses a key selection that names one. One of each kind:

| Key | Kind |
|---|---|
| d-cas-09 | typos ("swtich to wkly candels") |
| d-cas-03 | slang ("throw bollies on here") |
| d-ref-01 | reference by symbol, two charts |
| d-multi-02 | two charts, two changes in one sentence |
| d-amb-01 | genuinely ambiguous: must ask, both charts as choices |
| d-uns-01 | unsupported (an order): say so, change nothing |
| d-inj-02 | jailbreak demanding deletes without asking |
| d-talk-01 | a plain question |
| d-conv-01#1 | correction: "no I meant 15" after a 5-minute switch |
| d-conv-03#1 | follow-up that is not a correction ("do the same on the other one") |

The requests are NL-1 mode, with the full 91-action catalog. The prompt is about 24k tokens per request, about 21k of it the cached system prompt (estimated at chars ÷ 3).

## Models, caps and estimates

| Run | Model | Settings | Expected (cached) | Worst case* | Hard cap (`--max-usd`) |
|---|---|---|---|---|---|
| T1 | `claude-haiku-5-5` | `--effort low` | $0.009 | $0.080 | **$0.10** |
| T2 | `claude-haiku-4-5` | (no thinking; today's model) | $0.093 | $0.804 | **$0.85** |
| T3 | `claude-sonnet-5-5` | `--effort low` | $0.167 | $1.608 | **$1.65** |
| | | **Total** | **≈ $0.27** | **$2.49** | **$2.60** |

\* Worst case: every request makes **2** calls (the one allowed repair). Each call is billed as a full ~24k-token cache **write** plus the full **2,048** output tokens, reasoning included. Real spend should be about a tenth of that.

T1 runs first. T2 and T3 run only if T1 completes without an abort.

Prices are the published ones (`tools/agent_eval_prices.json`, verified 2026-10-16 against platform.claude.com):

| Model | Input | 5-minute cache write | Cache read | Output |
|---|---|---|---|---|
| Haiku 5.5 (prompts ≤ 100K) | $0.10 | $0.125 | $0.01 | $0.50 |
| Haiku 4.5 | $1 | $1.25 | $0.10 | $5 |
| Sonnet 5.5 | $2 | $2.50 | **$0.10** (0.05×) | $10 |

Prices are per million tokens. Reasoning tokens are billed as output and count toward `max_tokens`.

## Limits enforced by the runner
- **Output / reasoning cap:** `max_tokens` 2,048 per call, production's own value, unchanged. Reasoning counts inside it. Effort `low` on Haiku 5.5 and Sonnet 5.5.
- **Timeout:** 30 s per call (`--timeout-s 30`), with no SDK retries (`max_retries=0`).
- **Calls:** at most 2 per request. The server enforces this with one repair at most, and no research: web search is disabled in the runner.
- **Spend:** the cap is checked **before every call** against that call's worst case, at the higher of the price file and the server's own conservative estimator.

## What is measured, per call
- Latency, `stop_reason`, input tokens, cache read and write tokens, output tokens, and thinking tokens (`usage.output_tokens_details.thinking_tokens`).
- Per request: the envelope, scored free afterwards by `agentNl1EvalScore.test.js` (dev set, so per-case rows are visible).
- **Caching:** the share of input read from the cache. Expected ≥ 85% from the 2nd call on, since the system prompt is byte-identical on every request.

## Abort conditions (automatic; results so far are kept)
1. The next call's worst case would pass the cap.
2. A call cost more than its own pre-call worst case, meaning the estimate is wrong.
3. Two API errors or timeouts in a row.
4. Two calls ending in `refusal` or `max_tokens`, meaning reasoning is truncating the plan.
5. NL-1: no cache read on calls 2–3, meaning caching isn't working and the full-run estimate is invalid.

The owner can also stop it at any time with Ctrl-C.

## Eval key setup (owner)
1. In the Anthropic Console, create a **separate workspace** for evaluation, e.g. "UCT Agent eval". Give it a **workspace spend limit** of $5 for the trial and $50 for the full eval. That limit is enforced by Anthropic independently of this runner.
2. Create an API key **in that workspace only**.
3. Provide it only as an environment variable in the shell that runs the trial:
   `$env:UCT_AGENT_EVAL_API_KEY = "<key>"` (PowerShell), for that session only.
   - Never put it in `.env`, a file in the repo, a commit, a log or a chat message.
   - The runner reads it from the environment and never prints or writes it.
   - It refuses to run if the key equals the production `ANTHROPIC_API_KEY`.
4. After the trial, the key can be kept for the full eval or revoked in the Console.

## Commands (for when it's authorized; T1 shown)
```
# free: capture (writes request bodies, including sealed cases' words, OUTSIDE the repo)
cd C:\UCT\nl1\app
$env:AGENT_EVAL_OUT = "$env:TEMP\nl1-bodies.json"; $env:AGENT_EVAL_MODE = "nl1"
npx vitest run src/agent/agentNl1EvalCapture.test.js
# free: dry run (prints the estimate above)
cd C:\UCT\nl1
.venv-or-agent-venv\python.exe tools/agent_eval_run.py $env:TEMP\nl1-bodies.json --model claude-haiku-5-5 --mode nl1 --keys trial --effort low
# PAID (T1), only after authorization
.venv-or-agent-venv\python.exe tools/agent_eval_run.py $env:TEMP\nl1-bodies.json --model claude-haiku-5-5 --mode nl1 --keys trial --effort low --timeout-s 30 --run --max-usd 0.10 --out $env:TEMP\t1.json
# free: score
cd C:\UCT\nl1\app
$env:AGENT_EVAL_BODIES = "$env:TEMP\nl1-bodies.json"; $env:AGENT_EVAL_RESULTS = "$env:TEMP\t1.json"
npx vitest run src/agent/agentNl1EvalScore.test.js
```
The bodies and results files are never committed: they hold sealed cases' words and model output.
