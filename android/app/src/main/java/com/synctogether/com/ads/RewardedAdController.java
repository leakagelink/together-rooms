package com.synctogether.com.ads;

import android.app.Activity;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

/**
 * Rewarded ad lifecycle.
 *
 * Rules encoded here:
 *  - a rewarded ad is only ever shown from an explicit, user-initiated request
 *    coming from the web policy layer;
 *  - "earned" is reported ONLY when the SDK fires the reward callback; a
 *    dismissal, a load failure or a show failure resolves as not earned;
 *  - the reward itself is granted by the server, which re-checks daily caps.
 *    Nothing here can grant anything on its own;
 *  - two shows can never overlap and a loaded ad is single use.
 */
public class RewardedAdController {

    private RewardedAd loaded;
    private String loadedUnitId;
    private boolean loading = false;
    private boolean showing = false;

    public void show(
        @NonNull Activity activity,
        @NonNull String unitId,
        boolean nonPersonalized,
        @NonNull AdsPlugin.RewardedResult result
    ) {
        if (showing) {
            result.onFinished(false, "internal");
            return;
        }
        if (loaded != null && unitId.equals(loadedUnitId)) {
            present(activity, result);
            return;
        }
        if (loading) {
            result.onFinished(false, "internal");
            return;
        }
        loading = true;
        RewardedAd.load(
            activity,
            unitId,
            BannerAdController.AdRequestFactory.build(nonPersonalized),
            new RewardedAdLoadCallback() {
                @Override
                public void onAdLoaded(@NonNull RewardedAd ad) {
                    loading = false;
                    loaded = ad;
                    loadedUnitId = unitId;
                    present(activity, result);
                }

                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError error) {
                    loading = false;
                    loaded = null;
                    loadedUnitId = null;
                    result.onFinished(false, AdErrorMapper.token(error));
                }
            }
        );
    }

    private void present(@NonNull Activity activity, @NonNull AdsPlugin.RewardedResult result) {
        final RewardedAd ad = loaded;
        if (ad == null) {
            result.onFinished(false, "no_fill");
            return;
        }
        // Single use: cleared before showing so a dismissal cannot re-show it.
        loaded = null;
        loadedUnitId = null;
        showing = true;
        final boolean[] earned = { false };
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdDismissedFullScreenContent() {
                showing = false;
                result.onFinished(earned[0], earned[0] ? "earned" : "dismissed");
            }

            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull com.google.android.gms.ads.AdError error) {
                showing = false;
                result.onFinished(false, AdErrorMapper.token(error));
            }
        });
        try {
            ad.show(activity, rewardItem -> earned[0] = true);
        } catch (Throwable error) {
            showing = false;
            result.onFinished(false, "internal");
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
