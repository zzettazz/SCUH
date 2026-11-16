// Euros aproximados. El tipo de cambio lo trae la web (api.frankfurter.app, datos del BCE) o lo escribes tú.

/** Céntimos de USD → céntimos de EUR con un tipo (EUR por 1 USD). */
export function toEuroCents(usdCents, rate) {
  if (usdCents == null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(usdCents * rate);
}

export function formatEuro(cents) {
  if (cents == null) return '—';
  return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Interpreta lo que escribe el usuario: "0,92" o "0.92". null si no es válido. */
export function parseRate(text) {
  const n = Number(String(text ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0.1 && n < 10 ? n : null;
}
