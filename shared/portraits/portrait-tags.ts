export type PortraitGender = "男" | "女";

export interface PortraitTags {
  country: string;
  age: number;
  gender: PortraitGender;
  profession: string;
}

export function parsePortraitTags(name: string): PortraitTags | undefined {
  const normalized = name.trim().replaceAll("女性", "女").replaceAll("男性", "男");
  const match = normalized.match(/^(\S+)\s+(\d{1,3})岁\s+([男女])\s+(.+)$/u);
  if (!match) return undefined;
  const [, country, rawAge, gender, profession] = match;
  const age = Number(rawAge);
  if (!country || !gender || !profession || !Number.isInteger(age) || age <= 0) return undefined;
  return {
    country,
    age,
    gender: gender as PortraitGender,
    profession: profession.trim(),
  };
}

export function formatPortraitIdentity(tags: PortraitTags) {
  return `${tags.country} ${tags.age}岁 ${tags.gender}性 ${tags.profession}`;
}
