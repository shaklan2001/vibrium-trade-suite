import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { APP_NAME, COMPANY_NAME, LEGAL_CONTACT_EMAIL, SITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy policy — ${APP_NAME}`,
  description: `How ${APP_NAME} accesses, uses, stores and deletes Google user data.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {APP_NAME} ({SITE_URL}) is operated by {COMPANY_NAME} (&quot;we&quot;). It helps
        buying-agency teams turn the trade emails in their own inbox — enquiries, quotes, purchase
        orders, proforma invoices and shipping documents — into a structured deal book. This policy
        explains what data we access when you connect an email account, why, and how you can remove
        it.
      </p>

      <h2>Data we access from Google</h2>
      <p>When you click &quot;Connect Gmail&quot; and approve Google&apos;s consent screen, we request:</p>
      <ul>
        <li>
          <strong>Your email address, name and Google account ID</strong> (<code>openid</code>,{" "}
          <code>email</code>, <code>profile</code>) — to label the connected inbox and tell your
          company&apos;s mail apart from outside parties.
        </li>
        <li>
          <strong>Read-only access to your Gmail messages and attachments</strong> (
          <code>https://www.googleapis.com/auth/gmail.readonly</code>) — to read trade emails and
          their attachments (PDF, spreadsheet and image documents) so we can extract deals from them.
        </li>
      </ul>
      <p>
        Access is read-only. {APP_NAME} cannot send, delete, label or change any email in your
        account.
      </p>

      <h2>How we use Google user data</h2>
      <ul>
        <li>
          We list messages received in the history window you choose (30 days by default), filter out
          newsletters and other non-trade mail, and group the remaining emails into deal threads.
        </li>
        <li>
          Message text and attachments in those threads are processed by our document-extraction
          agents to fill in deal fields such as buyer, factory, products, quantities, prices, PO
          numbers and shipment dates. The results appear only inside your organisation&apos;s{" "}
          {APP_NAME} workspace.
        </li>
        <li>We use the data only to provide and improve these user-facing features.</li>
      </ul>

      <h2>Limited Use disclosure</h2>
      <p>
        {APP_NAME}&apos;s use and transfer to any other app of information received from Google APIs
        will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Specifically, we:
      </p>
      <ul>
        <li>do not sell Google user data;</li>
        <li>do not use or transfer it for advertising, including personalised or retargeted ads;</li>
        <li>do not use it to determine credit-worthiness or for lending purposes;</li>
        <li>
          do not use it to develop, improve or train generalised or non-personalised AI and/or ML
          models;
        </li>
        <li>
          do not allow humans to read it, except with your explicit consent for specific messages
          (for example, to investigate a support request), when needed for security purposes such as
          investigating abuse, to comply with applicable law, or when the data has been aggregated and
          anonymised for internal operations.
        </li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We share Google user data only with service providers that process it on our behalf to run
        {" "}{APP_NAME}: cloud hosting and storage (Vercel, Amazon Web Services) and the AI model
        provider used by our extraction agents. These providers are bound by contract to use the data
        only to provide their service to us, and the AI provider does not use it to train its models.
        We do not otherwise share, sell or transfer Google user data, except where required by law.
      </p>

      <h2>Storage and security</h2>
      <ul>
        <li>All data is encrypted in transit (TLS).</li>
        <li>
          OAuth access and refresh tokens are encrypted at rest with AES-256-GCM and are never sent to
          the browser.
        </li>
        <li>
          Email content, attachments and extracted deals are stored in access-controlled databases and
          storage buckets in our cloud account.
        </li>
      </ul>

      <h2>Retention and deletion</h2>
      <ul>
        <li>
          You can disconnect an inbox at any time from <strong>Mailbox → Email connections</strong>.
          Disconnecting revokes our Google access token and deletes the stored raw email for that
          inbox.
        </li>
        <li>
          You can also revoke access directly at{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </li>
        <li>
          Deal records already extracted remain in your organisation&apos;s deal book until your
          organisation deletes them. To have all data derived from your account deleted, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>; we complete deletion
          within 30 days.
        </li>
      </ul>

      <h2>Other providers</h2>
      <p>
        If you connect Outlook / Microsoft 365 or an IMAP mailbox instead, the same read-only use,
        storage, sharing and deletion rules above apply to that mail.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how we use Google user data, we will update this page and ask for your consent
        again before using the data in a new way.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
