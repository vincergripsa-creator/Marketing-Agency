// Cerveau: Obsidian-style vault — force-directed graph + note reader with clickable [[wikilinks]].
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { api, basename, type BrainGraph, type BrainNote, type BrainNoteMeta } from '../../api';
import { cx, Empty, Overlay, Pill } from '../common';
import { useApp } from '../context';
import { fmtInt } from '../format';
import { forceLayout, type LayoutNode } from '../graphLayout';
import { Icon } from '../icons';
import { extractWikilinks, Markdown, splitFrontmatter } from '../markdown';

// Seed vault bundled for demo mode (the live vault is served by the API).
const SEED_FILES = import.meta.glob('../../../../brain/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const GROUP_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOR = '#a8a29e';
const GROUP_LABEL: Record<string, string> = {
  lecons: 'Leçons', journal: 'Journal', niches: 'Niches', produits: 'Produits', 'post-mortems': 'Post-mortems', playbooks: 'Playbooks',
  rh: 'RH', business: 'Business', entreprise: 'Entreprise', politiques: 'Politiques', racine: 'Accueil', manquante: 'À écrire',
};

interface Vault { notes: BrainNoteMeta[]; graph: BrainGraph; bodies: Map<string, string> | null }

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function titleOf(path: string, body: string): string {
  const h = /^#\s+(.+)$/m.exec(splitFrontmatter(body).body);
  return h?.[1]?.trim() ?? basename(path);
}

function buildSeedVault(): Vault {
  const bodies = new Map<string, string>();
  const notes: BrainNoteMeta[] = [];
  for (const [file, body] of Object.entries(SEED_FILES)) {
    const path = file.replace(/^.*?\/brain\//, '');
    bodies.set(path, body);
    const { meta } = splitFrontmatter(body);
    notes.push({ path, title: titleOf(path, body), tags: meta.tags, links: extractWikilinks(body), updatedDay: meta.day ?? 0 });
  }
  const byName = new Map<string, string>();
  for (const n of notes) { byName.set(norm(basename(n.path)), n.path); byName.set(norm(n.title), n.path); }
  const nodes: BrainGraph['nodes'] = notes.map((n) => ({ id: n.path, title: n.title, group: n.path.includes('/') ? n.path.split('/')[0]! : 'racine' }));
  const edges: BrainGraph['edges'] = [];
  const ghosts = new Set<string>();
  for (const n of notes) {
    for (const l of n.links) {
      const target = byName.get(norm(l));
      if (target) edges.push({ from: n.path, to: target });
      else {
        const gid = `?${l}`;
        if (!ghosts.has(gid)) { ghosts.add(gid); nodes.push({ id: gid, title: l, group: 'manquante' }); }
        edges.push({ from: n.path, to: gid });
      }
    }
  }
  return { notes, graph: { nodes, edges }, bodies };
}

export function BrainTab({ onClose, initialPath }: { onClose(): void; initialPath: string | null }) {
  const { demo, snapshot } = useApp();
  const [vault, setVault] = useState<Vault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(initialPath);
  const [note, setNote] = useState<BrainNote | null>(null);
  const [noteState, setNoteState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [missingTitle, setMissingTitle] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { if (initialPath) setPath(initialPath); }, [initialPath]);

  // Load list + graph (live) or the bundled seed vault (demo).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (demo) { setVault(buildSeedVault()); return; }
    Promise.all([api.brainList(), api.brainGraph()])
      .then(([notes, graph]) => { if (!cancelled) setVault({ notes, graph, bodies: null }); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Cerveau indisponible');
        setVault(buildSeedVault());
      });
    return () => { cancelled = true; };
  }, [demo, snapshot?.runId, reload]);

  const resolve = useMemo(() => {
    const byName = new Map<string, string>();
    for (const n of vault?.notes ?? []) {
      byName.set(norm(n.path), n.path);
      byName.set(norm(basename(n.path)), n.path);
      byName.set(norm(n.title), n.path);
    }
    for (const n of vault?.graph.nodes ?? []) if (!n.id.startsWith('?')) { byName.set(norm(n.id), n.id); byName.set(norm(n.title), n.id); }
    return (target: string): string | null => byName.get(norm(target)) ?? byName.get(norm(basename(target))) ?? null;
  }, [vault]);

  // Default note: home page.
  useEffect(() => {
    if (path || !vault) return;
    const home = vault.notes.find((n) => /accueil/i.test(n.path)) ?? vault.notes[0];
    if (home) setPath(home.path);
  }, [vault, path]);

  // Load the selected note.
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setMissingTitle(null);
    if (vault?.bodies) {
      const local = vault.bodies.get(path);
      if (local === undefined) { setNote(null); setNoteState('missing'); return; }
      const meta = vault.notes.find((n) => n.path === path);
      setNote({ path, title: meta?.title ?? basename(path), tags: meta?.tags ?? [], links: meta?.links ?? [], updatedDay: meta?.updatedDay ?? 0, body: local });
      setNoteState('idle');
      return;
    }
    if (demo) return; // seed vault not built yet
    setNoteState('loading');
    api.brainNote(path)
      .then((n) => { if (!cancelled) { setNote(n); setNoteState('idle'); } })
      .catch(() => { if (!cancelled) { setNote(null); setNoteState('missing'); } });
    return () => { cancelled = true; };
  }, [path, vault, demo]);

  const openTarget = (target: string) => {
    const p = resolve(target);
    if (p) { setPath(p); return; }
    setNote(null);
    setNoteState('missing');
    setMissingTitle(target);
  };

  const results = useMemo(() => {
    const nq = norm(q);
    if (!nq) return [];
    return (vault?.notes ?? []).filter((n) => norm(`${n.title} ${n.path} ${n.tags.join(' ')}`).includes(nq)).slice(0, 12);
  }, [q, vault]);

  return (
    <Overlay
      title="Cerveau"
      subtitle={<>{vault ? `${fmtInt(vault.notes.length)} notes · ${fmtInt(vault.graph.edges.length)} liens` : 'Chargement…'}{demo || error ? ' · vault de départ (mode démo)' : ' · lu avant chaque action, enrichi après'}</>}
      icon="brain"
      onClose={onClose}
      actions={!demo ? <button type="button" className="icon-btn" onClick={() => setReload((n) => n + 1)} title="Recharger le cerveau"><Icon name="refresh" size={15} /></button> : null}
    >
      {error ? <div className="banner-inline banner-warn"><Icon name="alert" size={13} /> {error} — affichage du vault de départ.</div> : null}
      <div className="brain">
        <div className="brain-graph card">
          <div className="brain-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une note, un tag…" aria-label="Chercher dans le cerveau" />
            {q ? <button type="button" className="icon-btn icon-btn-sm" onClick={() => setQ('')} aria-label="Effacer"><Icon name="x" size={13} /></button> : null}
          </div>
          {results.length ? (
            <div className="brain-results glass">
              {results.map((n) => (
                <button key={n.path} type="button" className="search-item" onClick={() => { setPath(n.path); setQ(''); }}>
                  <Icon name="file" size={13} />
                  <span className="search-main"><span className="search-name">{n.title}</span><span className="search-role">{n.path}</span></span>
                </button>
              ))}
            </div>
          ) : null}
          {vault ? <GraphView graph={vault.graph} selected={path} query={q} onPick={(id, title) => (id.startsWith('?') ? openTarget(title) : setPath(resolve(id) ?? resolve(title) ?? id))} /> : <div className="chart-empty"><span className="spinner" /> Lecture du cerveau…</div>}
        </div>
        <div className="brain-note card">
          {noteState === 'loading' ? <div className="muted small"><span className="spinner" /> Ouverture de la note…</div> : null}
          {noteState === 'missing' ? (
            <Empty icon="brain">{missingTitle ? <>La note « {missingTitle} » n’est pas encore écrite. Les agents la créeront quand ils auront appris quelque chose à y mettre.</> : 'Note introuvable.'}</Empty>
          ) : null}
          {note && noteState === 'idle' ? (
            <>
              <div className="note-head">
                <span className="muted small mono">{note.path}</span>
                <div className="chip-row">
                  {note.tags.map((t) => <Pill key={t} tone="violet">#{t}</Pill>)}
                  {note.updatedDay ? <span className="chip chip-sm">jour {note.updatedDay}</span> : null}
                </div>
              </div>
              <Markdown text={note.body} onWikiLink={openTarget} isKnown={(t) => resolve(t) !== null} />
              <Backlinks graph={vault?.graph} path={note.path} onPick={(id) => setPath(id)} />
            </>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
}

function Backlinks({ graph, path, onPick }: { graph: BrainGraph | undefined; path: string; onPick(id: string): void }) {
  if (!graph) return null;
  const titles = new Map(graph.nodes.map((n) => [n.id, n.title] as const));
  const back = [...new Set(graph.edges.filter((e) => e.to === path).map((e) => e.from))];
  if (back.length === 0) return null;
  return (
    <div className="backlinks">
      <div className="section-title"><span>Mentionnée dans · {back.length}</span></div>
      <div className="chip-row">
        {back.map((id) => <button key={id} type="button" className="wikilink" onClick={() => onPick(id)}>{titles.get(id) ?? basename(id)}</button>)}
      </div>
    </div>
  );
}

const VW = 1000;
const VH = 680;

function GraphView({ graph, selected, query, onPick }: { graph: BrainGraph; selected: string | null; query: string; onPick(id: string, title: string): void }) {
  const layout = useMemo(() => forceLayout(graph.nodes, graph.edges, { w: VW, h: VH }), [graph]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const n of layout.nodes) count.set(n.group, (count.get(n.group) ?? 0) + 1);
    const ordered = [...count].sort((a, b) => b[1] - a[1]);
    const colors = new Map<string, string>();
    ordered.forEach(([g], i) => colors.set(g, g === 'manquante' ? OTHER_COLOR : GROUP_COLORS[i] ?? OTHER_COLOR));
    return { ordered, colors };
  }, [layout]);

  const nq = norm(query);
  const match = (n: LayoutNode) => !nq || norm(`${n.title} ${n.id}`).includes(nq);
  const focus = hover ?? selected;
  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!focus) return s;
    for (const e of layout.edges) { if (e.from === focus) s.add(e.to); if (e.to === focus) s.add(e.from); }
    return s;
  }, [layout, focus]);
  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n] as const)), [layout]);

  if (layout.nodes.length === 0) return <div className="chart-empty">Le cerveau est vide pour l’instant.</div>;

  const toView = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: 0, y: 0 };
    return { x: ((clientX - r.left) / r.width) * VW, y: ((clientY - r.top) / r.height) * VH };
  };
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const p = toView(e.clientX, e.clientY);
    setView((v) => {
      const k = Math.max(0.5, Math.min(4, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      return { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
    });
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = svgRef.current?.getBoundingClientRect();
    const scale = r && r.width ? VW / r.width : 1;
    const dx = (e.clientX - d.x) * scale;
    const dy = (e.clientY - d.y) * scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onUp = () => { setTimeout(() => { drag.current = null; }, 0); };

  return (
    <div className="graph-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} className="graph-svg" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} role="img" aria-label="Graphe des notes du cerveau">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const hot = focus && (e.from === focus || e.to === focus);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={cx('g-edge', hot && 'g-edge-hot')} />;
          })}
          {layout.nodes.map((n) => {
            const r = 5 + Math.sqrt(n.degree) * 2.4;
            const isSel = n.id === selected;
            const dim = (nq && !match(n)) || (focus && n.id !== focus && !neighbors.has(n.id));
            const showLabel = isSel || n.id === hover || n.degree >= 4 || neighbors.has(n.id) || (nq && match(n)) || layout.nodes.length < 25;
            return (
              <g key={n.id} className={cx('g-node', dim && 'g-dim', isSel && 'g-sel')} transform={`translate(${n.x} ${n.y})`}
                onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={() => { if (!drag.current?.moved) onPick(n.id, n.title); }}>
                <circle r={r + 6} fill="transparent" />
                <circle r={r} fill={groups.colors.get(n.group) ?? OTHER_COLOR} stroke="#fff" strokeWidth={2} strokeDasharray={n.id.startsWith('?') ? '3 2' : undefined} opacity={n.id.startsWith('?') ? 0.7 : 1} />
                {showLabel ? <text y={-r - 6} textAnchor="middle" className="g-label">{n.title.length > 34 ? `${n.title.slice(0, 32)}…` : n.title}</text> : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graph-legend">
        {groups.ordered.map(([g, c]) => (
          <span key={g} className="legend-item"><span className="legend-dot" style={{ background: groups.colors.get(g) }} />{GROUP_LABEL[g] ?? g} <span className="muted">{c}</span></span>
        ))}
      </div>
      <div className="graph-tools">
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.25) }))} aria-label="Zoomer"><Icon name="plus" size={13} /></button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setView({ k: 1, x: 0, y: 0 })} aria-label="Recentrer"><Icon name="target" size={13} /></button>
      </div>
    </div>
  );
}
