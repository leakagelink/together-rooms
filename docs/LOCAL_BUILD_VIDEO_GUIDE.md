# SyncTogether — Local Android Build Guide (PowerShell + Android Studio)

> This guide matches the current project state after Phase 14.2.  
> Package name: `com.synctogether.com`  
> Published origin loaded by the WebView shell: `https://together-rooms.lovable.app`

---

## Part 1 — Prerequisites (install once)

### 1.1 JDK 21

Download and install **Eclipse Temurin JDK 21** (or any JDK 21):
https://adoptium.net/temurin/releases/?version=21

Verify in a new PowerShell window:

```powershell
java -version
```

You should see `openjdk version "21.0.x"`.

Set `JAVA_HOME` permanently:

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-21.0.x-hotspot", "User")
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.x-hotspot"
$env:Path = "$env:JAVA_HOME\bin;" + $env:Path
```

### 1.2 Android SDK

Install **Android Studio** (latest stable):
https://developer.android.com/studio

Open Android Studio → SDK Manager → SDK Platforms → install:
- `Android 16.0 (API 36)`

SDK Tools tab → install:
- `Android SDK Build-Tools 36`
- `Android SDK Platform-Tools`
- `Android SDK Command-line Tools`

Set environment variables:

```powershell
$androidSdk = "$env:LOCALAPPDATA\Android\Sdk"
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidSdk, "User")
$env:ANDROID_HOME = $androidSdk
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;" + $env:Path
```

Verify:

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --list_installed | Select-String "platforms;android-36|build-tools;36"
```

### 1.3 Bun

Install Bun 1.2.23:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Verify:

```powershell
bun --version
```

Expected: `1.2.23`

### 1.4 Git

Install Git for Windows:
https://git-scm.com/download/win

Verify:

```powershell
git --version
```

---

## Part 2 — Clone the project

```powershell
# Pick a folder, e.g. C:\Projects
Set-Location C:\Projects
git clone https://github.com/leakagelink/together-rooms.git
Set-Location together-rooms
```

---

## Part 3 — Install dependencies and build web assets

```powershell
# Use the exact lockfile so versions match CI
bun install --frozen-lockfile

# Build the production web bundle
bun run build
```

> This creates the `dist/` (or configured output) folder that Capacitor copies into the Android project.

---

## Part 4 — Sync Capacitor into the Android project

```powershell
bunx cap sync android
```

This:
- copies web assets into `android/app/src/main/assets/public`
- updates native dependencies from `capacitor.config.ts`
- refreshes `android/capacitor.settings.gradle`

---

## Part 5 — Create local SDK pointer (if Gradle cannot find ANDROID_HOME)

```powershell
Set-Location android
$escapedSdk = $env:ANDROID_HOME -replace '\\', '\\'
Set-Content -Path .\local.properties -Value "sdk.dir=$escapedSdk"
Set-Location ..
```

---

## Part 6 — Build the debug APK from PowerShell

```powershell
Set-Location android
.\gradlew.bat assembleDebug --no-daemon --console=plain --stacktrace
```

Output APK:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Install on a connected device or emulator:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

---

## Part 7 — Build unsigned release APK (to verify R8 / ProGuard)

```powershell
# Make sure no signing env vars are set from a previous attempt
Remove-Item Env:ANDROID_KEYSTORE_PATH, Env:ANDROID_KEYSTORE_PASSWORD, Env:ANDROID_KEY_ALIAS, Env:ANDROID_KEY_PASSWORD, Env:REQUIRE_SIGNED_RELEASE -ErrorAction SilentlyContinue

.\gradlew.bat assembleRelease --no-daemon --console=plain --stacktrace
```

Output:

```text
android\app\build\outputs\apk\release\app-release-unsigned.apk
```

> This APK is unsigned and cannot be installed on a device, but it proves the release toolchain (R8 + ProGuard rules) compiles correctly.

---

## Part 8 — Build signed release AAB for Play Console (owner-only)

Create or use your existing keystore.  
**Never paste passwords into command history or CI logs.**

```powershell
$env:ANDROID_KEYSTORE_PATH = "C:\keys\synctogether.jks"
$env:ANDROID_KEYSTORE_PASSWORD = Read-Host "Keystore password" -MaskInput
$env:ANDROID_KEY_ALIAS = Read-Host "Key alias"
$env:ANDROID_KEY_PASSWORD = Read-Host "Key password" -MaskInput
$env:VERSION_CODE = "1"          # Use the next Play Console version code
$env:REQUIRE_SIGNED_RELEASE = "true"

.\gradlew.bat bundleRelease --no-daemon --console=plain --stacktrace
```

Output AAB:

```text
android\app\build\outputs\bundle\release\app-release.aab
```

Upload this `.aab` to Google Play Console.

---

## Part 9 — Android Studio workflow

1. Open Android Studio.
2. Choose **Open** → select the `android` folder inside the project (not the root).
3. Wait for Gradle sync to finish.
4. Select a device or emulator from the toolbar.
5. Click **Run ▶** (or press `Shift + F10`).
6. Android Studio builds and installs the debug APK automatically.

If Gradle sync fails with "SDK not found", create `android/local.properties` as shown in Part 5, then click **Sync Project with Gradle Files** again.

---

## Part 10 — Full one-shot PowerShell script

Save as `build-debug.ps1` in the project root and run with PowerShell:

```powershell
# build-debug.ps1
$ErrorActionPreference = "Stop"

# Verify tools
java -version
bun --version

# Install JS deps and build web assets
bun install --frozen-lockfile
bun run build

# Sync native Android project
bunx cap sync android

# Point Gradle to the SDK
Set-Location android
$escapedSdk = $env:ANDROID_HOME -replace '\\', '\\'
Set-Content -Path .\local.properties -Value "sdk.dir=$escapedSdk" -NoNewline

# Compile debug APK
.\gradlew.bat assembleDebug --no-daemon --console=plain --stacktrace

Write-Host "Debug APK ready at: app\build\outputs\apk\debug\app-debug.apk"
```

Run it:

```powershell
.\build-debug.ps1
```

---

## Common errors and fixes

| Error | Fix |
| --- | --- |
| `JAVA_HOME not set` | Install JDK 21 and set environment variable |
| `sdkmanager not found` | Install Command-line Tools and add to PATH |
| `Could not find android-36` | Run `sdkmanager "platforms;android-36"` |
| `bun: command not found` | Reinstall Bun or restart PowerShell |
| `Capacitor plugin not registered` | Run `bunx cap sync android` again |
| `R8 / ProGuard failure` | Check heap: `org.gradle.jvmargs=-Xmx4096m` is already set in `android/gradle.properties` |
| `Keystore file not found` | Verify path and that the `.jks` exists before signing |

---

## What is verified automatically in CI

The GitHub Actions workflow `.github/workflows/android-build.yml` runs on every change that touches the Android project:

```text
bun install --frozen-lockfile
bun run build
bunx cap sync android
bunx vitest run src/lib/ads/android-build.test.ts
./gradlew assembleDebug
./gradlew assembleRelease
```

CI uses no secrets and signs nothing, but it proves the native code compiles on a clean Ubuntu runner.

---

## Honest build boundary

- Web build, lint, typecheck, and 596 automated tests can be verified locally with `bun run build` and `bunx vitest run`.
- Native compilation requires JDK 21 + Android SDK 36 on your Windows machine.
- Signed release builds require your own keystore and Play Console setup.
- Real AdMob serving, UMP consent dialogs, Play Billing, and lifecycle behavior can only be fully validated on a real Android device with a published Play Console internal/closed track.
