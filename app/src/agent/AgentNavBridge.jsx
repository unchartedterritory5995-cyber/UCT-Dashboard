// The router's own navigate(), handed to UCT Agent's host by ref. Mounted only inside a
// router (ChartsWorkspace renders it behind useInRouterContext), so the workspace itself
// never calls a router hook — it is also rendered outside one (tests, pop-outs).
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AgentNavBridge({ navRef }) {
  const navigate = useNavigate()
  useEffect(() => {
    navRef.current = navigate
    return () => { if (navRef.current === navigate) navRef.current = null }
  }, [navigate, navRef])
  return null
}
