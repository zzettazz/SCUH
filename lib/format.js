// Formato de dinero. Los importes de RSI vienen siempre en céntimos de USD.
// Si el usuario elige euros, se convierten con el tipo de cambio guardado (aproximado).

let currency = { code: 'USD', rate: 1 };

export function setCurrency(code, rate = 1) {
  currency = code === 'EUR' && Number.isFinite(rate) && rate > 0 ? { code: 'EUR', rate } : { code: 'USD', rate: 1 };
}
export const getCurrency = () => currency;

// Céntimos → "1.234,56 $" (o "≈ 1.136,00 €" si se ha elegido euros)
export function money(cents, symbol = '$') {
  if (cents == null) return '—';
  const eur = currency.code === 'EUR';
  const v = eur ? cents * currency.rate : cents;
  const n = (v / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return eur ? `${n} €` : `${n} ${symbol}`;
}

// taxRate de RSI viene en centésimas de punto: 2100 → "21 %"
export function taxPercent(taxRate) {
  return taxRate == null ? '?' : `${(taxRate / 100).toLocaleString('es-ES')} %`;
}
