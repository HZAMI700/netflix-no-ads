package com.streamnaro.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.Set;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private FrameLayout fullscreenContainer;

    // Comprehensive list of known ad networks, pop-under engines, and rogue redirect domains
    private static final String[] AD_HOST_PATTERNS = {
        "popads", "propellerads", "adcash", "monetag", "exoclick",
        "histats", "adnxs", "doubleclick", "adservice", "adsystem",
        "clickadu", "hilltopads", "richpush", "trafficjunky", "juicyads",
        "adsterra", "clicksor", "trafficstars", "yektanet", "bet365",
        "1xbet", "1win", "mostbet", "melbet", "deloton", "onclick",
        "adx", "adform", "vdo.ai", "directrev", "zeroredirect",
        "ptengine", "clarium", "amung.us", "onclickprediction",
        "syndication", "adsco.re", "alwingulla", "dexpredict",
        "creative.akamaized.net", "ad.traffic", "popunder",
        "fastclick", "revenuehits", "popcash", "bidvertiser",
        "infolinks", "admaven", "trafficfactory", "eroadvertising",
        "tsyndicate", "tsyndication", "plugrush", "rtmark",
        "ad-maven", "onclicksuper", "adbit", "yllix",
        "bidgear", "galaksion", "clickaine", "adtelligent", "adtrue",
        "pubfuture", "adoperator", "adkeeper", "adster", "trafficforce",
        "onclickperformance", "onclickalgo", "go.ad2up", "oclaserver",
        "mcloud", "pushbullet", "ad-delivery", "feedaty", "adcolony",
        "adroll", "taboola", "outbrain", "mgid", "revcontent",
        "adblade", "adkernel", "trackvoluum", "voluumtrk", "propeller"
    };

    private static boolean isAdUrl(String urlStr) {
        if (urlStr == null) return false;
        String lower = urlStr.toLowerCase();
        for (String pattern : AD_HOST_PATTERNS) {
            if (lower.contains(pattern)) return true;
        }
        return false;
    }

    private static boolean isAllowedStreamingOrCdnHost(String host) {
        if (host == null || host.isEmpty()) return false;
        return host.contains("vidsrc") ||
               host.contains("vaplayer") ||
               host.contains("vidapi") ||
               host.contains("nextgencloudfabric") ||
               host.contains("cloudflare") ||
               host.contains("tmdb") ||
               host.contains("themoviedb") ||
               host.contains("opensubtitles") ||
               host.contains("strem") ||
               host.contains("gstatic") ||
               host.contains("googleapis") ||
               host.contains("google");
    }

    @SuppressLint({"SetJavaScriptEnabled"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // System bars coloring for dark cinema theme
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#141414"));
        window.setNavigationBarColor(Color.parseColor("#141414"));

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webView);
        fullscreenContainer = findViewById(R.id.fullscreenContainer);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setUserAgentString(ws.getUserAgentString() + " StreamnaroApp/1.0");

        // Native Popunder / Popup Blocker:
        // Set supportMultipleWindows to true so that window.open() triggers onCreateWindow
        // where we intercept with a throwaway WebView and drop it immediately.
        ws.setSupportMultipleWindows(true);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);

        // 100% POPUNDER DEFUSER: Inject into EVERY frame and iframe at document-start before any ad scripts run
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Set<String> allowedOrigins = Collections.singleton("*");
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                "(function() {" +
                "  try {" +
                "    var noop = function() { return null; };" +
                "    try { Object.defineProperty(window, 'open', { value: noop, writable: false, configurable: false }); } catch(e) { window.open = noop; }" +
                "    if (window.Window && window.Window.prototype) {" +
                "      try { Object.defineProperty(window.Window.prototype, 'open', { value: noop, writable: false, configurable: false }); } catch(e) { window.Window.prototype.open = noop; }" +
                "    }" +
                "    window.alert = function() {};" +
                "    window.confirm = function() { return false; };" +
                "    window.prompt = function() { return null; };" +
                "    try {" +
                "      var origClick = HTMLAnchorElement.prototype.click;" +
                "      HTMLAnchorElement.prototype.click = function() {" +
                "        var t = (this.getAttribute('target') || '').toLowerCase();" +
                "        if (t === '_blank' || t === '_top' || t === '_parent') {" +
                "          var h = (this.getAttribute('href') || '').toLowerCase();" +
                "          if (!h.includes('videodownloader.site') && !h.includes('vidvault.to') && !h.includes('02moviedownloader.site')) {" +
                "            return;" +
                "          }" +
                "        }" +
                "        return origClick.apply(this, arguments);" +
                "      };" +
                "    } catch(e) {}" +
                "  } catch(e) {}" +
                "})();",
                allowedOrigins
            );
        }

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String urlStr = request.getUrl().toString();
                // Network-level ad blocking: return empty response for ad & pop-under domains
                if (isAdUrl(urlStr)) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream("".getBytes()));
                }
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String host = url.getHost() != null ? url.getHost().toLowerCase() : "";
                String urlStr = url.toString().toLowerCase();

                // 1. Internal Streamnaro app assets — allow navigation
                if (host.equals("appassets.androidplatform.net")) {
                    return false;
                }

                // 2. Legitimate user download actions (OmniSave, VidVault, 02MovieDownloader)
                if (host.contains("videodownloader.site") || host.contains("vidvault.to") || host.contains("02moviedownloader.site")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, url);
                        view.getContext().startActivity(intent);
                    } catch (Exception ignored) {}
                    return true;
                }

                // 3. Immediately block any recognized ad or popunder pattern
                if (isAdUrl(urlStr)) {
                    return true;
                }

                // 4. Main frame protection: NEVER allow external websites or rogue redirects
                // to navigate or replace the main Streamnaro app interface!
                if (request.isForMainFrame()) {
                    return true;
                }

                // 5. Subframe protection: allow only legitimate streaming and CDN domains to load subframes.
                if (isAllowedStreamingOrCdnHost(host)) {
                    return false;
                }

                // Block any unapproved subframe navigation
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // 100% Intercept all popup and popunder window creation attempts.
                // If we return false, Android WebView defaults to launching the system browser (Chrome)!
                // Instead, handle it with an invisible throwaway WebView that is immediately destroyed.
                if (resultMsg != null) {
                    try {
                        WebView dummy = new WebView(MainActivity.this);
                        dummy.setWebViewClient(new WebViewClient() {
                            @Override
                            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                                v.destroy();
                                return true;
                            }
                            @Override
                            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                                v.stopLoading();
                                v.destroy();
                            }
                            @Nullable
                            @Override
                            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream("".getBytes()));
                            }
                        });
                        WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                        transport.setWebView(dummy);
                        resultMsg.sendToTarget();
                        return true;
                    } catch (Exception ignored) {}
                }
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    onHideCustomView();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                fullscreenContainer.setVisibility(View.VISIBLE);
                fullscreenContainer.addView(view);
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                webView.setVisibility(View.VISIBLE);
                fullscreenContainer.setVisibility(View.GONE);
                fullscreenContainer.removeView(customView);
                customView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        });

        // Modern Back press handling
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) {
                    if (webView.getWebChromeClient() != null) {
                        webView.getWebChromeClient().onHideCustomView();
                    }
                    return;
                }
                // Check if user is inside player view or modal
                webView.evaluateJavascript(
                    "(function() {" +
                    "  var pv = document.getElementById('playerView');" +
                    "  if (pv && pv.classList.contains('show')) {" +
                    "    var pb = document.getElementById('pBack');" +
                    "    if (pb) { pb.click(); return 'handled'; }" +
                    "  }" +
                    "  var db = document.getElementById('detailBackdrop');" +
                    "  if (db && db.classList.contains('show')) {" +
                    "    var dc = document.getElementById('detailClose');" +
                    "    if (dc) { dc.click(); return 'handled'; }" +
                    "  }" +
                    "  return 'none';" +
                    "})()",
                    val -> {
                        if (val != null && val.contains("handled")) {
                            // Handled in webview
                        } else if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                        }
                    }
                );
            }
        });

        // Load the local app bundle securely
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
