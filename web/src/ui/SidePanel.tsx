// Right slide-in panel frame (agent / department), 380px, with back, "Centrer" and close.
import type { ReactNode } from 'react';
import { Icon } from './icons';

export function SidePanel({ eyebrow, eyebrowColor, onBack, onCenter, onClose, children, label }: {
  eyebrow: ReactNode; eyebrowColor: string; onBack?: () => void; onCenter(): void; onClose(): void; children: ReactNode; label: string;
}) {
  return (
    <aside className="side-panel glass" aria-label={label}>
      <div className="side-top">
        {onBack ? (
          <button type="button" className="icon-btn icon-btn-sm" onClick={onBack} title="Retour" aria-label="Retour"><Icon name="arrowLeft" size={15} /></button>
        ) : null}
        <span className="eyebrow"><span className="eyebrow-dot" style={{ background: eyebrowColor }} />{eyebrow}</span>
        <span className="flex1" />
        <button type="button" className="btn btn-xs btn-ghost" onClick={onCenter} title="Centrer la caméra"><Icon name="target" size={13} /> Centrer</button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} title="Fermer (Échap)" aria-label="Fermer"><Icon name="x" size={15} /></button>
      </div>
      {children}
    </aside>
  );
}
