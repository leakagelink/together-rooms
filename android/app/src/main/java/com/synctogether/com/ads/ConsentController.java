package com.synctogether.com.ads;

import android.app.Activity;
import android.util.Log;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentForm;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

/**
 * PHASE 14 — the UMP (User Messaging Platform) bridge.
 *
 * The consent DECISION logic lives in TypeScript (src/lib/ads/consent.ts); this
 * class only reports raw UMP state. A failure is always reported as an error,
 * never as consent, so the web state machine resolves to "unresolved" and no
 * ad request is made.
 */
public class ConsentController {

    private static final String TAG = "SyncTogetherAds";

    public interface StateCallback {
        void onState(JSObject state);
    }

    public static JSObject unresolved() {
        JSObject state = new JSObject();
        state.put("status", "unknown");
        state.put("formStatus", "unknown");
        state.put("privacyOptionsRequired", false);
        state.put("canRequestAds", false);
        state.put("personalizedAllowed", false);
        state.put("error", "gathering_failed");
        return state;
    }

    public void requestInfoUpdate(@NonNull Activity activity, @NonNull StateCallback callback) {
        try {
            ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
            ConsentRequestParameters params = new ConsentRequestParameters.Builder()
                .setTagForUnderAgeOfConsent(false)
                .setConsentDebugSettings(new ConsentDebugSettings.Builder(activity).build())
                .build();
            info.requestConsentInfoUpdate(
                activity,
                params,
                () -> callback.onState(snapshot(info, null)),
                error -> {
                    Log.w(TAG, "consent info update failed: " + error.getMessage());
                    callback.onState(unresolved());
                }
            );
        } catch (Throwable error) {
            callback.onState(unresolved());
        }
    }

    public void showFormIfRequired(@NonNull Activity activity, @NonNull StateCallback callback) {
        try {
            ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                activity,
                error -> callback.onState(error == null ? snapshot(info, null) : unresolved())
            );
        } catch (Throwable error) {
            callback.onState(unresolved());
        }
    }

    /**
     * The always-reachable privacy options entry point. Required by Google
     * whenever UMP reports a privacy options requirement.
     */
    public void showPrivacyOptions(@NonNull Activity activity, @NonNull StateCallback callback) {
        try {
            ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
            UserMessagingPlatform.showPrivacyOptionsForm(
                activity,
                error -> callback.onState(error == null ? snapshot(info, null) : unresolved())
            );
        } catch (Throwable error) {
            callback.onState(unresolved());
        }
    }

    private JSObject snapshot(@NonNull ConsentInformation info, ConsentForm ignored) {
        JSObject state = new JSObject();
        state.put("status", statusToken(info.getConsentStatus()));
        state.put("formStatus", info.isConsentFormAvailable() ? "available" : "unavailable");
        state.put(
            "privacyOptionsRequired",
            info.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        );
        boolean canRequestAds = info.canRequestAds();
        state.put("canRequestAds", canRequestAds);
        // Personalization is only claimed when consent was actively obtained;
        // anything else is treated as non-personalized.
        state.put(
            "personalizedAllowed",
            canRequestAds && info.getConsentStatus() == ConsentInformation.ConsentStatus.OBTAINED
        );
        state.put("error", null);
        Log.d(
            TAG,
            "consent status=" + statusToken(info.getConsentStatus())
                + " canRequestAds=" + canRequestAds
                + " formAvailable=" + info.isConsentFormAvailable()
        );
        return state;
    }

    private static String statusToken(int status) {
        switch (status) {
            case ConsentInformation.ConsentStatus.REQUIRED:
                return "required";
            case ConsentInformation.ConsentStatus.NOT_REQUIRED:
                return "not_required";
            case ConsentInformation.ConsentStatus.OBTAINED:
                return "obtained";
            default:
                return "unknown";
        }
    }
}
