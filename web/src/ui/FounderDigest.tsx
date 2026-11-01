// What happened while the founder was away (ui §6.7). The digest itself is scale's: this draws it, and decides when it opens.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChronicleEntry, CompanySnapshot, FounderDigest as Digest } from '../../../shared/types';
import { api } from '../api';
import { Empty, Stat } from './common';
import { useApp } from './context';
import { fmtEur, fmtEurSigned, fmtInt, fmtRoas, plural } from './format';
import { Icon } from './icons';
import { STAGE_LABEL } from './StageBadge';
import { useDetail } from './useDetail';
import { entryTarget } from './useEventToasts';
import { routeKey } from './viewers/Lightbox';

export const DIGEST_MIN_DAYS = 7; // scale §8
const SEEN_EVERY_MS = 30_000;

/** The digest is owed: he has been gone a week of the company's time. No value, an old save with no growth: nothing is owed. */
export function digestDue(lastSeenDay: number | null, day: number): boolean {
  return lastSeenDay !== null && day - lastSeenDay >= DIGEST_MIN_DAYS;
}

export interface DigestClock { runId: string; day: number; lastSeenDay: number | null }

/**
 * When the digest opens and when « seen » goes out. The gap is counted from the day he last had in front of him, whatever the last
 * post says, so a run he watches at ×8 never opens it in his face, however far behind the posts are, and neither does a tab hidden
 * for a moment. Nothing is posted from a hidden tab: that is how the gap builds up. Nor on the word of a page that may be behind the
 * company: a tab just back, or a stream just back, can hold an old snapshot, and the server would write down today for a day he
 * never saw. The first fresh snapshot decides, so that check is made on every snapshot he has in front of him.
 * Outside React, the clock and the visibility passed in, so a test can drive it. true: open the digest now.
 */
export function digestWatch(post: () => void) {
  let runId: string | null = null;
  let looked: number | null = null;   // the last day he had in front of him; null: this run, not yet
  let behind = false;                 // the tab was away or the stream down, and no new day has shown since
  let reading = false;
  let postedAt = Number.NEGATIVE_INFINITY;

  const owed = (c: DigestClock): boolean => digestDue(c.lastSeenDay === null ? null : Math.max(c.lastSeenDay, looked ?? c.lastSeenDay), c.day);
  const opens = (c: DigestClock): boolean => {
    const due = !reading && owed(c);
    looked = c.day;
    reading = reading || due;
    return due;
  };

  return {
    /** Each new snapshot, or the stream going down or coming back with the page still on the last one. */
    snapshot(c: DigestClock, visible: boolean, now: number, live = true): boolean {
      if (c.runId !== runId) {
        runId = c.runId;
        looked = null;
        behind = false;
        reading = false;
        postedAt = Number.NEGATIVE_INFINITY;
      }
      if (!live) behind = true;
      if (!visible || !live) return false;
      if (looked === null || c.day > looked) behind = false;
      if (opens(c)) return true;
      // the world keeps the line: a digest he has not read yet stays owed if he reloads over it
      if (behind || reading || c.lastSeenDay === null || c.lastSeenDay >= c.day || now - postedAt < SEEN_EVERY_MS) return false;
      postedAt = now;
      post();
      return false;
    },
    /** The tab was hidden or came back. */
    visibility(c: DigestClock, visible: boolean): boolean {
      if (visible) return opens(c);
      looked = c.day;
      behind = true;
      return false;
    },
    /** The page goes away with him on it: what he watched since the last post counts, a digest left unread stays owed. */
    leaving(): boolean { return runId !== null && !reading && !behind; },
    /** He asked for it (« Résumé », `d`). */
    open(): void { reading = true; },
    /** « Reprendre », Esc, or a line that took him elsewhere. */
    close(now: number): void {
      reading = false;
      postedAt = now;
      post();
    },
  };
}

const clockOf = (s: CompanySnapshot): DigestClock => ({ runId: s.runId, day: s.day, lastSeenDay: s.company?.growth?.founder?.lastSeenDay ?? null });
const tabVisible = (): boolean => document.visibilityState === 'visible';

/** null: since the day he last looked, the server's default. A day: the last week, asked by hand. */
export type DigestWindow = { since: number | null };

export function useFounderDigest(snapshot: CompanySnapshot | null, demo: boolean, live: boolean) {
  const [open, setOpen] = useState<DigestWindow | null>(null);
  const watch = useMemo(() => digestWatch(() => { void api.digestSeen().catch(() => undefined); }), []);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const shownRun = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    if (shownRun.current !== snapshot.runId) {
      shownRun.current = snapshot.runId;
      setOpen(null);
    }
    if (demo) return;
    if (watch.snapshot(clockOf(snapshot), tabVisible(), Date.now(), live)) setOpen({ since: null });
  }, [snapshot, demo, live, watch]);

  useEffect(() => {
    if (demo) return undefined;
    const onChange = () => {
      const s = latest.current;
      if (s && watch.visibility(clockOf(s), tabVisible())) setOpen({ since: null });
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [demo, watch]);

  useEffect(() => {
    if (demo) return undefined;
    // at ×8 the 30 s since the last post are ten days: a reload would open the digest on a run he never left
    const onLeave = () => { if (tabVisible() && watch.leaving()) navigator.sendBeacon('/api/digest/seen'); };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [demo, watch]);

  const show = useCallback(() => {
    watch.open();
    setOpen({ since: Math.max(1, (latest.current?.day ?? 1) - DIGEST_MIN_DAYS + 1) });
  }, [watch]);
  const close = useCallback(() => {
    watch.close(Date.now());
    setOpen(null);
  }, [watch]);

  return { open, show, close };
}

// ───────────────────────────── The page ─────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="digest-section"><h3>{title}</h3>{children}</section>;
}

function Lines({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return <Section title={title}><ul className="bullets">{lines.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ul></Section>;
}

const tone = (n: number) => (n > 0 ? 'good' : n < 0 ? 'bad' : null);

function Highlights({ entries, onEntry }: { entries: readonly ChronicleEntry[]; onEntry(e: ChronicleEntry): void }) {
  if (entries.length === 0) return null;
  return (
    <Section title="Ce qui a compté">
      <ul className="digest-list">
        {entries.map((e) => (
          <li key={e.key}>
            <button type="button" className="digest-entry" onClick={() => onEntry(e)}>
              <span className="team-day">J{e.day}</span>
              <span className="team-line"><span>{e.text}</span>{e.why ? <span className="muted small">{e.why}</span> : null}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Decisions({ decisions }: { decisions: Digest['decisions'] }) {
  if (decisions.length === 0) return null;
  return (
    <Section title="Décisions">
      <ul className="digest-list">
        {decisions.map((d) => (
          <li key={d.id} className="digest-decision">
            <span className="team-day">J{d.day}</span>
            <span className="team-line"><span>{d.text}</span><span className="muted small">{d.why}</span></span>
            {d.impactEur !== undefined ? <strong className={d.impactEur < 0 ? 'txt-bad' : 'txt-good'}>{fmtEurSigned(d.impactEur)}</strong> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function money(title: string, profit: number): string {
  return `${title} : ${fmtEurSigned(profit)}`;
}

function productLines(p: Digest['products']): string[] {
  return [
    ...p.launched.map((t) => `Lancé : ${t}`),
    ...p.stopped.map((s) => `${s.harvest ? 'En récolte' : 'Arrêté'} : ${s.title}. ${s.why}`),
    ...p.reworked.map((t) => `Retravaillé : ${t}`),
    ...(p.best ? [money(`Meilleur : ${p.best.title}`, p.best.profit)] : []),
    ...(p.worst ? [money(`Pire : ${p.worst.title}`, p.worst.profit)] : []),
  ];
}

function channelLines(c: Digest['channels']): string[] {
  return [
    ...c.opened.map((n) => `Ouvert : ${n}`),
    ...c.closed.map((n) => `Fermé : ${n}`),
    ...(c.best ? [`Meilleur ROAS boutique : ${c.best.name}, ${fmtRoas(c.best.reconciledRoas)}`] : []),
  ];
}

/** Losses as plain as gains: signed amounts, nothing rounded away, every list printed whole. */
export function FounderDigestBody({ data, onEntry, onTasks }: { data: Digest; onEntry(e: ChronicleEntry): void; onTasks(): void }) {
  const { money: m, stage, people, audience: list } = data;
  const cash = m.cashEnd - m.cashStart;
  return (
    <>
      <p className="digest-headline">{data.headline}</p>
      <div className="stats-row">
        <Stat label="Trésorerie" value={fmtEurSigned(cash)} sub={`${fmtEur(m.cashStart)} → ${fmtEur(m.cashEnd)}`} tone={tone(cash)} />
        <Stat label="Profit" value={fmtEurSigned(m.profit)} sub={m.previousProfit === null ? undefined : `${fmtEurSigned(m.previousProfit)} la période d’avant`} tone={tone(m.profit)} />
        <Stat label="Effectif" value={`${fmtInt(people.headFrom)} → ${fmtInt(people.headTo)}`} />
        <Stat label="Palier" value={stage.from === stage.to ? STAGE_LABEL[stage.to] : `${STAGE_LABEL[stage.from]} → ${STAGE_LABEL[stage.to]}`} />
      </div>
      <div className="digest-money muted small">
        Ventes {fmtEur(m.revenue)} · Remboursements {fmtEur(m.refunds)} · Pub {fmtEur(m.adSpend)} · Frais {fmtEur(m.costs)}
        {list.size > 0 ? <> · Liste e-mail {fmtInt(list.size)} inscrits, +{fmtInt(list.added)}, {fmtInt(list.unsubscribed)} désinscrits, {fmtEur(list.revenue)} de ventes</> : null}
      </div>

      <Highlights entries={data.highlights} onEntry={onEntry} />
      <Decisions decisions={data.decisions} />
      <Lines title="Erreurs" lines={data.mistakes} />
      <Lines title="Incidents" lines={data.incidents} />
      <Lines title="Équipe" lines={[...people.hired.map((n) => `Arrivée : ${n}`), ...people.left.map((n) => `Départ : ${n}`)]} />
      <Lines title="Produits" lines={productLines(data.products)} />
      <Lines title="Canaux" lines={channelLines(data.channels)} />
      {data.waiting.length ? (
        <Section title="À décider">
          <ul className="bullets">{data.waiting.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
          <button type="button" className="link-btn small" onClick={onTasks}>Ouvrir les tâches</button>
        </Section>
      ) : null}
      <Lines title="La suite" lines={data.next} />
    </>
  );
}

/** Modal, not a toast: he must read it. The run goes on behind it, and only Esc or « Reprendre » closes it. */
export function FounderDigestModal({ since, onClose }: DigestWindow & { onClose(): void }) {
  const { snapshot, openAgent, openDept, setTab } = useApp();
  const [day] = useState(snapshot?.day ?? 0); // one digest per opening: a day passing behind it does not rewrite what he is reading
  const detail = useDetail<Digest>(since === null ? '/api/digest' : `/api/digest?since=${since}`, day);
  const data = detail.data;
  const rootRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    resumeRef.current?.focus({ preventScroll: true });
    // like the lightbox: at the window, or digits would switch tabs behind it
    const onKey = (e: KeyboardEvent) => routeKey(e, rootRef.current, () => close.current(), null);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const go = (e: ChronicleEntry) => {
    const target = entryTarget(e);
    onClose();
    if ('tab' in target) setTab(target.tab);
    else if ('agent' in target) openAgent(target.agent);
    else openDept(target.dept);
  };

  const title = since === null ? 'Pendant ton absence' : `Les ${DIGEST_MIN_DAYS} derniers jours`;
  return (
    <div className="modal-backdrop">
      <div className="modal glass digest" role="dialog" aria-modal="true" aria-label={title} ref={rootRef}>
        <header className="overlay-head">
          <span className="overlay-icon"><Icon name="clock" size={17} /></span>
          <div className="overlay-titles">
            <h2>{title}{data ? ` · J${data.fromDay} → J${data.toDay}` : ''}</h2>
            <div className="overlay-sub">{data ? `${plural(data.toDay - data.fromDay + 1, 'jour', 'jours')} de l’agence` : 'Ce que l’agence a fait'}</div>
          </div>
        </header>
        <div className="digest-body">
          {data ? <FounderDigestBody data={data} onEntry={go} onTasks={() => { onClose(); setTab('taches'); }} /> : null}
          {!data && detail.loading ? <div className="muted"><span className="spinner" /> Chargement…</div> : null}
          {!data && !detail.loading ? <Empty icon="alert">{detail.error ? `Résumé indisponible : ${detail.error}.` : 'Rien à résumer pour l’instant.'}</Empty> : null}
        </div>
        <footer className="digest-foot">
          <button type="button" ref={resumeRef} className="btn btn-dark" onClick={onClose}><Icon name="play" size={13} /> Reprendre</button>
        </footer>
      </div>
    </div>
  );
}
