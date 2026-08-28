/**
 * PHASE 15 — the one place that knows which Android application this build is.
 *
 * Previously this lived beside the Play Billing product configuration. The
 * app ships with no billing, so the identity constant is kept on its own and
 * the entire purchase-configuration surface is gone.
 */
export const EXPECTED_PACKAGE_NAME = "com.synctogether.com";
