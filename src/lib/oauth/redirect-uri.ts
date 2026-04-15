// Parse and validate redirect URIs. URL parsing first, then a strict
// hostname allowlist — regex alone is too easy to fool with userinfo
// or decimal-IP tricks.
//
// Note: Node's WHATWG URL parser normalizes decimal (`2130706433`) and
// hex (`0x7f000001`) IPv4 representations to their dotted form
// (`127.0.0.1`). That means the original (pre-normalized) hostname
// string is lost by the time we look at `url.hostname`. To stay strict
// about what the client actually sent, we pre-screen the raw URL's
// authority for a numeric-only or 0x-prefixed host and reject it
// before URL parsing happens.

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Extract the raw host token from the authority of the input, before
// the URL parser normalizes it. We only need to recognize the
// numeric-IP shapes — anything else will fall through to the URL
// parser + allowlist check below.
function hasNumericIpHost(uri: string): boolean {
  // Match http(s)://[userinfo@]<host>[:port][/...]
  const match = /^https?:\/\/(?:[^/@]*@)?([^/:?#]+)/i.exec(uri);
  if (!match) return false;
  const rawHost = match[1];
  // Pure decimal (e.g. "2130706433") or hex (e.g. "0x7f000001").
  if (/^[0-9]+$/.test(rawHost)) return true;
  if (/^0x[0-9a-f]+$/i.test(rawHost)) return true;
  return false;
}

export function isLocalhostRedirectUri(uri: string): boolean {
  if (!uri) return false;
  if (hasNumericIpHost(uri)) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname === '::1' ? '[::1]' : url.hostname;
  return LOCALHOST_HOSTS.has(host);
}
