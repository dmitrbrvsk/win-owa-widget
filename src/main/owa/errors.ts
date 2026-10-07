// Error type and certificate wording, kept free of Electron imports so they can be unit-tested.
import type { CertInfo } from '../../shared/types';

export type OwaErrorKind = 'auth' | 'network' | 'certificate' | 'server' | 'loginHost' | 'other';

export class OwaError extends Error {
  /** For kind 'certificate': the certificate that was rejected. */
  cert?: CertInfo;
  constructor(
    public kind: OwaErrorKind,
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'OwaError';
  }
}

/** Chromium's net error for a certificate, in words a person can act on. */
export function certReason(verificationResult: string, errorCode: number): string {
  const r = verificationResult.replace(/^net::/, '');
  switch (r) {
    case 'ERR_CERT_AUTHORITY_INVALID':
      return 'выдан центром сертификации, которому Windows не доверяет';
    case 'ERR_CERT_COMMON_NAME_INVALID':
      return 'выдан для другого имени сервера';
    case 'ERR_CERT_DATE_INVALID':
      return 'просрочен или ещё не действует (или неверны часы компьютера)';
    case 'ERR_CERT_REVOKED':
      return 'отозван';
    case 'ERR_CERT_WEAK_KEY':
    case 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM':
      return 'использует слабый ключ или алгоритм подписи';
    case 'ERR_CERT_VALIDITY_TOO_LONG':
      return 'выдан на слишком долгий срок';
    default:
      return `не прошёл проверку (${r || errorCode})`;
  }
}
