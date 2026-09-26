# Lens Lab — build plan

Interactive 3D "optics lab" that teaches how camera focus works.
This file is the source of truth for progress. If a session is resumed: read this file and `git log`, then continue with the first unchecked phase.

## Phases

- [x] **Phase 0 — Plan & scaffold**: Vite + TypeScript + three.js project, GitHub Pages workflow, README stub.
- [x] **Phase 1 — Optics core**: thin-lens model, helicoid, circle of confusion, depth of field, hyperfocal, physical↔visual mapping. Unit tests incl. hand-calculated cases.
- [x] **Phase 2 — Lab scene foundation**: renderer, studio environment + cinematic lights + soft shadows, optical breadboard/workbench, optical rail, orbit camera (limits + damping), post-processing (bloom, ACES, vignette, SMAA).
- [x] **Phase 3 — The lens**: 6 glass elements (transmission/refraction materials), cutaway metal barrel, knurled focus ring with a real distance scale, 9-blade iris, assembled ⇄ exploded animation.
- [x] **Phase 4 — Sensor stand + diorama**: sensor on a stand; miniature diorama (terrain, cabin, trees, mountain, sky backdrop).
- [x] **Phase 5 — Light rays + plane of focus**: ray bundles traced from scene points through the elements to the sensor; glowing plane of focus; DoF zone; blur discs on the sensor.
- [x] **Phase 6 — Sensor view**: render from the lens' optical centre with physically-driven depth-of-field pass; filmstrip; live (inverted) image on the 3D sensor.
- [x] **Phase 7 — UI & interaction**: glass panels, live readouts, "Plane of Focus" explanation, slider, quick-focus, aperture buttons, exploded toggle, 3D focus-ring dragging, mobile layout.
- [x] **Phase 8 — Visual polish loop**: Playwright screenshots (desktop + mobile), critique, iterate.
- [x] **Phase 9 — Quality & finish**: performance + quality toggle, zero console errors, physics verification table, README, final `npm run build`.

## Key decisions (made autonomously)

1. **Stack** — Vite + TypeScript + three.js r186. `postprocessing` (pmndrs) for bloom / ACES filmic tone mapping / vignette / SMAA on the main view. The depth-of-field pass for the sensor view is custom (it has to be driven by real thin-lens numbers, which no stock DoF effect does). Fonts are bundled with `@fontsource` (no CDN at runtime).
2. **Optical model** — the whole lens is treated as one effective thin lens: f = 50 mm, full-frame sensor 36 × 24 mm, acceptable circle of confusion c = 0.030 mm (the standard full-frame value). Apertures f/2, f/5.6, f/16 (continuous values during animation).
3. **Focusing = unit focusing** — the focus ring drives a helicoid that translates the whole optical cell (all glass elements + iris = the focusing group) relative to the fixed barrel/mount and sensor. Extension from infinity Δ = dᵢ − f, where 1/f = 1/dₒ + 1/dᵢ. The ring angle is linear in Δ (as on a real helicoid), so the engraved distance scale is naturally compressed towards ∞ just like a real lens. Close focus 0.30 m ⇒ Δ = 10 mm.
4. **Distances** are measured from the lens (thin-lens principal plane), the convention of the thin-lens formulas. Diorama distances: front edge 0.30 m, cabin 0.80 m, trees 2.0 m, mountain 8.0 m, sky backdrop = ∞.
5. **Two coordinate spaces.** Physics runs in real millimetres. The 3D scene needs artistic scale, so:
   - *Object side* (lens → diorama) is compressed with the smooth hyperbolic map w = d / (d + d₀) (linear in w → world X). Infinity maps to the backdrop. The same map drives the focus slider, so the slider position *is* the focus plane's position in the diorama.
   - *Image side* (lens → sensor) is an affine scaling of real millimetres (axial and lateral scale factors). Affine maps keep straight lines straight and keep intersections, so "rays meet in a point" vs. "rays land as a disc" is exact, and the disc drawn on the sensor is the real CoC × lateral scale.
6. **Rays through the elements** — entry and exit rays are exact for the thin-lens model and pass through the true aperture point at the iris. Inside an (exploded) multi-element stack the path is interpolated so that the bending is shared by the element surfaces (a real exploded lens would no longer focus, so this is the honest visual compromise).
7. **Where the physical DoF is shown** — the sensor view (filmstrip + live image projected on the 3D sensor) is rendered from the lens' optical centre with the physical field of view (2·atan(18 mm / dᵢ), so focus breathing is real). Every pixel's axial depth → physical distance → thin-lens CoC in mm → blur radius in pixels (image width ↔ 36 mm). The main orbit view stays crisp (it is *our* eye, not the lens), with bloom/ACES/vignette.
8. **Default view** — exploded lens, focused on the trees (2 m) at f/2 so the effect is obvious at first glance; the intro sweeps the focus from ∞ to 2 m while the camera flies in. Camera looks down the bench from behind the sensor (sensor → lens → diorama read left to right); presets for Lens / Sensor / Diorama close-ups.
9. **Exploded view** — the six elements spread along the axis while the barrel parts lift up and back out of the light path (a real exploded lens can't be seen through otherwise). The iris stays on the axis because it is the aperture stop.
10. **Cutaway** — barrel parts are 270° sections with solid machined-aluminium cut faces; glass elements are full so rays always travel through glass.
11. **UI layout** — the sensor image is drawn by WebGL *under* the DOM, so the filmstrip is a transparent window with no glass panel above it, and the enlarged view dims the scene with a box-shadow instead of a covering backdrop. The 3D camera frames itself inside the free region between panels (projection-centre shift + FOV compensation).
12. **Quality** — Auto (default) starts at Medium on desktop / Low on phones and steps down under ~38 fps (up once above 58 fps). Presets change DPR cap, MSAA, shadow-map size, transmission resolution and the sensor view's resolution / bokeh sample count. Shadow maps re-render only when the lens moves; shaders are compiled behind the loader.

## Physics verification (hand calculations)

Constants: f = 50 mm, c = 0.030 mm, so f² = 2500 mm². Distances from the lens. Every row below was worked out by hand
with the formulas in `src/optics/thinLens.ts` and is asserted in `tests/optics.test.ts` (`npm test`, 20 tests pass).

| Case | Hand calculation | Code |
|---|---|---|
| **A** f/2, focus 2 m (trees) | dᵢ = 50·2000/1950 = **51.282 mm** (group travel Δ = 1.282 mm) · H = 2500/(2·0.03)+50 = **41 716.7 mm** · Dₙ = 2000·41 666.7/(41 716.7+2000−100) = **1910.6 mm** · D_f = 2000·41 666.7/(41 716.7−2000) = **2098.2 mm** → sharp zone **18.8 cm** · CoC(cabin 0.8 m) = 2500·1200/(2·1950·800) = **0.962 mm** · CoC(mountain 8 m) = 2500·6000/(2·1950·8000) = **0.481 mm** | ✅ identical |
| **B** f/16, focus 0.8 m (cabin) | dᵢ = 50·800/750 = **53.333 mm** (Δ = 3.333 mm) · H = 2500/0.48+50 = **5258.3 mm** · Dₙ = 800·5208.3/5958.3 = **699.3 mm** · D_f = 800·5208.3/4458.3 = **934.6 mm** → **23.5 cm** · CoC(trees) = 2500·1200/(16·750·2000) = **0.125 mm** · CoC(mountain) = 2500·7200/(16·750·8000) = **0.1875 mm** | ✅ identical |
| **C** f/5.6, focus 8 m (mountain) | dᵢ = 50·8000/7950 = **50.315 mm** · H = 2500/0.168+50 = **14 931 mm** · Dₙ = 8000·14 881/22 831 = **5214 mm** · D_f = 8000·14 881/6931 = **17 176 mm** → **1196 cm** · CoC(trees) = 2500·6000/(5.6·7950·2000) = **0.168 mm** · CoC(cabin) = 2500·7200/(5.6·7950·800) = **0.505 mm** | ✅ identical |
| **D** close focus 0.3 m | dᵢ = 50·300/250 = **60 mm**, Δ = **10 mm**, m = 50/250 = **0.2 (1:5)**, angle of view 2·atan(18/60) = **33.4°** (vs 39.6° at ∞ → focus breathing) | ✅ identical |
| **E** f/16 at ∞ / at H | focused at ∞: Dₙ = f²/(N·c) = **5208 mm**, CoC(2 m) = f²/(N·d) = 2500/32 000 = **0.0781 mm** · focused at H: Dₙ = **H/2**, D_f = **∞** | ✅ identical |

Extra invariants checked in the tests: CoC equals c exactly at both DoF limits; the CoC formula equals the similar-triangles
blur disc A·|v_s − v_d|/v_d; f/2 → f/16 shrinks every blur disc by exactly 8×; ring angle ↔ focus distance is invertible.

## Verification log (Phase 8–9)

- Playwright screenshots reviewed after every visual phase (desktop 1600×900, tablet 1024×768, phone 390×844): hero,
  assembled/exploded, lens/sensor/diorama presets, f/2 vs f/16, enlarged sensor view, mobile Learn drawer.
  Fixes that came out of the reviews: glass read as black inside the barrel → full elements + frosted edges + fresnel rim;
  barrel hid the optics when exploded → lift-away choreography; panels covered the sensor → camera safe area;
  glass panels showed through the enlarged sensor view → panels hidden while it is open; 3D sensor went black after a
  resolution change → texture re-binding; label collisions → priority-based layout; tablet too cramped → Learn drawer.
- Automated interaction test (Playwright): quick-focus buttons, aperture buttons, assembled/exploded, slider, dragging
  the 3D focus ring, sensor modal, keyboard shortcuts, readouts — all pass (e.g. cabin at f/2 shows sharp zone
  2.9 cm, 78.6–81.5 cm, matching the formulas).
- Console: no errors or warnings in capture mode and in live mode, for both `npm run dev` and the production build
  (`vite preview` under `/lens-lab/`).
- Render cost (one frame incl. shadows, transmission, sensor view, main view, post): ≈274 draw calls, ≈0.37 M
  triangles (scene ≈0.16 M). Iris blades and cabin props were merged to get there. Real-GPU frame rates could not be
  measured in this container (software WebGL only), hence the adaptive quality.
- `npm test` (20 optics tests) and `npm run build` pass.

## Notes / log

- Live site (after merge to `main` + Pages enabled): https://hazemalhayattrading.github.io/lens-lab/
- Enable Pages once: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow
  (`.github/workflows/deploy.yml`) runs on every push to `main` and can also be started from the Actions tab.
- 2026-09-25: `git push` is refused with 403 (Claude GitHub App not installed on the repo); the GitHub connector is also
  read-only (403 "Resource not accessible by integration"). Work is committed locally after every phase and pushed as
  soon as access is granted.

---

# Phase 2 — Lens & camera encyclopedia

Goal: turn the focus bench into an encyclopedia of real lenses and phone cameras — a researched lens library
(8 brands), per-lens physics in the 3D lab (zoom, apertures, close focus, field of view, DoF), a telephoto-ready
scene, smartphone camera teardowns and compare mode. The UI is English only.
Work happens on branch `claude/intelligent-cori-0yz11n`; every phase is committed and pushed. If resumed: read
this section and `git log`, then continue with the first unchecked phase.

## Phases

- [x] **2.0 — Plan & schema**: this section, data model (`src/data/types.ts`), research tooling check.
- [~] **2.1 — Lens research** — *partial, see "Research status" below*: Canon, Nikon, Sony, Fujifilm, Panasonic, Leica, Sigma, Tamron — 6–10 current lenses each
  (ultra-wide, standard, portrait, macro, standard zoom, tele zoom, super-tele where the brand has one), official specs +
  review-based "famous for / strengths / weaknesses / best for", sources per lens → `data/lenses/*.json`.
- [~] **2.2 — Phone research** — *partial, see "Research status" below*: current flagships (searched, not from memory) of Apple, Samsung, Google + 3 other makers,
  every camera's sensor / pixel / MP / eq. focal length / aperture / zoom / OIS / AF → `data/phones/phones.json`;
  `data/SOURCES.md` generated from the data.
- [x] **2.3 — Physics v2**: generic lens model (focal range, variable max aperture, aperture range, MFD from the focal
  plane, focus breathing fitted to the published max. magnification), sensor formats + CoC, rectilinear FOV,
  equivalent focal length / aperture, zoom-ring mapping. Unit tests with hand calculations (below).
- [x] **2.5 — Telephoto scene**: new depth ladder (0.25 m → ∞) with far subjects (bird on a branch 30 m, tower 200 m,
  far mountains), wide-angle world for the sensor view, field-of-view cone in 3D, sensor pipeline driven by any lens.
  *Done:* power-law ladder u = 1 − (200/d)^0.3 (invertible in the shader) · kingfisher on a snag at 30 m, lighthouse
  at 200 m, peaks at ∞, lake with sky reflection · sensor-only wide world (polar terrain, forest, sky dome) so 14–16 mm
  frames never see the edge of the diorama · shared procedural dusk sky (gradient, clouds, stars, moon) · aerial haze in
  the sensor view · FOV cone with live angle label · three-layer gather DoF (own blur with mip-prefiltered near
  centres, near-field scatter-as-gather + tent filter, composite) · sensor chip resizes to the lens' format
  (APS-C / MFT / GF) · adaptive aperture buttons, MFD hatch on the focus slider, working f-number for macro.
  *Known limit:* a faint ghost of a large out-of-focus foreground remains behind its blur (single-layer DoF).
- [x] **2.6 — Procedural lenses**: barrel from real dimensions, real element / group counts, special elements highlighted
  and labelled, zoom groups + zoom ring, adaptive aperture buttons, smooth lens-to-lens transitions.
  *Done:* `lab/opticalLayout.ts` builds an illustrative cross-section per design family (double-Gauss, retrofocus,
  ultra-wide, portrait, macro, telephoto, super-tele, 4 zoom families) with exactly the published element count;
  cemented doublets (+/− achromats first) are formed until the published group count is reached; published special
  glass is placed where it typically sits (low-dispersion glass in positive front-group elements of telephotos,
  aspherical surfaces at the rear / front of wide-angles …; a label listed under two kinds is one element with both
  properties). Elements are packed against each other's real sag profiles; the air each zoom / focus group needs is
  reserved first and the motions are scaled down automatically if anything could collide.
  `scene/lens/ProceduralLens.ts` turns it into the 3D cutaway: barrel to the maker's diameter × length (uniform scale,
  iris on the optical centre), mount with lugs, rubber focus + zoom rings (both draggable), control ring, tripod
  collar on super-teles, AF/IS switch panel, section tubes + cells, iris with the published blade count, colour-coded
  special glass (legend in the lens card, callouts close up / exploded), extending front barrel with inner sleeve for
  extending zooms, front ring engraved with the spec only (no maker names or trade dress). Rays fan out to the
  entrance pupil in front of the iris (wider than the iris in a telephoto, narrower in a retrofocus). Lens swaps: the
  old lens lifts away, the new one drops into a cradle sized for its barrel; geometry / textures are disposed
  (memory stays flat over repeated swaps). Tests: `tests/opticalLayout.test.ts` — for every library lens and one
  synthetic lens per family: published element / group counts, every special element assigned, positive edge
  thickness, clear apertures inside the barrel and the mount throat, cemented partners share the contact surface,
  no collision at any zoom / focus position, zoom and focus groups actually move, pupil within the front element.
- [x] **2.7 — Lens browser**: brand tabs, category filters, search, cards, detail sheet (specs, text, sources,
  "unverified" markers), "Load into lab".
  *Done:* `ui/LibraryView.ts` (lazy chunk with its own CSS, fetched on first open; data chunks per brand) — section
  nav (Lab · Lenses), `L` key, "Change lens" in the lens card, deep links `#lenses/<id>`. Brand tabs with counts,
  type chips (by field of view), token search over name / brand / mount / focal / aperture / special glass / uses
  ("85 1.2", "fluorite", "macro"), cards with a procedural side silhouette to a common scale and an "n values
  unverified" note, the teaching lens as a card to go back. Detail sheet: illustrative cross-section (same layout as
  the 3D cutaway, special glass colour-coded, iris), every spec with an explicit *unverified* marker instead of a
  guess, angle of view and full-frame equivalent computed from the data, strengths / weaknesses / best for, notes,
  sources with kind + domain and the check date, "Load into the lab" (zooms: at wide / middle / tele). The lab
  pauses rendering while the library covers it; mobile: single column + full-screen detail with back button.
- [x] **2.8 — Phones**: phone browser, per-camera specs, procedural exploded camera-module teardown (cover glass, lens
  stack, IR filter, sensor, VCM / OIS) and periscope prism path with animated light.
  *Done:* `ui/PhonesView.ts` (lazy; nav "Phones", `P` key, `#phones/<id>`), `phone/PhoneViewer.ts` (its own small
  three.js renderer, created on first open, paused when closed) and `phone/phoneOptics.ts` (tested). Generic phone body
  (no maker design / logo), cameras placed by the published arrangement type. Straight modules, cut away: flex PCB,
  ceramic package + die sized from the published optical format (else pixel count × pitch, else an illustrative size
  that is labelled), sensor-shift OIS stage or lens-shift OIS, IR-cut filter, plastic aspheric stack (published
  element count, else labelled illustrative) with a gull-wing last element, voice-coil motor, cover glass. Folded
  telephotos follow the maker's description: classic periscope (prism → lens group → upright sensor with its long
  side in the phone plane), tetraprism-style 4-reflection fold (labelled illustrative path), lenses-on-prism. Exploded
  view lifts the module out of the phone, which fades; the camera moves to a side view; folded parts separate along
  the light path so the animated glow path stays connected; part labels. Spec panel: published values vs computed
  ones (sensor size, real focal length = equivalent ÷ crop, equivalent aperture = N × crop, angle of view, DoF at
  2 m with the lab's conventions) each tagged *computed* with the formula; missing values *unverified*; all cameras
  table; the maker's named computational features; sources. Found on the way: `GlowLines` quads are one-sided and their
  winding follows the segment's screen direction; the phone light paths opt into double-sided lines (the lab's ray
  bundles keep their tuned one-sided look).
- [ ] **2.9 — Explainers**: small-sensor depth of field, equivalent focal length & aperture, periscope zoom,
  computational photography (portrait mode, multi-frame fusion) — with live visuals.
- [x] **2.10 — Compare mode + phone vs camera**: any two lenses / phone cameras side by side: specs, FOV, DoF at the same
  distance, rendered images; phone-vs-full-frame preset.
  *Done:* `ui/CompareView.ts` (lazy; nav "Compare", `C` key, `#compare/<preset>`). Two extra `SensorPipeline`s render the
  diorama through each side from the same spot, focused at the same distance (clamped to each lens' closest focus,
  flagged in the table); the images are drawn by the lab renderer into the view's transparent frame windows (the bench
  is not rendered meanwhile). Pickers list every library lens, the teaching lens and every phone camera whose sensor
  size and equivalent focal length are published (`lab/phoneLens.ts`: real focal length = equivalent ÷ crop, fixed or
  stepped aperture, closest focus an explicit assumption). Per side: zoom slider (variable-aperture lenses stay wide
  open), aperture buttons; shared focus chips. Table: sensor + crop, real and equivalent focal length, aperture +
  equivalent aperture, angle of view, focus, depth of field, hyperfocal, background blur as % of the frame width
  (comparable across formats), subject sharp / outside the frame, weight. Presets from the data: phone vs full frame
  (iPhone main vs RF 24 mm f/1.4), APS-C vs full frame (XF 33 f/1.4 vs RF 50 f/1.2), wide vs tele (16 mm vs 600 mm),
  f/1.2 vs f/8.
- [ ] **2.12 — Polish loop**: Playwright screenshots (desktop + mobile) after each visual phase, critique, iterate;
  lazy loading, quality toggle, zero console errors.
- [ ] **2.13 — Finish**: README, SOURCES.md, tests, `npm run build`, pull request with screenshots.

*Scope change (2026-09-25, requested by the user): the Arabic / RTL work — former phases 2.4 (i18n foundation) and 2.11
(Arabic content) — is dropped; the app is English only. The i18n code that had been started was removed; the other
phase numbers are kept unchanged so commit messages stay traceable.*

## Phase 2 decisions

1. **Research access.** From this container `WebFetch`/`curl` to manufacturer sites (apple.com, canon.com, …), GSMArena,
   DPReview and Wikipedia is blocked by the network policy; web *search* works. Specs are therefore taken from search
   results restricted to the manufacturer's own domains (official spec pages / PDFs / press releases), with reviews only
   to fill gaps, and every product stores the URLs its values came from. Values that could not be confirmed stay `null`
   and show as **unverified**.
2. **Optical layouts are illustrative.** Manufacturers publish construction diagrams as images, which cannot be fetched
   here, so no layout can be claimed to match a diagram. Every cutaway uses the lens' *real* element count, group count
   and special-element counts; shapes/positions follow the lens type (retrofocus wide, double-Gauss standard, telephoto
   with a negative rear group, zooms with moving groups) and are labelled **"Illustrative layout"** in the UI.
3. **Distances are measured from the focal plane** (the ⦶ mark), like MFD specs and distance scales. The thin-lens
   maths still uses the object distance u from the lens; u is recovered from the sensor distance T with
   u = (T + √(T² − 4Tf))/2 (the larger root of T = u²/(u − f)).
4. **Focus breathing / close focus.** Most modern lenses focus internally and shorten their focal length at close range —
   a fixed-f thin lens cannot reach e.g. 1.4× at 0.26 m with f = 100 mm (it would need 0.41 m). Each lens therefore gets
   an effective focal length that equals f at ∞ and f_mfd = MFD·m/(1+m)² at its published MFD / max. magnification
   (the thin-lens conjugate relation T = f(1+m)²/m solved for f), blended as f_eff = f + (f_mfd − f)·(MFD/T).
   If the magnification is unverified, f stays fixed.
5. **Circle of confusion** per format: c = diagonal / 1442 (0.030 mm full frame, 0.020 APS-C, 0.015 MFT, 0.038 44×33),
   the convention used by Phase 1. Phones use the same rule on their (small) sensors.
6. **Image side is schematic.** A 600 mm lens cannot sit on the bench at the scale of the sensor, so each lens is drawn
   at its own scale (real length : diameter ratio). The cones between the iris and the sensor are solved so that each
   blur disc on the sensor is exactly the real CoC (× the sensor's scale) and lands where the subject appears in the
   sensor view.
7. **Depth ladder.** The object side keeps a smooth monotonic distance → depth map, now with two scales so both near
   (macro, 0.8 m cabin, 2 m trees) and far subjects (30 m bird, 200 m tower, ∞ mountains) get room on the diorama.
   The focus slider covers MFD → ∞ of the loaded lens.
8. **Wide angles.** The diorama is extended with sensor-only geometry (a wider terrain ring + sky dome) so a 10–16 mm lens
   sees a complete world in the sensor view while the bench model stays compact; the FOV cone shows what the lens sees.
9. **Legal.** Brand and product names appear as plain text only. No logos, trademarks as graphics or product photos; all
   lenses, phones and camera modules are generated procedurally, with a neutral Lens Lab styling.
10. **Lazy loading.** Lens data (per brand), phone data, the phone teardown scene and compare mode are split into
    separate chunks and loaded on demand.

## Phase 2 physics verification (hand calculations)

Every row was worked out by hand (checked with a pocket-calculator script) and is asserted in
`tests/lensModel.test.ts` (`npm test`). Code: `src/optics/formats.ts`, `src/optics/lensModel.ts`, `src/optics/depthMap.ts`.

| Case | Hand calculation | Code |
|---|---|---|
| **F** formats | FF d = √(36² + 24²) = **43.267 mm**, c = d/1442 = **0.0300 mm** · APS-C 23.5×15.6: d = 28.207, crop = **1.534**, c = 0.0196 · MFT 17.3×13: crop **1.999** · GFX 43.8×32.9: crop **0.790** · phone 1/1.28": d ≈ 16/1.28 = **12.5 mm** → 10.0 × 7.5 mm (4:3), crop **3.461** | ✅ |
| **G** field of view | 16 mm: H = 2·atan(18/16) = **96.73°**, V = 2·atan(12/16) = **73.74°**, D = 2·atan(21.63/16) = **107.03°** · 24 mm: D = **84.06°** · 600 mm: H = 2·atan(18/600) = **3.437°**, D = **4.130°** · 50 mm at 1:5 (v = 60 mm): H = **33.4°** (breathing) | ✅ |
| **H** equivalence | 56 mm f/1.2 on APS-C → 56·1.534 = **85.9 mm**, 1.2·1.534 = **f/1.84** · phone 6.9 mm f/1.78 on 1/1.28" → 6.9·3.461 = **23.9 mm**, 1.78·3.461 = **f/6.16** · at 2 m the equivalent pair agrees to 1.2 % (near) / 3.6 % (far, close to H ≈ 3.1 m): equivalence is exact only for u ≫ f | ✅ |
| **I** zoom ring | 24–70 at z = ½: √(24·70) = **40.99 mm**; 35 mm ↔ z = ln(35/24)/ln(70/24) = **0.3525** · 100–500 f/4.5–7.1 at 300 mm: 4.5·3^(ln(7.1/4.5)/ln 5) = 4.5·3^0.2833 = f/6.14 → 1/3-stop scale **f/6.3** (the real lens shows f/5.6 there — hence "≈" in the UI) | ✅ |
| **J** focal-plane distances | 50 mm focused at T = 2000 mm: u = (T + √(T² − 4Tf))/2 = **1948.68 mm**, v = **51.32 mm**, m = **0.02633**; 1/u + 1/v = 1/50 ✓ · 50 mm f/16 at ∞: H_u = 2500/(16c) + 50 = 5258.1, H_T = H_u + f·H_u/(H_u − f) = **5308.6 mm** | ✅ |
| **K** macro breathing | 100 mm, MFD 260 mm, 1.4×: f_mfd = 260·1.4/2.4² = **63.19 mm** → at MFD u = f(1+m)/m = **108.33**, v = f(1+m) = **151.67**, T = 260 ✓ · f/2.8: working **f/6.72**, DoF = **0.2057 mm** = 2Nc(1+m)/m² ✓ | ✅ |
| **L** depth ladder | u(d) = 1 − (200/d)^0.3: u(2 m) = 1 − 0.1^0.3 = **0.4988**; d(½) = 200·0.5^(−1/0.3) = **2015.9 mm**; 0.3 m → 0.115, 30 m → 0.778, 200 m → 0.874, ∞ → 1 | ✅ |
| **M** apertures | f/1.2–16 → buttons **1.2, 2, 4, 8, 16** (full stops spread evenly in stop space) · f/0.95–16 → **0.95, 2, 4, 8, 16** | ✅ |
| **N** image-side cones | aperture radius r at D in front of the sensor, wanted disc b, t = b/2r: far subject a = tD/(1 + t) in front, near subject a = tD/(1 − t) behind; similar triangles give back 2r·a/(D ∓ a) = b exactly | ✅ |
| **O** phone cameras (`tests/phoneOptics.test.ts`) | 48 MP × 1.22 µm: px = √(48e6·4/3) = **8000** → **9.76 × 7.32 mm** (matches 1/1.28" ≈ 10 × 7.5) · 24 mm eq → real f = 24/3.4613 = **6.93 mm**, f/1.48 → eq **f/5.1**, FOV 2·atan(43.267/48) = **84.1°** · 5× of 24 mm → **120 mm** eq (computed, labelled) · DoF at 2 m, f/1.48, c = 0.00867: H = 6.93²/(1.48·0.00867) + 6.93 ≈ **3754 mm**, u ≈ 1993 → near ≈ **1.30 m**, far ≈ **4.24 m** (the lens stays at v, so both limits add the same v — same convention as `lensState`, asserted equal) | ✅ |
| **P** illustrative layouts (`tests/opticalLayout.test.ts`) | invariants, for every library lens + one synthetic lens per design family: element count = published, groups = elements − cemented joins = published, each cemented pair shares its contact surface (r₁' = −r₂, touching vertices), edge thickness > 0.5 mm, clear aperture < barrel inner radius and rear element < mount throat, min axial clearance > 0.2 mm between neighbours at z ∈ {0, ¼, ½, ¾, 1} × focus ∈ {0, ½, 1}, zoom / focus groups move, entrance pupil ≤ front element | ✅ |

## Research status (updated 2026-09-25)

Researched with the method in `data/RESEARCH.md`, validated by `tests/data.test.ts`, listed with sources in
`data/SOURCES.md` (`npm run sources`).

| File | Done | Still to research |
|---|---|---|
| `data/lenses/canon.json` | 10/10 | — |
| `data/lenses/nikon.json` | 10/10 | — |
| `data/lenses/sony.json` | 3/10 (16-35 GM II, 24 GM, 50 GM) | 85 GM II, 100 Macro GM / 90 Macro G, 24-70 GM II, 70-200 GM II, 200-600 G, 400-800 G, 600 GM |
| `data/lenses/fujifilm.json` | 4/9 (8-16, 23, 33, 56) | XF80 Macro, XF16-55 II, XF50-140, XF150-600, GF110 |
| `data/lenses/panasonic.json` | 0/9 | all (list in the task prompts, see git history of this section) |
| `data/lenses/leica.json` | 0/10 | all |
| `data/lenses/sigma.json` | 0/10 | all |
| `data/lenses/tamron.json` | 0/10 | all |
| `data/phones/phones-apple-samsung-google.json` | 3/3 (iPhone 18 Pro / Pro Max, Galaxy S26 Ultra, Pixel 11 Pro / Pro XL) | — |
| `data/phones/phones-xiaomi-vivo-huawei.json` | 0/3 | Xiaomi, vivo, Huawei flagships (search for the current models first) |

**Blocker:** this session's web-search budget (200 searches, `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`) is used up,
and direct page fetches are blocked by the network policy, so the remaining products cannot be verified here.
Nothing is filled in from memory. To finish: run the remaining research in a new session (fresh budget) or with a
higher budget — one agent per file, each reading `data/RESEARCH.md` first and appending to the existing file.
The app loads whatever is in `data/`, so new files/entries appear in the library without code changes.
