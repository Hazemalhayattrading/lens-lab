import { loadPhones } from '../data/library';
import { esc, tag, type Topic, type TopicContext, type TopicId } from '../learn/dom';
import { createComputationalTopic } from '../learn/topics/computational';
import { createEquivalenceTopic } from '../learn/topics/equivalence';
import { createPeriscopeTopic } from '../learn/topics/periscope';
import { createSmallSensorsTopic } from '../learn/topics/smallSensors';
import '../styles/learn.css';

export interface LearnHandlers {
  onClose(): void;
}

export const TOPIC_IDS: readonly TopicId[] = ['small-sensors', 'equivalence', 'periscope', 'computational'];

const isTopic = (id: string | undefined | null): id is TopicId => !!id && (TOPIC_IDS as readonly string[]).includes(id);

/**
 * "Learn": four explainers with live visuals — small-sensor depth of field, equivalence, periscope
 * zoom and computational photography. Lazy-loaded like the library (this module, its CSS, the topic
 * code and the phone data are only fetched on first open). Every number is computed with the lab's
 * physics from the researched phone data and tagged published / computed / example.
 */
export class LearnView {
  readonly root: HTMLElement;
  /** Called whenever the topic changes (deep links #learn/<topic>). */
  onSelect: (id: TopicId) => void = () => {};
  private readonly topics: Topic[];
  private readonly panels = new Map<TopicId, HTMLElement>();
  private readonly mounted = new Set<TopicId>();
  private readonly $nav: HTMLElement;
  private readonly $main: HTMLElement;
  private current: TopicId = 'small-sensors';
  private ctx: TopicContext | null = null;
  private readonly ready: Promise<void>;
  private lastFocus: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    private readonly h: LearnHandlers,
  ) {
    this.topics = [createSmallSensorsTopic(), createEquivalenceTopic(), createPeriscopeTopic(), createComputationalTopic()];
    const root = document.createElement('div');
    root.className = 'learn';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Learn — explainers');
    const tabs = this.topics
      .map(
        (t, i) => `<button class="learn-tab" role="tab" id="learn-tab-${t.id}" data-topic="${t.id}" aria-controls="learn-panel-${t.id}" aria-selected="false" tabindex="-1">
  <span class="lt-n">${String(i + 1).padStart(2, '0')}</span>
  <span class="lt-t"><strong>${esc(t.title)}</strong><small>${esc(t.blurb)}</small></span>
  <span class="lt-short">${esc(t.short)}</span>
</button>`,
      )
      .join('');
    const panels = this.topics
      .map((t) => `<section class="learn-panel" role="tabpanel" id="learn-panel-${t.id}" aria-labelledby="learn-tab-${t.id}" data-panel="${t.id}" hidden></section>`)
      .join('');
    root.innerHTML = `
<div class="learn-shell">
  <header class="learn-head">
    <div class="learn-title">
      <h2>Learn</h2>
      <p>Four explainers<span class="long"> · every number computed with the lab’s physics from published phone specs</span></p>
    </div>
    <button class="icon-btn learn-close" data-act="close" aria-label="Close the explainers (Esc)">✕</button>
  </header>
  <div class="learn-body">
    <aside class="learn-side">
      <nav class="learn-nav" role="tablist" aria-label="Explainers" aria-orientation="vertical">${tabs}</nav>
      <div class="learn-key">
        <h4>Where the numbers come from</h4>
        <p>${tag('pub')} from the maker or a cited review, as stored in the lab’s phone data.</p>
        <p>${tag('calc')} derived from published values with the lab’s thin-lens physics.</p>
        <p>${tag('ex')} a stand-in where nothing is published — never a spec.</p>
      </div>
    </aside>
    <div class="learn-main" tabindex="-1">${panels}</div>
  </div>
</div>`;
    host.appendChild(root);
    this.root = root;
    this.$nav = root.querySelector('.learn-nav')!;
    this.$main = root.querySelector('.learn-main')!;
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => this.panels.set(p.dataset.panel as TopicId, p));

    root.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
    this.$nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-topic]');
      if (b) this.select(b.dataset.topic as TopicId);
    });
    this.$nav.addEventListener('keydown', (e) => {
      const i = TOPIC_IDS.indexOf(this.current);
      const vertical = !window.matchMedia('(max-width: 820px)').matches;
      const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      let j = -1;
      if (e.key === next) j = (i + 1) % TOPIC_IDS.length;
      else if (e.key === prev) j = (i + TOPIC_IDS.length - 1) % TOPIC_IDS.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = TOPIC_IDS.length - 1;
      if (j < 0) return;
      e.preventDefault();
      this.select(TOPIC_IDS[j], true);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    this.ready = loadPhones().then((phones) => {
      this.ctx = { phones };
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  /** Opens the view on a topic (default: the last one shown). */
  async open(topicId?: string): Promise<void> {
    if (!this.isOpen) this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.classList.add('open');
    document.body.classList.add('learn-open');
    await this.ready;
    if (!this.isOpen) return;
    this.select(isTopic(topicId) ? topicId : this.current, false, true);
    const tab = this.$nav.querySelector<HTMLElement>(`[data-topic="${this.current}"]`);
    if (!window.matchMedia('(max-width: 820px)').matches) tab?.focus({ preventScroll: true });
    else this.root.querySelector<HTMLElement>('.learn-close')!.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.topicOf(this.current).setActive(false);
    this.root.classList.remove('open');
    document.body.classList.remove('learn-open');
    this.h.onClose();
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  private topicOf(id: TopicId): Topic {
    return this.topics.find((t) => t.id === id)!;
  }

  private select(id: TopicId, focusTab = false, force = false): void {
    if (!this.ctx) return;
    const changed = id !== this.current;
    if (!changed && !force && this.mounted.has(id)) return;
    if (changed) this.topicOf(this.current).setActive(false);
    this.current = id;
    const panel = this.panels.get(id)!;
    if (!this.mounted.has(id)) {
      this.topicOf(id).mount(panel, this.ctx);
      this.mounted.add(id);
    }
    this.panels.forEach((p, k) => (p.hidden = k !== id));
    this.$nav.querySelectorAll<HTMLElement>('[data-topic]').forEach((b) => {
      const on = b.dataset.topic === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
    });
    const tab = this.$nav.querySelector<HTMLElement>(`[data-topic="${id}"]`)!;
    if (focusTab) tab.focus({ preventScroll: true });
    // keep the active chip visible in the mobile strip
    tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (changed) this.$main.scrollTop = 0;
    this.topicOf(id).setActive(true);
    this.onSelect(id);
  }
}
