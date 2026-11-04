# RS-1 — UCT Agent research contract (v1)

- **Owner:** agent-rs (Wave 2, W2-B1, builder-b). Server: `api/services/uct_agent/research/rs1.py`; browser: `app/src/agent/capabilities/research.js`.
- **Status:** v1 (2026-11-03). Dark: the kind is default OFF (`UCT_AGENT_DATA_KINDS`, fail-closed) and the capability registers only while the server lists it.
- **Depends on:** MD-1 (`docs/agent/program/contracts/MD-1-market-data.md`), ADR-005 (model isolation), F-16 (hidden fields), the turn's research budget (`budget.Meter.research`).

## 1. Purpose

"Why is NVDA down today", "what's driving strength in AMD", "what catalysts next week for TSLA" — answered as a **structured research envelope** whose **facts** carry only figures UCT's data gateway returned, whose **interpretation** is web commentary with unconfirmed figures stripped, whose **unknowns** say what was not available, and whose **sources** are dated where the source gives a date. The Agent proposes; UCT's data decides what a figure may be.

## 2. Interface

| | |
|---|---|
| Kind | `research.company` — `gateway.read("research.company", {symbol, topic, question?}, user_id, turn_id, purpose="research")` (MD-1 §2). `topic` ∈ `move` · `strength` · `catalysts` · `general`; `question` ≤ 200 characters (the member's own words, used as the web query). |
| Capability | `research.ask` (query, target `market`), args `{symbol, topic, question}`; registered by `registerServerGatedBuiltins` only while `data_kinds` lists `research.company` and `instrument.resolve`. |
| Inputs | the SERVED gateway kinds `quote`, `news.company`, `earnings`, `fundamentals` (and `themes` for topic `strength`), each read through the gateway with purpose `"research"` — one logical read each, counted against the turn (MD-1 §5). A kind the server does not list is an **unknown**, never a guess. |
| Web | ONE call per turn through `turn._research` (Perplexity, mode fast, finance domain pack), admitted and settled through `budget.Meter.research` exactly as `/api/agent/turn` does. A second research read in the same turn reuses the first's result (`the web lookup was shared with an earlier research read in this turn`). |
| Flags | `UCT_AGENT_DATA=1` + `research.company` in `UCT_AGENT_DATA_KINDS`; each input kind must be listed too. Nothing new. |

## 3. The envelope (`data`)

```
{ symbol, topic,
  facts:          [{text, source, as_of, kind, stale}],      // built by the server from input envelopes only
  interpretation: [str],                                      // web sentences with every figure confirmed by an input
  unknown:        [str],                                      // what was not available / was stripped
  sources:        [{title, url, published_at}],               // stored headlines are dated; web citations: null + an unknown line
  inputs:         {kind: status}, web: {ran, cached, stripped}, facts_refused }
```

- **Envelope fields** follow MD-1 §3. `freshness` is the LEAST fresh contributing input; `as_of` is the OLDEST contributing fact's time (note `as_of is the OLDEST contributing fact's time; the envelope's freshness class is the least fresh contributing input`); `stale` when any contributing fact is stale; `coverage` counts the inputs evaluated / answered / dropped and the facts refused; `provider_calls` is the web call alone (1, or 0 when cached or shared) — nested reads report their own.
- Notes always carried: `facts carry only figures the UCT data gateway returned; each names its own source and as_of` and `interpretation is web commentary, not UCT data; sentences with figures UCT's data did not return were left out`.
- `status`: `ok` when every input answered and the web ran; `partial` otherwise; `unavailable` when neither UCT's data nor the web contributed.

## 4. Rules

1. **Figures.** `assemble()` is the gate: a fact whose text states a figure no input envelope carried is refused and counted (`facts_refused`); a web sentence with such a figure is stripped and counted (`unknown`: `N web sentences cited figures UCT's data did not return and were left out`). Years, calendar dates, quarter labels and clock times are not figures. A figure may be restated in thousands / millions / billions / trillions.
2. **Isolation (ADR-005).** Inputs are read with purpose `"research"`, which the gateway refuses for every model-isolated kind before admission. `breadth.current` and `ratings` are not input kinds and cannot become facts.
3. **F-16.** The research package imports nothing from the scan package and reads no screener field.
4. **Wording (Massive licensing).** A quote fact says `live` only when its own read was live and not stale with a trade-sourced row; otherwise `last traded … as of … Not a real-time price`. Periodic facts name their period. The browser answer repeats the envelope's freshness line and never adds `live` / `now`.
5. **One web call per turn**, metered. Never two.
6. **Telemetry is value-free:** the server logs counts and statuses (`uct_agent.research topic=… inputs=… facts=… stripped=…`), never a figure, a headline or the prose; the browser's `/api/agent/record` row is the content-free row every answer gets.
7. **What leaves the browser module:** `{text, present, link, chart}` — `present.kind = 'research'` with the three sections and the dated sources (`present.js`, `AgentResult.jsx`).

## 5. Default questions (the fast path)

| phrasing | topic |
|---|---|
| `why is NVDA down today`, `why is $amd up so much`, `why did TSLA drop today` | `move` |
| `what's driving strength in AMD`, `what is driving the rally in NVDA` | `strength` |
| `what catalysts next week for NVDA`, `any catalysts coming up for AMD` | `catalysts` |

The candidate word goes through `instrument.resolve` first (MD-1 §4.7); anything the index does not confirm answers in the §4.7.3 fixed words, and the question goes to the model when the fast path does not claim it.

## 6. Changelog

- **v1 (2026-11-03, agent-rs, W2-B1):** first version.
