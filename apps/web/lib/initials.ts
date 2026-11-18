/** The first letter of each of the first two words: "Harbour Coffee" is HC, "Ada" is A. */
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('') || '?'
