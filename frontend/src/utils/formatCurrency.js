/**
 * Convert a Western/Arabic digit character to a Myanmar (Burmese) digit character.
 */
function toMyanmarDigit(ch) {
  const digits = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'];
  const n = parseInt(ch, 10);
  return isNaN(n) ? ch : digits[n];
}

/**
 * Format a number with commas (thousand separators).
 */
function formatWithCommas(value) {
  const num = Number(value);
  if (isNaN(num)) return '0';
  return Math.round(num).toLocaleString('en-US');
}

/**
 * Format a number as Burmese kyat (Ks) with Myanmar numeral digits.
 * e.g. 12500 -> "၁၂,၅၀၀ Ks"
 */
function formatMyanmarCurrency(value) {
  const formatted = formatWithCommas(value);
  // Convert each digit to Myanmar
  const myanmar = formatted.replace(/[0-9]/g, (ch) => toMyanmarDigit(ch));
  return `${myanmar} Ks`;
}

/**
 * Format currency. Both 'en' and 'my' now use 'Ks' instead of '$'.
 * lang='my' uses Burmese numerals.
 */
export function formatCurrency(value, lang = 'en') {
  if (value == null || isNaN(value)) {
    return lang === 'my' ? '၀ Ks' : '0 Ks';
  }
  if (lang === 'my') {
    return formatMyanmarCurrency(value);
  }
  // English version: "12,500 Ks"
  return `${formatWithCommas(value)} Ks`;
}

/**
 * Convert all digits in a string to Myanmar numerals.
 * Supports numbers, date strings (e.g. "02-12"), time strings, etc.
 */
export function toMyanmarNumber(value) {
  if (value == null) return '၀';
  // Convert to string and replace all digits
  return String(value).replace(/[0-9]/g, (ch) => toMyanmarDigit(ch));
}
