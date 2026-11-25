// Builds sample chapter files from the demo pages, for trying "Open a page or
// chapter" and for tests: a PDF, a CBZ and a fixed-layout EPUB.
//   node scripts/make-samples.mjs   -> web/samples/
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const data = (ch, n) => readFileSync(`bench/data/${ch}/p${n}.png`);
const PAGES = [1, 2, 3, 4, 5];
mkdirSync("web/samples", { recursive: true });

// PDF: Japanese chapter, one page per image.
{
  const doc = await PDFDocument.create();
  for (const n of PAGES) {
    const img = await doc.embedPng(data("ja_school", n));
    const page = doc.addPage([img.width / 2, img.height / 2]); // 500x750 pt
    page.drawImage(img, { x: 0, y: 0, width: img.width / 2, height: img.height / 2 });
  }
  writeFileSync("web/samples/sakuragaoka-kendo-ch1.pdf", await doc.save());
}

// CBZ: Korean chapter. Names that sort wrong as plain text check natural order.
{
  const files = {};
  for (const n of PAGES) files[`Episode 1/page ${n * 5}.png`] = [data("ko_office", n), { level: 0 }];
  writeFileSync("web/samples/monday-team-lead-ep1.cbz", zipSync(files));
}

// EPUB: Chinese chapter, fixed layout, spine order differs from file names.
{
  const order = [1, 2, 3, 4, 5];
  const files = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">mangit-lens-sample-qingyun</dc:identifier>
    <dc:title>青云宗 第一章</dc:title><dc:language>zh</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    ${order.map((n) => `<item id="x${n}" href="text/page-${String.fromCharCode(96 + n)}.xhtml" media-type="application/xhtml+xml"/>
    <item id="i${n}" href="images/img${6 - n}.png" media-type="image/png"/>`).join("\n    ")}
  </manifest>
  <spine page-progression-direction="rtl">${order.map((n) => `<itemref idref="x${n}"/>`).join("")}</spine>
</package>`),
  };
  for (const n of order) {
    files[`OEBPS/text/page-${String.fromCharCode(96 + n)}.xhtml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${n}</title>
<meta name="viewport" content="width=1000, height=1500"/></head>
<body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 1500"><image width="1000" height="1500" xlink:href="../images/img${6 - n}.png"/></svg></body></html>`);
    // File names run backwards (img5 is page 1), so only the spine gives the right order.
    files[`OEBPS/images/img${6 - n}.png`] = [data("zh_sect", n), { level: 0 }];
  }
  writeFileSync("web/samples/qingyun-sect-ch1.epub", zipSync(files));
}
console.log("web/samples: PDF, CBZ, EPUB written");
