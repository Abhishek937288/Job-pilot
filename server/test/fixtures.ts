/** Builds a minimal valid one-page PDF. With no lines it mimics an image-only/scanned page. */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = lines.length
    ? `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) '`).join(" ")} ET`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${o.toString().padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Bytes that look like the start of a DOCX zip (enough for magic-byte detection only). */
export function fakeDocxHeader(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26),
    Buffer.from("[Content_Types].xml"),
    Buffer.alloc(10),
    Buffer.from("word/document.xml"),
  ]);
}

export const RESUME_LINES = [
  "Priya Sharma - Senior Backend Engineer",
  "Acme Payments, Senior Software Engineer, 2021 - Present",
  "Built event-driven settlement services in TypeScript and Node.js on PostgreSQL and Kafka.",
  "Led migration of 40 services to Kubernetes on AWS, cutting deploy time by half.",
  "Globex, Software Engineer, 2017 - 2020. REST APIs in Java and Spring Boot with Redis caching.",
  "Education: B.Tech Computer Science, College of Engineering Pune, 2013 - 2017.",
];
