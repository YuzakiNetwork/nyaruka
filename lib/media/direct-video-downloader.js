import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 3;
export const VIDEO_MIME_TYPE = 'video/mp4';
const MP4_SIGNATURE_OFFSET = 4;
const MP4_SIGNATURE = Buffer.from('ftyp');

const SOCIAL_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com', 'ytimg.com',
  'tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'musical.ly',
  'x.com', 'twitter.com', 't.co', 'twimg.com', 'pscp.tv', 'periscope.tv',
  'instagram.com', 'cdninstagram.com', 'fbcdn.net', 'threads.net',
];

const BLOCKED_IPV4_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([network, prefix]) => [ipv4ToBigInt(network), prefix]);

export class DownloadError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DownloadError';
    this.code = code;
  }
}

function fail(code) {
  throw new DownloadError(code);
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isDomainName(hostname) {
  return hostname.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/i.test(hostname);
}

function isLocalHostname(hostname) {
  return hostname === 'localhost'
    || ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.onion', '.test', '.invalid']
      .some(suffix => hostname.endsWith(suffix));
}

function normalizeAllowedHost(entry) {
  const value = String(entry || '').trim();
  if (!value || /[\s/:?#@*\\]/.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    const hostname = normalizeHostname(url.hostname);
    if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
    if (net.isIP(hostname) || !isDomainName(hostname) || isLocalHostname(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function asAllowedHostSet(value) {
  if (value instanceof Set) {
    return new Set([...value].map(normalizeAllowedHost).filter(Boolean));
  }
  const entries = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(entries.map(normalizeAllowedHost).filter(Boolean));
}

export function parseAllowedHosts(value = process.env.DOWNLOAD_ALLOWED_HOSTS || '') {
  return asAllowedHostSet(value);
}

function isSocialHostname(hostname) {
  return SOCIAL_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

function ipv4ToBigInt(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function matchesCidr(value, network, prefix, bitCount) {
  const mask = ((1n << BigInt(bitCount)) - 1n) ^ ((1n << BigInt(bitCount - prefix)) - 1n);
  return (value & mask) === (network & mask);
}

function isPublicIPv4(address) {
  const value = ipv4ToBigInt(address);
  if (value === null) return false;
  return !BLOCKED_IPV4_CIDRS.some(([network, prefix]) => matchesCidr(value, network, prefix, 32));
}

function ipv6ToBigInt(address) {
  let value = String(address || '').toLowerCase();
  if (!value || value.includes('%')) return null;

  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4Part = value.slice(lastColon + 1);
    const ipv4 = ipv4ToBigInt(ipv4Part);
    if (ipv4 === null) return null;
    const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4 & 0xffffn).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicIPv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null) return false;

  // IPv4-mapped IPv6 addresses inherit the embedded IPv4 address's restrictions.
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = value & 0xffffffffn;
    const embedded = [24n, 16n, 8n, 0n]
      .map(shift => Number((ipv4 >> shift) & 0xffn))
      .join('.');
    return isPublicIPv4(embedded);
  }

  // Allow only global-unicast 2000::/3 and exclude special-use/documentation/tunnel ranges.
  if (!matchesCidr(value, 0x2000n << 112n, 3, 128)) return false;
  const blocked = [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ];
  return !blocked.some(([network, prefix]) => {
    const parsed = ipv6ToBigInt(network);
    return parsed !== null && matchesCidr(value, parsed, prefix, 128);
  });
}

export function isPublicAddress(address) {
  const normalized = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(normalized);
  if (family === 4) return isPublicIPv4(normalized);
  if (family === 6) return isPublicIPv6(normalized);
  return false;
}

function validateUrlHostAndPolicy(url, allowedHosts) {
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) fail('invalid_url');
  if (isSocialHostname(hostname)) fail('unsupported_platform');

  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    fail('invalid_url');
  }

  const family = net.isIP(hostname);
  if (family) {
    if (!isPublicAddress(hostname)) fail('private_address');
    fail('unsupported_host');
  }
  if (!isDomainName(hostname)) fail('unsupported_host');
  if (isLocalHostname(hostname)) fail('private_address');
  if (!allowedHosts.has(hostname)) fail('unsupported_host');
  return url;
}

export function validateDownloadUrl(input, { allowedHosts = parseAllowedHosts() } = {}) {
  if (typeof input !== 'string' || input.length > 4096 || /\s/.test(input)) fail('invalid_url');
  let url;
  try {
    url = new URL(input);
  } catch {
    fail('invalid_url');
  }
  return validateUrlHostAndPolicy(url, asAllowedHostSet(allowedHosts));
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isRedirect(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function parseContentLength(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) fail('invalid_response');
  const length = Number(normalized);
  if (!Number.isSafeInteger(length)) fail('too_large');
  return length;
}

function hasMp4Signature(buffer) {
  return buffer.length >= 12
    && buffer.subarray(MP4_SIGNATURE_OFFSET, MP4_SIGNATURE_OFFSET + MP4_SIGNATURE.length).equals(MP4_SIGNATURE);
}

function awaitWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(new DownloadError('timeout'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DownloadError('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function resolveValidatedAddress(hostname, lookup, signal) {
  let records;
  try {
    records = await awaitWithSignal(lookup(hostname, { all: true, verbatim: true }), signal);
  } catch (error) {
    if (signal.aborted || error?.code === 'ABORT_ERR') fail('timeout');
    fail('network_error');
  }
  if (!Array.isArray(records)) records = records ? [records] : [];
  if (records.length === 0) fail('network_error');

  const normalized = records.map(record => {
    const address = String(record?.address || '');
    const family = net.isIP(address);
    return {
      address,
      family: Number(record?.family) && Number(record.family) !== family ? 0 : family,
    };
  });
  if (normalized.some(record => !record.family || !isPublicAddress(record.address))) fail('private_address');
  return normalized.find(record => record.family === 4) || normalized[0];
}

function requestHttps(url, { address, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const pinnedLookup = (_hostname, _options, callback) => {
      const done = typeof _options === 'function' ? _options : callback;
      done(null, address.address, address.family);
    };
    const request = https.request(url, {
      method: 'GET',
      agent: false,
      family: address.family,
      lookup: pinnedLookup,
      servername: normalizeHostname(url.hostname),
      maxHeaderSize: 16 * 1024,
      signal,
      headers: {
        Accept: 'video/mp4',
        'User-Agent': 'Nyaruka-direct-media/1.0',
      },
    }, resolve);
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => request.destroy(new DownloadError('timeout')));
    request.end();
  });
}

async function removeTempDirectory(directory) {
  if (!directory) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 1) console.warn('[download] Temporary directory cleanup failed');
    }
  }
}

export async function downloadDirectVideo(input, options = {}) {
  const {
    allowedHosts = parseAllowedHosts(),
    maxBytes = MAX_VIDEO_BYTES,
    timeoutMs = DOWNLOAD_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
    tempRoot = os.tmpdir(),
    lookup = (hostname, lookupOptions) => dns.lookup(hostname, lookupOptions),
    requestImpl = requestHttps,
  } = options;
  const hostSet = asAllowedHostSet(allowedHosts);
  let currentUrl = validateDownloadUrl(input, { allowedHosts: hostSet });
  const controller = new AbortController();
  let timedOut = false;
  let tempDirectory;
  let response;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      currentUrl = validateDownloadUrl(currentUrl.href, { allowedHosts: hostSet });
      const hostname = normalizeHostname(currentUrl.hostname);
      const address = await resolveValidatedAddress(hostname, lookup, controller.signal);
      response = await awaitWithSignal(
        requestImpl(currentUrl, { address, signal: controller.signal, timeoutMs }),
        controller.signal,
      );

      if (isRedirect(response?.statusCode)) {
        response.body?.destroy?.();
        const location = headerValue(response.headers, 'location');
        if (!location) fail('invalid_response');
        if (redirectCount === maxRedirects) fail('too_many_redirects');
        try {
          currentUrl = new URL(String(location), currentUrl);
        } catch {
          fail('invalid_response');
        }
        continue;
      }

      if (response?.statusCode !== 200) fail('network_error');
      const contentType = String(headerValue(response.headers, 'content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== VIDEO_MIME_TYPE) fail('wrong_mime');
      const contentLength = parseContentLength(headerValue(response.headers, 'content-length'));
      if (contentLength !== null && contentLength > maxBytes) fail('too_large');
      if (!response.body || typeof response.body.pipe !== 'function') fail('invalid_response');

      tempDirectory = await fs.mkdtemp(path.join(tempRoot, 'nyaruka-download-'));
      await fs.chmod(tempDirectory, 0o700);
      const filePath = path.join(tempDirectory, 'video.mp4');
      let bytesWritten = 0;
      let signature = Buffer.alloc(0);
      const sizeGuard = new Transform({
        transform(chunk, encoding, callback) {
          bytesWritten += chunk.length;
          if (bytesWritten > maxBytes) return callback(new DownloadError('too_large'));
          if (signature.length < 12) {
            signature = Buffer.concat([signature, chunk.subarray(0, 12 - signature.length)]);
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        response.body,
        sizeGuard,
        createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
        { signal: controller.signal },
      );
      if (!hasMp4Signature(signature)) fail('wrong_mime');

      let cleaned = false;
      return {
        filePath,
        fileName: 'video.mp4',
        mimeType: VIDEO_MIME_TYPE,
        size: bytesWritten,
        async cleanup() {
          if (cleaned) return;
          cleaned = true;
          await removeTempDirectory(tempDirectory);
        },
      };
    }
    fail('too_many_redirects');
  } catch (error) {
    response?.body?.destroy?.();
    await removeTempDirectory(tempDirectory);
    if (timedOut || controller.signal.aborted || error?.code === 'ABORT_ERR') fail('timeout');
    if (error instanceof DownloadError) throw error;
    fail('network_error');
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  downloadDirectVideo,
  validateDownloadUrl,
  parseAllowedHosts,
  isPublicAddress,
};
