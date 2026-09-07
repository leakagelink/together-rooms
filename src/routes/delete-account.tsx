import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal-page";

const TITLE = "Delete Your SyncTogether Account & Data";
const DESCRIPTION =
  "How to request deletion of your SyncTogether account, what data is deleted, what is retained and for how long.";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/delete-account" },
    ],
    links: [{ rel: "canonical", href: "/delete-account" }],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your account and data"
      subtitle="App name: SyncTogether (com.synctogether.com). This page explains how to request account and data deletion without installing the app."
    >
      <h2>Option 1 — Delete inside the app</h2>
      <ul>
        <li>Open SyncTogether and sign in.</li>
        <li>
          Go to <strong>Settings → Privacy &amp; data</strong>.
        </li>
        <li>
          Choose <strong>Export my data</strong> first if you want a copy, then choose{" "}
          <strong>Delete my account</strong> and confirm.
        </li>
        <li>Deletion starts immediately and cannot be undone.</li>
      </ul>
      <p>
        You can also{" "}
        <Link to="/auth/login" className="text-primary underline underline-offset-4">
          sign in on the web
        </Link>{" "}
        and use the same settings screen.
      </p>

      <h2>Option 2 — Request deletion by email</h2>
      <p>
        If you cannot sign in, email <strong>hello@socilet.in</strong> from the email
        address linked to your account with the subject{" "}
        <strong>&quot;Delete my account&quot;</strong>. We verify ownership of the email address
        before deleting. Requests are completed within 30 days.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your account and sign-in credentials.</li>
        <li>Your profile: display name, username, avatar, bio and privacy settings.</li>
        <li>Rooms you own, your room memberships, invites you created and your room activity.</li>
        <li>Your chat messages, reactions, notes, tasks, playlists and queue entries.</li>
        <li>Consent records and any analytics identifiers tied to your account.</li>
      </ul>
      <p>
        Shared media in local media rooms is never stored on our servers — it is peer-to-peer and
        disappears when the session ends.
      </p>

      <h2>What is retained, and for how long</h2>
      <ul>
        <li>
          Moderation and safety records (reports, blocks, enforcement actions) are retained in
          anonymised form for up to 12 months to protect other users and meet legal obligations.
        </li>

        <li>Backups are rotated out within 30 days.</li>
      </ul>

      <h2>Timeline</h2>
      <p>
        In-app deletion is immediate for live data. Email requests are completed within 30 days of
        verification. Residual copies in encrypted backups are removed within 30 days after that.
      </p>

      <h2>Questions</h2>
      <p>
        Contact <strong>hello@socilet.in</strong>. See also our{" "}
        <Link to="/privacy" className="text-primary underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPage>
  );
}
