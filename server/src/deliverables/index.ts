/**
 * deliverables/ — the REAL files of the agency: illustrated A4 PDF guide, SVG cover,
 * HTML store page and TikTok storyboard (SVG frames + playable HTML preview).
 */
import type { DeliverablesModule } from '../contracts.js';
import { designFor } from './design.js';
import { renderCoverSvg } from './cover.js';
import { renderPdf } from './pdf.js';
import { renderSalesPageHtml } from './salesPage.js';
import { renderAdStoryboard } from './storyboard.js';

export { designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard };

// Compile-time check that this folder implements its contract exactly.
const contract: DeliverablesModule = { designFor, renderCoverSvg, renderPdf, renderSalesPageHtml, renderAdStoryboard };
void contract;
