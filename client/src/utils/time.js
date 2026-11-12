// Relative timestamp helper for compact, readable labels.
// Returns { label, title } where title is the full locale string for the tooltip.
export function formatRelativeTime(dateInput) {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) {
    return { label: '', title: '' };
  }
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  let label;
  if (seconds < 45) label = 'just now';
  else if (minutes < 60) label = `${minutes}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else if (days < 7) label = `${days}d ago`;
  else label = date.toLocaleDateString();

  return { label, title: date.toLocaleString() };
}
