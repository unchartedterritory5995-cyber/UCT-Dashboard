/**
 * Accounts surface — the canonical account-management home (B6). Renders the
 * Accounts tab, which now assembles the full home: account list (create/select/
 * delete) · Brokerage Connection (broker connect/disconnect + dup review, via
 * BrokerConnectionsCard) · Goals (GoalProgress) · Account Comparison. NOT a
 * primary-nav item (reachable via the header/overflow → `/journal/accounts`,
 * folded in A5); the route resolves so links keep working.
 *
 * Self-contained "+ New account" flow so the route works standalone (JournalLayout's
 * AccountSelector owns the header-level one).
 */

import { useState } from 'react'
import AccountsTab from '../tabs/AccountsTab'
import NewAccountModal from '../components/accounts/NewAccountModal'

export default function AccountsSurface() {
  const [showNewAccount, setShowNewAccount] = useState(false)
  return (
    <>
      <AccountsTab onNewAccount={() => setShowNewAccount(true)} />
      {showNewAccount && <NewAccountModal onClose={() => setShowNewAccount(false)} />}
    </>
  )
}
