// Numbers written as French words ("1900" → "mille neuf cents"), so a lesson
// shows how a number is said and the learner reads, hears and repeats the same
// words. Traditional spelling (hyphens below one hundred, "et" in 21, 31 … 71).

const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

// 0–99. "final" is false when another word follows (quatre-vingt mille).
function belowHundred(n: number, final = true): string {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const ten = TENS[Math.floor(n / 10)];
    const unit = n % 10;
    return unit === 0 ? ten : unit === 1 ? `${ten} et un` : `${ten}-${UNITS[unit]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${UNITS[n - 60]}`;
  if (n === 80) return final ? "quatre-vingts" : "quatre-vingt";
  return `quatre-vingt-${UNITS[n - 80]}`;
}

// 0–999.
function belowThousand(n: number, final = true): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return belowHundred(rest, final);
  const head = hundreds === 1 ? "cent" : `${UNITS[hundreds]} cent${rest === 0 && final ? "s" : ""}`;
  return rest ? `${head} ${belowHundred(rest, final)}` : head;
}

export function frenchNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 1e12 || !Number.isInteger(value)) return String(value);
  if (value < 1000) return belowThousand(value);
  const parts: string[] = [];
  const billions = Math.floor(value / 1e9);
  const millions = Math.floor((value % 1e9) / 1e6);
  const thousands = Math.floor((value % 1e6) / 1000);
  const rest = value % 1000;
  if (billions) parts.push(`${belowThousand(billions)} milliard${billions > 1 ? "s" : ""}`);
  if (millions) parts.push(`${belowThousand(millions)} million${millions > 1 ? "s" : ""}`);
  if (thousands) parts.push(thousands === 1 ? "mille" : `${belowThousand(thousands, false)} mille`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

// "21e" → "vingt et unième", "5e" → "cinquième", "1er" → "premier".
export function frenchOrdinal(value: number, feminine = false): string {
  if (value === 1) return feminine ? "première" : "premier";
  const words = frenchNumber(value);
  if (words.endsWith("cinq")) return `${words}uième`;
  if (words.endsWith("neuf")) return `${words.slice(0, -1)}vième`;
  if (words.endsWith("e")) return `${words.slice(0, -1)}ième`;
  if (words.endsWith("quatre-vingts") || words.endsWith("cents")) return `${words.slice(0, -1)}ième`;
  return `${words}ième`;
}

const digits = (text: string) => Number(text.replace(/[\s  .]/g, ""));
const NUMBER = String.raw`\d{1,3}(?:[   ]\d{3})+|\d+`;

// Every number in a French sentence as words. Digits glued to letters ("A1",
// "B2") are codes, not quantities, and stay as they are.
export function numbersToFrench(text: string): string {
  return (
    text
      // 14h30, 9 h 05, 8h
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(\d{1,2})\s?h\s?(\d{2})?(?![\p{L}\d])`, "gu"), (_, hours: string, minutes?: string) => {
        const h = Number(hours);
        const head = `${h === 1 ? "une" : frenchNumber(h)} heure${h > 1 ? "s" : ""}`;
        return minutes && Number(minutes) ? `${head} ${frenchNumber(Number(minutes))}` : head;
      })
      // 1er, 1re, 2e, 3ème, 21es
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(\d+)(ers?|res?|ères?|es?|èmes?|ᵉ)(?![\p{L}\d])`, "gu"), (_, number: string, suffix: string) => {
        const feminine = /^(?:re|ère)/.test(suffix);
        const plural = /s$/.test(suffix) && suffix !== "es" ? "s" : suffix === "es" ? "s" : "";
        return `${frenchOrdinal(Number(number), feminine)}${plural}`;
      })
      // 3,5 → trois virgule cinq
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(\d+),(\d+)(?![\p{L}\d])`, "gu"), (_, whole: string, decimals: string) => {
        const after = /^0+/.test(decimals) ? decimals.split("").map((digit) => UNITS[Number(digit)]).join(" ") : frenchNumber(Number(decimals));
        return `${frenchNumber(Number(whole))} virgule ${after}`;
      })
      // 50 % / 20 €
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(${NUMBER})\s?%`, "gu"), (_, number: string) => `${frenchNumber(digits(number))} pour cent`)
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(${NUMBER})\s?€`, "gu"), (_, number: string) => {
        const value = digits(number);
        return `${frenchNumber(value)} euro${value > 1 ? "s" : ""}`;
      })
      // Everything else, with "1 000" read as one number. "06" keeps its zero.
      .replace(new RegExp(String.raw`(?<![\p{L}\d])(${NUMBER})(?![\p{L}\d])`, "gu"), (number: string) =>
        /^0\d/.test(number) ? number.split("").map((digit) => UNITS[Number(digit)]).join(" ") : frenchNumber(digits(number))
      )
  );
}
