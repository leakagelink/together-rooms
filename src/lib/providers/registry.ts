/**
 * Phase 1 provider registry.
 *
 * No providers are wired yet. The registry exists so future integrations are
 * registered in exactly one place and can be feature-flagged / consent-gated.
 */
import type { BaseProvider, ProviderId } from "./types";

const registry = new Map<ProviderId, BaseProvider>();

export function registerProvider(provider: BaseProvider) {
  if (!provider.capabilities.authorized) {
    throw new Error(`Provider "${provider.id}" is not marked authorized and cannot be registered.`);
  }
  registry.set(provider.id, provider);
}

export function getProvider<T extends BaseProvider>(id: ProviderId): T | null {
  return (registry.get(id) as T | undefined) ?? null;
}

export function isProviderAvailable(id: ProviderId) {
  const provider = registry.get(id);
  return Boolean(provider?.isConfigured());
}

export function listProviders(): BaseProvider[] {
  return [...registry.values()];
}
