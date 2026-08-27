package com.synctogether.com.ads;

import java.util.regex.Pattern;

/**
 * PHASE 14 — native-side identifier validation.
 *
 * The web layer already validates every ad unit id, but the native side must
 * not trust the WebView: a malformed id must produce NO ad request at all
 * rather than a request against unknown inventory.
 */
public final class AdUnitIds {

    private static final Pattern UNIT_ID = Pattern.compile("^ca-app-pub-\\d{16}/\\d{10}$");
    private static final Pattern TEST_DEVICE_ID = Pattern.compile("^[0-9A-Fa-f]{32}$");

    private AdUnitIds() {}

    public static boolean isValidUnitId(String value) {
        return value != null && UNIT_ID.matcher(value).matches();
    }

    public static boolean isValidTestDeviceId(String value) {
        return value != null && TEST_DEVICE_ID.matcher(value).matches();
    }
}
