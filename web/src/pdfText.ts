// Client-side PDF text extraction (pdf.js) — the always-available path for the
// Glove's résumé upload. Runs entirely in the browser: no AI, no server, works
// in the container where the Claude CLI doesn't exist. Deterministic
// transcription with line/paragraph heuristics; the user reviews the result in
// the editor before anything is saved.
//
// pdfjs-dist is loaded lazily (dynamic import) so it lands in its own chunk
// and costs nothing until the first upload.

interface TextItemLike {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

/** Extract readable text from a PDF file. Throws on encrypted/image-only PDFs. */
export async function extractPdfTextInBrowser(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items as TextItemLike[];

      // Rebuild lines from positioned glyph runs: a new line when the baseline
      // (transform[5]) moves; a paragraph break when it moves far.
      let out = '';
      let lastY: number | null = null;
      for (const it of items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          out += Math.abs(y - lastY) > 14 ? '\n\n' : '\n';
        } else if (out && !out.endsWith('\n') && !out.endsWith(' ') && it.str && !it.str.startsWith(' ')) {
          out += ' ';
        }
        out += it.str;
        if (it.hasEOL) out += '\n';
        lastY = y;
      }
      pages.push(out.trim());
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = pages
    .filter(Boolean)
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    throw new Error(
      'no selectable text in this PDF (it may be a scan) — paste your résumé as text instead',
    );
  }
  return text;
}
