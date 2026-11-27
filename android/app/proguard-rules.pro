# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# PHASE 14 / 14.1 — release shrinking (R8) rules.
#
# Both Google SDKs ship their own consumer ProGuard rules inside their AARs, so
# NO app-side keep rule is needed for com.google.android.gms.ads.** or
# com.google.android.ump.**; broad keeps there would only defeat shrinking and
# hide real problems. Phase 14.1 removed them deliberately.
#
# What DOES need an app-side rule is our own plugin: Capacitor discovers plugin
# classes and invokes @PluginMethod methods reflectively, so R8 cannot see the
# call sites and would otherwise strip or rename them.
#
# 1. The plugin class itself must keep its name (Capacitor resolves it from the
#    registerPlugin(AdsPlugin.class) reference and reads its annotation).
-keep @com.getcapacitor.annotation.CapacitorPlugin class com.synctogether.com.ads.** { *; }
# 2. Bridge-invoked methods and the Plugin lifecycle hooks are reflective entry
#    points on any class in the ads package.
-keepclassmembers class com.synctogether.com.ads.** {
    @com.getcapacitor.PluginMethod <methods>;
    public <init>(...);
}
# 3. The Capacitor annotation must survive so the plugin name resolves at runtime.
-keepattributes *Annotation*

# 4. Keep line numbers (with an anonymous source name) so Play Console crash
#    reports can be de-obfuscated with the mapping file R8 writes into the AAB.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
#
# Never add -dontoptimize, -dontshrink, -dontobfuscate or app-wide wildcard
# keeps (-keep class ** { *; }): Play Console flags builds without real R8
# optimisation ("Improve your app's memory and performance with R8").
