import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  ValidationError, parseLocalDate, isValidLocalDate, formatLocalDate, todayLocal,
  addDays, compareLocalDates, isoWeekday, weekStartOf, weekDates
} from "../../public/modules/fitnessPlanner/fitnessPlanner.engine.js";
import { ENGINE_URL } from "./fixtures.mjs";

/**
 * Evaluates `expression` against the engine in a child Node process with an
 * explicit TZ, so results never depend on the machine running the tests.
 */
function inTimeZone(tz, expression) {
  const script = `const e = await import(${JSON.stringify(ENGINE_URL.href)}); console.log(JSON.stringify(${expression}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

describe("parseLocalDate / isValidLocalDate / formatLocalDate", () => {
  it("round-trips valid dates", () => {
    assert.deepEqual(parseLocalDate("2026-10-12"), { year: 2026, month: 10, day: 12 });
    assert.equal(formatLocalDate({ year: 2026, month: 1, day: 5 }), "2026-01-05");
    assert.equal(formatLocalDate({ year: 33, month: 1, day: 5 }), "0033-01-05");
  });

  it("handles month lengths and leap days", () => {
    for (const ok of ["2024-02-29", "2000-02-29", "2026-04-30", "2026-12-31", "2026-01-31"]) {
      assert.equal(isValidLocalDate(ok), true, ok);
    }
    for (const bad of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-06-31", "2026-13-01", "2026-00-10", "2026-01-00", "0000-01-01"]) {
      assert.equal(isValidLocalDate(bad), false, bad);
    }
  });

  it("rejects malformed input", () => {
    for (const bad of ["2026-1-5", "26-01-05", "2026/01/05", "2026-01-05T00:00", " 2026-01-05", "", null, undefined, 20260105, new Date()]) {
      assert.equal(isValidLocalDate(bad), false, String(bad));
      assert.throws(() => parseLocalDate(bad), ValidationError);
    }
    assert.throws(() => formatLocalDate({ year: 2026, month: 2, day: 30 }), ValidationError);
    assert.throws(() => formatLocalDate({ year: 2026, month: "2", day: 1 }), ValidationError);
    assert.throws(() => formatLocalDate(null), ValidationError);
  });
});

describe("todayLocal", () => {
  it("rejects invalid dates", () => {
    for (const bad of [new Date(NaN), "2026-10-12", 0, null, undefined]) {
      assert.throws(() => todayLocal(bad), ValidationError);
    }
  });

  // 2026-10-11T23:30Z is Monday 13:30 next day in Kiritimati (UTC+14),
  // Sunday 23:30 in UTC, and Sunday 16:30 in Los Angeles (UTC-7, PDT).
  const instant = "new Date(Date.UTC(2026, 9, 11, 23, 30))";

  it("uses the local calendar day for a positive UTC offset", () => {
    assert.equal(inTimeZone("Pacific/Kiritimati", `e.todayLocal(${instant})`), "2026-10-12");
  });

  it("uses the local calendar day for UTC", () => {
    assert.equal(inTimeZone("UTC", `e.todayLocal(${instant})`), "2026-10-11");
  });

  it("uses the local calendar day for a negative UTC offset", () => {
    assert.equal(inTimeZone("America/Los_Angeles", `e.todayLocal(${instant})`), "2026-10-11");
    // 00:30 local on 12 Oct in LA is 07:30Z: a UTC-slicing helper would agree here,
    // but 23:30 local on 11 Oct is 06:30Z on 12 Oct, where UTC slicing gives the wrong day.
    assert.equal(inTimeZone("America/Los_Angeles", "e.todayLocal(new Date(Date.UTC(2026, 9, 12, 6, 30)))"), "2026-10-11");
  });

  it("returns the local date just before and just after local midnight", () => {
    const result = inTimeZone("Europe/Lisbon", "[e.todayLocal(new Date(2026, 9, 11, 23, 59, 59)), e.todayLocal(new Date(2026, 9, 12, 0, 0, 0))]");
    assert.deepEqual(result, ["2026-10-11", "2026-10-12"]);
  });

  it("is consistent across a DST change day", () => {
    // 2026-03-08 is the US spring-forward day; 2026-11-01 is fall-back.
    const result = inTimeZone("America/Los_Angeles",
      "[e.todayLocal(new Date(2026, 2, 8, 0, 30)), e.todayLocal(new Date(2026, 2, 8, 23, 30)), e.todayLocal(new Date(2026, 10, 1, 23, 30))]");
    assert.deepEqual(result, ["2026-03-08", "2026-03-08", "2026-11-01"]);
  });
});

describe("addDays", () => {
  it("crosses month, year, and leap boundaries in both directions", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2027-01-01", -1), "2026-12-31");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
    assert.equal(addDays("2024-02-29", 1), "2024-03-01");
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-10-12", 0), "2026-10-12");
    assert.equal(addDays("2026-10-12", 365), "2027-10-12");
    assert.equal(addDays("2024-01-01", 366), "2025-01-01");
  });

  it("does not shift across DST transitions in any time zone", () => {
    for (const tz of ["America/Los_Angeles", "Europe/Lisbon", "Australia/Sydney", "Pacific/Kiritimati", "UTC"]) {
      const result = inTimeZone(tz, "[e.addDays('2026-03-07', 1), e.addDays('2026-03-08', 1), e.addDays('2026-03-29', 1), e.addDays('2026-10-04', 1), e.addDays('2026-10-31', 2), e.weekDates('2026-10-26')]");
      assert.deepEqual(result, ["2026-03-08", "2026-03-09", "2026-03-30", "2026-10-05", "2026-11-02",
        ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]], tz);
    }
  });

  it("rejects invalid dates and non-integer offsets", () => {
    assert.throws(() => addDays("2026-02-30", 1), ValidationError);
    for (const n of [1.5, "1", NaN, null]) assert.throws(() => addDays("2026-10-12", n), ValidationError);
  });
});

describe("compareLocalDates", () => {
  it("orders calendar dates", () => {
    assert.equal(compareLocalDates("2026-10-12", "2026-10-12"), 0);
    assert.equal(compareLocalDates("2026-10-11", "2026-10-12"), -1);
    assert.equal(compareLocalDates("2027-01-01", "2026-12-31"), 1);
    assert.equal(compareLocalDates("2026-09-30", "2026-10-01"), -1);
  });

  it("rejects invalid dates", () => {
    assert.throws(() => compareLocalDates("2026-10-12", "2026-10-32"), ValidationError);
  });
});

describe("isoWeekday / weekStartOf / weekDates", () => {
  it("numbers weekdays 1 = Monday … 7 = Sunday", () => {
    assert.deepEqual(
      ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(isoWeekday),
      [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(isoWeekday("2024-02-29"), 4);
  });

  it("starts weeks on Monday, including the Sunday-to-Monday boundary", () => {
    assert.equal(weekStartOf("2026-10-18"), "2026-10-12"); // Sunday belongs to the preceding Monday
    assert.equal(weekStartOf("2026-10-19"), "2026-10-19"); // Monday starts a new week
    assert.equal(weekStartOf("2026-10-12"), "2026-10-12");
    assert.equal(weekStartOf("2027-01-01"), "2026-12-28"); // across a year boundary
    assert.equal(weekStartOf("2026-03-01"), "2026-02-23"); // across a month boundary
    assert.equal(weekStartOf("2024-03-03"), "2024-02-26"); // week containing a leap day
  });

  it("lists seven consecutive dates from a Monday", () => {
    assert.deepEqual(weekDates("2026-12-28"),
      ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    assert.deepEqual(weekDates("2024-02-26"),
      ["2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02", "2024-03-03"]);
  });

  it("rejects non-Monday week starts and invalid dates", () => {
    assert.throws(() => weekDates("2026-10-13"), ValidationError);
    assert.throws(() => weekDates("2026-10-18"), ValidationError);
    assert.throws(() => weekDates("bad"), ValidationError);
    assert.throws(() => weekStartOf("2026-02-29"), ValidationError);
    assert.throws(() => isoWeekday(""), ValidationError);
  });
});
