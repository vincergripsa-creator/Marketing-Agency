/**
 * Benchmark d'équilibrage du marché virtuel.
 *
 *   cd server && npx tsx scripts/balance.ts [--days 60] [--seeds 1,2,3,7,42] [--difficulties facile,normal,cauchemar]
 *                                           [--budget 500] [--jobs 3] [--keep] [--json fichier.json] [--details]
 *                                           [--team lean|legacy31] [--no-hire] [--no-payroll]
 *
 * Lance des entreprises sans interface (cerveau heuristique, dossiers temporaires supprimés sauf --keep),
 * en parallèle sur quelques processus (--jobs 1 = tout dans ce processus), puis affiche un tableau par run
 * et une synthèse par difficulté. Code de sortie 0 (1 seulement si les options sont invalides).
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LEAN_ORG } from '../src/runtime/org/constants.js';
import type { Difficulty, OrgConfig } from '../src/shared.js';
import {
  aggregate, aggregateLines, applyOverrides, DIFFICULTIES, learningShare, resultRow, runOne, tableHeader, type RunResult, type RunSpec,
} from './balanceLib.js';

interface Args {
  days: number;
  seeds: number[];
  difficulties: Difficulty[];
  budget: number;
  jobs: number;
  keep: boolean;
  json: string | null;
  details: boolean;
  worker: string | null;
  overrides: Record<string, number>;
  /** The team of every run, null to leave the scenario's own. */
  org: OrgConfig | null;
}

const USAGE = `Utilisation : npx tsx scripts/balance.ts [options]
  --days N                 jours simulés par run (défaut 60)
  --seeds 1,2,3,7,42       graines du marché (défaut 1,2,3,7,42)
  --difficulties a,b       facile,normal,cauchemar (défaut : les trois)
  --budget N               trésorerie de départ (défaut 500)
  --jobs N                 processus en parallèle (défaut 3 ; 1 = tout dans ce processus)
  --keep                   garde les runs dans runs/bench-<difficulté>-<graine> (world.json chargeable dans l'UI)
  --json FICHIER           écrit les résultats détaillés (lignes jour par jour comprises)
  --details                affiche les falaises et arrêts de pub détectés
  --team T                 lean ou legacy31 (défaut : l'équipe du scénario, lean)
  --no-hire                l'équipe reste telle quelle (bras de contrôle)
  --no-payroll             les agents ne sont pas payés (bras de contrôle)
  --set CHEMIN=N           remplace une constante de sim/balance.ts pour ce benchmark (répétable),
                           par exemple --set ADS.baseCtr=0.008 --set DIFFICULTY.cauchemar.cpmMultiplier=1.5`;

class ArgError extends Error {}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    days: 60, seeds: [1, 2, 3, 7, 42], difficulties: [...DIFFICULTIES], budget: 500,
    jobs: Math.max(1, Math.min(3, cpus().length - 1)), keep: false, json: null, details: false, worker: null, overrides: {}, org: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    const eq = tok.indexOf('=');
    const key = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
    if (!tok.startsWith('--')) throw new ArgError(`Argument inattendu : « ${tok} ».`);
    if (key === 'keep') { a.keep = true; continue; }
    if (key === 'details') { a.details = true; continue; }
    if (key === 'no-hire') { a.org = { ...(a.org ?? LEAN_ORG), autoHire: false }; continue; }
    if (key === 'no-payroll') { a.org = { ...(a.org ?? LEAN_ORG), payroll: false }; continue; }
    if (key === 'help') throw new ArgError('');
    const value = eq >= 0 ? tok.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new ArgError(`L'option --${key} attend une valeur.`);
    const int = (min: number, max: number) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) throw new ArgError(`--${key} doit être un entier entre ${min} et ${max}.`);
      return n;
    };
    switch (key) {
      case 'days': a.days = int(1, 365); break;
      case 'budget': a.budget = int(10, 1_000_000); break;
      case 'jobs': a.jobs = int(1, 16); break;
      case 'json': a.json = value; break;
      case 'worker': a.worker = value; break;
      case 'team':
        if (value !== 'lean' && value !== 'legacy31') throw new ArgError('--team doit valoir lean ou legacy31.');
        a.org = { ...(a.org ?? LEAN_ORG), team: value };
        break;
      case 'set': {
        const m = /^([A-Za-z_][\w.]*)=(-?\d+(?:\.\d+)?)$/.exec(value);
        if (!m) throw new ArgError('--set attend CHEMIN=nombre, par exemple --set ADS.baseCtr=0.008.');
        a.overrides[m[1]!] = Number(m[2]);
        break;
      }
      case 'seeds': {
        a.seeds = value.split(',').map((s) => Number(s.trim()));
        if (!a.seeds.length || a.seeds.some((n) => !Number.isInteger(n) || n < 0)) throw new ArgError('--seeds : liste d\'entiers séparés par des virgules.');
        break;
      }
      case 'difficulties': {
        const ds = value.split(',').map((s) => s.trim().toLowerCase());
        if (!ds.length || ds.some((d) => !DIFFICULTIES.includes(d as Difficulty))) throw new ArgError('--difficulties : facile, normal et/ou cauchemar.');
        a.difficulties = ds as Difficulty[];
        break;
      }
      default: throw new ArgError(`Option inconnue : --${key}.`);
    }
  }
  return a;
}

const MARK = '@@BALANCE_RESULT@@';

/** Runs one spec in a child process (same tsx loader), returns its result. */
function runInChild(spec: RunSpec): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [...process.execArgv, script, '--worker', JSON.stringify(spec)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { err += b.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      const at = out.lastIndexOf(MARK);
      if (at < 0) { reject(new Error(`run ${spec.difficulty}/${spec.seed} : pas de résultat (code ${code}). ${err.slice(-800)}`)); return; }
      try { resolve(JSON.parse(out.slice(at + MARK.length).trim()) as RunResult); } catch (e) { reject(e); }
    });
  });
}

async function pool(specs: RunSpec[], jobs: number, onDone: (r: RunResult) => void): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < specs.length) {
      const spec = specs[next++]!;
      let r: RunResult;
      try {
        r = jobs > 1 ? await runInChild(spec) : await runOne(spec);
      } catch (e) {
        console.error(`Échec du run ${spec.difficulty} graine ${spec.seed} :`, e instanceof Error ? e.message : e);
        continue;
      }
      results.push(r);
      onDone(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, specs.length) }, worker));
  return results;
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof ArgError) {
      if (e.message) console.error(`Erreur : ${e.message}\n`);
      console.log(USAGE);
      return e.message ? 1 : 0;
    }
    throw e;
  }
  if (args.worker) {
    const spec = JSON.parse(args.worker) as RunSpec;
    const r = await runOne(spec);
    process.stdout.write(`\n${MARK}${JSON.stringify(r)}\n`);
    return 0;
  }

  const specs: RunSpec[] = [];
  const scenario = args.org ? { org: args.org } : undefined;
  for (const difficulty of args.difficulties) for (const seed of args.seeds) specs.push({ difficulty, seed, days: args.days, budget: args.budget, keep: args.keep, overrides: args.overrides, scenario });
  try {
    applyOverrides(args.overrides); // validates the paths before spawning anything
  } catch (e) {
    console.error(`Erreur : ${e instanceof Error ? e.message : String(e)} (voir server/src/sim/balance.ts).`);
    return 1;
  }
  const set = Object.entries(args.overrides).map(([k, v]) => `${k}=${v}`).join(', ');
  if (set) console.log(`\nConstantes remplacées : ${set}`);
  console.log(`\nBenchmark d'équilibrage — ${specs.length} runs de ${args.days} jours, budget ${args.budget} €, objectif 1 000 € de profit (cerveau heuristique, ${args.jobs} processus)\n`);
  const t0 = performance.now();
  let done = 0;
  const results = await pool(specs, args.jobs, (r) => {
    done++;
    console.log(`  [${done}/${specs.length}] ${r.difficulty} graine ${r.seed} : profit ${Math.round(r.profit)} € (${r.seconds} s)`);
  });
  const order = (r: RunResult) => DIFFICULTIES.indexOf(r.difficulty) * 1e6 + args.seeds.indexOf(r.seed);
  results.sort((a, b) => order(a) - order(b));

  console.log(`\n${tableHeader()}`);
  let prev: Difficulty | null = null;
  for (const r of results) {
    if (prev && prev !== r.difficulty) console.log('');
    console.log(resultRow(r));
    prev = r.difficulty;
  }
  console.log('\nArtefacts : F = falaise de profit (> 40 % du pic perdu en < 7 jours), S = plus de 2 jours sans pub avec trésorerie et produit vendable, K = KPI ≠ grand livre, N = NaN.');
  console.log('Effectif : agents le dernier jour. Masse salariale : salaires, embauches et départs sur tout le run. Violations : invariants d\'organisation rompus, doit rester à 0.');
  const half = Math.floor(args.days / 2);
  console.log(`ROAS/CTR 1→2 : jours 1-${half} → jours ${half + 1}-${args.days} (↑ = meilleur en 2e moitié ; ROAS pub brut, « — » sous 20 € de pub ou 2 000 impressions).`);
  console.log('Objectif : 1er jour où le profit cumulé atteint 1 000 €. J>0 : 1er jour où le profit cumulé (frais de démarrage compris) passe au-dessus de 0.\n');
  console.log('Synthèse par difficulté');
  for (const d of args.difficulties) {
    const a = aggregate(results, d);
    if (a) for (const l of aggregateLines(a)) console.log(l);
  }
  const ls = learningShare(results);
  if (ls.runs) {
    const share = (k: number) => `${Math.round((k / ls.runs) * 100)} %`;
    console.log(`\nApprentissage visible (normal + cauchemar, ${ls.runs} run${ls.runs > 1 ? 's' : ''}) : CTR ${share(ls.ctr)} · ROAS ${share(ls.roas)} · les deux ${share(ls.both)} des runs font mieux en 2e moitié.`);
  }
  if (args.details) {
    for (const r of results) {
      for (const c of r.cliffs) console.log(`  falaise ${r.difficulty}/${r.seed} J${c.fromDay}→J${c.toDay} : ${Math.round(c.peak)} € → ${Math.round(c.low)} € (${c.events.join(', ') || 'aucun événement'})`);
      for (const s of r.stalls) console.log(`  arrêt pub ${r.difficulty}/${r.seed} J${s.fromDay}→J${s.toDay} (${s.days} jours)`);
      if (r.dir) console.log(`  run gardé ${r.difficulty}/${r.seed} : ${r.dir}`);
    }
  }
  if (args.json) {
    await writeFile(args.json, JSON.stringify(results, null, 1), 'utf8');
    console.log(`\nRésultats détaillés : ${args.json}`);
  }
  console.log(`\nTerminé en ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s.`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.stdout.write('', () => process.exit(code)),
  (err) => {
    console.error('Le benchmark a échoué :', err);
    process.stdout.write('', () => process.exit(1));
  },
);
