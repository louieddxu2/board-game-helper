export const MAX_FORMULA_DECIMAL_PLACES = 12;

/** Decimal half-away-from-zero rounding, applied only to the final result. */
export const roundWorkspaceFormulaValue = (value: number, decimalPlaces?: number): number => {
  if (decimalPlaces === undefined) return value;
  const [mantissa, exponent = '0'] = Math.abs(value).toString().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const digits = integer + fraction;
  const keptLength = integer.length + Number(exponent) + decimalPlaces;
  if (keptLength >= digits.length) return value === 0 ? 0 : value;
  if (keptLength < 0) return 0;
  let rounded = BigInt(digits.slice(0, keptLength) || '0');
  if (digits[keptLength] >= '5') rounded += 1n;
  const result = Number(`${rounded}e-${decimalPlaces}`);
  return result === 0 ? 0 : value < 0 ? -result : result;
};
