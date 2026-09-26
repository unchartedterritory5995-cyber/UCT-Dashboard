import { Link } from 'react-router-dom'
import styles from './Legal.module.css'

export default function Terms() {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>&larr; Back to home</Link>
      <h1 className={styles.heading}>Terms of Service</h1>
      <p className={styles.subheading}>Last updated: September 23, 2026</p>

      <div className={styles.prose}>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using UCT Intelligence ("the Service"), operated by UCT Intelligence LLC
          ("we", "us", "our"), you agree to be bound by these Terms of Service. If you do not agree
          to these terms, do not use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          UCT Intelligence provides market analysis tools, data visualizations, and
          AI-generated trading intelligence for informational and educational purposes.
          The Service includes features such as the Morning Wire, UCT 20 portfolio tracker,
          breadth monitor, scanner, theme tracker, trade journal, research notebook, and
          related tools.
        </p>
        <p>
          The Service is not a registered investment advisor, broker-dealer, or financial planner.
          Nothing provided by the Service constitutes personalized investment advice or a
          recommendation to buy, sell, or hold any security.
        </p>

        <h2>3. User Accounts</h2>
        <p>
          You must provide accurate and complete information when creating an account. You are
          responsible for maintaining the confidentiality of your login credentials and for all
          activity under your account. You must notify us immediately of any unauthorized use.
        </p>
        <p>
          Accounts are for individual use only. Sharing login credentials or redistributing
          content from the Service to third parties is prohibited.
        </p>

        <h2>4. Payment and Refunds</h2>
        <p>
          Paid subscriptions are billed monthly or annually through Stripe. By subscribing, you
          authorize recurring charges to your payment method. You may cancel at any time through
          your account settings; cancellation takes effect at the end of the current billing period.
        </p>
        <p>
          New subscriptions include a 7-day free trial. A valid payment method is required to
          start the trial; your card is not charged until the trial ends. Cancel at any time
          before the trial ends and you will not be charged. All charges are final and
          non-refundable — the trial period is provided so you can evaluate the full Service
          before any charge occurs.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          Except for Your Content (below), all content, data, analysis, and software provided
          through the Service is owned by UCT Intelligence LLC or its licensors and protected by
          copyright and intellectual property laws. You may not reproduce, distribute, modify,
          or create derivative works from any of it without prior written consent.
        </p>
        <p>
          Market data, fundamentals, news, and other information in the Service come in part
          from third-party providers under license. That data is for your personal use within
          the Service only and may not be redistributed, resold, or extracted.
        </p>

        <h3>Your Content</h3>
        <p>
          You keep ownership of what you create in the Service, including your notes,
          attachments, trade journal entries, and watchlists ("Your Content"). You give us a
          limited license to store, process, display, and transmit Your Content only as
          needed to provide the Service to you. That includes sending it to the service
          providers listed in our <Link to="/privacy">Privacy Policy</Link> when you use a
          feature that needs them, such as an AI feature.
        </p>
        <p>
          You are responsible for Your Content and must have the right to upload it. Do not
          upload material that infringes someone else's rights or that you are not allowed
          to share.
        </p>

        <h3>Sharing</h3>
        <p>
          Some features let you share Your Content, such as sharing your journal with the
          community or creating a share link for a note. Anyone who has a share link can view
          the shared note until you turn the link off. You are responsible for what you
          choose to share. We may disable a share link that breaks these terms.
        </p>

        <h2>6. Disclaimer of Warranties</h2>
        <p>
          The Service is provided "as is" and "as available" without warranties of any kind,
          either express or implied. We do not guarantee the accuracy, completeness, or
          timeliness of any data or analysis. Market data may be delayed or contain errors.
        </p>
        <p>
          Past performance of any strategy, portfolio, or signal discussed on the Service
          is not indicative of future results. Trading involves substantial risk of loss.
        </p>

        <h3>AI-Generated Content</h3>
        <p>
          Some features use artificial intelligence to generate answers, summaries, coaching,
          and other content. AI-generated content can be wrong or incomplete, even when it
          cites your own notes or market data. It is provided for informational and
          educational purposes only, is not investment advice, and should be checked before
          you rely on it.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, UCT Intelligence LLC shall not be liable
          for any indirect, incidental, special, consequential, or punitive damages, including
          but not limited to loss of profits, data, or trading losses, arising from your use
          of the Service.
        </p>
        <p>
          Our total liability for any claim arising from these terms or the Service shall
          not exceed the amount you paid us in the 12 months preceding the claim.
        </p>

        <h2>8. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Attempt to reverse engineer, scrape, or extract data from the Service</li>
          <li>Interfere with or disrupt the Service or its infrastructure</li>
          <li>Share your account credentials or redistribute Service content (other than Your Content)</li>
          <li>Use automated tools to access the Service without authorization</li>
        </ul>

        <h2>9. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your account at any time for violation
          of these terms or for any other reason at our sole discretion. Upon termination,
          your right to access the Service ceases immediately. You may export Your Content
          before you close your account.
        </p>

        <h2>10. Changes to Terms</h2>
        <p>
          We may update these terms from time to time. We will notify you of material changes
          via email or through the Service. Continued use of the Service after changes
          constitutes acceptance of the updated terms.
        </p>

        <h2>11. Governing Law</h2>
        <p>
          These terms are governed by the laws of the State of Texas, without regard to
          conflict of law principles. Any disputes shall be resolved in the courts located
          in Texas.
        </p>

        <h2>12. Contact</h2>
        <p>
          Questions about these terms may be directed to{' '}
          <a href="mailto:support@uctintelligence.com">support@uctintelligence.com</a>.
        </p>

        <h2>13. Third-Party Data — FRED&reg; API</h2>
        <p>
          This product uses the FRED&reg; API but is not endorsed or certified by the
          Federal Reserve Bank of St. Louis.
        </p>
        <p>
          Economic data displayed through the Service may be sourced from the Federal
          Reserve Bank of St. Louis's FRED&reg; (Federal Reserve Economic Data) service,
          subject to FRED's own{' '}
          <a
            href="https://fred.stlouisfed.org/docs/api/terms_of_use.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms of Use
          </a>
          . Your use of any FRED-derived feature within the Service is subject to those
          terms in addition to this Agreement.
        </p>
      </div>
    </div>
  )
}
