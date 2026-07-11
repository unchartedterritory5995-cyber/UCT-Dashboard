/**
 * Verified brokers — the code-config source of truth for the public
 * /brokers "Verified Sync" page.
 *
 * HONEST-VOICE LAW: list ONLY brokers we have personally confirmed on a REAL,
 * live brokerage account. Never badge a broker we haven't verified. Robinhood
 * is the one broker verified end-to-end so far; SnapTrade connects 30+ more,
 * but each is verified on a real account BEFORE it earns an entry here.
 *
 * TO ADD A BROKER (owner, as you verify more):
 *   append an entry below. Keep it factual:
 *     - `name`         the brokerage's display name.
 *     - `verifiedDate` ISO 'YYYY-MM-DD' — the day you confirmed it on a real
 *                      account (rendered as "Mon D, YYYY" on the page).
 *     - `notes`        a short capability line, e.g. what imports + how it
 *                      reconciles. No marketing — just what you actually saw work.
 *   Example:
 *     { name: 'Fidelity', verifiedDate: '2026-07-20',
 *       notes: 'Equities + options · full history · nightly reconcile' },
 */
export const VERIFIED_BROKERS = [
  {
    name: 'Robinhood',
    verifiedDate: '2026-07-02',
    notes: 'Equities + options · full history · nightly reconcile',
  },
]
