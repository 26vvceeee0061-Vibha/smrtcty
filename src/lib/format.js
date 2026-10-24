const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

/**
 * Formats a finite numeric value for display. Missing or invalid values are
 * intentionally rendered as an em dash so they can never look like a shortage.
 */
export function formatMetric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return numberFormatter.format(value);
}

export function formatUnit(value, unit) {
  const formatted = formatMetric(value);
  return formatted === '—' ? formatted : `${formatted} ${unit}`;
}
