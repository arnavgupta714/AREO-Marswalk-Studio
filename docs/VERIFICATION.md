# Interface and workflow verification

An SI-generated concept was used as a design reference during development. It is excluded from the submission tree. The running app was inspected in the Codex in-app browser, then captured with Playwright at 1536 × 1024 for a full-frame comparison. The desktop and 390 × 844 mobile workflows also have automated Chromium coverage.

| Design element | Rendered result |
| --- | --- |
| Layout | The navigation rail and layer sidebar frame the map, with the mission card at upper right and the traverse profile below. At narrow widths the sidebar opens separately and has its own close control. |
| Typography | Large map title, compact mission headings and monospaced labels establish the same visual hierarchy. The OS supplies the Windows title bar. |
| Palette | Charcoal panels, warm white type and copper controls preserve the direction in the concept. The team artwork appears in the rail and team panel. |
| Terrain and route | The interface uses a real, credited HiRISE color crop. The orange path and elevation profile come from the current route model. The map identifies the unregistered scenario overlay. |
| Controls and copy | The main actions and layer names match the concept. Labels and computed numbers identify the data and model accurately. “Lower risk” describes the scenario's routing priority, and the science count excludes the habitat and custom transit waypoints. |
| Map imagery | The rover preview uses the archived Mastcam-Z source. The optional CRISM preview shows its separate extent. The data library lets users inspect the numerical USGS grid. |

The browser verification exercised route priority selection and simulation playback and found no app errors in the console. The automated suite checks preset selection, route and layer changes, over-budget behavior, playback, stop editing, journal persistence, validated mission export and import, the data library, keyboard control of the measured grid, and mobile sidebar access. The 19 unit checks cover route geometry, scenario constraints and import validation.

The field operations workspace adds automated coverage for registered CTX imagery, coordinate frame switches, grade and EVA constraints, direct returns from rehearsal, clock changes, persisted plans and measured route exports. The unit suite verifies exact DEM sample positions, slope and missing-data constraints, time and dwell accounting, and both published Mars24 clock examples.
