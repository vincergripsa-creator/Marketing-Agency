/**
 * The CSS every template shares: reset, type scale, the components of the section library (cards, buttons, stars,
 * questions, the buy bar). Mobile first; the template's layer and the skin's layer come after it.
 */

/** Breakpoints of every layer: a tablet reads the phone layout widened, a laptop the two-column one. */
export const BP = { md: 720, lg: 1040 } as const;

export const BASE_CSS = `*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.62 var(--text);-webkit-font-smoothing:antialiased;overflow-x:clip;overflow-wrap:break-word}
main{overflow-x:clip}
svg{display:block;max-width:100%;height:auto}
h1,h2,h3{font-family:var(--display);font-weight:700;margin:0;text-wrap:balance}
p{margin:0 0 1em;text-wrap:pretty}
b,strong{font-weight:700}
.wrap{width:100%;max-width:1160px;margin:0 auto;padding:0 20px}
.narrow{max-width:760px}
section{padding:56px 0;position:relative}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.kicker{display:flex;width:fit-content;align-items:center;gap:10px;font:700 12px/1.3 var(--label);letter-spacing:.14em;text-transform:uppercase;color:var(--a-text);margin:0 0 14px}
.h2{font-size:clamp(28px,4.6vw,46px);line-height:1.06;letter-spacing:-.02em;margin:0 0 16px}
.lead{font-size:18px;line-height:1.55;color:var(--muted);max-width:660px;margin:0 0 28px}
.muted{color:var(--muted)}
.demo-banner{background:var(--band);color:var(--paper);text-align:center;font:500 13px/1.35 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:7px 12px}
.ico{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* header */
.top{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line)}
.top-in{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px}
.brand{font:700 12px/1.2 var(--label);letter-spacing:.16em;text-transform:uppercase;color:var(--ink);text-decoration:none}
.top nav{display:none;gap:22px;font:600 14px/1 var(--label)}.top nav a{color:var(--muted);text-decoration:none}.top nav a:hover{color:var(--ink)}
/* cards: the skin says what a card is */
.card{background:var(--card-bg);border:var(--bw) solid var(--bc);border-radius:var(--r);box-shadow:var(--sh)}
/* buttons */
.buy{appearance:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px 12px;background:var(--btn);color:var(--btn-ink);border:var(--bw-btn) solid var(--bc-btn);border-radius:var(--r-btn);box-shadow:var(--sh-btn);font:700 17px/1.2 var(--label);letter-spacing:.01em;padding:16px 26px;min-height:56px;text-align:center;transition:transform .15s ease,box-shadow .15s ease}
.buy:hover{transform:translate(var(--lift-x),var(--lift-y))}
.buy:active{transform:none}
.buy:focus-visible{outline:3px solid var(--a-text);outline-offset:3px}
.buy .ico{width:20px;height:20px;stroke-width:2.2}
.buy.small{min-height:40px;padding:8px 14px;font-size:14px;box-shadow:none;text-transform:none;letter-spacing:0;white-space:nowrap}
.top .buy.small{display:none}
.buy.wide{width:100%}
/* price */
.price{font:700 clamp(30px,6vw,40px)/1 var(--display);letter-spacing:-.02em;color:var(--ink)}
.price-was{font:600 18px/1 var(--label);color:var(--muted);text-decoration:line-through;text-decoration-thickness:2px}
.price-cut{display:inline-block;font:700 13px/1 var(--label);letter-spacing:.04em;background:var(--sticker);color:var(--sticker-ink);padding:6px 8px;border-radius:var(--r-btn)}
.price-meta{font:500 13px/1.35 var(--label);color:var(--muted)}
.note{font:500 13px/1.45 var(--label);color:var(--muted);margin:12px 0 0}
.note span{white-space:nowrap}
/* stars and the rating */
.stars{position:relative;display:inline-flex;line-height:0;vertical-align:middle}
.stars .row{display:inline-flex;gap:1px}
.stars svg{width:var(--star-size,18px);height:var(--star-size,18px);flex:none}
.stars .bg svg{fill:var(--star-off)}
.stars .fg{position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap}
.stars .fg svg{fill:var(--star)}
.rating{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;font:600 14px/1.3 var(--label);color:var(--ink)}
.rating .muted{font-weight:500}
.badge-new{display:inline-flex;align-items:center;gap:6px;font:700 12px/1 var(--label);letter-spacing:.12em;text-transform:uppercase;background:var(--sticker);color:var(--sticker-ink);padding:7px 10px;border-radius:var(--r-btn)}
.gone{display:inline-block;border-left:3px solid var(--a-text);padding:8px 14px;margin:0;font:700 17px/1.35 var(--label)}
/* lists */
.ticks{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.ticks li{display:flex;gap:12px;align-items:flex-start}
.ticks .ico{margin-top:2px;color:var(--a-text)}
.ticks.no .ico{color:var(--muted)}
/* pages: a real page of the guide */
.pg{background:#fff;box-shadow:0 1px 2px var(--shadow-soft),0 14px 30px -14px var(--shadow-ink);overflow:hidden}
.pg svg{width:100%;height:auto}
.cap{font:500 13px/1.4 var(--label);color:var(--muted);margin-top:10px}
.strip{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 20px 18px;margin:0 -20px;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.strip figure{flex:0 0 62%;max-width:300px;margin:0;scroll-snap-align:start}
/* reviews */
.review{padding:20px}
.review-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;font:700 13px/1.3 var(--label)}
.review-head .who{display:flex;align-items:center;gap:8px}
.review-head .who .ico{width:16px;height:16px;color:var(--a-text);stroke-width:2.2}
.review p{margin:0}
.verified{display:flex;gap:12px;align-items:flex-start;font:500 14px/1.5 var(--label);color:var(--muted);margin:0 0 26px;max-width:720px}
.verified .ico{color:var(--a-text);margin-top:1px}
/* questions */
.faq details{border-top:1px solid var(--line)}.faq details:last-of-type{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;padding:17px 40px 17px 0;font:700 16px/1.4 var(--label);position:relative}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:6px;top:13px;font:400 24px/1 var(--label);color:var(--a-text)}
.faq details[open] summary::after{content:"–"}
.faq details p{margin:0 0 18px;color:var(--muted)}
/* guarantee */
.guarantee-card{display:flex;gap:18px;align-items:flex-start;padding:26px}
.guarantee-card .ico{width:34px;height:34px;color:var(--a-text);stroke-width:1.7}
.guarantee-card h2{font-size:24px;margin:0 0 8px}
.guarantee-card p{margin:0 0 8px}
.guarantee-card .fine{font:500 13px/1.45 var(--label);color:var(--muted);margin:0}
/* the end */
.final{background:var(--band);color:var(--on-band);text-align:center}
.final h2{font-size:clamp(28px,4.4vw,44px);line-height:1.08;margin:0 0 14px}
.final p{color:var(--on-band-muted)}
.final .price{color:var(--on-band);display:block;margin:6px 0 20px;font-size:clamp(38px,7vw,54px)}
.final .buy{background:var(--paper);color:var(--ink);border-color:var(--paper)}
.final .note{color:var(--on-band-muted)}
.final .mini-cover{width:92px;margin:0 auto 22px;box-shadow:0 18px 40px -16px rgba(0,0,0,.6)}
footer{padding:26px 0 120px;font:400 13px/1.5 var(--label);color:var(--muted);text-align:center}
footer p{margin:4px 0}
.sticky-buy{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;gap:12px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--paper);border-top:1px solid var(--line);box-shadow:0 -10px 30px -18px var(--shadow-ink);transition:transform .25s ease}
.sticky-buy .mini-cover{width:30px;flex:none;box-shadow:0 2px 6px var(--shadow-soft)}
.sticky-buy .mini{display:flex;flex-direction:column;line-height:1.2;min-width:0;flex:1}
.sticky-buy .mini span{font:500 12px/1.25 var(--label);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticky-buy strong{font:700 19px/1.1 var(--display)}
.sticky-buy .buy{min-height:46px;padding:11px 16px;font-size:15px;flex:none;box-shadow:none}
.js-sticky .sticky-buy{transform:translateY(115%)}.js-sticky .sticky-buy.on{transform:none}
@media (min-width:${BP.md}px){
  .top .buy.small{display:inline-flex}
  section{padding:80px 0}
  .wrap{padding:0 32px}
  .strip{margin:0 -32px;padding:6px 32px 18px}
  .strip figure{flex-basis:34%}
}
@media (min-width:${BP.lg}px){
  .top nav{display:flex}
  .sticky-buy{display:none}
  footer{padding-bottom:40px}
  .strip figure{flex-basis:23%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

/** Line icons, one stroke family, inlined once and used by reference. */
export const ICONS: Record<string, string> = {
  check: '<path d="M4.5 12.5l4.6 4.6L19.5 6.8"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" stroke="none"/>',
  gift: '<path d="M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4 7 4 7 6s3 1.5 5 1.5zM12 7.5C13.5 4 17 4 17 6s-3 1.5-5 1.5z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  page: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 15.5h5"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke-width="3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pen: '<path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
  refresh: '<path d="M19 8a7.5 7.5 0 1 0 1 6"/><path d="M19.5 3.5V8H15"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  quote: '<path d="M10 7H6.5A2.5 2.5 0 0 0 4 9.5V13h5v5H4M20 7h-3.5A2.5 2.5 0 0 0 14 9.5V13h5v5h-5" />',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  euro: '<path d="M17 6.5A7 7 0 1 0 17 17.5M4 10.5h9M4 13.5h9"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

export const iconDefs = (): string => Object.entries(ICONS).map(([id, d]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${d}</symbol>`).join('');

export const icon = (id: keyof typeof ICONS | string, cls = 'ico'): string => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${id}"/></svg>`;
