export function formatCurrency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 'Ks 0.00';
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numberValue);
  return `Ks ${formatted}`;
}
