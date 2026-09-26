# Research method — Lens Lab encyclopedia

This is the brief every product in `data/` was researched with (read fully before adding or changing data).

Today is **2026-09-25**. You are researching real products for an educational web app. Accuracy is the
single most important requirement: **never invent or estimate a spec**. A wrong number is far worse than a
missing one.

## Tools / network (important)
- `WebFetch`, `curl` and any direct page download are **blocked** by the network policy (manufacturer sites,
  GSMArena, DPReview, Wikipedia all fail). Do not retry them.
- `WebSearch` **works** and returns a synthesized answer plus the list of result URLs. Use it heavily.
- Ground specs in the manufacturer's own pages: pass `allowed_domains` with the maker's domains, e.g.
  Canon: ["usa.canon.com","canon.com","global.canon","canon-europe.com","canon.co.uk","downloads.canon.com"]
  Nikon: ["nikonusa.com","imaging.nikon.com","nikon.com","nikon.co.uk","nikon.ca"]
  Sony: ["electronics.sony.com","sony.com","sony.co.uk","sony.net","alphauniverse.com"]
  Fujifilm: ["fujifilm-x.com","fujifilm.com"]
  Panasonic: ["panasonic.com","shop.panasonic.com","lumix.global"]
  Leica: ["leica-camera.com","leicarumors.com" is NOT official — use only leica-camera.com / leica-camera.co.uk]
  Sigma: ["sigma-global.com","sigmaphoto.com","sigma-imaging-uk.com"]
  Tamron: ["tamron.com","tamron-americas.com","tamron.eu","tamron.jp"]
  Apple: ["apple.com"], Samsung: ["samsung.com","news.samsung.com","semiconductor.samsung.com"],
  Google: ["store.google.com","blog.google","support.google.com"], Xiaomi: ["mi.com","xiaomi.com"],
  vivo: ["vivo.com"], Huawei: ["consumer.huawei.com","huawei.com"], OPPO: ["oppo.com"].
- Only if the official domain does not yield a value, fill the gap from reputable reviews/databases
  (DPReview, Lensrentals, PetaPixel, Photography Life, The-Digital-Picture, ePhotozine, B&H product specs,
  GSMArena, DXOMARK, Notebookcheck). Say in `notes` which values came from a non-official source.
- Search results are summaries: for every important number (elements/groups, special elements, MFD,
  magnification, weight, dimensions, filter, blades, price, year) make sure the answer is explicitly about the
  **exact product and version** (Mark II vs Mark I, "Z" version, G2, mount variant). If two results disagree,
  run another targeted query; if still unresolved, use `null` and explain in `notes`.
- Record the URLs that the values came from in `sources` (official first). Use real URLs from the search
  results only — never construct a URL yourself.

## Data format
The TypeScript schema is in `/home/user/lens-lab/src/data/types.ts` (`LensData` for lenses, `PhoneData`
for phones) — read it and follow it exactly (field names, units, null rules):
- lengths in mm, minimum focus in **metres from the focal plane**, weight in grams, prices as launch MSRP
  (USD preferred), `checked: "2026-09-25"`.
- primes: `focalLength.min === max`, `maxAperture.wide === tele`, `minAperture.wide === tele`,
  `minFocusM.wide === tele`.
- zooms: wide/tele values at each end; if the maker gives a single MFD for the whole range, use it for both.
- `specialElements`: one entry per kind with the maker's own label and count, e.g.
  `{ "kind": "super-low-dispersion", "label": "Super UD", "count": 1 }`. Normalise kinds:
  aspherical (incl. XA, GMo, hybrid asph., "ASPH"), low-dispersion (ED, UD, SLD, LD, APD-type ED),
  super-low-dispersion (Super ED, Super UD, FLD, XLD, "super ED"), fluorite (fluorite, Super Fluorite),
  high-refractive (high-index, "HR"), diffractive (PF phase fresnel, DO), anomalous-dispersion
  (Leica "anomalous partial dispersion" glass), other (e.g. BR optics / BR element, SR lens).
  If an element is "ED aspherical", count it under both kinds with labels "ED aspherical" / note it.
- `stabilization`: `{ "optical": false, "stops": null }` when the lens has no OIS (camera IBIS does not count).
- `weightG`: lens only (without tripod foot/hood) — note it if the maker only gives the weight with the foot.
- `dimensionsMm`: maximum diameter × length (as published).
- `category`: one of ultra-wide | wide-prime | standard-prime | portrait-prime | macro | standard-zoom |
  telephoto-zoom | telephoto-prime | super-telephoto. Guidance: ≤20 mm widest end → ultra-wide (primes or
  zooms); 24–35 mm prime → wide-prime; 40–60 mm prime → standard-prime; 75–135 mm prime → portrait-prime;
  true macro (≥ 0.5×, sold as macro) → macro; 24–70-ish zooms → standard-zoom; 70–200 / 100–400 zooms →
  telephoto-zoom; ≥ 400 mm primes and zooms reaching ≥ 500 mm → super-telephoto. APS-C / MFT lenses: use the
  full-frame-equivalent field of view for the category.
- `id`: kebab-case, brand + short model, e.g. "sony-fe-24-70-f28-gm-ii".

## Descriptive text (English, based on what reviews actually say)
- `famousFor`: 1–2 sentences on why the lens is well known.
- `strengths`: 3–4 short bullets (specific: "very sharp wide open", "fast, silent AF", "light for its class").
- `weaknesses`: 2–3 short bullets (honest: "heavy", "some vignetting wide open", "expensive", "focus breathing").
- `bestFor`: 3–4 concrete, real-world examples, e.g. "distant wildlife and sports from the stands",
  "portraits with creamy background blur", "life-size macro of insects", "astrophotography of the Milky Way".
- Run at least one review search per product (DPReview / PetaPixel / Photography Life / Lensrentals /
  The-Digital-Picture / DXOMARK / Notebookcheck …) and add 1–2 review URLs to `sources` (`kind: "review"`).
- Neutral, factual tone; no marketing superlatives unless reviewers widely agree. Do not copy sentences
  verbatim from reviews; paraphrase.

## Output
- Write a JSON **array** (pretty-printed, 2-space indent, UTF-8) to the path given in your task.
- **Save after every product**: rewrite the file with the array completed so far each time you finish a
  product, so work is never lost if you are interrupted. If the file already exists when you start, read it
  first and continue with the products that are missing (do not redo finished ones).
- Validate it: `node -e "JSON.parse(require('fs').readFileSync('<path>','utf8'))"` must succeed, and every
  required field of the schema must be present (use null where unverified).
- Do not edit any other file in the repository and do not run git commands.
- Final answer (short): the products covered, and a list of every field left `null` or taken from a
  non-official source, plus any doubts. Keep it under 300 words.

## Product lists (task given to each research run)

If a listed lens has been replaced by a newer current version, research the current version and say so in `notes`.

- **Canon RF** (`data/lenses/canon.json`, full-frame): RF15-35mm F2.8 L IS USM · RF24mm F1.4 L VCM · RF50mm F1.2 L USM ·
  RF50mm F1.8 STM · RF85mm F1.2 L USM · RF100mm F2.8 L MACRO IS USM · RF24-70mm F2.8 L IS USM · RF70-200mm F2.8 L IS USM Z ·
  RF100-500mm F4.5-7.1 L IS USM · RF600mm F4 L IS USM — *done*
- **Nikon Z** (`nikon.json`): Z 14-24mm f/2.8 S · Z 35mm f/1.2 S · Z 50mm f/1.2 S · Z 58mm f/0.95 S Noct · Z 85mm f/1.2 S ·
  Z MC 105mm f/2.8 VR S · Z 24-70mm f/2.8 S II · Z 70-200mm f/2.8 VR S (II) · Z 180-600mm f/5.6-6.3 VR · Z 600mm f/4 TC VR S — *done*
- **Sony FE** (`sony.json`): FE 16-35mm F2.8 GM II · FE 24mm F1.4 GM · FE 50mm F1.2 GM · FE 85mm F1.4 GM II ·
  FE 100mm F2.8 Macro GM OSS (else FE 90mm F2.8 Macro G OSS) · FE 24-70mm F2.8 GM II · FE 70-200mm F2.8 GM OSS II ·
  FE 200-600mm F5.6-6.3 G OSS · FE 400-800mm F6.3-8 G OSS (if verifiable) · FE 600mm F4 GM OSS
- **Fujifilm** (`fujifilm.json`; X = APS-C, GF = medium format 43.8×32.9): XF8-16mmF2.8 R LM WR · XF23mmF1.4 R LM WR ·
  XF33mmF1.4 R LM WR · XF56mmF1.2 R WR · XF80mmF2.8 R LM OIS WR Macro · XF16-55mmF2.8 R LM WR II · XF50-140mmF2.8 R LM OIS WR ·
  XF150-600mmF5.6-8 R LM OIS WR · GF110mmF2 R LM WR
- **Panasonic LUMIX** (`panasonic.json`; S = L-Mount full-frame, LEICA DG = Micro Four Thirds): S 14-28mm F4-5.6 MACRO ·
  S PRO 50mm F1.4 · S 50mm F1.8 · S 85mm F1.8 · S 100mm F2.8 MACRO · S PRO 24-70mm F2.8 · S PRO 70-200mm F2.8 O.I.S. ·
  S 28-200mm F4-7.1 MACRO O.I.S. · LEICA DG VARIO-ELMAR 100-400mm F4.0-6.3 II ASPH. POWER O.I.S.
- **Leica** (`leica.json`; M = manual focus Leica M, SL = L-Mount): Super-Vario-Elmar-SL 16-35 f/3.5-4.5 ASPH. ·
  Summilux-M 35 f/1.4 ASPH. · Noctilux-M 50 f/0.95 ASPH. · APO-Summicron-M 50 f/2 ASPH. · Summilux-M 50 f/1.4 ASPH. ·
  APO-Summicron-SL 90 f/2 ASPH. · the most notable current Leica macro · Vario-Elmarit-SL 24-70 f/2.8 ASPH. ·
  APO-Vario-Elmarit-SL 90-280 f/2.8-4 · APO-Vario-Elmarit-SL 100-400 f/5-6.3
- **Sigma DG DN** (`sigma.json`; mounts L-Mount / Sony E): 14mm F1.4 DG DN Art · 35mm F1.2 DG II Art (else 35mm F1.4 DG DN) ·
  50mm F1.2 DG DN Art · 85mm F1.4 DG DN Art · 105mm F2.8 DG DN MACRO Art · 28-45mm F1.8 DG DN Art · 24-70mm F2.8 DG DN II Art ·
  70-200mm F2.8 DG DN OS Sports · 300-600mm F4 DG OS Sports (else 150-600mm DG DN) · 500mm F5.6 DG DN OS Sports
- **Tamron Di III** (`tamron.json`; mounts Sony E / Nikon Z): 17-28mm F2.8 Di III RXD (or current successor) ·
  20-40mm F2.8 Di III VXD · 28-75mm F2.8 Di III VXD G2 · 35-150mm F2-2.8 Di III VXD · 70-180mm F2.8 Di III VXD G2 ·
  28-200mm F2.8-5.6 Di III RXD (or 25-200 G2) · 50-400mm F4.5-6.3 Di III VC VXD · 150-500mm F5-6.7 Di III VC VXD ·
  90mm F2.8 Di III MACRO VXD (if it exists) · 20mm F2.8 Di III OSD M1:2
- **Phones** (`data/phones/`): current top camera model of Apple, Samsung, Google (*done*) and of Xiaomi, vivo, Huawei
  (optionally OPPO) — search for the newest announced models first; never rely on memory.
