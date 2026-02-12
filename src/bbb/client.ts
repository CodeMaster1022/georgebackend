import { sha1Hex } from "../utils/crypto";
import { buildQuery, type QueryValue } from "./query";
import { assertBbbSuccess, parseBbbXml, type BbbReturn } from "./xml";

export class BbbClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string
  ) {}

  buildSignedUrl(method: string, params: Record<string, QueryValue>): string {
    const queryString = buildQuery(params);
    const checksum = sha1Hex(`${method}${queryString}${this.sharedSecret}`);
    const qs = queryString.length > 0 ? `${queryString}&checksum=${checksum}` : `checksum=${checksum}`;
    return `${this.baseUrl}/api/${method}?${qs}`;
  }

  async callXml(method: string, params: Record<string, QueryValue>, context?: string): Promise<BbbReturn> {
    const url = this.buildSignedUrl(method, params);

    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'accept': 'application/xml,text/xml;q=0.9,*/*;q=0.1'
      }
    });

    const text = await res.text();
    const snippet = text.replace(/\s+/g, ' ').slice(0, 280);

    if (!res.ok) {
      throw new Error(`BBB ${context ?? method} http_error ${res.status}: ${snippet}`);
    }

    const parsed = parseBbbXml(text);

    // Some BBB errors return 200 with FAILED; keep consistent.
    assertBbbSuccess(parsed, context ?? method, snippet);
    return parsed;
  }
}

