# Mars coordinates and solar time

This document defines the coordinate and clock conventions used by AREO's measured-terrain workspace. The reference calculations are NASA GISS Mars24's revised analytical model, checked against primary documentation on **15 November 2026**. Mars24 is an analytical solar-clock model; it is not an operational ephemeris service.

## Three meanings of XYZ

| Display | Origin and axes | Meaning |
| --- | --- | --- |
| Projected coordinates | Source GeoTIFF CRS; easting, northing, source elevation | Reconstructs the map coordinates of an actual DEM sample |
| Local grid XYZ | Selected habitat; +X east along map grid, +Y north along map grid, +Z elevation difference | Convenient excursion offsets in metres; a local projected-grid approximation, not an exact tangent-plane ENU frame |
| Approximate Mars-fixed XYZ | Mars center; +X equator/prime meridian, +Y equator/90°E, +Z north pole | Spherical Cartesian illustration; radial datum limitation below |

USGS supports both planetographic/west-positive and planetocentric/east-positive Mars coordinates. AREO's source PDS4 label uses **planetocentric latitude and positive-east longitude**. Those conventions are stored with the data; Earth EPSG:4326/WGS84 must never be substituted. See [USGS's coordinate-system explanation](https://planetarynames.wr.usgs.gov/Page/MARS/system).

The Mars-fixed axis convention follows [JPL NAIF body-equator/prime-meridian frames](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/MATLAB/mice/cspice_tipbod.html). The standard latitudinal-to-Cartesian relationship is documented by [NAIF's `latrec`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/latrec_c.html). With planetocentric latitude φ, east longitude λ and **actual radial distance** r:

```text
X=r*cos(φ)*cos(λ)
Y=r*cos(φ)*sin(λ)
Z=r*sin(φ)
```

The source DEM is tied to MOLA, so its elevation is not automatically radial height above the 3,396,190 m map sphere. AREO's illustrative `r=R+elevation` needs an areoid/radius correction before it could be treated as accurate absolute body-fixed position. Its UI must retain “approximate” or “spherical approximation.” Inertial coordinates would additionally require an epoch and a planetary orientation model such as SPICE PCK kernels; this app does not compute them.

## Source projection and pixel locations

Both the CTX DEM and matching orthoimage use an equirectangular projection: sphere radius R=3,396,190 m, standard parallel φ₁=18.4663°, central longitude λ₀=0°, and zero false easting/northing. For angles in radians:

```text
x=R*(λ−λ₀)*cos(φ₁)
y=R*φ
φ=y/R
λ=λ₀+x/(R*cos(φ₁))
```

These equations and parameters come directly from the source GeoTIFF/PDS metadata, not Earth mapping defaults. The DEM's original pixel spacing is 20 m. The decimated subset contains `sourceRows` and `sourceColumns`; these are authoritative. For its original top-left corner `(x₀,y₀)`, source sample `(c,r)` is at:

```text
x=x₀+(c+0.5)*20
y=y₀−(r+0.5)*20
```

The exact sampled rows/columns vary by two or three source pixels after nearest-neighbor decimation. The nominal output spacing is insufficient for exact point reconstruction. The registered PNG has a separate uniform output grid. Overlay route markers by converting their actual projected positions into its projected extent, not by assuming every marker is at `(col+0.5)/width`.

The [CTX PDS4 label](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.xml) and [`jezero-ctx-registered.json`](../public/data/jezero-ctx-registered.json) preserve the ortho transform. `sourcePixelSizeMeters` is approximately 5.0020646811×5.0022629716 m; the image and DEM have a shared CRS but different origins and cell sizes. The registered crop uses source metadata to align them. No independent survey accuracy is implied.

## Sols, clocks and durations

A sol is a Martian solar day. Mars clock hours divide a mean sol into 24 parts; they are not SI hours. The mean solar period used here is `1.0274912517 × 86400 = 88775.24414688` SI seconds. A sidereal day is a different rotation period and must not drive a solar clock. MSD is a continuous global sol count; mission Sol 0/1 depends on an explicitly chosen mission epoch and convention. A local sol index is not a rover mission-sol number. These distinctions follow the [Mars24 technical notes](https://www.giss.nasa.gov/tools/mars24/help/notes.html).

Every input timestamp is parsed as UTC; the operating system's local timezone is not part of Mars calculations. Duration budgets use elapsed SI seconds. Mars clock strings use 24-hour Mars units. User-facing schedules should expose both UTC and the selected Mars local clock to avoid ambiguity.

## Clock equations

The equations below use degrees unless marked otherwise; code converts angles to radians for trigonometry. Define `wrap(v,p)=((v%p)+p)%p`. These constants follow [NASA GISS's revised Mars24 algorithm](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html).

```text
JD_UTC=2440587.5+unixMilliseconds/86400000
JD_TT=JD_UTC+(TAIminusUTC+32.184)/86400
d=JD_TT−2451545
MSD=(JD_TT−2451549.5)/1.0274912517+44796−0.0009626
MTC=wrap(24*MSD,24)
LMST=wrap(MTC+longitudeEast/15,24)
LTST=wrap(LMST+EOT/15,24)
M=19.3871+0.52402073*d
F=270.3871+0.524038496*d
PBS=Σ Aᵢ*cos(0.985626*d/τᵢ+phaseᵢ)
C=(10.691+3e−7*d)*sin(M)+0.623*sin(2M)+0.050*sin(3M)
  +0.005*sin(4M)+0.0005*sin(5M)+PBS
Ls=wrap(F+C,360)
EOT=2.861*sin(2Ls)−0.071*sin(4Ls)+0.002*sin(6Ls)−C
```

Perturber triples `(A,τ,phase)`:

```text
(0.0071,2.2353,49.409)  (0.0057,2.7543,168.173)
(0.0039,1.1177,191.837) (0.0037,15.7866,21.736)
(0.0021,2.1354,15.704)  (0.0020,2.4694,95.528)
(0.0018,32.8493,49.095)
```

MTC is the app's name for mean time at the prime meridian; Mars24 calls it Airy Mean Time/MST. East longitude is **added** for LMST. EOT is in degrees; multiplying by four gives Mars clock minutes. Normalize both clocks after adding offsets. Never truncate MSD before computing MTC.

## UTC, TT and leap seconds

The implementation includes the post-1972 TAI−UTC leap table and restricts the supported date interval to 1972–2127. UTC calendar parsers cannot represent `23:59:60`; a timestamp during the inserted second is outside their precision contract. No pre-1972 polynomial is implemented.

[IERS Bulletin C 72](https://datacenter.iers.org/data/html/bulletinc-072.html), issued 6 July 2026, confirms UTC−TAI=−37 seconds and no leap second at the end of December 2026. Thus current TT−UTC is 69.184 seconds. Future timestamps after the validated leap-table horizon must display an extrapolation notice; a hardcoded current offset must not be applied to historical dates. The table horizon is a data-maintenance boundary, not evidence that a leap second will occur.

## Solar elevation and azimuth

The full Mars24 illumination expression uses **planetographic** latitude and its corrected solar declination. AREO converts the planetocentric map latitude φc to an ellipsoid-normal latitude φg using the IAU2000 reference axes a=3,396,190 m and c=3,376,200 m. This is an analytical local-horizontal approximation, not terrain-normal ray tracing.

```text
φg=atan2(a²*sin(φc),c²*cos(φc))
δg=asin(0.42565*sin(Ls))+0.25*sin(Ls)
H=15*(LTST−12)
altitude=asin(clamp(sin(φg)*sin(δg)+cos(φg)*cos(δg)*cos(H),−1,1))
azimuth=wrap(atan2(−sin(H),cos(φg)*tan(δg)−sin(φg)*cos(H)),360)
```

Azimuth runs clockwise from north. This hour-angle sign is the east-positive adaptation; applying Mars24's west-longitude sign unchanged would reverse east and west. Azimuth becomes undefined exactly at zenith/nadir. A spherical variant would use planetocentric latitude and omit the `0.25*sin(Ls)` declination correction; the two formulations must not be silently mixed.

“Daylight” based on the Sun's geometric center crossing a zero-degree horizon differs from physical sunrise/sunset. [Mars24's FAQ](https://www.giss.nasa.gov/tools/mars24/help/faq.html) accounts for the solar disk's apparent radius, approximately 0.16–0.19°. AREO's generic altitude crossing search is a geometric threshold model: it omits atmospheric refraction, dust opacity, local hills, terrain shadows and suit-visor restrictions. At polar locations a crossing may not exist in the next sol; return an unavailable state rather than inventing a time.

## Verification targets and product limits

- NASA's 2000-01-06T00:00:00Z example at 0° longitude gives MTC approximately 23:59:39, LTST 23:38:54 and Ls 277.18758°. This date needs TT−UTC=64.184 seconds.
- A longitude increase of 15° adds one Mars hour to LMST at a fixed instant.
- Advancing by one model mean-sol duration returns the same LMST, while LTST can drift because EOT changes.
- Test wraparound, historical leap boundaries, unavailable polar crossings and invalid dates/coordinates.
- Check coordinate axes at `(lat,lon)=(0,0),(0,90),(90,0)` and round trips between projected coordinates and latitude/longitude.
- Optical NoData is distinct from DEM NoData. Neither is a safe-terrain classification. Elevation uncertainty and small obstacles remain unresolved.

The analytical model is suitable for a transparent competition demonstration. Its display precision is not an accuracy guarantee. Earth–Mars communication latency, communications windows, weather, radiation and human suit performance need separate sources and models. The solar clock does not infer them.
