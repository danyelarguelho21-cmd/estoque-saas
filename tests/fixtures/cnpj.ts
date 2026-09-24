/** Generates a syntactically random but checksum-VALID CNPJ (mod-11), so fixtures pass the
 * real /api/auth/signup validation (see services/app/src/lib/format.ts#isValidCnpj) instead of
 * being rejected as "CNPJ inválido" now that signup enforces the check digits.
 *
 * Shared by every test layer that drives real signup (HTTP integration client + Playwright e2e
 * specs) so the check-digit algorithm lives in exactly one place. */
export function generateValidCnpj(): string {
  const calcCheckDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  let first12: string;
  do {
    first12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
  } while (/^(\d)\1{11}$/.test(first12)); // avoid all-same-digit sequences (rejected by isValidCnpj)

  const digit13 = calcCheckDigit(first12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digit14 = calcCheckDigit(first12 + digit13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first12}${digit13}${digit14}`;
}
