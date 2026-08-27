package com.synctogether.com;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

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
 *
 * HTML5 FULLSCREEN — the stock Capacitor chrome client ignores
 * onShowCustomView, so the YouTube player's fullscreen button silently does
 * nothing. A FullscreenWebChromeClient swaps the player's fullscreen view into
 * a decor-level container and hides the system bars for the duration.
 */
public class MainActivity extends BridgeActivity {

    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private FrameLayout fullscreenContainer;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AdsPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebChromeClient(
                new FullscreenWebChromeClient(bridge));
        }
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

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            // Leaving fullscreen via the system back button instead of
            // popping the web history.
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            hideFullscreenView();
            return;
        }
        super.onBackPressed();
    }

    private void showFullscreenView(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;

        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(0xFF000000);
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.addView(fullscreenContainer, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decor);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        // Hide the WebView itself so nothing paints under the custom view.
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.GONE);
        }
    }

    private void hideFullscreenView() {
        if (fullscreenView == null) return;
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        if (fullscreenContainer != null) {
            fullscreenContainer.removeView(fullscreenView);
            decor.removeView(fullscreenContainer);
            fullscreenContainer = null;
        }
        fullscreenView = null;
        fullscreenCallback = null;

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decor);
        controller.show(WindowInsetsCompat.Type.systemBars());

        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setVisibility(View.VISIBLE);
        }
    }

    /** BridgeWebChromeClient plus HTML5 video fullscreen handling. */
    private class FullscreenWebChromeClient extends BridgeWebChromeClient {
        FullscreenWebChromeClient(com.getcapacitor.Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showFullscreenView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            hideFullscreenView();
        }
    }
}
