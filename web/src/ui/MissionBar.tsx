// Bottom-centre mission bar: the founder briefs the CEO (or a chief), who splits and delegates.
import { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Avatar, cx } from './common';
import { useApp } from './context';
import { Icon } from './icons';
import { deptColor, deptName, firstName } from './labels';

const SUGGESTIONS = [
  'Trouve une nouvelle niche rentable et lance un 2e guide',
  'Coupe les pubs dont le ROAS est sous 1,2',
  'Teste un prix plus haut sur le guide qui se vend le mieux',
  'Réponds en priorité aux clients furieux',
];

export function MissionBar() {
  const { snapshot, lookups, demo, toast, refresh } = useApp();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chiefs = useMemo(() => (snapshot?.company?.agents ?? []).filter((a) => a.isChief), [snapshot]);
  const ceo = lookups.ceo;
  const target = (targetId && lookups.agents.get(targetId)) || ceo;
  const targetName = target ? firstName(target.name) : 'Camille';
  const ceoName = ceo ? firstName(ceo.name) : 'Camille';

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    if (demo) {
      toast({ tone: 'warn', title: 'Mode démo', text: 'Lance le serveur (npm run dev) pour que l’équipe exécute vraiment la mission.' });
      return;
    }
    setSending(true);
    try {
      const res = await api.mission(t, target && target.id !== ceo?.id ? target.id : undefined);
      if (!res.ok) throw new Error(res.message ?? 'Mission refusée');
      // the company can answer on the spot: niche not understood, already in progress, product already live…
      const asked = `« ${t.length > 90 ? `${t.slice(0, 90)}…` : t} »`;
      if (res.status === 'failed') toast({ tone: 'warn', icon: 'alert', title: `${targetName} ne peut pas s’en charger`, text: res.message ?? asked, ttl: 9000 });
      else toast({ tone: 'good', icon: 'flag', title: `Mission confiée à ${targetName}`, text: res.message ? `${asked} ${res.message}` : asked, ttl: res.message ? 7000 : undefined });
      setText('');
      refresh();
    } catch (e) {
      toast({ tone: 'bad', title: 'La mission n’est pas partie', text: e instanceof Error ? e.message : 'Erreur inconnue' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mission glass">
      <div className="mission-row">
        <div className="mission-target">
          <button type="button" className="target-btn" onClick={() => setPickerOpen((v) => !v)} title="Choisir à qui confier la mission">
            <Avatar name={targetName} color={deptColor(lookups, target?.dept ?? 'direction')} size={22} />
            <span>{targetName}</span>
            <Icon name="chevronDown" size={13} />
          </button>
          {pickerOpen ? (
            <div className="target-drop glass" onMouseLeave={() => setPickerOpen(false)}>
              <div className="search-head">Confier à</div>
              {(chiefs.length ? chiefs : ceo ? [ceo] : []).map((a) => (
                <button key={a.id} type="button" className={cx('search-item', a.id === target?.id && 'search-item-on')}
                  onClick={() => { setTargetId(a.id); setPickerOpen(false); inputRef.current?.focus(); }}>
                  <Avatar name={a.name} color={deptColor(lookups, a.dept)} size={22} />
                  <span className="search-main">
                    <span className="search-name">{a.name}</span>
                    <span className="search-role">{a.role} · {deptName(lookups, a.dept)}</span>
                  </span>
                </button>
              ))}
              {chiefs.length === 0 && !ceo ? <div className="search-empty">Aucun agent disponible.</div> : null}
            </div>
          ) : null}
        </div>
        <input
          ref={inputRef}
          className="mission-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={`Donne une mission à ${targetName}…`}
          maxLength={500}
          aria-label="Mission"
          list="mission-suggestions"
        />
        <datalist id="mission-suggestions">
          {SUGGESTIONS.map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="button" className={cx('send-btn', text.trim() && 'send-ready')} onClick={() => void send()} disabled={!text.trim() || sending} title="Envoyer (Entrée)" aria-label="Envoyer la mission">
          {sending ? <span className="spinner spinner-light" /> : <Icon name="send" size={15} />}
        </button>
      </div>
      <div className="mission-foot">
        <span className="mission-hint">{ceoName} orchestre l’équipe et délègue aux bons agents</span>
        <span className="tier-chips" aria-hidden="true">
          <span className="tier-chip tier-opus">Opus</span>
          <span className="tier-chip tier-sonnet">Sonnet</span>
          <span className="tier-chip tier-haiku">Haiku</span>
        </span>
      </div>
    </div>
  );
}
