import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { APP_NAME, COMPANY_NAME, LEGAL_CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Terms of service — ${APP_NAME}`,
  description: `Terms for using ${APP_NAME}.`,
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms govern your use of {APP_NAME}, operated by {COMPANY_NAME}. By using the service
        you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        {APP_NAME} turns trade emails and documents from inboxes you connect into a deal book for your
        organisation. Extracted fields are generated automatically and may contain mistakes — check
        them against the source email before relying on them for commercial decisions.
      </p>

      <h2>Your accounts and data</h2>
      <ul>
        <li>Only connect email accounts you are authorised to connect.</li>
        <li>
          You keep ownership of your email and documents. You grant us permission to process them
          only to provide the service, as described in our <Link href="/privacy">privacy policy</Link>.
        </li>
        <li>You can disconnect an inbox and revoke access at any time.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not use the service to break the law, to access mail you are not entitled to, or to
        interfere with the service&apos;s security or availability.
      </p>

      <h2>Availability and liability</h2>
      <p>
        The service is provided &quot;as is&quot;. To the extent the law allows, {COMPANY_NAME} is not
        liable for indirect or consequential losses arising from its use.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will post the new version here. Questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
