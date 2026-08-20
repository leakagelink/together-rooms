import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal-page";

const TITLE = "Community Guidelines — SyncTogether";
const DESCRIPTION =
  "The rules for SyncTogether rooms: what is not allowed, how to report it and how moderation works.";

export const Route = createFileRoute("/guidelines")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/guidelines" },
    ],
    links: [{ rel: "canonical", href: "/guidelines" }],
  }),
  component: GuidelinesPage,
});

function GuidelinesPage() {
  return (
    <LegalPage title="Community Guidelines" subtitle="Draft placeholder — subject to legal review.">
      <h2>Not allowed</h2>
      <ul>
        <li>Harassment, bullying, hate speech, threats or violent content.</li>
        <li>Sexual content involving minors, or any child endangerment. Reported immediately.</li>
        <li>Sharing pirated media, DRM circumvention, or bypassing provider restrictions.</li>
        <li>Spam, scams, impersonation and malicious links.</li>
        <li>Sharing someone else's private information.</li>
      </ul>
      <h2>Reporting</h2>
      <p>
        Every user and room surface includes a report control. Reports go to our moderation queue with
        the reporter's identity kept out of the reported person's view.
      </p>
      <h2>Blocking</h2>
      <p>Blocking is instant and does not require a report. Blocks are mutual for visibility.</p>
      <h2>Host moderation</h2>
      <p>
        Room hosts and room moderators can mute, remove and ban participants in their own rooms.
        Platform moderators can act across rooms. All moderation actions are logged.
      </p>
    </LegalPage>
  );
}