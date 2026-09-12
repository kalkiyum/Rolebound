import { describe, expect, it } from "vitest";
import { nextRun, describeCadence, InvalidCadence } from "./cadence";

/** UTC throughout: a retainer that drifts with the reader's timezone is a bug. */
const at = (iso: string) => new Date(`${iso}Z`);

describe("nextRun", () => {
  it("advances @hourly to the top of the next hour", () => {
    expect(nextRun("@hourly", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-09-10T15:00:00"),
    );
  });

  it("advances @daily to the next midnight", () => {
    expect(nextRun("@daily", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-09-11T00:00:00"),
    );
  });

  it("advances @monthly to the first of the next month", () => {
    expect(nextRun("@monthly", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-10-01T00:00:00"),
    );
  });

  it("takes a five-field cron: 09:00 daily", () => {
    expect(nextRun("0 9 * * *", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-09-11T09:00:00"),
    );
  });

  it("returns the same day when the time has not passed yet", () => {
    expect(nextRun("0 9 * * *", at("2026-09-10T08:00:00"))).toEqual(
      at("2026-09-10T09:00:00"),
    );
  });

  it("takes a day of the month: the 1st at 09:00", () => {
    expect(nextRun("0 9 1 * *", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-10-01T09:00:00"),
    );
  });

  it("rolls a 31st over months that do not have one", () => {
    expect(nextRun("0 0 31 * *", at("2026-02-15T00:00:00"))).toEqual(
      at("2026-03-31T00:00:00"),
    );
  });

  it("takes a day of the week: Mondays at 09:00", () => {
    // 2026-09-10 is a Thursday.
    expect(nextRun("0 9 * * 1", at("2026-09-10T14:37:02"))).toEqual(
      at("2026-09-14T09:00:00"),
    );
  });

  it("never returns the instant it was given", () => {
    expect(nextRun("0 9 * * *", at("2026-09-10T09:00:00"))).toEqual(
      at("2026-09-11T09:00:00"),
    );
  });

  it("refuses a cadence it cannot honour rather than guessing", () => {
    expect(() => nextRun("*/5 * * * *", at("2026-09-10T00:00:00"))).toThrow(
      InvalidCadence,
    );
    expect(() => nextRun("nonsense", at("2026-09-10T00:00:00"))).toThrow(
      InvalidCadence,
    );
  });
});

describe("describeCadence", () => {
  it("says when a schedule runs in words a person reads", () => {
    expect(describeCadence("@monthly")).toBe("on the 1st, monthly");
    expect(describeCadence("0 9 1 * *")).toBe("on the 1st at 09:00, monthly");
    expect(describeCadence("0 9 * * 1")).toBe("every Monday at 09:00");
    expect(describeCadence("0 9 * * *")).toBe("daily at 09:00");
    expect(describeCadence("@hourly")).toBe("hourly");
  });
});
