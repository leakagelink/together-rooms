package com.synctogether.com;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.synctogether.com.ads.AdsPlugin;

/**
 * PHASE 14 — the ads plugin is registered here, and only here, so there is
 * exactly one native ad entry point for the WebView. The plugin itself does no
 * policy work: consent, Premium suppression, the placement allow-list and the
 * frequency caps are all decided in the web layer before it is ever called.
 *
 * BACKGROUND AUDIO — the default BridgeActivity pauses the WebView (and its
 * media) the moment the app is backgrounded. That is undone here so that media
 * the user shares from their own device keeps playing while the app is
 * minimised. This is deliberately NOT a YouTube background-playback feature:
 * the web layer pauses every embedded YouTube player on `visibilitychange`
 * before this ever runs, which keeps the app inside YouTube's embedded player
 * terms and Play policy.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AdsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        if (bridge != null && bridge.getWebView() != null) {
            // Re-enable the WebView after Capacitor pauses it so local media
            // audio survives backgrounding. Timers stay alive with it.
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }
}
