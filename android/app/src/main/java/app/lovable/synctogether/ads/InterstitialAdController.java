package app.lovable.synctogether.ads;

import android.app.Activity;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;

/**
 * PHASE 14 — interstitial lifecycle.
 *
 * Rules encoded here:
 *  - preloading NEVER shows; showing is always an explicit, policy-approved
 *    call from the web layer;
 *  - a loaded ad is single-use and cleared on dismissal or show failure;
 *  - two shows can never overlap, and a stale reference left over from an
 *    activity recreation is discarded rather than shown;
 *  - if nothing is ready the call resolves as "skipped" immediately — the user
 *    has already navigated and is never made to wait for an ad.
 */
public class InterstitialAdController {

    private InterstitialAd loaded;
    private String loadedUnitId;
    private boolean loading = false;
    private boolean showing = false;

    public void preload(
        @NonNull Activity activity,
        @NonNull String unitId,
        boolean nonPersonalized,
        @NonNull AdsPlugin.AdCallback callback
    ) {
        if (loaded != null && unitId.equals(loadedUnitId)) {
            callback.onSuccess();
            return;
        }
        if (loading) {
            callback.onFailure("internal");
            return;
        }
        loading = true;
        InterstitialAd.load(
            activity,
            unitId,
            BannerAdController.AdRequestFactory.build(nonPersonalized),
            new InterstitialAdLoadCallback() {
                @Override
                public void onAdLoaded(@NonNull InterstitialAd ad) {
                    loading = false;
                    loaded = ad;
                    loadedUnitId = unitId;
                    callback.onSuccess();
                }

                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError error) {
                    loading = false;
                    loaded = null;
                    loadedUnitId = null;
                    callback.onFailure(AdErrorMapper.token(error));
                }
            }
        );
    }

    public void show(
        @NonNull Activity activity,
        @NonNull String unitId,
        boolean nonPersonalized,
        @NonNull AdsPlugin.InterstitialResult result
    ) {
        if (showing) {
            result.onSkipped("internal");
            return;
        }
        if (loaded != null && unitId.equals(loadedUnitId)) {
            present(activity, result);
            return;
        }
        // Nothing warm: load once, show only if it arrives. The caller has
        // already resolved its own navigation, so this is best effort.
        preload(activity, unitId, nonPersonalized, new AdsPlugin.AdCallback() {
            @Override
            public void onSuccess() {
                present(activity, result);
            }

            @Override
            public void onFailure(@NonNull String reason) {
                result.onSkipped(reason);
            }
        });
    }

    private void present(@NonNull Activity activity, @NonNull AdsPlugin.InterstitialResult result) {
        final InterstitialAd ad = loaded;
        if (ad == null) {
            result.onSkipped("no_fill");
            return;
        }
        // Single use: clear before showing so a dismissal cannot re-show it.
        loaded = null;
        loadedUnitId = null;
        showing = true;
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdDismissedFullScreenContent() {
                showing = false;
                // Dismissal changes nothing in the app: navigation already
                // completed, so no route transition is triggered here.
            }

            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull com.google.android.gms.ads.AdError error) {
                showing = false;
                result.onSkipped(AdErrorMapper.token(error));
            }

            @Override
            public void onAdShowedFullScreenContent() {
                result.onShown();
            }
        });
        try {
            ad.show(activity);
        } catch (Throwable error) {
            showing = false;
            result.onSkipped("internal");
        }
    }

    /** Drops any warm ad; used on activity destroy so nothing stale is shown. */
    public void clear() {
        loaded = null;
        loadedUnitId = null;
        loading = false;
        showing = false;
    }
}
