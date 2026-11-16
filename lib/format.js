// Utilidades de formato compartidas por el panel.

// Céntimos → "1.234,56 $"
export function money(cents, symbol = '$') {
  if (cents == null) return '—';
  const n = (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${symbol}`;
}

// taxRate de RSI viene en centésimas de punto: 2100 → "21 %"
export function taxPercent(taxRate) {
  return taxRate == null ? '?' : `${(taxRate / 100).toLocaleString('es-ES')} %`;
}
