# SyncTogether — Phase 14.2 deterministic release gate

## Regression finding

The reproduced failure was
`scripts/security/local-media-realtime.test.ts` → **LM-RT3 playback control
propagates with a strictly increasing version**. Before the fix it failed in
3 of 5 controlled isolated runs with `expected 0 to be greater than 0`.

The database mutation succeeded, but the test collected rows for a fixed six
seconds and then asserted. Realtime delivery could arrive after that sampling
window. Subscription readiness was already observed, so the remaining race was
between replication delivery and an elapsed-time assertion. The harness now
completes when it observes the exact higher-version row. Its deadline is only a
failure bound. Channel removal runs in `finally`, including when the mutation or
assertion fails. Negative delivery remains a bounded observation because the
absence of an event cannot be proven by a positive event.

## CI compilation gate

`.github/workflows/android-build.yml` checks out the triggering revision, pins
Bun and JDK 21, installs Android platform 36/build-tools 36.0.0, restores the
Gradle cache through the official action, builds and syncs the real Capacitor
project, and invokes the checked-in wrapper from `android/`:

```text
./gradlew assembleDebug --no-daemon --console=plain --stacktrace
./gradlew assembleRelease --no-daemon --console=plain --stacktrace
```

There is no `continue-on-error`, signing secret, artifact upload, publication,
or deployment step. `assembleRelease` is deliberately unsigned in CI and still
exercises Java compilation, resource processing, R8, and ProGuard rules.

## Owner build procedure — Windows PowerShell

These are owner commands, not claims that they were executed in this workspace.

```powershell
# 1. Verify JDK 21.
java -version
$env:JAVA_HOME

# 2. Verify Android SDK tools and required packages.
$env:ANDROID_HOME
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --list_installed
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platforms;android-36" "build-tools;36.0.0" "platform-tools"

# 3. Persist ANDROID_HOME for future PowerShell sessions, then update this session.
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Users\<OWNER>\AppData\Local\Android\Sdk", "User")
$env:ANDROID_HOME = "C:\Users\<OWNER>\AppData\Local\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin"

# 4. Create the local-only SDK pointer if Gradle cannot discover ANDROID_HOME.
Set-Content -Path .\android\local.properties -Value "sdk.dir=$($env:ANDROID_HOME -replace '\\','\\')"

# 5. Install/sync the exact web and native dependencies.
bun install --frozen-lockfile
bun run build
bunx cap sync android
Set-Location .\android
.\gradlew.bat dependencies --no-daemon --console=plain

# 6. Compile the debug APK.
.\gradlew.bat assembleDebug --no-daemon --console=plain --stacktrace

# 7. Compile and shrink an unsigned release APK. Clear signing variables first.
Remove-Item Env:ANDROID_KEYSTORE_PATH,Env:ANDROID_KEYSTORE_PASSWORD,Env:ANDROID_KEY_ALIAS,Env:ANDROID_KEY_PASSWORD,Env:REQUIRE_SIGNED_RELEASE -ErrorAction SilentlyContinue
.\gradlew.bat assembleRelease --no-daemon --console=plain --stacktrace

# 8. Build the owner-controlled signed release AAB.
$env:ANDROID_KEYSTORE_PATH = "C:\keys\synctogether.jks"
$env:ANDROID_KEYSTORE_PASSWORD = Read-Host "Keystore password" -MaskInput
$env:ANDROID_KEY_ALIAS = Read-Host "Key alias"
$env:ANDROID_KEY_PASSWORD = Read-Host "Key password" -MaskInput
$env:VERSION_CODE = "<NEXT_PLAY_VERSION_CODE>"
$env:REQUIRE_SIGNED_RELEASE = "true"
.\gradlew.bat bundleRelease --no-daemon --console=plain --stacktrace
```

Do not paste passwords into command history or CI logs. The signed output is
`android/app/build/outputs/bundle/release/app-release.aab`; the keystore and
passwords remain owner-controlled and are ignored by source control.

## Honest release boundary

- Web regression, lint, typecheck and web build can be verified here.
- Native source/configuration and CI commands are code-verified here.
- Native compilation is **not** verified until Gradle actually runs locally or
  the workflow reports success.
- Signing, Play upload, UMP/AdMob serving, and lifecycle behavior require the
  owner's credentials, Play configuration, and real Android devices.