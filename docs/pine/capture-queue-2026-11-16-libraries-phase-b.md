# Capture queue: 2026-11-16, a Pine v5 library imported by a v6 script (U15 Phase B)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`. Capture on NYSE:RDDT 1D: the probe's
`timeframe.period` reading needs a daily chart. Keep the plotted values as full float64 text.

TradingView lets a v6 script import a v5 library, and its own v6 built-ins do. Relative Volume at Time
imports `TradingView/ta/7`; Net Volume and Up/Down Volume import `TradingView/ta/8`. Three sources say
nothing about which rules the library then runs under: the Pine v6 reference (`import`, `library`,
`export`), the User Manual's Libraries page, and the "To Pine Script version 6" migration guide. The
guide does list every construct whose meaning changed from v5 to v6. The engine compiles one program
at one version, so it links a v5 library into a v6 script only where the code the script reaches
holds none of those constructs (`app/src/components/chart/engine/ast/pineLibraryVersion.js`). It also
links it only for a version admitted after its v6 importers graded MATCH
(`pineLibraryCrossVersion.json`). This row asks the general question directly.

⚰️ This supersedes the reading of Q-L2b in `capture-queue-2026-10-02-l2-libraries.md` ("not a value
question: TradingView compiles each at its own version"). That is very likely how TradingView works,
but no published sentence states it. The probe states it in numbers.

| row | probe | symbol / tf | what it settles |
|---|---|---|---|
| LB1 | `lib-v5-in-v6.pine` | NYSE:RDDT 1D | Does a v5 library keep v5 rules inside a v6 script? Each plot reads a value one construct of the migration guide makes different, computed inside a published v5 library (`BarefootJoey/AstroLib/1`, `boitoki/Utilities/11`, both MPL-2.0, imported and never copied): `color.red` and `color.yellow` values, a `const int` division, and `timeframe.period`. v5 rules read 255, 235, the riset value with `DegSin(0)`, and 2. v6 rules read 242, 216, the riset value with `DegSin(-0.5667)`, and 3. |
