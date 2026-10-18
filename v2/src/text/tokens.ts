// Splits a sentence into tappable words and the text between them.
// "Comment allez-vous ?" → "Comment", " ", "allez", "-vous", " ?": the inverted
// subject is its own word, while real compounds ("peut-être", "aujourd'hui")
// stay whole.

export interface Token {
  text: string;
  word: boolean;
  // Which occurrence of this word in the sentence (0 = first), for context lookups.
  occurrence: number;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*)*/gu;
const CLITICS = new Set(["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "moi", "toi", "le", "la", "les", "lui", "leur", "leurs", "y", "en", "ce", "t", "là", "ci"]);

function splitInversion(word: string): string[] {
  const parts = word.split("-");
  let cut = parts.length;
  while (cut > 1 && CLITICS.has(parts[cut - 1].toLocaleLowerCase("fr-FR"))) cut -= 1;
  if (cut === parts.length) return [word];
  // "va-t-il": the euphonic t belongs to the pronoun.
  return [parts.slice(0, cut).join("-"), ...parts.slice(cut).map((part) => `-${part}`)].reduce<string[]>((output, part) => {
    if (part === "-t" || part === "-T") output.push(part);
    else if (output.at(-1) === "-t" || output.at(-1) === "-T") output[output.length - 1] += part;
    else output.push(part);
    return output;
  }, []);
}

export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  const seen = new Map<string, number>();
  let last = 0;
  const push = (text: string, word: boolean) => {
    if (!text) return;
    if (!word) {
      tokens.push({ text, word, occurrence: 0 });
      return;
    }
    const key = text.replace(/^-+/, "").toLocaleLowerCase("fr-FR");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    tokens.push({ text, word, occurrence });
  };
  for (const match of sentence.matchAll(WORD)) {
    push(sentence.slice(last, match.index), false);
    splitInversion(match[0]).forEach((part) => push(part, true));
    last = (match.index ?? 0) + match[0].length;
  }
  push(sentence.slice(last), false);
  return tokens;
}

// Words with nothing between them ("allez", "-vous") form one group, and so
// does closing punctuation ("aujourd'hui ?"), so a line never breaks inside it.
export function groupWords(tokens: Token[]): Token[][] {
  return tokens.reduce<Token[][]>((groups, token) => {
    const last = groups.at(-1);
    const lastIsWords = Boolean(last?.[0].word);
    const closing = !token.word && /^[\s ]?[?!:;»…,.)]/.test(token.text);
    if (lastIsWords && closing) {
      // The punctuation joins the words; the space after it may still break the line.
      const [, head, tail] = token.text.match(/^(.*?)(\s*)$/s) ?? [, token.text, ""];
      last!.push({ ...token, text: head ?? "" });
      if (tail) groups.push([{ ...token, text: tail }]);
    } else if (lastIsWords && token.word && last!.at(-1)!.word) last!.push(token);
    else groups.push([token]);
    return groups;
  }, []);
}

// The word to look up for a token ("-vous" → "vous", "-t-il" → "il").
export function lookupText(token: Token): string {
  return token.text.replace(/^-(t-)?/i, "");
}
