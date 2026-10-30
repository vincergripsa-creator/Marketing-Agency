/// <reference types="pdfkit" />
// Minimal typings for svg-to-pdfkit (the package ships none).

declare module 'svg-to-pdfkit' {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    useCSS?: boolean;
    assumePt?: boolean;
    precision?: number;
    fontCallback?: (family: string, bold: boolean, italic: boolean, fontOptions: { fauxItalic: boolean; fauxBold: boolean }) => string;
    imageCallback?: (link: string) => string;
    warningCallback?: (message: string) => void;
    documentCallback?: (file: string) => unknown;
  }
  function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: SVGtoPDFOptions): void;
  export = SVGtoPDF;
}
