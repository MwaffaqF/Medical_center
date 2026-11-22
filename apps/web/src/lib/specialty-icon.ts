/** Picks an icon for a specialty from its English name or slug (or its explicit icon field). */
const RULES: [RegExp, string][] = [
  [/cardio|heart/, "heart"],
  [/dent|teeth|tooth|oral/, "tooth"],
  [/pediat|paediat|child|neonat/, "baby"],
  [/ophthal|eye|optom/, "eye"],
  [/derma|skin|cosmet|aesthet/, "skin"],
  [/ortho|bone|joint|physio|rheumat/, "bone"],
  [/gyn|obstet|women|matern/, "female"],
  [/neuro|brain|psych/, "brain"],
  [/\bent\b|ear|otolar|nose|throat/, "ear"],
  [/pulmo|lung|chest|respir/, "lungs"],
];

export function specialtyIcon(s: { icon: string | null; slug: string; nameEn: string }): string {
  if (s.icon) return s.icon;
  const text = `${s.slug} ${s.nameEn}`.toLowerCase();
  return RULES.find(([re]) => re.test(text))?.[1] ?? "stethoscope";
}
