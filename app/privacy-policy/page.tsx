import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | BisherTalks",
  description: "Privacy Policy for BisherTalks and Neuro Code book store.",
};

const LAST_UPDATED = "March 29, 2026";
const CONTACT_EMAIL = "support@bishertalks.com";
const SITE_URL = "https://bishertalks.com";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/"
            className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition-colors"
          >
            ← BisherTalks
          </Link>
          <h1 className="text-3xl font-black mt-4 mb-2">Privacy Policy</h1>
          <p className="text-neutral-500 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-neutral-700 dark:text-neutral-300 leading-relaxed">

          <section>
            <p>
              This Privacy Policy describes how <strong>BisherTalks</strong> (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;),
              operated by Bisher KC, collects, uses, and protects information when you visit{" "}
              <strong>{SITE_URL}</strong> or purchase the <strong>Neuro Code</strong> book through our website.
            </p>
            <p>
              By using our website or placing an order, you agree to the practices described in this policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">1. Information We Collect</h2>
            <h3 className="font-semibold mb-2">1.1 Information you provide directly</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li><strong>Full name</strong> — used to address your order and communications</li>
              <li><strong>WhatsApp/phone number</strong> — used to send order updates via WhatsApp</li>
              <li><strong>Email address</strong> (optional) — used for order receipts</li>
              <li><strong>Shipping address</strong> (address, city, state, pincode) — used to deliver your physical book</li>
            </ul>

            <h3 className="font-semibold mt-4 mb-2">1.2 Payment information</h3>
            <p className="text-sm">
              Payments are processed by <strong>Razorpay</strong>. We do <strong>not</strong> store your card
              number, CVV, or UPI credentials. Razorpay collects and secures this data directly.
              We receive only a payment ID and order confirmation to fulfil your order.
              Razorpay&apos;s Privacy Policy:{" "}
              <a
                href="https://razorpay.com/privacy/"
                className="text-primary-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                razorpay.com/privacy
              </a>
            </p>

            <h3 className="font-semibold mt-4 mb-2">1.3 WhatsApp communication data</h3>
            <p className="text-sm">
              We use the <strong>WhatsApp Business API</strong> (via Meta) to send order confirmation,
              shipping, and delivery notifications to your phone number. By providing your phone number
              at checkout, you consent to receiving these transactional messages. We do not use your
              number for marketing without your explicit consent.
              Meta&apos;s Privacy Policy:{" "}
              <a
                href="https://www.facebook.com/policy.php"
                className="text-primary-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                facebook.com/policy.php
              </a>
            </p>

            <h3 className="font-semibold mt-4 mb-2">1.4 Automatically collected information</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>Browser type and device information</li>
              <li>Pages visited and time spent (via anonymous analytics)</li>
              <li>IP address (for security and fraud prevention)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>To process and fulfil your book order</li>
              <li>To send order confirmations, shipping updates, and delivery notifications via WhatsApp</li>
              <li>To send email receipts (if email provided)</li>
              <li>To respond to customer support queries</li>
              <li>To prevent fraud and ensure payment security</li>
              <li>To comply with legal obligations</li>
            </ul>
            <p className="text-sm mt-3">
              We do <strong>not</strong> sell, rent, or trade your personal information to third parties
              for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">3. Data Storage & Security</h2>
            <p className="text-sm">
              Order data is stored securely using <strong>Supabase</strong> (PostgreSQL), hosted on
              enterprise-grade infrastructure. Access is restricted to authorised personnel only.
              We use industry-standard encryption (HTTPS/TLS) for all data transmission.
            </p>
            <p className="text-sm">
              While we take reasonable precautions, no internet transmission is 100% secure. We encourage
              you to contact us immediately if you suspect any unauthorised access to your data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">4. Third-Party Services</h2>
            <p className="text-sm">We share your data with the following trusted third parties only as necessary to fulfil your order:</p>
            <ul className="list-disc pl-5 space-y-2 text-sm mt-2">
              <li>
                <strong>Razorpay</strong> — payment processing. Governed by{" "}
                <a href="https://razorpay.com/privacy/" className="text-primary-500 hover:underline" target="_blank" rel="noopener noreferrer">Razorpay&apos;s Privacy Policy</a>
              </li>
              <li>
                <strong>Meta (WhatsApp Business API)</strong> — delivery of order notification messages.
                Governed by{" "}
                <a href="https://www.facebook.com/policy.php" className="text-primary-500 hover:underline" target="_blank" rel="noopener noreferrer">Meta&apos;s Privacy Policy</a>
              </li>
              <li>
                <strong>Courier partners</strong> — your name and shipping address are shared with the
                courier to deliver your book
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">5. Cookies</h2>
            <p className="text-sm">
              Our website uses minimal cookies for essential functionality (such as theme preference).
              We do not use tracking or advertising cookies. You can disable cookies in your browser
              settings, though some features may not function correctly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">6. Data Retention</h2>
            <p className="text-sm">
              We retain order data (name, address, payment reference) for a minimum of 3 years
              for legal and accounting purposes. You may request deletion of your personal data
              (where not required by law) by contacting us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-500 hover:underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">7. Your Rights</h2>
            <p className="text-sm">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data (subject to legal requirements)</li>
              <li>Opt out of WhatsApp notifications by replying STOP</li>
            </ul>
            <p className="text-sm mt-2">
              To exercise any of these rights, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-500 hover:underline">
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">8. Children&apos;s Privacy</h2>
            <p className="text-sm">
              Our website and services are not directed at children under the age of 13. We do not
              knowingly collect personal information from children. If you believe we have
              inadvertently collected such data, please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">9. Changes to This Policy</h2>
            <p className="text-sm">
              We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date at the
              top of this page will reflect any changes. Continued use of our website after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">10. Contact Us</h2>
            <p className="text-sm">
              If you have questions about this Privacy Policy or our data practices, please contact:
            </p>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-xl p-4 mt-3 text-sm space-y-1">
              <p><strong>Bisher KC</strong></p>
              <p>BisherTalks</p>
              <p>Kerala, India</p>
              <p>
                Email:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-500 hover:underline">
                  {CONTACT_EMAIL}
                </a>
              </p>
              <p>
                Website:{" "}
                <a href={SITE_URL} className="text-primary-500 hover:underline">
                  {SITE_URL}
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
