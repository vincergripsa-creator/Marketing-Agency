// The sales page inside the app (design plan D207): laid out at a phone's 375 px or a desktop's 1280 px, scaled to the screen.
import { useEffect, useRef, useState } from 'react';
import { cx } from '../common';
import { fmtInt } from '../format';
import { Icon } from '../icons';

export type PageDevice = 'phone' | 'desktop';
export const PAGE_WIDTH: Record<PageDevice, number> = { phone: 375, desktop: 1280 };
/** A phone's screen height for 375 px of width (an iPhone of the X family). */
const PHONE_HEIGHT = 812;
const DEVICE_LABEL: Record<PageDevice, string> = { phone: 'Téléphone', desktop: 'Ordinateur' };
/**
 * The agency's own page, from its own server: « Page de vente » opens it in a tab of this origin anyway. No forms, popups or top
 * navigation; same origin because the desktop app's browser refuses a frame with an opaque origin; modals for its « paiement simulé ».
 */
export const PAGE_SANDBOX = 'allow-scripts allow-same-origin allow-modals';

/**
 * How a page width sits in the stage: the frame keeps its real CSS width and is scaled down, never up. The phone keeps a phone's
 * height when there is room; the desktop fills the stage's height. Pure, unit-tested.
 */
export function pageFit(device: PageDevice, stage: { w: number; h: number } | null): { scale: number; width: number; height: number } {
  const width = PAGE_WIDTH[device];
  if (!stage || stage.w <= 0 || stage.h <= 0) return { scale: 1, width, height: PHONE_HEIGHT };
  const scale = Math.min(1, stage.w / width);
  const room = Math.floor(stage.h / scale);
  return { scale, width, height: device === 'phone' ? Math.min(PHONE_HEIGHT, room) : room };
}

export function SalesPageViewer({ url, title, initial = 'phone' }: { url: string; title: string; initial?: PageDevice }) {
  const [device, setDevice] = useState<PageDevice>(initial);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const read = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = pageFit(device, stage);
  return (
    <div className="spv">
      <div className="spv-bar">
        <div className="spv-devices" role="tablist" aria-label="Taille d’écran">
          {(['phone', 'desktop'] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={device === d} data-device={d} className={cx('vp-btn spv-btn', device === d && 'vp-on')} onClick={() => setDevice(d)}>
              <Icon name={d === 'phone' ? 'phone' : 'monitor'} size={13} />{DEVICE_LABEL[d]} · {fmtInt(PAGE_WIDTH[d])} px
            </button>
          ))}
        </div>
        <span className="vp-chip">Boutique simulée : aucun vrai paiement</span>
      </div>
      <div className="spv-stage" ref={stageRef}>
        <div className={cx('spv-frame', `spv-${device}`)} style={{ width: Math.round(fit.width * fit.scale), height: Math.round(fit.height * fit.scale) }}>
          <iframe
            src={url} title={`${title} — ${DEVICE_LABEL[device].toLowerCase()}`} sandbox={PAGE_SANDBOX}
            style={{ width: fit.width, height: fit.height, transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }}
          />
        </div>
      </div>
      <p className="vp-caption">
        {device === 'phone' ? 'Comme sur un téléphone : 375 px de large, là où arrive la plupart du trafic.' : `Comme sur un ordinateur : ${fmtInt(PAGE_WIDTH.desktop)} px de large${fit.scale < 1 ? `, montré à ${Math.round(fit.scale * 100)} %` : ''}.`}
      </p>
    </div>
  );
}
