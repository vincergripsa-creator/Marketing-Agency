/**
 * deliverables/ — the REAL files of the agency: illustrated A4 PDF guide, SVG cover,
 * HTML store page and TikTok storyboard (SVG frames + playable HTML preview).
 */
import type { DeliverablesModule } from '../contracts.js';
import { pickArt, pickComposition } from './art/evaluate.js';
import { designFor } from './design.js';
import { coverAudit, renderCoverSvg } from './cover.js';
import { renderKit, renderLeadMagnet } from './kit.js';
import { compactPaths } from './pathData.js';
import { renderPdf } from './pdf.js';
import { renderSalesPageHtml } from './salesPage.js';
import { renderAdCut, renderAdFiles, renderAdStoryboard } from './storyboard.js';
import { visualReport } from './visualReport.js';

export {
  designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard, renderAdCut, renderAdFiles, compactPaths,
  pickArt, pickComposition, coverAudit, visualReport, renderLeadMagnet, renderKit,
};

// Compile-time check that this folder implements its contract exactly.
const contract: DeliverablesModule = {
  designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard, renderAdCut, renderAdFiles, compactPaths,
  pickArt, pickComposition, coverAudit, visualReport, renderLeadMagnet, renderKit,
};
void contract;
