/**
 * PHASE 11 — Google Play product identifier configuration.
 *
 * There is exactly ONE place in the application that knows which product ids
 * exist. No component, no Android class and no server function may hard-code a
 * product id, so a wrong or test id can never leak into a production purchase
 * flow unnoticed.
 *
 * No real product id is invented here: the values come from build
 * configuration (`VITE_PLAY_PREMIUM_PRODUCT_ID`, …) on the client and from
 * server configuration (`GOOGLE_PLAY_PREMIUM_PRODUCT_ID`) on the server. When
 * configuration is missing the resolution FAILS with an explicit problem
 * instead of falling back to a guess.
 */

export type BillingEnvironment = "development" | "production";

export interface ProductConfigInput {
  premiumProductId?: string | undefined;
  /** Optional additional product ids the backend should also accept. */
  additionalProductIds?: readonly string[] | undefined;
  packageName?: string | undefined;
}

export type ProductConfigProblem =
  | "missing_premium_product_id"
  | "missing_package_name"
  | "package_mismatch"
  | "test_product_in_production"
  | "invalid_product_id";

export interface ProductConfigResult {
  ok: boolean;
  environment: BillingEnvironment;
  /** Every product id this build is allowed to purchase or verify. */
  allowedProductIds: string[];
  premiumProductId: string | null;
  packageName: string | null;
  problems: ProductConfigProblem[];
}

/** The Android application id this build must belong to. */
export const EXPECTED_PACKAGE_NAME = "com.synctogether.com";

/** Play product ids: lowercase alphanumerics, dots, underscores, hyphens. */
const PRODUCT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,118})[a-z0-9]$/;

/** Obvious placeholder/test shapes that must never ship as production ids. */
const TEST_PRODUCT_PATTERN = /(^android\.test\.)|(\btest\b)|(\bsample\b)|(\bdemo\b)|(placeholder)/i;

export function isValidProductId(value: string): boolean {
  return PRODUCT_ID_PATTERN.test(value);
}

/**
 * Resolves the product configuration for a build. Pure: callers pass the
 * values they read from their own environment.
 */
export function resolveProductConfig(
  environment: BillingEnvironment,
  input: ProductConfigInput,
): ProductConfigResult {
  const problems: ProductConfigProblem[] = [];
  const premium = input.premiumProductId?.trim() || null;
  const packageName = input.packageName?.trim() || null;

  if (!premium) problems.push("missing_premium_product_id");
  else if (!isValidProductId(premium)) problems.push("invalid_product_id");
  else if (environment === "production" && TEST_PRODUCT_PATTERN.test(premium)) {
    problems.push("test_product_in_production");
  }

  if (!packageName) problems.push("missing_package_name");
  else if (packageName !== EXPECTED_PACKAGE_NAME) problems.push("package_mismatch");

  const extra = (input.additionalProductIds ?? []).map((id) => id.trim()).filter(Boolean);
  for (const id of extra) {
    if (!isValidProductId(id) && !problems.includes("invalid_product_id")) {
      problems.push("invalid_product_id");
    }
  }

  const allowed = [...new Set([premium, ...extra].filter((v): v is string => Boolean(v)))];

  return {
    ok: problems.length === 0,
    environment,
    allowedProductIds: allowed,
    premiumProductId: premium,
    packageName,
    problems,
  };
}

/**
 * A purchase claim is only ever verified against a product this build is
 * configured for. A claim naming any other product is rejected before a single
 * Play API call is made, so a client cannot ask us to verify an unrelated
 * product and have its entitlement applied.
 */
export function isAllowedProduct(config: ProductConfigResult, claimedProductId: string): boolean {
  if (!config.ok) return false;
  return config.allowedProductIds.includes(claimedProductId.trim());
}

/** Server-side resolution; reads process.env inside the caller's handler. */
export function serverProductConfig(env: Record<string, string | undefined>): ProductConfigResult {
  const mode = env["NODE_ENV"] === "production" ? "production" : "development";
  const additional = (env["GOOGLE_PLAY_ADDITIONAL_PRODUCT_IDS"] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return resolveProductConfig(mode, {
    premiumProductId: env["GOOGLE_PLAY_PREMIUM_PRODUCT_ID"],
    packageName: env["GOOGLE_PLAY_PACKAGE_NAME"],
    additionalProductIds: additional,
  });
}
