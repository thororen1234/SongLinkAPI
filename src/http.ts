export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(url: string | URL, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': BROWSER_UA, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} for ${String(url)}`);
  return res;
}

export async function getJson<T = any>(url: string | URL, init?: RequestInit): Promise<T> {
  const res = await request(url, init);
  return (await res.json()) as T;
}

export async function getText(url: string | URL, init?: RequestInit): Promise<string> {
  const res = await request(url, init);
  return res.text();
}

export async function getJsonOrNull<T = any>(url: string | URL, init?: RequestInit): Promise<T | null> {
  try {
    return await getJson<T>(url, init);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export class ClientCredentialsToken {
  #token: string | null = null;
  #expires = 0;
  #pending: Promise<string> | null = null;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;

  constructor(tokenUrl: string, clientId: string, clientSecret: string) {
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async get(): Promise<string> {
    if (this.#token && Date.now() < this.#expires - 60_000) return this.#token;
    this.#pending ??= this.#fetch().finally(() => (this.#pending = null));
    return this.#pending;
  }

  async #fetch(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await request(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.#token = data.access_token;
    this.#expires = Date.now() + data.expires_in * 1000;
    return this.#token;
  }
}
