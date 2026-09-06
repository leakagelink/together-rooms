package com.synctogether.com.ads;

import android.app.Activity;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.LoadAdError;

/**
 * PHASE 14 — banner lifecycle.
 *
 * Rules encoded here rather than left to callers:
 *  - exactly one AdView can exist at a time (no duplicates across re-renders
 *    or activity recreation);
 *  - the view is attached at the BOTTOM of the content frame and is destroyed
 *    on hide/destroy, so it can never leak or float over controls;
 *  - an adaptive (anchored) size is used where the SDK supports it so the
 *    banner matches device width instead of being letterboxed;
 *  - a load failure removes the view entirely: no empty reserved space, no
 *    layout shift.
 */
public class BannerAdController {

    private static final String TAG = "SyncTogetherAds";

    private AdView adView;
    private FrameLayout container;
    private String currentUnitId;

    public void show(
        @NonNull Activity activity,
        @NonNull String unitId,
        boolean nonPersonalized,
        @NonNull AdsPlugin.AdCallback callback
    ) {
        if (adView != null && unitId.equals(currentUnitId)) {
            callback.onSuccess();
            return;
        }
        destroy();

        try {
            AdView view = new AdView(activity);
            view.setAdUnitId(unitId);
            view.setAdSize(adaptiveSize(activity));

            FrameLayout frame = new FrameLayout(activity);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            );
            frame.addView(
                view,
                new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
                )
            );
            ((ViewGroup) activity.findViewById(android.R.id.content)).addView(frame, params);

            view.setAdListener(new AdListener() {
                @Override
                public void onAdLoaded() {
                    Log.d(TAG, "banner loaded");
                    callback.onSuccess();
                }

                @Override
                public void onAdFailedToLoad(@NonNull LoadAdError error) {
                    Log.w(TAG, "banner failed: code=" + error.getCode() + " msg=" + error.getMessage());
                    // No blank space is left behind.
                    destroy();
                    callback.onFailure(AdErrorMapper.token(error));
                }
            });

            adView = view;
            container = frame;
            currentUnitId = unitId;
            Log.d(TAG, "banner request started (npa=" + nonPersonalized + ")");
            view.loadAd(AdRequestFactory.build(nonPersonalized));
        } catch (Throwable error) {
            Log.e(TAG, "banner internal error", error);
            destroy();
            callback.onFailure("internal");
        }
    }

    public void pause() {
        if (adView != null) adView.pause();
    }

    public void resume() {
        if (adView != null) adView.resume();
    }

    /** Idempotent teardown: safe on rotation, navigation away and destroy. */
    public void destroy() {
        try {
            if (adView != null) Log.d(TAG, "banner destroyed");
            if (adView != null) {
                adView.setAdListener(null);
                adView.destroy();
            }
            if (container != null && container.getParent() instanceof ViewGroup) {
                ((ViewGroup) container.getParent()).removeView(container);
            }
        } catch (Throwable ignored) {
            // Teardown must never throw into the app.
        } finally {
            adView = null;
            container = null;
            currentUnitId = null;
        }
    }

    private static AdSize adaptiveSize(@NonNull Activity activity) {
        try {
            int widthDp = (int) (
                activity.getResources().getDisplayMetrics().widthPixels
                    / activity.getResources().getDisplayMetrics().density
            );
            return AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp);
        } catch (Throwable ignored) {
            return AdSize.BANNER;
        }
    }

    /** Shared request builder; keeps the personalization signal in one place. */
    static final class AdRequestFactory {
        private AdRequestFactory() {}

        static AdRequest build(boolean nonPersonalized) {
            AdRequest.Builder builder = new AdRequest.Builder();
            if (nonPersonalized) {
                android.os.Bundle extras = new android.os.Bundle();
                extras.putString("npa", "1");
                builder.addNetworkExtrasBundle(
                    com.google.ads.mediation.admob.AdMobAdapter.class,
                    extras
                );
            }
            return builder.build();
        }
    }
}
