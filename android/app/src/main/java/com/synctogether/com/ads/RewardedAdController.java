package com.synctogether.com.ads;

import android.app.Activity;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

/**
 * PHASE 14 — rewarded lifecycle.
 *
 * Rules:
 *  - preloading NEVER shows;
 *  - single-use and cleared on dismissal or failure;
 *  - if nothing is ready, resolves as "skipped".
 */
public class RewardedAdController {

    private RewardedAd loaded;
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
        final RewardedAd ad = loaded;
        if (ad == null) {
            result.onSkipped("no_fill");
            return;
        }
        loaded = null;
        loadedUnitId = null;
        showing = true;
        ad.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdDismissedFullScreenContent() {
                showing = false;
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
            ad.show(activity, rewardItem -> {
                // Reward logic is handled via the "shown" status in the web layer
                // for this specific architecture.
            });
        } catch (Throwable error) {
            showing = false;
            result.onSkipped("internal");
        }
    }

    public void clear() {
        loaded = null;
        loadedUnitId = null;
        loading = false;
        showing = false;
    }
}
