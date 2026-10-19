import { describe, expect, it } from "vitest";
import { frenchNumber, frenchOrdinal, numbersToFrench } from "../src/text/numbers";

describe("numbers as French words", () => {
  it("spells numbers the traditional way", () => {
    const cases: [number, string][] = [
      [21, "vingt et un"], [71, "soixante et onze"], [80, "quatre-vingts"], [81, "quatre-vingt-un"], [99, "quatre-vingt-dix-neuf"],
      [200, "deux cents"], [201, "deux cent un"], [1900, "mille neuf cents"], [2026, "deux mille vingt-six"],
      [80000, "quatre-vingt mille"], [200000, "deux cent mille"], [2500000, "deux millions cinq cent mille"]
    ];
    for (const [value, words] of cases) expect(frenchNumber(value)).toBe(words);
    expect([1, 2, 5, 9, 21, 80].map((value) => frenchOrdinal(value))).toEqual(["premier", "deuxième", "cinquième", "neuvième", "vingt et unième", "quatre-vingtième"]);
  });

  it("rewrites the numbers in a sentence", () => {
    expect(numbersToFrench("Le train part à 14h30.")).toBe("Le train part à quatorze heures trente.");
    expect(numbersToFrench("Rendez-vous à 1 h, pas à 9 h 05.")).toBe("Rendez-vous à une heure, pas à neuf heures cinq.");
    expect(numbersToFrench("Il est né en 1900.")).toBe("Il est né en mille neuf cents.");
    expect(numbersToFrench("C'est le 1er mai et la 1re fois.")).toBe("C'est le premier mai et la première fois.");
    expect(numbersToFrench("Le 21e siècle, au 3ème étage.")).toBe("Le vingt et unième siècle, au troisième étage.");
    expect(numbersToFrench("Ça coûte 20 € ou 1 €.")).toBe("Ça coûte vingt euros ou un euro.");
    expect(numbersToFrench("Il y a 50 % de chance.")).toBe("Il y a cinquante pour cent de chance.");
    expect(numbersToFrench("Il pèse 3,5 kilos.")).toBe("Il pèse trois virgule cinq kilos.");
    expect(numbersToFrench("J'ai 2 chats et 1 000 livres.")).toBe("J'ai deux chats et mille livres.");
  });

  it("leaves codes alone", () => {
    expect(numbersToFrench("Niveau A1 et B2.")).toBe("Niveau A1 et B2.");
    expect(numbersToFrench("Bonjour !")).toBe("Bonjour !");
  });
});
