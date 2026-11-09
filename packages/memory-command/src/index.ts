// Public capture syntax and default bounds, with no framework or transport dependency.
export const memoryLimits = Object.freeze({
  maxEntries: 20,
  maxEntryBytes: 512,
  maxProfileBytes: 4096,
  maxRequestBytes: 1024,
});
export const wordingBytes = (text: string) =>
  new TextEncoder().encode(text).byteLength;

export function parseMemoryCommand(
  request: string,
  limits: { maxEntryBytes: number; maxRequestBytes: number } = memoryLimits,
) {
  if (!/^remember that /i.test(request)) return null;
  const text = request.slice('Remember that '.length).trim();
  return {
    text,
    valid:
      !!text &&
      !/[\uD800-\uDFFF]/u.test(request) &&
      !request.includes('\0') &&
      wordingBytes(request) <= limits.maxRequestBytes &&
      wordingBytes(text) <= limits.maxEntryBytes,
  };
}
