const radians = Math.PI / 180;
const MARS_A = 3396190;
const MARS_C = 3376200;
export interface ProjectedPoint { xM: number; yM: number; zM: number }
export interface Projection { sphereRadiusMeters: number; standardParallelDegrees: number; centralLongitudeDegrees: number }

export function geographic(point: ProjectedPoint, projection: Projection) {
  const latitude = point.yM / projection.sphereRadiusMeters / radians;
  const longitudeEast = projection.centralLongitudeDegrees +
    point.xM / (projection.sphereRadiusMeters * Math.cos(projection.standardParallelDegrees * radians)) / radians;
  const latitudeGraphic = Math.atan2(MARS_A ** 2 * Math.sin(latitude * radians), MARS_C ** 2 * Math.cos(latitude * radians)) / radians;
  return { latitude, latitudeGraphic, longitudeEast, elevation: point.zM };
}

/** Direction follows Mars-fixed axes. Radius uses the source projection sphere. */
export function marsFixed(point: ProjectedPoint, projection: Projection) {
  const { latitude, longitudeEast, elevation } = geographic(point, projection);
  const lat = latitude * radians;
  const lon = longitudeEast * radians;
  const radius = projection.sphereRadiusMeters + elevation;
  return { x: radius * Math.cos(lat) * Math.cos(lon), y: radius * Math.cos(lat) * Math.sin(lon), z: radius * Math.sin(lat) };
}

export function localXYZ(point: ProjectedPoint, origin: ProjectedPoint) {
  return { x: point.xM - origin.xM, y: point.yM - origin.yM, z: point.zM - origin.zM };
}
