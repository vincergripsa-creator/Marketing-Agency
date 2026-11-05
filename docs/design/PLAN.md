# Design build: looks that sell, pages that convert, and agents that learn them

Started 2026-11-05 on top of the V1 (main at eaeb836). This file is the law of the design build, the way `docs/v1/PLAN.md` was the law of the V1. Decisions are numbered from D200 so they never collide with the V1's D1 to D176.

## 0. What the founder asked

In their words (2026-11-05): the visuals are « très simples et toujours les mêmes »; they want « les meilleurs visuels, les plus impactants, effet wow, pour avoir plus de clients potentiels »; a deep research on what sells in PDF guides; the sales pages are « toutes identiques et pas forcément extrêmement jolies », « on peut faire beaucoup beaucoup mieux »; and, as at the start, « des agents qui deviennent meilleurs concrètement avec le temps et qui du coup vont améliorer, changer leur visuel, tester des choses ». Still a closed, virtual market.

## 1. What is true today (map of 2026-11-05)

- No agent ever picks a look. `designFor` (`server/src/deliverables/design.ts`) maps niche keywords to a palette family, a motif and a voice, and draws the layout from a seed. Per niche the motif, hero drawing and voice are fixed; only the palette (1 or 2), the layout (2 drawn of 4) and the tiles vary. One art language exists (flat inks, a 6-column tile field, one hero), plus the old gradient style of the ad storyboards.
- One sales page template (`server/src/deliverables/salesPage.ts`): the same 16 sections in the same order for every product; only inks, fonts, copy and pictures change.
- The market never sees pixels. It reads `Product.visual` (geometry scores of the cover and the interior, reference 70, real values about 85), the page copy, the ad text and cut metrics. Hidden taste exists only for hook style and ad format.
- No bandit, experiment or playbook rule exists for any visual choice. `sales_hype` experiments exist in code but nothing opens one.
- Design talent changes how many art candidates the designer looks at and how finished the inside pages are. Its gain on money is « non prouvé » (S14).
- `Scene` (`server/src/deliverables/scene.ts`) has paths, strokes, opacity, clips, groups and text, no gradient, no filter, no image. Films draw art through `toSvg` then Skia.

## 2. What the research says

The full report is `reports/Guides PDF visuels qui vendent.md`, its notes in `research_notes/Guides PDF visuels qui vendent/`. What shapes the decisions below:

- Measured data specific to low-ticket PDFs is scarce. Concept-level changes (cover typography, the first image, the page template, the ad hook) move results far more than cosmetic tweaks; most tests do not win, a confirmed win is usually +5 to +15 %, whole-template tests are where large lifts live.
- Typography-led covers that read at thumbnail size won the best measured cover test; trends for 2025-2026 are human and imperfect (collage, texture, oversized type, editorial and zine layouts) beside a minimalist counter-trend. Genre conventions per niche are practitioner knowledge, not measured.
- Pages: decision information and the button belong in the first two mobile screens; five reviews make a purchase far more likely than none, with diminishing returns, and credibility peaks below a perfect 5; padded bonuses lower perceived value; simple familiar layouts and light mode read better; mobile is most of the traffic; plain language converts better.
- Reading a test needs about 16 / r² conversions per variant for a relative lift r: whole templates are what a small shop can afford to test.
- French law binds the agents: a crossed-out price is the lowest of the previous 30 days; no false urgency or false scarcity; reviews must say how they are verified; ads say « publicité »; the 14-day withdrawal right on a download is waived only with express consent.

## 3. Decisions

- **D200. Looks become decisions of agents, in eight art directions.** `DesignSpec.style` is one of `bauhaus`, `typo`, `grille`, `pop`, `trait`, `collage`, `aura`, `riso` (`shared/design.ts` holds labels and blurbs). Absent means `bauhaus`, drawn exactly as in V1: old saves and the legacy scenario do not move. Each style draws a cover in at least two compositions, an art plate for any rectangle (chapter openers, page bands, the sales page, the films), and scores its own art so that every style's score has the same distribution as Bauhaus's: style choice moves money only through the market's taste (D201), never through the score.
- **D201. The market has a hidden taste for looks, mean-neutral.** `NicheTruth.visualTaste` gives each niche a multiplier per style, per page template and per hero. Each record averages exactly 1 over its arms, so an agency that picks at random sells as much as one that ignores looks. Priors follow genre conventions per niche family (section 5), then a per-run draw on its own stream (`STREAM.visualTaste`) moves each value and adds one surprise per niche, so the research helps but is not the answer. The research finds no measured conversion effect of style as such, measured effects of cover legibility and professionalism on clicks (+12.5 % for non-fiction, rare concepts near ×2), and the large lifts in whole-page tests and proof: so style mostly moves clicks where the cover is seen, and pages move conversion. Ranges: style 0.86 to 1.16, template 0.85 to 1.20, hero 0.95 to 1.06. Taste reaches conversion (page template × hero × style^0.35) and the click-through of ads that show the cover (style^0.8 for `static_image`, `carousel`, `text_slideshow`, style^0.4 for the films' end card). Observable conditions add small public effects from the research: `express` sells better at 14 € or less and worse from 29 €, `editorial` the other way, `proof` with fewer than 5 reviews reads ×0.82, `inside` needs real previews. Taste never reaches a snapshot, a prompt or an agent; god mode may show it.
- **D202. Six sales page templates and five heroes.** `SalesPage.template` is one of `express`, `editorial`, `inside`, `creator`, `proof`, `value`; `SalesPage.hero` one of `book`, `devices`, `spread`, `bundle`, `desk`. Absent means the V1 page, byte for byte. Templates differ in structure, not only in colour: section order, section kinds, density, typography and layout (single column, magazine, bento, wall of reviews). They share one section library, the product's inks and voice, and the legal rules of section 2. New copy fields (`benefits`, `forWho`, `notFor`, `story`, `comparison`) are written by the heuristic writer from niche knowledge, keyed on text, with no random draw.
- **D203. Agents choose looks the way they choose hooks.** At `design_cover` the art director picks the style in this order: the founder's hint, a playbook rule for the niche, a running test, then a Thompson draw on `cover_style:<niche>` whose untried arms sit on the running mean of the days it measured, the research's conventions a small lift on top (a prior of a few days, so the bandit never flees what it measured), sharpened by talent, with exploration of the least-tried style. The composition is the foundation's `pickComposition`: the best of the style's own compositions by the designer's own eye (talent explores more of them). At `write_sales_page` the shop lead picks template and hero the same way on `page_template:<niche>` and `page_hero:<niche>`, among those whose needs hold (`TEMPLATE_NEEDS`, `HERO_NEEDS`). Every draw of these choices takes `STREAM.design`, never the company stream: a control arm and the default arm stay paired on everything else.
- **D204. Agents test, learn and redo looks.** The retro rewards `cover_style`, `page_template` and `page_hero` arms with each live product's day of landing views and sales (conversion normalised as for `hype`, refunds subtracted); `cover_style` also reads the click-through of the TikTok ads whose frame is the cover, normalised as for `hook_style`. `run_experiment` may open a `page_template` A/B on a product with traffic: the two variants alternate by day, the page re-renders on each change, the test reads conversion per variant and ends on its sample or after 14 days. A clear result writes a lesson and a playbook rule (« Gabarit de page « X » pour <niche> », « Style de couverture « Y » pour <niche> »). When the niche's evidence shows a live guide's look clearly behind the best (at least 15 % on enough traffic) and the guide is at least 21 days old and below its niche's conversion, strategy schedules `refresh_design`: a new version with the same text, a new style and a new page, at most once per guide per 30 days and once per company per day. `Product.designLog` keeps every look a guide wore, with the agent's reason in French.
- **D205. Talent shows in the craft.** Design talent keeps its V1 effects and drives the new styles' finish: number of compositions examined, title refinement, colour contrast, finishing layers. Page talent drives the template choice and the copy of the new sections. Two controls exist: `control.designV1` (the V1 looks and a market indifferent to looks) and `control.noDesignLearning` (styles, templates and heroes at random, no design test, lesson or rule).
- **D206. Ads speak the new language.** Storyboard frames and statics are redrawn with the guide's style: its art plate, the real cover, real pages, bold captions, honest proof. Statics come in four looks the research supports (offer first, text only, review card, what's inside). Films draw their art plate in the guide's style (`RENDER_VERSION` + 1). Ad formats and hooks keep their bandits and tests.
- **D207. The founder sees the agency change its mind.** The Galerie, the Produits cards and the product detail show each guide's style, template and hero and its design history; the Apprentissage tab shows the design bandits per niche with French labels; tests and refreshes appear in the feed and the digest. Light snapshots stay inside their budgets.
- **D208. What the agents must never do, from French law.** No countdown or « plus que 3 » unless true; a crossed-out price only when the shown reference is the lowest price of the previous 30 days; reviews say how they are verified and are never invented; ads carry « Sponsorisé » or « Publicité »; the guarantee is stated as a commercial guarantee; the withdrawal waiver for a download is never hidden.
- **D209. The legacy scenario does not move.** `server/test/golden.json` stays `b6b0ec5a8530dea8a2cf7985c93eeac7253e6b2f` unless only a guide's printed text moved (D43). Under `visualModel: 'off'` every new code path is skipped. Every new random draw takes its own stream. Replay and reload stay identical.

## 4. Packages

Each package works in its own git worktree, branched from the commit that holds this plan and the contracts (`shared/types.ts`, `shared/design.ts`, `STREAM.design`, `STREAM.visualTaste`, task kind `refresh_design`). A package touches only its files; it may read everything. Contracts may only grow, never change shape; a package that needs a new shared field says so in its report.

| Package | Owns | Depends on |
|---|---|---|
| F, foundation | `server/src/deliverables/scene.ts` (gradients), `art/**` (shapes for all 14 motifs, style registry, Bauhaus adapter, plate API, the `typo` style), `cover.ts`, `design.ts`, `art/evaluate.ts`, `visualReport.ts`, plate calls in `pages/render.ts` and `kit.ts`, `video/compose.ts` art plate, `video/spec.ts` version | contracts |
| S1, styles A | `art/styles/grille.ts`, `pop.ts`, `trait.ts` and their tests | F |
| S2, styles B | `art/styles/collage.ts`, `aura.ts`, `riso.ts` and their tests | F |
| P, pages | `server/src/deliverables/sales/**` (templates, sections, heroes, CSS), `salesPage.ts` as the V1 path, `minds/heuristic/commerce.ts`, the sales page part of `minds/claude/engine.ts` | contracts |
| L, learning and market | `sim/market.ts`, `sim/tick.ts`, `sim/catalog/**` taste priors, `learning/**`, `runtime/playbook.ts`, `minds/playbook.ts`, `runtime/handlers/creation.ts`, `boutique.ts`, `ops.ts`, `strategy.ts`, `pipeline.ts`, `runtime/digest.ts`, `runtime/org/catalog.ts` rows | contracts |
| A, ads | `deliverables/storyboard.ts`, `deliverables/motifs.ts`, `minds/heuristic/ads.ts` scene visuals, frame calls in `runtime/handlers/channels.ts` | F |
| U, interface | `web/src/ui/**`, `server/src/api/trim.ts`, `server/src/api/views.ts` | L, P |
| R, brain | `brain/**` design, page and ad playbooks from the research | the report |

## 5. Taste priors by niche family (D201)

Convention styles get +0.10 before the run's draw, opposite styles -0.08, the rest 0. The run's draw multiplies each value by a lognormal of sigma 0.05 and gives one random style of the niche +0.07. Then each record is rescaled to an arithmetic mean of 1 and clamped to its range.

| Family | Convention styles | Opposite |
|---|---|---|
| parentalite | trait, aura, collage | grille, pop |
| animaux | pop, trait, collage | grille, aura |
| argent | grille, typo, bauhaus | aura, collage |
| sante | aura, typo, trait | riso, grille |
| etudes | grille, typo, pop | aura, collage |
| maison | collage, riso, trait | grille, aura |
| voyage | riso, collage, aura | grille, bauhaus |
| mariage | aura, typo, trait | pop, grille |
| mental | aura, trait, collage | pop, grille |
| tech | grille, pop, typo | collage, trait |
| cuisine | collage, riso, pop | grille, aura |

Templates follow the guide archetype, convention +0.12: `habitude` creator and inside; `projet` inside and value; `demarche` value and editorial; `examen` express and value; `evenement` editorial and creator; `systeme` express and inside; `paliers` creator and proof. Heroes, convention +0.04: `devices` and `spread` for argent, etudes and maison; `bundle` where a kit exists; `desk` for maison, cuisine and etudes; `book` for mariage and voyage. Same draw and rescaling.

## 6. Acceptance of the design build

| Row | Check | Pass |
|---|---|---|
| E1 | Typecheck, `npm test`, `npm run build` | exit 0 |
| E2 | Golden | unchanged |
| E3 | Replay and reload | identical, as A4 and A5 |
| E4 | Hidden taste | never in a snapshot, a prompt, an agent's text or the feed, outside god mode |
| E5 | Variety | on one 120-day run, the covers of live guides use at least 6 styles, the pages at least 5 templates, and no two guides of one niche look the same |
| E6 | Craft | every style's cover reads at 150 px (title cap height at least 7 px), contrast of title on its ground at least 4.5:1, cover SVG at most 150 kB, render under 200 ms |
| E7 | Pages | each template at 375 px and 1280 px: no horizontal scroll, first screen holds title, product picture, price, rating or « nouveau », and the button; no external request; page at most 900 kB |
| E8 | Mean-neutral market | `noDesignLearning` against `designV1`, normal, 30 seeds: median paired gap inside the noise (1 176 € at D60, 6 341 € at D180) |
| E9 | Agents learn looks | default against `noDesignLearning`, normal, 30 seeds, 182 days: median paired gain at D180 above 0 and positive on at least 19 of 30; share of live guides on their niche's best style and best template rising between D60 and D180 |
| E10 | The economy holds | K1 to K6 on the default at D60, 30 seeds, three difficulties; bankruptcies at D180 no more than `designV1` + 1 |
| E11 | Law | no false urgency, crossed-out price only under the 30-day rule, reviews state their verification, ads say « Sponsorisé » |
| E12 | Founder's view | in the browser: Galerie shows styles and history, a refresh visible on a product, the design bandits in Apprentissage, a page test in the feed |

E8 and E9 are read once, by this rule, written before any result. If E9 fails, its numbers go in `docs/BALANCE.md` and the defaults stay; one bounded try at most, under a rule written first.
