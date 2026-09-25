# Lens Lab — build plan

Interactive 3D "optics lab" that teaches how camera focus works.
This file is the source of truth for progress. If a session is resumed: read this file and `git log`, then continue with the first unchecked phase.

## Phases

- [x] **Phase 0 — Plan & scaffold**: Vite + TypeScript + three.js project, GitHub Pages workflow, README stub.
- [ ] **Phase 1 — Optics core**: thin-lens model, helicoid, circle of confusion, depth of field, hyperfocal, physical↔visual mapping. Unit tests incl. hand-calculated cases.
- [ ] **Phase 2 — Lab scene foundation**: renderer, studio environment + cinematic lights + soft shadows, optical breadboard/workbench, optical rail, orbit camera (limits + damping), post-processing (bloom, ACES, vignette, SMAA).
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

_To be filled in Phase 1 / Phase 9._

## Notes / log

- Live site (after merge to `main` + Pages enabled): https://hazemalhayattrading.github.io/lens-lab/
