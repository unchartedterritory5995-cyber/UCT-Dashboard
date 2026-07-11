/**
 * Community surface — renders the existing Community tab. NOT a primary-nav
 * item (Community moves to the header/overflow in A5); the route still exists +
 * resolves so links keep working. Thin wrapper.
 */

import CommunityTab from '../tabs/CommunityTab'

export default function CommunitySurface() {
  return <CommunityTab />
}
