// Wave 9 (Task 9.17): the catalog with routines and trackers in it, for the builder's tests. Tests only.
//
// `toolCatalog.json` is GENERATED from the merged router (since the be->impl merge): it is
// `notebook_widget_definitions._static_vocabulary(tools=True)`, written by
// `tests/test_widget_definitions_router.py::write_vocabulary_fixture` beside `serverCatalog.json` and railed current by
// `test_builder_server_catalog_fixture_is_current`. The two tool sentences are the router's own `reasons`
// (`one_ref` = plan.S_ONE_REF, `unknown_range` = plan.S_UNKNOWN_RANGE), read from it, never retyped.
import TOOL from './toolCatalog.json'

export const S_ONE_REF = TOOL.reasons.one_ref
export const S_UNKNOWN_RANGE = TOOL.reasons.unknown_range

/** The catalog wave 9 serves. */
export const TOOL_CATALOG = TOOL

// The member's routines and trackers as `GET /vocabulary?field=routine|tracker` answers them
// (`_member_values`: `{id, name}`, a routine id a uuid4; the tracker list leads with the check-in built-ins).
export const R1 = '11111111-1111-4111-8111-111111111111'
export const R2 = '22222222-2222-4222-8222-222222222222'
export const T1 = '33333333-3333-4333-8333-333333333333'
export const ROUTINES = [{ id: R1, name: 'Morning prep' }, { id: R2, name: 'Post-market review' }]
export const TRACKERS = [
  { id: 'checkin:mood', name: 'Check-in mood' }, { id: 'checkin:focus', name: 'Check-in focus' },
  { id: T1, name: 'Sleep' },
]
