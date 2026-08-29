import { createFileRoute, Link } from "@tanstack/react-router";

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
    <LegalPage
      title="Community Guidelines"
      subtitle="Standards for safe and respectful use of SyncTogether."
    >
      <h2>Not allowed</h2>
      <ul>
        <li>Harassment, bullying, hate speech, threats or violent content.</li>
        <li>Sexual exploitation, and sexual content involving minors.</li>
        <li>Scams, fraud, spam, impersonation and malicious links.</li>
        <li>Sharing pirated media, DRM circumvention, or bypassing provider restrictions.</li>
        <li>Sharing someone else&apos;s private information.</li>
        <li>Any other illegal or harmful content.</li>
      </ul>

      <h2>Child safety</h2>
      <p>
        Sexual content involving minors, child sexual abuse or exploitation, and child endangerment
        are strictly prohibited. Reports involving suspected child safety violations are reviewed and
        handled in accordance with our{" "}
        <Link to="/child-safety" className="text-primary underline underline-offset-4">
          Child Safety Standards
        </Link>{" "}
        and applicable laws.
      </p>

      <h2>Reporting</h2>
      <p>
        Every user and room surface includes a report control, including a child safety category.
        Reports go to our moderation queue with the reporter&apos;s identity kept out of the reported
        person&apos;s view.
      </p>

      <h2>Blocking</h2>
      <p>Blocking is instant and does not require a report. Blocks are mutual for visibility.</p>

      <h2>Host moderation</h2>
      <p>
        Room hosts and room moderators can mute, remove and ban participants in their own rooms.
        Platform moderators can act across rooms, and can remove content, warn, suspend or
        permanently ban accounts. All moderation actions are logged.
      </p>
      <p>
        Reports are reviewed by people, not instantly and not around the clock, so review times vary
        with volume. Blocking takes effect immediately and does not depend on a review.
      </p>
    </LegalPage>
  );
}
