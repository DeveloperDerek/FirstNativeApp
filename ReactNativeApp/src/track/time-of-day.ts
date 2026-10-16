// Which light the map is drawn in: day, sunset (also used around
// sunrise) or night, from the phone's clock. The app has no location, so
// sunrise and sunset come from a table for mid-northern latitudes (about
// 38°N, with daylight saving time), interpolated between months.

export type DayPhase = 'day' | 'sunset' | 'night';

// [sunrise, sunset] in local clock hours, on the 15th of each month
const SUN: [number, number][] = [
  [7.3, 17.25], // Jan
  [7.0, 17.8],
  [7.2, 19.2], // Mar (after the clocks change)
  [6.6, 19.6],
  [6.0, 20.05],
  [5.8, 20.5], // Jun
  [6.0, 20.45],
  [6.4, 20.0],
  [6.9, 19.3],
  [7.3, 18.55], // Oct
  [6.9, 17.1], // Nov (after the clocks change)
  [7.25, 16.95],
];

// The golden light starts an hour before sunset and lasts half an hour
// after it; mornings mirror that around sunrise.
const BEFORE_SUNSET = 1;
const AFTER_SUNSET = 0.5;

/** Sunrise and sunset (clock hours) for a date, blended between the months either side. */
export function sunTimes(date: Date): [number, number] {
  const month = date.getMonth();
  const day = date.getDate();
  // Each table row is the 15th; blend toward the neighbor on that side
  const other = day >= 15 ? (month + 1) % 12 : (month + 11) % 12;
  const t = Math.abs(day - 15) / 30;
  const [r0, s0] = SUN[month];
  const [r1, s1] = SUN[other];
  return [r0 + (r1 - r0) * t, s0 + (s1 - s0) * t];
}

export function phaseAt(date: Date): DayPhase {
  const hour = date.getHours() + date.getMinutes() / 60;
  const [sunrise, sunset] = sunTimes(date);
  if (hour < sunrise - AFTER_SUNSET || hour >= sunset + AFTER_SUNSET) return 'night';
  if (hour < sunrise + BEFORE_SUNSET || hour >= sunset - BEFORE_SUNSET) return 'sunset';
  return 'day';
}
