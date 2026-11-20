// app/src/components/chart/builder/memberPane/memberDoorImage.js
//
// ─── ⭐⭐ THE PASTE WORKER (2026-11-20) — EVERYTHING THE MEMBER DOOR READS FROM THE PAGE, AS ONE IMAGE ───
//
// `memberPaneDefinition` builds a pasted script in a Web Worker (`memberDoorAsync.js`), and a worker is its
// own module graph: every module the door reads starts there as it does in a fresh page, empty. The door
// is a pure function of its arguments and of exactly these page states, each owned by its own module and
// imaged by that module (one authority over each value, no copy kept here):
//
//   lists       `engine/runtimeKill.js`              the kill list, the starter allowlist, capability
//                                                    admission and this tab's per-script verdicts
//   permission  `lib/runtimePanePermission.js`       the member's latched runtime-pane permission
//   evidence    `engine/runHalfRailSeam.js`          the run half's object evidence (the kill read's key)
//   libraries   `engine/ast/pineLibraryStore.js`     the Pine libraries this page has fetched
//   hkd         `engine/hostKnownDivergence.js`      the host lane's known-divergence list as consulted
//   held        `engine/heldWithholds.js`            the held withholds as consulted
//
// Everything else the door's module graph holds is a constant, a registration every graph makes when it
// loads (the same modules load in the worker), or a cache of a pure computation. The build flags
// (`import.meta.env`) are baked into the worker's bundle by the same build.
// ⛔ A page state the door starts reading must join this image, or the worker answers from an empty one:
// `memberDoorOffThread.test.js` builds in a FRESH module graph that holds only this image, and asks for the
// same answer in every state each part carries.
import { runtimeListsImage, applyRuntimeListsImage, runtimeListsRevision } from '../../engine/runtimeKill'
import { runtimePaneEnabled, runtimePaneBuilt } from '../../engine/runtimePaneGate'
import {
  runtimePanePermissionImage, applyRuntimePanePermissionImage, runtimePanePermissionRevision,
} from '../../../../lib/runtimePanePermission'
import { runHalfEvidenceImage, applyRunHalfEvidenceImage, runHalfEvidenceRevision } from '../../engine/runHalfRailSeam'
import { pineLibraryStoreImage, applyPineLibraryStoreImage, pineLibraryStoreRevision } from '../../engine/ast/pineLibraryStore'
import {
  hostKnownDivergenceImage, applyHostKnownDivergenceImage, hostKnownDivergenceRevision,
} from '../../engine/hostKnownDivergence'
import { heldWithholdsImage, applyHeldWithholdsImage, heldWithholdsRevision } from '../../engine/heldWithholds'
import { objectsOnlyPaneEnabled } from '../../engine/objectsOnlyPaneGate'
import { strategyBrokerEnabled } from '../../engine/strategyBrokerGate'
import { lowerTfServingEnabled } from '../../engine/lowerTfGate'

/** ⭐ WHICH STATE A BUILD WAS MADE IN, as one comparable string: every image part's revision (each moves when
 *  its state may have moved) and the build flags the door reads. Two requests for one script share one build
 *  only while this stands (`memberDoorAsync.js`): a list, a verdict, a library or the permission landing in
 *  between makes the next request a new build, as a rebuild on this thread would have been.
 *  (The flags are constants in a built bundle; a rail can stub them, so they are part of the version.) */
export function memberDoorStateVersion() {
  return [
    runtimeListsRevision(), runtimePanePermissionRevision(), runHalfEvidenceRevision(), pineLibraryStoreRevision(),
    hostKnownDivergenceRevision(), heldWithholdsRevision(),
    runtimePaneBuilt() ? 1 : 0, objectsOnlyPaneEnabled() ? 1 : 0, strategyBrokerEnabled() ? 1 : 0,
    lowerTfServingEnabled() ? 1 : 0,
  ].join('.')
}

/** The page's side: this tab's state, as plain data a worker message carries. */
export function memberDoorImage() {
  // ⭐ asked as the door asks it (it does, first, on every build): a server-latched permission past its
  // re-check age re-asks the server from HERE, the page, as a build on this thread would have.
  runtimePaneEnabled()
  return {
    lists: runtimeListsImage(),
    permission: runtimePanePermissionImage(),
    evidence: runHalfEvidenceImage(),
    libraries: pineLibraryStoreImage(),
    hkd: hostKnownDivergenceImage(),
    held: heldWithholdsImage(),
  }
}

/** The worker's side: hold exactly the image's state, every part of it (an absent part is that part as a fresh page holds it). */
export function applyMemberDoorImage(img) {
  const m = img && typeof img === 'object' ? img : {}
  applyRuntimeListsImage(m.lists)
  applyRuntimePanePermissionImage(m.permission)
  applyRunHalfEvidenceImage(m.evidence)
  applyPineLibraryStoreImage(m.libraries)
  applyHostKnownDivergenceImage(m.hkd)
  applyHeldWithholdsImage(m.held)
}
