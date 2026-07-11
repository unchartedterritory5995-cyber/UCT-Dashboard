/**
 * Accounts surface — renders the existing Accounts tab. NOT a primary-nav item
 * (Accounts is reachable via the header/overflow → `/journal/accounts`, folded
 * in A5); the route resolves so links keep working. The canonical
 * account-management home (broker + goals + comparison) is built in B6.
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
