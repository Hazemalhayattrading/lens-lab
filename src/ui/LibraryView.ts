import { loadLenses } from '../data/library';
import type { LensBrand, LensCategory, LensData } from '../data/types';
import { glassLegend, SPECIAL_KIND_NAMES } from '../lab/specialGlass';
import '../styles/library.css';
import { crossSectionSvg, glyphSvg, layoutFor } from './layoutSvg';
import {
  apertureText,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  constructionText,
  dimensionsText,
  equivalentText,
  filterText,
  focalText,
  FORMAT_LABEL,
  fovText,
  isZoomData,
  magnificationText,
  matchesQuery,
  mechanismText,
  mfdText,
  minApertureText,
  priceText,
  searchText,
  sourceDomain,
  stabilizationText,
  unverifiedCount,
  weightText,
} from './specFormat';

export interface LibraryHandlers {
  /** Load a library lens into the lab (optionally at a focal length for zooms). */
  onLoad(id: string, focal?: number): void;
  /** Mount the built-in teaching lens again. */
  onTeachingLens(): void;
  onClose(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const UNVERIFIED = '<span class="unverified" title="Not verified from the maker or a reputable review — left empty on purpose">unverified</span>';
const SEARCH_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>';

type BrandFilter = LensBrand | 'all';

/**
 * The lens library: brand tabs, category filters, search, cards and a detail sheet with every spec,
 * the review-based text and the sources. Lazy-loaded (this module, its CSS and the data chunks are
 * only fetched when the library is first opened).
 */
export class LibraryView {
  readonly root: HTMLElement;
  private lenses: LensData[] = [];
  private haystacks = new Map<string, string>();
  private brand: BrandFilter = 'all';
  private category: LensCategory | 'all' = 'all';
  private query = '';
  private selected: string | null = null;
  private longest = 480;
  private readonly $grid: HTMLElement;
  private readonly $detail: HTMLElement;
  private readonly $brands: HTMLElement;
  private readonly $cats: HTMLElement;
  private readonly $search: HTMLInputElement;
  private readonly $count: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  private ready: Promise<void>;
  private mountedId: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly h: LibraryHandlers,
  ) {
    const root = document.createElement('div');
    root.className = 'lib';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Lens library');
    root.innerHTML = `
<div class="lib-shell">
  <header class="lib-head">
    <div class="lib-title">
      <h2>Lens library</h2>
      <p data-ref="count">Loading…</p>
    </div>
    <label class="lib-search">${SEARCH_ICON}<input type="search" placeholder="Search — e.g. 85 1.2, macro, fluorite" aria-label="Search lenses" autocomplete="off" spellcheck="false" /><kbd class="desktop-only">/</kbd></label>
    <button class="icon-btn lib-close" data-act="close" aria-label="Close the library (Esc)">✕</button>
  </header>
  <nav class="lib-brands" role="tablist" aria-label="Brand" data-ref="brands"></nav>
  <div class="lib-cats" role="group" aria-label="Lens type" data-ref="cats"></div>
  <div class="lib-body">
    <div class="lib-grid" data-ref="grid" role="list" aria-label="Lenses"></div>
    <aside class="lib-detail" data-ref="detail" aria-live="polite"></aside>
  </div>
</div>`;
    host.appendChild(root);
    this.root = root;
    const ref = (n: string) => root.querySelector<HTMLElement>(`[data-ref="${n}"]`)!;
    this.$grid = ref('grid');
    this.$detail = ref('detail');
    this.$brands = ref('brands');
    this.$cats = ref('cats');
    this.$count = ref('count');
    this.$search = root.querySelector('input[type="search"]')!;

    root.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
    this.$search.addEventListener('input', () => {
      this.query = this.$search.value.trim();
      this.renderGrid();
    });
    this.$brands.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-brand]');
      if (!b) return;
      this.brand = b.dataset.brand as BrandFilter;
      this.renderFilters();
      this.renderGrid();
    });
    this.$cats.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
      if (!b) return;
      this.category = (b.dataset.cat === this.category ? 'all' : b.dataset.cat) as LensCategory | 'all';
      this.renderFilters();
      this.renderGrid();
    });
    this.$grid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!card) return;
      if (card.dataset.id === 'teaching') {
        this.h.onTeachingLens();
        this.close();
        return;
      }
      this.select(card.dataset.id!, true);
    });
    this.$detail.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const load = t.closest<HTMLElement>('[data-load]');
      if (load) {
        const focal = load.dataset.focal ? Number(load.dataset.focal) : undefined;
        this.h.onLoad(load.dataset.load!, focal);
        this.close();
        return;
      }
      if (t.closest('[data-act="back"]')) this.root.classList.remove('show-detail');
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.root.classList.contains('show-detail') && window.matchMedia('(max-width: 820px)').matches) this.root.classList.remove('show-detail');
        else this.close();
      } else if (e.key === '/' && e.target !== this.$search) {
        e.preventDefault();
        this.$search.focus();
      }
    });

    this.ready = loadLenses().then((all) => {
      this.lenses = all;
      for (const d of all) this.haystacks.set(d.id, searchText(d));
      this.longest = Math.max(120, ...all.map((d) => d.dimensionsMm?.length ?? 0));
      const brands = new Set(all.map((d) => d.brand));
      this.$count.innerHTML = `${all.length} lenses · ${brands.size} brands<span class="long"> · every spec from the maker or a cited review</span>`;
      this.renderFilters();
      this.renderGrid();
      if (this.selected) this.renderDetail();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Opens the library, pre-selecting the mounted lens (if it is a library lens). */
  async open(mountedId: string | null, selectId?: string): Promise<void> {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.mountedId = mountedId;
    this.root.classList.add('open');
    document.body.classList.add('lib-open');
    await this.ready;
    const has = (id: string | null | undefined): id is string => !!id && this.lenses.some((l) => l.id === id);
    const id = has(selectId) ? selectId : has(mountedId) ? mountedId : (this.selected ?? this.visible()[0]?.id ?? null);
    if (id) this.select(id, has(selectId));
    this.renderGrid();
    if (!window.matchMedia('(max-width: 820px)').matches) this.$search.focus({ preventScroll: true });
    else this.root.querySelector<HTMLElement>('.lib-close')!.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('open', 'show-detail');
    document.body.classList.remove('lib-open');
    this.h.onClose();
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  // ------------------------------------------------------------------ filters

  private visible(): LensData[] {
    return this.lenses.filter(
      (d) => (this.brand === 'all' || d.brand === this.brand) && (this.category === 'all' || d.category === this.category) && (!this.query || matchesQuery(this.haystacks.get(d.id)!, this.query)),
    );
  }

  private renderFilters(): void {
    const brands = [...new Set(this.lenses.map((d) => d.brand))];
    const count = (b: BrandFilter) => this.lenses.filter((d) => b === 'all' || d.brand === b).length;
    this.$brands.innerHTML = (['all', ...brands] as BrandFilter[])
      .map(
        (b) =>
          `<button role="tab" data-brand="${b}" aria-selected="${this.brand === b}" class="${this.brand === b ? 'on' : ''}">${b === 'all' ? 'All' : esc(b)} <small>${count(b)}</small></button>`,
      )
      .join('');
    const inBrand = this.lenses.filter((d) => this.brand === 'all' || d.brand === this.brand);
    this.$cats.innerHTML = CATEGORY_ORDER.filter((c) => inBrand.some((d) => d.category === c))
      .map((c) => {
        const n = inBrand.filter((d) => d.category === c).length;
        return `<button class="chip-f${this.category === c ? ' on' : ''}" data-cat="${c}" aria-pressed="${this.category === c}">${CATEGORY_LABEL[c]} <small>${n}</small></button>`;
      })
      .join('');
    if (this.category !== 'all' && !inBrand.some((d) => d.category === this.category)) this.category = 'all';
  }

  private renderGrid(): void {
    const list = this.visible();
    const cards = list.map((d) => this.card(d));
    const showTeaching = this.brand === 'all' && this.category === 'all' && !this.query;
    if (showTeaching) cards.unshift(this.teachingCard());
    this.$grid.innerHTML = cards.length
      ? cards.join('')
      : `<div class="lib-empty"><strong>No lens matches.</strong><span>Try fewer words, another brand, or clear the type filter.</span></div>`;
    this.$grid.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.classList.toggle('sel', c.dataset.id === this.selected));
  }

  private card(d: LensData): string {
    const unv = unverifiedCount(d);
    const mounted = d.id === this.mountedId;
    const chips = [focalText(d), apertureText(d), d.format === 'full-frame' ? null : FORMAT_LABEL[d.format], weightText(d.weightG)].filter(Boolean);
    return `<button class="lib-card" role="listitem" data-id="${d.id}" aria-label="${esc(`${d.brand} ${d.name}`)}">
  <div class="lib-card-art">${glyphSvg(d, this.longest)}</div>
  <div class="lib-card-body">
    <div class="lib-card-brand">${esc(d.brand)} · ${CATEGORY_LABEL[d.category]}${mounted ? ' <em>in the lab</em>' : ''}</div>
    <div class="lib-card-name">${esc(d.name)}</div>
    <div class="lib-card-chips">${chips.map((c) => `<span>${esc(c!)}</span>`).join('')}</div>
    <p class="lib-card-famous">${esc(d.famousFor)}</p>
    ${unv ? `<div class="lib-card-unv">${unv} value${unv > 1 ? 's' : ''} unverified</div>` : ''}
  </div>
</button>`;
  }

  private teachingCard(): string {
    return `<button class="lib-card teaching" role="listitem" data-id="teaching" aria-label="Lens Lab 50 mm f/2 teaching lens">
  <div class="lib-card-art"><svg class="lib-glyph" viewBox="0 0 132 56" aria-hidden="true"><rect x="40" y="10" width="50" height="36" rx="5" class="g-body"/><ellipse cx="90" cy="28" rx="3" ry="15" class="g-glass"/></svg></div>
  <div class="lib-card-body">
    <div class="lib-card-brand">Lens Lab · Teaching lens${this.mountedId === null ? ' <em>in the lab</em>' : ''}</div>
    <div class="lib-card-name">50 mm f/2 double-Gauss</div>
    <div class="lib-card-chips"><span>50 mm</span><span>f/2</span><span>6 elements</span></div>
    <p class="lib-card-famous">The hand-built classic from the first chapter: six elements, unit focusing, a helicoid you can watch move.</p>
  </div>
</button>`;
  }

  // ------------------------------------------------------------------ detail

  /** Called whenever the selection changes (deep links). */
  onSelect: (id: string) => void = () => {};

  private select(id: string, fromClick: boolean): void {
    this.selected = id;
    this.onSelect(id);
    this.$grid.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.classList.toggle('sel', c.dataset.id === id));
    this.renderDetail();
    if (fromClick) {
      this.root.classList.add('show-detail');
      this.$detail.scrollTop = 0;
      this.$detail.querySelector<HTMLElement>('.lib-d-load')?.focus({ preventScroll: true });
    }
  }

  private renderDetail(): void {
    const d = this.lenses.find((l) => l.id === this.selected);
    if (!d) {
      this.$detail.innerHTML = `<div class="lib-d-empty">Pick a lens to see its specs, what reviewers say about it, and its sources.</div>`;
      return;
    }
    const { lens } = layoutFor(d);
    const zoom = isZoomData(d);
    const v = (x: string | null) => (x === null ? UNVERIFIED : esc(x));
    const specials =
      d.specialElements === null
        ? UNVERIFIED
        : d.specialElements.length === 0
          ? 'None listed by the maker'
          : glassLegend(d.specialElements)
              .map((g) => `<span class="glass" title="${esc(g.kinds.map((k) => SPECIAL_KIND_NAMES[k]).join(' + '))}"><i style="color:${g.color}"></i>${esc(g.label)} ×${g.count}</span>`)
              .join('');
    const af = d.autofocus;
    const rows: [string, string][] = [
      ['Focal length', esc(focalText(d))],
      ['Angle of view', esc(fovText(d))],
      ...(equivalentText(d) ? ([['Full-frame equivalent', esc(equivalentText(d)!)]] as [string, string][]) : []),
      ['Maximum aperture', esc(apertureText(d))],
      ['Minimum aperture', v(minApertureText(d))],
      ['Construction', v(constructionText(d))],
      ['Special glass', specials],
      ['Aperture blades', d.apertureBlades === null ? UNVERIFIED : `${d.apertureBlades}`],
      ['Closest focus', v(mfdText(d)) + '<small> from the sensor plane</small>'],
      ['Max. magnification', v(magnificationText(d.maxMagnification))],
      ['Stabilization', v(stabilizationText(d))],
      ['Autofocus', af === null ? UNVERIFIED : esc(af)],
      ['Mechanism', mechanismText(d) === null ? '<span class="muted">not published</span>' : esc(mechanismText(d)!)],
      ['Weight', v(weightText(d.weightG))],
      ['Size', v(dimensionsText(d))],
      ['Filter', d.filterMm === null ? (d.notes && /filter/i.test(d.notes) ? '<span class="muted">see notes</span>' : UNVERIFIED) : esc(filterText(d)!)],
      ['Mount', esc([d.mount, ...(d.mounts ?? []).filter((m) => m !== d.mount)].join(', '))],
      ['Format', esc(FORMAT_LABEL[d.format])],
      ['Released', d.releaseYear === null ? UNVERIFIED : `${d.releaseYear}`],
      ['Launch price', v(priceText(d))],
    ];
    const list = (items: string[]) => (items.length ? `<ul>${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : `<p class="muted">No review summary yet.</p>`);
    const loads = zoom
      ? [d.focalLength.min, Math.round(Math.sqrt(d.focalLength.min * d.focalLength.max)), d.focalLength.max]
          .map((f) => `<button class="btn chip-f" data-load="${d.id}" data-focal="${f}">at ${f} mm</button>`)
          .join('')
      : '';
    const sources = d.sources
      .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="src-kind ${s.kind}">${s.kind}</span> <span class="src-dom">${esc(sourceDomain(s))}</span></li>`)
      .join('');
    const counts = lens.assumed.includes('elements')
      ? `Construction not published — ${lens.elements} elements drawn as an example`
      : lens.assumed.includes('groups')
        ? `The element count is ${d.brand}'s (the group count is not published — ${lens.groups} groups assumed)`
        : `Element and group counts are ${d.brand}'s`;
    const layoutNote = `${counts}${d.specialElements?.length ? `, special glass as listed by ${d.brand}` : ''}; shapes, spacings and group motion are schematic${lens.assumed.includes('dimensions') ? ', barrel proportions assumed (dimensions unverified)' : ''}.`;
    this.$detail.innerHTML = `
<div class="lib-d">
  <button class="btn lib-d-back mobile-only" data-act="back">← All lenses</button>
  <div class="lib-d-brand">${esc(d.brand)} · ${CATEGORY_LABEL[d.category]} · ${esc(FORMAT_LABEL[d.format])}</div>
  <h3>${esc(d.name)}</h3>
  <p class="lib-d-famous">${esc(d.famousFor)}</p>
  <div class="lib-d-actions">
    <button class="btn primary lib-d-load" data-load="${d.id}">${d.id === this.mountedId ? 'Back to the lab' : 'Load into the lab'}</button>
    ${loads}
  </div>
  <figure class="lib-d-fig">
    ${crossSectionSvg(d)}
    <figcaption><span class="lc-note">Illustrative layout</span> ${esc(layoutNote)}</figcaption>
  </figure>
  <dl class="lib-d-specs">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
  <section class="lib-d-text">
    <h4>Strengths</h4>${list(d.strengths)}
    <h4>Weaknesses</h4>${list(d.weaknesses)}
    <h4>Best for</h4>${list(d.bestFor)}
    ${d.notes ? `<h4>Notes on the data</h4><p class="muted">${esc(d.notes)}</p>` : ''}
  </section>
  <section class="lib-d-sources">
    <h4>Sources <small>checked ${esc(d.checked)}</small></h4>
    <ul>${sources}</ul>
    <p class="muted">Specs come from ${esc(d.brand)}'s own pages first; reviews only fill gaps and supply the strengths / weaknesses summary.</p>
  </section>
</div>`;
  }
}
