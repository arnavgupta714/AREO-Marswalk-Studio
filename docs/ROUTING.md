# Route model and its limits

CHITRA's route engine is a deterministic, offline training-scenario planner. It demonstrates how optical context, local terrain, exclusion zones, science objectives, and a crew time reserve could be combined. **Its terrain, hazards, stop coordinates, habitat, suit parameters, and exposure field are synthetic. They are not georeferenced NASA elevation measurements or current Mars conditions.** The background image supplies context; it does not turn these overlays into measured data. No result is an operational clearance for an astronaut or rover.

## Coordinates and terrain

`src/lib/routeEngine.ts` defines a local 1,000 × 700 coordinate plane at an assumed 5 meters per unit: a nominal 5 × 3.5 km scenario. These are screen/scenario coordinates, not latitude and longitude. The planning lattice has 50 m spacing (10 units). It does not resolve meter-scale boulders or small craters.

Elevation is an analytic field made from a gentle plane, sinusoidal relief, and two Gaussian hills. Elevations are in meters with an arbitrary Mars-like offset. Local surface slope is `atan(hypot(dz/dx, dz/dy) / 5)` in degrees. The offset does not claim a Mars datum. Roughness and exposure factors are explicit scenario functions. Rock ellipses are impassable; a sand ellipse is passable with an effort penalty.

## Search and route strategies

Each requested leg uses A* over eight-connected neighboring grid points. The cost is horizontal distance multiplied by a strictly positive terrain weight. Straight-line distance is an admissible heuristic because every weight is at least one. A stable heap ordering ensures repeatable results.

All strategies enforce the same hard exclusion and slope constraints:

| Strategy | Cost emphasis |
| --- | --- |
| Balanced | Distance, slope squared, and roughness |
| Safest | Stronger slope/roughness penalties and a modeled exposure penalty |
| Science | Preference for corridors near science stops, with slope and roughness penalties |

“Safest” means lowest cost under that demonstration objective. It is not a validated safety assessment. The science strategy can bring a corridor closer to a target, but it does not automatically collect samples. Only explicitly scheduled named stops with their canonical site identifier and coordinates contribute science score and dwell time. Bare coordinate points and custom waypoints are transit-only even when placed at a science station. Science score is a scenario priority sum capped at 100, not a probability of discovery.

Diagonal movements cannot cut between blocked or over-limit neighboring cells. An analytic segment/ellipse intersection check rejects even narrow crossings of synthetic exclusion zones. Every edge and exact-stop connector is also sampled every 2.5 coordinate units or less (12.5 m) to reject slopes over the selected threshold. This is discrete slope-model validation, not proof about terrain below that resolution. Requested stops are never silently moved; they connect to the nearest reachable grid point within a small neighborhood. An unreachable or excluded stop returns an explicit failure and no partial route.

## Time, reserve, and exposure

Walking time for each segment is:

```text
horizontal distance / level-ground speed × (1 + slope / 50 + roughness × 0.35)
```

This is an illustrative effort model, not astronaut gait or suit physiology research. Scheduled science dwell is added once per named site, even if that site appears more than once in the itinerary. Arbitrary waypoints do not have dwell time.

The route is within the modeled time budget when:

```text
walking time + science dwell <= EVA duration × (1 - reserve percent / 100)
```

`reserveMinutes` reports EVA time left on arrival, including the requested reserve. Exposure integrates the assumed mSv/h dose rate over walking and science dwell, using the synthetic local exposure factor. The default 0.025 mSv/h is a demonstration input, not a live radiation report. No physiological risk or dose safety threshold is inferred.

The caller must include the origin as the final point to request return travel. The default itinerary does this. A one-way route receives a prominent warning; its `feasible` value describes only the supplied itinerary's modeled time budget.

## Public API

```ts
import { planRoute, resolveSites, DEFAULT_ROUTE_IDS, defaults } from './src/lib/routeEngine';

const route = planRoute(resolveSites(DEFAULT_ROUTE_IDS), 'balanced', defaults);
```

Exports include `Point`, `RouteMode`, `Constraints`, `ScienceSite`, `Hazard`, `TerrainSample`, `ProfileSample`, `RouteResult`, `WORLD`, `defaults`, `sites`, `hazards`, `DEFAULT_ROUTE_IDS`, `terrainAt`, `resolveSites`, and `pointDistanceKm`.

Result fields include the complete path and profile, distance, walking/science/total time, maximum modeled slope, positive elevation gain, modeled dose, reserve, feasibility, warnings, visited named sites, and a model version. Invalid numeric parameters, outside-map points, blocked stops, and disconnected routes fail explicitly. Routes are computed locally and require no network or API key.

## Replacing the demonstration model

An operational research pipeline would require verified map projection and image registration, sufficiently fine DEMs with uncertainty, derivative validation, actual hazard detection and manual review, spatially and temporally relevant environmental observations, suit/crew/vehicle performance models, and independent validation. Each source would need its datum, units, acquisition date, resolution, coverage, licensing, and uncertainty recorded. Actual safety qualification is outside this competition prototype.

## Verification

Run `node --test tests/routeEngine.test.mjs` with Node 24 (native TypeScript type stripping), or the repository's test script. Tests cover determinism, all three strategies, sampled edge exclusion/slope constraints, explicit stop preservation, reserve enforcement, dwell accounting, speed/dose scaling, invalid inputs, return warnings, and profile/coordinate consistency.
# Measured field operations

The default workspace computes its route directly from the bundled western Jezero CTX DEM. `src/lib/measuredRoute.ts` validates source pixel indices and bounds, recovers each sample's original projected center and measured elevation, and searches the eight adjacent samples with A*. Null cells are unavailable. A diagonal is allowed only when both orthogonal alternatives respect the same grade limit. The 3D segment length uses the elevation difference and projected horizontal separation. Route modes minimize distance or add a grade penalty. A direct return uses modeled walking time as its cost.

The engine closes every itinerary to its first habitat, adds science dwell once per stop, and reports remaining EVA time and required reserve. The field workspace separately checks the Mars24 daylight window. The rehearsal follows the same per-edge walking-time function and uses discrete measured points. Its return preview recomputes a direct path at the selected timeline position. The estimated walk time assumes a configurable level-ground speed and a grade multiplier; it has no measured suit performance or footing inputs.

Crew reports can exclude up to 64 map cells without changing the source DEM. A* rejects those cells as route endpoints and as direct or diagonal neighbors. The report persists with the plan and appears in its JSON export. To calculate a return from outside the rehearsal, the operator selects a measured cell and enters elapsed SI minutes since the planned UTC departure. The engine checks daylight starting at the reported time and compares walking time with the remaining EVA budget after reserve. The current position comes from operator input.

The underlying 20 m DEM is sampled at actual gaps of 40–60 m in this pack. Grades describe the slope between those samples, and local cliffs and boulders can be smaller than the sample spacing. The registered CTX orthoimage and path use the same equirectangular extent. The NASA HiRISE image in the separate training workspace is an unregistered backdrop. See [coordinate frames and clock assumptions](MARS_COORDINATES_AND_TIME.md).
