// Full-screen layer of the viewers: focus trap, every key kept from the app behind it, always a way out to a plain tab.
// The PDF flip stays behind lazy(): pdf.js must not enter the main chunk.
import { createContext, lazy, Suspense, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NEW_TAB } from '../common';
import { Icon } from '../icons';
import './viewers.css';

export type LightboxKey = (e: KeyboardEvent) => void;

const KeySlot = createContext<RefObject<LightboxKey | null> | null>(null);

/** The layer stops every key at the window, so what it shows gets them from here: React's onKeyDown never fires. */
export function useLightboxKey(handler: LightboxKey): void {
  const slot = useContext(KeySlot);
  useEffect(() => {
    if (!slot) return;
    slot.current = handler;
    return () => { if (slot.current === handler) slot.current = null; };
  });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), iframe, video[controls], [tabindex]:not([tabindex="-1"])';

function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (list.length === 0) { e.preventDefault(); root.focus({ preventScroll: true }); return; }
  const active = document.activeElement;
  const first = list[0]!;
  const last = list[list.length - 1]!;
  if (e.shiftKey && (active === first || active === root || !root.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
}

/** Window + capture, like TopBar, or digits would switch tabs behind the layer. Only Tab goes on, inside the trap. */
export function routeKey(e: KeyboardEvent, root: HTMLElement | null, close: () => void, inner: LightboxKey | null): void {
  if (e.key === 'Tab') { trapTab(e, root); return; }
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  inner?.(e);
}

export function Lightbox({ title, href, onClose, children }: { title: string; href?: string | null; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = useRef<LightboxKey | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => routeKey(e, ref.current, () => close.current(), keys.current);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const layer = (
    <div className="lightbox" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header className="lightbox-head">
        <strong className="lightbox-title">{title}</strong>
        {href ? <a className="btn btn-sm lightbox-btn" href={href} {...NEW_TAB}><Icon name="external" size={13} />Ouvrir dans un onglet</a> : null}
        <button type="button" className="icon-btn lightbox-close" onClick={onClose} title="Fermer (Échap)" aria-label="Fermer"><Icon name="x" /></button>
      </header>
      <div className="lightbox-body">
        <KeySlot.Provider value={keys}>{children}</KeySlot.Provider>
      </div>
    </div>
  );
  // .overlay is a stacking context under the top bar: the layer has to leave it. No document on the server render of the tests.
  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
}

/** What pdf.js cannot open, the browser's own viewer still can. */
export function PdfFrame({ url, title }: { url: string; title: string }) {
  return <iframe className="pf-frame" src={url} title={title} />;
}

const PdfFlip = lazy(() => import('./PdfFlip').then((m) => ({ default: m.PdfFlip })).catch(() => ({ default: PdfFrame })));

export function PdfLightbox({ url, title, onClose }: { url: string; title: string; onClose(): void }) {
  return (
    <Lightbox title={title} href={url} onClose={onClose}>
      <Suspense fallback={<div className="lightbox-wait">Ouverture du guide…</div>}>
        <PdfFlip url={url} title={title} />
      </Suspense>
    </Lightbox>
  );
}
