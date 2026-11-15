# AREO Marswalk Studio

**Team CHITRA · NASA Space Apps Challenge**

**Project description.** AREO is an offline Windows mission planner for a crew exploring western Jezero Crater. Click a point on the registered CTX map to inspect local east, north and vertical offsets from the habitat, alongside planetocentric latitude, east longitude and approximate Mars-fixed Cartesian coordinates. Select science stations and the software computes a complete return traverse from measured elevation, a directional grade limit, and the crew's EVA time and reserve.

**Science objective.** Compare local sedimentary textures with the larger delta geometry. A registered NASA MRO CTX orbital mosaic and the USGS CTX stereo elevation model establish map context. Perseverance Mastcam-Z imagery adds a surface perspective, and a CRISM composite provides published context about water-altered minerals. The software includes the data, credits and scripts used to reproduce its terrain pack.

**Offline mission decisions.** A three-axis relief exposes the terrain shape. Mars24 equations give Mars Sol Date, local true and mean solar time, prime meridian time, solar longitude and Sun angle from the planned UTC start. The mission rehearsal accounts for travel, science dwell and the trip home. At any rehearsed position the crew can calculate the fastest return under the same grade model and inspect the EVA and daylight margins. Export sends the full route, exact sample heights, settings and provenance to a local JSON file.

**Data boundary.** Habitat and science stations are proposed positions. The registered regional DEM uses measured heights sampled 40–60 m apart. It cannot establish local footing safety, terrain shadows or live environmental conditions. The Mars-fixed Cartesian readout uses a spherical approximation, and the daylight gate uses the geometric Sun angle at habitat.

**Suggested demo.** In Field operations, choose **Route to a point** and tap a measured cell to preview a round trip. Keep the destination and inspect its local XYZ. In the return panel, enter elapsed minutes and select **Use cursor position** at a different cell. The cyan return route and its EVA and daylight margins update immediately. [Watch the submitted 26-second demo](https://github.com/arnavgupta714/AREO-Marswalk-Studio/releases/download/submission-v1.2.0/AREO-1.2-Demo.webm).
