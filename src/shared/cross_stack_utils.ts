/**
 * Escape text for cURL command
 */
export function escapeCurl(text: string): string {
  return text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Generate cURL command from network request data
 */
export function generateCurl(method: string, url: string, headers: Record<string, string>): string {
  const headerEntries = Object.entries(headers);
  const headersStr = headerEntries
    .map(([k, v]) => `  -H "${escapeCurl(k)}: ${escapeCurl(v)}"`)
    .join(' \\\n');
  return `curl -X ${method} "${escapeCurl(url)}" \\\n${headersStr}`;
}

/**
 * Check if URL is an m3u8 playlist (handles query params and case)
 */
export function isM3u8(url: string): boolean {
  const urlWithoutParams = url.split('?')[0];
  return urlWithoutParams.toLowerCase().endsWith('.m3u8');
}

/**
 * Generate ffmpeg command from network request data
 */
export function generateFFmpegCommand(url: string, headers: Record<string, string>): string {
  const headersStr = Object.entries(headers)
    .map(([k, v]) => `-headers "${escapeCurl(k)}: ${escapeCurl(v)}"`)
    .join(' ');

  return `ffmpeg -allowed_extensions ALL -protocol_whitelist file,http,https,tcp,tls -extension_picky 0 -readrate 2 -i "${url}" -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 2000 -timeout 300000000 ${headersStr} -acodec copy -bsf:a aac_adtstoasc -vcodec copy out.mp4`;
}
