# AREO · Marswalk Mission Studio

**Team CHITRA — NASA Space Apps Challenge project**

[Download AREO 1.2 for Windows x64](https://github.com/arnavgupta714/AREO-Marswalk-Studio/releases/tag/submission-v1.2.0) · [Watch the 26-second demo](https://github.com/arnavgupta714/AREO-Marswalk-Studio/releases/download/submission-v1.2.0/AREO-1.2-Demo.webm)

**SI disclosure.** OpenAI Codex assisted with research, development, testing, and documentation. The submission demo is a recording of the running app with SI-assisted captions. The data pack uses attributed NASA and USGS observations. AREO's routing and Mars clock run deterministic calculations.

AREO is an offline Windows Marswalk planner for western Jezero Crater. Field operations runs A* on a measured USGS CTX elevation grid and aligns route samples to an orbital mosaic in the same projection. Plan a round trip within grade, time, daylight and reserve limits. Mark a no-go cell to replan the traverse, or enter a reported crew position and elapsed time to calculate the quickest modeled return. The training workspace is available from the map icon in the rail.

Choose **Route to a point**, then tap the map to preview a round trip from your habitat to any measured cell. The original itinerary stays in place until you choose **Replace itinerary with this destination**. Zoom in and drag to pan. The measured offline pack covers about 5.64 × 4.76 km of western Jezero.

The route engine, solar clock, 3D relief, coordinate transforms and exports run locally. Walk speed, habitat and science stations are mission assumptions. Regional elevation samples cannot resolve footing hazards. See [data provenance](docs/DATA_SOURCES.md), [routing assumptions](docs/ROUTING.md), and [Mars coordinates and solar time](docs/MARS_COORDINATES_AND_TIME.md).

## Run on Windows

The built portable app is written to:

```text
release/AREO-Marswalk-Studio-1.2.0-Windows-x64.exe
```

Double-click the executable. No development tools or local server are required for the packaged app. The competition build is unsigned; Windows may show an unknown-publisher prompt. Release binaries are generated artifacts, excluded from source control.

The build also produces a `.sha256` checksum and `release-info.json` beside the executable for validating a copied distribution.

## Develop

Install Node.js 24 LTS and pnpm 11 or later, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. To run the development UI in its desktop shell:

```sh
pnpm desktop:dev
```

## Verify and build

```sh
pnpm test
pnpm build
pnpm desktop:build
pnpm test:desktop
```

`pnpm build` runs strict TypeScript checks and generates `dist/`. `pnpm desktop:build` creates the Windows x64 portable executable. `pnpm desktop:run` opens the last built `dist/` in Electron. Dependency installation and the first desktop build need internet access to download the toolchain; running the built app does not.

`pnpm test:desktop` opens the packaged runtime in a hidden test window and verifies rendering, bundled assets, local data access, and renderer isolation. `pnpm test:ui` runs the browser interaction suite.

`pnpm test:portable` launches the portable wrapper itself using a temporary profile.

Run `pnpm exec playwright install chromium` before the first browser test run. The [verification notes](docs/VERIFICATION.md) describe the checked workflows.

## Project layout

```text
src/                 React interface, mission state, planning engine
src/lib/             Route calculations and mission state helpers
tests/               Meaningful engine tests
public/assets/       Bundled NASA imagery and team artwork
public/data/         Scientific context and source catalog
electron/            Sandboxed Windows desktop host
scripts/             Development runner and reproducible data download
docs/                Architecture, provenance, model assumptions, demo guide
dist/                Generated browser application (ignored)
release/             Generated desktop distribution (ignored)
```

The repository contains the complete original application, bundled demonstration data, imagery credits, and dependency lockfile. It does not attempt to mirror NASA's full archives. NASA mission archives remain the authoritative sources.

## Competition material

- [Architecture](docs/ARCHITECTURE.md)
- [Scientific sources and asset credits](docs/DATA_SOURCES.md)
- [Route model and limitations](docs/ROUTING.md)
- [Mars coordinates and solar time](docs/MARS_COORDINATES_AND_TIME.md)
- [Demo walkthrough](docs/DEMO_SCRIPT.md)
- [Submission draft](docs/SUBMISSION.md)
- [Interface and workflow verification](docs/VERIFICATION.md)

Original project code is MIT licensed. Third-party assets and supplied team artwork retain their respective rights; the MIT license does not relicense NASA/USGS imagery or imply NASA endorsement.
