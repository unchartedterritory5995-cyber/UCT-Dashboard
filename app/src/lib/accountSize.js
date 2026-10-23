// The one client copy of the unset account size (Round B fix 1). The value lives in
// constants/accountSizeDefault.json, which tests/test_account_size_authority.py pins to the server's
// voice_position_sizing.UNSET_ACCOUNT_SIZE, so the two cannot drift.
import DEFAULTS from '../constants/accountSizeDefault.json'

export const UNSET_ACCOUNT_SIZE = DEFAULTS.unsetAccountSize

/** The size a Journal surface computes on: the member's own, or the server's default when the
 *  settings payload says the size is unset (accountSizeIsDefault, the server's one predicate). */
export function resolvedAccountSize(settings) {
  if (!settings) return 0
  if (settings.accountSizeIsDefault === true) return Number(settings.defaultAccountSize) || UNSET_ACCOUNT_SIZE
  return Number(settings.accountSize) || 0
}
