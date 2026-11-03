import { httpGet } from './http.ts';

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

/**
 * Extract article full text from a public article page.
 * Validates the body is real article text (not boilerplate): minimum length
 * plus token overlap with the article title. Never touches paywalled content.
 */
export async function extractFulltext(url: string, title: string): Promise<{ text: string; status: Extraction }> {
  let page: string;
  try {
    page = await httpGet(url);
  } catch {
    return { text: '', status: 'lead_only' };
  }
  let body = '';
  const m = page.match(/"articleBody"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (m) {
    try { body = JSON.parse('"' + m[1] + '"'); } catch { body = m[1]; }
    body = body.replace(/\s+/g, ' ').trim();
  }
  if (!body) {
    body = page
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const overlap = [...normTokens(title)].filter((t) => normTokens(body.slice(0, 1500)).has(t)).length;
  if (body.length >= 400 && overlap >= 2) return { text: body.slice(0, 4000), status: 'full' };
  if (body.length >= 200 && overlap >= 1) return { text: body.slice(0, 1500), status: 'partial' };
  return { text: '', status: 'lead_only' };
}
