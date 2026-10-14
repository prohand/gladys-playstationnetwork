// -----------------------------------------------------------------------------
// Game icons for the dashboard widget.
//
// The browser never loads a third-party image in a Gladys widget: the content
// declares an image KEY, and the core asks the integration for the bytes
// (`onWidgetGetImage`), at most 300 KB of PNG, JPEG or WebP. The PlayStation
// image server resizes on demand (`?w=`), so the icon is asked small; anything
// still too big is refused here rather than by the core.
// -----------------------------------------------------------------------------

/** The core refuses more than this, decoded. */
export const MAX_IMAGE_BYTES = 300 * 1024;

const RESIZABLE_HOSTS = ['image.api.playstation.com'];

/** The URL to download: resized when the server knows how to. */
export function sizedUrl(raw, width = 320) {
  const url = new URL(raw);
  if (RESIZABLE_HOSTS.includes(url.hostname) && !url.searchParams.has('w')) {
    url.searchParams.set('w', String(width));
  }
  return url.href;
}

/** PNG, JPEG or WebP, by their magic numbers. */
export function isSupportedImage(bytes) {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  return png || jpeg || webp;
}

/**
 * Download an icon and resolve its raw base64, as onWidgetGetImage expects.
 *
 * @param {typeof fetch} fetch
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchWidgetImage(fetch, url) {
  const response = await fetch(sizedUrl(url), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Game icon unavailable (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Game icon too large (${Math.round(bytes.length / 1024)} KB)`);
  }
  if (!isSupportedImage(bytes)) {
    throw new Error('Game icon in an unsupported format');
  }
  return bytes.toString('base64');
}
