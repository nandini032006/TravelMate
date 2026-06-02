# TravelMate Beta — Hyderabad Transit Intelligence

> **Public Beta · v0.9.0-beta**
> A civic-tech multimodal transit planner for Hyderabad — Bus, Metro, MMTS, RidePool and City Analytics in one offline-capable, bilingual app.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.9.0--beta-orange)](https://github.com/satvika1115/TravelMate/releases)
[![Platform](https://img.shields.io/badge/platform-Android%207%2B%20%7C%20Web-brightgreen)](https://github.com/satvika1115/TravelMate)

---

## Overview

Hyderabad's transit network spans **1,099+ RTC bus routes**, **3 metro lines**, and **MMTS suburban rail** — but no single app connects all three for a commuter who needs to switch modes mid-journey. TravelMate fills that gap with real GTFS data, zero backend dependency, and a professional planning dashboard.

---

## Features

### Transit Planning
| Feature | Details |
|---------|---------|
| Multimodal routing | Bus, Metro, MMTS — with auto-rickshaw last-mile |
| Transfer planning | 0 and 1-transfer routes across all modes |
| Smart strategies | Fastest, cheapest, least walking, metro-preferred, MMTS-preferred |
| Autocomplete | Prefix + substring + fuzzy (typo-tolerant) stop search |
| Bilingual | English + Telugu (తెలుగు) — 180+ station name translations |
| GPS location | One-tap "Use my location" with reverse geocoding |
| Recent places | Last 5 searched locations (localStorage) |
| URL sharing | `?from=lat,lon,name&to=lat,lon,name` deep links |
| Real map lines | GTFS shape polylines for accurate metro route curves |
| Offline-capable | Full routing offline; geocoding degrades gracefully |

### Live Conditions
| Feature | Details |
|---------|---------|
| Live traffic | TomTom congestion data along your route (optional API key) |
| Weather | OpenWeather conditions affecting your journey |
| AQI | Air quality index with commuter health advisory |
| Safety analysis | Risk zone detection and alerts along routes |

### RidePool (Beta)
| Feature | Details |
|---------|---------|
| Ride matching | Community carpooling with dynamic matching algorithm |
| Community wallet | Points system — 1 pt = ₹1 fuel share |
| RidePool map | Live demand heatmap across Hyderabad |

### Hyderabad Live Analytics
| Feature | Details |
|---------|---------|
| GIS heatmap | City-wide 3-pass canvas heatmap — smooth, professional gradients |
| Zone scores | Mobility, Metro access, Bus coverage, Safety, Traffic per area |
| Transit deserts | Identifies underserved zones needing intervention |
| Area search | Search any neighbourhood, zoom and highlight on map |

### Accessibility & Quality
| Feature | Details |
|---------|---------|
| Accessible | ARIA roles, live regions, keyboard nav, skip link |
| Android APK | Capacitor 8 native build (Android 7+) |
| Privacy | No account required, no personal data collected |

---

## Transit Coverage

| Mode | Coverage |
|------|----------|
| RTC Bus | 1,099 routes · 3,676 stops across Hyderabad & Secunderabad |
| Metro | Red, Green, Blue lines · 57 stations · GTFS shape polylines |
| MMTS | 20 corridors · 54 stations · suburban rail network |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3 · Vite 7 · plain CSS |
| Map | Leaflet 1.9 · OpenStreetMap · CARTO tiles |
| Animation | Framer Motion 12 |
| Geocoding | Photon (komoot) + Nominatim — free, no key required |
| Mobile | Capacitor 8 (Android) |
| Data | Node.js GTFS pipeline (csv-parse) |
| Live data | TomTom Traffic · OpenWeatherMap · OpenWeatherMap AQI (optional) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Run locally

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000 (or next available port)
```

### Build for production

```bash
cd frontend
npm run build
# Output in frontend/dist/
```

### Build Android APK

```bash
cd frontend
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## Environment Variables

Copy `frontend/.env.example` to `frontend/.env` for optional live integrations:

```env
VITE_TOMTOM_KEY=        # TomTom Traffic — live congestion along routes
VITE_WEATHER_KEY=       # OpenWeatherMap — weather + AQI overlays
```

All variables are optional. The app is fully functional for offline routing without any API keys.

---

## Project Structure

```
TravelMate/
├── CHANGELOG.md                        # Release notes
├── LICENSE                             # GPL-3.0-only
├── fdroid-recipe.yml                   # F-Droid submission recipe
├── fastlane/
│   └── metadata/android/en-US/        # Store listing, changelogs, screenshots
├── scripts/                            # GTFS preprocessing pipeline
│   ├── processBusGTFS.js              # 1,099 RTC routes → bus.json
│   ├── processMetroGTFS.js            # Metro + shapes → metro.json
│   └── processMmtsGTFS.js             # 20 MMTS corridors → mmts.json
└── frontend/
    ├── index.html                      # Entry HTML — PWA + OG meta tags
    ├── public/manifest.json            # PWA manifest
    ├── android/                        # Capacitor Android project
    └── src/
        ├── version.js                  # Centralized version config (0.9.0-beta)
        ├── App.jsx                     # Root — tab routing, layout
        ├── main.jsx                    # Entry — polyfills, viewport fix
        ├── components/
        │   ├── ErrorBoundary.jsx       # Global crash recovery
        │   ├── Navbar/                 # Header — branding, weather, wallet, lang
        │   ├── SearchPanel/            # Location inputs, GPS, swap
        │   ├── MapView/                # Leaflet map, polylines, risk zones
        │   ├── RouteResults/           # Strategy cards + route cards
        │   ├── Analytics/              # Hyderabad Live GIS heatmap + area search
        │   └── RidePool/               # Carpooling — list, map, offer, chat
        ├── hooks/
        │   ├── useRouting.js           # Route planning orchestration
        │   ├── useLiveConditions.js    # Traffic, weather, AQI, infra
        │   ├── useAutocomplete.js      # Debounced stop + geocode search
        │   ├── useGeolocation.js       # GPS + reverse geocode
        │   ├── useKeyboard.js          # Android soft-keyboard detection
        │   ├── useOnlineStatus.js      # Online/offline detection
        │   └── useRecentLocations.js   # localStorage recent places
        ├── services/
        │   ├── transitData.js          # GTFS loader, stop index, fuzzy search
        │   ├── liveTraffic.js          # TomTom congestion API
        │   ├── weather.js              # OpenWeather current conditions
        │   ├── aqi.js                  # OpenWeather air pollution API
        │   ├── photon.js               # Photon geocoding
        │   ├── nominatim.js            # Reverse geocoding
        │   └── overpass.js             # OSM infrastructure query
        ├── utils/
        │   ├── router.js               # Multimodal pathfinding engine
        │   ├── routeComparison.js      # Fastest/cheapest/safest analysis
        │   ├── commuterIntelligence.js # Strategy generation engine
        │   ├── areaScoring.js          # Mobility score per Hyderabad zone
        │   ├── routeSafety.js          # Risk zone detection
        │   ├── dynamicPricing.js       # Fare estimation
        │   ├── modeColors.js           # Transit mode colour metadata
        │   └── formatters.js           # Duration, distance, cost (EN/TE)
        ├── contexts/
        │   └── LanguageContext.jsx     # EN/TE toggle + localStorage
        ├── translations/
        │   ├── en.js                   # English UI strings
        │   ├── te.js                   # Telugu UI strings
        │   └── stationNames.js         # 180+ EN ↔ TE station name mappings
        └── data/
            ├── bus.json                # Preprocessed bus routes + stops
            ├── metro.json              # Metro lines + GTFS shape polylines
            ├── mmts.json               # MMTS corridors
            ├── fares.json              # Fare tables by mode & distance
            ├── riskAreas.json          # Safety risk zone coordinates
            └── hyderabadAreas.js       # Zone definitions for analytics
```

---

## How Routing Works

1. **Nearby stops** — find all transit stops within walking distance (Bus: 1 km, MMTS: 1.5 km, Metro: 2 km)
2. **Direct routes** — O(1) lookup via pre-built `directRouteIndex[boardStop][alightStop]`
3. **Transfer routes** — if no direct, try downstream stops as transfer points
4. **Bidirectional** — all routes tried in both forward and reverse directions
5. **Scoring** (0–100) — transfers (dominant), mode quality, frequency, walk distance, duration
6. **Strategy generation** — Least Waiting, Fastest Arrival, Metro Preferred, Bus Preferred, Local Commuter
7. **Deduplication** — fingerprint by transit route-ID sequence
8. **Tagging** — fastest, cheapest, min-walk badges applied per route

---

## Data Pipeline

To regenerate transit JSON from fresh GTFS feeds:

```bash
# From repo root
npm install              # installs csv-parse
npm run process:all      # all three modes
npm run process:bus      # bus only
npm run process:metro    # metro only
npm run process:mmts     # MMTS only
```

Place GTFS `.txt` files in `data/bus_data/`, `data/metro_data/`, `data/mmts_data/`.

---

## Known Limitations (Beta)

| Issue | Status |
|-------|--------|
| No real-time TSRTC/Metro live departure data | No public API available |
| Fare estimates are approximate (distance-based) | Known |
| Walk paths follow straight lines, not actual roads | Use ORS API key for road-following paths |
| RidePool matching uses simulated demand in beta | Live matching planned post-beta |
| Route coverage continues improving with GTFS updates | Ongoing |

---

## F-Droid

TravelMate Beta is being prepared for F-Droid. See `fdroid-recipe.yml` and `com.satvika.travelmate.yml` for the submission recipe.

App ID: `com.satvika.travelmate`
License: GPL-3.0-only

---

## Feedback

Found a bug or have a suggestion?

- **Report Issue** — [GitHub Issues](https://github.com/satvika1115/TravelMate/issues/new?labels=bug)
- **Suggest Feature** — [GitHub Issues](https://github.com/satvika1115/TravelMate/issues/new?labels=enhancement)

---

## License

**GPL-3.0-only** — free to use, study, modify and distribute under the same license.
See [LICENSE](./LICENSE) for full text.

---

> TravelMate Beta · v0.9.0-beta · Built for Hyderabad commuters
> Metro · Bus · MMTS · RidePool · City Analytics
