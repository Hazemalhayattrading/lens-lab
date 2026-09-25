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
