import { toMyanmarNumber } from './formatCurrency';

export function formatDate(dateString, lang = 'en') {
  if (!dateString) return '';
  const d = new Date(dateString);
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (lang === 'my') {
    // Convert digits to Myanmar numerals
    return toMyanmarNumber(formatted);
  }

  return formatted;
}
