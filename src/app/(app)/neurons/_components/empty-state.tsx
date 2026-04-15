interface Props {
  variant: 'no-docs' | 'no-activity' | 'error' | 'paused';
  onRetry?: () => void;
}

export function EmptyState({ variant, onRetry }: Props) {
  const message = {
    'no-docs': 'This brain has no documents yet.',
    'no-activity': 'Waiting for agent activity...',
    'error': "Can't load this brain.",
    'paused': 'Live updates paused. Refresh to retry.',
  }[variant];
  return (
    <div role="status" aria-live="polite" className="neurons-empty">
      <span className="neurons-empty__text">{message}</span>
      {variant === 'error' && onRetry && (
        <button type="button" onClick={onRetry} className="neurons-empty__retry">Retry</button>
      )}
    </div>
  );
}
