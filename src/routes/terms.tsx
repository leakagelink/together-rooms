import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal-page";

const TITLE = "Terms of Service — SyncTogether";
const DESCRIPTION = "The terms that govern your use of SyncTogether rooms and accounts.";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/terms" },
    ],
    links: [{ rel: "canonical", href: "/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="The agreement between you and SyncTogether when you use the app."
    >
      <h2>1. About these terms</h2>
      <p>
        SyncTogether provides private, invite-only rooms where people can spend time together. By
        creating an account or using the app you agree to these terms and to our Community
        Guidelines and Child Safety Standards.
      </p>
      <h2>2. Accounts</h2>
      <p>
        You are responsible for your account credentials and for activity in rooms you host. You
        must be old enough to hold an account under the law where you live. You can delete your
        account at any time from settings or from the delete-account page.
      </p>
      <h2>3. Acceptable use</h2>
      <p>
        You may not use SyncTogether to share unlawful content, harass others, exploit or endanger
        minors, scam or impersonate others, spam, distribute pirated or DRM-protected material, or
        attempt to bypass any content provider&apos;s restrictions or terms.
      </p>
      <h2>4. Your content</h2>
      <p>
        You keep ownership of the content you post — messages, notes, tasks, links and queued media
        titles. You grant us the limited right to store and display that content to the other people
        in your rooms so the service can work. You are responsible for having the right to share
        what you share.
      </p>
      <h2>5. Reporting and blocking</h2>
      <p>
        The app provides in-app reporting on user and room surfaces, and blocking that takes effect
        immediately. Reports are reviewed by our moderation team; review times vary and we do not
        guarantee a specific outcome or response time.
      </p>
      <h2>6. Moderation and enforcement</h2>
      <p>
        Where a violation is identified we may remove content, warn, mute, remove a participant from
        a room, ban them from a room, suspend an account, or permanently ban an account. Moderation
        actions are logged.
      </p>
      <h2>7. Third-party services</h2>
      <p>
        The app uses YouTube&apos;s embedded player and official YouTube Data API for shared
        playback and search (including Shorts Together), Google AdMob for advertising, Firebase
        Cloud Messaging for notifications and DuckDuckGo for research search results. Their own
        terms and privacy policies apply to those parts of the experience. By using shared playback
        you also agree to the YouTube Terms of Service. SyncTogether does not host, download, cache,
        stream, or re-stream third-party media, does not modify or obstruct the embedded player, its
        branding or its ads, and does not provide any background or audio-only playback of YouTube
        content.
      </p>
      <h2>8. Price and advertising</h2>
      <p>
        SyncTogether is free. There are no paid plans and no in-app purchases, and we never ask you
        for payment details. The app is supported by advertising, and you control ad personalisation
        from privacy settings. Optional features can be unlocked by choosing to watch a rewarded ad;
        there is no currency, no points, no purchasable item and no reward for watching content.
      </p>
      <h2>9. Disclaimers</h2>
      <p>
        The service is provided as-is. We do not guarantee uninterrupted availability, and rooms,
        peer-to-peer sharing and third-party playback depend on networks and services outside our
        control. We may suspend or terminate accounts that violate these terms.
      </p>
      <h2>10. Changes</h2>
      <p>We will notify users of material changes to these terms before they take effect.</p>

    </LegalPage>
  );
}
