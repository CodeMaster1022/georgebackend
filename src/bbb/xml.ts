import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

export type BbbReturn = {
  returncode?: 'SUCCESS' | 'FAILED' | string;
  messageKey?: string;
  message?: string;
  [k: string]: unknown;
};

export function parseBbbXml(xml: string): BbbReturn {
  const parsed = parser.parse(xml);
  // BBB responses typically wrap in <response>...</response>
  const response = (parsed?.response ?? parsed) as BbbReturn;
  return response ?? {};
}

export function assertBbbSuccess(resp: BbbReturn, context: string, fallbackSnippet?: string): void {
  if (resp.returncode !== 'SUCCESS') {
    const key = resp.messageKey ? ` (${resp.messageKey})` : '';
    const msg = resp.message ? `: ${resp.message}` : '';
    const fb = !msg && fallbackSnippet ? `: ${fallbackSnippet}` : '';
    throw new Error(`BBB ${context} failed${key}${msg}${fb}`);
  }
}

