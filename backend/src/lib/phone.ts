/** Canonical Indian-first phone storage: +91XXXXXXXXXX when 10 digits. */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function canonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = digitsOnly(raw);
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

export function phoneTail(raw: string): string {
  return digitsOnly(raw).slice(-10);
}

export function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

export function maskEmail(email: string): string {
  return email.replace(/^(.).*(@.*)$/, '$1***$2');
}

export function maskPhone(phone: string): string {
  const tail = phoneTail(phone);
  if (tail.length < 4) return '***';
  return `***${tail.slice(-4)}`;
}
