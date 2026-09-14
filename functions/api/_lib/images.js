// Structural artwork-image checks for the submission endpoint
// (functions/api/artwork.js). Plain JavaScript so it stays importable from
// Node tests; underscore-prefixed paths inside functions/ are bundled for
// Pages but never exposed as routes.

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const MIN_DIMENSION = 32;
export const MAX_DIMENSION = 8192;
export const MAX_TOTAL_PIXELS = 64_000_000;

function be32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function le24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function le32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function sane(width, height) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= MIN_DIMENSION &&
    height >= MIN_DIMENSION &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_TOTAL_PIXELS
  );
}

function matchesSignature(bytes, signature) {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function readPng(bytes) {
  // PNG: 8-byte signature, then the IHDR chunk: length=13, "IHDR", width, height.
  if (bytes.length < 24) return null;
  if (be32(bytes, 8) !== 13) return null;
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return null;
  const width = be32(bytes, 16);
  const height = be32(bytes, 20);
  if (!sane(width, height)) return null;
  return { format: "png", width, height };
}

function isWebp(bytes) {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  );
}

function readWebp(bytes) {
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourcc === "VP8X") {
    // Extended: 24-bit width-1 / height-1 at the start of the image data.
    if (bytes.length < 30) return null;
    const width = le24(bytes, 24) + 1;
    const height = le24(bytes, 27) + 1;
    return sane(width, height) ? { format: "webp", width, height } : null;
  }
  if (fourcc === "VP8 ") {
    // Lossy: frame tag (3), start code (3), then 14-bit width and height.
    if (bytes.length < 30) return null;
    const width = bytes[26] | ((bytes[27] & 0x3f) << 8);
    const height = bytes[28] | ((bytes[29] & 0x3f) << 8);
    return sane(width, height) ? { format: "webp", width, height } : null;
  }
  if (fourcc === "VP8L") {
    // Lossless: 1 header byte (0x2f), then packed 14-bit width / height.
    if (bytes.length < 25) return null;
    if (bytes[20] !== 0x2f) return null;
    const bits = le32(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return sane(width, height) ? { format: "webp", width, height } : null;
  }
  return null;
}

/** Returns { format, width, height } for a structurally valid PNG or WebP,
    or null when the bytes aren't a supported image (or are nonsense). */
export function parseArtworkImage(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (matchesSignature(bytes, PNG_SIGNATURE)) return readPng(bytes);
  if (isWebp(bytes)) return readWebp(bytes);
  return null;
}