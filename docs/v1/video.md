# Pillar: real ad videos

Status: design backed by a working prototype. One real creative of a real run (`cre_` "8 étapes, 8 mois de plan…", balcony guide `prd_4387`) was rendered to a real MP4 from the real PDF, with the real offline French voice.

Prototype folder: `scratchpad/v1/video-proto/`
- `out/master.mp4` 1080×1920, 26,1 s, voice + music + SFX, CRF 21, 13,8 MB
- `out/test-crf27.mp4` same at CRF 27, 4,7 MB
- `out/cut-45-music-only.mp4` 1080×1350, 26,1 s, no voice (the fallback path)
- `sheet3.png`, `sheet4.png`, `sheet5.png` frames decoded from those files
- `proto.mjs`, `audio.mjs`, `qa.mjs`, `tts.ps1` the code to port

## 0. What changed my mind while prototyping

1. **`AdScene.durationSec` is fiction.** The 23 s creative I picked holds 729 characters of voice-over: 38 s when actually spoken. Scene 3 alone takes 11 s for a declared 5 s. Any honest video needs a cut, and the cut is where editing talent lives. Today the score reads the fiction.
2. **Skia beats resvg by 3,4×.** resvg: 92 ms per frame for one page, gradients and one line of text. `@napi-rs/canvas`: 27 ms for the whole real frame, draw and copy. The full master renders at 0,93× real time on a machine busy with another workflow.
3. **Real PDF pages are available in Node**, 60 to 220 ms a page, with text positions. So the marker can sweep a real line of the real guide. This is the strongest shot of the video and no storyboard could do it.
4. **Word timings exist offline.** System.Speech fires `SpeakProgress`, but with two traps (§5.2). Solved, measured against the audio.
5. **Per-frame grain costs 4,6× the bytes**: 63,6 MB against 13,8 MB. Static grain looks the same. CRF 27 then gives 4,7 MB with text as sharp as CRF 21 (`frames/crfcmp.png`, SSIM 0,93 on the whole clip).
6. **`ffmpeg-static` ships no ffprobe.** So QA uses `ffmpeg` only, one code path for every machine. Output format checked on 8.1 and 6.1.1.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Each creative gets a **`VideoCut`**, a pure plan computed in `produce_ad`, in every run, benchmark included. It lives in the world. Rendering only reads it | Editing reaches the market without one pixel drawn. World stays identical with or without files |
| D2 | **Files never enter the world.** No `files.videos`, no `Deliverable`. Sidecar `runs/<id>/video/manifest.json`, merged at the API layer | Hard rule. The ui pillar's request is served through `CompanySnapshot.videos` |
| D3 | Craft feeds `quality.overall` through existing dimensions: `structure` (pace 20 pts), `design` (look 100), `actionability` (true duration). No new CTR term for craft, no change to weights or `balance.ts` | The talent pillar requires it: a score outside `overall` is invisible to the league |
| D4 | Compositor: **Skia** (`@napi-rs/canvas`), raw RGBA piped to ffmpeg. Not SVG per frame | §0.2 |
| D5 | One timeline, **re-laid out per ratio, never cropped**. The audio is reused across ratios | `sheet5.png`: 4:5 and 1:1 work from the same code |
| D6 | 30 fps, H.264 High yuv420p bt709, AAC 160 kbps 44,1 kHz, `-preset veryfast -crf 26`, faststart | Accepted everywhere, ≈ 5 MB a master |
| D7 | Nothing of the platform is burned in the file: no fake rail, no likes, no « Sponsorisé » | That belongs to the app. The phone frame stays in the UI |
| D8 | `ugc_avatar` becomes an **illustrated narrator** with lip-sync. Never photoreal, never a claimed customer. UI label « Narrateur animé » | No real avatar without a paid service, and a fake person is exactly what the ad rules ban. See §8 |
| D9 | Editor skill changes actual decisions (§3.3), so a bad editor makes a worse file, not a worse label | Rule: nothing cosmetic |
| D10 | Tempo is the learnable variable: hidden per niche, chosen by a bandit, visible in the file | Agents improve on video with paired proof, and it is a real editorial choice |
| D11 | Renderer runs in a **child process**, one job at a time, below-normal priority | The native draw calls are synchronous and would stall the tick loop |
| D12 | The speech model is a measured formula (§3.2). Benchmarks use it, real TTS never touches the score | ±8 % on six measured lines. Rendering must not change the sim |
| D13 | Five fonts committed, 1,17 MB, OFL | §6 |
| D14 | MP4 metadata `comment="Pub simulée — Pixel Agency"`, UI chip « Pub simulée — jamais publiée » | Nothing is published. A burned watermark would spoil the deliverable |

## 2. Types

`shared/types.ts`:

```ts
export type VideoTempo = 'calm' | 'standard' | 'fast';

export type BeatKind =
  | 'title_card'     // logo intro before the hook: the weak editor's mistake, drawn for real
  | 'hook'           // kinetic slam, word by word on the voice
  | 'before_after'   // hook variant, wipe Avant / Après (hookStyle 'before_after')
  | 'pain_bubble'    // real customer phrases in comment bubbles
  | 'step_list'      // real steps of the guide, ticked one by one
  | 'page_proof'     // real PDF page, punch-ins, marker on a real line
  | 'fact_card'      // plain text plate: what a weak editor uses instead of proof
  | 'bonus_stack'    // fan of real pages, cover, sticker
  | 'narrator'       // illustrated narrator (ugc_avatar)
  | 'slide'          // text_slideshow and carousel card
  | 'end_card';      // cover, pulsing CTA, arrow

export interface VideoBeat {
  kind: BeatKind;
  scene: number;              // index in AdCreative.scenes
  spoken: string;             // '' on a slide. Always a cut of scenes[scene].voiceover, never new words
  screen: string;             // text this beat owns on screen
  estSec: number;             // speech model + gap, or reading time on a slide
  shots: number;              // camera cuts inside this beat, 1 at least
  proof?: { chapter: number; needle: string } | null; // chapter index, and a sentence that exists in that chapter
  items?: string[];           // step_list: real steps. pain_bubble: extra real VoC phrases
}

export interface CutMetrics {
  estSec: number;
  hookWordSec: number;        // first word of the hook on screen
  productSec: number | null;  // first frame showing the real guide
  avgShotSec: number;
  kinds: number;              // distinct beat kinds
  captionWords: number;       // max words in one caption group
  endHoldSec: number;
}

export interface VideoCut {
  v: 1;
  tempo: VideoTempo;
  beats: VideoBeat[];
  metrics: CutMetrics;
  sfx: boolean;
  craft: number;              // 0..100, display only: scoreCreative recomputes pace and look from metrics
}

// AdCreative gains
//   cut?: VideoCut | null;   absent on old saves: the old formulas apply

// NicheTruth gains (hidden, never in a snapshot)
//   videoTempo?: VideoTempo;

// ScenarioConfig gains
//   videoModel?: 'on' | 'off';   defaultScenario 'on'. undefined on old saves = 'off'
//   videoControl?: { skill?: number; tempo?: VideoTempo };   paired controls only

export interface VideoFile { ratio: Exclude<AdRatio, 'text'>; path: string; durationSec: number; bytes: number }
export type VideoStatus = 'queued' | 'rendering' | 'ready' | 'failed' | 'evicted' | 'unavailable';

export interface CreativeVideo {
  status: VideoStatus;
  reason?: string | null;     // French, for the founder
  videos: VideoFile[];
  poster: string | null;
  captions: string | null;    // WebVTT
  cards: string[];            // carousel and static_image PNGs
  voice: string | null;       // voice id, null = captions and music only
  qa: QaSummary | null;
}
export interface QaSummary { ok: boolean; failed: string[]; lufs: number | null; cuts: number; avgShotSec: number; mb: number }
export interface VideoIndex { level: VideoLevel; reason: string | null; items: Record<string, CreativeVideo> }
export type VideoLevel = 'full' | 'no_voice' | 'no_pages' | 'storyboard_only';

// CompanySnapshot gains:   videos?: Record<string, CreativeVideo>;   filled by the API layer, not from the world
// StreamEvent gains:       | { type: 'video'; creativeId: string; video: CreativeVideo }
```

`AdRatio`, `masterId`, `ratio` come from the channels pillar. A cut creative copies the master's `cut`, only the stage differs.

`shared/safeZones.ts`, read by the renderer and by the UI's safe-zone overlay:

```ts
export interface Insets { top: number; right: number; bottom: number; left: number }
export const SAFE_ZONES = {
  tiktok:    { w: 1080, h: 1920, insets: { top: 240, right: 150, bottom: 660, left: 60 } },
  reels:     { w: 1080, h: 1920, insets: { top: 269, right: 65,  bottom: 672, left: 65 } },
  shorts:    { w: 1080, h: 1920, insets: { top: 288, right: 192, bottom: 672, left: 60 } },
  meta_feed: { w: 1080, h: 1350, insets: { top: 54,  right: 54,  bottom: 54,  left: 54 } },
  square:    { w: 1080, h: 1080, insets: { top: 54,  right: 54,  bottom: 54,  left: 54 } },
  pinterest: { w: 1080, h: 1620, insets: { top: 80,  right: 54,  bottom: 240, left: 54 } },
} as const;
```

**The 9:16 master obeys all three vertical platforms at once**, in two zones:

- zone A, y 288 to 840: x 65 to 1015
- zone B, y 840 to 1248: x 65 to 880 (the right rail starts around y 840)

Pictures and mock-ups may bleed outside. Only text and the CTA must stay in. Only Meta's percentages (14 %, 35 %, 6 %) are consistently reported, the other figures come from third-party tools and disagree, so I took the conservative end, and these constants must be checked in-app before any real publication. The prototype used a looser right inset (140).

## 3. The cut (pure, in the world)

Files: `server/src/deliverables/videoCut.ts` (`planCut`, `tightenSpoken`, `roleOf`), `server/src/deliverables/speech.ts` (`estimateSpeechSec`), `server/src/sim/videoCraft.ts` (`scoreCut`).

### 3.1 Where it runs

`growth.ts produce_ad.run`, right after `Object.assign(creative, …)` and before `scoreCreative`:

```ts
if (ctx.world.scenario.videoModel === 'on') {
  const control = ctx.world.scenario.videoControl;
  const skill = control?.skill ?? editSkillOf(ctx.world, agent) ?? EDIT_BASELINE;   // 0.62
  const tempo = control?.tempo ?? pickTempo(ctx, product.nicheId, variant);
  const key = hashString(`${creative.hook}|${creative.format}|${task.attempts}|${mind.draw ?? 0}`);
  creative.cut = planCut({ creative, product, voc, skill, tempo, rng: streamRng(seed, STREAM.videoCut, key) });
  creative.cut.craft = sim.scoreCut(creative.cut).craft;
}
```

- Key on hook text, never on the generated id: paired runs keep the same cut for the same text.
- `planCut` draws exactly one number. `pickTempo` draws one of `TEMPOS` uniformly on `streamRng(seed, STREAM.videoTempo, day, tick, variant)` (D149): films keep their variety, no other stream moves.
- The talent pillar's `bestDraft` scores a scratch creative: it must run the same block, or drafts are ranked without their cut.
- `skill` is never stored. `VideoCut` holds decisions only, so the talent secrecy test stays green.

### 3.2 Speech model

Measured on Hortense at `Rate=1`, six lines:

```ts
export function estimateSpeechSec(text: string): number {
  const t = text.trim();
  const pauses = (t.match(/[,:;—–]/g) ?? []).length + (t.match(/[.!?]\s/g) ?? []).length * 1.6;
  return t.length / 20.5 + 0.22 * pauses + 0.1;
}
```

| Line | Measured | Model |
|---|---:|---:|
| 68 chars, 3 commas | 4,07 s | 4,08 s |
| 90 chars, 2 commas | 4,81 s | 4,93 s |
| 98 chars, colon | 4,71 s | 5,10 s |
| 63 chars, colon | 3,26 s | 3,39 s |
| 88 chars, 3 marks | 4,91 s | 5,05 s |
| 41 chars | 1,98 s | 2,10 s |

Worst error +8 %. The model is slightly long, the safe side for a budget.

### 3.3 Editor decisions

`x = clamp(skill + rng.normal(0, 0.08), 0, 1)`: one draw per creative, a good editor has a bad day. Each row changes pixels.

| Decision | Rule | Effect in the file |
|---|---|---|
| Title card | x < 0,30: 0,8 s logo card first. x < 0,50: 0,25 s. Else none | `hookWordSec` |
| Tightening | x < 0,35: none. x < 0,60: level 1. Else level 2 | The voice, the duration |
| Shot target | `lerp(3.4, 1.4, x) × tempoFactor` (calm 1,2, standard 1, fast 0,8) | `shots = max(1, ceil(estSec / target))` |
| Proof | With a needle found in `product.content`: x < 0,10: `fact_card`. x < 0,30: one page, held on one shot. x < 0,50: one page. Else every page it can | Real page or a text plate |
| Product early | x ≥ 0,75: the guide enters during the hook at 0,45 s. Else from its first page, the bonus or the end. The late rise of a kinetic hook is the film's, it does not enter here (D130) | `productSec` |
| Pain | x ≥ 0,40: `pain_bubble`. Else `fact_card` | `kinds` |
| Captions | x < 0,30: 6 words a line. x < 0,60: 3 words. Else 2-3 with the spoken word on a pill | `captionWords` |
| End hold | After the last word. x < 0,30: 0,8 s. x < 0,50: 1,2 s. x < 0,75: 1,5 s. Else 1,8 s (D129) | `endHoldSec` |
| SFX | x ≥ 0,50 | `sfx` |

**Tightening** only deletes at sentence or clause boundaries, never mid-clause, so a negation cannot be lost:

- Level 1: first sentence of each scene.
- Level 2: also cut at the first ` — ` when the head has at least 20 characters, and drop the quoted title from the last scene (« Le guide complet, « … », est en lien dans ma bio. » becomes « Le guide complet est en lien dans ma bio. »).

On the prototype creative: level 0 gives 38 s, level 1 about 33 s, level 2 about 27 s. I tightened the prototype's script by hand with these rules, plus one cut the rule would not make (« sur une journée »): 26,1 s.

**Needle** (D66 changed the sentence below): of the lines the pages print that share at least 60 % of their key tokens with what the voice says once the editor has cut it, the line it says first; 18 to 70 characters, a longer line marked up to its first clause. It was: the longest sentence of the chapters that shares at least 60 % of its key tokens with the scene's voice-over, 18 to 70 characters. In this creative: « Le terreau d’un pot s’épuise vite » is found in chapter 1, and page 5 of the real PDF shows it.

**Scene roles** in `roleOf(scene, index, count)`: first = hook, last = end, middle by text: `«` = pain, `^\d\.` or « étape » = step, « bonus » = bonus, else proof. It reads text only, so a Claude-written ad works too.

### 3.4 Format mapping

| AdFormat | Beats | Audio | Output |
|---|---|---|---|
| `faceless_voiceover` | hook, pain_bubble, page_proof or step_list, page_proof, bonus_stack, end_card | voice, ducked music, SFX | MP4 |
| `text_slideshow` | slide × n, end_card. A slide lasts its reading time, `max(1.8, words / 2.6 + 0.5)` s. Its words come up at 6 a second, so the whole text stands for most of that time: `readingSec` and `estSec` do not move, an opening slide takes a cap of 240 px | music at full level, hard cuts on the bar | MP4 |
| `ugc_avatar` | hook, narrator (pain), narrator with a page inset (step), page_proof, bonus_stack, end_card | voice, music | MP4 |
| `carousel` | slide stills at their end state | none | PNG cards in the creative's ratio |
| `static_image` (channels) | one still, hook over the cover, stopped above its button | none | PNG |
| `search_text` (channels) | no media | | |

`before_after` replaces `hook` when `hookStyle === 'before_after'` and the text parses as « Avant … Après … ». `step_list` replaces the step's `page_proof` when the product has at least 3 steps and the hook is a listicle.

`VISUALS` in `minds/heuristic/ads.ts` must change: « B-roll du quotidien », « Mains qui écrivent » promise footage that does not exist. New strings describe the procedural scene. They stay as text for the storyboard and the Claude prompt.

### 3.5 Scoring

`sim/videoCraft.ts`, pure, no constant in `balance.ts`:

```ts
export function scoreCut(cut: VideoCut): { pace: number; look: number; craft: number; notes: string[] }
```

```
hookP   hookWordSec ≤ .1: 1 | ≤ .3: .85 | ≤ .6: .5 | else .15
shotP   avgShotSec in [1.2, 1.8]: 1 | 2.2: .8 | 3.6: .2 | 0.8: .6      (linear between)
durP    estSec in [15, 28]: 1 | 12: .8 | 34: .5 | 45: .1               (linear between)
pace  = .4 hookP + .35 shotP + .25 durP

proofP  (productSec ≤ 20 % of estSec ? .5 : 0) + (a page_proof beat ? .5 : 0)
varP    kinds ≥ 5: 1 | 4: .8 | 3: .5 | else .2      (title_card does not count as a kind)
capP    captionWords ≤ 3: 1 | 4: .7 | else .3
endP    endHoldSec ≥ 1.8: 1 | 1.2: .7 | .8: .3                         (linear between)
textP   share of beats whose `screen` fits its stage box at min size (textWidth from deliverables/text.ts)
look  = .3 proofP + .25 varP + .2 capP + .15 endP + .1 textP

craft = round(50 pace + 50 look)
```

Slides: `hookP` from the first slide, `capP` from words per slide ≤ 12. Carousel: `durP` from card count (4 to 8 = 1), `shotP = 1`.

`scoreCreative` in `sim/quality.ts`, when `c.cut` exists:

- `structure`: the 20 points for scene count become `20 × pace`.
- `actionability`: the 40 points for duration read `cut.metrics.estSec`, same bands.
- `design`: `100 × look`. The `fmtOk` block stays a block.
- `issues.push` in French, for the rework notes: « Le texte arrive à 0,8 s : le hook doit être là dès la première image. », « Le vrai guide n’apparaît qu’à la fin. », « Plans trop longs (2,9 s en moyenne). »

The market's `adQ` already calls `scoreCreative`, so CTR follows through `ADS.qualityExp`. Nothing else changes in `tick.ts` for craft.

**Predicted effect**, computed from these formulas, not benchmarked. Base overall 90:

| Editor | craft | overall delta | CTR factor |
|---|---:|---:|---:|
| x = 0,2 | ≈ 36 | −11,3 | ×0,84 |
| x = 0,52 (mean hire) | ≈ 81 | −4,9 | ×0,93 |
| x = 0,62 (baseline) | ≈ 88 | −2,1 | ×0,97 |
| x = 0,7 | ≈ 90 | −1,9 | ×0,97 |
| x = 0,9 | 100 | 0 | ×1,00 |

So best against weak is +19 % CTR, best against a mean hire +7 %. The curve is flat from about x = 0,85: past that, more talent changes nothing in the file. The baseline lowers CTR by about 3 %: left to the single final calibration, no constant moved before it.

### 3.6 Tempo, cosmetic since D149

Step 4 read learned CTR over days 31-60 above fixed on 14 of 28 seeds for 18 asked, so by its rule tempo left the market and the bandit: no `tempoFit`, no `VIDEO_MARKET`, no `NicheTruth.videoTempo`, no `video_tempo` arm, and an old save drops those arms on load. It stays in the file: shot length, BPM (88, 112, 128), caption speed. What follows is what was tried.

```ts
// sim/videoCraft.ts: market only, own constants
export const VIDEO_MARKET = { tempoMatch: 1.08, tempoOpposite: 0.92 };
export function tempoFit(n: NicheTruth, c: AdCreative): number
// 1 without a cut or a truth. Match 1.08, opposite (calm vs fast) 0.92, neighbour 1.
```

- `createMarketState`: after the niches, `n.videoTempo = TEMPOS[streamRng(seed, VIDEO_TASTE_STREAM, i).int(0, 2)]` when `videoModel === 'on'`. Own stream, the market rng draws nothing more.
- `tick.ts` line 243: `* tempoFit(n, c)`. It draws nothing.
- `retro.ts` next to `ad_format`: `if (creative.cut) rewardArm(world, 'video_tempo:' + nicheId, creative.cut.tempo, reward, weight)`, and `rewards += 1`.
- The tempo shows in the file: shot length, BPM (88, 112, 128), caption speed.

Predicted from formulas: learned tempo moves the CTR average from about 1,00 to about 1,06. To be proved by paired control, §10.

`editSkillOf` is the talent pillar's. A strike or a reject stays as it is.

## 4. Rendering

`server/src/video/`:

| File | Exports |
|---|---|
| `caps.ts` | `findFfmpeg()`, `detectCaps(): Promise<VideoCaps>` |
| `spec.ts` | `buildRenderSpec(world, creativeId, ratio): RenderSpec`, `renderKey(spec)` |
| `stage.ts` | `stageFor(ratio): Stage`, `insideSafe(stage, box)` |
| `fonts.ts` | `registerFonts()`, `displayFontFor(design)` |
| `pdfPages.ts` | `openGuide(path)`, `pageImage(n, scale)`, `findNeedle(needle): { page; boxes } \| null` |
| `timeline.ts` | `buildTimeline(cut, speech, bpm): Timeline` |
| `compose.ts` | `createCompositor(timeline, stage, assets)`, `drawFrame(i)`, `drawText(...)` (ledger) |
| `scenes/*.ts` | one file per `BeatKind` |
| `speech.ts` | `synthesize(lines, voice): SpokenLine[]`, `alignWords(text, events)`, `estimatedWords(text)` |
| `tts.ps1` | the Windows bridge, spawned with `-ExecutionPolicy Bypass` |
| `music.ts`, `sfx.ts`, `mix.ts` | `makeMusic`, the SFX, `mixDown` |
| `encode.ts` | `encodeMp4(frames, wav, out, opts)` |
| `qa.ts` | `checkFile(path, expect): QaReport` |
| `director.ts` | `VideoDirector`, `selectWorthy(world)` |
| `worker.ts` | child process entry, one `RenderSpec` in, one result out |
| `index.ts` | public names, loaded with dynamic `import()` only |

`server/src/deliverables/storyboard.ts` gains `renderAdCut({ creative, product, design, brand, ratio }): { frames: string[] }`, plain SVG at 432×540, 540×540, 400×600, as the channels pillar asked. No canvas, no ffmpeg, works on every machine. The storyboard's `W`, `H` become parameters.

### 4.1 Frame path

```
RenderSpec → voice → timeline → assets (pages, cover, grain) → loop { drawFrame(i); canvas.data() → ffmpeg stdin } → QA → manifest
```

```
ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r 30 -i pipe:0 -i mix.wav
  -vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p
  -c:v libx264 -preset veryfast -crf 26 -profile:v high -level 4.1 -threads 2
  -colorspace bt709 -color_primaries bt709 -color_trc bt709
  -c:a aac -b:a 160k -ar 44100 -af loudnorm=I=-14:TP=-2.5:LRA=11
  -metadata comment=… -movflags +faststart -shortest out.mp4
```

Honour backpressure on stdin (`drain`), or memory grows by 8 MB a frame.

Grain: one static full-frame noise image at alpha 13/255. Never one per frame.

### 4.2 Scene grammar

All proven in the prototype unless marked.

- **Hook** (D66 changed this line): the first screen is the line written to stand alone, whole on frame 1, flush left, one accent word; each word hits on the voice. Later screens are clauses of at most 9 words. `Timeline.plain` (`captionWords` ≥ 6 on a voiced cut, no `sfx` on a slide) stands the type centred over a dark plate, nothing hits, no book. A kinetic hook lands on its guide at 1,2 s, at most 60 % of the hook (D77). The screen says what the voice says (D136): a figure the voice opens on is never dropped, a quoted line behind that figure opens its own screen with both marks, a voice telling « Avant … Après … » gets a screen a side, and a voice cut at « Avant » keeps the written Après on its one screen, lit on the last word said. That one screen may pass 9 words, 14 at most on the seeds read: it is the whole story, whole on frame 1. A plain hook's art stays at the edges and the foot: a veil of .74 over the frame, a shade of .62 with a soft edge over the type's box, about .9 in all, and the accent held at 4,5:1 on what still shows. It was: Anton, largest size that fits the box in 3 lines at most. Each word slams from ×1,55 with `easeOutBack` over 0,14 s, shake 10 px over 0,1 s, digits in gold. One screen per clause. The cover rises at 0,45 s (x ≥ 0,65).
- **Pain bubble**: light plate for contrast with the dark hook, typing dots 0,55 s, words appear at 45 ms each, second real phrase pops at 2,3 s. Label « LU DANS LES COMMENTAIRES ». The phrases are VoC research, never invented, and no fake user name.
- **Page proof**: real page at scale 3,4 (2 024 px wide), tilted −0,05 rad, then two punch-ins centred on the real text box, marker sweep in `multiply` at 20 % of the beat. Chip « ÉTAPE 1 » or « REPÈRE ». As shipped (D135): 3,6 px a point, 3 for a plain editor, 2,7 on a real opener only, a one-letter drop cap being no chapter numeral and no marker box. The marker runs with the voice, then the camera steps back over 0,4 s until the whole mark stands in the frame, 50 px a side, before the cut when the voice runs to it. It then goes on pushing, 0,75 % a second to +6 %, into that margin down to 20 px: type never shrinks, the mark stays whole and no frame is dead.
- **Bonus stack**: three real pages fan out behind the book, sticker « BONUS OFFERT » pops on the word « cadeau ».
- **End card**: rays, book with a moving sheen, CTA pill pulsing ±3,5 %, « Lien en bio », bouncing arrow. No caption: the voice says the same thing and they collided.
- **Captions**: Montserrat ExtraBold 76, uppercase, one group at a time, pops ×0,86 to 1 over 0,13 s, the spoken word on a rounded pill. Black stroke 15 px, `lineJoin` round. Below the bubbles on `pain_bubble`.
- **Cuts**: every beat change has a white flash 0,07 s at 32 %, a punch ×1,07 falling over 0,16 s and a whoosh. Inside a beat a shot change is a real camera jump (+6 % scale, D66).
- **Progress bar**: 10 px, gold, at the top of the safe area, hidden on the end card.
- **Depth**: drifting leaves (shapes by motif), radial glow, vignette 0,34.
- **Slide**: digits on the light plate walk toward the guide's ink until they read at 3:1 at its top and its foot, on all 15 palettes. A light primary (Pêche tendre, Corail vitalité, Coucher de soleil) takes `dark` and `dark2` from `inks.ink`, as its cover does, so the CTA pill stands on its plate. A dark primary keeps its own: Nuit douce still sits at 1,53:1, the white label reads, the pill's edge barely does.
- **Review card**: stars, the quote the voice reads and a first name (`reviewsOf`, by `reviewBasis`, D93). The first buyer to write a sentence keeps it (D137): later cards read « Un acheteur du guide ».
- **Not prototyped**: `before_after`, `step_list`, `slide`, `title_card`, carousel export. Drawn with the same helpers. `narrator` exists as one still (`sheet4.png`, middle).

Layout rules per ratio, from `sheet5.png`: the book in the hook covers the text on 4:5 and 1:1, and the end card's arrow clips on 1:1. So `Stage` carries `heroBox`, `bookSlot`, `captionY`, and on 1:1 the hook's book moves to the right third and the arrow goes.

```ts
export interface Stage {
  ratio: Exclude<AdRatio, 'text'>; w: number; h: number;
  zones: { x0: number; x1: number; y0: number; y1: number }[]; // the 9:16 master has two
  heroBox: Rect; bookSlot: Rect; captionY: number;
}
```

### 4.3 Timeline

```
beat.dur = speech + 0.16, then rounded up to the next 8th note of the music (at most 0.27 s at 112 BPM)
end card: speech + endHoldSec
caption groups: cut after punctuation, at 3 words, or at 16 chars
hook screens: the standing line, then clauses (§4.2). QA's cadence counts each screen, and each word that hits past a plain editor (`plannedCuts`)
```

Not prototyped: the grid snap. It is one line, and it puts the cuts on the music.

Real durations replace the estimates only inside the render. QA reports the gap and warns over 12 %. It never reaches the world.

## 5. Audio

### 5.1 Music and SFX

Pure JS on `Float32Array`, 44,1 kHz stereo. No sample, no licence. 0,7 s for 26 s.

- 4-chord loop, kick on 1 and 3, clap on 2 and 4 from bar 2, 8th hats, sub on the root, FM pluck arpeggio with 28 % rests, soft pad.
- Seed `hashString(hook)`. Root 52 to 60. Major or minor from the family: `mental`, `argent`, `tech` minor, the rest major.
- BPM by tempo: 88, 112, 128.
- SFX: whoosh 0,26 s (filtered noise), pop 0,09 s, ding 0,7 s, impact 0,42 s. Gains 0,22 to 0,5.

### 5.2 Voice

`tts.ps1` with `System.Speech`. Voice: first `fr-FR` installed, Hortense preferred. Rate 1. 1,6 s for six lines.

Two traps, both measured:

1. **Ask for 16 kHz mono.** `AudioPosition` assumes the voice's native rate. At 22,05 kHz every time is ×1,378 too large and at 44,1 kHz ×2,76: the last word started after the speech had ended. At 16 kHz, `il@1733` against a pause ending at 1 751 ms. Resample later.
2. **Events are normalised tokens.** « 8 étapes » fires twice at offset 0, and punctuation is absent. So `alignWords` takes words from the source text and uses events only for times, interpolating on characters where an event is missing.

The engine leaves 0,62 to 0,77 s of tail: trim at −40 dB.

Chain, checked on ffmpeg 8.1 and 6.1.1:

```
highpass=f=90, equalizer=f=220:t=q:w=1:g=2, equalizer=f=3200:t=q:w=1.2:g=4,
aexciter=level_in=1:level_out=1:amount=1:drive=4.5:blend=0:freq=3000:ceil=9999,
acompressor=threshold=-20dB:ratio=3.5:attack=6:release=90:makeup=4dB, aresample=44100, alimiter=limit=0.9
```

No `soxr`: not guaranteed in every build.

Voice cache: `runs/<id>/video/_voice/<sha1(text|voice|rate)>.wav` + `.json`. All ratios and reworks reuse it.

### 5.3 Mix

Ducking from the known word times, no sidechain: presence per ms, 80 ms look-ahead, 220 ms release, −11 dB. `tanh` soft clip, peak 0,92, then `loudnorm` in the encoder. Measured: −15,0 LUFS with voice, −14,2 music only. Tolerance −14 ± 2,5.

## 6. Dependencies and fonts

`server/package.json`, `optionalDependencies`, so a failed native install breaks nothing:

| Package | Version tested | Size | Licence | Role |
|---|---|---|---|---|
| `@napi-rs/canvas` | 1.1.0 | 38 MB (win x64) | MIT | Compositor. Prebuilt, no install script |
| `pdfjs-dist` | 6.4.299 | 35 MB | Apache-2.0 | Real pages, text boxes. `legacy/build/pdf.mjs`, `disableFontFace: true` |
| `ffmpeg-static` | 5.3.0 | 83 MB | GPL binary, downloaded | Fallback encoder |

`@resvg/resvg-js` is not needed for video.

Fonts, committed to `server/assets/fonts/`, copied once from `@expo-google-fonts/*` (.ttf verified, npm licence `MIT AND OFL-1.1`, fonts OFL):

| File | Size | Use |
|---|---:|---|
| `Anton-Regular.ttf` | 162 KB | Hooks |
| `Montserrat-ExtraBold.ttf` | 344 KB | Captions, bubbles, CTA |
| `Montserrat-SemiBold.ttf` | 334 KB | Secondary text |
| `Caveat-Bold.ttf` | 257 KB | Handwritten notes |
| `DMSerifDisplay-Regular.ttf` | 72 KB | Hooks when `design.titleFont` is Times-Bold. Read on frames decoded from MP4 at 9:16, 4:5 and 1:1 (last list, V3-D) |
| `OFL-<name>.txt` | | Each font's `LICENSE_FONT` |

Skia loaded the first four. Anton and Montserrat drew French capitals with accents in the prototype. A test must check accent coverage for all five. If the pdf pillar adds fonts, same folder.

## 7. Fallback ladder

`detectCaps()` runs once at start.

ffmpeg order: `FFMPEG_PATH`, then `ffmpeg` on PATH, then `ffmpeg-static`, each confirmed by `-version` and a `libx264` encoder.

| Level | Missing | Result | UI text |
|---|---|---|---|
| `full` | nothing | Everything | « Vidéo prête » |
| `no_voice` | no fr voice, or not Windows | Timings from `estimateSpeechSec`, captions and music, no ducking. Proven by `cut-45-music-only.mp4` | « Sans voix sur cette machine » |
| `no_pages` | `pdfjs-dist` absent, PDF unreadable, needle not found | `page_proof` falls back to `fact_card` for that beat, cover from `cover.svg` through Skia. Needle lookup is per beat | « Sans pages du guide » |
| `storyboard_only` | no ffmpeg or no canvas | Status `unavailable`, HTML preview stays, nothing crashes | « Indisponible : ffmpeg introuvable » |

## 8. `ugc_avatar`, stated plainly

The narrator (`sheet4.png`) is a flat vector character in a card: blink every 3,1 s, head sway, brows up on loud words, mouth from the word timings.

It is a cartoon, it looks like one, and it says « on » for the guide. It never says « j’ai testé », which `ads.ts` already forbids. The illustrated look is intentional: a deepfake-style talking head would be a fake person with a fake testimony. Colours come from the palette. The existing `FORMAT_LABEL` « Avatar UGC » becomes « Narrateur animé ». The enum stays, because the market's `formatAffinity` keeps working on it.

## 9. Queue, outside the world

```ts
export type VideoMode = 'off' | 'ondemand' | 'auto';

export class VideoDirector {
  constructor(opts: { paths: RunPaths; mode: VideoMode; caps: VideoCaps; maxDiskMb: number; onChange(id: string, v: CreativeVideo): void });
  sync(world: Readonly<WorldState>): void;
  request(world: Readonly<WorldState>, creativeId: string, ratio?: AdRatio): CreativeVideo;
  index(): VideoIndex;
  retireCreativeFiles(creativeId: string): Promise<void>;
  stop(): Promise<void>;
}

export function selectWorthy(world: Readonly<WorldState>): { creativeId: string; ratio: AdRatio }[];
```

**Who gets rendered.** `selectWorthy` is pure:

1. Creatives in a launch awaiting the founder, so they can watch before they click.
2. Approved, in an active campaign, at least 1 000 impressions (scale pillar), quality ≥ 70, by impressions. Three at most in the queue.

On-demand requests from the UI go first. Everything else stays a storyboard.

**Modes.**
- `VIDEO_MODE` env: API server default `auto`.
- `npm run sim`: `off`.
- `scripts/balance.ts` never imports `video/`.

**Flow.** `AgencySession` calls `director.sync(world)` after `saveWorld`, line 420 of `session.ts`. It reads only and never awaits the render. `buildRenderSpec` copies what the worker needs into `runs/<id>/video/<creativeId>/<key8>/spec.json`, so the worker never sees the world.

**Key.** `sha1(JSON(cut) + ratio + RENDER_VERSION + voiceId + design)`. A rework gets a new key. Same key, ready file: no render.

**Worker.** `fork(worker, { execArgv: process.execArgv })`, `os.setPriority(pid, PRIORITY_BELOW_NORMAL)`, `-threads 2`, kill after 600 s, one retry, then `failed` with a French reason. A failed QA is a failed job: its file is deleted, never served. A QA that never finished is no verdict: each of its ffmpeg gets 300 s, and one that was killed, or a file with audio that gives no loudness, keeps the master and goes to the retry. Cut on both attempts, the row goes `evicted` with its reason, the folder stays, and the next sync or the button asks again (D156).

**Disk.** `manifest.json` in `runs/<id>/video/`, written after each job. `maxVideoDiskMb` default 1 200, about 130 to 240 masters at 5 to 9 MB (a page held long costs more than a hook: 8,7 MB seen, QA's cap is 12). Over the cap, the lowest-impression `ready` video is evicted, its poster stays, status `evicted`, re-render on demand. `retireCreativeFiles` is the hook for scale's `dropFiles`.

**Reload.** Manifest reread at mount. Anything `rendering` becomes `queued`. A key already on disk is `ready` after a light QA (size, duration).

**API.**
- `GET /api/videos` → `VideoIndex`
- `POST /api/videos/render { creativeId, ratio? }` → `CreativeVideo`
- `snapshotJson(world, god, { videos })` already takes `extra`: no change to `serializeSnapshot`.
- SSE `{ type: 'video' }` on every status change.
- Files through the existing `/runs/<id>/…` route.
- `/api/gallery` adds `ad_video` tiles from the manifest, not from `company.deliverables`.

**CLI.** `npm run video -- --run <id> --creative <id> --ratio 9:16` in `server/scripts/renderAd.ts` draws PNG frames. `--mp4` makes the real file through `buildRenderSpec` and `renderJob`, and prints QA.

## 10. QA on the real file

`qa.ts`, port of `qa.mjs`. **1,1 s** on the master. One decode pass carries every video filter. No ffprobe: parse `ffmpeg -hide_banner -i file` stderr.

| Check | Rule | Master |
|---|---|---|
| Size | exactly the stage | 1080×1920 |
| Codec | h264, yuv420p, 30 fps | ok |
| Faststart | `moov` before `mdat`, read from the head of the file | ok |
| Duration | within 0,5 s of the timeline, 9 to 60 s (D63) | 26,13 |
| Audio | aac present when the cut has audio | ok |
| Loudness | −14 ± 2,5 LUFS | −15,0 |
| Silence | none over 1,5 s at −45 dB | none |
| Blank | `blackdetect` d=0,15 pix_th=0,06: none | none |
| Frozen | `freezedetect` n=0,002: none over 2,6 s | none |
| First frame | `YMAX − YMIN > 120` at 0,05 s | 182 |
| Cadence | `gt(scene,0.06)` cuts within ±35 % of planned shots | 18 (ASL 1,38 s) |
| Weight | under 12 MB (the 40 MB of the prototype QA was for CRF 21) | 4,7 MB at CRF 27 |
| Safe text | ledger + SSIM, below | new |

A black 8 s file fails 6 of 13 checks: tested.

**Text in safe zones.** Every text call goes through `drawText`, which records its box in device space from `ctx.getTransform()`. Page mock-ups are pictures and do not count. QA samples one settled frame per caption group (`at + 0.2 s`) and requires `insideSafe` for each box. Then it decodes 6 of those frames from the MP4 and compares them with the same frames redrawn: SSIM ≥ 0,88 (CRF 27 against CRF 21 gave 0,93 over the whole clip). So the ledger is proved to describe the file. The ledger and the SSIM step are designed, not prototyped. Pixel-reading text with OCR is not worth a dependency.

Real-file QA can never reach the market. The pure stand-in that can is `textP` in §3.5.

## 11. Measures

On this machine, with another workflow using the CPU. Master 26,1 s, 784 frames.

| Step | Time |
|---|---:|
| Voice, six lines | 1,6 s |
| Assets (real pages at 3,4×, grain) | 2 to 3 s |
| Music, SFX, mix | 0,7 s |
| Draw 27 ms a frame + x264 veryfast, CRF 21 to 27 | 24,4 s |
| QA | 1,1 s |
| **Total** | **≈ 30 s** |

- 4:5 cut, music only: 19,9 s.
- A 60-day run with about 40 creatives past the threshold: 20 minutes of background work.
- CRF 21: 13,8 MB, 4,2 Mbps. CRF 27: 4,7 MB, 1,45 Mbps. Default 26.
- resvg comparison frame: 92 ms.
- `planCut` is a few string operations per creative: the benchmark does not move. Measure it at build.

## 12. Tests

Each fails without the feature.

| File | Test | Fails if |
|---|---|---|
| `server/test/videoCut.test.ts` | Same input, same `VideoCut`, byte for byte | hidden state in the cut |
| | Skill 0,2 vs 0,9 on one creative: craft differs by ≥ 40, and `hookWordSec`, `avgShotSec`, `kinds`, `productSec` all differ | talent is a label |
| | Every `spoken` is contained in its scene's voice-over, and no word appears that was not there | the editor adds a claim |
| | `JSON.stringify(cut)` has no `skill`, `x`, `ceiling` | a talent secret leaks |
| | Level 2 on « … — il n’a pas … » never leaves a clause cut mid-way, on all 4 catalogs | a negation is lost |
| | A `needle` always exists verbatim in `content` | proof is invented |
| `server/test/speech.test.ts` | `alignWords` on the recorded events: 14 words for the hook, « 8 » and « étapes » both timed, monotonic | SAPI dedupe missing |
| | `estimateSpeechSec` within 10 % of the 6 fixture lines | model drift |
| `server/test/videoScore.test.ts` | Same creative, better cut: higher `overall`, higher CTR from `adQ` | craft does not reach the market |
| | Without a cut: `scoreCreative` equals today's value exactly | old saves shift |
| | A 38 s voice-over scores under a 26 s one | the score still reads `durationSec` |
| `server/test/videoWorld.test.ts` | 12-day run with a fake director on `auto` vs `off`: `world.json` byte-identical | rendering touches the sim |
| | Reload mid-run ends identical with `cut` in the world (extends the test in `runtime.test.ts`) | reload guarantee broken |
| | `videoModel: 'off'`: every draw of the market equals today's | a stream shifted |
| | No plain snapshot holds a niche's `demand` or its affinities | hidden truth leaks |
| `server/test/videoAudio.test.ts` | `makeMusic` deterministic, no NaN, peak ≤ 1 | |
| | `mixDown`: music RMS under speech ≥ 8 dB lower than in the gaps | ducking gone |
| `server/test/videoRender.test.ts` (`skipIf(!ffmpeg)`) | 3 s mini-cut at 270×480 through the real pipeline: file exists, QA passes | pipeline broken |
| | QA fails a black file, a mute file, a wrong size | QA is decoration |
| | Text placed outside the zone fails `insideSafe` | safe zones are a label |
| | `findFfmpeg` with PATH empty and no static returns null, the job is `unavailable`, storyboard intact | a machine without ffmpeg crashes |
| `server/test/videoDirector.test.ts` | `selectWorthy`: nothing under 1 000 impressions, pending approval first, at most 3 | everything renders |
| | Same key, ready file: no second render | cache missing |
| | Over `maxDiskMb`: lowest-impression evicted, poster kept | disk grows without limit |
| `web/src/ui/ui.test.tsx` | A creative with `videos` shows `<video>`, without it shows the iframe and the caption | |

**Market proof**, at the final bench, 30 seeds, paired per seed, not run here:

- A: `videoControl.skill` 0,2 vs 0,9. Pass: CTR ratio ≥ 1,12 on at least 24 of 30 seeds, and the median paired profit gain is positive.
- B: `videoControl.tempo: 'standard'` vs the bandit. Pass: learned CTR over days 31-60 above fixed on at least 18 of 30 seeds. Below that, cut the tempo mechanic: it would be a label. Step 4 read 14 of 28: cut, D149.

## 13. How it reaches the UI

The founder opens Pubs, sees the real video play in a phone frame with sound. Details for the ui pillar:

- `VideoPlayer` reads `snapshot.videos[creative.id]`.
- Change in its contract: `VideoFile.ratio` is `AdRatio` minus `'text'`, so `'2:3'` replaces `'16:9'`. No file is ever 16:9.
- Button « Générer la vidéo » → `POST /api/videos/render`, disabled when `level === 'storyboard_only'`.
- Chips: « En file », « Rendu en cours… », « Vidéo prête », « Échec du contrôle », « Sans voix sur cette machine », « Indisponible : ffmpeg introuvable », « Pub simulée — jamais publiée ».
- Panel « Montage » from `creative.cut.metrics`: hook at 0,0 s, guide visible at 0,5 s, 1,4 s per shot, tempo, score /100. Observed facts, no talent value.
- Overlay uses `SAFE_ZONES`.
- `carousel`: a swipeable set of `cards`.
- `lightCreative` keeps `cut.metrics`, `cut.tempo`, `cut.craft` and may drop `beats`.
- Serving needs the ui pillar's `Range` support and `.mp4` MIME.

## 14. What I need from the other pillars

| Pillar | Need | If absent |
|---|---|---|
| **talent** | A skill `edit` in `Skill`, and `editSkillOf(world, agent): number \| undefined` (effective talent with the ramp). Chloé high, Sarah and Tom lower. `bestDraft` runs the cut on its scratch creative. `recordEvidence(world, personId, 'edit', 'qa', cut.craft, …)` at the first review of `produce_ad`. `STREAM` integers agreed | Falls back to `mind.craft.t` of `copy`, then `EDIT_BASELINE` |
| **org** | Whoever edits holds `produce_ad`. Chloé's role reads « Monteuse vidéo » | Works as is |
| **channels** | `AdRatio`, `masterId`, `ratio`, `static_image`. A cut creative copies its master's `cut`. I deliver `renderAdCut` as asked | 9:16 only |
| **pdf** | `product.files.pdf` stays the current version, text stays real text, not outlines, or needles stop matching. Cover on page 1. Embedded fonts must render with `disableFontFace: true`: tested on standard fonts only | `no_pages` for that beat |
| **scale** | `maxVideoDiskMb` in its budget, `dropFiles` calls `retireCreativeFiles`. Plan on 5 to 9 MB a master, not 2 | Default 1 200 MB |
| **ui** | §13 | The HTML preview stays |

## 15. Build order

1. `speech.ts`, `videoCut.ts`, `videoCraft.ts`, quality hooks, types, tests. Market effect is live here.
2. `caps`, `fonts`, `stage`, `pdfPages`, `compose`, scenes for `faceless_voiceover`, `renderAd.ts`.
3. `music`, `sfx`, `mix`, `tts.ps1`.
4. `encode`, `qa`, render test.
5. `director`, `worker`, API, SSE.
6. `text_slideshow`, `carousel`, `ugc_avatar`, ratios, `renderAdCut`.
7. Final calibration, with the others, once.

Cut from the bottom if time runs short: 2:3 first, then `step_list`, then `before_after`, then the tempo mechanic. Never cut QA, the world test or the fallback ladder.

## 16. Rejected

| Rejected | Why |
|---|---|
| resvg for every frame | 92 ms against 27 ms, and each page must be re-embedded as base64 |
| ffmpeg `zoompan` + `overlay` over a few PNGs | No word-level kinetics, integer jitter on zooms, unreadable filter graphs |
| Remotion or headless Chromium | 150 MB+, slower, Remotion has a company licence |
| Paid avatars, paid voices, stock footage | No paid service, no key, and a fake person |
| Trending or stock music | Licences. Procedural is free and deterministic |
| Fake platform UI in the file | The app draws it. Baked in, it is a lie and doubles on a real feed |
| Cropping the master for other ratios | Text falls out. Re-layout costs one video pass |
| Per-frame grain | 4,6× the bytes |
| ffprobe | Absent from `ffmpeg-static` |
| `files.videos` and `Deliverable` in the world | Breaks identical worlds. Served by the API layer |
| Real TTS durations in the score | Would make benchmarks depend on the machine |
| QA feeding the market | Same reason. `textP` is the pure stand-in |
| A separate CTR factor for craft | Invisible to the league. Tempo is separate because it is market fit, not skill |
| ASS subtitles through libass | No word pop, one more build dependency |
| 60 fps, GPU encoders, WebM | Double cost, not portable, no platform needs it |
| A burned « IA » or « simulée » watermark | Spoils the deliverable. Metadata and UI say it. To decide with a lawyer before real publication |
| Worker thread | A native crash would kill the simulation |
| Rendering every creative | 30 s each and most never run. The queue renders what spends money or what the founder asks for |

## 17. Known limits

- **I could not listen to the result.** Audio is verified by LUFS, silence detection and a waveform, not by ear. The music balance and the voice chain need one human listen.
- **Hortense is a dated synthetic voice.** Word timing and diction are clean, but it will not pass for a human. This is the weakest link of the video and it stays so offline.
- The prototype's hook lasts 4,2 s because the real hook is long. Good for the score, but a stronger hook would help more than any editing.
- The ugly product title (« … — les citadins débutants ») shows on the cover. That belongs to the pdf and copy pillars.
- `narrator`, `slide`, `title_card` and carousel export render end to end, on real MP4s and cards. `before_after` and `step_list` are designed, and no cut of the seeds read reaches them: a before/after hook runs as a `hook` (§4.2).
- A wide mark at rest reads about 31 px at 1080 wide, under the 36 px of a phone's message: the whole mark comes first, the list's own formula. 9 of 76 rest under 30 px, none under 29.
- A slide still opens on its first word alone on the cut, for about 0,17 s a word.
- Safe-zone numbers come partly from third-party tools and must be checked in-app before anything real.
- `ffmpeg-static` printed npm's `allow-scripts` warning. The binary arrived here, but a stricter npm could skip it: the ladder then lands on `storyboard_only`.

Sources for safe zones:
- [Postplanify, social media safe zones 2026](https://postplanify.com/blog/social-media-safe-zones-2026-complete-guide)
- [AdKit, universal ad safe zones](https://adkit.so/tools/safe-zones/universal)
- [AdKit, YouTube Shorts ad safe zones](https://adkit.so/tools/safe-zones/youtube)
- [Upload-Post, TikTok, Reels and Shorts safe zone checker](https://www.upload-post.com/tools/safe-zone-checker/)
- [House of Marketers, guide to safe zones](https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/)
