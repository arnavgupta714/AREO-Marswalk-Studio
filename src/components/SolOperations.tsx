import { Sun, TimerReset } from 'lucide-react';
import { marsTime, SOL_SECONDS } from '../lib/marsClock';
import { daylightWindow } from '../lib/traverseOps';

interface Props {
  utc: string;
  setUtc: (value: string) => void;
  duration: number;
  solarLimit: number;
  setSolarLimit: (value: number) => void;
  site: { latitudeGraphic: number; longitudeEast: number };
  daylight: ReturnType<typeof daylightWindow>;
  onNextWindow: () => void;
}

export default function SolOperations({utc, setUtc, duration, solarLimit, setSolarLimit, daylight, onNextWindow}: Props) {
  const {start, end, marginMinutes, clears} = daylight;
  return <section className="ops-panel">
    <div className="ops-panel-heading"><Sun size={16}/><h2>Sol clock & daylight</h2></div>
    <div className="sol-clocks">
      <div><small>LOCAL TRUE · LTST</small><strong>{marsTime(start.ltst)}</strong></div>
      <div><small>LOCAL MEAN · LMST</small><strong>{marsTime(start.lmst)}</strong></div>
      <div><small>PRIME MERIDIAN · MTC</small><strong>{marsTime(start.mtc)}</strong></div>
    </div>
    <div className="sol-epoch"><span>MSD {start.msd.toFixed(4)}</span><span>L<sub>s</sub> {start.ls.toFixed(2)}°</span><span>{start.sunDistanceAu.toFixed(3)} AU</span></div>
    <div className="ops-inputs">
      <label>Departure UTC<input type="datetime-local" aria-label="Departure UTC" min="1972-01-02T00:00" max="2127-12-29T23:59" value={utc} onChange={event=>setUtc(event.target.value)}/></label>
      <label>Minimum Sun angle<select aria-label="Minimum Sun angle" value={solarLimit} onChange={event=>setSolarLimit(Number(event.target.value))}><option value="0">0° horizon</option><option value="5">5°</option><option value="10">10°</option><option value="15">15°</option><option value="20">20°</option></select></label>
    </div>
    <div className={`ops-badge ${clears?'ready':'caution'}`}><Sun size={14}/>{clears?`${Math.floor(marginMinutes)} min daylight margin`:'Daylight threshold crossed or below limit'}</div>
    <p className="ops-context">Sun {start.solarElevation.toFixed(1)}° at departure, {end.solarElevation.toFixed(1)}° at return. {duration>0?`Return ${marsTime(end.ltst)} LTST. `:''}Geometric Sun angle at habitat. Local terrain shadow and dust are outside the model.</p>
    <button className="text-button" onClick={onNextWindow}><TimerReset size={14}/>Use next morning window</button>
    <details className="ops-details"><summary>Mars time fundamentals</summary><p>A mean sol is {Math.floor(SOL_SECONDS/3600)}h {Math.floor(SOL_SECONDS/60)%60}m {(SOL_SECONDS%60).toFixed(2)}s in Earth units and is divided into 24 Mars hours. Mars Sol Date counts mean sols from a fixed epoch. East longitude shifts the mean clock, and the equation of time shifts it by {start.equationOfTimeMinutes.toFixed(2)} Mars minutes to match the Sun. Solar longitude L<sub>s</sub> tracks the Martian seasons.</p><a href="https://www.giss.nasa.gov/tools/mars24/help/algorithm.html" target="_blank" rel="noreferrer">NASA GISS Mars24 equations</a></details>
    {start.leapTableExtrapolated&&<p className="ops-context caution">UTC conversion holds the December 2026 leap-second offset constant after that date.</p>}
  </section>;
}
