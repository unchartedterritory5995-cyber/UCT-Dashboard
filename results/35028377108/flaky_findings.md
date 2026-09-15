# Flaky tests — DERIVED

⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a quarantine list**: it is re-derived from the record on every run, so a test leaves it the moment the evidence stops supporting it.

**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH states across two runs that no code change can distinguish — the same commit SHA, or a diff that cannot reach a test. It leaves after **5** consecutive stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline.

| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |
|---|---|---|
| **1** | 0 | 0 |

## The pairs the record could compare

| runs | comparable | why |
|---|---|---|
| #15 → #16 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #16 → #17 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #17 → #18 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #18 → #19 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #19 → #20 | **yes** | no changed file can reach a test |
| #20 → #21 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #21 → #22 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |
| #22 → #23 | **UNREADABLE** | .github/workflows/full-suite-report.yml could not be parsed as YAML (or PyYAML is absent) |

⛔ **1 of 8 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## `pytest` · `tests.test_ticker_logos_prewarm`

**test_run_pass_skips_warm_and_resolves_cold**

- changed state across: #19→#20
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

