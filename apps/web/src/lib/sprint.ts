const KEY = 'sprintStart';
const LEGACY_DEFAULT = '2026-04-20';

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getSprintStart(): string {
  if (typeof window === 'undefined') return todayISO();
  const v = localStorage.getItem(KEY);
  if (v === null || v === LEGACY_DEFAULT) {
    // Stale legacy default — drop it so today() takes over.
    if (v === LEGACY_DEFAULT) localStorage.removeItem(KEY);
    return todayISO();
  }
  return v;
}

export function setSprintStart(date: string): void {
  localStorage.setItem(KEY, date);
}

export function computeDayLabel(sprintStart: string, day: number): string {
  const d = new Date(sprintStart + 'T00:00:00');
  d.setDate(d.getDate() + day - 1);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
