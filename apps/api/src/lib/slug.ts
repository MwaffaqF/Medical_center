/** URL slug from (English) text: "Dr. Sara Al-Hamwi" → "dr-sara-al-hamwi". */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `item-${crypto.randomUUID().slice(0, 6)}`;
}

/** First free slug among base, base-2, base-3, … */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 56)}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base.slice(0, 50)}-${crypto.randomUUID().slice(0, 8)}`;
}
