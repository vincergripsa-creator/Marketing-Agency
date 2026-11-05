// The look of a guide as small chips (design plan D207): its art direction, its page template, its hero. French labels only.
import type { ArtStyle, Experiment, PageHero, PageTemplate } from '../../../shared/types';
import { Bar, cx, Pill } from './common';
import { lookBlurb, lookLabel, STYLE_INK, variantOn, type Look } from './design';
import { fmtInt, fmtPct } from './format';
import { Icon } from './icons';
import { EXPERIMENT_STATUS } from './labels';
import './looks.css';

/** A page test stops after 14 days at most, or once each variant has its sample (D204). */
export const PAGE_TEST_DAYS = 14;

/** What a page test found, in words: the variant of the day while it runs, then its winner or the page that stays. */
export function pageTestVerdict(e: Pick<Experiment, 'status' | 'winner' | 'variants' | 'day'>, day: number): string {
  const [control] = e.variants;
  if (e.status === 'running') {
    const today = variantOn(e, day);
    return `Les deux pages alternent chaque jour${today ? ` : aujourd’hui « ${lookLabel('template', today)} »` : ''}. Le test s’arrête sur son échantillon ou après ${PAGE_TEST_DAYS} jours.`;
  }
  if (e.status === 'cancelled') return `Annulé faute de trafic : « ${lookLabel('template', control)} » reste.`;
  return e.winner ? `« ${lookLabel('template', e.winner)} » gagne : la page le garde.` : `Pas de gagnant net : « ${lookLabel('template', control)} » reste.`;
}

/** A page_template test: its two templates, the conversion of each on its visitors, the winner crowned. */
export function PageTestRow({ e, day, product }: { e: Experiment; day: number; product?: string | null }) {
  const status = EXPERIMENT_STATUS[e.status];
  const today = e.status === 'running' ? variantOn(e, day) : undefined;
  const max = Math.max(0.0001, ...e.variants.map((v) => e.results?.[v]?.value ?? 0));
  const span = e.endDay ? `J${e.day} → J${e.endDay}` : e.status === 'running' ? `depuis J${e.day}, jour ${Math.max(1, day - e.day + 1)} sur ${PAGE_TEST_DAYS} au plus` : `J${e.day}`;
  return (
    <div className="page-test" data-test={e.id}>
      <div className="page-test-head">
        <Pill tone={status.tone} title={status.title}>{status.label}</Pill>
        {product ? <strong className="page-test-title">« {product} »</strong> : null}
        <span className="muted small">{span}</span>
      </div>
      {e.variants.map((v, i) => {
        const r = e.results?.[v];
        return (
          <div key={v} className={cx('arm', e.winner === v && 'arm-best')}>
            <span className="arm-label">
              {e.winner === v ? <Icon name="crown" size={11} /> : null}{lookLabel('template', v)}
              {i === 0 ? <span className="muted"> · sa page</span> : null}
              {today === v ? <span className="page-test-today">aujourd’hui</span> : null}
            </span>
            <Bar value={(r?.value ?? 0) / max} color={e.winner === v ? '#16a34a' : '#9ec5f4'} height={7} />
            <span className="arm-val" title="Conversion des visiteurs de cette page">{r?.n ? fmtPct(r.value, 1) : '—'}</span>
            <span className="arm-pulls muted" title="Visiteurs de cette page">{fmtInt(r?.n ?? 0)} vis.</span>
          </div>
        );
      })}
      <div className="page-test-verdict small">{pageTestVerdict(e, day)}</div>
    </div>
  );
}

export function StyleChip({ style, className }: { style: ArtStyle; className?: string }) {
  return (
    <span className={cx('look-chip look-style', className)} data-style={style} title={`Style « ${lookLabel('style', style)} » : ${lookBlurb('style', style)}`}>
      <span className="look-ink" style={{ background: STYLE_INK[style] ?? '#94a3b8' }} />
      {lookLabel('style', style)}
    </span>
  );
}

/** No template: the V1 page, « Classique ». */
export function TemplateChip({ template, className }: { template: PageTemplate | null; className?: string }) {
  return (
    <span className={cx('look-chip look-page', !template && 'look-v1', className)} data-template={template ?? 'v1'} title={`Gabarit « ${lookLabel('template', template)} » : ${lookBlurb('template', template)}`}>
      <Icon name="store" size={10} />
      {lookLabel('template', template)}
    </span>
  );
}

export function HeroChip({ hero, className }: { hero: PageHero; className?: string }) {
  return (
    <span className={cx('look-chip look-hero', className)} data-hero={hero} title={`Visuel « ${lookLabel('hero', hero)} » : ${lookBlurb('hero', hero)}`}>
      <Icon name="image" size={10} />
      {lookLabel('hero', hero)}
    </span>
  );
}

/** A guide's look in one row: nothing until its cover is drawn, the page once it is written. */
export function LookChips({ look, className }: { look: Look; className?: string }) {
  if (!look.style && !look.page) return null;
  return (
    <span className={cx('look-chips', className)}>
      {look.style ? <StyleChip style={look.style} /> : null}
      {look.page ? <TemplateChip template={look.template} /> : null}
      {look.page && look.hero ? <HeroChip hero={look.hero} /> : null}
    </span>
  );
}
