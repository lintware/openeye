# 🛰️ OpenEye

**Lean open-source satellite & flight tracker.** Live aircraft, satellites, time controls. No API keys needed.

![JavaScript](https://img.shields.io/badge/javascript-ES6+-yellow)
![License](https://img.shields.io/badge/license-MIT-green)
![Dependencies](https://img.shields.io/badge/dependencies-1%20(express)-lightgrey)

## What is this?

OpenEye is a real-time 3D globe that tracks **live aircraft** via OpenSky Network and **active satellites** via CelesTrak TLE data — all in your browser. No accounts, no API keys, no setup friction.

## Features

- **🛩️ Live Aircraft** — Real-time positions from OpenSky Network, auto-refreshing every 10 seconds
- **🛰️ Satellite Tracking** — Active satellites from CelesTrak NORAD TLE catalog, propagated client-side
- **⏱️ Time Controls** — Speed up, slow down, or jump to any point in time to see orbital mechanics
- **🎯 Aircraft Classification** — Automatically identifies commercial, military, cargo, and private aircraft
- **✈️ Flight Trails** — Track aircraft paths over time
- **🌍 3D Globe** — CesiumJS-powered globe with terrain, atmosphere, and night sky
- **🔍 Layer Toggles** — Show/hide aircraft and satellite layers independently
- **📡 Zero Config** — No API keys required, all data sources are public

## Quick Start

```bash
git clone https://github.com/lintware/openeye.git
cd openeye

npm install
npm start
```

Open `http://localhost:8526` in your browser.

## How It Works

```
┌──────────────┐     ┌──────────────┐
│ OpenSky API  │     │  CelesTrak   │
│ (aircraft)   │     │  (TLE data)  │
└──────┬───────┘     └──────┬───────┘
       │  HTTP/JSON         │  TLE text
       ▼                    ▼
┌──────────────────────────────────┐
│         Browser (app.js)         │
│  • SGP4 orbit propagation       │
│  • Aircraft position mapping    │
│  • Military callsign detection  │
│  • Trail rendering              │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│          CesiumJS Globe          │
│  • 3D terrain + atmosphere      │
│  • Entity rendering             │
│  • Time animation               │
└──────────────────────────────────┘
```

1. **Aircraft**: Fetches live state vectors from [OpenSky Network](https://opensky-network.org/) every 10 seconds. Each aircraft is classified (commercial/military/cargo/private) based on callsign patterns and ICAO category.

2. **Satellites**: Fetches Two-Line Element (TLE) data from [CelesTrak](https://celestrak.org/). Satellite positions are propagated client-side using SGP4, so they move in real-time without re-fetching.

3. **Time Controls**: A virtual clock lets you speed up time (1x → 100x) to watch orbital mechanics in action, or jump to specific timestamps.

## Data Sources

| Source | Data | Refresh | Auth |
|--------|------|---------|------|
| [OpenSky Network](https://opensky-network.org/) | Live aircraft positions | 10s | None (public API) |
| [CelesTrak](https://celestrak.org/) | Satellite TLE catalog | On load | None |

## Project Structure

```
openeye/
├── server.js          # Express static server
├── package.json
└── public/
    ├── index.html     # Main page + CesiumJS loader
    ├── app.js         # Core logic (603 lines)
    └── style.css      # UI styling
```

## Tech Stack

- **Frontend**: Vanilla JavaScript + [CesiumJS](https://cesium.com/) (3D globe)
- **Backend**: Express.js (static file server only)
- **Orbit Math**: SGP4 propagation (client-side)
- **Zero build step** — no bundler, no framework, just files

## Customization

### Change Default View

Edit the CesiumJS viewer initialization in `public/app.js` to set a different home position.

### Add More Satellite Groups

CelesTrak offers many [satellite groups](https://celestrak.org/NORAD/elements/). Change the `CELESTRAK_URL` in `app.js`:

```javascript
// Track only GPS satellites
const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle';

// Track only Starlink
const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle';
```

### Aircraft Refresh Rate

```javascript
const AIRCRAFT_REFRESH_MS = 10000;  // 10 seconds (default)
const AIRCRAFT_REFRESH_MS = 30000;  // 30 seconds (lighter on API)
```

## License

MIT

---

Built with 🔥 by [Lint Labs](https://github.com/lintware)
