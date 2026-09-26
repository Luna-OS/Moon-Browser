export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday" or a date, for grouping history by day. */
export function dayLabel(time: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(time).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: new Date(time).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}

export function timeLabel(time: number): string {
  return new Date(time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Groups items (already sorted newest first) by their day. */
export function groupByDay<T>(items: readonly T[], timeOf: (item: T) => number, now: number) {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(timeOf(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

/** "just now", "5 min ago", "3 h ago", "4 days ago". */
export function timeAgo(time: number, now = Date.now()): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
