/**
 * The five first-screen scenes (design plan D202, `HERO_INFO`): the guide alone in volume, with a tablet and a phone, open
 * on two pages, as a pack, printed on a desk. Every picture is the real cover or a real page, shown by reference to the
 * symbol the page inlines once: nothing is mocked, nothing weighs twice.
 */
import type { ArtStyle, PageHero } from '../../shared.js';
import { mix, rgba } from '../color.js';
import { h } from './common.js';
import { BP } from './css.js';
import type { Leaf, PageModel } from './model.js';
import { backdrop, backdropCss } from './skins.js';
import type { Tokens } from './theme.js';

const use = (id: string, box: string, cls = ''): string => `<svg${cls ? ` class="${cls}"` : ''} viewBox="${box}" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
const cover = (m: PageModel, cls = ''): string => use('cover-art', m.cover.box, cls);
const page = (l: Leaf | undefined, cls = ''): string => (l ? use(l.id, l.box, cls) : '');

/** A page for each place, by what it shows best: an opener on the big screen, a page of text on the phone, the sheets in a pack. */
function pick(leaves: Leaf[], ...kinds: string[]): Leaf[] {
  const out: Leaf[] = [];
  for (const k of kinds) {
    const hit = leaves.find((l) => l.kind === k && !out.includes(l));
    if (hit) out.push(hit);
  }
  for (const l of leaves) if (!out.includes(l)) out.push(l);
  return out;
}

/** The guide as a book: its cover, its spine in the cover's ink, a gloss and a soft floor shadow. */
function book(m: PageModel, cls: string): string {
  return `<div class="b3d ${cls}"><div class="b3d-in"><div class="b-face">${cover(m)}<i class="b-gloss"></i></div><div class="b-spine"><span>${h(m.brand)}</span></div></div></div>`;
}

const giantOf = (m: PageModel): string => /\b(\d{1,3})\b/.exec(m.title)?.[1] ?? h(m.head.trim().charAt(0).toUpperCase() || 'G');

/** What the scene shows, said for a screen reader. */
function labelOf(hero: PageHero, m: PageModel): string {
  const t = `« ${m.title} »`;
  switch (hero) {
    case 'devices': return `Le ${m.noun} ${t} en volume, avec une tablette et un téléphone ouverts sur ses vraies pages`;
    case 'spread': return `Le ${m.noun} ${t} ouvert sur deux de ses vraies pages`;
    case 'bundle': return `Le ${m.noun} ${t} avec ${m.kit ? 'son kit et ' : ''}ses fiches à imprimer en éventail`;
    case 'desk': return `Les pages imprimées du ${m.noun} ${t} posées sur un bureau, avec un stylo et une tasse`;
    default: return `Le ${m.noun} ${t} en volume`;
  }
}

export function heroScene(m: PageModel, t: Tokens): string {
  const hero = m.hero;
  const back = backdrop(m.style, t, m.seed, giantOf(m));
  const label = h(labelOf(hero, m));
  const open = `<figure class="scene scene-${hero}" role="img" aria-label="${label}">${back}`;
  switch (hero) {
    case 'devices': {
      const [big, small] = pick(m.leaves, 'ouverture-de-chapitre', 'page-du-guide', 'schema');
      return `${open}<div class="dv dv-tablet"><div class="dv-screen">${page(big)}<i class="dv-glare"></i></div></div>${book(m, 'in-devices')}<div class="dv dv-phone"><div class="dv-screen">${page(small ?? big, 'zoom')}<i class="dv-glare"></i></div><i class="dv-island"></i></div><i class="floor"></i></figure>`;
    }
    case 'spread': {
      const [left, right] = pick(m.leaves, 'ouverture-de-chapitre', 'page-du-guide', 'schema', 'fiche-a-imprimer');
      return `${open}<div class="sp"><div class="sp-in"><i class="sp-stack"></i><div class="sp-page l">${page(left)}<i class="sp-shade"></i></div><div class="sp-page r">${page(right ?? left)}<i class="sp-shade"></i></div><i class="sp-gutter"></i></div></div><div class="sp-cover">${cover(m)}</div><i class="floor"></i></figure>`;
    }
    case 'bundle': {
      const fan = pick(m.leaves, 'fiche-a-imprimer', 'votre-plan', 'le-plan-a-cocher', 'schema', 'le-contenu-du-kit').slice(0, 3);
      const sheets = fan.map((l, k) => `<div class="bd-sheet s${k + 1}">${page(l)}</div>`).join('');
      const kit = m.kit ? `<div class="bd-kit">${use('kit-art', m.kit.box)}</div>` : '';
      const tag = m.bonusTitle ? `<p class="bd-tag"><b>+ Offert</b> ${h(m.bonusTitle)}</p>` : '';
      return `${open}${sheets}${kit}${book(m, 'in-bundle')}${tag}<i class="floor"></i></figure>`;
    }
    case 'desk': {
      const [a, b] = pick(m.leaves, 'fiche-a-imprimer', 'page-du-guide', 'ouverture-de-chapitre', 'votre-plan', 'schema');
      return `${open}<div class="dk-surface" aria-hidden="true"></div>${b ? `<div class="dk-paper p3">${page(b)}</div>` : ''}${a ? `<div class="dk-paper p2">${page(a)}<i class="dk-clip"></i></div>` : ''}<div class="dk-paper p1">${cover(m)}</div>${PEN}${MUG}</figure>`;
    }
    default:
      return `${open}${book(m, 'alone')}<i class="floor"></i></figure>`;
  }
}

const PEN = '<svg class="dk-pen" viewBox="0 0 220 24" aria-hidden="true" focusable="false"><defs><linearGradient id="pen-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><path d="M14 5h170l26 7-26 7H14a7 7 0 0 1 0-14z" class="pen-ink"/><path d="M184 5l26 7-26 7z" fill="#d9d4cb"/><path d="M205 10.6l5 1.4-5 1.4z" fill="#2b2b2b"/><path d="M14 5h170l26 7-26 7H14a7 7 0 0 1 0-14z" fill="url(#pen-body)"/><rect x="40" y="2" width="70" height="5" rx="2.5" fill="#cfc9be"/></svg>';
const MUG = '<svg class="dk-mug" viewBox="0 0 140 120" aria-hidden="true" focusable="false"><defs><radialGradient id="mug-coffee" cx=".45" cy=".42" r=".6"><stop offset="0" stop-color="#8a5a36"/><stop offset=".75" stop-color="#5a3620"/><stop offset="1" stop-color="#3d2414"/></radialGradient></defs><rect x="96" y="48" width="38" height="22" rx="11" class="mug-ink"/><rect x="104" y="54" width="22" height="10" rx="5" fill="rgba(0,0,0,.18)"/><circle cx="60" cy="60" r="52" class="mug-ink"/><circle cx="60" cy="60" r="44" fill="url(#mug-coffee)"/><ellipse cx="48" cy="46" rx="16" ry="7" fill="#fff" opacity=".12" transform="rotate(-24 48 46)"/></svg>';

/** Where the objects of each scene stand, in % of the scene, and how the light falls. Mobile first. */
export function heroCss(hero: PageHero, style: ArtStyle, t: Tokens): string {
  const shadow = rgba(t.ink, 0.34);
  const spine = mix(t.a, t.ink, 0.35);
  const bookCss = `.b3d{position:absolute;aspect-ratio:600/848;perspective:1500px;z-index:3}
.b3d-in{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateY(22deg) rotateX(3deg)}
.b-face{position:absolute;inset:0;overflow:hidden;background:var(--paper);border-radius:2px 5px 5px 2px;transform:translateZ(8px);box-shadow:16px 22px 36px -8px ${shadow}}
.b-face svg{width:100%;height:100%}
.b-gloss{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.3) 0,rgba(0,0,0,.08) 2.4%,rgba(255,255,255,.22) 3.6%,rgba(255,255,255,0) 9%),linear-gradient(118deg,rgba(255,255,255,.2),rgba(255,255,255,0) 38%,rgba(0,0,0,0) 70%,rgba(0,0,0,.08))}
.b-spine{position:absolute;top:0;left:-8px;width:16px;height:100%;transform:rotateY(-90deg);background:linear-gradient(90deg,${mix(spine, '#000000', 0.25)},${spine} 40%,${mix(spine, '#ffffff', 0.12)} 70%,${mix(spine, '#000000', 0.2)});display:flex;align-items:center;justify-content:center;overflow:hidden}
.b-spine span{writing-mode:vertical-rl;font:700 6px/1 var(--label);letter-spacing:.2em;text-transform:uppercase;color:${rgba('#ffffff', 0.75)};white-space:nowrap}
.floor{position:absolute;z-index:1;border-radius:50%;background:radial-gradient(closest-side,${rgba(t.ink, 0.32)},transparent);pointer-events:none}`;
  const scene = `.scene{position:relative;margin:0 auto;width:100%;isolation:isolate}${backdropCss(style, t)}`;
  switch (hero) {
    case 'devices': return `${scene}${bookCss}
.scene-devices{aspect-ratio:1/.9;max-width:600px}
.scene-devices .b3d{left:5%;top:15%;width:44%}
.dv{position:absolute;z-index:2;background:linear-gradient(145deg,#3a3a40,#121216);box-shadow:0 26px 50px -22px ${shadow},inset 0 0 0 1px rgba(255,255,255,.08)}
.dv-screen{position:relative;overflow:hidden;background:#fff;height:100%}
.dv-screen svg{width:100%;height:100%}
.dv-screen svg.zoom{width:180%;height:auto;max-width:none}
.dv-glare{position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.2),rgba(255,255,255,0) 34%)}
.dv-tablet{left:37%;top:3%;width:52%;aspect-ratio:3/4;padding:3%;border-radius:18px;transform:rotate(3deg)}
.dv-tablet .dv-screen{border-radius:6px}
.dv-phone{left:70%;top:47%;width:24%;aspect-ratio:9/19;padding:2.2%;border-radius:22px;z-index:4;transform:rotate(-5deg)}
.dv-phone .dv-screen{border-radius:15px}
.dv-island{position:absolute;top:4.2%;left:50%;width:30%;height:3%;margin-left:-15%;border-radius:9px;background:#0b0b0d}
.scene-devices .floor{left:6%;right:6%;bottom:2%;height:10%}
${style === 'pop' ? '.dv{border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink)}' : ''}`;
    case 'spread': return `${scene}${bookCss}
.scene-spread{aspect-ratio:4/3.1;max-width:680px}
.sp{position:absolute;left:3%;right:3%;top:6%;z-index:2;perspective:1700px}
.sp-in{position:relative;display:flex;transform:rotateX(16deg);transform-origin:50% 100%}
.sp-page{position:relative;flex:1;aspect-ratio:595/842;background:#fff;overflow:hidden;box-shadow:0 22px 34px -18px ${shadow}}
.sp-page svg{width:100%;height:100%}
.sp-page.l{border-radius:4px 0 0 4px;transform:rotateY(4deg);transform-origin:right}
.sp-page.r{border-radius:0 4px 4px 0;transform:rotateY(-4deg);transform-origin:left}
.sp-shade{position:absolute;inset:0;pointer-events:none}
.sp-page.l .sp-shade{background:linear-gradient(90deg,rgba(255,255,255,.12),rgba(0,0,0,0) 60%,rgba(0,0,0,.14) 92%,rgba(0,0,0,.3))}
.sp-page.r .sp-shade{background:linear-gradient(270deg,rgba(255,255,255,.12),rgba(0,0,0,0) 60%,rgba(0,0,0,.12) 92%,rgba(0,0,0,.28))}
.sp-gutter{position:absolute;left:50%;top:0;bottom:0;width:8%;margin-left:-4%;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.16) 45%,rgba(0,0,0,.24) 50%,rgba(0,0,0,.16) 55%,rgba(0,0,0,0));pointer-events:none}
.sp-stack{position:absolute;left:1%;right:1%;bottom:-2.6%;height:4%;background:repeating-linear-gradient(180deg,#fff 0 1px,${mix(t.paper, t.ink, 0.12)} 1px 2px);border-radius:0 0 6px 6px;box-shadow:0 10px 16px -10px ${shadow}}
.sp-cover{position:absolute;right:1%;bottom:2%;width:23%;aspect-ratio:600/848;z-index:3;transform:rotate(7deg);box-shadow:10px 16px 26px -10px ${shadow};overflow:hidden;border-radius:2px}
.sp-cover svg{width:100%;height:100%}
.scene-spread .floor{left:4%;right:4%;bottom:6%;height:10%}
${style === 'pop' ? '.sp-page,.sp-cover{outline:3px solid var(--ink)}' : ''}`;
    case 'bundle': return `${scene}${bookCss}
.scene-bundle{aspect-ratio:1/.92;max-width:600px}
.scene-bundle .b3d{left:10%;top:13%;width:46%}
.bd-sheet{position:absolute;z-index:2;width:35%;aspect-ratio:595/842;background:#fff;overflow:hidden;border-radius:2px;box-shadow:0 18px 30px -16px ${shadow};transform-origin:20% 100%}
.bd-sheet svg{width:100%;height:100%}
.bd-sheet.s1{left:42%;top:12%;transform:rotate(4deg)}
.bd-sheet.s2{left:47%;top:10%;transform:rotate(10deg)}
.bd-sheet.s3{left:51%;top:8%;transform:rotate(16deg)}
.bd-kit{position:absolute;z-index:2;left:2%;top:20%;width:36%;aspect-ratio:600/848;overflow:hidden;transform:rotate(-9deg);box-shadow:0 18px 30px -16px ${shadow}}
.bd-kit svg{width:100%;height:100%}
.bd-tag{position:absolute;z-index:5;left:46%;bottom:6%;max-width:50%;margin:0;padding:10px 14px;background:var(--card);color:var(--ink);font:600 13px/1.3 var(--label);border-radius:var(--r);box-shadow:0 12px 26px -14px ${shadow};border:var(--bw) solid var(--bc)}
.bd-tag b{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--a-text);margin-bottom:3px}
.scene-bundle .floor{left:8%;right:10%;bottom:3%;height:10%}`;
    case 'desk': return `${scene}
.scene-desk{aspect-ratio:5/4.1;max-width:660px;overflow:hidden;border-radius:var(--r)}
.dk-surface{position:absolute;inset:0;background:var(--desk)}
.dk-paper{position:absolute;aspect-ratio:595/842;background:#fff;overflow:hidden;box-shadow:0 1px 1px rgba(0,0,0,.12),0 12px 22px -10px ${shadow}}
.dk-paper svg{width:100%;height:100%}
.dk-paper.p1{left:26%;top:9%;width:38%;z-index:4;transform:rotate(-4deg)}
.dk-paper.p2{left:57%;top:14%;width:34%;z-index:3;transform:rotate(7deg)}
.dk-paper.p3{left:3%;top:21%;width:32%;z-index:2;transform:rotate(-13deg)}
.dk-clip{position:absolute;top:-2%;left:16%;width:7%;height:16%;border:2.5px solid #9aa0a6;border-radius:12px;transform:rotate(4deg)}
.dk-pen{position:absolute;z-index:5;left:44%;top:73%;width:52%;transform:rotate(-24deg);filter:drop-shadow(0 6px 6px rgba(0,0,0,.25))}
.pen-ink{fill:${mix(t.a, t.ink, 0.15)}}
.dk-mug{position:absolute;z-index:5;left:-4%;top:62%;width:30%;filter:drop-shadow(0 10px 12px rgba(0,0,0,.28))}
.mug-ink{fill:${style === 'pop' || style === 'riso' ? t.b : '#f4f1ea'}}
@media (min-width:${BP.lg}px){.scene-desk{aspect-ratio:5/4.4}}`;
    default: return `${scene}${bookCss}
.scene-book{aspect-ratio:1/1;max-width:540px}
.scene-book .b3d{left:24%;top:7%;width:52%}
.scene-book .floor{left:16%;right:12%;bottom:4%;height:10%}`;
  }
}

/** The desk each style lays its pages on. */
export function deskOf(style: ArtStyle, t: Tokens): string {
  switch (style) {
    case 'grille': return `linear-gradient(${rgba(t.ink, 0.1)} 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,${rgba(t.ink, 0.1)} 1px,transparent 1px) 0 0/24px 24px,${mix(t.paper, '#8fb3a1', 0.35)}`;
    case 'pop': return `radial-gradient(${rgba(t.ink, 0.16)} 1.4px,transparent 1.8px) 0 0/16px 16px,${t.c}`;
    case 'aura': return `radial-gradient(70% 60% at 20% 20%,${rgba(t.halo[0], 0.35)},transparent 70%),radial-gradient(60% 60% at 90% 80%,${rgba(t.halo[1], 0.35)},transparent 70%),${mix(t.paper, t.c, 0.25)}`;
    case 'riso': return `radial-gradient(${rgba(t.b, 0.35)} 1.6px,transparent 2px) 0 0/9px 9px,${mix(t.paper, t.b, 0.12)}`;
    case 'trait': return mix(t.paper, t.a, 0.12);
    case 'typo': return mix(t.paper, t.a, 0.16);
    case 'bauhaus': return `radial-gradient(circle at 86% 18%,${t.c} 0 14%,transparent 14.2%),${mix(t.paper, t.b, 0.22)}`;
    default: return `repeating-linear-gradient(94deg,rgba(255,255,255,.05) 0 3px,rgba(0,0,0,.035) 3px 7px),linear-gradient(180deg,#c9a57c,#b88f63)`;
  }
}
