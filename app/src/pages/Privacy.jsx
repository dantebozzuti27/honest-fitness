import { useNavigate } from 'react-router-dom'
import HomeButton from '../components/HomeButton'
import BackButton from '../components/BackButton'
import styles from './Privacy.module.css'
import { SUPPORT_EMAIL, SUPPORT_PATH } from '../config/appStore'

export default function Privacy() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <BackButton fallbackPath="/" />
        <h1>Privacy Policy</h1>
        <HomeButton />
      </div>

      <div className={styles.content}>
        <p className={styles.lastUpdated}>Last Updated: December 7, 2025</p>

        <section className={styles.section}>
          <h2>1. Introduction</h2>
          <p>
            HonestFitness ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our fitness tracking application and services.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Information We Collect</h2>
          <h3>2.1 Personal Information</h3>
          <p>We collect information that you provide directly to us, including:</p>
          <ul>
            <li>Email address and password for account creation</li>
            <li>Profile information (username, profile picture)</li>
            <li>Health and fitness data (workouts, nutrition, health metrics)</li>
            <li>User preferences and goals</li>
          </ul>

          <h3>2.2 Health and Fitness Data</h3>
          <p>We collect health and fitness data that you input or that we receive from connected third-party services, including:</p>
          <ul>
            <li>Workout data (exercises, sets, reps, weights, duration)</li>
            <li>Nutrition data (meals, calories, macros)</li>
            <li>Health metrics (steps, sleep, heart rate, HRV, body temperature, weight)</li>
            <li>Data from connected wearable devices (Fitbit, Oura, etc.)</li>
          </ul>

          <h3>2.3 Automatically Collected Information</h3>
          <p>We automatically collect certain information when you use our services:</p>
          <ul>
            <li>Device information (device type, operating system)</li>
            <li>Usage data (features used, time spent, interactions)</li>
            <li>Log data (IP address, access times, error logs)</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, maintain, and improve our services</li>
            <li>Process your transactions and send related information</li>
            <li>Send technical notices, updates, and support messages</li>
            <li>Respond to your comments, questions, and requests</li>
            <li>Monitor and analyze trends, usage, and activities</li>
            <li>Detect, prevent, and address technical issues</li>
            <li>Personalize your experience and provide recommendations</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>4. Data Sharing and Disclosure</h2>
          <p>We do not sell, trade, or rent your personal information to third parties. We may share your information only in the following circumstances:</p>
          <ul>
            <li><strong>Service Providers:</strong> We may share data with third-party service providers who perform services on our behalf (e.g., cloud hosting, analytics)</li>
            <li><strong>Connected Services:</strong> When you connect third-party services (Fitbit, Oura), we share necessary data to enable integration</li>
            <li><strong>Legal Requirements:</strong> We may disclose information if required by law or in response to valid legal requests</li>
            <li><strong>Business Transfers:</strong> In the event of a merger, acquisition, or sale, your information may be transferred</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>5. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the Internet or electronic storage is 100% secure.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. Your Rights and Choices</h2>
          <h3>6.1 Access and Portability</h3>
          <p>You can access and export your data at any time through the "Export All Data" feature in your profile settings.</p>

          <h3>6.2 Deletion</h3>
          <p>You can request deletion of your account and all associated data by using the "Delete Account" feature in your profile settings. This action is irreversible.</p>

          <h3>6.3 Data Retention</h3>
          <p>We retain your data for as long as your account is active or as needed to provide services. We will delete your data within 30 days of account deletion or after 2 years of account inactivity.</p>

          <h3>6.4 California Privacy Rights (CCPA)</h3>
          <p>If you are a California resident, you have the right to:</p>
          <ul>
            <li>Know what personal information is collected</li>
            <li>Know whether your personal information is sold or disclosed</li>
            <li>Opt-out of the sale of personal information (we do not sell your data)</li>
            <li>Access your personal information</li>
            <li>Request deletion of your personal information</li>
            <li>Not be discriminated against for exercising your privacy rights</li>
          </ul>

          <h3>6.5 European Privacy Rights (GDPR)</h3>
          <p>If you are located in the European Economic Area (EEA), you have the right to:</p>
          <ul>
            <li>Access your personal data</li>
            <li>Rectify inaccurate data</li>
            <li>Request erasure ("right to be forgotten")</li>
            <li>Restrict processing</li>
            <li>Data portability</li>
            <li>Object to processing</li>
            <li>Withdraw consent at any time</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>7. Third-Party Services</h2>
          <p>
            Our services integrate with third-party services (Fitbit, Oura) that have their own privacy policies. We encourage you to review their privacy policies to understand how they collect, use, and share your information.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Children's Privacy</h2>
          <p>
            Our services are not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date. You are advised to review this Privacy Policy periodically.
          </p>
        </section>

        <section className={styles.section}>
          <h2>10. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or our data practices, please contact us at <strong>{SUPPORT_EMAIL}</strong> or visit <a href={SUPPORT_PATH}>Support</a>.
          </p>
        </section>
      </div>
    </div>
  )
}

