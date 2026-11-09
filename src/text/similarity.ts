/* Word similarity shared by the cost estimate (which past task cost what) and recall (which past task is this
   prompt asking for again). TF-IDF cosine over lower-cased words, stopwords and bare numbers removed. Kept free of
   file-system imports so the hook can use it at prompt time. */

const STOP = new Set(
  'the and for with that this from into have has are was were will would should could can not but you your our their them they its use using please make need needs want also then than when what which there here just like some any all each other more most very about after before over under only into onto off out via per a an to of in on at by is it be as or if so do we i me my'.split(' '),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<\/?pasted_content[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, (u) => u.replace(/[/.:#?=&_-]+/g, ' '))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && w.length < 30);
}

export type Vec = Map<string, number>;

export function termCounts(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export function vectorize(counts: Map<string, number>, idf: Map<string, number>, fallbackIdf: number): Vec {
  const v: Vec = new Map();
  let norm = 0;
  for (const [t, n] of counts) {
    const w = (1 + Math.log(n)) * (idf.get(t) ?? fallbackIdf);
    v.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}

/* idf over a corpus of texts, and the vector of each; the query is vectorised against the same idf */
export function index(texts: string[]): { idf: Map<string, number>; fallbackIdf: number; vectors: Vec[] } {
  const counts = texts.map((t) => termCounts(tokenize(t)));
  const df = new Map<string, number>();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = texts.length;
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log((N + 1) / (n + 1)) + 1);
  const fallbackIdf = Math.log(N + 1) + 1;
  return { idf, fallbackIdf, vectors: counts.map((c) => vectorize(c, idf, fallbackIdf)) };
}

export function rank(query: string, texts: string[]): Array<{ i: number; sim: number }> {
  const ix = index(texts);
  const q = vectorize(termCounts(tokenize(query)), ix.idf, ix.fallbackIdf);
  if (!q.size) return [];
  return ix.vectors
    .map((v, i) => ({ i, sim: cosine(q, v) }))
    .filter((x) => x.sim > 0)
    .sort((a, b) => b.sim - a.sim);
}
