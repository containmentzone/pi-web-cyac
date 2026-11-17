export function pad(n: number, width = 2): string {
  return String(Math.trunc(n)).padStart(width, "0");
}

export function clock(ts?: number | string): string | undefined {
  if (ts === undefined) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "NOW";
  if (s < 3600) return `${pad(s / 60)}M`;
  if (s < 86400) return `${pad(s / 3600)}H`;
  return `${pad(s / 86400)}D`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function seconds(ms?: number): string | undefined {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${Math.round(ms)}MS` : `${(ms / 1000).toFixed(1)}S`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function tildify(path: string, home?: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
