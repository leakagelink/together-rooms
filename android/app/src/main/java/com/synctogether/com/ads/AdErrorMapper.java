package com.synctogether.com.ads;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;

/**
 * PHASE 14 — native error sanitization.
 *
 * Google's {@link AdError#getMessage()} is free-form vendor text (mediation
 * adapter names, request ids, network detail). None of it crosses the bridge:
 * only a short token does, which the web layer maps onto the Phase 12 error
 * classification.
 */
public final class AdErrorMapper {

    private AdErrorMapper() {}

    public static String token(AdError error) {
        if (error == null) return "unknown";
        switch (error.getCode()) {
            case AdRequest.ERROR_CODE_INTERNAL_ERROR:
                return "internal";
            case AdRequest.ERROR_CODE_INVALID_REQUEST:
                return "invalid_request";
            case AdRequest.ERROR_CODE_NETWORK_ERROR:
                return "network";
            case AdRequest.ERROR_CODE_NO_FILL:
                return "no_fill";
            default:
                return "unknown";
        }
    }
}
