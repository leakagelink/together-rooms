/**
 * PHASE 10 — environment/runtime configuration validation.
 *
 * The Android shell loads the deployed origin, so "which backend am I talking
 * to" is decided entirely by the client bundle's VITE_* values. This module is
 * the single specification of what a valid configuration looks like and it
 * fails loudly instead of silently degrading to a development backend.
 *
 * Pure and side-effect free so it can be asserted in tests and evaluated on the
 * server or in the browser.
 */

export type AppEnvironment = "development" | "staging" | "production";

export interface RuntimeConfigInput {
  mode: string | undefined;
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
  appOrigin?: string | undefined;
}

export type ConfigProblem =
  | "missing_supabase_url"
  | "missing_supabase_key"
  | "insecure_supabase_url"
  | "development_backend_in_release"
  | "placeholder_value"
  | "secret_key_exposed"
  | "insecure_app_origin";

export interface ConfigResult {
  environment: AppEnvironment;
  ok: boolean;
  problems: ConfigProblem[];
}

const PLACEHOLDER_PATTERN = /(your[-_]?project|example\.com|changeme|placeholder|xxxx|todo)/i;
/** Any Supabase key that is not the publishable/anon key must never ship. */
const SECRET_KEY_PATTERN = /^(sb_secret_|service_role|eyJ[\w-]+\.[\w-]+\.[\w-]+$)/;

const LOCAL_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|.*\.localhost|.*\.test)$/i;

export function resolveEnvironment(mode: string | undefined): AppEnvironment {
  if (mode === "production") return "production";
  if (mode === "staging" || mode === "test" || mode === "preview") return "staging";
  return "development";
}

/** True for builds that must behave as a shipped release (no debug affordances). */
export function isReleaseEnvironment(environment: AppEnvironment): boolean {
  return environment === "production";
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isHttps(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates the runtime configuration. A release build with a development
 * backend, a placeholder value, an http endpoint or a non-publishable key is
 * reported as a hard problem — never as a warning to be ignored.
 */
export function validateRuntimeConfig(input: RuntimeConfigInput): ConfigResult {
  const environment = resolveEnvironment(input.mode);
  const problems: ConfigProblem[] = [];
  const release = isReleaseEnvironment(environment);

  const url = (input.supabaseUrl ?? "").trim();
  const key = (input.supabasePublishableKey ?? "").trim();

  if (!url) problems.push("missing_supabase_url");
  if (!key) problems.push("missing_supabase_key");

  if (url) {
    if (PLACEHOLDER_PATTERN.test(url)) problems.push("placeholder_value");
    const host = hostOf(url);
    if (!isHttps(url) && release) problems.push("insecure_supabase_url");
    if (release && (host === null || LOCAL_HOST_PATTERN.test(host))) {
      problems.push("development_backend_in_release");
    }
  }

  if (key) {
    if (PLACEHOLDER_PATTERN.test(key)) problems.push("placeholder_value");
    if (SECRET_KEY_PATTERN.test(key)) problems.push("secret_key_exposed");
  }

  if (input.appOrigin) {
    const originHost = hostOf(input.appOrigin);
    if (release && (!isHttps(input.appOrigin) || originHost === null)) {
      problems.push("insecure_app_origin");
    }
    if (release && originHost !== null && LOCAL_HOST_PATTERN.test(originHost)) {
      problems.push("development_backend_in_release");
    }
  }

  return {
    environment,
    ok: problems.length === 0,
    problems: [...new Set(problems)],
  };
}

export function describeConfigProblem(problem: ConfigProblem): string {
  switch (problem) {
    case "missing_supabase_url":
      return "The backend URL is missing from this build.";
    case "missing_supabase_key":
      return "The backend publishable key is missing from this build.";
    case "insecure_supabase_url":
      return "A release build must talk to the backend over https.";
    case "development_backend_in_release":
      return "A release build must not point at a development backend.";
    case "placeholder_value":
      return "This build still contains a placeholder configuration value.";
    case "secret_key_exposed":
      return "A non-publishable key must never be shipped to the client.";
    case "insecure_app_origin":
      return "The application origin must be an https URL in a release build.";
  }
}

/** Debug affordances (verbose logs, test billing, test ads) are release-gated. */
export interface DebugCapabilities {
  verboseLogging: boolean;
  testBilling: boolean;
  testAds: boolean;
  webviewDebugging: boolean;
}

export function debugCapabilities(environment: AppEnvironment): DebugCapabilities {
  const enabled = !isReleaseEnvironment(environment);
  return {
    verboseLogging: enabled,
    testBilling: enabled,
    testAds: enabled,
    webviewDebugging: enabled,
  };
}

/** Reads the actual build configuration without ever touching secret values. */
export function currentRuntimeConfig(env: Record<string, unknown>, mode: string): ConfigResult {
  return validateRuntimeConfig({
    mode,
    supabaseUrl: typeof env["VITE_SUPABASE_URL"] === "string" ? env["VITE_SUPABASE_URL"] : undefined,
    supabasePublishableKey:
      typeof env["VITE_SUPABASE_PUBLISHABLE_KEY"] === "string"
        ? env["VITE_SUPABASE_PUBLISHABLE_KEY"]
        : undefined,
  });
}
