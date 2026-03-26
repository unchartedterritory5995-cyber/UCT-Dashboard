import { Link } from 'react-router-dom'
import styles from './Legal.module.css'

export default function Privacy() {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>&larr; Back to home</Link>
      <h1 className={styles.heading}>Privacy Policy</h1>
      <p className={styles.subheading}>Last updated: March 26, 2026</p>

      <div className={styles.prose}>
        <h2>1. Information We Collect</h2>

        <h3>Account Information</h3>
        <p>
          When you create an account, we collect your email address, display name,
          and an encrypted hash of your password. We do not store your password in
          plain text.
        </p>

        <h3>Usage Data</h3>
        <p>
          We collect anonymized usage data such as pages visited, features used,
          and session duration to improve the Service. This data is not tied to
          your identity and is used solely for product improvement.
        </p>

        <h3>Payment Information</h3>
        <p>
          Payment processing is handled entirely by Stripe. We do not store your
          credit card number, bank account, or other payment credentials on our
          servers. We receive only a Stripe customer ID and subscription status.
        </p>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To provide and maintain the Service</li>
          <li>To manage your account and subscription</li>
          <li>To send transactional emails (account verification, password resets, billing receipts)</li>
          <li>To improve the Service based on aggregated usage patterns</li>
          <li>To detect and prevent fraud or abuse</li>
        </ul>
        <p>We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>

        <h2>3. Third-Party Services</h2>
        <p>We use the following third-party services to operate:</p>
        <ul>
          <li><strong>Stripe</strong> — payment processing and subscription management</li>
          <li><strong>Resend</strong> — transactional email delivery (verification, password resets, welcome emails)</li>
          <li><strong>Railway</strong> — application hosting and infrastructure</li>
          <li><strong>Sentry</strong> — error monitoring and performance tracking (no personal data transmitted)</li>
        </ul>
        <p>
          Each of these services has their own privacy policy governing how they handle data.
          We only share the minimum data necessary for each service to function.
        </p>

        <h2>4. Cookies</h2>
        <p>
          We use a single httpOnly session cookie (<code>uct_session</code>) to
          maintain your login state. This cookie is essential for authentication
          and cannot be used for tracking across other websites.
        </p>
        <p>
          We do not use advertising cookies, analytics trackers, or any third-party
          tracking scripts.
        </p>

        <h2>5. Data Retention</h2>
        <ul>
          <li><strong>Account data</strong> — retained as long as your account is active</li>
          <li><strong>Session tokens</strong> — expire after 30 days and are cleaned up automatically</li>
          <li><strong>Trade journal and watchlists</strong> — retained as long as your account is active; deleted upon account deletion</li>
          <li><strong>Usage data</strong> — anonymized and aggregated; individual records purged after 90 days</li>
        </ul>

        <h2>6. Data Security</h2>
        <p>
          We take reasonable measures to protect your information, including encrypted
          passwords (bcrypt), httpOnly secure cookies, HTTPS-only connections, and
          rate-limited authentication endpoints. However, no method of electronic
          storage is 100% secure.
        </p>

        <h2>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data stored by the Service</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your trade journal and watchlist data</li>
          <li>Cancel your subscription at any time</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:support@uctintelligence.com">support@uctintelligence.com</a>.
        </p>

        <h2>8. Children's Privacy</h2>
        <p>
          The Service is not intended for use by anyone under the age of 18. We do not
          knowingly collect information from minors.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of
          material changes via email or through the Service. The "Last updated" date at
          the top reflects the most recent revision.
        </p>

        <h2>10. Contact</h2>
        <p>
          For privacy-related questions or requests, contact us at{' '}
          <a href="mailto:support@uctintelligence.com">support@uctintelligence.com</a>.
        </p>
      </div>
    </div>
  )
}
