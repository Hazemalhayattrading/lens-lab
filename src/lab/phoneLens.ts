import type { LensCategory, PhoneCamera, PhoneData } from '../data/types';
import { cameraOptics } from '../phone/phoneOptics';
import type { Assumption, LabLens } from './labLens';

/** Closest focus the lab assumes for phone cameras (makers rarely publish it), mm from the sensor. */
export const PHONE_ASSUMED_MFD = 100;

const CATEGORY: Record<PhoneCamera['role'], LensCategory> = {
  'ultra-wide': 'ultra-wide',
  main: 'wide-prime',
  telephoto: 'portrait-prime',
  periscope: 'telephoto-prime',
  front: 'wide-prime',
};

/**
 * A phone camera as a lab lens (compare mode): real focal length from the published 35 mm-equivalent
 * focal length and the sensor size (both needed — otherwise null), fixed or stepped aperture, the
 * sensor's own size. The closest focus is an assumption and is listed in `assumed`.
 */
export function labLensFromPhone(p: PhoneData, index: number): LabLens | null {
  const c = p.cameras[index];
  if (!c || !c.aperture) return null;
  const o = cameraOptics(p, c);
  if (!o.realFocal || !o.sensor) return null;
  const f = o.realFocal.value;
  const steps = c.apertureSteps?.length ? c.apertureSteps : [c.aperture];
  const maxN = Math.min(c.aperture, ...steps);
  const minN = Math.max(c.aperture, ...steps);
  const assumed: Assumption[] = ['minFocus', 'dimensions', 'elements', 'blades'];
  return {
    id: `phone:${p.id}:${index}`,
    brand: p.brand,
    name: `${p.name} · ${c.label}`,
    data: null,
    category: CATEGORY[c.role],
    format: 'phone',
    mountDiameter: 0,
    physics: {
      focal: { min: f, max: f },
      maxAperture: { wide: maxN, tele: maxN },
      minAperture: { wide: minN, tele: minN },
      mfd: { wide: PHONE_ASSUMED_MFD, tele: PHONE_ASSUMED_MFD },
      maxMagnification: null,
      maxMagAt: 'tele',
      sensor: { ...o.sensor.value },
    },
    isZoom: false,
    layout: 'retrofocus',
    elements: c.lensElements ?? 7,
    groups: c.lensElements ?? 7,
    special: [],
    blades: 0,
    dims: { diameter: 10, length: 8 },
    stabilized: !!c.stabilization && !/none/i.test(c.stabilization),
    zoomExtends: false,
    unitFocus: true,
    assumed,
    crop: o.crop ?? 1,
  };
}
