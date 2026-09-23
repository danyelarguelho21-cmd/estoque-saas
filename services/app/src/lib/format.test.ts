import { describe, expect, it } from "vitest";
import { daysUntil, formatCentsToBRL, formatDateBR } from "./format";

describe("formatCentsToBRL", () => {
  it("formats cents as BRL currency", () => {
    expect(formatCentsToBRL(2990)).toContain("29,90");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatCentsToBRL(null)).toBe("—");
    expect(formatCentsToBRL(undefined)).toBe("—");
  });
});

describe("formatDateBR", () => {
  it("formats an ISO date string as pt-BR", () => {
    expect(formatDateBR("2026-12-25")).toMatch(/25\/12\/2026|24\/12\/2026/);
  });

  it("returns an em dash for invalid input", () => {
    expect(formatDateBR("not-a-date")).toBe("—");
    expect(formatDateBR(null)).toBe("—");
  });
});

// daysUntil's own contract (see format.ts doc comment) is LOCAL-calendar-day arithmetic — it
// deliberately builds `target`/`today` via `new Date(year, month-1, day)`/`setHours(0,0,0,0)`,
// never by parsing a UTC ISO string, specifically so a YYYY-MM-DD date is treated as a local
// calendar day. `.toISOString()` returns the UTC date, which is a DIFFERENT calendar day from the
// local one whenever the host is west of UTC and the current local time is late enough in the day
// (e.g. any time from ~21:00 in a UTC-3 timezone onward) — that mismatch, not a bug in daysUntil,
// is what made this fixture flip to "1" instead of "0" depending on what time of day the suite
// runs. Build the fixture from LOCAL date components instead, matching daysUntil's own contract.
function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("daysUntil", () => {
  it("returns 0 for today", () => {
    expect(daysUntil(localDateString(new Date()))).toBe(0);
  });

  it("returns a positive number for a future date", () => {
    const future = localDateString(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    expect(daysUntil(future)).toBeGreaterThanOrEqual(9);
  });
});
