# UCT Indicators — Comprehensive Competitive Audit (2026-10-13)

- **Baseline audited:** master = production `84164aee3d`
- **Branch:** `audit/indicators-competitive-2026-10-13`
- **Changes:** none outside this folder. No runtime code, configuration, production data or deployment was changed. No paid AI calls were made.

## Documents

| # | Document | Read it for |
|---|---|---|
| 05 | [Executive Summary](05-EXECUTIVE-SUMMARY.md) | The plain-English answer. Start here |
| 01 | [Current Capability Inventory](01-CAPABILITY-INVENTORY.md) | What UCT actually supports today: shipped, dark and local |
| 02 | [Competitive Benchmark](02-COMPETITIVE-BENCHMARK.md) | Scored matrix vs TradingView, TC2000, TrendSpider, Deepvue, thinkorswim, StockCharts and MarketSurge |
| 03 | [Gap Analysis](03-GAP-ANALYSIS.md) | Ranked P0–P3 findings with evidence, impact, effort and dependencies; known red tests and their verdicts |
| 04 | [Recommended Roadmap](04-RECOMMENDED-ROADMAP.md) | Phases A–D, with acceptance criteria |
| 06 | [Cross-Platform Indicator Migration](06-CROSS-PLATFORM-MIGRATION.md) | The owner's top-tier workstream: Pine, thinkScript and PCF compatibility matrices, corpus results, honesty findings and compatibility roadmap |

## Evidence

- `workstreams/WS1…WS8`: detailed appendices with `path:line` evidence, probe results and tests run.

  | Appendix | Covers |
  |---|---|
  | WS1 | Library and calculation |
  | WS2 | Rendering, panes and legends |
  | WS3 | Lifecycle and workspace |
  | WS4 | Formula language and builder |
  | WS5 | Pine migration |
  | WS6 | thinkScript, PCF and other imports |
  | WS7 | Competitor research, with sources and dates |
  | WS8 | Performance, security and tests |

- `migration-corpus/{pine,thinkscript,pcf}/`: representative scripts **written for this audit**. They contain no third-party text.
- `migration-corpus/results/`: machine-readable outcomes. These hold counts and verdicts only; market values are redacted.
- `evidence/`: a browser screenshot on synthetic bars (Ichimoku).

## Method

Eight parallel workstreams read the code at the production SHA and ran targeted existing test suites. They also ran scratch probes against the real engine entry points, on synthetic bars. The scratch harnesses are not committed.

The lead then:
- re-verified every P0 candidate in code;
- ran the baselines for unexplained red tests;
- did one browser session on synthetic data;
- synthesized the documents.

Competitor facts come from public official documentation checked on 2026-10-13. Every claim carries an evidence tag. Flag states come from the repository's flag ledger, because the live production environment was not read.
