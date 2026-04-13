// Minimal relative-time formatter. Good enough for Pre-MVP UI — avoids
// pulling in date-fns just to render "3 days ago" tags on document cards.

export function formatDistance(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  const now = Date.now();
  const ms = now - date.getTime();
  const seconds = Math.round(ms / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 minute ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 45) return `${minutes} minutes ago`;
  if (minutes < 90) return '1 hour ago';

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  if (hours < 42) return 'yesterday';

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} days ago`;
  if (days < 45) return '1 month ago';

  const months = Math.round(days / 30);
  if (months < 12) return `${months} months ago`;

  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
