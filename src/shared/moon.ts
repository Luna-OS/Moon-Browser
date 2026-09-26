/**
 * Today's moon phase for the new tab page — from the mean synodic month,
 * which is accurate to well under a day and plenty for a greeting.
 */

const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const DAY = 86_400_000;

export interface MoonPhaseInfo {
  /** Days since the last new moon. */
  age: number;
  /** Position in the cycle, 0 = new, 0.5 = full. */
  phase: number;
  /** Lit share of the disc, 0 … 1. */
  illumination: number;
  name: string;
  waxing: boolean;
}

export function moonPhase(date: Date): MoonPhaseInfo {
  const days = (date.getTime() - REFERENCE_NEW_MOON) / DAY;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { age, phase, illumination, name: phaseName(phase), waxing: phase < 0.5 };
}

function phaseName(phase: number): string {
  // Each named phase spans an eighth of the cycle, centered on its point.
  const index = Math.round(phase * 8) % 8;
  return [
    "New moon",
    "Waxing crescent",
    "First quarter",
    "Waxing gibbous",
    "Full moon",
    "Waning gibbous",
    "Last quarter",
    "Waning crescent",
  ][index];
}
