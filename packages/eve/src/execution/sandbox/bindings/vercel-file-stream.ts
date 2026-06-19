import { Readable } from "node:stream";

/** Converts the provider's file response to Eve's Web stream contract. */
export function normalizeVercelFileStream(stream: unknown): ReadableStream<Uint8Array> | null {
  if (stream === null) {
    return null;
  }
  if (stream instanceof ReadableStream) {
    return stream;
  }
  if (stream instanceof Readable) {
    return Readable.toWeb(stream);
  }
  throw new TypeError("Vercel Sandbox returned an unsupported file stream.");
}
