import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.ts";

describe("toCsv", () => {
  it("writes rows with CRLF line endings and no quotes for plain fields", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields that contain commas, quotes or line breaks", () => {
    expect(toCsv([["x, y", 'say "hi"', "two\nlines"]])).toBe('"x, y","say ""hi""","two\nlines"\r\n');
  });

  it("writes empty fields as nothing", () => {
    expect(toCsv([["a", "", "c"]])).toBe("a,,c\r\n");
  });

  it("neutralises spreadsheet formulas by prefixing an apostrophe", () => {
    expect(toCsv([["=1+1", "+cmd", "-5x", "@SUM(A1)", "safe"]])).toBe("'=1+1,'+cmd,'-5x,'@SUM(A1),safe\r\n");
  });

  it("also guards a formula that follows a tab", () => {
    expect(toCsv([["\t=1+1"]])).toBe("'\t=1+1\r\n");
  });

  it("leaves a plain negative number alone", () => {
    expect(toCsv([["-12", "-3.5"]])).toBe("-12,-3.5\r\n");
  });
});

describe("parseCsv", () => {
  it("reads rows with CRLF or LF endings, with or without a final newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('"x, y","say ""hi""","two\nlines"\r\n')).toEqual([["x, y", 'say "hi"', "two\nlines"]]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([["a", "", "c"], ["", "", ""]]);
  });

  it("ignores a byte order mark at the start", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsv(`${bom}title,notes\nx,y`)).toEqual([["title", "notes"], ["x", "y"]]);
  });

  it("drops completely blank lines", () => {
    expect(parseCsv("a\n\n\nb\n")).toEqual([["a"], ["b"]]);
  });

  it("removes the apostrophe the exporter adds before a formula character, and only then", () => {
    expect(parseCsv("'=1+1,'+x,'hello,it's fine")).toEqual([["=1+1", "+x", "'hello", "it's fine"]]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"oops\nb')).toThrow(/quote/i);
  });

  it("round-trips whatever toCsv writes", () => {
    const rows = [
      ["title", "notes"],
      ["=SUM(A1)", 'He said "no", then left'],
      ["multi\nline", ""],
      ["-12", "@mention"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
