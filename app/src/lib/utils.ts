export { cn } from "cn";

export function formatSnapshotDate(dateStr: string): string {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (match) {
    const year = match[1];
    const month = months[parseInt(match[2], 10) - 1] || match[2];
    const day = parseInt(match[3], 10);
    return `${day} ${month} ${year}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  return dateStr;
}
