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
      subtitle="Draft placeholder — must be reviewed by qualified counsel before public release."
    >
      <h2>1. About these terms</h2>
      <p>
        SyncTogether provides private, invite-only rooms where people can spend time together. This
        document is a Phase 1 placeholder. It is not legal advice and has not been reviewed by a
        lawyer.
      </p>
      <h2>2. Accounts</h2>
      <p>
        You are responsible for your account credentials and for activity in rooms you host. You must
        be old enough to hold an account under the law where you live.
      </p>
      <h2>3. Acceptable use</h2>
      <p>
        You may not use SyncTogether to share unlawful content, harass others, distribute pirated or
        DRM-protected material, or attempt to bypass any content provider's restrictions or terms.
      </p>
      <h2>4. Content and copyright</h2>
      <p>
        SyncTogether does not host, stream, or re-stream third-party media. Future content features
        will use official provider APIs, SDKs and embedded players only. Rights holders will be able
        to submit takedown requests.
      </p>
      <h2>5. Moderation and enforcement</h2>
      <p>
        We may remove content, restrict features, or suspend accounts that violate these terms or our
        Community Guidelines.
      </p>
      <h2>6. Subscriptions</h2>
      <p>
        Paid plans are not available yet. When they launch, pricing, billing period, auto-renewal and
        cancellation terms will be disclosed before purchase.
      </p>
      <h2>7. Changes</h2>
      <p>We will notify users of material changes to these terms before they take effect.</p>
    </LegalPage>
  );
}