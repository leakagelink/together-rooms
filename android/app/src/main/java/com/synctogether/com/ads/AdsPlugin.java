package com.synctogether.com.ads;

import android.app.Activity;

import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;

import java.util.ArrayList;
import java.util.List;

/**
 * PHASE 14 — the real Google Mobile Ads bridge.
 *
 * This plugin is intentionally "dumb": it owns SDK mechanics only. Every
 * decision about WHETHER an ad may be requested (Premium, UMP consent,
 * placement allow-list, frequency caps, warm-up) has already been made by the
 * web policy layer before any method here is called. The plugin never selects
 * an ad unit, never retries on its own, and never reports an impression that
 * did not happen.
 *
 * It also never leaks SDK error text across the bridge: failures are reported
 * as short tokens which the web layer classifies (see src/lib/ads/bridge-errors.ts).
 */
@CapacitorPlugin(name = "SyncTogetherAds")
public class AdsPlugin extends Plugin {

    private final BannerAdController banner = new BannerAdController();
    private final InterstitialAdController interstitial = new InterstitialAdController();
    private ConsentController consent;

    /** Guarded so the SDK is initialized exactly once per process. */
    private boolean initialized = false;
    private boolean initializing = false;

    @Override
    public void load() {
        consent = new ConsentController();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        call.resolve(result);
    }

    /**
     * Initializes the Mobile Ads SDK. Called only after the web consent state
     * machine reports that an ad request is permitted at all.
     */
    @PluginMethod
    public void initialize(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("bridge_unavailable");
            return;
        }
        if (initialized) {
            JSObject result = new JSObject();
            result.put("initialized", true);
            call.resolve(result);
            return;
        }
        if (initializing) {
            // A concurrent caller: never start a second initialization.
            call.reject("internal");
            return;
        }
        initializing = true;

        final boolean testMode = Boolean.TRUE.equals(call.getBoolean("testMode", false));
        final List<String> testDevices = readTestDeviceIds(call);

        activity.runOnUiThread(() -> {
            try {
                RequestConfiguration.Builder configuration = MobileAds
                    .getRequestConfiguration()
                    .toBuilder();
                // Test devices are ONLY ever the ids the build explicitly
                // supplied. There is no "everything is a test device" mode.
                if (!testDevices.isEmpty()) {
                    configuration.setTestDeviceIds(testDevices);
                }
                MobileAds.setRequestConfiguration(configuration.build());
                MobileAds.initialize(activity, status -> {
                    initialized = true;
                    initializing = false;
                    JSObject result = new JSObject();
                    result.put("initialized", true);
                    result.put("testMode", testMode);
                    call.resolve(result);
                });
            } catch (Throwable error) {
                initializing = false;
                call.reject("sdk_init_failed");
            }
        });
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        final Activity activity = getActivity();
        final String unitId = call.getString("unitId");
        if (activity == null || !AdUnitIds.isValidUnitId(unitId)) {
            call.reject("invalid_request");
            return;
        }
        if (!initialized) {
            call.reject("sdk_init_failed");
            return;
        }
        final boolean nonPersonalized = Boolean.TRUE.equals(call.getBoolean("nonPersonalized", true));
        activity.runOnUiThread(() ->
            banner.show(activity, unitId, nonPersonalized, new AdCallback() {
                @Override
                public void onSuccess() {
                    JSObject result = new JSObject();
                    result.put("shown", true);
                    call.resolve(result);
                }

                @Override
                public void onFailure(@NonNull String reason) {
                    call.reject(reason);
                }
            })
        );
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            banner.destroy();
            call.resolve();
        });
    }

    /** Warms an interstitial. Loading NEVER shows. */
    @PluginMethod
    public void preloadInterstitial(PluginCall call) {
        final Activity activity = getActivity();
        final String unitId = call.getString("unitId");
        if (activity == null || !AdUnitIds.isValidUnitId(unitId)) {
            call.reject("invalid_request");
            return;
        }
        if (!initialized) {
            call.reject("sdk_init_failed");
            return;
        }
        final boolean nonPersonalized = Boolean.TRUE.equals(call.getBoolean("nonPersonalized", true));
        activity.runOnUiThread(() ->
            interstitial.preload(activity, unitId, nonPersonalized, new AdCallback() {
                @Override
                public void onSuccess() {
                    JSObject result = new JSObject();
                    result.put("loaded", true);
                    call.resolve(result);
                }

                @Override
                public void onFailure(@NonNull String reason) {
                    JSObject result = new JSObject();
                    result.put("loaded", false);
                    result.put("reason", reason);
                    call.resolve(result);
                }
            })
        );
    }

    /**
     * Shows a preloaded interstitial if one is ready; otherwise loads and shows
     * once. Either way the promise resolves — the web layer has already
     * navigated and must never wait on an ad.
     */
    @PluginMethod
    public void showInterstitial(PluginCall call) {
        final Activity activity = getActivity();
        final String unitId = call.getString("unitId");
        if (activity == null || !AdUnitIds.isValidUnitId(unitId)) {
            call.reject("invalid_request");
            return;
        }
        if (!initialized) {
            call.reject("sdk_init_failed");
            return;
        }
        final boolean nonPersonalized = Boolean.TRUE.equals(call.getBoolean("nonPersonalized", true));
        activity.runOnUiThread(() ->
            interstitial.show(activity, unitId, nonPersonalized, new InterstitialResult() {
                @Override
                public void onShown() {
                    JSObject result = new JSObject();
                    result.put("shown", true);
                    call.resolve(result);
                }

                @Override
                public void onSkipped(@NonNull String reason) {
                    JSObject result = new JSObject();
                    result.put("shown", false);
                    result.put("reason", reason);
                    call.resolve(result);
                }
            })
        );
    }

    @PluginMethod
    public void requestConsentInfoUpdate(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(ConsentController.unresolved());
            return;
        }
        activity.runOnUiThread(() -> consent.requestInfoUpdate(activity, call::resolve));
    }

    @PluginMethod
    public void showConsentFormIfRequired(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(ConsentController.unresolved());
            return;
        }
        activity.runOnUiThread(() -> consent.showFormIfRequired(activity, call::resolve));
    }

    @PluginMethod
    public void showPrivacyOptionsForm(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve(ConsentController.unresolved());
            return;
        }
        activity.runOnUiThread(() -> consent.showPrivacyOptions(activity, call::resolve));
    }

    /** Activity teardown must never leak a banner view. */
    @Override
    protected void handleOnDestroy() {
        banner.destroy();
        interstitial.clear();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        banner.pause();
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        banner.resume();
        super.handleOnResume();
    }

    private static List<String> readTestDeviceIds(PluginCall call) {
        List<String> ids = new ArrayList<>();
        JSArray raw = call.getArray("testDeviceIds");
        if (raw == null) return ids;
        try {
            for (Object value : raw.toList()) {
                if (value instanceof String && AdUnitIds.isValidTestDeviceId((String) value)) {
                    ids.add(((String) value).toUpperCase());
                }
            }
        } catch (Throwable ignored) {
            return new ArrayList<>();
        }
        return ids;
    }

    /** Result contract for one-shot native operations. */
    public interface AdCallback {
        void onSuccess();

        void onFailure(@NonNull String reason);
    }

    /** Interstitials resolve either way; a skip is not an error for the user. */
    public interface InterstitialResult {
        void onShown();

        void onSkipped(@NonNull String reason);
    }
}
