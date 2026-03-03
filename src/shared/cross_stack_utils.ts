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
