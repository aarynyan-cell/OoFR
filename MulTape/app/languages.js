export const LANGUAGES = {
  zh: {
    id: "zh",
    locale: "zh-CN",
    script: "cjk",
    ui: true,
    names: { zh: "中文", en: "Chinese" },
    sample: "你好。今天我们用 MulTape 练习外语朗读和单词本。",
    voiceAliases: ["chinese", "mandarin", "中文", "普通话", "xiaoxiao", "yunxi"],
    defaultVoices: ["Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", "Microsoft Xiaoxiao", "Google 普通话", "Tingting"]
  },
  en: {
    id: "en",
    locale: "en-US",
    script: "latin",
    ui: true,
    names: { zh: "英语", en: "English" },
    sample: "Hello. Today we are practicing with MulTape.",
    voiceAliases: ["english", "united states", "jenny", "aria", "guy"],
    defaultVoices: ["Microsoft Jenny Online (Natural) - English (United States)", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny", "Google US English", "Samantha"]
  },
  fr: {
    id: "fr",
    locale: "fr-FR",
    script: "latin",
    names: { zh: "法语", en: "French", fr: "Français" },
    sample: "Bonjour ! Je m'appelle Camille, et j'apprends le français tous les jours.\nEst-ce que tu peux répéter cette phrase plus lentement ? Merci beaucoup.",
    voiceAliases: ["french", "france", "français", "francais", "henri", "denise"],
    defaultVoices: ["Microsoft Henri Online (Natural) - French (France)", "Microsoft Denise Online (Natural) - French (France)", "Microsoft Henri", "Google français", "Thomas"]
  },
  de: {
    id: "de",
    locale: "de-DE",
    script: "latin",
    names: { zh: "德语", en: "German", de: "Deutsch" },
    sample: "Guten Morgen ! Ich lerne jeden Tag Deutsch.\nKannst du diesen Satz bitte etwas langsamer wiederholen ?",
    voiceAliases: ["german", "deutsch", "germany", "katja", "conrad"],
    defaultVoices: ["Microsoft Conrad Online (Natural) - German (Germany)", "Microsoft Katja Online (Natural) - German (Germany)", "Microsoft Conrad", "Microsoft Katja", "Google Deutsch"]
  },
  sv: {
    id: "sv",
    locale: "sv-SE",
    script: "latin",
    names: { zh: "瑞典语", en: "Swedish", sv: "Svenska" },
    sample: "Hej ! Jag övar svenska varje dag.\nKan du upprepa den här meningen lite långsammare ?",
    voiceAliases: ["swedish", "svenska", "sweden", "mattias", "sofie"],
    defaultVoices: ["Microsoft Mattias Online (Natural) - Swedish (Sweden)", "Microsoft Sofie Online (Natural) - Swedish (Sweden)", "Microsoft Mattias", "Microsoft Sofie", "Google svenska"]
  },
  es: {
    id: "es",
    locale: "es-ES",
    script: "latin",
    names: { zh: "西语", en: "Spanish", es: "Español" },
    sample: "¡Hola! Practico español todos los días.\n¿Puedes repetir esta frase un poco más despacio ?",
    voiceAliases: ["spanish", "español", "espanol", "spain", "alvaro", "elvira"],
    defaultVoices: ["Microsoft Alvaro Online (Natural) - Spanish (Spain)", "Microsoft Elvira Online (Natural) - Spanish (Spain)", "Microsoft Alvaro", "Microsoft Elvira", "Google español"]
  },
  it: {
    id: "it",
    locale: "it-IT",
    script: "latin",
    names: { zh: "意大利语", en: "Italian", it: "Italiano" },
    sample: "Ciao ! Studio italiano ogni giorno.\nPuoi ripetere questa frase un po' più lentamente ?",
    voiceAliases: ["italian", "italiano", "italy", "diego", "elsa", "isabella"],
    defaultVoices: ["Microsoft Diego Online (Natural) - Italian (Italy)", "Microsoft Elsa Online (Natural) - Italian (Italy)", "Microsoft Isabella Online (Natural) - Italian (Italy)", "Microsoft Diego", "Microsoft Elsa", "Google italiano"]
  },
  ja: {
    id: "ja",
    locale: "ja-JP",
    script: "cjk",
    names: { zh: "日语", en: "Japanese", ja: "日本語" },
    sample: "こんにちは。毎日日本語を練習しています。\nこの文をもう少しゆっくり繰り返してくれますか。",
    voiceAliases: ["japanese", "japan", "日本語", "nanami", "keita"],
    defaultVoices: ["Microsoft Nanami Online (Natural) - Japanese (Japan)", "Microsoft Keita Online (Natural) - Japanese (Japan)", "Microsoft Nanami", "Microsoft Keita", "Google 日本語"]
  },
  ko: {
    id: "ko",
    locale: "ko-KR",
    script: "cjk",
    names: { zh: "韩语", en: "Korean", ko: "한국어" },
    sample: "안녕하세요. 저는 매일 한국어를 연습합니다.\n이 문장을 조금 더 천천히 반복해 줄 수 있나요?",
    voiceAliases: ["korean", "korea", "한국어", "sunhi", "injoon"],
    defaultVoices: ["Microsoft SunHi Online (Natural) - Korean (Korea)", "Microsoft InJoon Online (Natural) - Korean (Korea)", "Microsoft SunHi", "Microsoft InJoon", "Google 한국어"]
  }
};

export const STUDY_LANGUAGE_IDS = ["fr", "de", "sv", "es", "it", "ja", "ko"];
export const NATIVE_LANGUAGE_IDS = ["zh", "en", "fr", "de", "sv", "es", "it", "ja", "ko"];

export function languageName(languageId, uiLanguageId = "zh") {
  const language = LANGUAGES[languageId];
  if (!language) return languageId || "";
  return language.names[uiLanguageId] || language.names.zh || language.names.en || language.id;
}

export function activePair(studyLanguageId, nativeLanguageId) {
  return `${studyLanguageId}-${nativeLanguageId}`;
}

export function isCjkLanguage(languageId) {
  return LANGUAGES[languageId]?.script === "cjk";
}
