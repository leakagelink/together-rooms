import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal-page";

const TITLE = "Privacy Policy — SyncTogether";
const DESCRIPTION =
  "What data SyncTogether collects, why it is collected, how long it is kept and how to delete it.";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/privacy" },
    ],
    links: [{ rel: "canonical", href: "/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="Draft placeholder — must be reviewed by qualified counsel and matched to the final Google Play Data Safety form before release."
    >
      <h2>What we collect</h2>
      <ul>
        <li>Account data: email address and authentication records (handled by our auth provider).</li>
        <li>Profile data you choose to provide: display name, username, avatar URL, bio.</li>
        <li>Room data: rooms you create or join, membership, roles, invites and room activity events.</li>
        <li>Safety data: reports you submit, blocks you create, and moderation outcomes.</li>
        <li>Product analytics: only if you switch analytics consent on in privacy settings.</li>
      </ul>
      <h2>What we do not collect</h2>
      <p>
        We do not request contacts, location, microphone, camera, photos or files in this release. We
        do not log passwords, authentication tokens, private messages or private media. We do not
        claim "zero data collection" — we collect only what the stated features require.
      </p>
      <h2>Retention</h2>
      <p>
        Rooms can be created as ephemeral, which sets an expiry for the session. You can choose a room
        data retention window in privacy settings. Account data is kept while your account exists.
      </p>
      <h2>Your controls</h2>
      <ul>
        <li>Profile, room, invite, messaging and activity visibility controls.</li>
        <li>Separate consent switches for analytics, personalization and ads.</li>
        <li>Blocking and reporting.</li>
        <li>Account deletion and data export requests (see settings).</li>
      </ul>
      <h2>Sharing</h2>
      <p>
        We use a managed cloud database and authentication provider to operate the service. No
        advertising SDK is integrated in this release, and no data is sold.
      </p>
      <h2>Contact</h2>
      <p>A published support and privacy contact address must be added before public release.</p>
    </LegalPage>
  );
}