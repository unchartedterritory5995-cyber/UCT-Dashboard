# `tests/fixtures/vendor/harness/` — vendor-comparison captures (v1)

Every file here is a `uct.vendor-capture/v1` capture read off a live
TradingView chart with `tools/vendor_harness/tv_capture.js` and assembled with
`tools/vendor_harness/verify_capture.mjs --assemble … --out <here>`, which
writes nothing unless the chunk hashes, the receipt, the schema and the source
sha256 all agree.

⛔ The directory's rule is `tests/fixtures/vendor/README.md`'s: **every number
here was read off the vendor's own chart model.** Synthetic captures used by
tests live in the test files, never here.

Procedure, schema, tolerance and how to read a verdict:
`docs/pine/VENDOR-HARNESS.md`.

Name: `<script>-<symbol>-<tf>-<yyyy-mm-dd>.json`.
