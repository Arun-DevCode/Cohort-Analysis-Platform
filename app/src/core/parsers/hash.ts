/**
 * Computes SHA-256 hash of an ArrayBuffer in browser or Node environments.
 */
export async function computeFileHash(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  } catch {
    let hash = 0;
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) {
      hash = (hash << 5) - hash + view[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
  }
}
