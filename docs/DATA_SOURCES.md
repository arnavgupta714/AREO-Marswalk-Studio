# Scientific data and provenance

AREO bundles a compact, offline scientific reference pack for Jezero Crater. The pack was retrieved on **14 November 2026**. It is a fixed snapshot, not live mission telemetry. Scientific images and measured elevation are distinct from the application's authored Marswalk scenario.

The machine-readable catalog is [`public/data/sources.json`](../public/data/sources.json). It records origin, instrument, credit, date, classification, intended use and limitations. [`public/data/asset-manifest.json`](../public/data/asset-manifest.json) contains SHA-256 digests and byte sizes for the checked-in files. Image files retain their downloaded bytes.

## Bundled observations

| Type | Bundled file | Primary source and credit | Use |
| --- | --- | --- | --- |
| Optical | `public/assets/jezero-orbital.jpg` | [HiRISE ESP_039348_1985](https://hirise.lpl.arizona.edu/ESP_039348_1985), NASA/JPL-Caltech/UArizona | Terrain texture reference; a 1920×1440 published color crop |
| Spectral / geological | `public/assets/jezero-spectral.jpg` | [PIA23239](https://www.jpl.nasa.gov/images/pia23239-jezero-crater-mars-2020s-landing-site/), NASA/JPL-Caltech/MSSS/JHU-APL | Published CRISM + CTX mineral context |
| Rover surface optical | `public/assets/jezero-surface.jpg` | [PIA24485](https://science.nasa.gov/resource/perseverance-view-of-the-delta-in-jezero-crater/), NASA/JPL-Caltech/ASU/MSSS | Archived Mastcam-Z view acquired 22 February 2021 |
| Topographic | `public/assets/jezero-topography.jpg` and `public/data/jezero-elevation.json` | [USGS Jezero CTX DEM](https://www.usgs.gov/media/images/jezero-crater-0), USGS Astrogeology Science Center; NASA/JPL-Caltech/MSSS | Regional elevation context and a measured numerical subset |

These supply three distinct scientific data types: optical, spectral/geological and topographic. The rover scene adds a surface perspective from a different mission. The original four images are complementary references, **not pixel-aligned layers**. The additional registered CTX crop below is a separate product with explicit map alignment.

## Registered optical crop added 15 November 2026

`public/assets/jezero-ctx-registered.png` is a 960×800 north-up crop of the [USGS CTX orthoimage mosaic](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif). Its [PDS4 label](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.xml) identifies version 1.0 of `urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxortho_mosaic`, with planetocentric latitude and positive-east longitude. Credit: USGS Astrogeology Science Center; NASA/JPL-Caltech/MSSS.

The source and DEM share an equirectangular Mars sphere projection. The ortho's actual pixel sizes are approximately 5.0020646811×5.0022629716 m, not exactly 5 m. `scripts/extract-registered-ortho.mjs` validates the CRS and maps every output pixel center to the nearest source pixel using the supplied transforms. It does **not** stretch the full source to match the DEM. The output covers exactly the DEM subset's projected bounds, `[4352740,1090640,4358380,1095400]` m, with 5.875×5.95 m output pixels. Bounds and sampling metadata are stored in `public/data/jezero-ctx-registered.json`.

The source PDS label defines value 0 as NoData; the PNG converts it to transparency. There are 3,512 transparent output pixels. A transparent patch has no optical coverage and is not an indication of safe terrain. Source grayscale values are preserved without contrast changes. Geographic alignment follows the GeoTIFF metadata; it has not been independently surveyed or calibrated to obstacle scale. The original HiRISE wallpaper remains unregistered.

## What the data supports

The CRISM/CTX composite gives published evidence of water-altered minerals in Jezero delta sediments. The surface image shows an ancient delta remnant from the rover's landing-site viewpoint. The regional DEM provides measured terrain heights tied to MOLA. Together they motivate a science scenario about sedimentary structures and past water, while the routing model demonstrates how future registered data could inform an excursion.

The [Sun and Stack (2020) geological map, USGS SIM 3464](https://www.usgs.gov/maps/geologic-map-jezero-crater-and-nili-planum-region-mars), DOI [10.3133/sim3464](https://doi.org/10.3133/sim3464), is a reference for the regional framework. Its geological polygons are not ingested. [Mars Trek](https://trek.nasa.gov/mars/) and the [Perseverance raw-image archive](https://mars.nasa.gov/mars2020/multimedia/raw-images/) remain external exploration links.

## Measured elevation subset

The extraction reads the USGS source GeoTIFF using HTTP byte ranges:

`https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif`

Source metadata: 4456×5067 pixels, 20 m spacing, uncompressed Float32 values, equirectangular projection, Mars sphere radius 3,396,190 m, standard parallel 18.4663°, central longitude 0°. The script validates these properties and refuses an unexpected format or projection.

The requested extent is 77.42–77.52°E and 18.40–18.48°N. Pixel snapping gives the exact extent in the JSON. A 282×238 source window is decimated to 96×80 values. Nearest-neighbor source indices use `round(outputIndex × sourceSize / outputSize)`; exact `sourceRows` and `sourceColumns` are retained. Values are rounded to 0.1 m for serialization; that precision is **not** a claim about measurement accuracy. The output ranges from −2649.3 to −2455.4 m, with no NoData samples in this particular subset.

Rows run north to south, columns west to east. Nominal display spacing is 58.75×59.5 m. Pixel center coordinates can be recovered from the original TIFF origin, exact source pixel indices and 20 m spacing. `projectedBoundsMeters` describes the full source window, rather than the centers of the last sampled row and column.

This regional terrain grid is too coarse to resolve many rocks, steep local faces or foot placement. Do not estimate fine-scale astronaut traversability from it. The separately bundled HiRISE wallpaper crop has no verified transform and is **not registered to this DEM**.

## Simulation boundary

Habitat placement, route waypoints, hazard regions, science priority, route-grid slope, timing and exposure in the demonstration are authored scenario values or model outputs. They are not NASA astronaut measurements or forecasts. The app must retain simulation labels on those outputs and avoid attaching real geographical accuracy to local display coordinates. Safety scores are comparisons inside the demonstration model, not operational clearance.

The spectral image is false color, not a raw spectral cube or calibrated mineral abundance raster. Its footprint differs from the HiRISE crop. The surface image is an archival scene, not the view from each selected waypoint. The DEM preview is a published visualization without a quantitative color legend in this bundle; use the numerical subset for actual height values.

## Reproduce and verify

Node.js 20 or later is sufficient; these scripts have no third-party dependencies.

```powershell
node scripts/fetch-data.mjs --verify  # Offline integrity check
node scripts/fetch-data.mjs           # Re-download the four exact image assets
node scripts/fetch-data.mjs --dem     # Also rebuild and verify the measured elevation subset
node scripts/fetch-data.mjs --registered # Also rebuild and verify the registered CTX crop
```

The downloader checks content types, HTTP status, byte sizes and hashes before replacing imagery. Changed source content is rejected for manual review. The DEM reader requests only metadata and the relevant contiguous raster strips, so the 90 MB source need not be committed. The generated JSON is committed for offline use. `scripts/extract-elevation.mjs` can also run independently.

The retrieval date records the original checked-in snapshot. If a reviewed update is accepted, update the catalog, manifest, retrieval date and source notes together. Preserve new versus old provenance in Git history.

## Attribution and rights

HiRISE states that its images are public domain and requests the credit shown above. USGS labels the DEM preview public domain. Other NASA/JPL imagery retains the stated instrument-team credit; NASA association or endorsement is not implied. The repository's software license does not replace third-party image terms. The supplied Team CHITRA artwork has separate user-provided provenance and is not a NASA asset.

## Toward operational data integration

The next integration step is a common Mars coordinate reference system with co-registered HiRISE orthoimagery, numerical DEM, geological polygons and science observations. It requires projection checks, NoData handling, spatial uncertainty, per-product observation dates, calibrated hazard extraction and independent validation. Forecasts and suit budgets require separately validated models. This distinction is intentional and visible: AREO is a competition demonstration of an interface and planning workflow, not flight-certified mission software.
