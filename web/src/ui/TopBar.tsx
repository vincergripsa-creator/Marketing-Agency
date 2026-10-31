// Floating top bar: logo + tabs (left), agent search + counters + toggles (right).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { AgentState, CompanySnapshot } from '../../../shared/types';
import { Avatar, ChiefBadge, cx, Kbd } from './common';
import { useApp } from './context';
import { Icon, PixelLogo } from './icons';
import { AGENT_STATUS_LABEL, BUSY_STATUSES, deptColor, deptName, TABS, type TabId } from './labels';
import './tabs/team.css';

const MORE_TABS = TABS.filter((t) => t.more);

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Where an arrow key sends the focus in a menu of `count` items, wrapping. Null: not a navigation key. */
export function menuTarget(key: string, index: number, count: number): number | null {
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function TopBar({ tab, onTab, flowMode, onFlow, godMode, onGod, onNewScenario, searchRef }: {
  tab: TabId; onTab(t: TabId): void;
  flowMode: boolean; onFlow(v: boolean): void;
  godMode: boolean; onGod(v: boolean): void;
  onNewScenario(): void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { snapshot } = useApp();
  const agents = snapshot?.company?.agents ?? [];
  const busy = agents.filter((a) => BUSY_STATUSES.has(a.status)).length;
  const badges = useMemo(() => tabBadges(snapshot), [snapshot]);
  // phone layout (CSS ≤ 760px): tabs + tools collapse behind a menu button
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const current = TABS.find((t) => t.id === tab);
  const totalBadges = (badges.taches ?? 0) + (badges.mail ?? 0);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [menuOpen]);

  const pick = (id: TabId) => { onTab(id); setMenuOpen(false); };

  return (
    <header className={cx('topbar', menuOpen && 'menu-open')} ref={headerRef}>
      <div className="glass bar-pill tabs-pill">
        <div className="logo" title="Pixel Agency — agence marketing autonome">
          <PixelLogo size={20} />
          <span className="logo-text">Pixel Agency</span>
        </div>
        <button type="button" className="menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-controls="topbar-menu"
          title={menuOpen ? 'Fermer le menu' : 'Menu : onglets et outils'}>
          <span className="menu-current">{current?.label ?? 'Bureau'}</span>
          {!menuOpen && totalBadges ? <span className="tab-badge">{totalBadges}</span> : null}
          <Icon name={menuOpen ? 'x' : 'menu'} size={17} />
        </button>
        <nav className="tabs" id="topbar-menu" aria-label="Onglets">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cx('tab', t.more && 'tab-phone', tab === t.id && 'tab-active')}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => pick(t.id)}
              title={`${t.label} (touche ${t.key})`}
            >
              {t.label}
              {badges[t.id] ? <span className={cx('tab-badge', t.id === 'taches' && (snapshot?.company?.pendingApprovals?.length ?? 0) > 0 && 'tab-badge-alert')}>{badges[t.id]}</span> : null}
            </button>
          ))}
        </nav>
        <MoreMenu tab={tab} badge={badges.mail ?? 0} onPick={pick} />
      </div>

      <div className="glass bar-pill right-pill">
        <AgentSearch agents={agents} inputRef={searchRef} onPicked={() => setMenuOpen(false)} />
        <span className="agents-count" title="Agents occupés en ce moment">
          <span className="live-dot" />
          <strong>{agents.length}</strong> agents · <strong>{busy}</strong> en cours
        </span>
        <span className="bar-sep" />
        <button type="button" className={cx('icon-btn', flowMode && 'icon-btn-on')} onClick={() => onFlow(!flowMode)}
          title={flowMode ? 'Mode flux activé : lectures du cerveau et délégations animées' : 'Mode flux : voir les agents lire le cerveau et se déléguer le travail'}
          aria-pressed={flowMode}>
          <Icon name="flow" />
        </button>
        <button type="button" className={cx('icon-btn', godMode && 'icon-btn-on icon-btn-god')} onClick={() => onGod(!godMode)}
          title={godMode ? 'Mode dieu activé : la vérité cachée du marché est visible' : 'Mode dieu : révéler la vérité cachée du marché (demande, prix accepté, vraies intentions, vrai talent)'}
          aria-pressed={godMode}>
          <Icon name="eye" />
        </button>
        <button type="button" className="btn btn-dark btn-sm new-btn" onClick={() => { setMenuOpen(false); onNewScenario(); }} title="Nouveau scénario">
          <Icon name="plus" size={14} /><span className="btn-label">Nouveau scénario</span>
        </button>
      </div>
    </header>
  );
}

/** The four tabs behind « Plus ». Sits outside `.tabs`, which scrolls and would clip the list. The agency answers its mail alone: the count is enough here. */
function MoreMenu({ tab, badge, onPick }: { tab: TabId; badge: number; onPick(id: TabId): void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = MORE_TABS.some((t) => t.id === tab);

  useEffect(() => { setOpen(false); }, [tab]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[Math.max(0, MORE_TABS.findIndex((t) => t.id === tab))]?.focus();
    const onDown = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Tab') { setOpen(false); return; }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      const at = itemRefs.current.findIndex((el) => el === document.activeElement);
      const next = menuTarget(e.key, at, MORE_TABS.length);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      itemRefs.current[next]?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open, tab]);

  return (
    <div className="more-wrap" ref={wrapRef}>
      <button type="button" ref={buttonRef} className={cx('tab more-btn', active && 'tab-active')} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} title="Plus d’onglets"
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
        Plus
        {badge ? <span className="tab-badge" title="Messages ouverts dans la boîte mail">{badge}</span> : null}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
      </button>
      {open ? (
        <div className="more-menu glass" role="menu" aria-label="Autres onglets">
          {MORE_TABS.map((t, i) => (
            <button key={t.id} type="button" role="menuitem" ref={(el) => { itemRefs.current[i] = el; }}
              className={cx('tab more-item', tab === t.id && 'tab-active')} aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => { setOpen(false); onPick(t.id); }}>
              <span className="more-item-label"><Icon name={t.icon} size={14} />{t.label}</span>
              <Kbd>{t.key}</Kbd>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function tabBadges(s: CompanySnapshot | null): Partial<Record<TabId, number>> {
  if (!s?.company) return {};
  const tasks = s.company.tasks ?? [];
  const approvals = s.company.pendingApprovals?.length ?? 0;
  const running = tasks.filter((t) => t.status === 'in_progress' || t.status === 'review').length;
  const open = (s.market?.inbox ?? []).filter((m) => m.status === 'open' || m.status === 'escalated').length;
  return {
    taches: approvals || running || 0,
    mail: open || 0,
    produits: (s.company.products ?? []).filter((p) => p.status === 'live').length || 0,
  };
}

function AgentSearch({ agents, inputRef, onPicked }: { agents: AgentState[]; inputRef: RefObject<HTMLInputElement | null>; onPicked?: () => void }) {
  const { lookups, openAgent } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const matches = useMemo(() => {
    const nq = norm(q.trim());
    const list = nq
      ? agents.filter((a) => norm(`${a.name} ${a.role} ${deptName(lookups, a.dept)} ${(a.skills ?? []).join(' ')}`).includes(nq))
      : agents.filter((a) => a.isChief);
    return list.slice(0, 8);
  }, [q, agents, lookups]);

  const pick = (a: AgentState | undefined) => {
    if (!a) return;
    openAgent(a.id);
    onPicked?.();
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(matches.length - 1, c + 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[cursor] ?? matches[0]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div className="search">
      <Icon name="search" size={14} className="search-icon" />
      <input
        ref={inputRef}
        value={q}
        placeholder="Demander à un agent…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKey}
        aria-label="Chercher un agent"
      />
      <Kbd>/</Kbd>
      {open ? (
        <div className="search-drop glass">
          <div className="search-head">{q.trim() ? `${matches.length} agent${matches.length > 1 ? 's' : ''}` : 'Chefs d’équipe'}</div>
          {matches.length === 0 ? <div className="search-empty">Aucun agent ne correspond à « {q} ».</div> : null}
          {matches.map((a, i) => (
            <button key={a.id} type="button" className={cx('search-item', i === cursor && 'search-item-on')}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setCursor(i)} onClick={() => pick(a)}>
              <Avatar name={a.name} color={deptColor(lookups, a.dept)} size={26} />
              <span className="search-main">
                <span className="search-name">{a.name}{a.isChief ? <ChiefBadge /> : null}</span>
                <span className="search-role">{a.role} · {deptName(lookups, a.dept)}</span>
              </span>
              <span className="search-status">{AGENT_STATUS_LABEL[a.status] ?? a.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
