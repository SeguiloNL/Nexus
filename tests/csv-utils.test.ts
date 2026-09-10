import { describe, it, expect } from "vitest";
import {
  CSV_UTF8_BOM,
  escapeCsvValue,
  buildCsv,
  sanitizeFilename,
  filenameTimestamp,
} from "@/lib/csv";

describe("@/lib/csv — CSV_UTF8_BOM", () => {
  it("moet precies het Unicode U+FEFF teken zijn (UTF-8 BOM)", () => {
    expect(CSV_UTF8_BOM).toBe("\uFEFF");
    const bytes = Buffer.from(CSV_UTF8_BOM, "utf8");
    expect(bytes).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe("@/lib/csv — escapeCsvValue", () => {
  it("plain string zonder speciale tekens → onveranderd terug", () => {
    expect(escapeCsvValue("abc")).toBe("abc");
    expect(escapeCsvValue("12345")).toBe("12345");
    expect(escapeCsvValue("Klant met spaties")).toBe("Klant met spaties");
  });

  it("string met komma → wrap in quotes", () => {
    expect(escapeCsvValue("A,B,C")).toBe('"A,B,C"');
  });

  it("string met quote → verdubbel de quote + wrap", () => {
    expect(escapeCsvValue('hij zei "hallo"')).toBe(
      '"hij zei ""hallo"""'
    );
  });

  it("string met \\r of \\n → wrap in quotes en bewaar newlines", () => {
    expect(escapeCsvValue("regel1\nregel2")).toBe('"regel1\nregel2"');
    expect(escapeCsvValue("regel1\r\nregel2")).toBe('"regel1\r\nregel2"');
  });

  it("string met comma + quote + newline → alles gecombineerd escapen", () => {
    expect(escapeCsvValue('A, B\nC "D"')).toBe('"A, B\nC ""D"""');
  });

  it("null / undefined → lege string", () => {
    expect(escapeCsvValue(null as any)).toBe("");
    expect(escapeCsvValue(undefined as any)).toBe("");
  });

  it("number / boolean → toString()", () => {
    expect(escapeCsvValue(123)).toBe("123");
    expect(escapeCsvValue(49.29)).toBe("49.29");
    expect(escapeCsvValue(true)).toBe("true");
    expect(escapeCsvValue(false)).toBe("false");
  });

  it("Date → ISO string", () => {
    const d = new Date("2026-09-10T12:00:00.000Z");
    expect(escapeCsvValue(d)).toBe("2026-09-10T12:00:00.000Z");
  });
});

describe("@/lib/csv — buildCsv", () => {
  it("voegt UTF-8 BOM toe aan het begin", () => {
    const csv = buildCsv(["a"], [["1"]]);
    expect(csv.startsWith(CSV_UTF8_BOM)).toBe(true);
  });

  it("header-rij wordt gevolgd door CRLF", () => {
    const csv = buildCsv(["kolomA", "kolomB"], [["1", "2"]]);
    expect(csv.slice(CSV_UTF8_BOM.length).startsWith("kolomA,kolomB\r\n")).toBe(true);
  });

  it("elke data-rij eindigt op CRLF, inclusief laatste rij", () => {
    const csv = buildCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
    expect(csv.endsWith("\r\n")).toBe(true);
    const body = csv.slice(CSV_UTF8_BOM.length + "a,b\r\n".length);
    expect(body).toBe("1,2\r\n3,4\r\n");
  });

  it("empty rows array → allen header + CRLF", () => {
    const csv = buildCsv(["x"], []);
    expect(csv).toBe(CSV_UTF8_BOM + "x\r\n");
  });

  it("cell values worden correct geescaped per rij", () => {
    const csv = buildCsv(
      ["naam", "opmerking"],
      [
        ['Jan, de Vries', 'Hij zei "goedemorgen"'],
        ['Klaas', "regel1\nregel2"],
      ]
    );
    const lines = csv
      .slice(CSV_UTF8_BOM.length)
      .split("\r\n")
      .filter((l) => l.length);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("naam,opmerking");
    expect(lines[1]).toBe(
      '"Jan, de Vries","Hij zei ""goedemorgen"""'
    );
    expect(lines[2]).toBe('Klaas,"regel1\nregel2"');
  });

  it("mixed types in rows: null/number/Date/boolean → juiste stringificatie", () => {
    const csv = buildCsv(
      ["id", "naam", "prijs", "actief", "datum"],
      [
        [1, null, 49.29, true, new Date("2026-09-10T12:00:00.000Z")],
      ]
    );
    const body = csv.slice(CSV_UTF8_BOM.length);
    expect(body).toBe(
      "id,naam,prijs,actief,datum\r\n1,,49.29,true,2026-09-10T12:00:00.000Z\r\n"
    );
  });
});

describe("@/lib/csv — sanitizeFilename", () => {
  it("verwijdert pad-tekens en ongeldige chars", () => {
    expect(sanitizeFilename("a/b\\c:d*e?f\"g<h>i|j.txt")).toBe(
      "abcdefghij.txt"
    );
  });

  it("vervangt whitespace optioneel niet (blijft staan)", () => {
    expect(sanitizeFilename("mijn bestand 123.csv")).toBe(
      "mijn bestand 123.csv"
    );
  });

  it("null/lege string → 'file'", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(null as any)).toBe("file");
  });
});

describe("@/lib/csv — filenameTimestamp", () => {
  it("formaat is YYYYMMDD-HHmm (15 chars)", () => {
    const ts = filenameTimestamp();
    expect(ts).toMatch(/^\d{8}-\d{4}$/);
  });

  it("waarde is consistent met Date.now() — zelfde jaar/maand/dag", () => {
    const before = new Date();
    const ts = filenameTimestamp();
    const after = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const datePart = ts.slice(0, 8);
    const forDate = (d: Date) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    expect([forDate(before), forDate(after)]).toContain(datePart);
  });
});

describe("@/lib/csv — csvDownloadResponse (Response object)", () => {
  it("importeerbaar uit lib/csv", async () => {
    const { csvDownloadResponse } = await import("@/lib/csv");
    expect(typeof csvDownloadResponse).toBe("function");
    const resp = csvDownloadResponse("test.csv", CSV_UTF8_BOM + "a\r\n");
    expect(resp).toBeInstanceOf(Response);
    expect(resp.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(resp.headers.get("Content-Disposition")).toContain(
      "attachment"
    );
    expect(resp.headers.get("Content-Disposition")).toContain("test.csv");
    expect(resp.headers.get("Content-Length")).toBe(
      String(Buffer.byteLength(CSV_UTF8_BOM + "a\r\n", "utf8"))
    );
  });
});
