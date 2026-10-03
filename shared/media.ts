/** Content URLs must never load credentials, local services, or executable schemes. */
export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || /\.(local|localhost|internal)$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
    if (/^\d+(?:\.\d+){3}$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      if (a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19))) return false;
    }
    return true;
  } catch { return false; }
}

export function locationMapUrl(location: {address?: string; latitude?: number; longitude?: number}): string | undefined {
  const {latitude,longitude,address} = location;
  const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude!)<=90 && Math.abs(longitude!)<=180;
  const query = coordinates ? `${latitude},${longitude}` : address?.trim();
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : undefined;
}
