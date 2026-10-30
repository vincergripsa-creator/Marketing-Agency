/**
 * Headless simulation: `npm run sim -- --days 30 --budget 500 --difficulty normal --seed 42 --mind heuristic`
 * Creates (or resumes) runs/<runId>, runs the agency as fast as possible, prints a daily KPI table
 * and a final French verdict.
 */
import type { DailyKpi, Difficulty, FinanceSnapshot, WorldState } from './shared.js';
import type { ConfigMindMode } from './api/env.js';
import { isEntryPoint } from './api/entry.js';
import { budgetRefusal } from './api/http.js';
import { minStartingCash } from './sim/balance.js';

export interface CliArgs {
  days: number;
  budget: number;
  difficulty: Difficulty;
  seed: number;
  mind: ConfigMindMode;
  mindExplicit: boolean;
  runId: string | null;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
}

export const CLI_USAGE = `Utilisation : npm run sim -- [options]

  --days N          nombre de jours simulés (défaut 30)
  --budget N        trésorerie de départ en € (défaut 500, minimum ${minStartingCash()})
  --difficulty D    facile | normal | cauchemar (défaut normal)
  --seed N          graine du marché virtuel (défaut 42)
  --mind M          heuristic | claude | auto (défaut heuristic : hors-ligne et gratuit)
  --run-id X        nom du run (reprend le run s'il existe déjà)
  --quiet           n'affiche que le verdict final
  --verbose         affiche aussi le fil d'activité des agents
  --help            cette aide`;

const DIFFS: readonly Difficulty[] = ['facile', 'normal', 'cauchemar'];
const VALUE_KEYS = new Set(['days', 'budget', 'seed', 'difficulty', 'mind', 'run-id', 'runid']);

export class CliError extends Error {}

/** Parses `--key value` / `--key=value` flags. Throws CliError with a French message. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    days: 30, budget: 500, difficulty: 'normal', seed: 42, mind: 'heuristic', mindExplicit: false,
    runId: null, quiet: false, verbose: false, help: false,
  };
  const flags = new Set(['quiet', 'verbose', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === '-h') { out.help = true; continue; }
    if (!tok.startsWith('--')) throw new CliError(`Argument inattendu : « ${tok} ».`);
    const eq = tok.indexOf('=');
    const key = (eq >= 0 ? tok.slice(2, eq) : tok.slice(2)).toLowerCase();
    if (flags.has(key)) {
      if (key === 'quiet') out.quiet = true;
      else if (key === 'verbose') out.verbose = true;
      else out.help = true;
      continue;
    }
    if (!VALUE_KEYS.has(key)) throw new CliError(`Option inconnue : --${key}.`);
    let value: string | undefined = eq >= 0 ? tok.slice(eq + 1) : argv[i + 1];
    if (eq < 0) i++;
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new CliError(`L'option --${key} attend une valeur.`);
    value = value.trim();
    const num = (min: number, max: number) => {
      const n = Number(value!.replace(',', '.'));
      if (!Number.isFinite(n) || n < min || n > max) throw new CliError(`--${key} doit être un nombre entre ${min} et ${max} (reçu « ${value} »).`);
      return n;
    };
    switch (key) {
      case 'days': out.days = Math.round(num(1, 730)); break;
      case 'budget': {
        const budget = num(0, 1_000_000);
        const refusal = budgetRefusal(budget);
        if (refusal) throw new CliError(refusal);
        out.budget = Math.round(budget * 100) / 100;
        break;
      }
      case 'seed': out.seed = Math.floor(num(0, 2 ** 31 - 1)); break;
      case 'difficulty': {
        const d = value.toLowerCase() as Difficulty;
        if (!DIFFS.includes(d)) throw new CliError(`--difficulty doit valoir facile, normal ou cauchemar (reçu « ${value} »).`);
        out.difficulty = d;
        break;
      }
      case 'mind': {
        const m = value.toLowerCase();
        if (m !== 'heuristic' && m !== 'claude' && m !== 'auto') throw new CliError(`--mind doit valoir heuristic, claude ou auto (reçu « ${value} »).`);
        out.mind = m;
        out.mindExplicit = true;
        break;
      }
      case 'run-id':
      case 'runid':
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || value.includes('..')) throw new CliError('--run-id : lettres, chiffres, « . », « _ » et « - » uniquement.');
        out.runId = value;
        break;
      default:
        throw new CliError(`Option inconnue : --${key}.`);
    }
  }
  return out;
}

// ───────────────────────────── formatting ─────────────────────────────

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 1234.5 → "1 234,50 €" (plain spaces, console-friendly). */
export function fmtEur(n: number, signed = false): string {
  const v = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v).toFixed(2);
  const [i, d] = abs.split('.');
  const sign = v < -0.004 ? '-' : signed && v > 0.004 ? '+' : '';
  return `${sign}${groupThousands(i!)},${d} €`;
}

export function fmtNum(n: number, digits = 2): string {
  return (Number.isFinite(n) ? n : 0).toFixed(digits).replace('.', ',');
}

export const TABLE_COLUMNS: { title: string; width: number }[] = [
  { title: 'Jour', width: 4 },
  { title: 'Trésorerie', width: 12 },
  { title: 'CA', width: 10 },
  { title: 'Pub', width: 10 },
  { title: 'Profit cumulé', width: 13 },
  { title: 'Ventes', width: 6 },
  { title: 'ROAS', width: 5 },
  { title: 'Remb.', width: 5 },
  { title: 'Tickets', width: 7 },
  { title: 'Leçons', width: 6 },
];

function row(cells: string[]): string {
  return cells.map((c, i) => c.padStart(TABLE_COLUMNS[i]!.width)).join(' │ ');
}

export function tableHeader(): string {
  const head = row(TABLE_COLUMNS.map((c) => c.title));
  const rule = TABLE_COLUMNS.map((c) => '─'.repeat(c.width)).join('─┼─');
  return `${head}\n${rule}`;
}

export function kpiRow(k: DailyKpi): string {
  return row([
    String(k.day),
    fmtEur(k.cash),
    fmtEur(k.revenue),
    fmtEur(k.adSpend),
    fmtEur(k.cumulativeProfit, true),
    String(k.sales ?? 0),
    k.adSpend > 0 ? fmtNum(k.roas) : '—',
    String(k.refunds ?? 0),
    String(k.openTickets ?? 0),
    String(k.lessonsLearned ?? 0),
  ]);
}

export function clip(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n > 1 ? many : one}`;
}

function nicheName(world: WorldState, nicheId: string): string {
  return world.company.research?.trends?.find((t) => t.nicheId === nicheId)?.name
    ?? world.market.niches?.find((n) => n.id === nicheId)?.name
    ?? nicheId;
}

const DIM_LABEL: Record<string, string> = {
  hook_style: 'Style de hook', ad_format: 'Format pub', price: 'Prix', hype: 'Niveau de promesse', support_tone: 'Ton support', niche: 'Niche',
};

/** Best arm per bandit dimension with enough evidence, as French lines. */
export function banditInsights(world: WorldState, minPulls = 3, max = 6): string[] {
  const lines: { text: string; pulls: number }[] = [];
  for (const [key, arms] of Object.entries(world.company.bandits ?? {})) {
    const tried = (arms ?? []).filter((a) => a.pulls >= minPulls);
    if (!tried.length) continue;
    const best = tried.reduce((b, a) => (a.alpha / (a.alpha + a.beta) > b.alpha / (b.alpha + b.beta) ? a : b));
    const [dim, nicheId] = key.split(':');
    const label = DIM_LABEL[dim!] ?? dim!;
    const where = nicheId ? ` (${nicheName(world, nicheId)})` : '';
    const armLabel = dim === 'price' ? `${best.key} €` : dim === 'niche' ? nicheName(world, best.key) : best.key.replace(/^(\d)\.(\d)$/, '$1,$2');
    const mean = Math.round((best.alpha / Math.max(1e-9, best.alpha + best.beta)) * 100);
    lines.push({ text: `${label}${where} : ${armLabel} — score ${mean} %, ${best.pulls} essais`, pulls: best.pulls });
  }
  return lines.sort((a, b) => b.pulls - a.pulls).slice(0, max).map((l) => l.text);
}

export interface VerdictInput {
  world: WorldState;
  finance: FinanceSnapshot;
  daysRun: number;
  filesDir: string;
  brainDir: string;
  worldFile: string;
}

/** Final French report of a headless run. */
export function verdict({ world, finance, daysRun, filesDir, brainDir, worldFile }: VerdictInput): string {
  const s = world.scenario;
  const out: string[] = [];
  const bar = '═'.repeat(78);
  out.push('', bar, `  VERDICT — ${s.companyName} après ${daysRun} jour${daysRun > 1 ? 's' : ''} simulé${daysRun > 1 ? 's' : ''} (difficulté ${s.difficulty}, graine ${s.seed})`, bar);

  const profitable = finance.profit > 0;
  let headline: string;
  const lastDay = world.tick === 0 ? Math.max(1, world.day - 1) : world.day;
  if (world.status === 'bankrupt' || finance.bankrupt) headline = `FAILLITE : trésorerie négative à la fin du jour ${lastDay} (${fmtEur(finance.cash)}). L'agence survit sans pub, sur l'organique et les créateurs à la commission.`;
  else if (world.status === 'goal_reached' || (s.goal?.targetProfit > 0 && finance.profit >= s.goal.targetProfit)) headline = `OBJECTIF ATTEINT : ${fmtEur(finance.profit, true)} de profit (objectif ${fmtEur(s.goal.targetProfit)}).`;
  else if (profitable && finance.profit7d > 0) headline = `RENTABLE : ${fmtEur(finance.profit, true)} de profit cumulé, et la dernière semaine gagne de l'argent.`;
  else if (profitable) headline = `RENTABLE, mais fragile : ${fmtEur(finance.profit, true)} cumulés, la dernière semaine perd ${fmtEur(-finance.profit7d)}.`;
  else headline = `PAS ENCORE RENTABLE : ${fmtEur(finance.profit, true)} depuis le départ.`;
  out.push(`  ${headline}`, '');

  const runway = finance.runwayDays === null ? 'illimitée (dernière semaine sans perte)' : `${finance.runwayDays} jours`;
  out.push(`  Trésorerie    ${fmtEur(finance.cash)} (départ ${fmtEur(s.startingCash)}) · runway ${runway}`);
  out.push(`  Chiffre d'aff. ${fmtEur(finance.revenue)} · pub ${fmtEur(finance.adSpend)} · remboursements ${fmtEur(finance.refunds)} · frais ${fmtEur(finance.fees + finance.otherCosts)}`);
  out.push(`  ROAS 7 jours  ${fmtNum(finance.roas7d)} · profit 7 jours ${fmtEur(finance.profit7d, true)}${finance.compute > 0 ? ` · calcul IA ${fmtEur(finance.compute)}` : ''}`);

  const products = world.company.products ?? [];
  const live = products.filter((p) => p.status === 'live');
  const totalSales = products.reduce((n, p) => n + (p.stats?.sales ?? 0), 0);
  out.push(`  Produits      ${products.length} créé${products.length > 1 ? 's' : ''}, ${live.length} en ligne · ${totalSales} vente${totalSales > 1 ? 's' : ''} · ${world.market.customers?.length ?? 0} clients`);

  const best = products
    .filter((p) => (p.stats?.sales ?? 0) > 0)
    .sort((a, b) => (b.stats.revenue - b.stats.refundAmount) - (a.stats.revenue - a.stats.refundAmount))[0];
  out.push('');
  if (best) {
    const net = best.stats.revenue - best.stats.refundAmount;
    const rating = best.stats.rating > 0 ? ` · note ${fmtNum(best.stats.rating, 1)}/5` : '';
    out.push(`  Meilleur produit : « ${clip(best.title, 90)} » (${nicheName(world, best.nicheId)})`);
    out.push(`    ${best.stats.sales} ventes à ${fmtEur(best.price)} · ${fmtEur(net)} net de remboursements${rating} · v${best.version}`);
  } else {
    out.push('  Meilleur produit : aucune vente pour l\'instant.');
  }

  const lessons = [...(world.company.lessons ?? [])]
    .sort((a, b) => b.confidence - a.confidence || b.day - a.day)
    .slice(0, 5);
  out.push('', '  Leçons clés :');
  if (lessons.length) {
    for (const l of lessons) {
      out.push(`    • ${clip(l.insight, 160)}`);
      if (l.evidence) out.push(`      ↳ ${clip(l.evidence, 150)}`);
    }
  } else {
    out.push('    • Pas encore assez de données pour tirer une leçon chiffrée.');
  }

  const bandits = banditInsights(world);
  if (bandits.length) {
    out.push('', '  Ce que les tests A/B ont appris :');
    for (const b of bandits) out.push(`    • ${b}`);
  }

  const kinds = (k: string) => (world.company.deliverables ?? []).filter((d) => d.kind === k).length;
  out.push('', '  Fichiers générés :');
  out.push(`    ${filesDir}`);
  out.push(`    ${plural(kinds('pdf'), 'PDF', 'PDF')} · ${plural(kinds('cover'), 'couverture')} · ${plural(kinds('sales_page'), 'page de vente', 'pages de vente')} · ${plural(kinds('ad_storyboard') + kinds('ad_preview'), 'storyboard/aperçu TikTok', 'storyboards/aperçus TikTok')}`);
  out.push(`  Cerveau de l'agence : ${brainDir}`);
  out.push(`  Run sauvegardé : ${worldFile}`);
  out.push(`  (lance « npm run dev » puis charge le run ${world.runId} dans l'interface pour le revoir)`);
  if (world.mind.mode === 'claude' || world.mind.costEur > 0) {
    out.push(`  Cerveau Claude : ${world.mind.calls} appels · ${fmtEur(world.mind.costEur)} · ${world.mind.fallbacks} replis heuristiques`);
  }
  out.push(bar, '');
  return out.join('\n');
}

// ───────────────────────────── main ─────────────────────────────

async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Erreur : ${err.message}\n\n${CLI_USAGE}`);
      return 1;
    }
    throw err;
  }
  if (args.help) {
    console.log(CLI_USAGE);
    return 0;
  }

  const [{ config, mindModeLabel }, persist, { mountWorld }, { safeFinance }, runtime, core] = await Promise.all([
    import('./api/env.js'),
    import('./api/persist.js'),
    import('./api/session.js'),
    import('./api/snapshot.js'),
    import('./runtime/index.js'),
    import('./core/index.js'),
  ]);

  let world: WorldState;
  const resumed = args.runId !== null && persist.runExists(args.runId);
  if (resumed) {
    const loaded = await persist.loadWorld(args.runId!);
    if (!loaded) {
      console.error(`Erreur : le run ${args.runId} existe mais sa sauvegarde est illisible.`);
      return 1;
    }
    world = loaded;
  } else {
    const base = runtime.defaultScenario();
    const scenario = runtime.defaultScenario({
      name: `Simulation CLI — ${args.days} jours`,
      startingCash: args.budget,
      difficulty: args.difficulty,
      seed: args.seed,
      mindMode: args.mind,
      maxComputeEur: config.maxComputeEur,
      horizonDays: Math.max(base.horizonDays, args.days),
    });
    world = runtime.createWorld(scenario, args.runId ?? persist.newRunId());
  }

  const run = await mountWorld(world, args.mindExplicit || !resumed ? { mindMode: args.mind } : {});
  if (world.status === 'paused') world.status = 'running';

  const s = world.scenario;
  console.log(`\nPixel Agency — simulation sans interface${resumed ? ` (reprise au jour ${world.day})` : ''}`);
  console.log(`Run ${world.runId} · ${s.companyName} · budget ${fmtEur(s.startingCash)} · difficulté ${s.difficulty} · graine ${s.seed} · cerveau : ${mindModeLabel(run.engine.mode)}`);
  console.log(`Dossier : ${run.paths.root}`);
  if (run.engine.mode !== 'claude' && (args.mind === 'claude' || (args.mind === 'auto' && config.apiKey))) {
    console.log('Attention : Claude indisponible (clé ANTHROPIC_API_KEY absente ou refusée) — les agents réfléchissent en mode heuristique.');
  }
  console.log('');

  if (args.verbose) {
    core.onActivity((a) => {
      const who = a.agentId ? world.company.agents.find((x) => x.id === a.agentId)?.name ?? a.agentId : 'Agence';
      console.log(`    [J${a.day} t${a.tick}] ${who} : ${a.text}`);
    });
  }

  const liveFinance = () => safeFinance(world);
  let interrupted = false;
  process.once('SIGINT', () => {
    interrupted = true;
    console.log('\nInterruption : sauvegarde du run…');
    persist.saveWorld(world, { finance: liveFinance }).catch(() => undefined).finally(() => process.exit(130));
  });

  const startDay = world.day;
  let rows = 0;
  if (!args.quiet) console.log(tableHeader());
  const t0 = performance.now();
  await run.company.runDays(args.days, (kpi) => {
    run.syncMind();
    if (kpi.day % 10 === 0) persist.saveWorld(world, { finance: liveFinance }).catch(() => undefined); // checkpoint for long runs
    if (args.quiet) return;
    if (rows > 0 && rows % 30 === 0) console.log(tableHeader());
    console.log(kpiRow(kpi));
    rows++;
  });
  run.syncMind();
  if (interrupted) return 130;
  const seconds = (performance.now() - t0) / 1000;

  if (world.status === 'running') world.status = 'paused';
  const finance = liveFinance();
  const file = await persist.saveWorld(world, { finance });
  const daysRun = Math.min(args.days, Math.max(1, world.day - startDay + (world.tick > 0 ? 1 : 0)));
  console.log(verdict({ world, finance, daysRun, filesDir: run.paths.files, brainDir: run.paths.brain, worldFile: file }));
  console.log(`Simulation terminée en ${fmtNum(seconds, 1)} s.`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      // Let stdout drain before exiting (engines may keep handles open).
      process.stdout.write('', () => process.exit(code));
    },
    (err) => {
      console.error('La simulation a échoué :', err);
      process.exit(1);
    },
  );
}
