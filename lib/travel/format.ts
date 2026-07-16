export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMmk(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
