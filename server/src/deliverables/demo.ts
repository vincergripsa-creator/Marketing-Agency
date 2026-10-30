/**
 * Renders the showcase fixture into runs/_demo so the founder can open real deliverables:
 *   cd server && npx tsx src/deliverables/demo.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { DesignSpec } from '../shared.js';
import { runPaths } from '../core/index.js';
import { designFor, renderAdStoryboard, renderCoverSvg, renderPdf, renderSalesPageHtml } from './index.js';
import { DEMO_BRAND, demoContent, demoCreative, demoProduct, demoSalesPage } from './fixture.js';

const GALLERY: { nicheName: string; category: string; title: string; subtitle: string; audience: string; layout: DesignSpec['coverLayout'] }[] = [
  { nicheName: 'Propreté du chiot', category: 'animaux', title: 'Chiot propre en 21 jours', subtitle: 'La routine minute par minute pour arrêter les pipis dans l’appartement', audience: 'Nouveaux maîtres d’un chiot de 2 à 6 mois en appartement', layout: 'centered' },
  { nicheName: 'Budget freelance', category: 'business/argent', title: 'Fixer ses tarifs de freelance sans se brader', subtitle: 'La méthode en 5 calculs pour passer de 250 € à 450 € la journée', audience: 'Freelances débutants en graphisme et développement web', layout: 'split' },
  { nicheName: 'Course à pied après 40 ans', category: 'santé/forme', title: 'Courir 5 km sans s’arrêter après 40 ans', subtitle: 'Le programme de 8 semaines qui ménage les genoux', audience: 'Femmes de plus de 40 ans qui reprennent le sport', layout: 'badge' },
  { nicheName: 'Révisions du bac de français', category: 'études', title: 'Le commentaire de texte en 4 heures chrono', subtitle: 'La méthode et 12 exemples corrigés pour viser 15/20', audience: 'Lycéens de première qui passent le bac de français', layout: 'minimal' },
  { nicheName: 'Potager sur balcon', category: 'maison/jardin', title: 'Un potager de balcon qui produit vraiment', subtitle: 'Tomates, herbes et salades sur 3 m² — même plein nord', audience: 'Citadins sans jardin qui veulent récolter dès cet été', layout: 'badge' },
  { nicheName: 'Road trip en van', category: 'voyage', title: 'Premier road trip en van : le guide sans galère', subtitle: 'Itinéraire, budget et check-list pour 10 jours sur la côte atlantique', audience: 'Couples qui louent un van pour la première fois', layout: 'centered' },
  { nicheName: 'Organisation de mariage', category: 'mariage', title: 'Organiser son mariage en 6 mois sans exploser le budget', subtitle: 'Le rétroplanning semaine par semaine et les 40 postes de dépense', audience: 'Futurs mariés qui organisent tout eux-mêmes', layout: 'split' },
  { nicheName: 'Sommeil de bébé', category: 'parentalité', title: 'Bébé se réveille toutes les 2 heures', subtitle: 'La méthode douce pour retrouver des nuits de 6 h', audience: 'Parents d’un bébé de 6 à 12 mois', layout: 'minimal' },
];

async function main(): Promise<void> {
  const t0 = performance.now();
  const paths = runPaths('_demo');
  const product = demoProduct;
  const design = product.design ?? designFor({ nicheName: 'Sommeil de bébé', category: 'parentalité', seed: 42 });
  const versionDir = join(paths.files, product.id, `v${product.version}`);
  await mkdir(versionDir, { recursive: true });

  // 1. cover
  const coverSvg = renderCoverSvg({ title: demoContent.title, subtitle: demoContent.subtitle, audience: product.audience, design, brand: DEMO_BRAND });
  const coverFile = join(versionDir, 'cover.svg');
  await writeFile(coverFile, coverSvg, 'utf8');

  // 2. PDF
  const pdfFile = join(versionDir, 'guide.pdf');
  const tPdf = performance.now();
  const pdf = await renderPdf({
    product, content: demoContent, design, brand: DEMO_BRAND, outFile: pdfFile,
    upsell: { title: 'Siestes courtes : le plan pour des siestes d’1 h 30', url: 'https://boutique.pixel-agency.test/siestes-courtes' },
  });
  const pdfMs = performance.now() - tPdf;

  // 3. sales page
  const salesFile = join(versionDir, 'sales-page.html');
  await writeFile(salesFile, renderSalesPageHtml({ product: { ...product, salesPage: demoSalesPage }, salesPage: demoSalesPage, coverSvg, design, brand: DEMO_BRAND }), 'utf8');

  // 4. TikTok storyboard + preview
  const adDir = join(paths.files, product.id, 'ads', demoCreative.id);
  await mkdir(adDir, { recursive: true });
  const ad = renderAdStoryboard({ creative: demoCreative, product, design, brand: DEMO_BRAND });
  await Promise.all(ad.frames.map((svg, k) => writeFile(join(adDir, `frame-${k + 1}.svg`), svg, 'utf8')));
  const previewFile = join(adDir, 'preview.html');
  await writeFile(previewFile, ad.previewHtml, 'utf8');

  // 5. cover gallery: one design per category, the four layouts side by side
  const galleryDir = join(paths.files, '_galerie');
  await mkdir(galleryDir, { recursive: true });
  const cards = GALLERY.map((g, k) => {
    const d = { ...designFor({ nicheName: g.nicheName, category: g.category, seed: 7 + k }), coverLayout: g.layout };
    const svg = renderCoverSvg({ title: g.title, subtitle: g.subtitle, audience: g.audience, design: d, brand: DEMO_BRAND });
    return `<figure><div class="c">${svg}</div><figcaption><strong>${g.category}</strong> · ${d.coverLayout} · ${d.motif}</figcaption></figure>`;
  });
  const galleryFile = join(galleryDir, 'couvertures.html');
  await writeFile(galleryFile, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Galerie de couvertures — Pixel Agency</title>
<style>body{margin:0;padding:28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f4f2ee;color:#1b1b24}h1{margin:0 0 6px}p{margin:0 0 24px;color:#5d6170}
.g{display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}figure{margin:0}.c{border-radius:6px;overflow:hidden;box-shadow:0 14px 30px rgba(0,0,0,.18);line-height:0}.c svg{width:100%;height:auto}
figcaption{font-size:13px;margin-top:10px;color:#5d6170}</style></head><body><h1>Galerie de couvertures</h1><p>Palettes par catégorie, motifs vectoriels et les 4 mises en page (centered, split, badge, minimal).</p><div class="g">${cards.join('')}</div></body></html>`, 'utf8');

  const rel = (f: string) => relative(paths.root, f).replace(/\\/g, '/');
  console.log('Livrables de démo générés dans', paths.root);
  console.log(`  PDF             ${rel(pdfFile)}  — ${pdf.pages} pages, ${(pdf.bytes / 1024).toFixed(0)} Ko, ${pdfMs.toFixed(0)} ms`);
  console.log(`  Couverture      ${rel(coverFile)}  — ${design.coverLayout} · ${design.motif}`);
  console.log(`  Page de vente   ${rel(salesFile)}`);
  console.log(`  Pub TikTok      ${rel(previewFile)}  — ${ad.frames.length} scènes`);
  console.log(`  Galerie         ${rel(galleryFile)}`);
  console.log(`Terminé en ${(performance.now() - t0).toFixed(0)} ms.`);
}

main().catch((err) => {
  console.error('Échec de la démo :', err);
  process.exitCode = 1;
});
