import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/state-views";
import { Button } from "@/components/ui/button";
import { useAdContextFlag } from "@/hooks/useAds";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useAuth } from "@/hooks/useAuth";
import { getBillingBridge, manageSubscriptionUrl } from "@/lib/billing/play-billing";
import { describeStatus, FEATURE_MATRIX } from "@/lib/entitlements";
import {
  getSubscriptionHistory,
  listSubscriptionProducts,
  restorePurchases,
  verifyPurchase,
} from "@/lib/monetization.functions";
import { queryKeys } from "@/lib/query-keys";
import { track } from "@/lib/analytics";
import { rpcMessage, type RpcReason } from "@/lib/rpc-types";

export const Route = createFileRoute("/_authenticated/settings/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — SyncTogether" },
      {
        name: "description",
        content: "Manage your SyncTogether Premium subscription, billing history and restore purchases.",
      },
      { property: "og:title", content: "Subscription — SyncTogether" },
      {
        property: "og:description",
        content: "Manage your SyncTogether Premium subscription and restore purchases.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubscriptionPage,
});

function SubscriptionPage() {
  const { user } = useAuth();
  const { snapshot, premium, limits, isLoading, isError, refresh } = useEntitlement();
  // Payment surfaces never carry ads.
  useAdContextFlag({ sensitiveFlow: "payment" });

  const fetchProducts = useServerFn(listSubscriptionProducts);
  const fetchHistory = useServerFn(getSubscriptionHistory);
  const runVerify = useServerFn(verifyPurchase);
  const runRestore = useServerFn(restorePurchases);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void track("subscription_screen_viewed", { premium });
  }, [premium]);

  const productsQuery = useQuery({
    enabled: Boolean(user),
    queryKey: queryKeys.account.subscriptionProducts(),
    staleTime: 300_000,
    queryFn: async () => {
      const result = await fetchProducts();
      return result.ok ? result.products : [];
    },
  });

  const historyQuery = useQuery({
    enabled: Boolean(user),
    queryKey: queryKeys.account.subscriptionHistory(user?.id),
    queryFn: async () => {
      const result = await fetchHistory();
      return result.ok ? result.events : [];
    },
  });

  const bridge = getBillingBridge();

  async function purchase(productId: string, basePlanId: string | null) {
    if (!bridge) {
      toast.info("Purchases are made in the SyncTogether Android app.");
      return;
    }
    setBusy(productId);
    void track("purchase_started", { product: productId });
    try {
      const claim = await bridge.purchase(productId, basePlanId ?? undefined);
      if (!claim) {
        setBusy(null);
        return; // User dismissed Play — never treated as a failure.
      }
      const result = await runVerify({
        data: { product_id: claim.productId, purchase_token: claim.purchaseToken },
      });
      if (result.ok) {
        void track("purchase_verified", { product: productId });
        toast.success("Premium is active. Thanks for supporting SyncTogether.");
        await refresh();
      } else {
        void track("purchase_failed", { product: productId, reason: String(result.reason) });
        toast.error(rpcMessage(result.reason as RpcReason));
      }
    } catch {
      toast.error("We couldn't complete that purchase. Nothing was charged twice.");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    void track("restore_requested", {});
    try {
      const purchases = bridge ? await bridge.queryPurchases() : [];
      const result = await runRestore({
        data: {
          purchases: purchases.map((p) => ({
            product_id: p.productId,
            purchase_token: p.purchaseToken,
          })),
        },
      });
      if (result.ok) {
        await refresh();
        toast.success(
          result.applied > 0
            ? "Your purchases were restored."
            : "No active purchases were found for this account.",
        );
      } else {
        toast.error(rpcMessage(result.reason as RpcReason));
      }
    } catch {
      toast.error("We couldn't check your purchases right now. Try again shortly.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Subscription</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything in SyncTogether stays usable on the Free plan. Premium adds capacity and removes
        ads.{" "}
        <Link to="/settings" className="text-primary hover:underline">
          Back to settings
        </Link>
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        {isLoading ? (
          <LoadingState label="Checking your plan" rows={2} />
        ) : isError ? (
          <ErrorState message="We couldn't load your plan just now." onRetry={() => void refresh()} />
        ) : (
          <section className="surface-panel p-5" aria-labelledby="plan-state">
            <h2 id="plan-state" className="text-sm font-semibold">
              {premium ? "Premium" : "Free"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{describeStatus(snapshot)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <dt>Active rooms</dt>
                <dd className="text-foreground">{limits.max_active_rooms}</dd>
              </div>
              <div>
                <dt>Room capacity</dt>
                <dd className="text-foreground">{limits.max_room_members}</dd>
              </div>
              <div>
                <dt>Call length</dt>
                <dd className="text-foreground">{limits.max_call_minutes} min</dd>
              </div>
              <div>
                <dt>Saved playlists</dt>
                <dd className="text-foreground">{limits.max_playlists}</dd>
              </div>
            </dl>
            {premium ? (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a
                  href={manageSubscriptionUrl(snapshot.product_id ?? undefined)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Manage or cancel in Google Play
                </a>
              </Button>
            ) : null}
          </section>
        )}

        {!premium ? (
          <section className="surface-panel p-5" aria-labelledby="plans">
            <h2 id="plans" className="text-sm font-semibold">
              Premium
            </h2>
            {productsQuery.isPending ? (
              <LoadingState label="Loading plans" rows={2} />
            ) : productsQuery.data && productsQuery.data.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {productsQuery.data.map((product) => (
                  <li
                    key={product.product_id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
                  >
                    <div>
                      <p className="text-sm font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.description ?? "Billed through Google Play."}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Price is shown by Google Play in your local currency.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void purchase(product.product_id, product.base_plan_id)}
                    >
                      {busy === product.product_id ? "Opening…" : "Subscribe"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Premium plans aren't available yet on this device.
              </p>
            )}
            {!bridge ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Subscriptions are purchased in the SyncTogether Android app through Google Play.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="surface-panel p-5" aria-labelledby="matrix">
          <h2 id="matrix" className="text-sm font-semibold">
            Free vs Premium
          </h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Feature</th>
                <th className="py-1 font-medium">Free</th>
                <th className="py-1 font-medium">Premium</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="py-2 pr-2">{row.label}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{row.free}</td>
                  <td className="py-2 text-foreground">{row.premium}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="surface-panel p-5" aria-labelledby="restore">
          <h2 id="restore" className="text-sm font-semibold">
            Restore purchases
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Reinstalled the app or switched device? Restoring re-checks your purchases with Google
            Play. It never changes anything unless Google confirms an active subscription.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy !== null}
            onClick={() => void restore()}
          >
            {busy === "restore" ? "Checking…" : "Restore purchases"}
          </Button>
        </section>

        <section className="surface-panel p-5" aria-labelledby="history">
          <h2 id="history" className="text-sm font-semibold">
            Billing history
          </h2>
          {historyQuery.isPending ? (
            <LoadingState label="Loading history" rows={2} />
          ) : historyQuery.data && historyQuery.data.length > 0 ? (
            <ul className="mt-3 space-y-2 text-xs">
              {historyQuery.data.map((event, index) => (
                <li
                  key={`${event.event_time}-${index}`}
                  className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0"
                >
                  <span className="text-foreground">{event.event_type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">
                    {new Date(event.event_time).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No billing events yet.</p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Payment details, card numbers and purchase tokens are handled by Google Play and are
            never stored by SyncTogether.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
