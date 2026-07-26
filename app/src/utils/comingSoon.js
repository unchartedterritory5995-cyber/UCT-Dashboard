/** Pre-launch mode.
 *
 * When on, the public front door is the COMING SOON holding page and every
 * marketing / account-creation surface redirects to it. Login is deliberately
 * untouched so existing members keep full access throughout.
 *
 * Launch day is one env change (`VITE_COMING_SOON=0` on the frontend,
 * `COMING_SOON_MODE` unset on the backend) — the real Landing page is still
 * mounted at `/landing` and comes straight back at `/`. No code revert.
 *
 * Read once at module load: Vite inlines `import.meta.env` at build time, so
 * this is a build-time constant either way.
 *
 * Routes wrapped in `<PreLaunchGate>` in App.jsx are the gated set: anything
 * that sells the product or opens an account (/landing, /pricing, /compare,
 * /brokers, /signup, /subscribe). Deliberately NOT gated: `/login` (members
 * sign in), `/terms` + `/privacy` (linked from the holding page), the
 * password-reset and email-verify flows (existing members mid-flow), and the
 * token-gated `/r/*` renderers the Morning Wire → Substack pipeline depends on.
 */
export const COMING_SOON = import.meta.env.VITE_COMING_SOON === '1'
