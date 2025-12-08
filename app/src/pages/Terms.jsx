import { useNavigate } from 'react-router-dom'
import HomeButton from '../components/HomeButton'
import styles from './Terms.module.css'

export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1>Terms of Service</h1>
        <HomeButton />
      </div>

      <div className={styles.content}>
        <p className={styles.lastUpdated}>Last Updated: December 7, 2025</p>

        <section className={styles.section}>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using HonestFitness ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these terms, you may not access the Service.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Description of Service</h2>
          <p>
            HonestFitness is a fitness tracking application that allows users to log workouts, track nutrition, monitor health metrics, and connect with wearable devices. The Service is provided "as is" and "as available."
          </p>
        </section>

        <section className={styles.section}>
          <h2>3. User Accounts</h2>
          <h3>3.1 Account Creation</h3>
          <p>To use the Service, you must:</p>
          <ul>
            <li>Be at least 13 years of age</li>
            <li>Provide accurate, current, and complete information</li>
            <li>Maintain and update your information as necessary</li>
            <li>Maintain the security of your password</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>

          <h3>3.2 Account Responsibility</h3>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
          </p>
        </section>

        <section className={styles.section}>
          <h2>4. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any illegal purpose or in violation of any laws</li>
            <li>Transmit any harmful code, viruses, or malicious software</li>
            <li>Attempt to gain unauthorized access to the Service or related systems</li>
            <li>Interfere with or disrupt the Service or servers</li>
            <li>Use automated systems to access the Service without permission</li>
            <li>Impersonate any person or entity</li>
            <li>Collect or store personal data about other users</li>
            <li>Use the Service to transmit spam or unsolicited communications</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>5. Health and Medical Disclaimer</h2>
          <p>
            <strong>IMPORTANT:</strong> The Service is for informational and tracking purposes only. It is not intended to diagnose, treat, cure, or prevent any disease or medical condition. The Service does not provide medical advice, diagnosis, or treatment.
          </p>
          <p>
            Always consult with a qualified healthcare provider before starting any exercise program, making changes to your diet, or using health data to make medical decisions. Do not disregard professional medical advice or delay seeking it because of information provided by the Service.
          </p>
          <p>
            We are not responsible for any health outcomes or consequences resulting from your use of the Service. You use the Service at your own risk.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. User Content</h2>
          <h3>6.1 Ownership</h3>
          <p>
            You retain ownership of all data and content you submit to the Service. By submitting content, you grant us a license to use, store, and process that content to provide and improve the Service.
          </p>

          <h3>6.2 Content Responsibility</h3>
          <p>
            You are solely responsible for the accuracy and legality of all content you submit. You represent and warrant that you have all necessary rights to submit such content.
          </p>
        </section>

        <section className={styles.section}>
          <h2>7. Third-Party Services</h2>
          <p>
            The Service may integrate with third-party services (Fitbit, Oura, etc.). Your use of these services is subject to their respective terms of service and privacy policies. We are not responsible for the availability, accuracy, or practices of third-party services.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Intellectual Property</h2>
          <p>
            The Service and its original content, features, and functionality are owned by HonestFitness and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Service Availability</h2>
          <p>
            We strive to provide reliable service but do not guarantee that the Service will be available at all times, uninterrupted, or error-free. We reserve the right to modify, suspend, or discontinue the Service at any time with or without notice.
          </p>
        </section>

        <section className={styles.section}>
          <h2>10. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, HONESTFITNESS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF THE SERVICE.
          </p>
        </section>

        <section className={styles.section}>
          <h2>11. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless HonestFitness, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising out of your use of the Service, violation of these Terms, or infringement of any rights of another.
          </p>
        </section>

        <section className={styles.section}>
          <h2>12. Termination</h2>
          <p>
            We may terminate or suspend your account and access to the Service immediately, without prior notice, for any reason, including breach of these Terms. Upon termination, your right to use the Service will cease immediately.
          </p>
          <p>
            You may terminate your account at any time by using the account deletion feature in your profile settings.
          </p>
        </section>

        <section className={styles.section}>
          <h2>13. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify users of material changes by posting the updated Terms on this page and updating the "Last Updated" date. Your continued use of the Service after changes constitutes acceptance of the new Terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2>14. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which HonestFitness operates, without regard to its conflict of law provisions.
          </p>
        </section>

        <section className={styles.section}>
          <h2>15. Contact Information</h2>
          <p>
            If you have any questions about these Terms, please contact us through your profile settings or by email.
          </p>
        </section>
      </div>
    </div>
  )
}

