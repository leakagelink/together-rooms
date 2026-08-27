package com.synctogether.com;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.synctogether.com.ads.AdsPlugin;

/**
 * PHASE 14 — the ads plugin is registered here, and only here, so there is
 * exactly one native ad entry point for the WebView. The plugin itself does no
 * policy work: consent, Premium suppression, the placement allow-list and the
 * frequency caps are all decided in the web layer before it is ever called.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AdsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
