# Lens Lab — build plan

Interactive 3D "optics lab" that teaches how camera focus works.
This file is the source of truth for progress. If a session is resumed: read this file and `git log`, then continue with the first unchecked phase.

## Phases

- [x] **Phase 0 — Plan & scaffold**: Vite + TypeScript + three.js project, GitHub Pages workflow, README stub.
- [x] **Phase 1 — Optics core**: thin-lens model, helicoid, circle of confusion, depth of field, hyperfocal, physical↔visual mapping. Unit tests incl. hand-calculated cases.
- [x] **Phase 2 — Lab scene foundation**: renderer, studio environment + cinematic lights + soft shadows, optical breadboard/workbench, optical rail, orbit camera (limits + damping), post-processing (bloom, ACES, vignette, SMAA).
- [ ] **Phase 3 — The lens**: 6 glass elements (transmission/refraction materials), cutaway metal barrel, knurled focus ring with a real distance scale, 9-blade iris, assembled ⇄ exploded animation.
- [ ] **Phase 4 — Sensor stand + diorama**: sensor on a stand; miniature diorama (terrain, cabin, trees, mountain, sky backdrop).
- [ ] **Phase 5 — Light rays + plane of focus**: ray bundles traced from scene points through the elements to the sensor; glowing plane of focus; DoF zone; blur discs on the sensor.
- [ ] **Phase 6 — Sensor view**: render from the lens' optical centre with physically-driven depth-of-field pass; filmstrip; live (inverted) image on the 3D sensor.
- [ ] **Phase 7 — UI & interaction**: glass panels, live readouts, "Plane of Focus" explanation, slider, quick-focus, aperture buttons, exploded toggle, 3D focus-ring dragging, mobile layout.
- [ ] **Phase 8 — Visual polish loop**: Playwright screenshots (desktop + mobile), critique, iterate.
- [ ] **Phase 9 — Quality & finish**: performance + quality toggle, zero console errors, physics verification table, README, final `npm run build`.

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

## Notes / log

- Live site (after merge to `main` + Pages enabled): https://hazemalhayattrading.github.io/lens-lab/
- 2026-09-25: `git push` is refused with 403 (Claude GitHub App not installed on the repo); the GitHub connector is also
  read-only (403 "Resource not accessible by integration"). Work is committed locally after every phase and pushed as
  soon as access is granted.
