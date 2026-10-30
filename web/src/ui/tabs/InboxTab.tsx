// Boîte mail: customer messages (email, TikTok comments, reviews, DMs) and the support threads.
import { useMemo, useState } from 'react';
import type { InboxMessage, MessageIntent, PublicInboxMessage } from '../../../../shared/types';
import { cx, Empty, Overlay, Pill, Segmented } from '../common';
import { useApp } from '../context';
import { customerLabel } from '../derive';
import { fmtEur, fmtInt } from '../format';
import { Icon } from '../icons';
import {
  agentName, CHANNEL_ICON, CHANNEL_LABEL, deptColor, INTENT_LABEL, INTENT_TONE, MESSAGE_STATUS_LABEL, MESSAGE_STATUS_TONE,
} from '../labels';

type Filter = 'all' | InboxMessage['status'];

function moodColor(m: number): string {
  if (m <= -0.5) return '#dc2626';
  if (m < -0.1) return '#f97316';
  if (m <= 0.25) return '#eab308';
  return '#16a34a';
}
function moodLabel(m: number): string {
  if (m <= -0.5) return 'furieux';
  if (m < -0.1) return 'agacé';
  if (m <= 0.25) return 'neutre';
  return 'ravi';
}

export function InboxTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const inbox = snapshot?.market?.inbox ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = useMemo(() => [...inbox].sort((a, b) => b.day - a.day || b.id.localeCompare(a.id)), [inbox]);
  const list = filter === 'all' ? sorted : sorted.filter((m) => m.status === filter);
  const selected = (selectedId && inbox.find((m) => m.id === selectedId)) || list[0] || null;
  const count = (s: InboxMessage['status']) => inbox.filter((m) => m.status === s).length;
  const day = snapshot?.day ?? 1;
  const overdue = inbox.filter((m) => m.status === 'open' && m.deadlineDay < day).length;

  return (
    <Overlay
      title="Boîte mail"
      subtitle={<>{fmtInt(inbox.length)} messages récents · {fmtInt(snapshot?.market?.customersCount ?? 0)} clients{overdue ? <span className="txt-bad"> · {overdue} en retard</span> : null}</>}
      icon="inbox"
      onClose={onClose}
    >
      <div className="filters-row">
        <Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'Tous', count: inbox.length },
          { id: 'open', label: 'Ouverts', count: count('open') },
          { id: 'replied', label: 'Répondus', count: count('replied') },
          { id: 'resolved', label: 'Résolus', count: count('resolved') },
          { id: 'escalated', label: 'Escaladés', count: count('escalated') },
        ]} />
      </div>
      {inbox.length === 0 ? <Empty icon="inbox">Boîte vide : les premiers messages arrivent avec les premières ventes (et les premiers trolls).</Empty> : (
        <div className="inbox">
          <div className="inbox-list">
            {list.length === 0 ? <Empty compact>Aucun message dans cette catégorie.</Empty> : null}
            {list.map((m) => <InboxRow key={m.id} m={m} active={selected?.id === m.id} onClick={() => setSelectedId(m.id)} day={day} />)}
          </div>
          <div className="inbox-thread">{selected ? <Thread m={selected} /> : <Empty>Sélectionne un message.</Empty>}</div>
        </div>
      )}
    </Overlay>
  );
}

/** Ground truth of a message: the snapshot only carries it in god mode, a message newer than the last god poll has none yet. */
function useIntent(m: PublicInboxMessage): MessageIntent | null {
  const { snapshot, godMode } = useApp();
  return (godMode && snapshot?.godMode?.intents?.[m.id]) || null;
}

function InboxRow({ m, active, onClick, day }: { m: PublicInboxMessage; active: boolean; onClick(): void; day: number }) {
  const intent = useIntent(m);
  const late = m.status === 'open' && m.deadlineDay < day;
  return (
    <button type="button" className={cx('inbox-row', active && 'is-active', m.status === 'open' && 'is-unread')} onClick={onClick}>
      <span className="inbox-channel" title={CHANNEL_LABEL[m.channel]}><Icon name={CHANNEL_ICON[m.channel] ?? 'mail'} size={14} /></span>
      <span className="inbox-main">
        <span className="inbox-subject">{m.subject || '(sans objet)'}</span>
        <span className="inbox-preview">{m.body}</span>
        <span className="inbox-meta">
          <span className="mood-dot" style={{ background: moodColor(m.mood) }} title={`Humeur : ${moodLabel(m.mood)}`} />
          <span title={m.customerName ? `Client ${m.customerId}` : undefined}>{customerLabel(m)}</span>
          {intent ? <Pill tone={INTENT_TONE[intent]} icon="eye" title="Vraie intention (mode dieu)">{INTENT_LABEL[intent]}</Pill> : null}
        </span>
      </span>
      <span className="inbox-side">
        <Pill tone={MESSAGE_STATUS_TONE[m.status]}>{MESSAGE_STATUS_LABEL[m.status]}</Pill>
        <span className={cx('small', late ? 'txt-bad' : 'muted')}>{late ? 'en retard' : `J${m.day} → J${m.deadlineDay}`}</span>
      </span>
    </button>
  );
}

function Thread({ m }: { m: PublicInboxMessage }) {
  const { lookups, openAgent, openProduct } = useApp();
  const intent = useIntent(m);
  const product = m.productId ? lookups.products.get(m.productId) : undefined;
  const thread = m.thread?.length ? m.thread : [{ from: 'customer' as const, text: m.body, day: m.day }];
  return (
    <div className="thread">
      <div className="thread-head">
        <h3>{m.subject || '(sans objet)'}</h3>
        <div className="chip-row">
          <span className="chip chip-sm"><Icon name={CHANNEL_ICON[m.channel] ?? 'mail'} size={11} /> {CHANNEL_LABEL[m.channel]}</span>
          <span className="chip chip-sm"><span className="mood-dot" style={{ background: moodColor(m.mood) }} /> {moodLabel(m.mood)}</span>
          <Pill tone={MESSAGE_STATUS_TONE[m.status]}>{MESSAGE_STATUS_LABEL[m.status]}</Pill>
          <span className="chip chip-sm"><Icon name="clock" size={11} /> échéance J{m.deadlineDay}</span>
          <span className="chip chip-sm" title={`Client ${m.customerId}`}><Icon name="users" size={11} /> {customerLabel(m)}</span>
          {product ? <button type="button" className="chip chip-sm chip-link" onClick={() => openProduct(product.id)} title="Voir le produit"><Icon name="package" size={11} /> {product.title}</button> : null}
          {m.orderId ? <span className="chip chip-sm">Commande {m.orderId}</span> : null}
          {typeof m.replyScore === 'number' ? <span className="chip chip-sm" title={`Qualité de la dernière réponse du Support${m.repliedDay ? ` (J${m.repliedDay})` : ''}`}><Icon name="review" size={11} /> Réponse {Math.round(m.replyScore)}/100</span> : null}
        </div>
        {intent ? (
          <div className="god-note"><Icon name="eye" size={13} /> Vraie intention : <Pill tone={INTENT_TONE[intent]}>{INTENT_LABEL[intent]}</Pill> <span className="muted small">(invisible pour l’équipe Support)</span></div>
        ) : null}
      </div>
      <div className="thread-msgs">
        {thread.map((t, i) => {
          const isCustomer = t.from === 'customer';
          const agent = !isCustomer ? lookups.agents.get(t.from) : undefined;
          return (
            <div key={i} className={cx('tmsg', isCustomer ? 'tmsg-customer' : 'tmsg-agent')}>
              <div className="tmsg-who">
                {isCustomer ? customerLabel(m) : (
                  <button type="button" className="link-btn" onClick={() => agent && openAgent(agent.id)} style={{ color: agent ? deptColor(lookups, agent.dept) : undefined }}>
                    {agentName(lookups, t.from)}
                  </button>
                )}
                <span className="muted small"> · J{t.day}</span>
              </div>
              <div className="tmsg-text">{t.text}</div>
            </div>
          );
        })}
      </div>
      {m.resolution ? (
        <div className={cx('resolution', m.status === 'escalated' ? 'res-bad' : 'res-good')}>
          <Icon name={m.status === 'escalated' ? 'alert' : 'check'} size={14} />
          <div><strong>Issue</strong><span>{m.resolution}</span></div>
        </div>
      ) : m.status === 'open' ? (
        <div className="resolution res-wait"><Icon name="clock" size={14} /><div><strong>En attente de réponse</strong><span>Sans réponse avant le jour {m.deadlineDay}, le client escalade (mauvais avis ou chargeback).</span></div></div>
      ) : null}
      {product ? <div className="muted small">Produit concerné vendu {fmtEur(product.price)}.</div> : null}
    </div>
  );
}
