// Relative timestamp helper for compact, readable labels.
// Returns { label, title } where title is the full locale string for the tooltip.

/**
 * Parse a date stored by the server.
 *
 * SQLite's `datetime('now')` produces UTC strings like "YYYY-MM-DD HH:MM:SS"
 * (space-separated, no timezone). JS parses space-separated date strings as
 * LOCAL time, which shifted every displayed timestamp by the UTC offset.
 * Normalize that format to an explicit UTC ISO string before parsing.
 */
export function parseDbDate(dateInput) {
  if (typeof dateInput === 'string') {
    const m = dateInput.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
    if (m) {
      return new Date(`${m[1]}T${m[2]}Z`);
    }
  }
  return new Date(dateInput);
}

export function formatRelativeTime(dateInput) {
  const date = parseDbDate(dateInput);
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
