const MICROS_PER_USD = 1_000_000n;
const VIEWS_PER_RPM_UNIT = 1_000n;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

const RPM_DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u;

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive");

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < denominator) return quotient;

  return quotient + (numerator < 0n ? -1n : 1n);
}

export function parseRpmMicros(value: string): bigint {
  const match = RPM_DECIMAL_PATTERN.exec(value);
  if (!match) throw new RangeError("RPM must be a non-negative decimal with at most 6 places");

  const whole = match[1];
  if (whole === undefined) throw new RangeError("RPM is invalid");
  const fraction = (match[2] ?? "").padEnd(6, "0");
  const rpmMicros = BigInt(whole) * MICROS_PER_USD + BigInt(fraction || "0");
  if (rpmMicros > POSTGRES_BIGINT_MAX) {
    throw new RangeError("RPM exceeds the supported storage range");
  }
  return rpmMicros;
}

export function formatRpmMicros(rpmMicros: bigint): string {
  if (rpmMicros < 0n) throw new RangeError("RPM cannot be negative");

  const whole = rpmMicros / MICROS_PER_USD;
  const fraction = (rpmMicros % MICROS_PER_USD).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

export function calculateEstimatedRevenueMicros(viewDelta: bigint, rpmMicros: bigint): bigint {
  if (rpmMicros < 0n) throw new RangeError("RPM cannot be negative");
  return divideRoundHalfAwayFromZero(viewDelta * rpmMicros, VIEWS_PER_RPM_UNIT);
}

export function formatUsdMicros(revenueMicros: bigint): string {
  const absoluteMicros = revenueMicros < 0n ? -revenueMicros : revenueMicros;
  const dollars = absoluteMicros / MICROS_PER_USD;
  const fraction = (absoluteMicros % MICROS_PER_USD)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  const sign = revenueMicros < 0n ? "-" : "";
  return fraction.length === 0
    ? `${sign}${dollars.toString()}`
    : `${sign}${dollars.toString()}.${fraction}`;
}
