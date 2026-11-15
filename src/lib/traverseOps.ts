import { marsClock, nextSolarCrossing } from './marsClock';

export interface DaylightSite { latitudeGraphic: number; longitudeEast: number }
export function daylightWindow(departure: number, durationMinutes: number, site: DaylightSite, minimumElevation: number) {
  const { latitudeGraphic, longitudeEast } = site;
  const at = (utcMs: number) => marsClock(utcMs, latitudeGraphic, longitudeEast);
  const finish = departure + durationMinutes * 60000;
  const start = at(departure);
  const end = at(finish);
  const crosses = nextSolarCrossing(departure, latitudeGraphic, longitudeEast, minimumElevation, false);
  const usableMinutes = start.solarElevation >= minimumElevation && crosses !== null ? (crosses - departure) / 60000 : 0;
  return {
    start,
    end,
    finish,
    usableMinutes,
    marginMinutes: usableMinutes - durationMinutes,
    clears: start.solarElevation >= minimumElevation && end.solarElevation >= minimumElevation && (crosses === null || finish <= crosses),
  };
}
