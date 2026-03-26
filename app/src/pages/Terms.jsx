import { Link } from 'react-router-dom'
import styles from './Legal.module.css'

export default function Terms() {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>&larr; Back to home</Link>
      <h1 className={styles.heading}>Terms of Service</h1>
      <p className={styles.subheading}>Last updated: March 26, 2026</p>

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
          breadth monitor, scanner, theme tracker, and related tools.
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
          Paid subscriptions are billed monthly through Stripe. By subscribing, you authorize
          recurring charges to your payment method. You may cancel at any time through your
          account settings; cancellation takes effect at the end of the current billing period.
        </p>
        <p>
          Refunds may be issued at our discretion within 7 days of the initial subscription
          charge. No refunds are provided for partial months or after the 7-day window.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          All content, data, analysis, and software provided through the Service is owned by
          UCT Intelligence LLC and protected by copyright and intellectual property laws.
          You may not reproduce, distribute, modify, or create derivative works from any
          content without prior written consent.
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
          <li>Share your account credentials or redistribute Service content</li>
          <li>Use automated tools to access the Service without authorization</li>
        </ul>

        <h2>9. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your account at any time for violation
          of these terms or for any other reason at our sole discretion. Upon termination,
          your right to access the Service ceases immediately.
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
      </div>
    </div>
  )
}
