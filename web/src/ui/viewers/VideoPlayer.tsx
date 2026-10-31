// Ad player: the real MP4 in a phone frame, native <video> with our own controls. No file, or a file that fails: the HTML preview.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SAFE_ZONES } from '../../../../shared/safeZones';
import type { CreativeVideo, VideoFile, VideoIndex, VideoStatus } from '../../../../shared/types';
import { fileUrl } from '../../api';
import { cx } from '../common';
import { useApp } from '../context';
import { Icon } from '../icons';
import { Lightbox, useLightboxKey } from './Lightbox';

export const NO_FILE_CAPTION = 'Aperçu animé : vidéo non générée sur cette machine';
const SIMULATED_CHIP = 'Pub simulée — jamais publiée';
const SEEK_STEP_SEC = 5;
const POLL_MS = 3000;
const STATUS_LINE: Partial<Record<VideoStatus, string>> = { queued: 'En file', rendering: 'Rendu en cours…' };

type Ratio = VideoFile['ratio'];

/** One table per ratio: 9:16 reads TikTok, the strictest of the vertical apps on the right rail. */
const SAFE_BY_RATIO: Record<Ratio, { w: number; h: number; insets: { top: number; right: number; bottom: number; left: number } }> = {
  '9:16': SAFE_ZONES.tiktok, '4:5': SAFE_ZONES.meta_feed, '1:1': SAFE_ZONES.square, '2:3': SAFE_ZONES.pinterest,
};

/** Area hidden by the platform's interface, in % of the frame. */
export function safeBands(ratio: Ratio): { top: number; right: number; bottom: number; left: number } {
  const z = SAFE_BY_RATIO[ratio];
  return { top: (z.insets.top / z.h) * 100, right: (z.insets.right / z.w) * 100, bottom: (z.insets.bottom / z.h) * 100, left: (z.insets.left / z.w) * 100 };
}

export function ratioValue(ratio: Ratio): number {
  const [w, h] = ratio.split(':').map(Number);
  return w! / h!;
}

export function fmtClock(sec: number): string {
  const s = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg className="icon" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4z" />
      {muted ? <path d="m23 9-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
    </svg>
  );
}

function Fallback({ html, title, reason }: { html: string | null | undefined; title: string; reason?: string | null }) {
  const { runId } = useApp();
  return (
    <div className="vp-fallback">
      <div className="vp-phone" style={{ '--vp-r': ratioValue('9:16') } as CSSProperties}>
        {html ? <iframe src={fileUrl(runId, html)} title={`Aperçu : ${title}`} sandbox="allow-scripts" /> : <div className="vp-blank">Aucun aperçu pour cette pub.</div>}
      </div>
      <p className="vp-caption">{NO_FILE_CAPTION}</p>
      {reason ? <p className="vp-caption vp-reason">{reason}</p> : null}
    </div>
  );
}

export function VideoPlayer({ videos, poster, captions, fallbackHtml, title, reason }: {
  videos: VideoFile[]; poster?: string | null; captions?: string | null; fallbackHtml?: string | null; title: string; reason?: string | null;
}) {
  const { runId } = useApp();
  const ref = useRef<HTMLVideoElement>(null);
  const resume = useRef<{ at: number; play: boolean } | null>(null);
  const [ratio, setRatio] = useState<Ratio | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
  const [safe, setSafe] = useState(false);
  const [rate, setRate] = useState(1);
  const file = videos.find((v) => v.ratio === ratio) ?? videos[0];
  const path = file?.path ?? null;

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, path]);
  useEffect(() => {
    const track = ref.current?.textTracks[0];
    if (track) track.mode = subtitles ? 'showing' : 'hidden'; // the captions are burned in the master: the track starts off
  }, [subtitles, path]);
  useEffect(() => {
    ref.current?.play().catch(() => undefined); // he clicked to watch. Refused by the browser: the poster and the play button stay
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const seek = (to: number) => {
    const v = ref.current;
    if (!v) return;
    const end = Number.isFinite(v.duration) ? v.duration : to;
    v.currentTime = Math.min(end, Math.max(0, to));
    setTime(v.currentTime);
  };
  const toggleMute = () => { if (ref.current) ref.current.muted = !ref.current.muted; };
  const pickRatio = (next: Ratio) => {
    const v = ref.current;
    if (v) resume.current = { at: v.currentTime, play: !v.paused };
    setRatio(next);
  };

  useLightboxKey((e) => {
    if (!path || failed) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const act = { ' ': toggle, ArrowLeft: () => seek((ref.current?.currentTime ?? 0) - SEEK_STEP_SEC), ArrowRight: () => seek((ref.current?.currentTime ?? 0) + SEEK_STEP_SEC), m: toggleMute, c: () => { if (captions) setSubtitles((s) => !s); } }[key];
    if (!act || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); // Space on a focused button would press it too, an arrow on the slider would move it twice
    act();
  });

  if (!file || failed) return <Fallback html={fallbackHtml} title={title} reason={reason} />;

  const shown = file.ratio;
  const bands = safeBands(shown);
  return (
    <div className="vp">
      <div className="vp-phone" style={{ '--vp-r': ratioValue(shown) } as CSSProperties}>
        <video
          ref={ref}
          src={fileUrl(runId, file.path)}
          poster={poster ? fileUrl(runId, poster) : undefined}
          playsInline
          preload="metadata"
          aria-label={title}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(Number.isFinite(v.duration) ? v.duration : file.durationSec);
            const back = resume.current;
            resume.current = null;
            if (!back) return;
            v.currentTime = Math.min(back.at, v.duration || back.at);
            if (back.play) void v.play().catch(() => undefined);
          }}
          onError={() => setFailed(true)}
        >
          {captions ? <track kind="captions" src={fileUrl(runId, captions)} srcLang="fr" label="Français" /> : null}
        </video>
        {safe ? (
          <div className="vp-safe" aria-hidden="true">
            <span style={{ left: 0, right: 0, top: 0, height: `${bands.top}%` }} />
            <span style={{ left: 0, right: 0, bottom: 0, height: `${bands.bottom}%` }} />
            <span style={{ left: 0, top: `${bands.top}%`, bottom: `${bands.bottom}%`, width: `${bands.left}%` }} />
            <span style={{ right: 0, top: `${bands.top}%`, bottom: `${bands.bottom}%`, width: `${bands.right}%` }} />
          </div>
        ) : null}
      </div>
      <div className="vp-bar">
        <button type="button" className="vp-btn" onClick={toggle} title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'} aria-label={playing ? 'Pause' : 'Lecture'}>
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </button>
        <input className="vp-scrub" type="range" min={0} max={duration || file.durationSec} step={0.05} value={time} onChange={(e) => seek(Number(e.target.value))} aria-label="Position dans la vidéo" />
        <span className="vp-time">{fmtClock(time)} / {fmtClock(duration || file.durationSec)}</span>
      </div>
      <div className="vp-bar">
        <button type="button" className={cx('vp-btn', muted && 'vp-on')} onClick={toggleMute} title={muted ? 'Remettre le son (M)' : 'Couper le son (M)'} aria-label={muted ? 'Remettre le son' : 'Couper le son'} aria-pressed={muted}>
          <Speaker muted={muted} />
        </button>
        {captions ? <button type="button" className={cx('vp-btn', subtitles && 'vp-on')} onClick={() => setSubtitles((s) => !s)} title="Sous-titres (C)" aria-pressed={subtitles}>CC</button> : null}
        <button type="button" className={cx('vp-btn', safe && 'vp-on')} onClick={() => setSafe((s) => !s)} title="Zone masquée par l’interface de la plateforme" aria-pressed={safe}>Zones</button>
        {[1, 1.5].map((r) => <button key={r} type="button" className={cx('vp-btn', rate === r && 'vp-on')} onClick={() => setRate(r)} aria-pressed={rate === r}>{r === 1 ? '1×' : '1,5×'}</button>)}
        {videos.length > 1 ? videos.map((v) => <button key={v.ratio} type="button" className={cx('vp-btn', v.ratio === shown && 'vp-on')} onClick={() => pickRatio(v.ratio)} aria-pressed={v.ratio === shown}>{v.ratio}</button>) : null}
        <span className="vp-chip">{SIMULATED_CHIP}</span>
      </div>
    </div>
  );
}

/** A carousel or a still has no film to wait for: its cards are the ad (video §13). Swipe, or the arrows. */
function CardDeck({ cards, title }: { cards: string[]; title: string }) {
  const { runId } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useLightboxKey((e) => {
    const deck = ref.current;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!deck || !step) return;
    e.preventDefault();
    deck.scrollBy({ left: step * deck.clientWidth, behavior: 'smooth' });
  });
  return (
    <div className="vp">
      <div ref={ref} className="vp-deck" role="group" aria-label={`Cartes de la pub : ${title}`}>
        {cards.map((c, i) => <img key={c} src={fileUrl(runId, c)} alt={`Carte ${i + 1} sur ${cards.length}`} />)}
      </div>
      <p className="vp-caption">{cards.length > 1 ? `${cards.length} cartes · glisser ou flèches` : 'Visuel fixe'} · {SIMULATED_CHIP}</p>
    </div>
  );
}

/** Opens a creative. `snapshot.videos` first: the stream only holds the latest 30, so an older one comes from the server's index (D52). */
export function VideoLightbox({ creativeId, title, fallbackHtml, onClose }: { creativeId: string; title: string; fallbackHtml?: string | null; onClose(): void }) {
  const { snapshot, runId } = useApp();
  const live = snapshot?.videos?.[creativeId];
  const [kept, setKept] = useState<CreativeVideo | null>(null);
  const [answered, setAnswered] = useState(false);
  const video = live ?? kept;
  const waiting = video?.status === 'queued' || video?.status === 'rendering';

  useEffect(() => { if (live) setKept(live); }, [live]);
  useEffect(() => {
    if (live) return undefined;
    let stale = false;
    const ask = () => fetch('/api/videos').then((r) => (r.ok ? r.json() as Promise<VideoIndex> : null)).then((index) => {
      if (stale) return;
      const found = index?.items?.[creativeId];
      if (found) setKept(found);
      setAnswered(true);
    }).catch(() => { if (!stale) setAnswered(true); });
    void ask();
    const poll = waiting ? setInterval(() => void ask(), POLL_MS) : undefined;
    return () => { stale = true; clearInterval(poll); };
  }, [live, creativeId, waiting]);

  const render = () => {
    void fetch('/api/videos/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creativeId }) })
      .then((r) => (r.ok ? r.json() as Promise<CreativeVideo> : null)).then((v) => { if (v) setKept(v); }).catch(() => undefined);
  };

  const preview = fallbackHtml ?? snapshot?.company?.creatives?.find((c) => c.id === creativeId)?.files?.preview ?? null;
  const first = video?.videos[0];
  const cards = !first && video?.status === 'ready' ? video.cards : [];
  const reason = video?.reason ?? (video ? STATUS_LINE[video.status] : null);
  return (
    <Lightbox title={title} href={first ? fileUrl(runId, first.path) : preview ? fileUrl(runId, preview) : null} onClose={onClose}>
      {cards.length ? <CardDeck cards={cards} title={title} /> : video || answered ? (
        <VideoPlayer videos={video?.videos ?? []} poster={video?.poster} captions={video?.captions} fallbackHtml={preview} title={title} reason={reason} />
      ) : <div className="lightbox-wait">Ouverture de la vidéo…</div>}
      {!first && !cards.length && (video || answered) ? <button type="button" className="btn btn-sm lightbox-btn vp-render" disabled={waiting} onClick={render}>Générer la vidéo</button> : null}
    </Lightbox>
  );
}
