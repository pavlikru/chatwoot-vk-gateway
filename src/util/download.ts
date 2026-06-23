import type { DownloadedFile } from '../types.js';

/**
 * Download a remote URL into memory, enforcing a size limit.
 * Used for relaying both VK attachments (-> Chatwoot) and Chatwoot
 * attachments (-> VK).
 */
export async function downloadFile(
  url: string,
  maxBytes: number,
  fallbackName = 'file',
): Promise<DownloadedFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);

  const declared = res.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new Error(`file too large: ${declared} > ${maxBytes} bytes`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error(`file too large: ${bytes.byteLength} > ${maxBytes} bytes`);
  }

  const mimeType =
    res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  const filename = filenameFromUrl(url) ?? fallbackName;
  return { filename, mimeType, bytes };
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();
    return last && last.includes('.') ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}
