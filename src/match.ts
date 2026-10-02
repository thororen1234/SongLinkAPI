import type { SearchTarget } from './types.ts';

export interface Candidate<T> {
  title: string;
  artistName: string;
  durationMs?: number;
  item: T;
  bonus?: number;
}

const NOISE_RE =
  /official|lyric|audio|visuali[sz]er|video|\bhd\b|\bhq\b|\b4k\b|remaster|explicit|clean|\bmv\b|\bm\/v\b|\bfull\b|\bsingle\b|\bdeluxe\b/i;
const FEAT_RE = /^(feat\.?|ft\.?|featuring|with|prod\.?|produced by)\s/i;

const VERSION_MARKERS = [
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'sped up',
  'slowed',
  'radio edit',
  'extended',
  'demo',
  'reprise',
  'acapella',
  'a cappella',
  'nightcore',
  'reverb',
  'unplugged',
  'orchestral',
  'piano version',
  'mashup',
  'tribute',
];

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function clean(s: string): string {
  return s
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(raw: string): string {
  let s = fold(raw);
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (_, inner: string) =>
    FEAT_RE.test(inner.trim()) || NOISE_RE.test(inner) ? ' ' : ` ${inner} `,
  );
  s = s.replace(/\s[-–—]\s([^-–—]*)$/, (whole, tail: string) => (NOISE_RE.test(tail) ? '' : whole));
  s = s.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, '');
  return clean(s);
}

export function normalizeArtist(raw: string): string {
  return clean(
    fold(raw)
      .replace(/\s-\stopic$/, '')
      .replace(/vevo$/, '')
      .replace(/\bofficial\b/g, ''),
  );
}

function splitArtists(raw: string): string[] {
  return fold(raw)
    .split(/,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\//)
    .map((a) => normalizeArtist(a))
    .filter(Boolean);
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/\s/g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.replace(/\s/g, '').length < 2 || b.replace(/\s/g, '').length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return (2 * overlap) / total;
}

export function artistSimilarity(a: string, b: string): number {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  let best = similarity(na, nb);
  const sa = splitArtists(a);
  const sb = splitArtists(b);
  for (const x of sa) for (const y of sb) best = Math.max(best, x === y ? 1 : similarity(x, y));
  return best;
}

function markers(raw: string): Set<string> {
  const s = ` ${clean(fold(raw))} `;
  return new Set(VERSION_MARKERS.filter((m) => s.includes(` ${m} `)));
}

function qualifiers(raw: string): Set<string> {
  const s = fold(raw);
  const out = new Set<string>();
  for (const [, inner] of s.matchAll(/[([{]([^)\]}]*)[)\]}]/g)) {
    if (!FEAT_RE.test(inner.trim()) && !NOISE_RE.test(inner)) out.add(clean(inner));
  }
  const tail = s.replace(/[([{][^)\]}]*[)\]}]/g, '').match(/\s[-–—]\s([^-–—]*)$/)?.[1];
  if (tail && !NOISE_RE.test(tail)) out.add(clean(tail));
  out.delete('');
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function score(target: SearchTarget, cand: Omit<Candidate<unknown>, 'item'>): number {
  const titleScore = similarity(normalizeTitle(target.title), normalizeTitle(cand.title));
  if (titleScore < 0.6) return 0;
  const artistScore = artistSimilarity(target.artistName, cand.artistName);
  let s = 0.6 * titleScore + 0.4 * artistScore;

  const mt = markers(target.title);
  const mc = markers(cand.title);
  for (const m of mt) if (!mc.has(m)) s -= 0.25;
  for (const m of mc) if (!mt.has(m)) s -= 0.25;
  if (!sameSet(qualifiers(target.title), qualifiers(cand.title))) s -= 0.2;

  if (target.durationMs && cand.durationMs) {
    const diff = Math.abs(target.durationMs - cand.durationMs) / 1000;
    if (diff > 60) s -= 0.4;
    else if (diff > 15) s -= 0.15;
  }
  return s + (cand.bonus ?? 0);
}

export const MATCH_THRESHOLD = 0.72;

export function bestMatch<T>(target: SearchTarget, candidates: Candidate<T>[]): T | null {
  const wanted = clean(fold(target.title));
  let best: { item: T; score: number; exactness: number } | null = null;
  for (const c of candidates) {
    const s = score(target, c);
    if (s <= MATCH_THRESHOLD) continue;
    const exactness = similarity(wanted, clean(fold(c.title)));
    if (!best || s > best.score + 1e-9 || (Math.abs(s - best.score) <= 1e-9 && exactness > best.exactness)) {
      best = { item: c.item, score: s, exactness };
    }
  }
  return best?.item ?? null;
}

export function splitYouTubeTitle(videoTitle: string, channel: string): { title: string; artistName: string } {
  const isTopic = /\s-\stopic$/i.test(channel);
  const channelArtist = channel
    .replace(/\s-\stopic$/i, '')
    .replace(/vevo$/i, '')
    .trim();
  if (!isTopic) {
    const m = videoTitle.match(/^(.+?)\s[-–—|]\s(.+)$/);
    if (m) return { artistName: m[1].trim(), title: m[2].trim() };
  }
  return { artistName: channelArtist, title: videoTitle };
}

export function buildQuery(target: SearchTarget): string {
  const title = target.title
    .replace(/[([{]([^)\]}]*)[)\]}]/g, (whole, inner: string) =>
      FEAT_RE.test(inner.trim()) || NOISE_RE.test(inner) ? ' ' : whole,
    )
    .replace(/\s[-–—]\s([^-–—]*)$/, (whole, tail: string) => (NOISE_RE.test(tail) ? '' : whole));
  return `${target.artistName} ${title}`.replace(/\s+/g, ' ').trim();
}
