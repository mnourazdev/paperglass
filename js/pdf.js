/**
 * Minimal PDF writer for scanned pages.
 * Embeds JPEG images directly (DCTDecode) — no external dependencies.
 */

const PAPER_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const encoder = new TextEncoder();

function fmt(value) {
  return (Math.round(value * 100) / 100).toString();
}

function pdfDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}${sign}${pad(
    Math.floor(abs / 60)
  )}'${pad(abs % 60)}'`;
}

/**
 * Build a PDF from JPEG pages.
 * @param {Array<{bytes: Uint8Array, width: number, height: number}>} images
 * @param {{paper?: "a4"|"letter"}} options
 * @returns {Blob}
 */
export function buildPdf(images, options = {}) {
  if (!images.length) throw new Error("No pages to export");

  const chunks = [];
  let length = 0;

  function push(data) {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  }

  const totalObjects = 3 + images.length * 3;
  const offsets = new Array(totalObjects + 1).fill(0);

  function beginObject(number) {
    offsets[number] = length;
    push(`${number} 0 obj\n`);
  }

  function endObject() {
    push("endobj\n");
  }

  push("%PDF-1.4\n");

  // 1 — catalog
  beginObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObject();

  // 2 — page tree
  const kids = images.map((_, i) => `${4 + i * 3} 0 R`).join(" ");
  beginObject(2);
  push(`<< /Type /Pages /Count ${images.length} /Kids [${kids}] >>\n`);
  endObject();

  // 3 — document info
  beginObject(3);
  push(
    `<< /Title (Paperglass scan) /Producer (Paperglass) /Creator (Paperglass) /CreationDate (${pdfDate()}) >>\n`
  );
  endObject();

  const basePaper = PAPER_SIZES[options.paper] || PAPER_SIZES.a4;

  images.forEach((image, index) => {
    const pageId = 4 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    const landscape = image.width > image.height;
    const pageWidth = landscape ? basePaper[1] : basePaper[0];
    const pageHeight = landscape ? basePaper[0] : basePaper[1];

    // Fit the scan inside the page, preserving its aspect ratio.
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const offsetX = (pageWidth - drawWidth) / 2;
    const offsetY = (pageHeight - drawHeight) / 2;

    const content = `q\n${fmt(drawWidth)} 0 0 ${fmt(drawHeight)} ${fmt(offsetX)} ${fmt(
      offsetY
    )} cm\n/Im0 Do\nQ\n`;
    const contentBytes = encoder.encode(content);

    // Page
    beginObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(
        pageHeight
      )}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>\n`
    );
    endObject();

    // Content stream
    beginObject(contentId);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push("endstream\n");
    endObject();

    // Image XObject
    beginObject(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate true /Length ${image.bytes.length} >>\nstream\n`
    );
    push(image.bytes);
    push("\nendstream\n");
    endObject();
  });

  const xrefStart = length;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return new Blob(chunks, { type: "application/pdf" });
}
