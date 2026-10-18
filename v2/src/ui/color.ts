// Text colour that stays readable on a tape's label colour (1.0 tapes can be
// dark, e.g. #0a5f59; the 2.0 palette is light).
export function inkFor(color: string): string {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((digit) => digit + digit).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16) / 255);
  if ([r, g, b].some(Number.isNaN)) return "#16191A";
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.25 ? "#16191A" : "#F6F3EA";
}
