// Pure view-model helpers of the UI (no DOM). Run: cd server && npx vitest run --root ../web/src
import { describe, expect, it } from 'vitest';
import type { Activity, CompanySnapshot, SessionInfo, WorldEvent } from '../../../shared/types';
import { asSession } from '../api';
import { withSession } from '../store';
import { mockSnapshot } from '../world/mockSnapshot';
import { activityProductId, budgetView, customerLabel, nextStepTitle, sessionView } from './derive';
import { eventToast } from './useEventToasts';

const session = (o: Partial<SessionInfo> = {}): SessionInfo => ({ runId: 'demo-pixel-agency', playing: true, speed: 4, busy: false, mindMode: 'heuristic', lastError: null, ...o });
const snap = (o: Partial<CompanySnapshot> = {}): CompanySnapshot => ({ ...mockSnapshot(), ...o });

describe('sessionView — snapshot.session is the source of truth for play/pause and speed', () => {
  it('uses the server loop state even when the run status disagrees', () => {
    // between two ticks the server reports status "paused" while the loop is playing
    const v = sessionView(snap({ status: 'paused', session: session({ playing: true, speed: 4 }) }), 1);
    expect(v).toMatchObject({ playing: true, speed: 4, fromServer: true });
    const p = sessionView(snap({ status: 'running', session: session({ playing: false, speed: 2 }) }), 8);
    expect(p).toMatchObject({ playing: false, speed: 2 });
  });

  it('falls back to the run status and the local speed without a session', () => {
    const { session: _none, ...rest } = snap();
    expect(sessionView({ ...rest, status: 'running' }, 8)).toMatchObject({ playing: true, speed: 8, fromServer: false, lastError: null });
    expect(sessionView({ ...rest, status: 'paused' }, 2)).toMatchObject({ playing: false, speed: 2 });
    expect(sessionView(null, 1)).toMatchObject({ playing: false, speed: 1, ended: false });
  });

  it('exposes lastError (trimmed) and busy, ignores invalid speeds, never plays a finished run', () => {
    const v = sessionView(snap({ session: session({ lastError: '  disque plein  ', busy: true, speed: 3 as never }) }), 2);
    expect(v).toMatchObject({ lastError: 'disque plein', busy: true, speed: 2 });
    expect(sessionView(snap({ session: session({ lastError: '   ' }) }), 1).lastError).toBeNull();
    expect(sessionView(snap({ status: 'bankrupt', session: session({ playing: true }) }), 1)).toMatchObject({ playing: false, ended: true });
  });

  it('a control response patches snapshot.session right away (same run only)', () => {
    const s = snap({ session: session({ playing: true, speed: 1 }) });
    const next = withSession(s, session({ playing: false, speed: 8, status: 'paused' }))!;
    expect(next.session).toMatchObject({ playing: false, speed: 8 });
    expect(next.status).toBe('paused');
    expect(withSession(s, session({ runId: 'autre-run', playing: false }))).toBe(s);
    expect(asSession({ runId: 'r', playing: true, speed: 2 })).toBeTruthy();
    expect(asSession({ runId: 'r', playing: true, speed: 3 })).toBeUndefined();
    expect(asSession('nope')).toBeUndefined();
  });
});

describe('customerLabel — inbox shows names, not ids', () => {
  it('prefers customerName and falls back to the id', () => {
    expect(customerLabel({ customerId: 'cus_12', customerName: 'Sophie L.' })).toBe('Sophie L.');
    expect(customerLabel({ customerId: 'cus_12', customerName: '  ' })).toBe('Client cus_12');
    expect(customerLabel({ customerId: 'cus_12' })).toBe('Client cus_12');
  });
});

describe('nextStepTitle — « La suite est ici » printed once', () => {
  it('strips the prefix the minds already put in the title', () => {
    expect(nextStepTitle('La suite est ici : aller plus loin')).toBe('aller plus loin');
    expect(nextStepTitle('La suite est ici : « Siestes faciles »')).toBe('Siestes faciles');
    expect(nextStepTitle('la suite est ici — Le guide des siestes')).toBe('Le guide des siestes');
    expect(nextStepTitle('La suite est ici : La suite est ici : x')).toBe('x');
  });
  it('returns an empty string when only the prefix is left', () => {
    expect(nextStepTitle('La suite est ici')).toBe('');
    expect(nextStepTitle('La suite est ici :')).toBe('');
    expect(nextStepTitle(undefined)).toBe('');
  });
  it('keeps other titles untouched', () => {
    expect(nextStepTitle('Siestes faciles : le guide')).toBe('Siestes faciles : le guide');
  });
});

describe('activityProductId — feed lines link to the product', () => {
  const ev = (o: Partial<WorldEvent>): WorldEvent => ({ id: 'e', day: 5, kind: 'ad_rejected', title: 'Pub refusée', description: 'd', severity: 'danger', ...o });
  const act = (o: Partial<Activity>): Activity => ({ id: 'a', day: 5, tick: 10, at: 0, agentId: null, kind: 'event', text: 'Pub refusée — promesse trop forte', ...o });

  it('uses the activity refs first', () => {
    expect(activityProductId(act({ kind: 'ad', refs: { productId: 'prd_9' } }), [])).toBe('prd_9');
  });
  it('maps an event line to the world event it announces (refs.productId)', () => {
    const events = [ev({ id: 'e1', refs: { productId: 'prd_1' } }), ev({ id: 'e2', title: 'Hausse du CPM' })];
    expect(activityProductId(act({}), events)).toBe('prd_1');
    expect(activityProductId(act({ text: 'Hausse du CPM — +30 %' }), events)).toBeNull();
    expect(activityProductId(act({ day: 9 }), events)).toBeNull(); // another day's event
    expect(activityProductId(act({ kind: 'thought' }), events)).toBeNull();
  });
  it('event toasts carry the « Voir le produit » action when given one', () => {
    const run = () => undefined;
    expect(eventToast(ev({ refs: { productId: 'prd_1' } }), { label: 'Voir le produit', run }).action?.label).toBe('Voir le produit');
    expect(eventToast(ev({})).action).toBeUndefined();
  });
});

describe('budgetView — CFO envelope of the day', () => {
  it('reads company.budget', () => {
    const s = snap();
    const b = budgetView({ ...s, day: 10, company: { ...s.company, budget: { day: 10, adCap: 25, survival: true, note: ' Trésorerie basse ' } } });
    expect(b).toEqual({ adCap: 25, survival: true, note: 'Trésorerie basse', day: 10, stale: false });
  });
  it('flags an envelope from an earlier day and tolerates its absence', () => {
    const s = snap();
    expect(budgetView({ ...s, day: 11, company: { ...s.company, budget: { day: 10, adCap: 0, survival: false, note: '' } } })?.stale).toBe(true);
    expect(budgetView({ ...s, company: { ...s.company, budget: null } })).toBeNull();
    expect(budgetView(null)).toBeNull();
  });
  it('falls back to the last done budget_review task (runs saved before company.budget existed)', () => {
    const s = snap();
    const { budget: _b, ...company } = s.company;
    const review = { ...s.company.tasks[0]!, id: 'tsk_b', kind: 'budget_review' as const, status: 'done' as const, dayDone: 9, output: { adCap: 18.4, survival: true, cash: 120 } };
    const v = budgetView({ ...s, day: 10, company: { ...company, tasks: [...s.company.tasks, review] } });
    expect(v).toMatchObject({ adCap: 18.4, survival: true, day: 9, stale: true });
    expect(budgetView({ ...s, company: { ...company, tasks: [] } })).toBeNull();
  });
});
