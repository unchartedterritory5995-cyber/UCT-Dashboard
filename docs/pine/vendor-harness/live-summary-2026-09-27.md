# Vendor harness — verdicts

Directories: `tests/fixtures/vendor/harness`

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
keltner-channels-bands-rddt-1d-2026-09-27    NYSE:RDDT D      7      DIVERGE       Upper 1: bar 19 t=1713447000 value vendor=52.56921231914695 ours=52.41573491758862
    Basis                                    MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 4.41e-16
    Upper 1                                  DIVERGE       cmp 612 ok 475 warm 0/0 steady 137/612 maxRel 2.92e-3 — 137 steady-state bars disagree; first at bar 19 (value: vendor 52.56921231914695 vs ours 52.41573491758862) — a CONVERGING PREFIX: bars 19..155 differ with |err| falling 1.53e-1 → 9.18e-8, then all 475 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower 1                                  DIVERGE       cmp 612 ok 474 warm 0/0 steady 138/612 maxRel 3.64e-3 — 138 steady-state bars disagree; first at bar 19 (value: vendor 42.154787680853055 vs ours 42.30826508241138) — a CONVERGING PREFIX: bars 19..156 differ with |err| falling 1.53e-1 → 8.27e-8, then all 474 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper 2                                  DIVERGE       cmp 612 ok 471 warm 0/0 steady 141/612 maxRel 5.31e-3 — 141 steady-state bars disagree; first at bar 19 (value: vendor 57.7764246382939 vs ours 57.46946983517725) — a CONVERGING PREFIX: bars 19..159 differ with |err| falling 3.07e-1 → 1.21e-7, then all 471 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower 2                                  DIVERGE       cmp 612 ok 469 warm 0/0 steady 143/612 maxRel 8.31e-3 — 143 steady-state bars disagree; first at bar 19 (value: vendor 36.9475753617061 vs ours 37.254530164822754) — a CONVERGING PREFIX: bars 19..161 differ with |err| falling 3.07e-1 → 9.76e-8, then all 469 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper 3                                  DIVERGE       cmp 612 ok 0 warm 0/0 steady 612/612 maxRel 7.31e-3 — 612 steady-state bars disagree; first at bar 19 (value: vendor 62.98363695744085 vs ours 62.52320475276587) — persistent, last at bar 630
    Lower 3                                  DIVERGE       cmp 612 ok 0 warm 0/0 steady 612/612 maxRel 1.45e-2 — 612 steady-state bars disagree; first at bar 19 (value: vendor 31.740363042559153 vs ours 32.20079524723413) — persistent, last at bar 630
    objects                                  INCONCLUSIVE  our object lane did not run: no result

TOTAL 1 captures — MATCH 0 · DIVERGE 1 · INCONCLUSIVE 0
```

## Not comparable (0)

