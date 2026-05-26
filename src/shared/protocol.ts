import { protocol, net } from 'electron';
import type { ProtocolCallbacks } from './types.ts';
import { RESPONSE_WITHOUT_BODY } from './constants.ts';
import { CookieStore } from './cookie_store.ts';

export class ProtocolHandler {
  private baseUrl: string;
  private callbacks: ProtocolCallbacks;
  private inFlight = new Set<string>();
  private requestIdCounter = 0;
  private webContentsSession: Electron.Session;
  private cookieStore: CookieStore;

  constructor(
    baseUrl: string,
    callbacks: ProtocolCallbacks,
    webContentsSession: Electron.Session,
    cookieStore: CookieStore
  ) {
    this.baseUrl = baseUrl;
    this.callbacks = callbacks;
    this.webContentsSession = webContentsSession;
    this.cookieStore = cookieStore;
  }

  setCallbacks(callbacks: ProtocolCallbacks): void {
    this.callbacks = callbacks;
  }

  loadPersistedCookies(): void {
    this.cookieStore.cleanup();
    const cookies = this.cookieStore.loadAll();
    if (cookies.length === 0) return;

    const promises = cookies.map(async (cookie) => {
      try {
        // Strip leading dot from domain for valid URL construction
        const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        await this.webContentsSession.cookies.set({
          name: cookie.name,
          value: cookie.value,
          url: `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite as
            | 'unspecified'
            | 'no_restriction'
            | 'lax'
            | 'strict'
            | undefined,
          expirationDate: cookie.expirationDate,
        });
      } catch {
        // Silently fail - individual cookie failures shouldn't break startup
      }
    });

    Promise.allSettled(promises).catch(() => {
      // Ignore errors
    });
  }

  register(): void {
    protocol.handle('https', this.handleRequest.bind(this));
    protocol.handle('http', this.handleRequest.bind(this));
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = request.url;
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    // Get cookies from the web contents session and add to request headers
    const cookies = await this.getCookiesForUrl(url);
    if (cookies) {
      headersObj['Cookie'] = cookies;
    }

    if (request.referrer && request.referrer !== 'about:client') {
      headersObj['Referer'] = request.referrer;
    }

    // Prevent infinite recursion
    if (this.inFlight.has(url)) {
      const response = await fetch(url, {
        method: request.method,
        headers: headersObj,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return new Response(RESPONSE_WITHOUT_BODY.has(response.status) ? null : buffer, {
        status: response.status,
        headers: response.headers,
      });
    }

    this.inFlight.add(url);

    try {
      // Forward request using net.fetch which bypasses custom protocol handlers
      const response = await net.fetch(url, {
        method: request.method,
        headers: headersObj,
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      // Callback: request started
      this.callbacks.onRequestStarted({
        id: ++this.requestIdCounter,
        url,
        method: request.method,
        headers: headersObj,
      });

      // Extract Set-Cookie headers and store them in the session
      const setCookieHeader = response.headers.get('Set-Cookie');
      if (setCookieHeader) {
        const cookieStrings = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
        await this.storeCookies(url, cookieStrings);
      }

      // Callback: response completed
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      this.callbacks.onResponseCompleted(
        {
          id: this.requestIdCounter,
          url,
          method: request.method,
          headers: headersObj,
        },
        {
          statusCode: response.status,
          body: buffer,
          headers: responseHeaders,
        }
      );

      // Return original response unchanged
      return new Response(RESPONSE_WITHOUT_BODY.has(response.status) ? null : buffer, {
        status: response.status,
        headers: response.headers,
      });
    } finally {
      this.inFlight.delete(url);
    }
  }

  private async getCookiesForUrl(url: string): Promise<string | null> {
    try {
      const cookies = await this.webContentsSession.cookies.get({ url });
      if (cookies && cookies.length > 0) {
        const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        return cookieString;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async storeCookies(url: string, cookieStrings: string[]): Promise<void> {
    try {
      const urlObj = new URL(url);
      const promises = cookieStrings.map(async (cookieStr) => {
        // Parse the Set-Cookie header value
        const parts = cookieStr.split(';').map((p) => p.trim());
        const [nameValue, ...attributes] = parts;
        const [name, value] = nameValue.split('=');

        if (!name || !value) {
          return;
        }

        // Extract domain from attribute, default to response hostname
        const rawDomain =
          attributes.find((a) => a.toLowerCase().startsWith('domain='))?.split('=')[1] ||
          urlObj.hostname;
        // Strip leading dot for consistent storage and URL construction
        const domain = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;

        // Extract expiration date if present
        const expiresAttr = attributes.find((a) => a.toLowerCase().startsWith('expires='));
        const hasExpiration = !!expiresAttr;
        const expirationDate = hasExpiration
          ? new Date(expiresAttr.split('=')[1]).getTime() / 1000
          : undefined;

        const cookie = {
          name: name,
          value: value,
          url: `${urlObj.protocol}//${domain}`,
          domain: domain,
          // Extract path from attribute or default to /
          path: attributes.find((a) => a.toLowerCase().startsWith('path='))?.split('=')[1] || '/',
          // Session cookie has no expiration date
          session: !hasExpiration,
          // Expiration date in Unix timestamp (seconds)
          expirationDate: expirationDate,
          // Check if secure flag is set
          secure: attributes.some(
            (a) => a.toLowerCase() === 'secure' || urlObj.protocol === 'https:'
          ),
          // Check if httpOnly flag is set
          httpOnly: attributes.some((a) => a.toLowerCase() === 'httponly'),
          // Check SameSite attribute
          sameSite: (() => {
            const raw = attributes
              .find((a) => a.toLowerCase().startsWith('samesite='))
              ?.split('=')[1]
              ?.toLowerCase();
            if (raw === 'none') return 'no_restriction' as const;
            if (raw === 'lax') return 'lax' as const;
            if (raw === 'strict') return 'strict' as const;
            return undefined;
          })(),
        };

        // Set cookie in the web contents session
        await this.webContentsSession.cookies.set(cookie);

        // Persist to SQLite
        this.cookieStore.save({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate,
          session: cookie.session,
        });
      });

      await Promise.all(promises);
    } catch {
      // Silently fail - cookie storage is best-effort
    }
  }
}
