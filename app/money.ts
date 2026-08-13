export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hasCentPrecision(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}
