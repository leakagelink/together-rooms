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
      subtitle="How SyncTogether handles your data. This policy matches the Google Play Data Safety declaration for the current release."
    >
      <h2>Summary</h2>
      <p>
        SyncTogether is free to use. There are no paid plans, no in-app purchases and no
        subscriptions, so we never collect or process payment information. The app is supported by
        advertising, described below.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          Account data: email address and authentication records (handled by our auth provider).
        </li>
        <li>Profile data you choose to provide: display name, username, avatar URL, bio.</li>
        <li>
          Room data: rooms you create or join, membership, roles, invites and room activity events.
        </li>
        <li>
          Content you post in a room: chat messages, reactions, study notes, tasks, saved links and
          the titles of media you queue.
        </li>
        <li>Safety data: reports you submit, blocks you create, and moderation outcomes.</li>
        <li>Device and diagnostic data: app version, crash and error diagnostics.</li>
        <li>
          Notification tokens, if you allow notifications, so we can deliver room and safety alerts.
        </li>
        <li>Product analytics: only if you switch analytics consent on in privacy settings.</li>
      </ul>
      <h2>Photos, videos and audio on your device</h2>
      <p>
        "Share from this device" sends the file you pick directly to the other people in your room
        over an encrypted peer-to-peer connection. That media is never uploaded to our servers, is
        not stored by us, and disappears when the sharing session ends. We store only the fact that
        a session happened, so hosts can manage and report it. We do not scan or index your media
        library, and we do not request microphone or camera access — voice and video calling is not
        part of this release.
      </p>
      <h2>Research browsing and search</h2>
      <p>
        In a research room you can browse pages inside the app. When you type a search query, the
        query text is sent to our server, which forwards it to the DuckDuckGo search service and
        returns the results to you. We do not store your search queries or your browsing history,
        and URLs written into server logs are redacted. Pages you open in the in-app browser are
        loaded directly from those websites, whose own privacy policies apply. Only links you
        explicitly share with the room become visible to other members.
      </p>
      <h2>Advertising</h2>

      <p>
        This release integrates Google AdMob. On first launch you are shown Google&apos;s consent
        form (UMP) where required by law, and you can change your choice at any time in privacy
        settings. If you do not consent to personalised ads, non-personalised ads are requested
        instead. Ads are never shown over player controls, safety flows or account deletion, and no
        ad is shown to a user we know to be a child. We do not sell your data.
      </p>
      <h2>Retention</h2>
      <p>
        Rooms can be created as ephemeral, which sets an expiry for the session. You can choose a
        room data retention window in privacy settings. Account data is kept while your account
        exists. Moderation and safety records are kept for as long as needed to keep the service
        safe, even after related content is removed.
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
        We use a managed cloud database and authentication provider to operate the service, Google
        AdMob for advertising, Firebase Cloud Messaging for notifications, DuckDuckGo for research
        search results and YouTube&apos;s embedded player for shared playback. Your use of the
        embedded player is also subject to Google&apos;s privacy policy. No data is sold.
      </p>
      <h2>Children</h2>
      <p>
        SyncTogether is not directed to children under 13 (or the minimum age in your country).
        Accounts we identify as belonging to a child are removed.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions and data requests: <strong>support@synctogether.app</strong>. You can also
        delete your account at any time from settings, or from the delete-account page without
        signing in.
      </p>
    </LegalPage>
  );
}
