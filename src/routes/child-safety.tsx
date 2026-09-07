import { createFileRoute, Link } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal-page";

const TITLE = "Child Safety Standards — SyncTogether";
const DESCRIPTION =
  "SyncTogether's zero-tolerance standards on child sexual abuse and exploitation, how to report it and how we enforce.";

export const Route = createFileRoute("/child-safety")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/child-safety" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/child-safety" }],
  }),
  component: ChildSafetyPage,
});

function ChildSafetyPage() {
  return (
    <LegalPage title="Child Safety Standards">
      <p>
        <strong>Last updated: 7 September 2026</strong>
      </p>
      <p>
        SyncTogether has zero tolerance for child sexual abuse and exploitation (CSAE), child sexual
        abuse material (CSAM), grooming, sexual exploitation of minors, and child endangerment.
      </p>

      <h2>Prohibited</h2>
      <ul>
        <li>Sharing, requesting or distributing CSAM.</li>
        <li>Sexual exploitation or abuse of minors.</li>
        <li>Grooming or attempts to exploit minors.</li>
        <li>Content sexualizing minors.</li>
        <li>Child trafficking or exploitation.</li>
        <li>Threats or actions that endanger children.</li>
      </ul>

      <h2>Reporting</h2>
      <p>
        Users can report users or content through the in-app reporting tools, including reports
        related to child safety concerns. Reports are reviewed using the app&apos;s existing
        moderation and safety processes.
      </p>

      <h2>Enforcement</h2>
      <p>
        When violations are identified, SyncTogether may take appropriate action based on the
        severity of the violation, including:
      </p>
      <ul>
        <li>Content removal.</li>
        <li>Warnings.</li>
        <li>Muting.</li>
        <li>Removal from a room.</li>
        <li>Room restrictions or bans.</li>
        <li>Account suspension.</li>
        <li>Permanent account bans.</li>
        <li>Other actions permitted under the applicable policies.</li>
      </ul>

      <h2>Legal compliance</h2>
      <p>
        Where required by applicable law, suspected illegal child sexual abuse or exploitation
        material may be reported to the appropriate authorities or organizations.
      </p>

      <h2>Contact</h2>
      <p>
        For child safety concerns or questions about these standards, contact{" "}
        <strong>hello@socilet.in</strong>. See also our{" "}
        <Link to="/guidelines" className="text-primary underline underline-offset-4">
          Community Guidelines
        </Link>{" "}
        and{" "}
        <Link to="/privacy" className="text-primary underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPage>
  );
}
