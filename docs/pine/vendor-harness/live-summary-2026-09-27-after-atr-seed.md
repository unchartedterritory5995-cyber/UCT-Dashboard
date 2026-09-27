# Vendor harness — verdicts

Directories: `tests/fixtures/vendor/harness`

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
keltner-channels-bands-rddt-1d-2026-09-27    NYSE:RDDT D      7      INCONCLUSIVE  1 of 8 items could not be compared
    Basis                                    MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 4.41e-16
    Upper 1                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 4.78e-16
    Lower 1                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 5.72e-16
    Upper 2                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 4.49e-16
    Lower 2                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 6.38e-16
    Upper 3                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 5.38e-16
    Lower 3                                  MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 7.35e-16
    objects                                  INCONCLUSIVE  our object lane did not run: no result

TOTAL 1 captures — MATCH 0 · DIVERGE 0 · INCONCLUSIVE 1
```

## Not comparable (0)

