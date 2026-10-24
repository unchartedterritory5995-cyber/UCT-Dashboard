// The one client copy of the unset account size (Round B fix 1) and of the sentence a surface
// shows on it (Round B fix 3, R2-3). Both live in constants/accountSizeDefault.json, which
// tests/test_account_size_authority.py pins to the server's voice_position_sizing.UNSET_ACCOUNT_SIZE
// and default_size_sentence(), so neither can drift.
import DEFAULTS from '../constants/accountSizeDefault.json'

export const UNSET_ACCOUNT_SIZE = DEFAULTS.unsetAccountSize
export const DEFAULT_SIZE_SENTENCE = DEFAULTS.defaultSizeSentence

/** The size a Journal surface computes on: the member's own, or the server's default when the
 *  settings payload says the size is unset (accountSizeIsDefault, the server's one predicate). */
export function resolvedAccountSize(settings) {
  if (!settings) return 0
  if (settings.accountSizeIsDefault === true) return Number(settings.defaultAccountSize) || UNSET_ACCOUNT_SIZE
  return Number(settings.accountSize) || 0
}
