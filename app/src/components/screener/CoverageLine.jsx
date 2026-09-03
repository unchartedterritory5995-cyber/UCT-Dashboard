// app/src/components/screener/CoverageLine.jsx
//
// RE-EXPORT SHIM (S8 Step 1, SPEC-S8 §4.1/§19). The real component moved to
// `app/src/components/provenance/CoverageLine.jsx` as part of consolidating
// S8's four shared primitives into one directory. This shim exists so the
// component's real importers (`ScanResults.jsx`, `EvidenceTab.jsx`) never
// need same-day rewiring — same idiom as `pages/EducationalVideos.jsx`'s
// shim over `pages/desk/VideosSection.jsx`.
//
// Kept through the migration window named in SPEC-S8 §19; remove once both
// importers are repointed directly at `../provenance/CoverageLine` and no
// other consumer has appeared.
export { default } from '../provenance/CoverageLine'
