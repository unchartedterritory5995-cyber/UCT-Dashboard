import { Link } from 'react-router-dom'
import styles from './Legal.module.css'

export default function Privacy() {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>&larr; Back to home</Link>
      <h1 className={styles.heading}>Privacy Policy</h1>
      <p className={styles.subheading}>Last updated: September 23, 2026</p>

      <div className={styles.prose}>
        <h2>1. Information We Collect</h2>

        <h3>Account Information</h3>
        <p>
          When you create an account, we collect your email address, display name,
          and an encrypted hash of your password. We do not store your password in
          plain text.
        </p>

        <h3>Content You Create</h3>
        <p>
          We store what you put into the Service so we can show it back to you: notebook
          notes and their attachments, trade journal entries, watchlists, alerts, settings,
          and any audio you record for dictation or voice features.
        </p>
        <p>
          While you edit a note, the Notebook also keeps a working copy in your browser's
          local storage on your device, so your words survive a lost connection until they
          reach our servers. That copy stays on your device; you can remove it by clearing
          this site's data in your browser.
        </p>

        <h3>Brokerage Data</h3>
        <p>
          If you choose to connect a brokerage account, the connection runs through
          SnapTrade. We receive read-only account data (positions, balances, and
          transactions) so we can import your trades. We never receive or store your
          brokerage login credentials, and the connection key we hold is encrypted at rest.
          You can disconnect at any time from Settings.
        </p>

        <h3>Activity Data</h3>
        <p>
          We record which pages you visit and account activity such as sign-ins (including
          the IP address used). These records are linked to your account and are used for
          security, support, and improving the Service. We do not use them for advertising
          and we do not sell them.
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
          <li>To run the AI features you choose to use, such as asking questions of your notes or getting coaching on your trades</li>
          <li>To send transactional emails (account verification, password resets, billing receipts) and the alerts and digests you turn on</li>
          <li>To improve the Service</li>
          <li>To detect and prevent fraud or abuse</li>
        </ul>
        <p>We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>

        <h2>3. Service Providers</h2>
        <p>We use the following service providers to operate the Service:</p>
        <ul>
          <li><strong>Stripe</strong> — payment processing and subscription management</li>
          <li><strong>Resend</strong> — email delivery (verification, password resets, alerts and digests you turn on)</li>
          <li><strong>Railway</strong> — application hosting; our databases run on Railway</li>
          <li><strong>Cloudflare</strong> — network delivery and security for our website, and storage for backups of our account database (Cloudflare R2)</li>
          <li>
            <strong>Anthropic</strong> — powers our AI features, including Ask Notebook,
            Compass coaching, and trade reviews. When you use one of these features, the
            content it needs (for example, your question and the notes or journal entries
            it draws on) is sent to Anthropic to produce the answer.
          </li>
          <li>
            <strong>OpenAI</strong> — powers voice features: transcribing your dictation,
            voice conversations with Compass, cleaning up transcripts, and searching your
            voice-assistant history. The audio or text involved is sent to OpenAI.
          </li>
          <li>
            <strong>Perplexity</strong> — when you ask Compass to research a question on the
            web, the research question is sent to Perplexity. Your notes and journal are not.
          </li>
          <li><strong>SnapTrade</strong> — brokerage connections, only if you connect a broker</li>
          <li><strong>Sentry</strong> — error monitoring, when enabled</li>
        </ul>
        <p>
          Under their commercial API terms, Anthropic and OpenAI do not use the content we
          send them to train their models. OpenAI may keep API data for up to 30 days to
          monitor for abuse. Each provider has its own privacy policy governing how it
          handles data, and we share only what each one needs to do its job.
        </p>

        <h2>4. Sharing You Control</h2>
        <ul>
          <li>
            <strong>Community sharing</strong> — if you opt in to sharing your journal with
            the community, other members can see your trades and open positions. Share
            counts and dollar profit and loss are never shown.
          </li>
          <li>
            <strong>Note share links</strong> — where available, if you create a share link
            for a note, anyone who has the link can read that note's title, text, and images
            without signing in, until you turn the link off. A shared note does not reveal
            your account, your other notes, or its file attachments.
          </li>
          <li>
            <strong>Alert destinations</strong> — if you send alerts to a service you choose,
            such as a Discord channel, we deliver the alert content there.
          </li>
        </ul>

        <h2>5. Cookies and Local Storage</h2>
        <p>
          We use a single httpOnly session cookie (<code>uct_session</code>) to
          maintain your login state. This cookie is essential for authentication
          and cannot be used for tracking across other websites.
        </p>
        <p>
          We also use your browser's local storage to remember preferences on your device
          and to keep the Notebook working copy described above. We do not use advertising
          cookies, analytics trackers, or any third-party tracking scripts.
        </p>

        <h2>6. Data Retention</h2>
        <ul>
          <li><strong>Account data</strong> — retained as long as your account is active</li>
          <li><strong>Session tokens</strong> — expire after 30 days and are cleaned up automatically</li>
          <li><strong>Your content</strong> (notes, trade journal, watchlists, alerts) — retained until you delete it or your account is deleted</li>
          <li><strong>Activity data</strong> — retained for security and support; you can ask us to delete it</li>
          <li>
            <strong>Backups</strong> — we copy our account database about every six hours and
            keep a rolling set of recent copies. Something you delete can remain in those
            copies for up to 7 days before it is overwritten.
          </li>
          <li><strong>Data sent to AI providers</strong> — kept by the provider only as their terms allow (see Section 3)</li>
        </ul>

        <h2>7. Data Security</h2>
        <p>
          We take reasonable measures to protect your information, including encrypted
          passwords (bcrypt), httpOnly secure cookies, HTTPS-only connections, encrypted
          brokerage connection keys, and rate-limited authentication endpoints. However,
          no method of electronic storage is 100% secure.
        </p>

        <h2>8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data stored by the Service</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your notes, trade journal, and watchlist data</li>
          <li>Disconnect a brokerage account at any time</li>
          <li>Cancel your subscription at any time</li>
        </ul>
        <p>
          You can request account deletion from Settings or by email. We process each
          request by hand and confirm by email once it is done. To exercise any of these
          rights, contact us at{' '}
          <a href="mailto:support@uctintelligence.com">support@uctintelligence.com</a>.
        </p>

        <h2>9. Children's Privacy</h2>
        <p>
          The Service is not intended for use by anyone under the age of 18. We do not
          knowingly collect information from minors.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of
          material changes via email or through the Service. The "Last updated" date at
          the top reflects the most recent revision.
        </p>

        <h2>11. Contact</h2>
        <p>
          For privacy-related questions or requests, contact us at{' '}
          <a href="mailto:support@uctintelligence.com">support@uctintelligence.com</a>.
        </p>
      </div>
    </div>
  )
}
