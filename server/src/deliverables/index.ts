/**
 * deliverables/ — the REAL files of the agency: illustrated A4 PDF guide, SVG cover,
 * HTML store page and TikTok storyboard (SVG frames + playable HTML preview).
 */
import type { DeliverablesModule, PdfAudit } from '../contracts.js';
import { designFor } from './design.js';
import { renderCoverSvg } from './cover.js';
import { renderPdf as writePdf } from './pdf.js';
import { renderSalesPageHtml } from './salesPage.js';
import { renderAdCut, renderAdStoryboard } from './storyboard.js';

const blankAudit = (pages: number, bytes: number): PdfAudit => ({
  pages, bytes, degraded: false, textPages: 0, shortPages: 0, fillMean: 0, widows: 0, strandedHeadings: 0, railShare: 0,
  figureKinds: 0, figuresPerChapter: 0, sheets: 0, overflow: 0,
});

/** The file as today, with a blank audit and no previews until the paginated PDF lands. */
const renderPdf: DeliverablesModule['renderPdf'] = async (input) => {
  const { pages, bytes } = await writePdf(input);
  return { pages, bytes, audit: blankAudit(pages, bytes), previews: [] };
};

/** Land with P7.3 (pickArt, coverAudit), P8.2 (visualReport) and P11.2 (renderKit, renderLeadMagnet). Nothing calls them before. */
const notLanded = (): never => { throw new Error('not landed'); };
const pickArt: DeliverablesModule['pickArt'] = notLanded;
const coverAudit: DeliverablesModule['coverAudit'] = notLanded;
const visualReport: DeliverablesModule['visualReport'] = notLanded;
const renderLeadMagnet: DeliverablesModule['renderLeadMagnet'] = notLanded;
const renderKit: DeliverablesModule['renderKit'] = notLanded;

export {
  designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard, renderAdCut,
  pickArt, coverAudit, visualReport, renderLeadMagnet, renderKit,
};

// Compile-time check that this folder implements its contract exactly.
const contract: DeliverablesModule = {
  designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard, renderAdCut,
  pickArt, coverAudit, visualReport, renderLeadMagnet, renderKit,
};
void contract;
