export const CSV_UTF8_BOM = "\uFEFF";

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "string") {
    s = value;
  } else {
    s = String(value);
  }
  const needsQuote = /[",\n\r]/.test(s);
  if (!needsQuote) return s;
  return `"${s.replaceAll('"', '""')}"`;
}

export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(","));
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(","));
  }
  return CSV_UTF8_BOM + lines.join("\r\n") + "\r\n";
}

export function sanitizeFilename(name: string): string {
  if (!name) return "file";
  const stripped = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "");
  const trimmed = stripped.replace(/\.+$/, "").trim();
  return trimmed || "file";
}

export function filenameTimestamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}${m}${day}-${hh}${mm}`;
}

/**
 * Next.js Server Action response: download een CSV bestand.
 * Gebruikt een Response met Content-Disposition attachment.
 */
export function csvDownloadResponse(
  filename: string,
  contents: string
): Response {
  const safeName = sanitizeFilename(filename);
  return new Response(contents, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(new Blob([contents]).size),
    },
  });
}
