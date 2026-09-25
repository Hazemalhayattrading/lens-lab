/**
 * Data model of the lens & camera encyclopedia.
 *
 * Accuracy rule: every value comes from a source listed in `sources` (manufacturer first,
 * reputable reviews only to fill gaps). A value that could not be verified is `null` and the UI
 * shows it as "unverified". Nothing is guessed.
 *
 * The JSON files live in /data (one file per brand for lenses, one file for phones) and are
 * lazy-loaded by the app; data/SOURCES.md is generated from them (`npm run sources`).
 */

export type LensBrand = 'Canon' | 'Nikon' | 'Sony' | 'Fujifilm' | 'Panasonic' | 'Leica' | 'Sigma' | 'Tamron';
export type PhoneBrand = 'Apple' | 'Samsung' | 'Google' | 'Xiaomi' | 'vivo' | 'OPPO' | 'Huawei';

export interface SourceRef {
  title: string;
  url: string;
  kind: 'official' | 'review' | 'press' | 'retailer';
}

export type LensCategory =
  | 'ultra-wide'
  | 'wide-prime'
  | 'standard-prime'
  | 'portrait-prime'
  | 'macro'
  | 'standard-zoom'
  | 'telephoto-zoom'
  | 'telephoto-prime'
  | 'super-telephoto';

/** Image circle the lens is designed for. */
export type SensorFormat = 'full-frame' | 'aps-c' | 'micro-four-thirds' | 'medium-format';

export type SpecialElementKind =
  | 'aspherical'
  | 'low-dispersion'
  | 'super-low-dispersion'
  | 'fluorite'
  | 'high-refractive'
  | 'diffractive'
  | 'anomalous-dispersion'
  | 'other';

export interface SpecialElement {
  kind: SpecialElementKind;
  /** The manufacturer's own term, e.g. "Super UD", "XA", "ED aspherical", "BR optics". */
  label: string;
  count: number;
}

/** A value at the wide and tele end of a zoom (identical for primes). null = unverified. */
export interface EndValues {
  wide: number | null;
  tele: number | null;
}

export interface LensData {
  /** kebab-case, unique, e.g. "canon-rf-100-500-f45-71-l-is-usm". */
  id: string;
  brand: LensBrand;
  /** Full official product name. */
  name: string;
  /** Primary mount, e.g. "Canon RF", "Nikon Z", "Sony E", "Fujifilm X", "Fujifilm G", "L-Mount", "Leica M", "Micro Four Thirds". */
  mount: string;
  /** All mounts the lens is sold for (third-party lenses). */
  mounts?: string[];
  format: SensorFormat;
  category: LensCategory;
  /** mm; min === max for primes. */
  focalLength: { min: number; max: number };
  /** Maximum aperture (f-number) at the wide / tele end. */
  maxAperture: { wide: number; tele: number };
  /** Minimum aperture (largest f-number) at the wide / tele end. */
  minAperture: EndValues;
  elements: number | null;
  groups: number | null;
  /** null = unverified, [] = the maker lists none. */
  specialElements: SpecialElement[] | null;
  apertureBlades: number | null;
  /** Closest focusing distance in metres, measured from the focal plane (as in the spec sheets). */
  minFocusM: EndValues;
  /** Maximum reproduction ratio, e.g. 0.33 for 1:3, 1 for life-size. */
  maxMagnification: number | null;
  /** null = unverified; optical false = no in-lens stabilisation. stops = CIPA rating, null if not published. */
  stabilization: { optical: boolean; stops: number | null } | null;
  /** AF motor as named by the maker, or "Manual focus". */
  autofocus: string | null;
  /** Without tripod foot / hood unless noted. */
  weightG: number | null;
  /** Maximum diameter × length (from the mount flange) in mm. */
  dimensionsMm: { diameter: number; length: number } | null;
  /** Front filter thread in mm; null with a note when the lens takes no front filter. */
  filterMm: number | null;
  releaseYear: number | null;
  /** Launch price (MSRP at announcement). */
  launchPrice: { amount: number; currency: 'USD' | 'EUR' | 'GBP' | 'JPY' } | null;
  zoomMechanism?: 'internal' | 'extending' | null;
  focusMechanism?: 'internal' | 'rear' | 'front-group' | 'unit' | 'floating' | null;
  /** Anything a reader should know about the data (e.g. which value came from a review). */
  notes?: string;
  /** One or two sentences: what the lens is known for (based on reviews). */
  famousFor: string;
  strengths: string[];
  weaknesses: string[];
  /** Concrete, real-world uses, e.g. "life-size macro of insects". */
  bestFor: string[];
  sources: SourceRef[];
  /** Date the data was checked (ISO). */
  checked: string;
}

/** Translatable text of one lens (Arabic files mirror the English fields). */
export interface LensText {
  famousFor: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  notes?: string;
}

export type PhoneCameraRole = 'ultra-wide' | 'main' | 'telephoto' | 'periscope' | 'front';

export interface PhoneCamera {
  role: PhoneCameraRole;
  /** The maker's name for the camera, e.g. "48MP Fusion Main". */
  label: string;
  megapixels: number | null;
  /** Optical format as published, e.g. '1/1.28"', or null. */
  sensorFormat: string | null;
  /** Only when published by the maker or its sensor supplier. */
  sensorModel?: string | null;
  /** Native pixel pitch in µm. */
  pixelSizeUm: number | null;
  /** Pixel-binned pitch in µm (e.g. quad-pixel). */
  binnedPixelUm?: number | null;
  /** 35 mm-equivalent focal length. */
  eqFocalMm: number | null;
  /** Real focal length, if published. */
  focalMm?: number | null;
  /** Default f-number. */
  aperture: number | null;
  /** Selectable f-numbers of a variable aperture. */
  apertureSteps?: number[] | null;
  /** Optical zoom factor relative to the main camera (main = 1). */
  opticalZoom: number | null;
  /** e.g. "Sensor-shift OIS", "OIS", "None". */
  stabilization: string | null;
  /** e.g. "Dual Pixel PDAF", "PDAF", "Fixed focus". */
  autofocus: string | null;
  /** Number of lens elements, if published. */
  lensElements?: number | null;
  /** Diagonal field of view in degrees, if published. */
  fovDeg?: number | null;
  /** Folded (periscope) optics. */
  folded?: boolean;
  /** e.g. "tetraprism", "prism". */
  prism?: string | null;
  notes?: string;
}

export interface PhoneData {
  id: string;
  brand: PhoneBrand;
  name: string;
  /** Announcement month, "YYYY-MM". */
  announced: string;
  /** Arrangement of the rear cameras (used by the procedural module model). */
  moduleLayout: 'triangle-square' | 'vertical-rings' | 'horizontal-bar' | 'round-island' | 'square-island-2x2';
  cameras: PhoneCamera[];
  /** Named computational-photography features the maker advertises. */
  computational: { name: string; description: string }[];
  summary: string;
  sources: SourceRef[];
  checked: string;
}
