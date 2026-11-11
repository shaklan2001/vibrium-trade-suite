import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { APP_NAME, COMPANY_NAME, LEGAL_CONTACT_EMAIL, SITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy policy — ${APP_NAME}`,
  description: `How ${APP_NAME} reads, stores, sends and deletes mail from connected mailboxes.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {APP_NAME} ({SITE_URL}) is operated by {COMPANY_NAME} (&quot;we&quot;). It helps
        buying-agency teams turn the trade emails in their mailboxes — enquiries, quotes, purchase
        orders, proforma invoices and shipping documents — into a structured deal book and a shared
        team inbox. This policy explains what we access when a mailbox is connected, why, and how
        to remove it.
      </p>

      <h2>What we access</h2>
      <p>
        A team member connects a mailbox with its email address and password. We then use the
        standard mail protocols of that mailbox&apos;s own server:
      </p>
      <ul>
        <li>
          <strong>IMAP (read)</strong> — the Inbox and Sent folders: senders, recipients, subjects,
          dates, message text and attachments.
        </li>
        <li>
          <strong>SMTP (send)</strong> — used only when a person reviews a drafted reply and clicks
          Send. A copy is filed in the mailbox&apos;s Sent folder. &quot;Save to Drafts&quot; files
          the reply in the Drafts folder instead. Nothing is ever sent automatically.
        </li>
      </ul>
      <p>We do not delete, move or change existing mail.</p>

      <h2>How we use it</h2>
      <ul>
        <li>
          To show every connected mailbox in one shared inbox for the team that connected it.
        </li>
        <li>
          To group trade emails into deal threads and have our document-extraction agents fill in
          deal fields such as buyer, factory, products, quantities, prices, PO numbers and shipment
          dates.
        </li>
        <li>To draft replies for a person to review, edit and send.</li>
      </ul>
      <p>
        We do not sell mail data, use it for advertising, or use it to train generalised AI models.
      </p>

      <h2>Sharing</h2>
      <p>
        Mail data is processed only by service providers that run {APP_NAME} on our behalf: cloud
        hosting, database and file storage (Vercel, Amazon Web Services) and the AI model provider
        used by our agents, which does not use it to train its models. We do not otherwise share it,
        except where required by law.
      </p>

      <h2>Storage and security</h2>
      <ul>
        <li>All connections to mail servers and to {APP_NAME} use TLS.</li>
        <li>
          Mailbox passwords are encrypted at rest (AES-256-GCM), are never sent to the browser and are
          deleted when the mailbox is disconnected.
        </li>
        <li>
          Message text, trade attachments and extracted deals are stored in access-controlled
          databases and storage buckets in our cloud account.
        </li>
      </ul>

      <h2>Retention and deletion</h2>
      <ul>
        <li>
          Disconnecting a mailbox on <strong>Email connections</strong> deletes its password and the
          mail we stored from it. Changing the mailbox password also stops our access.
        </li>
        <li>
          Deal records already extracted stay in the organisation&apos;s deal book until the
          organisation deletes them. To have everything derived from a mailbox deleted, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>; we complete deletion
          within 30 days.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>If we change how we use mail data, we will update this page before doing so.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
