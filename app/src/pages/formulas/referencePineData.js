// app/src/pages/formulas/referencePineData.js
//
// The TradingView names for the downloadable reference, as the page's own section
// builds them. A module of its own so the download can load it on request: it brings
// the engine's refusal families, which the page does not need until then (the same
// reason `PineNamesSection` is lazy).

import COVERAGE from '../../components/chart/supportLoop/doorNameCoverage.json'
import { familyOf } from '../../components/chart/builder/editorStatus'
import { SCOPE_NOTE, buildPineNames } from './pineNames'

/** @returns {{pine: object, pineScope: string}} */
export function pineForDownload() {
  return { pine: buildPineNames(COVERAGE, familyOf), pineScope: SCOPE_NOTE }
}
