"use client";

import { useSyncExternalStore } from "react";

const ABSOLUTE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The wall clock, as an external store.
 *
 * Every TimeAgo on the page shares one interval, and the snapshot is bucketed
 * to the minute so repeated reads within a render are identical — a snapshot
 * that changed on every call would re-render forever.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  timer ??= setInterval(() => {
    for (const listener of listeners) listener();
  }, 30_000);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const currentMinute = () => Math.floor(Date.now() / 60_000);
/** 0 means "no browser clock yet" — the server has no reader to measure from. */
const noClock = () => 0;

function relative(at: Date, now: number) {
  const seconds = Math.round((now - at.getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        -Math.round(seconds / size),
        unit,
      );
    }
  }
  return "just now";
}

/**
 * "3 days ago" is how anyone reads an audit trail — but "ago" is measured
 * from the reader's clock, not the server's, so the first paint is the plain
 * UTC timestamp (identical on both sides, no hydration mismatch) and the
 * relative form replaces it once there is a browser to measure against.
 */
export function TimeAgo({ at }: { at: Date }) {
  const minute = useSyncExternalStore(subscribe, currentMinute, noClock);
  const absolute = `${ABSOLUTE.format(at)} UTC`;

  return (
    <time
      dateTime={at.toISOString()}
      title={absolute}
      className="whitespace-nowrap text-muted-foreground"
    >
      {minute === 0 ? absolute : relative(at, minute * 60_000)}
    </time>
  );
}
