import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service & Refund Policy | BisherTalks",
  description:
    "Terms of Service, Refund Policy and Cancellation Policy for BisherTalks and the Neuro Code book store.",
};

const LAST_UPDATED = "March 29, 2026";
const CONTACT_EMAIL = "support@bishertalks.com";
const SITE_URL = "https://bishertalks.com";

export default function TermsPage() {
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
          <h1 className="text-3xl font-black mt-4 mb-2">Terms of Service</h1>
          <p className="text-neutral-500 text-sm">
            Includes Refund Policy & Cancellation Policy · Last updated: {LAST_UPDATED}
          </p>
        </div>

        <div className="space-y-8 text-neutral-700 dark:text-neutral-300 leading-relaxed">

          <section>
            <p className="text-sm">
              These Terms of Service (&quot;Terms&quot;) govern your use of{" "}
              <strong>{SITE_URL}</strong> and any purchase made through our website, operated by{" "}
              <strong>Bisher KC</strong> (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;). By accessing our website or
              placing an order, you agree to be bound by these Terms.
            </p>
          </section>

          {/* ── TERMS OF USE ── */}
          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              1. Use of Website
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>
                You must be at least 18 years old (or have parental consent) to make a
                purchase on this website.
              </li>
              <li>
                You agree not to misuse the website, attempt unauthorised access, or use
                it for any unlawful purpose.
              </li>
              <li>
                All content on this website — including text, images, and course material —
                is the intellectual property of Bisher KC and may not be reproduced without
                written permission.
              </li>
              <li>
                We reserve the right to modify, suspend, or discontinue any part of the
                website at any time without notice.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              2. Products & Orders
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>
                All prices are listed in <strong>Indian Rupees (INR)</strong> and are
                inclusive of applicable taxes.
              </li>
              <li>
                We reserve the right to change product prices or discontinue products at
                any time.
              </li>
              <li>
                Placing an order does not guarantee fulfilment. We may cancel orders at
                our discretion (e.g. due to stock issues or payment failure) and will
                issue a full refund in such cases.
              </li>
              <li>
                Order confirmation is sent via WhatsApp to the number you provide at
                checkout.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              3. Payments
            </h2>
            <p className="text-sm">
              All payments are processed securely by{" "}
              <strong>Razorpay Payment Solutions Pvt. Ltd.</strong> We accept UPI, debit
              cards, credit cards, net banking, and wallets. By completing a payment, you
              agree to{" "}
              <a
                href="https://razorpay.com/terms/"
                className="text-primary-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Razorpay&apos;s Terms of Service
              </a>
              .
            </p>
            <p className="text-sm mt-2">
              We do not store your card or UPI details. All payment data is handled by
              Razorpay in compliance with PCI-DSS standards.
            </p>
          </section>

          {/* ── REFUND POLICY ── */}
          <div className="border border-primary-200 dark:border-primary-900/40 bg-primary-50 dark:bg-primary-900/10 rounded-2xl p-6">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
              4. Refund & Cancellation Policy
            </h2>

            <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
              4.1 Order Cancellation
            </h3>
            <ul className="list-disc pl-5 space-y-2 text-sm mb-4">
              <li>
                You may cancel your order within <strong>24 hours of payment</strong> by
                contacting us at{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-primary-500 hover:underline"
                >
                  {CONTACT_EMAIL}
                </a>{" "}
                with your order number.
              </li>
              <li>
                Once the book has been <strong>dispatched</strong>, cancellation is not
                possible. Please ensure the shipping address is correct before payment.
              </li>
            </ul>

            <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
              4.2 Refund Eligibility
            </h3>
            <p className="text-sm mb-2">We offer a full refund in the following cases:</p>
            <ul className="list-disc pl-5 space-y-2 text-sm mb-4">
              <li>
                <strong>Damaged book received</strong> — if the book arrives damaged or
                defective, we will replace it or issue a full refund. Photo evidence of
                damage must be emailed to us within <strong>48 hours of delivery</strong>.
              </li>
              <li>
                <strong>Wrong item delivered</strong> — if you receive a different product
                than ordered.
              </li>
              <li>
                <strong>Non-delivery</strong> — if the book does not arrive within
                <strong> 15 business days</strong> of the estimated delivery date and
                tracking confirms non-delivery.
              </li>
              <li>
                <strong>Order cancelled by us</strong> — if we are unable to fulfil your
                order for any reason.
              </li>
            </ul>

            <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
              4.3 Non-Refundable Situations
            </h3>
            <ul className="list-disc pl-5 space-y-2 text-sm mb-4">
              <li>Change of mind after the book has been dispatched</li>
              <li>Incorrect shipping address provided by the customer</li>
              <li>Order not accepted at delivery (RTO)</li>
              <li>Digital products (if applicable) once accessed or downloaded</li>
            </ul>

            <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 mb-2">
              4.4 Refund Process
            </h3>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>
                Approved refunds are processed within{" "}
                <strong>5–7 business days</strong> to the original payment method via
                Razorpay.
              </li>
              <li>
                Razorpay may take an additional 3–5 business days to credit the amount
                to your bank account or card, depending on your bank.
              </li>
              <li>
                To request a refund, email us at{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-primary-500 hover:underline"
                >
                  {CONTACT_EMAIL}
                </a>{" "}
                with your order number and reason.
              </li>
            </ul>
          </div>

          {/* ── SHIPPING ── */}
          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              5. Shipping Policy
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>
                We currently ship <strong>within India only</strong>.
              </li>
              <li>
                Standard delivery takes <strong>5–7 business days</strong> from dispatch.
                Delivery to remote areas may take longer.
              </li>
              <li>
                Tracking information is sent via WhatsApp once the order is dispatched.
              </li>
              <li>
                Shipping is <strong>free</strong> on all book orders.
              </li>
              <li>
                We are not responsible for delays caused by the courier partner or
                circumstances beyond our control (natural disasters, strikes, etc.).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              6. Intellectual Property
            </h2>
            <p className="text-sm">
              The content of the <strong>Neuro Code</strong> book and all materials on
              this website are protected by copyright. You may not reproduce, distribute,
              or create derivative works without written permission from Bisher KC.
              Personal use and sharing for non-commercial purposes is permitted with
              attribution.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              7. Limitation of Liability
            </h2>
            <p className="text-sm">
              To the maximum extent permitted by law, BisherTalks shall not be liable for
              any indirect, incidental, or consequential damages arising from your use of
              our website or products. Our total liability for any claim shall not exceed
              the amount paid for the specific order in question.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              8. Governing Law
            </h2>
            <p className="text-sm">
              These Terms are governed by the laws of <strong>India</strong>. Any disputes
              shall be subject to the exclusive jurisdiction of the courts in{" "}
              <strong>Kerala, India</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              9. Changes to These Terms
            </h2>
            <p className="text-sm">
              We reserve the right to update these Terms at any time. The &quot;Last
              updated&quot; date reflects the most recent revision. Continued use of the
              website after changes constitutes your acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
              10. Contact Us
            </h2>
            <p className="text-sm">For any queries regarding these Terms:</p>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-xl p-4 mt-3 text-sm space-y-1">
              <p><strong>Bisher KC</strong></p>
              <p>BisherTalks</p>
              <p>Kerala, India</p>
              <p>
                Email:{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-primary-500 hover:underline"
                >
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

          {/* Related links */}
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-6 flex gap-4 text-sm">
            <Link href="/privacy-policy" className="text-primary-500 hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-primary-500 hover:underline">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
