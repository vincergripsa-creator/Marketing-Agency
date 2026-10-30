/**
 * Service client: infer the real intent from the text (keywords, channel, mood — with a realistic
 * ~10 % error rate on ambiguous messages unless a playbook rule covers them), pick the action the
 * brain policy prescribes, and write an empathetic, concrete, signed French reply.
 */
import type { InboxMessage, MessageIntent, Order, Product, SupportReplyInput } from '../../shared.js';
import type { SupportTone } from '../playbook.js';
import { bare, clean, fit, fmtEur, norm, withArticle, type LocalRng } from '../util.js';

type Rule = [RegExp, number];

const KEYWORDS: Record<MessageIntent, Rule[]> = {
  arnaque: [
    [/\b1 ?m(illion)? de vues|millions? de vues|(gagner|obtenir|acheter|offre|fais|ajoute).{0,25}\d+ ?k (abonnes|followers)|boost(er)? (ton|votre) compte|vues garanties/, 3],
    [/payez|paiement (d'avance|anticipe)|frais de dossier|virement|western union|crypto|bitcoin|usdt|carte (cadeau|pcs|neosurf)|transcash/, 2],
    [/compte (sera|va etre) (suspendu|supprime|desactive|bloque)|verifi(er|ez) (votre|ton) compte|support (officiel )?tiktok|equipe tiktok|meta business|service de securite/, 3],
    [/cliquez (ici|sur ce lien)|bit\.ly|tinyurl|https?:\/\/|lien ci-dessous/, 1.5],
    [/code de verification|mot de passe|identifiants|code sms/, 2.5],
    [/investissement|rendement|doubler (votre|ton) argent/, 2],
  ],
  menace_chargeback: [
    [/chargeback|faire opposition|opposition bancaire|ma banque|litige|contester (le|ce|mon) (paiement|prelevement)|signaler a (ma banque|paypal)/, 3.5],
    [/avocat|porter plainte|dgccrf|60 millions|association de consommateurs/, 1.5],
  ],
  remboursement: [
    [/rembours/, 3],
    [/rend(ez|s)(-moi)? mon argent|recuperer mon argent|annuler (ma|la|cette) commande/, 3],
    [/retractation|14 jours/, 1.5],
  ],
  non_recu: [
    [/(pas|jamais|rien) recu|n'ai (pas|jamais|rien) recu|pas arrive|toujours rien|ou est (mon|le) (pdf|guide|fichier)|pas de (mail|email|e-mail|lien)/, 3],
    [/lien (ne marche|ne fonctionne|expire|casse|mort)|impossible de (telecharger|ouvrir)|telechargement (bloque|impossible)/, 3],
  ],
  bug_paiement: [
    [/(debite|preleve|paye|facture) (deux|2) fois|double (paiement|prelevement|debit)|paiement (refuse|echoue|bloque|en erreur)|carte refusee|erreur (de|au|lors du) paiement|page de paiement|bug .{0,20}paiement/, 3.5],
    [/debite|preleve/, 1],
  ],
  plainte_qualite: [
    [/decu|decevant|deception|\bnul\b|ne sert a rien|rien de nouveau|rien appris|trop court|trop general|generique|banal|chatgpt|ecrit par (une )?ia|copier-coller|des fautes|mal ecrit|pas a la hauteur|arnaque ce (pdf|guide)|du vent/, 2.5],
    [/pas (utile|terrible|clair)|\bbof\b|\bmoyen\b|basique/, 1.5],
  ],
  sur_mesure: [
    [/sur mesure|personnalis|pour mon cas|adapte(r)? (a|pour) (mon|ma|mes)|pourriez-vous (faire|ecrire|creer)|un guide (sur|pour|special)|version (pour|speciale)|coaching|consultation|rendez-vous|appel (video|telephonique)/, 2.5],
  ],
  partenariat: [
    [/partenariat|collaboration|\bcollab\b|influenceu|createur|creatrice|\bugc\b|affiliation|affilie|media ?kit|placement de produit|sponsor/, 2.5],
    [/abonnes|ma communaute/, 1],
  ],
  troll: [
    [/\b(lol|mdr|ptdr|xptdr)\b|🤡|😂|bouffon|clown|cringe|\bratio\b|personne (n'achete|va acheter)|qui achete (ca|ce truc)|\bescrocs?\b|arnaqueurs?|nul a chier|pigeons?\b/, 2.5],
  ],
  compliment: [
    [/merci|genial|\bsuper\b|\btop\b|bravo|incroyable|j'adore|\badore\b|ca marche|ca fonctionne|change (ma|notre) vie|recommande|5 etoiles|parfait|excellent/, 2],
  ],
  question: [
    [/\?/, 1],
    [/comment |est-ce que|combien|\bquel(le)?s?\b|puis-je|peut-on|possible de|format|imprim|kindle|tablette|telephone|fonctionne pour|convient (a|pour)|a partir de quel age|en anglais/, 1.5],
  ],
};

const PRIORITY: MessageIntent[] = ['arnaque', 'menace_chargeback', 'bug_paiement', 'non_recu', 'remboursement', 'plainte_qualite', 'partenariat', 'sur_mesure', 'troll', 'question', 'compliment'];

const LABELS: Record<MessageIntent, RegExp> = {
  non_recu: /non[ _]recu|pas recu|jamais recu/, remboursement: /rembours/, arnaque: /arnaque/, troll: /troll/,
  menace_chargeback: /chargeback|opposition/, plainte_qualite: /plainte|qualite/, sur_mesure: /sur[ _]mesure/,
  partenariat: /partenariat/, question: /question/, compliment: /compliment/, bug_paiement: /paiement/,
};

export interface IntentGuess { intent: MessageIntent; scores: Record<MessageIntent, number>; matched: string[]; ambiguous: boolean }

export function guessIntent(msg: Pick<InboxMessage, 'subject' | 'body' | 'channel' | 'mood'>): IntentGuess {
  const text = norm(`${msg.subject ?? ''} ${msg.body ?? ''}`)
    .replace(/merci (d'avance|par avance|de (me|votre|bien|m')|pour votre (aide|retour|reponse))/g, ' ');
  const scores = Object.fromEntries(PRIORITY.map((i) => [i, 0])) as Record<MessageIntent, number>;
  const matched: string[] = [];
  for (const intent of PRIORITY) {
    for (const [re, w] of KEYWORDS[intent]) {
      const m = re.exec(text);
      if (m) { scores[intent] += w; matched.push(m[0]); }
    }
  }
  if (msg.channel === 'commentaire_tiktok') { scores.troll += scores.troll > 0 ? 1 : 0; scores.question += 0.3; }
  if (msg.channel === 'avis') { scores.plainte_qualite += scores.plainte_qualite > 0 ? 1 : 0; scores.compliment += scores.compliment > 0 ? 0.5 : 0; }
  if (msg.channel === 'dm') { scores.partenariat += scores.partenariat > 0 ? 0.5 : 0; scores.arnaque += scores.arnaque > 0 ? 0.5 : 0; }
  const mood = typeof msg.mood === 'number' ? msg.mood : 0;
  if (mood <= -0.5) { scores.plainte_qualite += scores.plainte_qualite > 0 ? 0.5 : 0; scores.compliment = Math.max(0, scores.compliment - 1.5); }
  if (mood >= 0.5) scores.compliment += 1;
  const ranked = PRIORITY.slice().sort((a, b) => scores[b] - scores[a] || PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const top = ranked[0]!;
  const s1 = scores[top];
  const s2 = scores[ranked[1]!];
  return { intent: s1 > 0 ? top : 'question', scores, matched, ambiguous: s1 < 2 || s1 - s2 < 1 };
}

function covered(rules: readonly string[], g: IntentGuess, alt: MessageIntent): boolean {
  if (rules.length === 0) return false;
  const r = norm(rules.join(' | '));
  if (g.matched.some((m) => m.trim().length >= 4 && r.includes(m.trim()))) return true;
  return LABELS[g.intent].test(r) || LABELS[alt].test(r);
}

const NOT_NAMES = new Set(['merci', 'cordialement', 'bonjour', 'salut', 'bonne', 'bises', 'urgent', 'bonsoir', 'svp', 'vite', 'help', 'lol', 'mdr', 'ptdr', 'bref', 'voila', 'enfin', 'aidez', 'sinon', 'cdt', 'amicalement', 'pdf', 'guide']);

export function extractFirstName(msg: Pick<InboxMessage, 'body' | 'thread'>): string | null {
  const texts = [clean(msg.body), ...(msg.thread ?? []).filter((t) => t.from === 'customer').map((t) => clean(t.text))];
  const ok = (w: string | undefined) => (w && !NOT_NAMES.has(norm(w)) && w.length >= 2 && w.length <= 20 ? w : null);
  for (const t of texts) {
    const m1 = /(?:je m['’]appelle|ici)\s+(\p{Lu}[\p{Ll}-]+)/u.exec(t);
    if (ok(m1?.[1])) return m1![1]!;
    const m2 = /(?:cordialement|bien à vous|merci|bises|belle journée|bonne journée|amicalement)[,!.\s]+(\p{Lu}[\p{Ll}-]+)\.?\s*$/iu.exec(t);
    if (ok(m2?.[1])) return m2![1]!;
    const m3 = /(?:^|[.!?\n—–-]\s*)(\p{Lu}[\p{Ll}-]+)(?:\s+\p{Lu}\.?)?\s*$/u.exec(t);
    if (ok(m3?.[1]) && t.length > m3![1]!.length + 10) return m3![1]!;
  }
  return null;
}

function refundWindow(policy: readonly string[]): number {
  for (const p of policy ?? []) {
    const m = /(?:sous|pendant|dans les)\s+(\d{1,3})\s*(?:j|jours)\b/i.exec(p);
    if (m && /rembours/i.test(p)) return Number(m[1]);
  }
  return 14;
}

interface ReplyCtx { name: string | null; tone: SupportTone; agent: string; brand: string; title: string; price: number | null; product: Product | null; channel: InboxMessage['channel'] }

function hello(c: ReplyCtx): string {
  return c.name ? `Bonjour ${c.name},` : 'Bonjour,';
}

/** « Sophie M. » → « Sophie » (the CRM name wins over a name guessed from the message). */
export function greetingName(customer: { name?: string | null } | null | undefined, msg: Pick<InboxMessage, 'body' | 'thread'>): string | null {
  const first = clean(customer?.name ?? '').split(/\s+/)[0] ?? '';
  const ok = first.length >= 2 && first.length <= 24 && /^\p{Lu}[\p{L}’'-]+$/u.test(first) && !NOT_NAMES.has(norm(first));
  return ok ? first : extractFirstName(msg);
}

function sign(c: ReplyCtx): string {
  return `— ${c.agent}, Service client ${c.brand}`;
}

function compose(c: ReplyCtx, parts: { chaleureux: string[]; concis: string[]; formel: string[] }): string {
  const body = parts[c.tone].filter(Boolean).join(' ');
  return `${hello(c)}\n\n${body}\n\n${sign(c)}`;
}

function answerQuestion(text: string, c: ReplyCtx): string[] {
  const n = norm(text);
  const p = c.product;
  const chapters = p?.content?.chapters?.map((ch) => ch.title).slice(0, 4) ?? [];
  if (/imprim|format|telephone|tablette|kindle|liseuse|ordinateur|ipad/.test(n)) {
    return ['Le guide est un PDF au format A4 : il se lit sans problème sur téléphone, tablette ou ordinateur, et il s’imprime très bien (les checklists sont pensées pour ça).'];
  }
  if (/age|ans\b|mois\b|convient|pour (mon|ma|mes)|adapte/.test(n) && p?.audience) {
    return [`Il a été écrit pour ${withArticle(p.audience)}.`, chapters.length ? `Vous y trouverez notamment : ${chapters.map((t) => `« ${bare(t)} »`).join(', ')}.` : ''];
  }
  if (/combien de temps|duree|long|pages/.test(n)) {
    const words = p?.content?.wordCount ?? 0;
    return [`Il se lit en ${words > 0 ? `${Math.max(10, Math.round(words / 200 / 5) * 5)} minutes environ` : 'une soirée'}, puis le plan s’applique à raison de quelques minutes par jour.`];
  }
  if (/contenu|dedans|chapitre|sommaire|parle de/.test(n) && chapters.length) {
    return [`Au sommaire : ${chapters.map((t) => `« ${bare(t)} »`).join(', ')}, plus un bonus offert et une checklist à la fin de chaque chapitre.`];
  }
  if (/prix|promo|code|reduction|cher/.test(n)) {
    return [c.price ? `Le guide est à ${fmtEur(c.price)}, avec 14 jours pour changer d’avis.` : 'Le prix est indiqué sur la page du guide, avec 14 jours pour changer d’avis.', 'Nous ne faisons pas de code promo en ce moment, mais je vous préviens dès qu’il y en a un.'];
  }
  return [`Bonne question. Le plus simple : dites-moi en une phrase votre situation, et je vous indique le chapitre de « ${c.title} » qui y répond directement.`];
}

export function heuristicSupportReply(
  input: { message: InboxMessage; product: Product | null; order: Order | null; policy: string[]; customer?: { name: string; archetype: string } | null },
  rng: LocalRng,
  opts: { tone: SupportTone; agent: string; brand: string; playbook: string[] },
): SupportReplyInput {
  const msg = input.message;
  const g = guessIntent(msg);
  let intent = g.intent;
  if (g.ambiguous) {
    const ranked = (Object.keys(g.scores) as MessageIntent[]).sort((a, b) => g.scores[b] - g.scores[a]);
    const alt = ranked.find((i) => i !== intent && g.scores[i] > 0) ?? (intent === 'question' ? 'compliment' : 'question');
    if (!covered(opts.playbook, g, alt) && rng.chance(0.1)) intent = alt;
  }
  const product = input.product;
  const order = input.order;
  const c: ReplyCtx = {
    name: greetingName(input.customer, msg), tone: opts.tone, agent: opts.agent, brand: opts.brand,
    title: clean(product?.title) || 'votre guide', price: order?.price ?? product?.price ?? null, product, channel: msg.channel,
  };
  const t = `« ${c.title} »`;
  const days = order ? Math.max(0, (msg.day ?? 0) - order.day) : null;
  const window = refundWindow(input.policy);
  const amount = c.price ? ` de ${fmtEur(c.price)}` : '';

  switch (intent) {
    case 'non_recu':
      return { detectedIntent: intent, action: 'resend_link', text: compose(c, {
        chaleureux: ['Toutes nos excuses : quand on attend une solution, ne pas recevoir le guide est encore plus frustrant.', `Je viens de vous renvoyer le lien de téléchargement de ${t} à l’adresse utilisée pour la commande.`, 'Pensez à jeter un œil aux spams ou à l’onglet « Promotions » ; le lien reste valable 30 jours.', 'Si quoi que ce soit bloque encore, répondez simplement à ce message et je m’en occupe personnellement.'],
        concis: [`Toutes nos excuses pour ce contretemps : je viens de renvoyer le lien de ${t} à votre adresse de commande.`, 'Vérifiez vos spams ; le lien est valable 30 jours.'],
        formel: ['Nous vous prions de nous excuser pour ce désagrément.', `Le lien de téléchargement de ${t} vient de vous être renvoyé à l’adresse associée à votre commande ; il demeure valable 30 jours.`, 'Nous vous invitons à vérifier également votre dossier de courriers indésirables. Nous restons à votre disposition.'],
      }) };
    case 'bug_paiement':
      return { detectedIntent: intent, action: 'resend_link', text: compose(c, {
        chaleureux: ['Toutes mes excuses pour ce souci de paiement, ce n’est vraiment pas l’expérience qu’on veut vous offrir.', `Pour ne pas vous laisser sans accès, je vous renvoie dès maintenant le lien de ${t}.`, 'Si vous voyez deux prélèvements, envoyez-moi simplement une capture : je fais rembourser le doublon dans la journée.'],
        concis: [`Toutes nos excuses pour ce bug : voici à nouveau le lien de ${t}.`, 'En cas de double prélèvement, envoyez-moi une capture et je rembourse le doublon.'],
        formel: ['Nous vous prions de bien vouloir nous excuser pour cet incident de paiement.', `Afin de ne pas retarder votre accès, le lien de ${t} vient de vous être transmis.`, 'Si un double prélèvement apparaît sur votre relevé, une simple capture nous permettra de procéder au remboursement du doublon.'],
      }) };
    case 'remboursement': {
      if (order?.refunded) {
        return { detectedIntent: intent, action: 'none', text: compose(c, {
          chaleureux: [`Bonne nouvelle : le remboursement${amount} a déjà été effectué de notre côté.`, 'Selon votre banque, il apparaît sous 3 à 5 jours ouvrés. Si ce n’est pas le cas d’ici là, écrivez-moi et je relance immédiatement.'],
          concis: [`Le remboursement${amount} est déjà fait ; comptez 3 à 5 jours ouvrés selon votre banque.`],
          formel: [`Le remboursement${amount} a d’ores et déjà été effectué.`, 'Il devrait apparaître sur votre compte sous 3 à 5 jours ouvrés. Nous restons à votre disposition.'],
        }) };
      }
      if (days !== null && days > window) {
        return { detectedIntent: intent, action: 'none', text: compose(c, {
          chaleureux: ['Merci de nous avoir écrit, et je comprends votre déception.', `Votre commande date de ${days} jours : notre garantie couvre les ${window} premiers jours, je ne peux donc pas déclencher de remboursement.`, `En revanche, je veux que ${t} vous serve vraiment : dites-moi ce qui coince, et je vous indique exactement par où reprendre.`],
          concis: [`Votre commande date de ${days} jours, au-delà de notre garantie de ${window} jours : pas de remboursement possible.`, 'Dites-moi ce qui coince, je vous aide à en tirer le meilleur.'],
          formel: [`Votre commande ayant été passée il y a ${days} jours, elle se situe au-delà de notre garantie de ${window} jours, et nous ne sommes malheureusement pas en mesure de procéder à un remboursement.`, 'Nous serions toutefois heureux de vous accompagner dans l’utilisation du guide.'],
        }) };
      }
      return { detectedIntent: intent, action: 'refund', text: compose(c, {
        chaleureux: [`C’est fait : je viens de lancer le remboursement${amount}, sans condition.`, 'Il apparaîtra sous 3 à 5 jours ouvrés selon votre banque.', 'Si vous avez 30 secondes, dites-moi ce qui n’a pas fonctionné pour vous : ça nous aide vraiment à améliorer le guide.'],
        concis: [`Remboursement${amount} lancé ; comptez 3 à 5 jours ouvrés.`, 'Merci de nous dire ce qui n’a pas convenu.'],
        formel: [`Conformément à notre garantie, le remboursement${amount} vient d’être initié.`, 'Il sera visible sous 3 à 5 jours ouvrés. Vos remarques sur le guide seront les bienvenues.'],
      }) };
    }
    case 'menace_chargeback':
      return { detectedIntent: intent, action: 'refund', text: compose(c, {
        chaleureux: ['Je comprends votre agacement, et inutile de passer par votre banque : je viens de lancer moi-même le remboursement intégral' + amount + '.', 'Il arrive sous 3 à 5 jours ouvrés. Toutes nos excuses : l’expérience n’a pas été à la hauteur.'],
        concis: [`Pas besoin de passer par la banque : remboursement intégral${amount} lancé, sous 3 à 5 jours ouvrés.`],
        formel: [`Afin de vous éviter toute démarche auprès de votre banque, nous avons procédé au remboursement intégral${amount}.`, 'Il sera visible sous 3 à 5 jours ouvrés. Nous vous prions d’accepter nos excuses.'],
      }) };
    case 'plainte_qualite': {
      const refund = (msg.mood ?? 0) <= -0.6 || /rembours/.test(norm(msg.body ?? ''));
      return { detectedIntent: intent, action: refund ? 'refund' : 'discount_code', text: compose(c, {
        chaleureux: ['Merci pour ce retour franc : c’est exactement ce qui nous fait progresser, même si ça pique.', refund ? `Je vous rembourse${amount} tout de suite, sans discussion.` : 'Pour me faire pardonner, voici un code de réduction de 50 % sur votre prochain guide : MERCI50.', 'J’ai transmis vos remarques à l’équipe qui prépare la version 2 du guide ; vous la recevrez gratuitement dès qu’elle sort.'],
        concis: ['Merci pour ce retour.', refund ? `Remboursement${amount} lancé.` : 'Voici un code de -50 % sur votre prochain guide : MERCI50.', 'Vos remarques partent à l’équipe pour la version 2.'],
        formel: ['Nous vous remercions pour ce retour, que nous prenons très au sérieux.', refund ? `Nous procédons au remboursement${amount}.` : 'À titre de geste commercial, nous vous offrons le code MERCI50 (-50 % sur votre prochain achat).', 'Vos remarques ont été transmises à l’équipe éditoriale pour la prochaine version du guide.'],
      }) };
    }
    case 'arnaque':
      return { detectedIntent: intent, action: 'block', text: c.tone === 'formel' ? `Nous ne donnons pas suite à ce type de sollicitation.\n\n${sign(c)}` : `Bonjour, nous ne donnons pas suite. Bonne journée.\n\n${sign(c)}` };
    case 'troll':
      return { detectedIntent: intent, action: 'ignore', text: msg.channel === 'commentaire_tiktok' && c.tone !== 'concis' ? 'Merci pour votre passage, belle journée à vous !' : '' };
    case 'sur_mesure':
      return { detectedIntent: intent, action: 'none', text: compose(c, {
        chaleureux: ['Merci pour votre confiance, ça me touche que vous pensiez à nous pour ça.', 'Nous ne faisons pas de guides sur mesure ni d’accompagnement individuel : tout notre temps passe dans des guides très ciblés, que l’on peut garder à un prix accessible.', 'Mais je note précieusement votre idée : c’est souvent comme ça que naissent nos prochains guides. Je vous préviens s’il voit le jour.'],
        concis: ['Merci ! Nous ne faisons pas de sur-mesure, mais je note votre idée pour un prochain guide et je vous préviens s’il sort.'],
        formel: ['Nous vous remercions pour votre demande.', 'Nous ne proposons malheureusement pas de prestations personnalisées. Votre suggestion a toutefois été transmise à notre équipe éditoriale pour nos prochaines publications.'],
      }) };
    case 'partenariat':
      return { detectedIntent: intent, action: 'escalate', text: compose(c, {
        chaleureux: ['Merci pour votre message, ça nous fait plaisir !', 'Je transmets tout de suite votre proposition à notre équipe Partenariats, qui revient vers vous sous 48 h avec nos conditions (nous travaillons surtout à la commission).', 'Pour gagner du temps, vous pouvez déjà répondre avec le lien de votre compte et vos statistiques récentes.'],
        concis: ['Merci ! Je transmets à l’équipe Partenariats, réponse sous 48 h. Envoyez-nous votre lien et vos statistiques récentes.'],
        formel: ['Nous vous remercions pour votre proposition.', 'Elle a été transmise à notre responsable des partenariats, qui reviendra vers vous sous 48 heures.'],
      }) };
    case 'compliment':
      return { detectedIntent: intent, action: 'none', text: compose(c, {
        chaleureux: ['Merci infiniment pour ce message, il a fait la journée de toute l’équipe !', `On est vraiment heureux que ${t} vous aide.`, 'Si vous avez une minute, un petit avis sur la page du guide aide énormément d’autres personnes dans la même situation à se lancer.'],
        concis: ['Merci beaucoup, ça nous fait très plaisir ! Un avis sur la page du guide aiderait d’autres lecteurs.'],
        formel: ['Nous vous remercions chaleureusement pour votre message.', 'Un avis sur la page du guide serait très précieux pour d’autres lecteurs.'],
      }) };
    case 'question':
    default: {
      const ans = answerQuestion(`${msg.subject ?? ''} ${msg.body ?? ''}`, c).filter(Boolean);
      return { detectedIntent: 'question', action: 'none', text: compose(c, {
        chaleureux: ['Merci pour votre question !', ...ans, 'Et si quelque chose reste flou, répondez simplement à ce message.'],
        concis: ans,
        formel: ['Nous vous remercions pour votre message.', ...ans, 'Nous restons à votre disposition pour toute précision.'],
      }) };
    }
  }
}
