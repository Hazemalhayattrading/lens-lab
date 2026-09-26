import { subjectById, type SubjectId } from '../optics/config';
import type { OpticsFrame, SubjectOptics } from '../lab/optics';
import { fmtCoc, fmtDistance, fmtDofCm, fmtF, fmtFocal, fmtMm, fmtRange, fmtRatio } from './format';

export const SUBJECT_NAME: Record<SubjectId, string> = {
  flower: 'Flower',
  cabin: 'Cabin',
  trees: 'Trees',
  hill: 'Rocky hill',
  bird: 'Bird',
  tower: 'Lighthouse',
  peaks: 'Mountains',
};
const THE: Record<SubjectId, string> = {
  flower: 'the flower',
  cabin: 'the cabin',
  trees: 'the trees',
  hill: 'the rocky hill',
  bird: 'the bird',
  tower: 'the lighthouse',
  peaks: 'the mountains',
};

const tag = (id: SubjectId, text: string) => `<span class="subj" style="color:${subjectById(id).color}">${text}</span>`;
const b = (text: string) => `<strong>${text}</strong>`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sentenceFor(s: SubjectOptics): string {
  const name = tag(s.id, cap(THE[s.id]));
  const dist = fmtDistance(s.distance, 1);
  if (s.sharpness === 'sharp') return `${name} (${dist}) is in the sharp zone — its rays meet in a point.`;
  const size = b(fmtCoc(s.coc));
  const limit = s.sharpness === 'soft' ? 'slightly soft' : `${Math.round(s.cocRatio)}× the limit`;
  const off = Math.abs(s.imageOffset);
  const where = Number.isFinite(off) ? b(off < 100 ? fmtMm(off, off < 1 ? 2 : 1) : `${(off / 10).toFixed(0)} cm`) : b('far');
  if (s.imageOffset > 0) return `${name} (${dist}) would focus ${where} <em>behind</em> the sensor → ${size} disc, ${limit}.`;
  return `${name} (${dist}) focuses ${where} <em>in front of</em> the sensor → ${size} disc, ${limit}.`;
}

/** Title + paragraphs for the "Plane of Focus" panel. */
export function explain(o: OpticsFrame): { eyebrow: string; lead: string; body: string[] } {
  const focus = fmtDistance(o.focusDistance);
  const inFrame = o.subjects.filter((s) => s.inFrame);
  const sharp = inFrame.filter((s) => s.sharpness === 'sharp');
  const onPlane = inFrame.find((s) => Number.isFinite(s.distance) && Math.abs(s.distance - o.focusDistance) / s.distance < 0.02);

  let lead: string;
  if (!Number.isFinite(o.focusDistance)) {
    lead = `Focused at ${b('∞')}: the lens sits one focal length (${fmtFocal(o.effectiveFocal)}) in front of the sensor.`;
  } else if (onPlane) {
    lead = `Focused at ${b(focus)}, right on ${tag(onPlane.id, THE[onPlane.id])}. Only points on the glowing plane land as perfect points.`;
  } else {
    lead = `Focused at ${b(focus)}. Only points on the glowing plane land as perfect points on the sensor.`;
  }

  const body: string[] = [];
  const shown = inFrame.slice().sort((a, b2) => a.distance - b2.distance);
  for (const s of shown) if (s !== onPlane || s.sharpness !== 'sharp') body.push(sentenceFor(s));
  const outside = o.subjects.filter((s) => !s.inFrame).map((s) => THE[s.id]);
  if (outside.length && outside.length < o.subjects.length) {
    body.push(`Outside this ${fmtFocal(o.focalLength)} frame: ${outside.join(', ')}.`);
  }

  const zone = Number.isFinite(o.far)
    ? `${b(fmtDofCm(o.depthOfField))} deep (${fmtRange(o.near, o.far)})`
    : `${b('∞')} deep (${fmtDistance(o.near)} to infinity)`;
  const wideOpen = o.fNumber <= o.maxApertureNow * 1.02;
  if (wideOpen) {
    body.push(`Wide open at ${b(fmtF(o.fNumber))}, the sharp zone is ${zone}. Stop down and every blur disc shrinks in proportion.`);
  } else if (o.fNumber >= 11) {
    body.push(`At ${b(fmtF(o.fNumber))} the light cones are thin (${fmtMm(o.apertureDiameter, 1)} aperture), so the sharp zone is ${zone}.`);
  } else {
    body.push(`At ${b(fmtF(o.fNumber))} the sharp zone is ${zone}.`);
  }
  if (o.magnification >= 0.25) {
    body.push(`At ${b(fmtRatio(o.magnification))} the working aperture is ${b(fmtF(o.workingFNumber))} — up close the lens gathers less light, as if stopped down.`);
  }
  if (Number.isFinite(o.focusDistance) && o.focusDistance >= o.hyperfocal * 0.98) {
    body.push(`Beyond the ${b('hyperfocal distance')} (${fmtDistance(o.hyperfocal)}) everything to ∞ stays acceptably sharp.`);
  }

  let eyebrow: string;
  if (inFrame.length && sharp.length === inFrame.length) eyebrow = 'Everything in frame is sharp';
  else if (sharp.length === 0) eyebrow = 'Nothing in frame is sharp';
  else eyebrow = `Sharp: ${sharp.map((s) => SUBJECT_NAME[s.id].toLowerCase()).join(' + ')}`;
  return { eyebrow, lead, body };
}
