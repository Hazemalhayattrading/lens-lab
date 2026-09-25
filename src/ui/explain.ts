import { SUBJECTS, type SubjectId } from '../optics/config';
import type { OpticsState, SubjectOptics } from '../optics/opticsState';
import { fmtCoc, fmtDistance, fmtDofCm, fmtF, fmtMm } from './format';

const NAME: Record<SubjectId, string> = { cabin: 'cabin', trees: 'trees', mountain: 'mountain' };

const tag = (id: SubjectId, text: string) => `<span class="subj subj-${id}">${text}</span>`;
const b = (text: string) => `<strong>${text}</strong>`;

function sentenceFor(s: SubjectOptics): string {
  const name = tag(s.id, `the ${NAME[s.id]}`);
  const dist = fmtDistance(s.distance);
  if (s.sharpness === 'sharp') {
    return `${cap(name)} (${dist}) is in the sharp zone — its rays meet in a point.`;
  }
  const where = Math.abs(s.focusError);
  const size = b(fmtCoc(s.coc));
  const limit = s.sharpness === 'soft' ? 'slightly soft' : `${Math.round(s.cocRatio)}× the limit`;
  if (s.focusError > 0) {
    return `${cap(name)} (${dist}) would focus ${b(fmtMm(where, 1))} <em>behind</em> the sensor → ${size} disc, ${limit}.`;
  }
  return `${cap(name)} (${dist}) focuses ${b(fmtMm(where, 1))} <em>in front of</em> the sensor → ${size} disc, ${limit}.`;
}

function cap(html: string): string {
  // capitalise the first visible letter inside a span
  return html.replace(/>(\w)/, (_, c: string) => `>${c.toUpperCase()}`);
}

/** Title + paragraphs for the "Plane of Focus" panel. */
export function explain(o: OpticsState): { eyebrow: string; lead: string; body: string[] } {
  const focus = fmtDistance(o.focusDistance);
  const sharp = o.subjects.filter((s) => s.sharpness === 'sharp');
  const inPlane = o.subjects.find((s) => Math.abs(s.distance - o.focusDistance) / s.distance < 0.02);

  let lead: string;
  if (!Number.isFinite(o.focusDistance)) {
    lead = `Focused at ${b('∞')}: the lens sits exactly one focal length (50 mm) from the sensor.`;
  } else if (inPlane) {
    lead = `Focused at ${b(focus)}, right on ${tag(inPlane.id, `the ${NAME[inPlane.id]}`)}. Only points on the glowing plane land as perfect points.`;
  } else {
    lead = `Focused at ${b(focus)}. Only points on the glowing plane land as perfect points on the sensor.`;
  }

  const body: string[] = [];
  const blurred = o.subjects.filter((s) => s.sharpness !== 'sharp');
  for (const s of sharp) if (s !== inPlane) body.push(sentenceFor(s));
  for (const s of blurred) body.push(sentenceFor(s));

  // depth-of-field / aperture sentence
  const zone = Number.isFinite(o.far)
    ? `${b(fmtDofCm(o.depthOfField))} deep (${fmtDistance(o.near)} – ${fmtDistance(o.far)})`
    : `${b('∞')} deep (${fmtDistance(o.near)} to infinity)`;
  if (o.fNumber < 3.5) {
    body.push(`Wide open at ${b(fmtF(o.fNumber))}, the sharp zone is just ${zone}. Stop down to f/16 and every disc shrinks 8×.`);
  } else if (o.fNumber > 11) {
    body.push(`At ${b(fmtF(o.fNumber))} the light cones are thin (${fmtMm(o.apertureDiameter, 1)} aperture), so the sharp zone is ${zone}.`);
  } else {
    body.push(`At ${b(fmtF(o.fNumber))} the sharp zone is ${zone}.`);
  }
  if (Number.isFinite(o.focusDistance) && o.focusDistance >= o.hyperfocal * 0.98) {
    body.push(`Beyond the ${b('hyperfocal distance')} (${fmtDistance(o.hyperfocal)}) everything to ∞ stays acceptably sharp.`);
  }

  let eyebrow: string;
  if (sharp.length === SUBJECTS.length) eyebrow = 'Everything is sharp';
  else if (sharp.length === 0) eyebrow = 'Nothing is sharp';
  else eyebrow = `Sharp: ${sharp.map((s) => NAME[s.id]).join(' + ')}`;
  return { eyebrow, lead, body };
}
