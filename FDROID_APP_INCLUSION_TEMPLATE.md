# F-Droid App Inclusion Request — TravelMate

## Checklist

- [x] App is licensed under GPL-3.0-only (LICENSE file present in repository root)
- [x] Source code is publicly available at https://github.com/satvika1115/TravelMate
- [x] No proprietary dependencies — all routing computation is on-device using bundled GTFS data
- [x] No third-party analytics SDKs or tracking libraries included
- [x] No account or login required
- [x] No personal data collected or transmitted to any server
- [x] AndroidManifest.xml uses only INTERNET, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION permissions
- [x] App ID (applicationId) is com.satvika.travelmate
- [x] versionCode and versionName set in frontend/android/app/build.gradle
- [x] Git tag v0.9.0-beta exists and points to a buildable commit
- [x] Fastlane metadata present at fastlane/metadata/android/en-US/
- [x] F-Droid recipe file present at com.satvika.travelmate.yml (repository root)
- [ ] Screenshots provided in fastlane/metadata/android/en-US/screenshots/ (see README.txt in that directory)
- [ ] Signing keystore removed or excluded from the build for F-Droid (F-Droid re-signs with its own key)

---

## App Description

**Name:** TravelMate Beta  
**Package ID:** com.satvika.travelmate  
**License:** GPL-3.0-only  
**Version:** 0.9.0-beta (versionCode 1)  
**Category:** Navigation  

TravelMate is a multimodal public transit route planner for Hyderabad, India. It plans journeys across all three Hyderabad Metro lines, MMTS suburban rail, and over 1,099 TSRTC bus routes. All routing runs entirely on-device using bundled GTFS data — no backend server, no account, no tracking.

---

## Source Code Location

- **Repository:** https://github.com/satvika1115/TravelMate
- **Issue Tracker:** https://github.com/satvika1115/TravelMate/issues
- **Release Tag:** v0.9.0-beta
- **Tag Commit:** 8744b75e54959bbbbe405f04dfaf497461dae32d

---

## Build Instructions

### Prerequisites

- Node.js 18+ and npm
- Android SDK (API 36 / compileSdkVersion 36)
- Android SDK minimum API 24 (minSdkVersion 24)
- Java 21 (sourceCompatibility and targetCompatibility set to VERSION_21 in capacitor.build.gradle)
- Gradle 8.13.0 (AGP version in frontend/android/build.gradle)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/satvika1115/TravelMate.git
cd TravelMate

# 2. Install frontend dependencies
cd frontend
npm install

# 3. Build the production web assets
npm run build

# 4. Sync Capacitor (copies dist/ into the Android project)
npx cap sync android

# 5. Build the Android APK
cd android
./gradlew assembleRelease
```

The release APK will be produced at:
`frontend/android/app/build/outputs/apk/release/app-release.apk`

### F-Droid Build Recipe

The F-Droid recipe is at `com.satvika.travelmate.yml` in the repository root.

```yaml
subdir: frontend/android
gradle:
  - release
```

Note for F-Droid builders: The build requires the Capacitor web asset sync step before Gradle runs. This can be handled via a `prebuild` script or by ensuring the `frontend/android/app/src/main/assets/public/` directory is committed to the repository. Currently the web assets are not pre-committed; a `prebuild` entry may be needed in the recipe.

---

## Notes for Reviewers

1. **Web assets in Android build:** This is a Capacitor (Ionic) hybrid app. The Android project wraps a React/Vite web app. The bundled assets in `frontend/android/app/src/main/assets/public/` must be present before Gradle can build. The F-Droid build recipe may need a `prebuild` step:
   ```yaml
   prebuild:
     - cd ../../ && npm install && npm run build && npx cap sync android
   ```
   Verify this against the F-Droid server environment.

2. **Signing config in build.gradle:** The `build.gradle` contains a `signingConfigs.release` block referencing `travelmate-release.jks`. F-Droid ignores app-provided signing configs and re-signs with its own key. The keystore file is not committed to the repository.

3. **Permissions:** The app requests `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` for the "pick location on map" feature and GPS-based origin detection. These are runtime permissions; the app functions without them (manual address entry is supported).

4. **INTERNET permission:** Used for: Nominatim reverse geocoding (OpenStreetMap), OpenWeatherMap API calls for live weather/AQI, and Leaflet map tile loading. All external calls are optional; routing works fully offline.

5. **usesCleartextTraffic="true":** Present in AndroidManifest.xml for local development compatibility. For a production F-Droid build this should ideally be removed or restricted via a Network Security Config. This is a known beta limitation.

6. **No anti-features:** The app has no ads, no proprietary network services, no non-free dependencies, and no tracking. All GTFS data is bundled from official public feeds.

7. **Tag format:** Tags follow the pattern `v<semver>` (e.g., `v0.9.0-beta`). The `AutoUpdateMode` in the recipe is set to `Version v%v` accordingly.

---

## Merge Request Text

See the section below for the exact text to paste into the F-Droid data merge request.

---

## F-Droid Data Merge Request Text

```
## New app: com.satvika.travelmate (TravelMate Beta)

### Summary

TravelMate is a multimodal public transit route planner for Hyderabad, India.
It plans journeys across Hyderabad Metro (all 3 lines), MMTS suburban rail,
and 1,099+ TSRTC bus routes. All routing runs on-device using bundled GTFS
data — no backend, no account, no tracking.

### Checklist

- License: GPL-3.0-only ✓
- No proprietary dependencies ✓
- No tracking / analytics SDKs ✓
- No account required ✓
- Source: https://github.com/satvika1115/TravelMate
- Build recipe: com.satvika.travelmate.yml

### Build notes

This is a Capacitor hybrid app (React/Vite wrapped in Android). The build
requires a `prebuild` npm step to produce the web assets before Gradle runs.
The recipe `subdir` is `frontend/android`.

### Version

- versionName: 0.9.0-beta
- versionCode: 1
- tag: v0.9.0-beta
- commit: 8744b75e54959bbbbe405f04dfaf497461dae32d
```
