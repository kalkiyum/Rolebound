/**
 * When a schedule runs next.
 *
 * Deliberately a *subset* of cron, not an implementation of it: minute,
 * hour, day-of-month and day-of-week as literal numbers or `*`, plus the
 * three `@` shorthands. Steps, ranges and lists are refused rather than
 * mis-parsed, because a retainer that silently runs on the wrong day is
 * worse than one that refuses to be created. Widen the grammar the day a
 * schedule needs it, and add the test first.
 *
 * Everything is UTC. A monthly retainer that moves by an hour twice a year
 * because the server observes daylight saving is a support ticket nobody
 * wants to read.
 */

export class InvalidCadence extends Error {
  constructor(cadence: string) {
    super(
      `Cannot read the cadence "${cadence}". Use @hourly, @daily, @weekly, ` +
        `@monthly, or five cron fields with plain numbers — "0 9 1 * *".`,
    );
    this.name = "InvalidCadence";
  }
}

const SHORTHAND: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

interface Fields {
  minute: number;
  /** `null` is `*`: every hour. */
  hour: number | null;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
}

function parse(cadence: string): Fields {
  const raw = SHORTHAND[cadence.trim()] ?? cadence.trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) throw new InvalidCadence(cadence);

  const [minute, hour, dom, month, dow] = parts;
  // Month is accepted only as `*`: a yearly retainer has never come up, and
  // pretending to support one would mean testing one.
  if (month !== "*") throw new InvalidCadence(cadence);

  const num = (field: string, max: number): number => {
    if (!/^\d+$/.test(field)) throw new InvalidCadence(cadence);
    const n = Number(field);
    if (n > max) throw new InvalidCadence(cadence);
    return n;
  };
  const numOrAny = (field: string, max: number, min = 0): number | null => {
    if (field === "*") return null;
    const n = num(field, max);
    if (n < min) throw new InvalidCadence(cadence);
    return n;
  };

  const fields: Fields = {
    minute: num(minute, 59),
    hour: numOrAny(hour, 23),
    dayOfMonth: numOrAny(dom, 31, 1),
    dayOfWeek: numOrAny(dow, 6),
  };

  // Both constrained at once means two different answers to "when next?".
  // cron resolves it with an or; we refuse, because nobody agrees on it.
  if (fields.dayOfMonth !== null && fields.dayOfWeek !== null) {
    throw new InvalidCadence(cadence);
  }
  return fields;
}

/**
 * The next occurrence strictly after `from` — never `from` itself, so a
 * sweep that runs exactly on time cannot re-run the same payment forever.
 */
export function nextRun(cadence: string, from: Date): Date {
  const f = parse(cadence);

  // Walk forward a day at a time from the candidate's own date. At most a
  // month of iterations, and it sidesteps every month-length special case.
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      f.hour ?? from.getUTCHours(),
      f.minute,
      0,
      0,
    ),
  );

  // An unpinned hour needs hourly steps; a pinned one only ever matches once
  // a day, so stepping by the day keeps the loop short.
  const step = () =>
    f.hour === null
      ? candidate.setUTCHours(candidate.getUTCHours() + 1)
      : candidate.setUTCDate(candidate.getUTCDate() + 1);

  for (let i = 0; i < 400; i++) {
    if (
      candidate.getTime() > from.getTime() &&
      (f.dayOfMonth === null || candidate.getUTCDate() === f.dayOfMonth) &&
      (f.dayOfWeek === null || candidate.getUTCDay() === f.dayOfWeek)
    ) {
      return candidate;
    }
    step();
  }
  /* c8 ignore next */
  throw new InvalidCadence(cadence);
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** For screens: the cadence as someone would say it out loud. */
export function describeCadence(cadence: string): string {
  const f = parse(cadence);
  if (f.hour === null) return f.minute === 0 ? "hourly" : `hourly at :${String(f.minute).padStart(2, "0")}`;
  const time = `${String(f.hour).padStart(2, "0")}:${String(f.minute).padStart(2, "0")}`;

  if (f.dayOfMonth !== null) {
    return time === "00:00"
      ? `on the ${ordinal(f.dayOfMonth)}, monthly`
      : `on the ${ordinal(f.dayOfMonth)} at ${time}, monthly`;
  }
  if (f.dayOfWeek !== null) return `every ${DAYS[f.dayOfWeek]} at ${time}`;
  return `daily at ${time}`;
}
