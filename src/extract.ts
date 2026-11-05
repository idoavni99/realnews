import { httpGet } from './http.ts';
import { decodeEntities } from './rss.ts';

const PREFIXES = 'והבלמש';

const STOP = new Set(('של את על עם אל מה כי לא הוא היא זה זאת גם או אם כל כך אחרי לפני נגד בין אצל תחת מול יחד אבל רק עוד כבר ' +
  'יהיה היו היה אני אתה הם אנחנו לי לו לה לך לנו מהם אותו אותה אותם יש אין כאן שם הזה הזאת אומר אמר אמרו ' +
  'in the a an of to and for on at by from with as is are was were').split(' '));

export function normTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (let w of text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    w = w.replace(/^[״"׳']+|[״"׳']+$/g, '');
    if (w.length > 3 && w[0] === 'ו') w = w.slice(1);
    if (w.length > 3 && PREFIXES.includes(w[0])) w = w.slice(1);
    if (w.length > 1 && !STOP.has(w.toLowerCase())) out.add(w);
  }
  return out;
}

export type Extraction = 'full' | 'partial' | 'lead_only';

/** Only accept an explicit articleBody, never the page navigation as article text. */
export function extractArticlePage(page: string, title: string): { text: string; status: Extraction } {
  let body = '';
  // Match a complete JSON string, including escaped quotes and backslashes.
  const match = page.match(/"articleBody"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (match) {
    try { body = JSON.parse(match[1]); } catch { /* malformed structured data */ }
  }
  body = decodeEntities(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = normTokens(body.slice(0, 1500));
  const overlap = [...normTokens(title)].filter(t => tokens.has(t)).length;
  if (body.length >= 400 && overlap >= 2) return { text: body, status: 'full' };
  if (body.length >= 200 && overlap >= 1) return { text: body.slice(0, 1500), status: 'partial' };
  return { text: '', status: 'lead_only' };
}

/** Public pages only. When extraction fails, retain the honest RSS lead. */
export async function extractFulltext(url: string, title: string): Promise<{ text: string; status: Extraction }> {
  try { return extractArticlePage(await httpGet(url), title); }
  catch { return { text: '', status: 'lead_only' }; }
}
