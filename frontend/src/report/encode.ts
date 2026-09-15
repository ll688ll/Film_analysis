/**
 * Binary-to-text encoding for the arrays embedded in a report. Shared by the
 * exporter (in the app) and the viewer (in the report file).
 *
 * Typed arrays are written little-endian through a DataView so the file does
 * not depend on the byte order of whichever machine produced it. gzip goes
 * through the browser's own CompressionStream, so no library is bundled;
 * a browser without it (rare now) still gets a readable, larger file.
 */

import type { EncodedBytes } from "./reportTypes";

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    s += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const blob = new Blob([bytes as unknown as BlobPart]);
  const res = new Response(blob.stream().pipeThrough(transform));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeBytes(bytes: Uint8Array): Promise<EncodedBytes> {
  if (typeof CompressionStream !== "undefined") {
    try {
      const gz = await pipe(bytes, new CompressionStream("gzip"));
      return { encoding: "gzip-base64", data: bytesToBase64(gz) };
    } catch {
      /* fall back to the plain encoding below */
    }
  }
  return { encoding: "base64", data: bytesToBase64(bytes) };
}

export async function decodeBytes(enc: EncodedBytes): Promise<Uint8Array> {
  const raw = base64ToBytes(enc.data);
  if (enc.encoding === "base64") return raw;
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot inflate the embedded dose data (DecompressionStream is missing)."
    );
  }
  return pipe(raw, new DecompressionStream("gzip"));
}

export function uint16ToBytes(arr: Uint16Array): Uint8Array {
  const out = new Uint8Array(arr.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < arr.length; i++) dv.setUint16(i * 2, arr[i], true);
  return out;
}

export function bytesToUint16(bytes: Uint8Array): Uint16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Uint16Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, true);
  return out;
}

export function float32ToBytes(arr: Float32Array): Uint8Array {
  const out = new Uint8Array(arr.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < arr.length; i++) dv.setFloat32(i * 4, arr[i], true);
  return out;
}

export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 4);
  const out = new Float32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}
