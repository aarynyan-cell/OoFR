const SAMPLE_TEXT = `Bonjour ! Je m'appelle Camille, et j'apprends le français tous les jours.
Aujourd'hui, je voudrais pratiquer les liaisons : les amis, vous avez, nous allons.
Est-ce que tu peux répéter cette phrase plus lentement ? Merci beaucoup.`;

const APP_STORAGE_KEY = "oofr.app.v1";
const SYNC_STORAGE_KEY = "oofr.sync.v1";
// Side copies written by the safety nets below; never read back as live data.
const CORRUPT_STORAGE_KEY = `${APP_STORAGE_KEY}.corrupt`;
const BACKUP_STORAGE_KEY = `${APP_STORAGE_KEY}.backup`;
// Constants the storage driver needs while the page is still starting up must
// be declared above the initApp() call at the top of the script (const is not
// usable before its declaration runs).
const STATE_DB_NAME = "oofr-state";
const STATE_DB_STORE = "kv";
const LEGACY_NEWER_KEY = "oofr.state.legacy-newer";
const STATE_DB_OPEN_TIMEOUT_MS = 4000;
const CLOUD_LOCAL_META_KEY = "oofr.cloud.local-meta.v1";
const LEGACY_STORAGE_KEY = "oofr.pronunciation.v1";
const APP_VERSION = globalThis.OOFR_VERSION || "1.0.0";
const ASSET_VERSION = APP_VERSION;
const CLOUD_SYNC_ENABLED = false;
const LEARNING_PACKAGE_TYPE = "oofr.learning-package";
const DESKTOP_AI_MODEL = "gemma3:4b";
const AI_CONTENT_VERSION = "2";
const LEXICON_SCRIPT_SRC = `./lexicon.js?v=${ASSET_VERSION}`;
const WORD_PATTERN_SOURCE = String.raw`[\p{L}\p{M}]+(?:[’'\-][\p{L}\p{M}]+)*`;
const CHROME_DEFAULT_VOICE = "Google français";
const EDGE_DEFAULT_VOICE = "Microsoft Henri Online (Natural) - French (France)";
const ELIDED_PREFIXES = new Set(["c", "d", "j", "l", "m", "n", "qu", "s", "t", "jusqu", "lorsqu", "puisqu"]);
const KNOWN_LEXICAL_UNITS = {
  "les liaisons": { lemma: "liaison", ipa: "/ljɛ.zɔ̃/", pos: "locution nominale", zh: "法语中的连音现象", en: "liaison between adjacent words", fr: "enchaînement phonétique entre deux mots", forms: "原型：une liaison · 复数：les liaisons" },
  "s'appeler": { lemma: "s’appeler", ipa: "/sa.ple/", pos: "verbe pronominal", zh: "名叫；称为", en: "to be called", fr: "porter un nom", forms: "je m’appelle · tu t’appelles · il/elle s’appelle" },
  "m'appelle": { lemma: "s’appeler", ipa: "/ma.pɛl/", pos: "verbe pronominal · 1re personne", zh: "我叫……；原型为 s’appeler", en: "I am called; infinitive: s’appeler", fr: "forme de s’appeler à la première personne", forms: "原型：s’appeler · je m’appelle" },
  "j'apprends": { lemma: "apprendre", ipa: "/ʒa.pʁɑ̃/", pos: "verbe · 1re personne", zh: "我学习；原型为 apprendre", en: "I learn; infinitive: apprendre", fr: "forme d’apprendre à la première personne", forms: "原型：apprendre · j’apprends · nous apprenons" },
  "un peu": { lemma: "un peu", ipa: "/œ̃ pø/", pos: "locution adverbiale", zh: "一点；有点；稍微", en: "a little; a bit; slightly", fr: "en petite quantité ou légèrement", forms: "固定表达：un peu（整体理解，不拆分）" }
};
const COURSE_WORD_OVERRIDES = {
  bonjour: { lemma: "bonjour", pos: "感叹词", zh: "你好；您好；早上好（白天见面时的问候）", en: "hello; good morning; good day", fr: "salutation employée dans la journée" },
  organiser: { lemma: "organiser", pos: "动词", zh: "组织；安排；筹办", en: "to organise; to arrange", fr: "préparer et coordonner une activité" },
  "espérer": { lemma: "espérer", pos: "动词", zh: "希望；期望", en: "to hope", fr: "souhaiter qu’une chose se réalise" },
  individuel: { lemma: "individuel", pos: "形容词", zh: "个人的；单独的；个体的", en: "individual; personal", fr: "qui concerne une seule personne" }
};
const LOCAL_TRANSLATIONS = {
  "fr:zh:bonjour": "你好",
  "fr:zh:je m'appelle camille, et j'apprends le francais tous les jours": "我叫 Camille，我每天都学习法语。",
  "fr:zh:aujourd'hui, je voudrais pratiquer les liaisons : les amis, vous avez, nous allons": "今天，我想练习法语中的连音：les amis、vous avez、nous allons。",
  "fr:zh:est-ce que tu peux repeter cette phrase plus lentement": "你可以把这句话说得慢一点吗？",
  "fr:zh:bonsoir": "晚上好",
  "fr:zh:bonne journee": "祝你今天愉快",
  "fr:zh:bonne nuit": "晚安",
  "fr:zh:au revoir": "再见",
  "fr:zh:a bientot": "回头见",
  "fr:zh:merci": "谢谢",
  "fr:zh:merci beaucoup": "非常感谢",
  "fr:zh:s'il vous plait": "请",
  "en:zh:hello": "你好",
  "en:zh:good morning": "早上好",
  "en:zh:good afternoon": "下午好",
  "en:zh:good night": "晚安",
  "en:zh:thank you": "谢谢"
};
const ALL_WORDBOOK_ID = "all";
const NEW_WORDBOOK_ID = "new";
const GOT_WORDBOOK_ID = "got";
const DIY_WORDBOOK_ID = "diy";
const WORDBOOK_CONFLICT_KEEP_LOCAL = "keep-local";
const WORDBOOK_CONFLICT_USE_IMPORTED = "use-imported";
const SYSTEM_WORDBOOKS = [
  { id: ALL_WORDBOOK_ID, title: "all", description: "全部词句" },
  { id: NEW_WORDBOOK_ID, title: "new", description: "还没 got 的词句" },
  { id: GOT_WORDBOOK_ID, title: "got", description: "已经掌握的词句" },
  { id: DIY_WORDBOOK_ID, title: "DIY", description: "待补音标或释义" }
];

const icons = {
  album: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 3h14v18H5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M9 7h6M9 17h6"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
  book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4-4z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M5 4v16"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="m5 12 4 4L19 6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="m6 6 12 12M18 6 6 18"/></svg>`,
  download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="m4 16-.5 4 4-.5L19 8l-3.5-3.5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="m14 6 4 4"/></svg>`,
  feedback: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M4 5h16v11H8l-4 4z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M8 9h8M8 13h5"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.8 8.8c0 5.2-8.8 10.1-8.8 10.1S3.2 14 3.2 8.8A4.8 4.8 0 0 1 12 6.2a4.8 4.8 0 0 1 8.8 2.6Z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72c0 .74.82 1.18 1.44.78l10.08-6.86a.93.93 0 0 0 0-1.56L9.44 4.36A.94.94 0 0 0 8 5.14Z"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m20 12-8-7v4H5v6h7v4z"/></svg>`,
  rewind: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m4 12 8-7v4h7v6h-7v4z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" d="M12 5v14M5 12h14"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11a8.1 8.1 0 0 0-14.4-4.8L4 8m0 0V4m0 4h4m-4 5a8.1 8.1 0 0 0 14.4 4.8L20 16m0 0v4m0-4h-4"/></svg>`,
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M5 4h12l2 2v14H5z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M8 4v6h8V4M8 20v-6h8v6"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 1.9 5.7L20 10l-6.1 2.3L12 18l-1.9-5.7L4 10l6.1-2.3L12 2Zm7 12 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9.2v5.6c0 .66.54 1.2 1.2 1.2H8l5.1 4.1c.78.62 1.9.07 1.9-.93V4.83c0-1-1.12-1.55-1.9-.93L8 8H5.2C4.54 8 4 8.54 4 9.2Zm13.4-1.4a1 1 0 0 0 0 1.4 4 4 0 0 1 0 5.6 1 1 0 0 0 1.4 1.4 6 6 0 0 0 0-8.4 1 1 0 0 0-1.4 0Z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="12" height="12" x="6" y="6" rx="2" fill="currentColor"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21V9m0 0 4 4m-4-4-4 4M5 4h14"/></svg>`,
  user: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M4 21a8 8 0 0 1 16 0"/></svg>`
};

const elements = {
  startupLoader: document.querySelector("#startupLoader"),
  startupStage: document.querySelector("#startupStage"),
  startupProgressBar: document.querySelector("#startupProgressBar"),
  startupProgressValue: document.querySelector("#startupProgressValue"),
  startupProgressTrack: document.querySelector(".startup-progress-track"),
  startupSteps: Array.from(document.querySelectorAll("[data-startup-step]")),
  navButtons: Array.from(document.querySelectorAll("[data-view-target]")),
  views: {
    course: document.querySelector("#courseView"),
    reader: document.querySelector("#readerView"),
    library: document.querySelector("#libraryView"),
    vocab: document.querySelector("#vocabView"),
    my: document.querySelector("#myView")
  },
  input: document.querySelector("#frenchInput"),
  activeEntryLine: document.querySelector("#activeEntryLine"),
  textStats: document.querySelector("#textStats"),
  playAllReader: document.querySelector("#playAllReader"),
  stopReader: document.querySelector("#stopReader"),
  saveEntryBtn: document.querySelector("#saveEntryBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  audioSettingsToggle: document.querySelector("#audioSettingsToggle"),
  audioSettingsPanel: document.querySelector("#audioSettingsPanel"),
  voiceSelect: document.querySelector("#voiceSelect"),
  rateControl: document.querySelector("#rateControl"),
  rateLabel: document.querySelector("#rateLabel"),
  repeatGroup: document.querySelector("#repeatGroup"),
  pauseControl: document.querySelector("#pauseControl"),
  pauseLabel: document.querySelector("#pauseLabel"),
  statusLine: document.querySelector("#statusLine"),
  toast: document.querySelector("#toast"),
  courseRepeatSelect: document.querySelector("#courseRepeatSelect"),
  coursePauseSelect: document.querySelector("#coursePauseSelect"),
  lexiconStatus: document.querySelector("#lexiconStatus"),
  sentenceList: document.querySelector("#sentenceList"),
  wordPanel: document.querySelector("#wordPanel"),
  wordPanelTitle: document.querySelector("#wordPanelTitle"),
  wordPanelMeta: document.querySelector("#wordPanelMeta"),
  wordPlayBtn: document.querySelector("#wordPlayBtn"),
  wordAddBtn: document.querySelector("#wordAddBtn"),
  wordToggleBtn: document.querySelector("#wordToggleBtn"),
  wordEditBtn: document.querySelector("#wordEditBtn"),
  wordDeleteBtn: document.querySelector("#wordDeleteBtn"),
  wordPanelCloseBtn: document.querySelector("#wordPanelCloseBtn"),
  newAlbumBtn: document.querySelector("#newAlbumBtn"),
  albumShelf: document.querySelector("#albumShelf"),
  newMaterialBtn: document.querySelector("#newMaterialBtn"),
  materialSearchInput: document.querySelector("#materialSearchInput"),
  materialFilterButtons: Array.from(document.querySelectorAll("[data-material-filter]")),
  libraryDetail: document.querySelector("#libraryDetail"),
  newVocabBtn: document.querySelector("#newVocabBtn"),
  newWordbookBtn: document.querySelector("#newWordbookBtn"),
  wordbookShelf: document.querySelector("#wordbookShelf"),
  selectedWordbookLine: document.querySelector("#selectedWordbookLine"),
  vocabSearch: document.querySelector("#vocabSearch"),
  vocabStats: document.querySelector("#vocabStats"),
  vocabList: document.querySelector("#vocabList"),
  phraseSourceFilter: document.querySelector("#phraseSourceFilter"),
  phraseDateFilter: document.querySelector("#phraseDateFilter"),
  phraseStatusFilter: document.querySelector("#phraseStatusFilter"),
  phrasePracticeBtn: document.querySelector("#phrasePracticeBtn"),
  phrasePracticePanel: document.querySelector("#phrasePracticePanel"),
  phrasePracticeBackBtn: document.querySelector("#phrasePracticeBackBtn"),
  phrasePracticeMeta: document.querySelector("#phrasePracticeMeta"),
  phrasePracticeSource: document.querySelector("#phrasePracticeSource"),
  phrasePracticeProgress: document.querySelector("#phrasePracticeProgress"),
  phrasePracticeSpeakBtn: document.querySelector("#phrasePracticeSpeakBtn"),
  phrasePracticeDisplayMode: document.querySelector("#phrasePracticeDisplayMode"),
  phrasePracticeVoiceHint: document.querySelector("#phrasePracticeVoiceHint"),
  phrasePracticePrompt: document.querySelector("#phrasePracticePrompt"),
  phrasePracticeAnswer: document.querySelector("#phrasePracticeAnswer"),
  phrasePracticeRevealBtn: document.querySelector("#phrasePracticeRevealBtn"),
  phrasePracticeAgainBtn: document.querySelector("#phrasePracticeAgainBtn"),
  phrasePracticeKnownBtn: document.querySelector("#phrasePracticeKnownBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFile: document.querySelector("#importFile"),
  desktopAiTermsCopyBtn: document.querySelector("#desktopAiTermsCopyBtn"),
  restoreBackupBtn: document.querySelector("#restoreBackupBtn"),
  learningPackageDialog: document.querySelector("#learningPackageDialog"),
  learningPackageTitle: document.querySelector("#learningPackageTitle"),
  learningPackagePreview: document.querySelector("#learningPackagePreview"),
  learningPackageCloseBtn: document.querySelector("#learningPackageCloseBtn"),
  learningPackageCancelBtn: document.querySelector("#learningPackageCancelBtn"),
  learningPackageCopyBtn: document.querySelector("#learningPackageCopyBtn"),
  learningPackageUpdateBtn: document.querySelector("#learningPackageUpdateBtn"),
  wordbookExportScope: document.querySelector("#wordbookExportScope"),
  wordbookExportBtn: document.querySelector("#wordbookExportBtn"),
  wordbookImportBtn: document.querySelector("#wordbookImportBtn"),
  wordbookImportFile: document.querySelector("#wordbookImportFile"),
  myStats: document.querySelector("#myStats"),
  studyStatsCards: document.querySelector("#studyStatsCards"),
  studyAchievements: document.querySelector("#studyAchievements"),
  studySummaryHint: document.querySelector("#studySummaryHint"),
  studyCheckinBtn: document.querySelector("#studyCheckinBtn"),
  studyShareBtn: document.querySelector("#studyShareBtn"),
  cloudSyncBadge: document.querySelector("#cloudSyncBadge"),
  cloudSyncStatus: document.querySelector("#cloudSyncStatus"),
  cloudSyncLoggedOut: document.querySelector("#cloudSyncLoggedOut"),
  cloudSyncLoggedIn: document.querySelector("#cloudSyncLoggedIn"),
  cloudSyncEmail: document.querySelector("#cloudSyncEmail"),
  cloudSyncLoginBtn: document.querySelector("#cloudSyncLoginBtn"),
  cloudSyncLoginHint: document.querySelector("#cloudSyncLoginHint"),
  cloudSyncAccount: document.querySelector("#cloudSyncAccount"),
  cloudSyncNowBtn: document.querySelector("#cloudSyncNowBtn"),
  cloudSyncSignOutBtn: document.querySelector("#cloudSyncSignOutBtn"),
  systemLanguageSelect: document.querySelector("#systemLanguageSelect"),
  localAiEndpointInput: document.querySelector("#localAiEndpointInput"),
  localAiModelInput: document.querySelector("#localAiModelInput"),
  localAiModelOptions: document.querySelector("#localAiModelOptions"),
  localAiTestBtn: document.querySelector("#localAiTestBtn"),
  localAiStatus: document.querySelector("#localAiStatus"),
  desktopAiSetupDialog: document.querySelector("#desktopAiSetupDialog"),
  desktopAiSetupCloseBtn: document.querySelector("#desktopAiSetupCloseBtn"),
  desktopAiSetupStatus: document.querySelector("#desktopAiSetupStatus"),
  desktopAiSetupDetail: document.querySelector("#desktopAiSetupDetail"),
  desktopAiSetupProgress: document.querySelector("#desktopAiSetupProgress"),
  desktopAiProgressTrack: document.querySelector(".desktop-ai-progress-track"),
  desktopAiTermsCheck: document.querySelector("#desktopAiTermsCheck"),
  desktopAiInstallBtn: document.querySelector("#desktopAiInstallBtn"),
  desktopAiCancelBtn: document.querySelector("#desktopAiCancelBtn"),
  dialog: document.querySelector("#appDialog"),
  dialogForm: document.querySelector("#dialogForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  dialogSubmitBtn: document.querySelector("#dialogSubmitBtn"),
  dialogCloseBtn: document.querySelector("#dialogCloseBtn"),
  dialogCancelBtn: document.querySelector("#dialogCancelBtn")
  ,courseLibraryPanel: document.querySelector("#courseLibraryPanel"),
  courseComposerPanel: document.querySelector("#courseComposerPanel"),
  coursePlayerPanel: document.querySelector("#coursePlayerPanel"),
  coursePracticePanel: document.querySelector("#coursePracticePanel"),
  courseNewBtn: document.querySelector("#courseNewBtn"),
  courseBackToLibraryBtn: document.querySelector("#courseBackToLibraryBtn"),
  courseGenerateBtn: document.querySelector("#courseGenerateBtn"),
  courseMaterialFile: document.querySelector("#courseMaterialFile"),
  courseTitleInput: document.querySelector("#courseTitleInput"),
  courseLanguageSelect: document.querySelector("#courseLanguageSelect"),
  courseExplainLanguageSelect: document.querySelector("#courseExplainLanguageSelect"),
  courseMaterialTypeSelect: document.querySelector("#courseMaterialTypeSelect"),
  courseMaterialInput: document.querySelector("#courseMaterialInput"),
  courseAnalyzeBtn: document.querySelector("#courseAnalyzeBtn"),
  courseAnalysisPanel: document.querySelector("#courseAnalysisPanel"),
  courseAnalysisSource: document.querySelector("#courseAnalysisSource"),
  courseAnalysisSummary: document.querySelector("#courseAnalysisSummary"),
  courseAnalysisReasons: document.querySelector("#courseAnalysisReasons"),
  courseAnalysisStatus: document.querySelector("#courseAnalysisStatus"),
  courseApplySentenceBreaksBtn: document.querySelector("#courseApplySentenceBreaksBtn"),
  courseApplySpeakersBtn: document.querySelector("#courseApplySpeakersBtn"),
  courseApplyCorrectionsBtn: document.querySelector("#courseApplyCorrectionsBtn"),
  courseLessonCards: document.querySelector("#courseLessonCards"),
  coursePlayerTitle: document.querySelector("#coursePlayerTitle"),
  coursePlayerMeta: document.querySelector("#coursePlayerMeta"),
  courseMicHint: document.querySelector("#courseMicHint"),
  courseEditBtn: document.querySelector("#courseEditBtn"),
  coursePracticeBtn: document.querySelector("#coursePracticeBtn"),
  courseExportLearningPackageBtn: document.querySelector("#courseExportLearningPackageBtn"),
  courseImportLearningPackageBtn: document.querySelector("#courseImportLearningPackageBtn"),
  courseLearningPackageFile: document.querySelector("#courseLearningPackageFile"),
  courseExportRecordingsBtn: document.querySelector("#courseExportRecordingsBtn"),
  courseSpeakerSelect: document.querySelector("#courseSpeakerSelect"),
  courseSegmentStart: document.querySelector("#courseSegmentStart"),
  courseSegmentEnd: document.querySelector("#courseSegmentEnd"),
  coursePlaybackStatus: document.querySelector("#coursePlaybackStatus"),
  courseRateSelect: document.querySelector("#courseRateSelect"),
  courseRateButton: document.querySelector("#courseRateButton"),
  courseTranslationToggle: document.querySelector("#courseTranslationToggle"),
  courseBottomTitle: document.querySelector("#courseBottomTitle"),
  courseBottomHint: document.querySelector("#courseBottomHint"),
  courseCustomButton: document.querySelector("#courseCustomButton"),
  courseCustomOptions: document.querySelector("#courseCustomOptions"),
  courseElapsed: document.querySelector("#courseElapsed"),
  courseTimeline: document.querySelector("#courseTimeline"),
  courseDuration: document.querySelector("#courseDuration"),
  courseFastBackBtn: document.querySelector("#courseFastBackBtn"),
  courseBottomPlayBtn: document.querySelector("#courseBottomPlayBtn"),
  courseFastForwardBtn: document.querySelector("#courseFastForwardBtn"),
  courseVoiceSelect: document.querySelector("#courseVoiceSelect"),
  courseVoiceButton: document.querySelector("#courseVoiceButton"),
  courseVoiceOptions: document.querySelector("#courseVoiceOptions"),
  courseBottomTranslationToggle: document.querySelector("#courseBottomTranslationToggle"),
  courseTranscriptList: document.querySelector("#courseTranscriptList"),
  courseWordCount: document.querySelector("#courseWordCount"),
  courseWordList: document.querySelector("#courseWordList"),
  courseWordPopover: document.querySelector("#courseWordPopover"),
  coursePopoverWord: document.querySelector("#coursePopoverWord"),
  coursePopoverMeta: document.querySelector("#coursePopoverMeta"),
  courseWordFavoriteBtn: document.querySelector("#courseWordFavoriteBtn"),
  courseWordPopoverCloseBtn: document.querySelector("#courseWordPopoverCloseBtn"),
  coursePopoverWordPlayBtn: document.querySelector("#coursePopoverWordPlayBtn"),
  coursePopoverPronunciation: document.querySelector("#coursePopoverPronunciation"),
  coursePopoverMeaning: document.querySelector("#coursePopoverMeaning"),
  coursePopoverForms: document.querySelector("#coursePopoverForms"),
  coursePopoverSource: document.querySelector("#coursePopoverSource"),
  coursePopoverLookupBtn: document.querySelector("#coursePopoverLookupBtn"),
  courseWordDetailDialog: document.querySelector("#courseWordDetailDialog"),
  courseWordDetailTitle: document.querySelector("#courseWordDetailTitle"),
  courseWordDetailMeta: document.querySelector("#courseWordDetailMeta"),
  courseWordDetailBody: document.querySelector("#courseWordDetailBody"),
  courseWordDetailStatus: document.querySelector("#courseWordDetailStatus"),
  courseWordDetailCloseBtn: document.querySelector("#courseWordDetailCloseBtn"),
  courseSentenceDetailDialog: document.querySelector("#courseSentenceDetailDialog"),
  courseSentenceDetailTitle: document.querySelector("#courseSentenceDetailTitle"),
  courseSentenceDetailMeta: document.querySelector("#courseSentenceDetailMeta"),
  courseSentenceDetailBody: document.querySelector("#courseSentenceDetailBody"),
  courseSentenceDetailStatus: document.querySelector("#courseSentenceDetailStatus"),
  courseSentenceDetailCloseBtn: document.querySelector("#courseSentenceDetailCloseBtn"),
  courseBackToPlayerBtn: document.querySelector("#courseBackToPlayerBtn"),
  coursePracticeMeta: document.querySelector("#coursePracticeMeta"),
  coursePracticePrompt: document.querySelector("#coursePracticePrompt"),
  coursePracticeAnswer: document.querySelector("#coursePracticeAnswer"),
  courseRevealBtn: document.querySelector("#courseRevealBtn"),
  courseAgainBtn: document.querySelector("#courseAgainBtn"),
  courseKnownBtn: document.querySelector("#courseKnownBtn")
};

const storageDriver = createStorageDriver();

let state = null;
let frenchVoices = [];
let allVoices = [];
let sentences = [];
let activeElement = null;
let selectedWord = null;
let runToken = 0;
let playback = { status: "idle", key: "", label: "", token: 0 };
let renderTimer = 0;
let dialogSubmitHandler = null;
let dialogRequiredFields = [];
// Banner shown when stored data is unreadable or cannot be saved (see showStorageNotice).
let storageNotice = null;
let storageNoticeElement = null;
// True while an unreadable original could not be set aside; blocks overwriting it.
let persistLocked = false;
// Moment of our own last write, to tell it apart from a change made in another window.
let lastOwnWriteAt = 0;
let syncSettingsTimer = 0;
let cloudSyncTimer = 0;
let cloudSyncState = { session: null, busy: false, lastSyncAt: null, configured: false };
let cloudHydrating = false;
let lexiconLoadState = isLexiconReady() ? "ready" : "idle";
let lexiconLoadPromise = null;
let courseDraft = null;
let courseActiveLessonId = null;
let courseMode = "all";
let courseCurrentTurnIndex = 0;
let courseRecordingSession = null;
let courseRecordingAudio = null;
let courseRecordingUrls = new Map();
let audioDbPromise = null;
let courseSegmentStart = 0;
let courseSegmentEnd = 0;
// True after the last full run finished, so the next play starts from the top.
let courseRunFinished = false;
// A timeline drag in progress (see the timeline handler).
let courseScrubbing = false;
let courseScrubWasPlaying = false;
// Set while getUserMedia is waiting for permission, so a second click cannot start a second recorder.
let courseRecordingStarting = false;
let courseProgressTimer = 0;
let courseProgressRatio = 0;
let courseProgressTickerState = null;
let phrasePracticeDisplayMode = "original";
let phrasePracticePromptLanguage = "original";
let phrasePracticeSpeaking = false;
let selectedCourseWord = null;
let dictionaryCache = new Map();
let courseWordDetailRunId = 0;
let courseSentenceDetailRunId = 0;
let translationCache = new Map();
let courseTranslationPendingIds = new Set();
let courseTranslationErrorIds = new Set();
let courseTranslationRuns = new Map();
let courseEnrichmentRuns = new Map();
let courseEnrichmentQueue = Promise.resolve();
let localAiClient = null;
let localAiClientKey = "";
// After a timeout / unreachable error, background AI work pauses for a minute
// instead of retrying every sentence against a server that is not answering.
const AI_DOWN_COOLDOWN_MS = 60000;
let aiDownUntil = 0;
// One AbortController per lesson so deleting or replacing work can cancel its requests.
const aiAbortControllers = new Map();
// Lessons whose background run was requested again while one was still running.
const courseEnrichmentRerun = new Set();
// A non-loopback Ollama address only counts after the user confirmed it on this
// device. The approval is stored under its own key, so backups, imports and
// synced settings can never carry it.
const AI_ENDPOINT_APPROVAL_KEY = "oofr.ai-endpoint-approved.v1";
let approvedAiEndpoint = "";
let coursePracticeIndex = 0;
let coursePracticeRevealed = false;
let phrasePracticeItems = [];
let phrasePracticeIndex = 0;
let phrasePracticeRevealed = false;
let phrasePracticeLastSpokenKey = "";
let phrasePracticeFinished = false;
let libraryAlbumScope = "";
let libraryMaterialFilter = "all";
let libraryMaterialSearch = "";
let courseMaterialAnalysis = null;
let pendingLearningPackage = null;
let courseAnalysisTimer = 0;
let courseAnalysisRunId = 0;
let lastLocalAiError = null;

initApp().catch(handleStartupFailure);

// If startup throws, replace the endless loading card with a way out.
function handleStartupFailure(error) {
  console.error("OoFR failed to start", error);
  const loader = elements.startupLoader;
  const card = loader?.querySelector?.(".startup-card");
  if (!loader || !card || loader.classList.contains("is-hidden")) {
    setStatus("部分功能没有加载成功，可以刷新页面重试");
    return;
  }
  const actions = el("div", "storage-notice-actions");
  actions.append(
    button("下载原始数据", "command-button", () => void downloadStoredState(), "download"),
    button("刷新页面", "command-button primary", () => window.location.reload(), "refresh")
  );
  card.replaceChildren(
    el("p", "eyebrow", "OoFR"),
    el("h2", "", "启动时出了问题"),
    el("p", "startup-stage", "你的学习数据没有被改动。建议先下载一份原始数据留底，再刷新页面重试。"),
    actions
  );
}

async function downloadStoredState() {
  let text = "";
  try {
    text = await storageDriver.getRaw(APP_STORAGE_KEY);
  } catch {
    // The active store itself may be what is broken; try the plain localStorage copy.
    try {
      text = window.localStorage.getItem(APP_STORAGE_KEY) || "";
    } catch {
      text = "";
    }
  }
  if (text) downloadText(text, `oofr-raw-data-${dateStamp()}.json`);
  else setStatus("没有找到可下载的本地数据");
}

// Asks the browser not to evict our data under storage pressure (matters on
// iOS Safari, which can clear idle sites). Safe to ignore if refused.
function requestPersistentStorage() {
  try {
    void navigator.storage?.persist?.()?.catch(() => {});
  } catch {
    // Not supported in this context.
  }
}

async function initApp() {
  hydrateIcons();
  updateStartupProgress("state", "读取本地课程和词句", 18);
  state = await loadAppState();
  updateStartupProgress("settings", "恢复播放和显示设置", 38);
  await applySyncedSettings();
  renderCloudSync();
  updateStartupProgress("settings", "准备课程操作", 52);
  bindEvents();
  ensureSelections();
  syncSettingsControls();
  loadVoices();
  updateStartupProgress("screen", "绘制课程、磁带和词句本", 72);
  renderAll();
  updateStartupProgress("ready", "基础界面已就绪", 100);
  hideStartupLoader();
  registerServiceWorker();
  requestPersistentStorage();
  loadLexiconWhenIdle();
  void hydrateVocabularyFromStructuredDictionary();
  // Background AI work starts only once the local AI is known to be up
  // (on the desktop it may still be starting Ollama).
  void loadAiEndpointApproval()
    .then(() => initializeRuntimeAi())
    .catch((error) => console.error("OoFR AI start-up failed", error))
    .finally(scheduleActiveLessonEnrichment);

  if (canSpeak()) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  } else {
    setStatus("当前浏览器不支持朗读");
  }
}

async function initCloudSync() {
  if (!CLOUD_SYNC_ENABLED) {
    renderCloudSync();
    return;
  }
  cloudSyncState.configured = Boolean(globalThis.OoFRCloud?.isConfigured?.());
  const localMeta = readCloudLocalMeta();
  cloudSyncState.lastSyncAt = localMeta.lastSyncAt || null;
  if (!cloudSyncState.configured) {
    renderCloudSync();
    return;
  }

  try {
    cloudSyncState.session = await globalThis.OoFRCloud.getSession();
    renderCloudSync();
    if (cloudSyncState.session) {
      await syncCloudNow({ prefer: "smart", silent: true });
    }
  } catch (error) {
    cloudSyncState.session = null;
    renderCloudSync();
    setStatus(`云端登录状态暂时不可用：${error.message}`);
  }
}

function readCloudLocalMeta() {
  try {
    const raw = window.localStorage.getItem(CLOUD_LOCAL_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCloudLocalMeta(next) {
  window.localStorage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({
    ...readCloudLocalMeta(),
    ...next
  }));
}

function renderCloudSync() {
  if (!elements.cloudSyncStatus) return;
  if (!CLOUD_SYNC_ENABLED) {
    cloudSyncState.configured = false;
    cloudSyncState.session = null;
    elements.cloudSyncBadge.textContent = "该功能暂未开放";
    elements.cloudSyncBadge.classList.add("is-unavailable");
    elements.cloudSyncStatus.textContent = "1.0.0 暂不提供账号登录或自动同步，学习数据只保存在当前设备。";
    elements.cloudSyncLoggedOut.hidden = false;
    elements.cloudSyncLoggedIn.hidden = true;
    elements.cloudSyncEmail.disabled = true;
    elements.cloudSyncLoginBtn.disabled = true;
    elements.cloudSyncLoginHint.textContent = "可先在课程页导出学习包，再在手机导入离线复习。";
    return;
  }
  const configured = cloudSyncState.configured;
  const session = cloudSyncState.session;
  elements.cloudSyncLoggedOut.hidden = Boolean(session);
  elements.cloudSyncLoggedIn.hidden = !session;
  elements.cloudSyncLoginBtn.disabled = cloudSyncState.busy || !configured;
  elements.cloudSyncNowBtn.disabled = cloudSyncState.busy;
  elements.cloudSyncSignOutBtn.disabled = cloudSyncState.busy;

  if (!configured) {
    elements.cloudSyncBadge.textContent = "本地模式";
    elements.cloudSyncStatus.textContent = "云端尚未配置；当前仍可完整使用本地学习功能。";
    elements.cloudSyncLoginHint.textContent = "完成 Supabase 配置后即可登录同步。";
    return;
  }

  if (!session) {
    elements.cloudSyncBadge.textContent = "未登录";
    elements.cloudSyncStatus.textContent = "未登录时，学习数据只保存在当前设备。";
    elements.cloudSyncLoginHint.textContent = "登录链接会发到你的邮箱。";
    return;
  }

  const email = session.user?.email || "已登录账户";
  elements.cloudSyncBadge.textContent = cloudSyncState.busy ? "同步中" : "已登录";
  elements.cloudSyncAccount.textContent = `账户：${email}`;
  elements.cloudSyncStatus.textContent = cloudSyncState.lastSyncAt
    ? `已登录 · 上次同步：${formatCloudSyncTime(cloudSyncState.lastSyncAt)}`
    : "已登录 · 尚未完成首次同步";
}

function formatCloudSyncTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

async function requestCloudLogin() {
  const email = String(elements.cloudSyncEmail?.value || "").trim();
  if (!email || !email.includes("@")) {
    setStatus("请输入有效邮箱");
    elements.cloudSyncEmail?.focus();
    return;
  }
  if (!cloudSyncState.configured) {
    setStatus("云端尚未配置，请先完成 Supabase 设置");
    return;
  }
  cloudSyncState.busy = true;
  renderCloudSync();
  try {
    await globalThis.OoFRCloud.requestMagicLink(email);
    elements.cloudSyncLoginHint.textContent = "登录链接已发送，请打开邮箱中的链接完成登录。";
    setStatus("登录链接已发送");
  } catch (error) {
    setStatus(`登录链接发送失败：${error.message}`);
  } finally {
    cloudSyncState.busy = false;
    renderCloudSync();
  }
}

async function signOutCloud() {
  if (!cloudSyncState.session) return;
  cloudSyncState.busy = true;
  renderCloudSync();
  await globalThis.OoFRCloud.signOut(cloudSyncState.session);
  cloudSyncState.session = null;
  cloudSyncState.busy = false;
  renderCloudSync();
  setStatus("已退出云端账户，本地数据仍保留");
}

async function syncCloudNow({ prefer = "local", silent = false } = {}) {
  if (!cloudSyncState.session || cloudSyncState.busy) return;
  cloudSyncState.busy = true;
  renderCloudSync();
  try {
    const snapshot = await globalThis.OoFRCloud.fetchSnapshot(cloudSyncState.session);
    const localMeta = readCloudLocalMeta();
    const remoteIsNewer = snapshot?.updated_at && localMeta.lastLocalChangeAt
      ? new Date(snapshot.updated_at).getTime() >= new Date(localMeta.lastLocalChangeAt).getTime()
      : Boolean(snapshot?.payload && !localMeta.lastLocalChangeAt);
    const shouldPull = snapshot?.payload && (prefer === "remote" || (prefer === "smart" && remoteIsNewer));
    if (shouldPull) {
      cloudHydrating = true;
      state = ensureStateShape(snapshot.payload);
      ensureSelections();
      persist({ skipCloud: true });
      cloudHydrating = false;
      renderAll();
    } else {
      await globalThis.OoFRCloud.saveSnapshot(cloudSyncState.session, state);
    }
    const syncedAt = new Date().toISOString();
    cloudSyncState.lastSyncAt = syncedAt;
    writeCloudLocalMeta({ lastSyncAt: syncedAt });
    if (!silent) setStatus(shouldPull ? "已从云端恢复学习数据" : "学习数据已同步到云端");
  } catch (error) {
    if (!silent) setStatus(`云端同步失败，本地数据仍可使用：${error.message}`);
  } finally {
    cloudHydrating = false;
    cloudSyncState.busy = false;
    renderCloudSync();
  }
}

function queueCloudSync() {
  if (!CLOUD_SYNC_ENABLED) return;
  if (!cloudSyncState.session || cloudHydrating) return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    syncCloudNow({ prefer: "local", silent: true });
  }, 1200);
}

function updateStartupProgress(step, message, progress) {
  if (!elements.startupLoader) return;
  const stepOrder = ["state", "settings", "screen", "ready"];
  const currentIndex = Math.max(0, stepOrder.indexOf(step));
  elements.startupLoader.dataset.startupStep = step;
  if (elements.startupStage) elements.startupStage.textContent = message;
  if (elements.startupProgressBar) elements.startupProgressBar.style.width = `${progress}%`;
  if (elements.startupProgressValue) elements.startupProgressValue.textContent = `${progress}%`;
  if (elements.startupProgressTrack) elements.startupProgressTrack.setAttribute("aria-valuenow", String(progress));
  elements.startupSteps.forEach((node, index) => {
    node.classList.toggle("is-done", index < currentIndex);
    node.classList.toggle("is-current", index === currentIndex);
  });
}

function hideStartupLoader() {
  if (!elements.startupLoader) return;
  elements.startupLoader.classList.add("is-hidden");
  window.setTimeout(() => elements.startupLoader?.remove(), 260);
}

// The 5 MB legacy lexicon is only a fallback behind the sharded dictionary, so
// it must not compete with the first screen: wait until the page is idle.
function loadLexiconWhenIdle() {
  const start = () => { void loadLexiconInBackground(); };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 4000 });
  else window.setTimeout(start, 1500);
}

function loadLexiconInBackground() {
  if (isLexiconReady()) {
    handleLexiconReady(false);
    return Promise.resolve();
  }

  if (lexiconLoadPromise) return lexiconLoadPromise;

  lexiconLoadState = "loading";
  renderLexiconLoadState();

  lexiconLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = LEXICON_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (isLexiconReady()) {
        handleLexiconReady(true);
      } else {
        handleLexiconFailure();
      }
      resolve();
    };
    script.onerror = () => {
      handleLexiconFailure();
      resolve();
    };
    document.head.append(script);
  });

  return lexiconLoadPromise;
}

function handleLexiconReady(loadedInBackground) {
  lexiconLoadState = "ready";
  hydrateVocabularyFromLexicon();
  renderLexiconLoadState();

  if (loadedInBackground) {
    window.setTimeout(() => {
      if (lexiconLoadState === "ready") {
        setLexiconStatus("");
      }
    }, 2200);
  }
}

function handleLexiconFailure() {
  lexiconLoadState = "failed";
  renderLexiconLoadState();
}

function renderLexiconLoadState() {
  if (lexiconLoadState === "loading") {
    setLexiconStatus("词库后台加载中，朗读可先用");
  } else if (lexiconLoadState === "ready") {
    setLexiconStatus("词库已就绪");
  } else if (lexiconLoadState === "failed") {
    setLexiconStatus("词库暂时没加载成功，朗读仍可用");
  } else {
    setLexiconStatus("");
  }
}

function setLexiconStatus(text) {
  if (elements.lexiconStatus) {
    elements.lexiconStatus.textContent = text;
  }
}

function hydrateVocabularyFromLexicon() {
  if (!state || !isLexiconReady()) return;
  const before = JSON.stringify(state.vocabulary);
  state.vocabulary = normalizeVocabularyList(state.vocabulary);
  state.vocabulary.forEach((item) => {
    item.wordbookIds = validWordbookIds(item.wordbookIds);
  });
  if (selectedWord) {
    selectedWord.info = resolveWordInfo(selectedWord.raw);
  }
  // Nothing new learned from the lexicon: no save, no repaint (this ran on every start).
  if (JSON.stringify(state.vocabulary) === before) {
    if (selectedWord) renderWordPanel();
    return;
  }
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
  renderMy();
}

const PLACEHOLDER_TEXT_PATTERN = /待补充|暂无|正在查询|稍后自动补全|词库加载中/;

function hasMeaningfulText(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !PLACEHOLDER_TEXT_PATTERN.test(text);
}

// Only words that still lack a meaning, IPA or part of speech need the
// dictionary; complete words are left exactly as the user last saw them.
function vocabularyNeedsDictionaryFill(item) {
  return !hasMeaningfulText(item.zh) || !hasMeaningfulText(item.ipa) || !String(item.partOfSpeech || "").trim();
}

async function hydrateVocabularyFromStructuredDictionary() {
  if (!state || !window.OOFR_DICTIONARY?.lookup || !state.vocabulary.length) return;
  const incomplete = state.vocabulary.filter(vocabularyNeedsDictionaryFill);
  if (!incomplete.length) return;
  try {
    await window.OOFR_DICTIONARY.ready();
    const updates = await Promise.all(incomplete.map(async (item) => {
      const surface = preferredVocabularySurface(item);
      const language = item.language === "en" ? "en" : "fr";
      const local = await window.OOFR_DICTIONARY.lookup(surface, language);
      return { item, surface, language, local };
    }));
    let changed = false;
    updates.forEach(({ item, surface, language, local }) => {
      if (!local) return;
      const presentation = vocabularyPresentation(surface, { lemma: local.lemma, pos: local.pos }, language);
      const next = {
        word: presentation.displayWord,
        surface: presentation.surface,
        lemma: presentation.lemma,
        normalized: presentation.identity,
        partOfSpeech: local.pos || item.partOfSpeech || "",
        ipa: isVerbPartOfSpeech(local.pos) ? (local.ipa || item.ipa) : (local.formIpa || local.ipa || item.ipa),
        zh: local.zh || item.zh,
        en: local.en || item.en || "",
        language
      };
      Object.entries(next).forEach(([key, value]) => {
        if (!value || item[key] === value) return;
        // Meaning and IPA are editable by the user: only ever fill them in.
        if ((key === "zh" || key === "ipa") && hasMeaningfulText(item[key])) return;
        item[key] = value;
        changed = true;
      });
    });
    if (!changed) return;
    state.vocabulary = normalizeVocabularyList(state.vocabulary);
    persist();
    renderWordbooks();
    renderVocab();
    renderSentences();
    renderWordPanel();
  } catch {
    // The compact embedded lexicon remains available when dictionary files cannot be fetched.
  }
}

function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.dataset.icon;
    if (icons[name]) {
      node.insertAdjacentHTML("afterbegin", icons[name]);
    }
  });
}

function bindEvents() {
  elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.activeView = button.dataset.viewTarget;
      persist();
      renderView();
      if (state.ui.activeView === "my") renderMy();
    });
  });

  elements.studyCheckinBtn.addEventListener("click", markTodayCheckin);
  elements.studyShareBtn.addEventListener("click", shareStudyAchievement);
  if (CLOUD_SYNC_ENABLED) {
    elements.cloudSyncLoginBtn?.addEventListener("click", requestCloudLogin);
    elements.cloudSyncNowBtn?.addEventListener("click", () => syncCloudNow({ prefer: "local" }));
    elements.cloudSyncSignOutBtn?.addEventListener("click", signOutCloud);
  }
  elements.systemLanguageSelect.addEventListener("change", () => {
    state.settings.systemLanguage = elements.systemLanguageSelect.value;
    document.documentElement.lang = state.settings.systemLanguage === "fr" ? "fr" : state.settings.systemLanguage === "en" ? "en" : "zh-CN";
    if (courseDraft) courseDraft.explainLanguage = systemExplainLanguage();
    if (elements.courseExplainLanguageSelect) elements.courseExplainLanguageSelect.value = systemExplainLanguage();
    persist();
    renderCoursePlayer();
    setStatus("系统语言设置已保存");
  });
  elements.localAiEndpointInput.addEventListener("change", saveLocalAiSettings);
  elements.localAiModelInput.addEventListener("change", saveLocalAiSettings);
  elements.localAiTestBtn.addEventListener("click", testLocalAiConnection);
  elements.desktopAiTermsCheck?.addEventListener("change", () => {
    elements.desktopAiInstallBtn.disabled = !elements.desktopAiTermsCheck.checked;
  });
  elements.desktopAiInstallBtn?.addEventListener("click", installDesktopAi);
  elements.desktopAiCancelBtn?.addEventListener("click", cancelDesktopAiSetup);
  elements.desktopAiSetupCloseBtn?.addEventListener("click", () => elements.desktopAiSetupDialog?.close());

  bindCourseEvents();

  elements.input.addEventListener("input", () => {
    state.currentText = elements.input.value;
    state.activeEntryId = null;
    selectedWord = null;
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderActiveEntryLine();
      renderSentences();
      renderWordPanel();
      persist();
    }, 100);
  });

  elements.playAllReader.addEventListener("click", toggleAllSentences);
  elements.stopReader.addEventListener("click", stopSpeech);
  elements.saveEntryBtn.addEventListener("click", openSaveCurrentDialog);
  elements.refreshBtn.addEventListener("click", renderSentences);

  elements.sampleBtn.addEventListener("click", () => {
    stopSpeech();
    setCurrentText(SAMPLE_TEXT, null);
  });

  elements.clearBtn.addEventListener("click", () => {
    stopSpeech();
    setCurrentText("", null);
    elements.input.focus();
  });

  elements.audioSettingsToggle.addEventListener("click", () => {
    setAudioSettingsOpen(elements.audioSettingsPanel.hidden);
  });

  elements.rateControl.addEventListener("input", () => {
    state.settings.rate = elements.rateControl.value;
    updateLabels();
    persist();
  });

  elements.pauseControl.addEventListener("input", () => {
    state.settings.pause = elements.pauseControl.value;
    updateLabels();
    persist();
  });

  elements.voiceSelect.addEventListener("change", () => {
    state.settings.voice = elements.voiceSelect.value;
    state.settings.voiceLocked = true;
    elements.courseVoiceSelect.value = elements.voiceSelect.value;
    persist();
  });

  elements.repeatGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-repeat]");
    if (!button) return;
    state.settings.repeat = button.dataset.repeat;
    setRepeat(state.settings.repeat);
    persist();
  });

  elements.exportBtn.addEventListener("click", exportData);
  elements.importBtn.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importData);
  elements.desktopAiTermsCopyBtn?.addEventListener("click", async () => {
    const url = "https://ai.google.dev/gemma/terms";
    try {
      await navigator.clipboard.writeText(url);
      elements.desktopAiTermsCopyBtn.textContent = "已复制";
    } catch {
      elements.desktopAiTermsCopyBtn.textContent = url;
    }
  });
  elements.restoreBackupBtn?.addEventListener("click", () => {
    if (window.confirm("用导入前暂存的数据替换当前数据？当前数据会被暂存，可以再点一次切换回来。")) void restoreStateBackup();
  });
  void refreshRestoreButton();
  elements.learningPackageCloseBtn?.addEventListener("click", closeLearningPackagePreview);
  elements.learningPackageCancelBtn?.addEventListener("click", closeLearningPackagePreview);
  elements.learningPackageUpdateBtn?.addEventListener("click", () => importPendingLearningPackage("update"));
  elements.learningPackageCopyBtn?.addEventListener("click", () => importPendingLearningPackage("copy"));
  elements.wordbookExportBtn.addEventListener("click", exportWordbooks);
  elements.wordbookImportBtn.addEventListener("click", () => elements.wordbookImportFile.click());
  elements.wordbookImportFile.addEventListener("change", importWordbooks);

  elements.wordPlayBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    togglePlayback(
      [{ text: selectedWord.raw, element: selectedWord.element, label: selectedWord.raw, lang: "fr-FR", forceFrench: true }],
      { key: `word:${selectedWord.normalized}`, label: selectedWord.raw }
    );
  });

  elements.wordAddBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    addWordToVocabulary(selectedWord.raw);
    persist();
    renderWordbooks();
    renderVocab();
    renderSentences();
    renderWordPanel();
  });

  elements.wordToggleBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = ensureVocabularyItem(selectedWord.raw);
    trackSeenForm(item, selectedWord.raw);
    item.status = item.status === "got" ? "new" : "got";
    item.updatedAt = nowIso();
    persist();
    renderWordbooks();
    renderVocab();
    renderSentences();
    renderWordPanel();
  });

  elements.wordEditBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = ensureVocabularyItem(selectedWord.raw);
    openVocabDialog(item.id);
  });

  elements.wordDeleteBtn.addEventListener("click", () => {
    if (!selectedWord) return;
    const item = findVocabulary(selectedWord.raw);
    if (!item) return;
    deleteVocabulary(item.id);
  });

  elements.wordPanelCloseBtn.addEventListener("click", closeWordPanel);

  elements.newAlbumBtn.addEventListener("click", () => openAlbumDialog());
  elements.newMaterialBtn.addEventListener("click", openNewMaterialFromLibrary);
  elements.materialSearchInput.addEventListener("input", () => {
    libraryMaterialSearch = elements.materialSearchInput.value.trim();
    renderLibraryDetail();
  });
  elements.materialFilterButtons.forEach((filterButton) => {
    filterButton.addEventListener("click", () => {
      libraryMaterialFilter = filterButton.dataset.materialFilter || "all";
      renderLibraryDetail();
    });
  });
  elements.newVocabBtn.addEventListener("click", () => openVocabDialog());
  elements.newWordbookBtn.addEventListener("click", () => openWordbookDialog());
  elements.vocabSearch.addEventListener("input", renderVocab);
  elements.phraseSourceFilter.addEventListener("change", renderVocab);
  elements.phraseDateFilter.addEventListener("change", renderVocab);
  elements.phraseStatusFilter.addEventListener("change", renderVocab);
  elements.phrasePracticeBtn.addEventListener("click", openPhrasePractice);
  elements.phrasePracticeBackBtn.addEventListener("click", closePhrasePractice);
  elements.phrasePracticeSpeakBtn.addEventListener("click", () => speakCurrentPhraseCard(true));
  elements.phrasePracticeDisplayMode.addEventListener("change", () => {
    phrasePracticeDisplayMode = elements.phrasePracticeDisplayMode.value;
    phrasePracticePromptLanguage = phrasePracticeDisplayMode === "random"
      ? (Math.random() > 0.5 ? "translation" : "original")
      : phrasePracticeDisplayMode;
    phrasePracticeLastSpokenKey = "";
    renderPhrasePractice();
  });
  elements.phrasePracticeRevealBtn.addEventListener("click", revealPhrasePracticeAnswer);
  elements.phrasePracticeAgainBtn.addEventListener("click", () => advancePhrasePractice(false));
  elements.phrasePracticeKnownBtn.addEventListener("click", () => advancePhrasePractice(true));

  elements.dialogCloseBtn.addEventListener("click", closeDialog);
  elements.dialogCancelBtn.addEventListener("click", closeDialog);
  elements.dialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (dialogSubmitHandler) {
      const checked = validateRequiredDialogValues(collectDialogValues(), dialogRequiredFields);
      if (!checked.ok) {
        elements.dialogForm.elements?.[checked.field]?.focus?.();
        setStatus("请填写必填项");
        return;
      }
      const shouldClose = dialogSubmitHandler(checked.values);
      if (shouldClose !== false) closeDialog();
    }
  });

  document.addEventListener("click", closeWordPanelOnOutsideClick);
  document.addEventListener("click", closeCourseWordPopoverOnOutsideClick);
  window.addEventListener("resize", positionWordPanel);
  window.addEventListener("scroll", positionWordPanel, { passive: true });
  window.addEventListener("resize", positionCourseWordPopover);
  window.addEventListener("scroll", positionCourseWordPopover, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (selectedWord) closeWordPanel();
    if (elements.courseWordPopover && !elements.courseWordPopover.hidden) {
      const anchor = selectedCourseWord?.anchor;
      closeCourseWordPopover();
      if (anchor?.isConnected) anchor.focus?.();
    }
    if (elements.courseVoiceOptions && !elements.courseVoiceOptions.hidden) {
      closeCompactVoiceMenu();
      elements.courseVoiceButton.focus?.();
    }
    if (elements.courseCustomOptions && !elements.courseCustomOptions.hidden) {
      closeCourseCustomMenu();
      elements.courseCustomButton.focus?.();
    }
  });
}

function closeCourseWordPopoverOnOutsideClick(event) {
  if (!selectedCourseWord || elements.courseWordPopover.hidden) return;
  if (event.target.closest?.("#courseWordPopover") || event.target.closest?.(".course-word-button") || event.target.closest?.(".course-word-list-item")) return;
  closeCourseWordPopover();
}

function bindCourseEvents() {
  if (!elements.courseNewBtn) return;

  elements.courseNewBtn.addEventListener("click", () => {
    courseDraft = createEmptyCourseDraft();
    courseMaterialAnalysis = null;
    renderCourseMaterialAnalysis();
    syncCourseComposer();
    setCourseStage("composer");
  });

  elements.courseBackToLibraryBtn.addEventListener("click", () => setCourseStage("player"));
  elements.courseBackToPlayerBtn.addEventListener("click", () => setCourseStage("player"));
  elements.courseGenerateBtn.addEventListener("click", generateDemoCourse);
  elements.courseEditBtn.addEventListener("click", () => {
    const lesson = getActiveCourseLesson();
    if (!lesson) return;
    courseDraft = draftFromCourseLesson(lesson);
    syncCourseComposer();
    setCourseStage("composer");
  });
  elements.coursePracticeBtn.addEventListener("click", openCoursePractice);
  elements.courseSpeakerSelect.addEventListener("change", () => {
    if (elements.courseSpeakerSelect.value !== "all") courseMode = "speaker";
    stopCoursePlaybackForSettingChange();
    renderCoursePlayer();
  });
  elements.courseTranslationToggle.addEventListener("change", renderCoursePlayer);
  elements.courseBottomTranslationToggle.addEventListener("change", () => {
    elements.courseTranslationToggle.checked = elements.courseBottomTranslationToggle.checked;
    renderCoursePlayer();
  });
  elements.courseRateSelect.addEventListener("change", () => {
    state.settings.rate = elements.courseRateSelect.value;
    persist();
    syncCourseRateButton();
  });
  // Narrow screens show a button instead of the menu: each tap picks the next speed.
  elements.courseRateButton?.addEventListener("click", () => {
    const options = Array.from(elements.courseRateSelect.options);
    const next = options[(elements.courseRateSelect.selectedIndex + 1) % options.length];
    elements.courseRateSelect.value = next.value;
    elements.courseRateSelect.dispatchEvent(new Event("change"));
  });
  elements.courseVoiceSelect.addEventListener("change", () => {
    state.settings.voice = elements.courseVoiceSelect.value;
    state.settings.voiceLocked = Boolean(elements.courseVoiceSelect.value);
    elements.voiceSelect.value = elements.courseVoiceSelect.value;
    persist();
    renderCompactVoiceMenu();
  });
  elements.courseSegmentStart.addEventListener("change", () => {
    courseSegmentStart = Number(elements.courseSegmentStart.value || 0);
    courseSegmentEnd = Math.max(courseSegmentEnd, courseSegmentStart);
    stopCoursePlaybackForSettingChange();
    renderCoursePlayer();
  });
  elements.courseSegmentEnd.addEventListener("change", () => {
    courseSegmentEnd = Math.max(courseSegmentStart, Number(elements.courseSegmentEnd.value || courseSegmentStart));
    stopCoursePlaybackForSettingChange();
    renderCoursePlayer();
  });
  elements.courseRepeatSelect?.addEventListener("change", () => {
    state.settings.repeat = elements.courseRepeatSelect.value;
    setRepeat(state.settings.repeat);
    persist();
    renderCourseProgress(getActiveCourseLesson() || { turns: [] });
  });
  elements.coursePauseSelect?.addEventListener("change", () => {
    state.settings.pause = elements.coursePauseSelect.value;
    updateLabels();
    persist();
    renderCourseProgress(getActiveCourseLesson() || { turns: [] });
  });
  elements.courseFastBackBtn.addEventListener("click", () => seekCourseBy(-1));
  elements.courseFastForwardBtn.addEventListener("click", () => seekCourseBy(1));
  elements.courseBottomPlayBtn.addEventListener("click", playCourseSelection);
  // Dragging only moves the position; the sentence list is rebuilt once on release,
  // and playback that was running continues from the chosen sentence.
  elements.courseTimeline.addEventListener("input", () => {
    const lesson = getActiveCourseLesson();
    const total = lesson?.turns.length || 1;
    if (!courseScrubbing) {
      courseScrubbing = true;
      courseScrubWasPlaying = playback.status === "playing";
      stopSpeech({ quiet: true });
    }
    courseCurrentTurnIndex = Math.min(total - 1, Math.max(0, Math.round((Number(elements.courseTimeline.value || 0) / 1000) * total)));
    courseRunFinished = false;
    elements.coursePlaybackStatus.textContent = `已定位到第 ${courseCurrentTurnIndex + 1} / ${total} 句`;
  });
  elements.courseTimeline.addEventListener("change", () => {
    if (!courseScrubbing) return;
    const resume = courseScrubWasPlaying;
    courseScrubbing = false;
    courseScrubWasPlaying = false;
    renderCoursePlayer();
    findCourseTurnRow(courseCurrentTurnIndex)?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
    setStatus(`已定位到第 ${courseCurrentTurnIndex + 1} 句`);
    if (resume) playCourseSelection({ startFromCurrent: true });
  });
  elements.courseVoiceButton.addEventListener("click", toggleCompactVoiceMenu);
  elements.courseExportLearningPackageBtn?.addEventListener("click", exportActiveLearningPackage);
  elements.courseImportLearningPackageBtn?.addEventListener("click", () => elements.courseLearningPackageFile?.click());
  elements.courseLearningPackageFile?.addEventListener("change", previewLearningPackageFile);
  elements.courseExportRecordingsBtn.addEventListener("click", exportCourseRecordings);
  elements.courseWordPopoverCloseBtn.addEventListener("click", closeCourseWordPopover);
  elements.courseWordFavoriteBtn.addEventListener("click", toggleCourseWordFavorite);
  elements.coursePopoverWordPlayBtn.addEventListener("click", playSelectedCourseWord);
  elements.coursePopoverLookupBtn.addEventListener("click", openCourseWordDetail);
  elements.courseWordDetailCloseBtn?.addEventListener("click", closeCourseWordDetail);
  elements.courseWordDetailDialog?.addEventListener("click", (event) => {
    if (event.target === elements.courseWordDetailDialog) closeCourseWordDetail();
  });
  elements.courseWordDetailDialog?.addEventListener("close", () => { courseWordDetailRunId += 1; });
  elements.courseSentenceDetailCloseBtn?.addEventListener("click", closeCourseSentenceDetail);
  elements.courseSentenceDetailDialog?.addEventListener("click", (event) => {
    if (event.target === elements.courseSentenceDetailDialog) closeCourseSentenceDetail();
  });
  elements.courseSentenceDetailDialog?.addEventListener("close", () => { courseSentenceDetailRunId += 1; });
  elements.courseRevealBtn.addEventListener("click", revealCoursePracticeAnswer);
  elements.courseAgainBtn.addEventListener("click", () => advanceCoursePractice(false));
  elements.courseKnownBtn.addEventListener("click", () => advanceCoursePractice(true));
  elements.courseMaterialInput.addEventListener("input", () => {
    if (courseDraft) courseDraft.text = elements.courseMaterialInput.value;
    scheduleCourseMaterialAnalysis({ deep: false });
  });
  elements.courseMaterialInput.addEventListener("paste", () => {
    window.setTimeout(() => scheduleCourseMaterialAnalysis({ deep: true, immediate: true }), 0);
  });
  elements.courseTitleInput.addEventListener("input", () => {
    if (courseDraft) courseDraft.title = elements.courseTitleInput.value;
  });
  elements.courseLanguageSelect.addEventListener("change", () => {
    if (courseDraft) courseDraft.language = elements.courseLanguageSelect.value;
  });
  elements.courseExplainLanguageSelect.addEventListener("change", () => {
    if (courseDraft) courseDraft.explainLanguage = elements.courseExplainLanguageSelect.value;
  });
  elements.courseMaterialTypeSelect.addEventListener("change", () => {
    if (courseDraft) courseDraft.materialType = elements.courseMaterialTypeSelect.value;
  });
  elements.courseMaterialFile.addEventListener("change", handleCourseMaterialFile);
  elements.courseAnalyzeBtn.addEventListener("click", () => analyzeCourseMaterial({ deep: true }));
  elements.courseApplySentenceBreaksBtn.addEventListener("click", applyDetectedSentenceBreaks);
  elements.courseApplySpeakersBtn.addEventListener("click", applyDetectedSpeakers);
  elements.courseApplyCorrectionsBtn.addEventListener("click", applySuggestedCorrections);
  elements.courseCustomButton.addEventListener("click", toggleCourseCustomMenu);
  document.querySelectorAll("[data-course-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      courseMode = button.dataset.courseMode;
      if (courseMode !== "speaker") elements.courseSpeakerSelect.value = "all";
      stopCoursePlaybackForSettingChange();
      syncCourseCustomMenu();
      renderCoursePlayer();
    });
  });
  document.addEventListener("click", closeCompactVoiceMenuOnOutsideClick);
  document.addEventListener("click", closeCourseCustomMenuOnOutsideClick);
  window.addEventListener("storage", handleStorageEvent);
  storageDriver.onExternalChange?.(handleExternalStateChange);
  globalThis.chrome?.storage?.onChanged?.addListener?.(handleExtensionStorageChange);
  // Release the microphone (and keep the take so far) when the page is left or backgrounded.
  window.addEventListener("pagehide", stopCourseRecordingSession);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCourseRecordingSession();
  });
}

function createEmptyCourseDraft() {
  return {
    title: "我的学习素材",
    language: "fr",
    explainLanguage: systemExplainLanguage(),
    materialType: "自定义文本",
    text: ""
  };
}

function createDemoCourseLesson() {
  const timestamp = nowIso();
  return normalizeCourseLesson({
    id: "demo_lesson",
    title: "每天十分钟法语",
    language: "fr",
    explainLanguage: "zh",
    materialType: "情景对话",
    description: "用一段轻量对话练习问候、重复和时间表达。",
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [
      { id: "demo_turn_1", text: "Bonjour, comment allez-vous aujourd'hui ?", translation: "你好，今天过得怎么样？", speakerId: "a", speakerLabel: "A · Camille", recording: { status: "recorded", durationMs: 1800, mediaKey: "demo:turn-1" } },
      { id: "demo_turn_2", text: "Je vais bien, merci. Et vous ?", translation: "我很好，谢谢。你呢？", speakerId: "b", speakerLabel: "B · Alex", recording: { status: "none", durationMs: 0, mediaKey: "" } },
      { id: "demo_turn_3", text: "Je voudrais pratiquer le français pendant dix minutes.", translation: "我想练习十分钟法语。", speakerId: "a", speakerLabel: "A · Camille", recording: { status: "recorded", durationMs: 2200, mediaKey: "demo:turn-3" } },
      { id: "demo_turn_4", text: "Bien sûr, on peut commencer quand vous voulez.", translation: "当然，你想什么时候开始都可以。", speakerId: "b", speakerLabel: "B · Alex", recording: { status: "none", durationMs: 0, mediaKey: "" } },
      { id: "demo_turn_5", text: "Pouvez-vous répéter cette phrase plus lentement ?", translation: "你可以把这句话说慢一点吗？", speakerId: "a", speakerLabel: "A · Camille", recording: { status: "none", durationMs: 0, mediaKey: "" } },
      { id: "demo_turn_6", text: "Bien sûr. À tout à l'heure !", translation: "当然。待会儿见！", speakerId: "b", speakerLabel: "B · Alex", recording: { status: "none", durationMs: 0, mediaKey: "" } }
    ],
    practice: { completed: 0, correct: 0 }
  });
}

function createDemoPhraseItems() {
  const timestamp = nowIso();
  return [
    normalizePhraseItem({ id: "demo_phrase_1", type: "phrase", text: "Bonjour, comment allez-vous aujourd'hui ?", translation: "你好，今天过得怎么样？", sourceLessonId: "demo_lesson", sourceTitle: "每天十分钟法语", language: "fr", status: "learning", wordbookIds: [], createdAt: timestamp, updatedAt: timestamp }),
    normalizePhraseItem({ id: "demo_phrase_2", type: "phrase", text: "Pouvez-vous répéter cette phrase plus lentement ?", translation: "你可以把这句话说慢一点吗？", sourceLessonId: "demo_lesson", sourceTitle: "每天十分钟法语", language: "fr", status: "new", wordbookIds: [], createdAt: timestamp, updatedAt: timestamp }),
    normalizePhraseItem({ id: "demo_word_1", type: "word", text: "pratiquer", translation: "练习；实践", sourceLessonId: "demo_lesson", sourceTitle: "每天十分钟法语", language: "fr", status: "got", wordbookIds: [], createdAt: timestamp, updatedAt: timestamp })
  ].filter(Boolean);
}

function normalizePhraseItem(item) {
  if (!item?.text) return null;
  const status = ["new", "learning", "got"].includes(item.status) ? item.status : "new";
  return {
    id: String(item.id || makeId("phrase")),
    type: item.type === "word" ? "word" : "phrase",
    text: String(item.text).trim(),
    translation: String(item.translation || "").trim(),
    sourceLessonId: String(item.sourceLessonId || ""),
    sourceTitle: String(item.sourceTitle || "自定义素材"),
    language: item.language === "en" ? "en" : "fr",
    status,
    wordbookIds: cleanWordbookIds(Array.isArray(item.wordbookIds) ? item.wordbookIds : []),
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso(),
    lastPracticedAt: item.lastPracticedAt || null,
    dueDate: item.dueDate || null,
    practiceCount: Math.max(0, Number(item.practiceCount || 0))
  };
}

function normalizeCourseLesson(lesson) {
  if (!lesson?.id || !lesson?.title) return null;
  const materialType = String(lesson.materialType || "自定义文本");
  const forceNarration = ["文章", "笔记", "歌词"].includes(materialType);
  const usedTurnIds = new Set();
  const turns = Array.isArray(lesson.turns) ? lesson.turns.map((turn, index) => {
    const proposedId = String(turn.id || "");
    const id = proposedId && !usedTurnIds.has(proposedId)
      ? proposedId
      : `${lesson.id}_turn_${index + 1}`;
    usedTurnIds.add(id);
    return {
      id,
      text: String(turn.text || "").trim(),
      translation: String(turn.translation || "").trim(),
      speakerId: forceNarration ? "narrator" : String(turn.speakerId || (index % 2 === 0 ? "a" : "b")),
      speakerLabel: forceNarration ? "旁白" : String(turn.speakerLabel || (index % 2 === 0 ? "A" : "B")),
      aiExplanation: turn.aiExplanation && typeof turn.aiExplanation === "object" ? {
        summary: String(turn.aiExplanation.summary || ""),
        structure: String(turn.aiExplanation.structure || ""),
        grammarPoints: Array.isArray(turn.aiExplanation.grammarPoints) ? turn.aiExplanation.grammarPoints.map(String) : [],
        morphology: String(turn.aiExplanation.morphology || ""),
        pitfalls: Array.isArray(turn.aiExplanation.pitfalls) ? turn.aiExplanation.pitfalls.map(String) : [],
        examples: Array.isArray(turn.aiExplanation.examples) ? turn.aiExplanation.examples.map(String) : [],
        model: String(turn.aiExplanation.model || ""),
        language: String(turn.aiExplanation.language || ""),
        version: String(turn.aiExplanation.version || ""),
        cacheSource: String(turn.aiExplanation.cacheSource || ""),
        generatedAt: turn.aiExplanation.generatedAt || null
      } : null,
      recording: normalizeCourseRecording(turn.recording)
    };
  }).filter((turn) => turn.text) : [];
  return {
    id: String(lesson.id),
    title: String(lesson.title),
    language: lesson.language === "en" ? "en" : "fr",
    explainLanguage: ["zh", "en", "fr"].includes(lesson.explainLanguage) ? lesson.explainLanguage : "zh",
    materialType,
    description: String(lesson.description || ""),
    createdAt: lesson.createdAt || nowIso(),
    updatedAt: lesson.updatedAt || nowIso(),
    aiPreparedAt: lesson.aiPreparedAt || null,
    aiPreparedSignature: String(lesson.aiPreparedSignature || ""),
    turns,
    lexicalUnits: Array.isArray(lesson.lexicalUnits) ? lesson.lexicalUnits.map((item) => ({
      text: String(item.text || "").trim(),
      lemma: String(item.lemma || item.text || "").trim(),
      type: String(item.type || "expression").trim(),
      verified: item.verified === "dictionary" ? "dictionary" : ""
    })).filter((item) => item.text && item.text.length <= 64).slice(0, 200) : [],
    practice: {
      completed: Math.max(0, Number(lesson.practice?.completed || 0)),
      correct: Math.max(0, Number(lesson.practice?.correct || 0))
    }
  };
}

function normalizeCourseRecording(recording) {
  const mediaKey = String(recording?.mediaKey || "");
  const isDemoRecording = mediaKey.startsWith("demo:");
  return {
    status: !isDemoRecording && recording?.status === "recorded" ? "recorded" : "none",
    durationMs: isDemoRecording ? 0 : Math.max(0, Number(recording?.durationMs || 0)),
    mediaKey: isDemoRecording ? "" : mediaKey,
    mimeType: isDemoRecording ? "" : String(recording?.mimeType || ""),
    size: isDemoRecording ? 0 : Math.max(0, Number(recording?.size || 0))
  };
}

function draftFromCourseLesson(lesson) {
  const includeSpeakers = lesson.materialType === "情景对话";
  return {
    title: lesson.title,
    language: lesson.language,
    explainLanguage: lesson.explainLanguage,
    materialType: lesson.materialType,
    text: lesson.turns.map((turn) => includeSpeakers ? `${turn.speakerLabel}: ${turn.text}` : turn.text).join("\n"),
    editingId: lesson.id,
    lexicalUnits: lesson.lexicalUnits || []
  };
}

function getActiveCourseLesson() {
  return state.courseLessons?.find((lesson) => lesson.id === courseActiveLessonId) || state.courseLessons?.[0] || null;
}

function setCourseStage(stage) {
  if (!elements.courseLibraryPanel) return;
  if (stage === "library") stage = "player";
  elements.courseLibraryPanel.hidden = true;
  elements.courseComposerPanel.hidden = stage !== "composer";
  elements.coursePlayerPanel.hidden = stage !== "player";
  elements.coursePracticePanel.hidden = stage !== "practice";
  if (stage === "library") renderCourseLibrary();
  if (stage === "player") renderCoursePlayer();
  if (stage === "practice") renderCoursePractice();
}

function syncCourseComposer() {
  if (!courseDraft) return;
  // A running analysis belongs to the previous draft; its result must not land here.
  courseAnalysisRunId += 1;
  elements.courseTitleInput.value = courseDraft.title;
  elements.courseLanguageSelect.value = courseDraft.language;
  elements.courseExplainLanguageSelect.value = courseDraft.explainLanguage;
  elements.courseMaterialTypeSelect.value = courseDraft.materialType;
  elements.courseMaterialInput.value = courseDraft.text;
  renderCourseMaterialAnalysis();
}

function handleCourseMaterialFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (!courseDraft) courseDraft = createEmptyCourseDraft();
    courseDraft.text = String(reader.result || "");
    syncCourseComposer();
    setStatus(`已载入素材：${file.name}`);
    void analyzeCourseMaterial({ deep: true });
  });
  reader.readAsText(file);
  event.target.value = "";
}

function scheduleCourseMaterialAnalysis({ deep = false, immediate = false } = {}) {
  window.clearTimeout(courseAnalysisTimer);
  const delay = immediate ? 0 : 650;
  courseAnalysisTimer = window.setTimeout(() => analyzeCourseMaterial({ deep }), delay);
}

const MAX_DEEP_ANALYSIS_CHARS = 2000;

async function analyzeCourseMaterial({ deep = false } = {}) {
  const text = String(elements.courseMaterialInput.value || "").trim();
  if (!text || text.length < 4) {
    courseMaterialAnalysis = null;
    renderCourseMaterialAnalysis();
    return;
  }
  const runId = ++courseAnalysisRunId;
  const draftAtStart = courseDraft;
  const local = analyzeMaterialLocally(text);
  courseMaterialAnalysis = local;
  applyDetectedMaterialMetadata(local);
  renderCourseMaterialAnalysis();
  if (!deep) return;
  if (!localAiRuntimeEnabled()) {
    elements.courseAnalysisStatus.textContent = "已使用本地规则；在线 AI 暂未开放，可在 macOS 版继续深度分析。";
    return;
  }
  if (text.length > MAX_DEEP_ANALYSIS_CHARS) {
    // The answer repeats the text several times and would be cut off by the model's output limit.
    elements.courseAnalysisStatus.textContent = `素材较长（超过 ${MAX_DEEP_ANALYSIS_CHARS} 字），已使用本地规则；可以分段后再深度分析。`;
    return;
  }

  elements.courseAnalysisStatus.textContent = "本地规则已完成，正在尝试本机开源 AI…";
  const aiResult = await analyzeMaterialWithLocalAi(text, local);
  // The learner may have closed the composer, opened another one or kept typing.
  if (runId !== courseAnalysisRunId || courseDraft !== draftAtStart || String(elements.courseMaterialInput.value || "").trim() !== text) return;
  if (!aiResult) {
    elements.courseAnalysisStatus.textContent = `已使用本地规则；${describeLocalAiError(lastLocalAiError)}。`;
    return;
  }
  courseMaterialAnalysis = mergeMaterialAnalysis(local, aiResult);
  applyDetectedMaterialMetadata(courseMaterialAnalysis);
  renderCourseMaterialAnalysis();
}

function analyzeMaterialLocally(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const lower = ` ${text.toLocaleLowerCase()} `;
  const frenchScore = (lower.match(/[àâçéèêëîïôùûüÿœæ]/g) || []).length * 2
    + (lower.match(/\b(je|tu|vous|nous|le|la|les|des|une|est|suis|avec|pour|pas|bonjour|merci)\b/g) || []).length;
  const englishScore = (lower.match(/\b(the|and|you|i|we|is|are|with|for|not|hello|thanks|would)\b/g) || []).length;
  const language = frenchScore >= englishScore ? "fr" : "en";
  const speakerMap = new Map();
  const dialogueLines = [];
  lines.forEach((line) => {
    const match = line.match(/^([^:：]{1,24})[:：]\s*(.+)$/u);
    if (!match) return;
    const sourceSpeaker = match[1].trim();
    if (!speakerMap.has(sourceSpeaker)) speakerMap.set(sourceSpeaker, String.fromCharCode(65 + Math.min(25, speakerMap.size)));
    dialogueLines.push({ speaker: speakerMap.get(sourceSpeaker), text: match[2].trim(), sourceSpeaker });
  });
  const isDialogue = speakerMap.size >= 2 && dialogueLines.length >= 2;
  const speakerText = isDialogue ? dialogueLines.map((line) => `${line.speaker}: ${line.text}`).join("\n") : "";
  const sentenceCount = lines.flatMap(splitSentenceChunks).length;
  const lyricLikeLines = lines.filter((line) => line.length < 72 && !/[.!?。！？]$/.test(line)).length;
  const looksLikeLyrics = lines.length > 5 && (new Set(lines).size < lines.length || lyricLikeLines / lines.length > 0.65);
  const materialType = isDialogue ? "情景对话" : looksLikeLyrics ? "歌词" : text.length > 280 || sentenceCount >= 4 ? "文章" : "笔记";
  const firstContent = (dialogueLines[0]?.text || lines[0] || "我的学习素材").replace(/[.!?。！？].*$/u, "").trim();
  const title = firstContent.length > 28 ? `${firstContent.slice(0, 28)}…` : firstContent;
  let correctedText = String(text).replace(/\r\n?/g, "\n");
  const corrections = [];
  const trimmedLines = correctedText.split("\n").map((line) => line.trim().replace(/[ \t]{2,}/g, " ")).join("\n").trim();
  if (trimmedLines !== correctedText) {
    const original = correctedText;
    correctedText = trimmedLines;
    corrections.push({ type: "format", original, replacement: correctedText, reason: "清理行首尾空格和连续空格，让逐句拆分更稳定。" });
  }
  const spaced = correctedText.replace(/([.!?。！？,，;；:：])(?=[\p{L}\p{N}])/gu, "$1 ");
  if (spaced !== correctedText) {
    const original = correctedText;
    correctedText = spaced;
    corrections.push({ type: "format", original, replacement: correctedText, reason: "补充标点后的必要空格，避免两个句子或词被错误连在一起。" });
  }
  const lexicalUnits = Object.keys(KNOWN_LEXICAL_UNITS)
    .filter((unit) => lower.includes(` ${unit.toLocaleLowerCase()} `) || lower.includes(unit.toLocaleLowerCase()))
    .map((unit) => ({ text: unit, lemma: KNOWN_LEXICAL_UNITS[unit].lemma, type: "expression" }));
  const sentenceText = formatMaterialIntoSentenceLines(correctedText, { isDialogue });
  return { source: "rules", language, materialType, title, isDialogue, dialogueLines, speakerText, sentenceText, correctedText, corrections, lexicalUnits };
}

async function analyzeMaterialWithLocalAi(text, fallback) {
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      language: { type: "string", enum: ["fr", "en"] },
      materialType: { type: "string", enum: ["情景对话", "文章", "歌词", "笔记", "自定义文本"] },
      isDialogue: { type: "boolean" },
      dialogueLines: { type: "array", items: { type: "object", properties: { speaker: { type: "string" }, text: { type: "string" } }, required: ["speaker", "text"] } },
      sentenceText: { type: "string" },
      correctedText: { type: "string" },
      corrections: { type: "array", items: { type: "object", properties: { type: { type: "string" }, original: { type: "string" }, replacement: { type: "string" }, reason: { type: "string" } }, required: ["type", "original", "replacement", "reason"] } },
      lexicalUnits: { type: "array", items: { type: "object", properties: { text: { type: "string" }, lemma: { type: "string" }, type: { type: "string" } }, required: ["text", "lemma", "type"] } }
    },
    required: ["title", "language", "materialType", "isDialogue", "dialogueLines", "sentenceText", "correctedText", "corrections", "lexicalUnits"]
  };
  const prompt = `Analyze this language-learning material. Detect French or English and classify it. Set isDialogue=true only when the text genuinely contains two or more people taking turns speaking; an article, narration, list, heading, colon, quotation, or reported speech is not automatically a dialogue. Only for genuine dialogue, identify speakers and rename them A/B/C in order. Find fixed expressions and inflected verbs with their lemmas. Return sentenceText with every sentence on its own line; preserve A/B/C labels only for genuine dialogue and never add speaker labels to an article or narration. Review spelling, grammar, word choice, register, ambiguity, and content that may be inappropriate for the apparent context. Propose a corrected version while preserving the author's intent and every meaningful detail. For every change, include the exact original excerpt, proposed replacement, type, and a concise reason. Do not silently rewrite or omit content. If no correction is needed, keep correctedText identical and return an empty corrections array. Correction explanations must use ${systemExplainLanguage()}. Return only the required JSON.\n\nMATERIAL:\n${text}`;
  try {
    const response = await createLocalAiClient(120000).chatJson({ prompt, schema, timeoutMs: 120000 });
    const result = response.data;
    result.source = "ollama";
    result.model = response.model;
    lastLocalAiError = null;
    return result;
  } catch (error) {
    lastLocalAiError = error;
    return null;
  }
}

// Text the model returns may only re-break or relabel the learner's text, never
// change its words; compare ignoring whitespace and "Name:" / "A:" line labels.
function sameWordsIgnoringLayout(a, b) {
  const squash = (value) => String(value || "").replace(/^\s*[^:：\n]{1,24}[:：]\s*/gmu, "").replace(/\s+/g, "");
  return squash(a) === squash(b);
}

function mergeMaterialAnalysis(local, ai) {
  const aiLines = Array.isArray(ai.dialogueLines)
    ? ai.dialogueLines.filter((line) => line?.text).map((line, index) => ({ ...line, sourceSpeaker: local.dialogueLines[index]?.sourceSpeaker || "" }))
    : [];
  // The model's dialogue lines are only trusted when they still hold the learner's words.
  const aiKeepsWords = aiLines.length > 0 && sameWordsIgnoringLayout(aiLines.map((line) => line.text).join("\n"), local.correctedText);
  const aiSaysDialogue = ai.isDialogue === true && ai.materialType === "情景对话";
  const dialogueLines = aiKeepsWords ? aiLines : local.dialogueLines;
  const isDialogue = aiSaysDialogue
    && (aiKeepsWords ? new Set(dialogueLines.map((line) => line.speaker)).size >= 2 : local.isDialogue);
  return {
    ...local,
    ...ai,
    source: "ollama",
    isDialogue,
    dialogueLines: isDialogue ? dialogueLines : [],
    speakerText: isDialogue ? dialogueLines.map((line, index) => `${String(line.speaker || String.fromCharCode(65 + index)).toUpperCase()}: ${line.text}`).join("\n") : "",
    sentenceText: ai.sentenceText && sameWordsIgnoringLayout(ai.sentenceText, local.correctedText) ? String(ai.sentenceText) : local.sentenceText,
    corrections: Array.isArray(ai.corrections) ? ai.corrections : local.corrections,
    lexicalUnits: Array.isArray(ai.lexicalUnits) ? ai.lexicalUnits : local.lexicalUnits
  };
}

function applyDetectedMaterialMetadata(analysis) {
  if (!courseDraft || !analysis) return;
  const previous = courseDraft.autoValues || {};
  const titleCanChange = !courseDraft.title || courseDraft.title === "我的学习素材" || courseDraft.title === previous.title;
  const languageCanChange = !previous.language || courseDraft.language === previous.language;
  const typeCanChange = !previous.materialType || courseDraft.materialType === previous.materialType || courseDraft.materialType === "自定义文本";
  if (titleCanChange && analysis.title) courseDraft.title = analysis.title;
  if (languageCanChange && ["fr", "en"].includes(analysis.language)) courseDraft.language = analysis.language;
  if (typeCanChange && analysis.materialType) courseDraft.materialType = analysis.materialType;
  courseDraft.lexicalUnits = analysis.lexicalUnits || [];
  courseDraft.autoValues = { title: analysis.title, language: analysis.language, materialType: analysis.materialType };
  elements.courseTitleInput.value = courseDraft.title;
  elements.courseLanguageSelect.value = courseDraft.language;
  elements.courseMaterialTypeSelect.value = courseDraft.materialType;
}

function renderCourseMaterialAnalysis() {
  if (!elements.courseAnalysisPanel) return;
  const analysis = courseMaterialAnalysis;
  elements.courseAnalysisPanel.hidden = !analysis;
  if (!analysis) {
    elements.courseAnalysisStatus.textContent = "粘贴或导入文本后会自动识别语言、类型、标题和说话人。";
    return;
  }
  elements.courseAnalysisSource.textContent = analysis.source === "ollama" ? "本机开源 AI" : "本地规则";
  const speakers = new Set((analysis.dialogueLines || []).map((line) => line.speaker)).size;
  elements.courseAnalysisSummary.textContent = `${analysis.language === "en" ? "英语" : "法语"} · ${analysis.materialType}${analysis.isDialogue ? ` · 识别到 ${speakers} 位说话人` : ""} · ${(analysis.lexicalUnits || []).length} 个词句单元`;
  elements.courseAnalysisReasons.replaceChildren();
  const corrections = (analysis.corrections || []).filter((item) => item?.reason);
  if (!corrections.length) elements.courseAnalysisReasons.append(el("p", "micro-copy", "未发现需要确认的基础格式问题。连接本机开源 AI 后还可检查语法、措辞和语境。"));
  else corrections.forEach((correction) => {
    const card = el("article", "course-analysis-reason");
    card.append(el("strong", "", correction.reason));
    const originalExcerpt = shortenAnalysisExcerpt(correction.original);
    const replacementExcerpt = shortenAnalysisExcerpt(correction.replacement);
    if (originalExcerpt && replacementExcerpt && originalExcerpt !== replacementExcerpt) {
      card.append(el("span", "course-analysis-change", `原文：${originalExcerpt}`));
      card.append(el("span", "course-analysis-change is-proposed", `建议：${replacementExcerpt}`));
    }
    elements.courseAnalysisReasons.append(card);
  });
  const current = String(elements.courseMaterialInput.value || "").trim();
  elements.courseApplySentenceBreaksBtn.hidden = !analysis.sentenceText || analysis.sentenceText.trim() === current;
  elements.courseApplySpeakersBtn.hidden = !analysis.isDialogue || !analysis.speakerText || analysis.speakerText.trim() === current;
  elements.courseApplyCorrectionsBtn.hidden = !analysis.correctedText || analysis.correctedText.trim() === current;
  elements.courseAnalysisStatus.textContent = analysis.source === "ollama" ? "本机 AI 分析完成；修改原文前需要你确认。" : "本地规则分析完成；可继续生成课程或尝试本机 AI。";
}

function shortenAnalysisExcerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function applyDetectedSpeakers() {
  if (!courseMaterialAnalysis?.speakerText) return;
  const previous = courseMaterialAnalysis;
  const speakerText = previous.speakerText;
  elements.courseMaterialInput.value = speakerText;
  courseDraft.text = speakerText;
  const refreshed = analyzeMaterialLocally(speakerText);
  courseMaterialAnalysis = {
    ...refreshed,
    source: previous.source,
    correctedText: relabelDialogueText(previous.correctedText, previous.dialogueLines),
    corrections: previous.corrections,
    lexicalUnits: previous.lexicalUnits
  };
  setStatus("已应用 A/B/C 说话人标记");
  renderCourseMaterialAnalysis();
}

function applyDetectedSentenceBreaks() {
  if (!courseMaterialAnalysis?.sentenceText) return;
  const sentenceText = courseMaterialAnalysis.sentenceText;
  elements.courseMaterialInput.value = sentenceText;
  courseDraft.text = sentenceText;
  courseMaterialAnalysis = analyzeMaterialLocally(sentenceText);
  applyDetectedMaterialMetadata(courseMaterialAnalysis);
  setStatus("已按单句换行；你仍可以继续编辑");
  renderCourseMaterialAnalysis();
}

function splitSentenceChunks(value) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const chunks = source.match(/[^.!?。！？]+(?:[.!?。！？]+[”’"'»)]*|$)/gu) || [source];
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function formatMaterialIntoSentenceLines(value, { isDialogue = detectDialogueStructure(value) } = {}) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((rawLine) => {
      const line = rawLine.trim();
      if (!line) return [];
      const dialogue = isDialogue ? line.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/u) : null;
      if (!dialogue) return splitSentenceChunks(line);
      const label = dialogue[1].trim();
      return splitSentenceChunks(dialogue[2]).map((sentence) => `${label}: ${sentence}`);
    })
    .join("\n");
}

function relabelDialogueText(text, dialogueLines) {
  let result = String(text || "");
  const labels = new Map();
  (dialogueLines || []).forEach((line) => {
    if (line.sourceSpeaker && line.speaker) labels.set(line.sourceSpeaker, String(line.speaker).toUpperCase());
  });
  labels.forEach((label, sourceSpeaker) => {
    const escaped = sourceSpeaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`^${escaped}\\s*[:：]`, "gmu"), `${label}:`);
  });
  return result;
}

function applySuggestedCorrections() {
  if (!courseMaterialAnalysis?.correctedText) return;
  if (!window.confirm("确认用建议修正版替换当前原文？替换后仍可继续手工修改。")) return;
  elements.courseMaterialInput.value = courseMaterialAnalysis.correctedText;
  courseDraft.text = courseMaterialAnalysis.correctedText;
  courseMaterialAnalysis = analyzeMaterialLocally(courseDraft.text);
  setStatus("已替换为确认后的修正版");
  renderCourseMaterialAnalysis();
}

function generateDemoCourse() {
  const draft = courseDraft || createEmptyCourseDraft();
  draft.title = elements.courseTitleInput.value.trim() || "我的学习素材";
  draft.language = elements.courseLanguageSelect.value;
  draft.explainLanguage = elements.courseExplainLanguageSelect.value;
  draft.materialType = elements.courseMaterialTypeSelect.value;
  draft.text = elements.courseMaterialInput.value.trim();
  if (!draft.text) {
    elements.courseMaterialInput.focus();
    setStatus("请先输入一段素材");
    return;
  }

  const isDialogue = draft.materialType === "情景对话" && Boolean(courseMaterialAnalysis?.isDialogue || detectDialogueStructure(draft.text));
  const freshTurns = splitCourseTurns(draft.text, { materialType: draft.materialType }).map((item, index) => ({
    id: makeId("turn"),
    text: item.text,
    translation: draft.explainLanguage === "zh" ? "译文待补充" : "Translation pending",
    speakerId: isDialogue ? (item.speakerId || (index % 2 === 0 ? "a" : "b")) : "narrator",
    speakerLabel: isDialogue ? (item.speakerLabel || (index % 2 === 0 ? "A" : "B")) : "旁白",
    recording: { status: "none", durationMs: 0, mediaKey: "" }
  }));
  // Editing keeps translations, explanations and recordings of unchanged sentences.
  const editingLesson = draft.editingId ? state.courseLessons.find((item) => item.id === draft.editingId) : null;
  const sameExplainLanguage = editingLesson?.explainLanguage === draft.explainLanguage;
  const carried = carryOverTurns(editingLesson?.turns || [], freshTurns, { translations: sameExplainLanguage, explanations: sameExplainLanguage });
  if (carried.dropped.length && !window.confirm(`有 ${carried.dropped.length} 句录音对应的句子被改动或删除，保存后这些录音会被移除。继续吗？`)) {
    setStatus("已取消保存，课程没有改动");
    return;
  }
  const turns = carried.turns;
  queueRecordingRelease(carried.dropped.map((turn) => turn.recording.mediaKey));
  const lesson = normalizeCourseLesson({
    id: draft.editingId || makeId("lesson"),
    title: draft.title,
    language: draft.language,
    explainLanguage: draft.explainLanguage,
    materialType: draft.materialType,
    description: `${turns.length} 句 · 演示课程`,
    lexicalUnits: courseMaterialAnalysis?.lexicalUnits || draft.lexicalUnits || [],
    turns,
    practice: { completed: 0, correct: 0 }
  });
  const existingIndex = state.courseLessons.findIndex((item) => item.id === lesson.id);
  if (existingIndex >= 0) state.courseLessons.splice(existingIndex, 1, lesson);
  else state.courseLessons.unshift(lesson);
  let linkedEntry = state.entries.find((entry) => entry.courseLessonId === lesson.id);
  const linkedTape = linkedEntry ? getTape(linkedEntry.tapeId) : null;
  let album = linkedTape ? getAlbum(linkedTape.albumId) : state.albums.find((item) => item.courseLessonId === lesson.id);
  if (!album) {
    album = getAlbum(state.ui.selectedAlbumId) || state.albums[0] || createAlbum("我的学习素材", "从课程页创建的素材", pickAlbumColor());
  }
  const materialTapeId = linkedEntry?.tapeId || ensureTapeForAlbum(album.id);
  if (linkedEntry) {
    linkedEntry.title = lesson.title;
    linkedEntry.text = draft.text;
    linkedEntry.language = lesson.language;
    linkedEntry.materialType = lesson.materialType;
    linkedEntry.updatedAt = nowIso();
  } else {
    linkedEntry = createEntry(materialTapeId, lesson.title, draft.text, "从课程页创建", { language: lesson.language, materialType: lesson.materialType, courseLessonId: lesson.id });
  }
  linkedEntry.courseLessonId = lesson.id;
  state.ui.selectedAlbumId = album.id;
  state.ui.selectedTapeId = materialTapeId;
  libraryAlbumScope = album.id;
  courseActiveLessonId = lesson.id;
  state.activeCourseId = lesson.id;
  persist();
  courseDraft = null;
  courseCurrentTurnIndex = 0;
  setCourseStage("player");
  setStatus("课程已生成，正在自动生成译文…");
  scheduleCourseBackgroundEnrichment(lesson);
}

function splitCourseTurns(text, { materialType = "" } = {}) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => line.trim() ? [line.trim()] : [])
    .flatMap((line) => line.includes("\t") ? line.split("\t") : [line]);
  const isDialogue = materialType === "情景对话" || (!materialType && detectDialogueStructure(text));
  const source = lines.flatMap((line) => {
    const match = isDialogue ? line.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/) : null;
    if (match) {
      return splitSentenceChunks(match[2]).map((sentence) => ({
        speakerLabel: match[1].trim(),
        speakerId: normalizeCourseSpeakerId(match[1]),
        text: sentence
      }));
    }
    return splitSentenceChunks(line).map((sentence) => ({ text: sentence }));
  });
  return source.filter((item) => item.text);
}

function detectDialogueStructure(text) {
  const labels = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/u))
    .filter(Boolean)
    .map((match) => normalizeWord(match[1]));
  return labels.length >= 2 && new Set(labels.filter(Boolean)).size >= 2;
}

function inferStoredMaterialType(text) {
  if (detectDialogueStructure(text)) return "情景对话";
  const sentenceCount = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap(splitSentenceChunks)
    .length;
  return String(text || "").length > 240 || sentenceCount >= 4 ? "文章" : "笔记";
}

function normalizeCourseSpeakerId(label) {
  const normalized = normalizeWord(label);
  if (/^[a-z]$/.test(normalized)) return normalized;
  if (/^(b|alex|teacher|landlord|friend|assistant|对方|乙)$/.test(normalized)) return "b";
  return "a";
}

function renderCourse() {
  if (!elements.courseLessonCards) return;
  if (!state.courseLessons?.length) state.courseLessons = [createDemoCourseLesson()];
  renderCourseLibrary();
  if (!courseActiveLessonId) courseActiveLessonId = state.activeCourseId || state.courseLessons[0]?.id || null;
}

function renderCourseLibrary() {
  const lessons = state.courseLessons || [];
  elements.courseLessonCards.replaceChildren();
  lessons.forEach((lesson) => {
    const card = el("article", "course-lesson-card");
    const language = lesson.language === "en" ? "英语" : "法语";
    const explain = lesson.explainLanguage === "en" ? "English explanation" : "中文解释";
    const recordedCount = lesson.turns.filter((turn) => turn.recording.status === "recorded").length;
    card.append(
      el("div", "course-card-kicker", lesson.materialType),
      el("h3", "", lesson.title),
      el("p", "course-lesson-description", lesson.description || "自定义学习素材"),
      el("div", "course-lesson-meta", `${language} · ${explain} · ${lesson.turns.length} 句 · ${recordedCount} 句已录音`)
    );
    const actions = el("div", "course-card-actions");
    actions.append(
      button("打开课程", "command-button primary", () => {
        courseActiveLessonId = lesson.id;
        state.activeCourseId = lesson.id;
        courseCurrentTurnIndex = 0;
        persist();
        setCourseStage("player");
      }, "play"),
      button("复制素材", "command-button", () => {
        courseDraft = draftFromCourseLesson(lesson);
        syncCourseComposer();
        setCourseStage("composer");
      }, "edit")
    );
    card.append(actions);
    elements.courseLessonCards.append(card);
  });
}

function renderCoursePlayer() {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  // Switching to another lesson ends the recording and playback of the previous one.
  if (courseRecordingSession && courseRecordingSession.lessonId !== lesson.id) stopCourseRecordingSession();
  if (playback.status !== "idle" && playback.key.startsWith("course:") && !playback.key.startsWith(`course:${lesson.id}:`)) {
    stopSpeech({ quiet: true });
  }
  if (applyKnownLocalTranslations(lesson)) persist();
  elements.coursePlayerTitle.textContent = lesson.title;
  elements.coursePlayerMeta.textContent = `${lesson.language === "en" ? "英语" : "法语"} · ${lesson.explainLanguage === "en" ? "English explanation" : "中文解释"} · ${lesson.turns.length} 句`;
  if (elements.courseMicHint) elements.courseMicHint.textContent = "逐句录音使用本机麦克风，音频只保存在当前设备。";
  elements.courseBottomTitle.textContent = lesson.title;
  elements.courseBottomHint.textContent = courseMode === "loop"
    ? `循环第 ${courseSegmentStart + 1}–${courseSegmentEnd + 1} 句`
    : courseMode === "single"
      ? `循环第 ${courseCurrentTurnIndex + 1} 句`
      : courseMode === "speaker" ? "按说话人练习对话" : "时间轴按句定位";
  const speakers = Array.from(new Map(lesson.turns.map((turn) => [turn.speakerId, turn.speakerLabel])).entries());
  const selectedSpeaker = elements.courseSpeakerSelect.value;
  elements.courseSpeakerSelect.replaceChildren(new Option("全部说话人", "all"));
  speakers.forEach(([id, label]) => elements.courseSpeakerSelect.append(new Option(label, id)));
  elements.courseSpeakerSelect.value = speakers.some(([id]) => id === selectedSpeaker) ? selectedSpeaker : "all";
  courseSegmentStart = Math.min(courseSegmentStart, Math.max(0, lesson.turns.length - 1));
  courseSegmentEnd = Math.min(Math.max(courseSegmentEnd, courseSegmentStart), Math.max(0, lesson.turns.length - 1));
  elements.courseSegmentStart.replaceChildren(...lesson.turns.map((turn, index) => new Option(`第 ${index + 1} 句`, String(index))));
  elements.courseSegmentEnd.replaceChildren(...lesson.turns.map((turn, index) => new Option(`第 ${index + 1} 句`, String(index))));
  elements.courseSegmentStart.value = String(courseSegmentStart);
  elements.courseSegmentEnd.value = String(courseSegmentEnd);
  elements.courseBottomTranslationToggle.checked = elements.courseTranslationToggle.checked;
  syncCourseVoiceSelect();
  syncCourseCustomMenu();
  renderCourseTranscript(lesson);
  renderCourseWordList(lesson);
  renderCourseProgress(lesson);
}

function getCourseVisibleTurns(lesson) {
  if (courseMode === "single") return lesson.turns.slice(courseCurrentTurnIndex, courseCurrentTurnIndex + 1);
  if (courseMode === "loop") return lesson.turns.slice(courseSegmentStart, courseSegmentEnd + 1);
  if (courseMode === "speaker") {
    const speaker = elements.courseSpeakerSelect.value;
    return speaker === "all" ? lesson.turns : lesson.turns.filter((turn) => turn.speakerId === speaker);
  }
  return lesson.turns;
}

function renderCourseTranscript(lesson) {
  const visibleTurns = getCourseVisibleTurns(lesson);
  elements.courseTranscriptList.replaceChildren();
  visibleTurns.forEach((turn) => {
    const originalIndex = lesson.turns.findIndex((item) => item.id === turn.id);
    const isPlayingRow = playback.status !== "idle" && playback.key.startsWith("course:") && originalIndex === courseCurrentTurnIndex;
    const row = el("article", `course-turn-row${originalIndex === courseCurrentTurnIndex ? " is-current" : ""}${isPlayingRow ? " is-playing" : ""}`);
    row.dataset.turnId = turn.id;
    const top = el("div", "course-turn-top");
    top.append(el("span", "course-turn-number", String(originalIndex + 1).padStart(2, "0")), el("span", "speaker-chip", turn.speakerLabel));
    const text = el("p", "course-turn-text");
    text.lang = lesson.language === "en" ? "en" : "fr";
    appendCourseWords(text, turn.text, lesson);
    const translationPending = courseTranslationPendingIds.has(turn.id);
    const translationFailed = courseTranslationErrorIds.has(turn.id);
    const translationText = translationPending
      ? (lesson.explainLanguage === "zh" ? "本机 AI 正在生成译文…" : "Local AI is translating…")
      : turn.translation || (isHostedOnlineRuntime()
        ? (lesson.explainLanguage === "en" ? "Generate on OoFR Desktop, then import a learning package" : "需要在桌面端生成，或导入学习包")
        : (lesson.explainLanguage === "en" ? "Translation pending" : "译文待补充"));
    const translation = el("p", `course-turn-translation${translationPending ? " is-pending" : ""}${translationFailed ? " is-error" : ""}`, translationText);
    translation.hidden = !elements.courseTranslationToggle.checked;
    translation.lang = lesson.explainLanguage === "zh" ? "zh-CN" : lesson.explainLanguage;
    const actions = el("div", "course-turn-actions");
    const playButton = button("", "mini-button sentence-play-button", () => playCourseTurn(lesson, originalIndex), "play");
    playButton.dataset.courseTurnIndex = String(originalIndex);
    playButton.title = `播放第 ${originalIndex + 1} 句`;
    playButton.setAttribute("aria-label", playButton.title);
    actions.append(playButton);
    const phraseSaved = isCoursePhraseFavorited(turn, lesson);
    const saveButton = button(phraseSaved ? "已收藏" : "收藏句子", `mini-button phrase-save-button${phraseSaved ? " is-saved" : ""}`, () => toggleCoursePhraseFavorite(turn, lesson), phraseSaved ? "check" : "heart");
    saveButton.setAttribute("aria-pressed", String(phraseSaved));
    actions.append(saveButton);
    if (translationNeedsGeneration(turn) || translationPending || translationFailed) {
      const retryTranslationButton = button(translationPending ? "翻译中…" : "重试翻译", "mini-button translation-retry-button", () => {
        void generateCourseTranslations(lesson, { turnIds: [turn.id] });
      }, "refresh");
      retryTranslationButton.disabled = translationPending;
      actions.append(retryTranslationButton);
    }
    const hasValidExplanation = !aiExplanationNeedsGeneration(turn.aiExplanation, lesson);
    const explanationLabel = hasValidExplanation ? "查看讲解" : isHostedOnlineRuntime() ? "需桌面生成" : "AI 讲解";
    actions.append(button(explanationLabel, "mini-button", () => openCourseSentenceDetail(lesson, originalIndex), "spark"));
    if (courseRecordingSession?.turnId === turn.id) {
      // Recording state lives in the session, never in the saved turn, so an
      // earlier take is not hidden if the page is reloaded mid-recording.
      actions.append(button("停止录音", "mini-button recording-active", () => stopCourseRecording(lesson, turn.id), "stop"));
    } else if (turn.recording.status === "recorded") {
      actions.append(
        button(`我的录音 · ${formatCourseDuration(turn.recording.durationMs)}`, "mini-button recording-ready", () => playCourseRecording(turn), "play"),
        button("重录", "mini-button", () => startCourseRecording(lesson, turn.id), "refresh"),
        button("删除", "mini-button danger-mini", () => deleteCourseRecording(lesson, turn.id), "trash")
      );
    } else {
      actions.append(button("开始录音", "mini-button record-button", () => startCourseRecording(lesson, turn.id), "mic"));
    }
    row.append(top, text, translation, actions);
    elements.courseTranscriptList.append(row);
  });
  renderCourseTurnPlayButtons();
}

function isCoursePhraseFavorited(turn, lesson) {
  return Boolean(state.phraseItems.find((item) => item.sourceLessonId === lesson.id && item.text === turn.text));
}

function renderCourseTurnPlayButtons() {
  elements.courseTranscriptList?.querySelectorAll(".sentence-play-button").forEach((button) => {
    const index = Number(button.dataset.courseTurnIndex);
    const key = `course:${getActiveCourseLesson()?.id}:turn:${index}`;
    const lessonKey = `course:${getActiveCourseLesson()?.id}:`;
    const active = (playback.key === key || playback.key.startsWith(lessonKey)) && playback.status === "playing" && index === courseCurrentTurnIndex;
    const paused = (playback.key === key || playback.key.startsWith(lessonKey)) && playback.status === "paused" && index === courseCurrentTurnIndex;
    setButtonContent(button, active ? "pause" : "play", active ? "暂停" : paused ? "继续" : "播放");
    button.classList.toggle("is-active", active || paused);
    button.title = `${active ? "暂停" : paused ? "继续" : "播放"}第 ${index + 1} 句`;
    button.setAttribute("aria-label", button.title);
  });
}

function appendCourseWords(container, sentence, lesson) {
  const pattern = courseLexicalUnitPattern(lesson);
  const seenCounts = new Map();
  let lastIndex = 0;
  let match = pattern.exec(sentence);
  while (match) {
    if (match.index > lastIndex) container.append(document.createTextNode(sentence.slice(lastIndex, match.index)));
    const rawWord = match[0];
    const word = el("button", "course-word-button", rawWord);
    word.type = "button";
    word.dataset.courseWord = rawWord;
    // Which of several identical words this is, so the dictionary can judge it by its own neighbours.
    const seenKey = normalizeLexicalUnit(rawWord);
    word.dataset.occurrence = String(seenCounts.get(seenKey) || 0);
    seenCounts.set(seenKey, (seenCounts.get(seenKey) || 0) + 1);
    word.addEventListener("click", () => showCourseWordInfo(rawWord, lesson, word));
    container.append(word);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(sentence);
  }
  if (lastIndex < sentence.length) container.append(document.createTextNode(sentence.slice(lastIndex)));
}

function renderCourseWordList(lesson) {
  const firstTurnOfWord = new Map();
  for (const turn of lesson.turns) {
    for (const token of courseTokenize(turn.text)) {
      if (!firstTurnOfWord.has(token)) firstTurnOfWord.set(token, turn.id);
    }
    if (firstTurnOfWord.size >= 12) break;
  }
  const words = [...firstTurnOfWord.keys()].slice(0, 12);
  elements.courseWordCount.textContent = `${words.length} 词`;
  elements.courseWordList.replaceChildren();
  words.forEach((word) => {
    const info = getDemoWordInfo(word, lesson);
    const item = el("button", "course-word-list-item");
    item.type = "button";
    item.dataset.turnId = firstTurnOfWord.get(word);
    item.append(el("strong", "", info.displayWord || info.lemma), el("span", "", info.pos));
    item.addEventListener("click", () => showCourseWordInfo(word, lesson, item));
    elements.courseWordList.append(item);
  });
}

function courseTokenize(text) {
  return String(text || "").match(courseLexicalUnitPattern(getActiveCourseLesson())) || [];
}

// Turn ids can come from imported files, so never splice them into a selector raw.
function turnRowSelector(turnId) {
  const id = String(turnId ?? "");
  const escaped = globalThis.CSS?.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
  return `[data-turn-id="${escaped}"]`;
}

function openCoursePractice() {
  coursePracticeIndex = 0;
  coursePracticeRevealed = false;
  setCourseStage("practice");
}

function renderCoursePractice() {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  const words = Array.from(new Set(lesson.turns.flatMap((turn) => courseTokenize(turn.text))));
  const word = words[coursePracticeIndex % Math.max(1, words.length)] || "bonjour";
  const info = getDemoWordInfo(word, lesson);
  elements.coursePracticeMeta.textContent = `${coursePracticeIndex + 1} / ${Math.max(1, words.length)} · 已完成 ${lesson.practice.completed} 次`;
  elements.coursePracticePrompt.textContent = word;
  elements.coursePracticeAnswer.textContent = lesson.explainLanguage === "en" ? `${info.en} · ${info.ipa}` : `${info.zh} · ${info.ipa}`;
  elements.coursePracticeAnswer.hidden = !coursePracticeRevealed;
  elements.courseRevealBtn.hidden = coursePracticeRevealed;
  elements.courseAgainBtn.hidden = !coursePracticeRevealed;
  elements.courseKnownBtn.hidden = !coursePracticeRevealed;
}

function revealCoursePracticeAnswer() {
  coursePracticeRevealed = true;
  renderCoursePractice();
}

function advanceCoursePractice(correct) {
  const lesson = getActiveCourseLesson();
  if (!lesson) return;
  lesson.practice.completed += 1;
  if (correct) lesson.practice.correct += 1;
  coursePracticeIndex += 1;
  coursePracticeRevealed = false;
  persist();
  renderCoursePractice();
}

function renderAll() {
  ensureSelections();
  renderView();
  renderCourse();
  setCourseStage("player");
  syncInput();
  renderActiveEntryLine();
  updateLabels();
  setRepeat(state.settings.repeat);
  renderSentences();
  renderWordPanel();
  renderLibrary();
  renderWordbooks();
  renderVocab();
  renderMy();
  renderPlaybackControls();
}

function renderView() {
  Object.entries(elements.views).forEach(([name, view]) => {
    if (!view) return;
    view.classList.toggle("is-active", state.ui.activeView === name);
  });

  elements.navButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewTarget === state.ui.activeView));
  });
}

function renderMy() {
  if (!elements.myStats) return;
  elements.myStats.textContent = `${state.albums.length} 磁带 · ${state.entries.length} 素材 · ${state.vocabulary.length + (state.phraseItems || []).length} 词句`;
  renderWordbookExportScopeOptions();
  renderStudySummary();
  renderCloudSync();
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDateKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function touchStudyDay() {
  const study = state.study;
  const today = localDateKey();
  if (study.lastStudyDate === today) return false;
  study.streak = study.lastStudyDate === previousDateKey(today) ? study.streak + 1 : 1;
  study.lastStudyDate = today;
  study.checkins += 1;
  return true;
}

function recordStudyEvent({ cards = 0, known = false } = {}) {
  const study = state.study;
  touchStudyDay();
  study.cardsReviewed += Math.max(0, Number(cards || 0));
  if (known) study.cardsKnown += 1;
  if (study.cardsReviewed >= study.dailyGoal && !study.achievements.includes("first-goal")) study.achievements.push("first-goal");
  if (study.streak >= 3 && !study.achievements.includes("three-day-streak")) study.achievements.push("three-day-streak");
  persist();
  renderMy();
}

function renderStudySummary() {
  if (!elements.studyStatsCards || !state.study) return;
  const study = state.study;
  elements.studyStatsCards.replaceChildren(
    studyStatCard("连续学习", `${study.streak} 天`),
    studyStatCard("复习词句", `${study.cardsReviewed} 条`),
    studyStatCard("记住了", `${study.cardsKnown} 条`),
    studyStatCard("今日目标", `${study.lastStudyDate === localDateKey() ? "已完成" : `完成 ${study.dailyGoal} 条`}`)
  );
  elements.studyAchievements.replaceChildren();
  const achievements = [
    ["first-goal", "完成第一次每日目标"],
    ["three-day-streak", "连续学习 3 天"]
  ];
  achievements.forEach(([id, label]) => elements.studyAchievements.append(el("span", `achievement-chip${study.achievements.includes(id) ? " is-earned" : ""}`, `${study.achievements.includes(id) ? "✓" : "○"} ${label}`)));
  elements.studySummaryHint.textContent = study.lastStudyDate === localDateKey() ? "今天已经留下学习记录，继续保持即可。" : "完成一轮词句卡，或点击今日打卡，就会记录今天的学习。";
  elements.studyCheckinBtn.textContent = study.lastStudyDate === localDateKey() ? "今日已打卡" : "今日打卡";
  elements.studyCheckinBtn.disabled = study.lastStudyDate === localDateKey();
}

function studyStatCard(label, value) {
  const card = el("div", "study-stat-card");
  card.append(el("strong", "", value), el("span", "", label));
  return card;
}

function markTodayCheckin() {
  if (!touchStudyDay()) {
    setStatus("今天已经打卡过了");
    return;
  }
  persist();
  renderMy();
  setStatus("今日打卡完成");
}

async function shareStudyAchievement() {
  const study = state.study;
  const text = `OoFR 学习记录：连续 ${study.streak} 天，已复习 ${study.cardsReviewed} 条词句，掌握 ${study.cardsKnown} 条。`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "OoFR 学习记录", text });
      return;
    } catch {
      // 用户取消分享时保持页面不变。
    }
  }
  await navigator.clipboard?.writeText(text);
  setStatus("学习成就已复制，可粘贴分享");
}

function renderWordbookExportScopeOptions() {
  if (!elements.wordbookExportScope) return;
  const current = elements.wordbookExportScope.value || ALL_WORDBOOK_ID;
  const options = wordbookExportScopeOptions();
  elements.wordbookExportScope.replaceChildren(
    ...options.map((option) => new Option(option.label, option.value))
  );
  elements.wordbookExportScope.value = options.some((option) => option.value === current)
    ? current
    : ALL_WORDBOOK_ID;
}

function wordbookExportScopeOptions() {
  return [
    { value: ALL_WORDBOOK_ID, label: "全部词句本" },
    { value: "current", label: "当前选中词句本" },
    { value: NEW_WORDBOOK_ID, label: "仅 new" },
    { value: GOT_WORDBOOK_ID, label: "仅 got" },
    { value: DIY_WORDBOOK_ID, label: "仅 DIY" },
    ...state.wordbooks.map((wordbook) => ({
      value: wordbookScopeValue(wordbook.id),
      label: `词句本：${wordbook.title}`
    }))
  ];
}

function syncInput() {
  if (elements.input.value !== state.currentText) {
    elements.input.value = state.currentText;
  }
}

function renderActiveEntryLine() {
  const entry = getEntry(state.activeEntryId);
  if (!entry) {
    elements.activeEntryLine.textContent = "临时练习草稿";
    return;
  }

  const tape = getTape(entry.tapeId);
  const album = getAlbum(tape?.albumId);
  const practiced = entry.practiceCount ? ` · 已练 ${entry.practiceCount} 次` : "";
  elements.activeEntryLine.textContent = `${album?.title || "专辑"} / ${tape?.title || "磁带"} / ${entry.title}${practiced}`;
}

function renderSentences() {
  const text = state.currentText.trim();
  sentences = splitSentences(text);
  elements.sentenceList.replaceChildren();

  if (sentences.length === 0) {
    elements.sentenceList.append(emptyState("暂无文本"));
  } else {
    sentences.forEach((sentence, index) => {
      elements.sentenceList.append(createSentenceRow(sentence, index));
    });
  }

  const wordCount = countWords(text);
  elements.textStats.textContent = `${sentences.length} 句 · ${wordCount} 词`;
  elements.playAllReader.disabled = sentences.length === 0;

  if (selectedWord) {
    const replacement = Array.from(elements.sentenceList.querySelectorAll(".word-button"))
      .find((button) => button.dataset.word === selectedWord.raw);
    if (replacement) {
      selectedWord.element = replacement;
    }
  }

  renderPlaybackControls();
}

function createSentenceRow(sentence, index) {
  const row = el("div", "sentence-row");
  row.dataset.index = String(index);
  row.dataset.playbackKey = `sentence:${index}`;

  const playButton = el("button", "icon-button sentence-play play-trigger");
  playButton.type = "button";
  playButton.title = `播放第 ${index + 1} 句`;
  playButton.setAttribute("aria-label", `播放第 ${index + 1} 句`);
  playButton.dataset.playbackKey = row.dataset.playbackKey;
  playButton.innerHTML = icons.speaker;
  playButton.addEventListener("click", () => {
    const key = row.dataset.playbackKey;
    if (!isActivePlayback(key)) {
      recordPracticeIfEntry();
    }
    togglePlayback([{ text: sentence, element: row, label: `第 ${index + 1} 句` }], {
      key,
      label: `第 ${index + 1} 句`
    });
  });

  const text = el("p", "sentence-text");
  text.lang = "fr";
  appendClickableWords(text, sentence);

  const number = el("span", "sentence-number", String(index + 1).padStart(2, "0"));

  row.append(playButton, text, number);
  return row;
}

function appendClickableWords(container, sentence) {
  const pattern = wordPattern();
  let lastIndex = 0;
  let match = pattern.exec(sentence);

  while (match) {
    const word = match[0];
    const start = match.index;

    if (start > lastIndex) {
      container.append(document.createTextNode(sentence.slice(lastIndex, start)));
    }

    const button = el("button", "word-button play-trigger");
    const vocab = findVocabulary(word);
    button.type = "button";
    button.lang = "fr";
    button.textContent = word;
    button.title = `播放 ${word}`;
    button.dataset.word = word;
    if (vocab) {
      button.classList.add(vocab.status === "got" ? "vocab-got" : "vocab-new");
    }
    button.addEventListener("click", () => handleWordClick(word, button));

    container.append(button);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(sentence);
  }

  if (lastIndex < sentence.length) {
    container.append(document.createTextNode(sentence.slice(lastIndex)));
  }
}

function renderWordPanel() {
  if (!selectedWord) {
    elements.wordPanel.hidden = true;
    elements.wordPanel.classList.remove("is-bottom-sheet");
    resetWordPanelPosition();
    return;
  }

  const info = isLexiconReady() ? resolveWordInfo(selectedWord.raw) : (selectedWord.info || resolveWordInfo(selectedWord.raw));
  selectedWord.info = info;
  const vocab = findVocabulary(selectedWord.raw);
  const hint = vocab || info.lexicon || lookupLexicon(selectedWord.raw);
  const status = vocab ? (vocab.status === "got" ? "got" : "生词") : "未加入";
  const ipa = hint?.ipa || (isLexiconLoading() ? "词库加载中" : "音标待补充");
  const zh = hint?.zh || (isLexiconLoading() ? "稍后自动补全" : "释义待补充");
  const formLine = info.lemma !== info.normalized ? `${selectedWord.raw} → ${hint?.word || info.lemma}` : selectedWord.raw;

  elements.wordPanel.hidden = false;
  elements.wordPanelTitle.textContent = formLine;
  elements.wordPanelMeta.textContent = `${status} · ${ipa} · ${zh}`;
  elements.wordAddBtn.hidden = Boolean(vocab);
  elements.wordToggleBtn.hidden = !vocab;
  elements.wordEditBtn.hidden = !vocab;
  elements.wordDeleteBtn.hidden = !vocab;

  if (vocab) {
    elements.wordToggleBtn.querySelector("span").textContent = vocab.status === "got" ? "new" : "got";
  }

  renderWordPlayButton();
  window.requestAnimationFrame(positionWordPanel);
}

function handleWordClick(word, element) {
  selectedWord = { raw: word, normalized: normalizeWord(word), info: resolveWordInfo(word), element };
  renderWordPanel();
  playItems(
    [{ text: word, element, label: word, lang: "fr-FR", forceFrench: true }],
    { key: `word:${selectedWord.normalized}`, label: word }
  );
}

function positionWordPanel() {
  if (!selectedWord || elements.wordPanel.hidden) return;

  const panel = elements.wordPanel;
  const anchor = selectedWord.element;
  const isMobile = window.matchMedia("(max-width: 620px)").matches;
  panel.classList.toggle("is-bottom-sheet", isMobile);

  if (isMobile) {
    resetWordPanelPosition();
    return;
  }

  if (!anchor || !document.body.contains(anchor)) return;

  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;
  const left = clamp(
    anchorRect.left + anchorRect.width / 2 - panelRect.width / 2,
    margin,
    window.innerWidth - panelRect.width - margin
  );
  let top = anchorRect.bottom + 10;

  if (top + panelRect.height > window.innerHeight - margin) {
    top = anchorRect.top - panelRect.height - 10;
  }

  top = clamp(top, margin, Math.max(margin, window.innerHeight - panelRect.height - margin));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function resetWordPanelPosition() {
  elements.wordPanel.style.left = "";
  elements.wordPanel.style.top = "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function closeWordPanel() {
  selectedWord = null;
  renderWordPanel();
}

function closeWordPanelOnOutsideClick(event) {
  if (!selectedWord) return;
  const target = event.target;
  if (target.closest?.(".word-panel") || target.closest?.(".word-button")) return;
  closeWordPanel();
}

function renderLibrary() {
  ensureSelections();
  if (!libraryAlbumScope) libraryAlbumScope = state.ui.selectedAlbumId || "all";
  if (libraryAlbumScope !== "all" && !getAlbum(libraryAlbumScope)) {
    libraryAlbumScope = state.ui.selectedAlbumId || "all";
  }
  elements.albumShelf.replaceChildren();

  elements.albumShelf.append(createAllMaterialsCategoryCard());
  state.albums.forEach((album) => elements.albumShelf.append(createAlbumCard(album)));

  renderLibraryDetail();
}

function createAllMaterialsCategoryCard() {
  const card = el("article", "material-category-item");
  card.classList.toggle("is-selected", libraryAlbumScope === "all");
  const selectButton = el("button", "material-category-select");
  selectButton.type = "button";
  selectButton.setAttribute("aria-pressed", String(libraryAlbumScope === "all"));
  selectButton.append(
    el("span", "material-category-mark", "∞"),
    el("span", "material-category-name", "全部素材"),
    el("span", "material-category-count", String(state.entries.length))
  );
  selectButton.addEventListener("click", () => {
    libraryAlbumScope = "all";
    renderLibrary();
  });
  card.append(selectButton);
  return card;
}

function createAlbumCard(album) {
  const selected = libraryAlbumScope === album.id;
  const card = el("article", "material-category-item");
  card.classList.toggle("is-selected", selected);
  card.style.setProperty("--category-color", album.coverColor);
  const selectButton = el("button", "material-category-select");
  selectButton.type = "button";
  selectButton.setAttribute("aria-label", `查看磁带 ${album.title}`);
  selectButton.setAttribute("aria-pressed", String(selected));
  selectButton.append(
    el("span", "material-category-dot"),
    el("span", "material-category-name", album.title),
    el("span", "material-category-count", String(getEntriesByAlbum(album.id).length))
  );
  selectButton.addEventListener("click", () => selectAlbum(album.id));
  const actions = el("div", "material-category-actions");
  const editButton = button("编辑", "material-category-action", () => openAlbumDialog(album.id), "edit");
  editButton.setAttribute("aria-label", `编辑磁带 ${album.title}`);
  const deleteButton = button("删除", "material-category-action danger", () => deleteAlbum(album.id), "trash");
  deleteButton.setAttribute("aria-label", `删除磁带 ${album.title}`);
  actions.append(editButton, deleteButton);
  card.append(selectButton, actions);
  return card;
}

function selectAlbum(albumId) {
  libraryAlbumScope = albumId;
  state.ui.selectedAlbumId = albumId;
  const firstTape = getTapes(albumId)[0];
  state.ui.selectedTapeId = firstTape?.id || null;
  persist();
  renderLibrary();
}

function renderLibraryDetail() {
  elements.libraryDetail.replaceChildren();
  elements.materialFilterButtons.forEach((filterButton) => {
    const selected = filterButton.dataset.materialFilter === libraryMaterialFilter;
    filterButton.classList.toggle("is-selected", selected);
    filterButton.setAttribute("aria-pressed", String(selected));
  });

  const album = libraryAlbumScope === "all" ? null : getAlbum(libraryAlbumScope);
  const sourceEntries = album ? getEntriesByAlbum(album.id) : [...state.entries];
  const query = libraryMaterialSearch.toLocaleLowerCase("zh-CN");
  const entries = sourceEntries
    .filter((entry) => materialMatchesFilter(entry, libraryMaterialFilter))
    .filter((entry) => !query || `${entry.title} ${entry.text} ${entry.notes}`.toLocaleLowerCase("zh-CN").includes(query))
    .sort((a, b) => String(b.lastPracticedAt || b.updatedAt || "").localeCompare(String(a.lastPracticedAt || a.updatedAt || "")));

  const resultsHeading = el("div", "material-results-heading");
  const headingCopy = el("div");
  headingCopy.append(
    el("p", "eyebrow", album ? "Selected tape" : "All materials"),
    el("h3", "", album?.title || "全部素材"),
    el("p", "micro-copy", album?.description?.replaceAll("专辑", "磁带") || `${sourceEntries.length} 条素材，可按状态或标题筛选。`)
  );
  const resultCount = el("span", "stat-pill", `${entries.length} 条素材`);
  resultsHeading.append(headingCopy, resultCount);

  const grid = el("div", "material-card-grid");
  if (!entries.length) {
    grid.append(emptyState(query || libraryMaterialFilter !== "all" ? "没有符合当前筛选的素材" : "还没有素材，先新建一条学习内容"));
  } else {
    entries.forEach((entry) => grid.append(createMaterialCard(entry)));
  }
  elements.libraryDetail.append(resultsHeading, grid);
}

function materialMatchesFilter(entry, filter) {
  const status = materialStudyStatus(entry).key;
  if (filter === "recent") return Boolean(entry.lastPracticedAt);
  if (filter === "pending") return status === "pending";
  if (filter === "learning") return status === "learning";
  if (filter === "completed") return status === "completed";
  return true;
}

function materialStudyStatus(entry) {
  const count = Math.max(0, Number(entry.practiceCount || 0));
  if (count >= 3) return { key: "completed", label: "已完成" };
  if (count > 0) return { key: "learning", label: "学习中" };
  return { key: "pending", label: "待整理" };
}

function createMaterialCard(entry) {
  const tape = getTape(entry.tapeId);
  const album = getAlbum(tape?.albumId);
  const status = materialStudyStatus(entry);
  const card = el("article", "material-card");
  card.style.setProperty("--material-color", album?.coverColor || "#0a5f59");

  const top = el("div", "material-card-top");
  top.append(
    el("h3", "", entry.title),
    el("span", `material-language-badge ${entry.language === "en" ? "is-english" : ""}`, entry.language === "en" ? "英语" : "法语")
  );

  const artwork = el("div", "material-card-artwork");
  const cassette = el("div", "material-card-cassette");
  cassette.append(el("span", "material-card-reel"), el("span", "material-card-window"), el("span", "material-card-reel"));
  artwork.append(cassette);

  const preview = el("p", "material-card-preview", entry.text);
  const meta = el("div", "material-card-meta");
  const sentenceCount = splitCourseTurns(entry.text, { materialType: entry.materialType }).length;
  meta.append(
    el("span", `material-status is-${status.key}`, status.label),
    el("span", "", `${sentenceCount} 句`),
    el("span", "", materialLastStudyLabel(entry))
  );

  const actions = el("div", "material-card-actions");
  const enterButton = button("进入课程", "command-button primary material-enter-course", () => openCourseFromEntry(entry), "play");
  const editButton = button("编辑", "material-card-icon-button", () => openEntryDialog(entry.id), "edit");
  editButton.setAttribute("aria-label", `编辑素材 ${entry.title}`);
  const deleteButton = button("删除", "material-card-icon-button danger", () => deleteEntry(entry.id), "trash");
  deleteButton.setAttribute("aria-label", `删除素材 ${entry.title}`);
  actions.append(enterButton, editButton, deleteButton);
  card.append(top, artwork, preview, meta, actions);
  return card;
}

function materialLastStudyLabel(entry) {
  if (!entry.lastPracticedAt) return "尚未学习";
  const date = new Date(entry.lastPracticedAt);
  if (Number.isNaN(date.getTime())) return "学过";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return "今天学习";
  if (days === 1) return "昨天学习";
  return `${days} 天前`;
}

function openNewMaterialFromLibrary() {
  const albumId = libraryAlbumScope !== "all" ? libraryAlbumScope : state.ui.selectedAlbumId || state.albums[0]?.id;
  if (!albumId) {
    setStatus("请先新建一盘磁带，再添加素材");
    openAlbumDialog();
    return;
  }
  state.ui.selectedAlbumId = albumId;
  openEntryDialog(null, ensureTapeForAlbum(albumId));
}

function openCourseFromEntry(entry) {
  const lesson = syncCourseFromEntry(entry);
  if (!lesson) {
    setStatus("这条素材还没有可学习的句子");
    return;
  }
  const tape = getTape(entry.tapeId);
  state.ui.selectedTapeId = entry.tapeId;
  state.ui.selectedAlbumId = tape?.albumId || state.ui.selectedAlbumId;
  entry.practiceCount = Math.max(0, Number(entry.practiceCount || 0)) + 1;
  entry.lastPracticedAt = nowIso();
  entry.updatedAt = nowIso();
  state.activeEntryId = entry.id;
  state.activeCourseId = lesson.id;
  courseActiveLessonId = lesson.id;
  courseCurrentTurnIndex = 0;
  state.ui.activeView = "course";
  persist();
  renderView();
  setCourseStage("player");
  setStatus(`已打开课程：${entry.title}`);
  scheduleCourseBackgroundEnrichment(lesson);
}

// Similarity in [0, 1] used to recognise a lightly edited sentence (typo fix).
function textSimilarity(a, b) {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest || Math.abs(a.length - b.length) / longest > 0.3) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / longest;
}

// Re-attaches the per-sentence work (translation, AI explanation, recording and
// the turn id) of `oldTurns` to the rebuilt `newTurns`. Identical sentences are
// paired in order, so a repeated line keeps its own recording; a close edit at
// about the same place (typo fix) keeps translation and recording too.
// `dropped` lists old turns whose recording no longer belongs to any sentence.
// `prefer: "old"` (local edits) keeps what the learner already has and only
// fills gaps from the new turns; `prefer: "new"` (imported package) takes the
// package's content and only fills gaps from the old turns. Recordings always
// stay with the old turn, since they only exist on this device.
function carryOverTurns(oldTurns, newTurns, { translations = true, explanations = true, prefer = "old" } = {}) {
  const pick = (oldValue, newValue) => (prefer === "old" ? (oldValue || newValue) : (newValue || oldValue));
  const queues = new Map();
  oldTurns.forEach((turn) => {
    const key = String(turn.text || "").trim();
    queues.set(key, [...(queues.get(key) || []), turn]);
  });
  const used = new Set();
  const matches = newTurns.map((turn) => {
    const old = queues.get(String(turn.text || "").trim())?.shift();
    if (old) used.add(old);
    return old ? { old, exact: true } : null;
  });
  newTurns.forEach((turn, index) => {
    if (matches[index]) return;
    let best = null;
    for (let distance = 0; distance <= 3; distance += 1) {
      const positions = distance ? [index - distance, index + distance] : [index];
      positions.forEach((position) => {
        const old = oldTurns[position];
        if (!old || used.has(old)) return;
        const score = textSimilarity(String(old.text || "").trim(), String(turn.text || "").trim());
        if (score >= 0.85 && (!best || score > best.score)) best = { old, score };
      });
    }
    if (best) {
      used.add(best.old);
      matches[index] = { old: best.old, exact: false };
    }
  });
  const turns = newTurns.map((turn, index) => {
    const match = matches[index];
    if (!match) return turn;
    const { old, exact } = match;
    return {
      ...turn,
      id: old.id,
      translation: translations ? pick(old.translation, turn.translation) : turn.translation,
      aiExplanation: (explanations && exact ? pick(old.aiExplanation, turn.aiExplanation) : turn.aiExplanation) || null,
      recording: old.recording || turn.recording
    };
  });
  const dropped = oldTurns.filter((turn) => !used.has(turn) && turn.recording?.mediaKey);
  return { turns, dropped };
}

// Recording files live in IndexedDB. They are deleted only after the state that
// no longer references them has been saved (see persist), and never while some
// other sentence still points at the same file.
let recordingKeysToRelease = new Set();

function queueRecordingRelease(keys) {
  (keys || []).filter(Boolean).forEach((key) => recordingKeysToRelease.add(key));
}

function flushRecordingRelease() {
  if (!recordingKeysToRelease.size || !state) return;
  const stillUsed = new Set(state.courseLessons.flatMap((lesson) => lesson.turns.map((turn) => turn.recording?.mediaKey).filter(Boolean)));
  const keys = [...recordingKeysToRelease];
  recordingKeysToRelease = new Set();
  keys.filter((key) => !stillUsed.has(key)).forEach((key) => {
    void deleteRecordingBlob(key);
  });
}

function recordingKeysOfLessons(lessons) {
  return lessons.flatMap((lesson) => lesson.turns.map((turn) => turn.recording?.mediaKey).filter(Boolean));
}

// What deleting these lessons takes with it, for the confirmation text.
function lessonRemovalSummary(lessonIds) {
  const ids = new Set([...lessonIds].filter(Boolean));
  const lessons = state.courseLessons.filter((lesson) => ids.has(lesson.id));
  const recordings = recordingKeysOfLessons(lessons).length;
  const phraseCards = state.phraseItems.filter((item) => ids.has(item.sourceLessonId)).length;
  const parts = [];
  if (recordings) parts.push(`${recordings} 句录音会一并删除`);
  if (phraseCards) parts.push(`${phraseCards} 条已收藏的词句卡会保留在词句本里`);
  return parts.length ? `\n${parts.join("；")}。` : "";
}

// Removes lessons and queues their recordings for deletion. Saved words and
// phrase cards carry the learner's progress, so they are kept (detached from
// the removed lesson) rather than deleted with it.
function removeLessons(lessonIds) {
  const ids = new Set([...lessonIds].filter(Boolean));
  if (!ids.size) return;
  abortAiWork([...ids]);
  queueRecordingRelease(recordingKeysOfLessons(state.courseLessons.filter((lesson) => ids.has(lesson.id))));
  state.courseLessons = state.courseLessons.filter((lesson) => !ids.has(lesson.id));
  state.phraseItems.forEach((item) => {
    if (ids.has(item.sourceLessonId)) item.sourceLessonId = "";
  });
}

// Pure planning step shared by syncCourseFromEntry and the entry edit dialog.
function planEntryLessonTurns(entry) {
  const materialType = entry.materialType || inferStoredMaterialType(entry.text);
  const isDialogue = materialType === "情景对话";
  const parts = splitCourseTurns(entry.text, { materialType });
  const lessonId = entry.courseLessonId || `course_entry_${entry.id}`;
  const existing = state.courseLessons.find((lesson) => lesson.id === lessonId) || null;
  const fresh = parts.map((part, index) => ({
    id: `${entry.id}_turn_${index + 1}`,
    text: part.text,
    translation: "",
    speakerId: isDialogue ? (part.speakerId || (index % 2 === 0 ? "a" : "b")) : "narrator",
    speakerLabel: isDialogue ? (part.speakerLabel || (index % 2 === 0 ? "A" : "B")) : "旁白",
    aiExplanation: null,
    recording: { status: "none", durationMs: 0, mediaKey: "" }
  }));
  const carried = carryOverTurns(existing?.turns || [], fresh);
  return { materialType, lessonId, existing, parts, turns: carried.turns, dropped: carried.dropped };
}

function syncCourseFromEntry(entry) {
  const plan = planEntryLessonTurns(entry);
  if (!plan.parts.length) return null;
  const { existing, turns, materialType } = plan;
  const lesson = normalizeCourseLesson({
    id: plan.lessonId,
    title: entry.title,
    language: entry.language || "fr",
    explainLanguage: existing?.explainLanguage || systemExplainLanguage(),
    materialType,
    description: `${turns.length} 句 · 来自自建素材`,
    createdAt: existing?.createdAt || entry.createdAt,
    updatedAt: nowIso(),
    aiPreparedAt: existing?.aiPreparedAt || null,
    aiPreparedSignature: existing?.aiPreparedSignature || "",
    lexicalUnits: existing?.lexicalUnits || [],
    turns,
    practice: existing?.practice || { completed: 0, correct: 0 }
  });
  queueRecordingRelease(plan.dropped.map((turn) => turn.recording.mediaKey));
  if (existing) state.courseLessons.splice(state.courseLessons.indexOf(existing), 1, lesson);
  else state.courseLessons.unshift(lesson);
  entry.courseLessonId = lesson.id;
  return lesson;
}

function renderWordbooks() {
  elements.wordbookShelf.replaceChildren();
  const books = [...SYSTEM_WORDBOOKS, ...state.wordbooks];
  books.forEach((book) => {
    elements.wordbookShelf.append(createWordbookCard(book));
  });

  const selected = getWordbook(state.ui.selectedWordbookId);
  const selectedCount = vocabularyForWordbook(state.ui.selectedWordbookId).length + phraseItemsForWordbook(state.ui.selectedWordbookId).length;
  elements.selectedWordbookLine.textContent = selected
    ? `${selected.title} · ${selectedCount} 词句`
    : `all · ${state.vocabulary.length + state.phraseItems.length} 词句`;
}

function createWordbookCard(book) {
  const count = vocabularyForWordbook(book.id).length + phraseItemsForWordbook(book.id).length;
  const card = el("article", `wordbook-card${isSystemWordbook(book.id) ? " is-system" : ""}`);
  const selected = state.ui.selectedWordbookId === book.id;
  card.classList.toggle("is-selected", selected);

  const select = (keepFocus) => {
    state.ui.selectedWordbookId = book.id;
    persist();
    renderWordbooks();
    renderVocab();
    // The cards are rebuilt; give keyboard users their place back.
    if (keepFocus) elements.wordbookShelf.querySelector(".wordbook-card.is-selected .wordbook-card-select")?.focus({ preventScroll: true });
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest(".row-actions")) return;
    select(event.detail === 0); // detail 0: a keyboard "click"
  });
  // The title is the keyboard-reachable select button; edit / delete stay separate buttons.
  const title = el("h3");
  const selectButton = el("button", "wordbook-card-select", book.title);
  selectButton.type = "button";
  selectButton.setAttribute("aria-pressed", String(selected));
  selectButton.setAttribute("aria-label", `选择词句本 ${book.title}`);
  title.append(selectButton);
  const description = el("p", "", book.description || " ");
  const meta = el("span", "badge", `${count} 词句`);
  card.append(title, description, meta);

  if (!isSystemWordbook(book.id)) {
    const actions = el("div", "row-actions");
    actions.append(
      miniButton("编辑", () => openWordbookDialog(book.id)),
      miniButton("删除", () => deleteWordbook(book.id))
    );
    card.append(actions);
  }

  return card;
}

function renderVocab() {
  renderPhraseSourceOptions();
  const query = String(elements.vocabSearch.value || "").trim().toLocaleLowerCase();
  const source = elements.phraseSourceFilter.value || "all";
  const date = elements.phraseDateFilter.value || "all";
  const status = elements.phraseStatusFilter.value || "all";
  const items = phrasebookItemsForSelected()
    .filter((item) => phraseItemMatchesFilters(item, { query, source, date, status }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const total = phrasebookItemsForSelected().length;
  const gotCount = items.filter((item) => item.status === "got").length;
  elements.vocabStats.textContent = `${items.length} / ${total} 词句 · ${gotCount} 已掌握`;
  elements.vocabList.replaceChildren();

  if (items.length === 0) {
    elements.vocabList.append(emptyState("当前筛选条件下还没有词句"));
    return;
  }

  items.forEach((item) => {
    elements.vocabList.append(createPhrasebookRow(item));
  });
}

function phraseItemsForWordbook(wordbookId) {
  return (state.phraseItems || []).filter((item) => phraseItemMatchesWordbook(item, wordbookId));
}

function phraseItemMatchesWordbook(item, wordbookId) {
  if (!wordbookId || wordbookId === ALL_WORDBOOK_ID) return true;
  if (wordbookId === NEW_WORDBOOK_ID) return item.status !== "got";
  if (wordbookId === GOT_WORDBOOK_ID) return item.status === "got";
  if (wordbookId === DIY_WORDBOOK_ID) return !item.translation;
  return Array.isArray(item.wordbookIds) && item.wordbookIds.includes(wordbookId);
}

function phrasebookItemsForSelected() {
  const words = state.vocabulary
    .filter((item) => vocabularyMatchesWordbook(item, state.ui.selectedWordbookId))
    .map((item) => ({
      origin: "vocabulary",
      kind: "word",
      id: item.id,
      text: item.word,
      translation: item.zh || "释义待补充",
      sourceTitle: "词汇库",
      language: item.language === "en" ? "en" : "fr",
      status: item.status === "got" ? "got" : "new",
      updatedAt: item.updatedAt,
      sourceKey: "词汇库",
      raw: item
    }));
  const phrases = phraseItemsForWordbook(state.ui.selectedWordbookId).map((item) => ({
    origin: "phrase",
    kind: item.type,
    id: item.id,
    text: item.text,
    translation: item.translation || "翻译待补充",
    sourceTitle: item.sourceTitle,
    language: item.language,
    status: item.status,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    sourceKey: item.sourceTitle,
    raw: item
  }));
  return [...words, ...phrases];
}

function renderPhraseSourceOptions() {
  const current = elements.phraseSourceFilter.value || "all";
  const sources = Array.from(new Set(phrasebookItemsForSelected().map((item) => item.sourceTitle).filter(Boolean)));
  elements.phraseSourceFilter.replaceChildren(new Option("所有来源", "all"), ...sources.map((source) => new Option(source, source)));
  elements.phraseSourceFilter.value = sources.includes(current) ? current : "all";
}

function phraseItemMatchesFilters(item, filters) {
  const normalizedQuery = filters.query;
  if (normalizedQuery && !`${item.text} ${item.translation} ${item.sourceTitle}`.toLocaleLowerCase().includes(normalizedQuery)) return false;
  if (filters.source !== "all" && item.sourceTitle !== filters.source) return false;
  if (filters.status !== "all" && item.status !== filters.status) return false;
  if (filters.date !== "all") {
    const created = new Date(item.createdAt || item.updatedAt || 0).getTime();
    const now = Date.now();
    const range = filters.date === "today" ? 86400000 : 7 * 86400000;
    if (!created || now - created > range) return false;
  }
  return true;
}

function createPhrasebookRow(item) {
  const row = el("article", `phrasebook-row status-${item.status}`);
  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "phrasebook-check";
  check.setAttribute("aria-label", `选择${item.kind === "word" ? "单词" : "句子"} ${item.text}`);
  const play = button("", "phrasebook-play", () => playPhrasebookItem(item, play), "play");
  play.dataset.playbackKey = `phrasebook:${item.kind}:${item.id}`;
  play.title = "自动发音";
  const phrase = el("div", "phrasebook-text");
  phrase.append(el("strong", "", item.text), el("span", "phrasebook-kind", item.kind === "word" ? "单词" : "句子"));
  const translation = el("div", "phrasebook-translation", item.translation);
  const source = el("div", "phrasebook-source", item.sourceTitle || "自定义素材");
  const actions = el("div", "phrasebook-row-actions");
  actions.append(
    el("span", `phrase-status status-${item.status}`, item.status === "got" ? "已掌握" : item.status === "learning" ? "学习中" : "待学习"),
    miniButton(item.status === "got" ? "待复习" : "掌握", () => togglePhrasebookItemStatus(item)),
    miniButton("删除", () => deletePhrasebookItem(item))
  );
  row.append(check, play, phrase, translation, source, actions);
  return row;
}

function playPhrasebookItem(item, playButton = null) {
  const lang = item.language === "en" ? "en-US" : "fr-FR";
  togglePlayback([{ text: item.text, element: null, label: item.text, lang, forceFrench: item.language !== "en" }], { key: `phrasebook:${item.kind}:${item.id}`, label: item.text });
  if (playButton) renderPhrasebookPlayButtons();
}

function togglePhrasebookItemStatus(item) {
  // A saved word card (kind "word") lives in the phrase list; only entries of the vocabulary list use the vocabulary actions.
  if (item.origin === "vocabulary") {
    toggleVocabularyStatus(item.id);
    return;
  }
  const phrase = state.phraseItems.find((entry) => entry.id === item.id);
  if (!phrase) return;
  phrase.status = phrase.status === "got" ? "learning" : "got";
  phrase.updatedAt = nowIso();
  persist();
  renderWordbooks();
  renderVocab();
}

function deletePhrasebookItem(item) {
  if (item.origin === "vocabulary") {
    deleteVocabulary(item.id);
    return;
  }
  if (!window.confirm(`删除${item.kind === "word" ? "单词" : "句子"}「${item.text}」？`)) return;
  state.phraseItems = state.phraseItems.filter((entry) => entry.id !== item.id);
  persist();
  renderWordbooks();
  renderVocab();
}

function openPhrasePractice() {
  phrasePracticeItems = phrasebookItemsForSelected().filter((item) => phraseItemMatchesFilters(item, {
    query: String(elements.vocabSearch.value || "").trim().toLocaleLowerCase(),
    source: elements.phraseSourceFilter.value || "all",
    date: elements.phraseDateFilter.value || "all",
    status: elements.phraseStatusFilter.value || "all"
  }));
  if (!phrasePracticeItems.length) {
    setStatus("当前筛选条件下没有可练习的词句");
    return;
  }
  phrasePracticeIndex = 0;
  phrasePracticeRevealed = false;
  phrasePracticeLastSpokenKey = "";
  phrasePracticeFinished = false;
  phrasePracticePromptLanguage = phrasePracticeDisplayMode === "random"
    ? (Math.random() > 0.5 ? "translation" : "original")
    : phrasePracticeDisplayMode;
  elements.vocabList.hidden = true;
  elements.wordbookShelf.hidden = true;
  elements.phrasePracticePanel.hidden = false;
  renderPhrasePractice();
}

function closePhrasePractice() {
  phrasePracticeItems = [];
  elements.vocabList.hidden = false;
  elements.wordbookShelf.hidden = false;
  elements.phrasePracticePanel.hidden = true;
}

function currentPhrasePracticeItem() {
  return phrasePracticeItems[phrasePracticeIndex % phrasePracticeItems.length] || null;
}

function renderPhrasePractice() {
  if (phrasePracticeFinished) {
    elements.phrasePracticeMeta.textContent = `${phrasePracticeItems.length} 张卡片 · 本轮已完成`;
    elements.phrasePracticeSource.textContent = "完成";
    elements.phrasePracticeProgress.textContent = `${phrasePracticeItems.length} / ${phrasePracticeItems.length}`;
    elements.phrasePracticePrompt.textContent = "这一轮完成了";
    elements.phrasePracticeAnswer.textContent = "学习记录已保存，可以返回词句本选择新的状态或日期继续练习。";
    elements.phrasePracticeAnswer.hidden = false;
    elements.phrasePracticeSpeakBtn.hidden = true;
    elements.phrasePracticeRevealBtn.hidden = true;
    elements.phrasePracticeAgainBtn.hidden = true;
    elements.phrasePracticeKnownBtn.hidden = true;
    return;
  }
  const item = currentPhrasePracticeItem();
  if (!item) return;
  elements.phrasePracticeSpeakBtn.hidden = false;
  elements.phrasePracticeMeta.textContent = `${phrasePracticeItems.length} 张卡片 · 来自当前筛选条件`;
  elements.phrasePracticeSource.textContent = item.sourceTitle || "自定义素材";
  elements.phrasePracticeProgress.textContent = `${phrasePracticeIndex + 1} / ${phrasePracticeItems.length}`;
  if (elements.phrasePracticeDisplayMode.value !== phrasePracticeDisplayMode) elements.phrasePracticeDisplayMode.value = phrasePracticeDisplayMode;
  const promptIsTranslation = phrasePracticePromptLanguage === "translation";
  elements.phrasePracticePrompt.textContent = promptIsTranslation ? item.translation : item.text;
  elements.phrasePracticeAnswer.textContent = promptIsTranslation ? item.text : item.translation;
  elements.phrasePracticeVoiceHint.textContent = `课程音色：${voiceShortName(selectedVoice())}`;
  elements.phrasePracticeAnswer.hidden = !phrasePracticeRevealed;
  elements.phrasePracticeRevealBtn.hidden = phrasePracticeRevealed;
  elements.phrasePracticeAgainBtn.hidden = !phrasePracticeRevealed;
  elements.phrasePracticeKnownBtn.hidden = !phrasePracticeRevealed;
  speakCurrentPhraseCard(false);
}

function speakCurrentPhraseCard(force = false) {
  const item = currentPhrasePracticeItem();
  if (phrasePracticeSpeaking) {
    window.speechSynthesis.cancel();
    phrasePracticeSpeaking = false;
    renderPhrasePracticeSpeakButton();
    return;
  }
  if (!item || (!force && phrasePracticeLastSpokenKey === `${item.id}:${phrasePracticeIndex}`)) return;
  phrasePracticeLastSpokenKey = `${item.id}:${phrasePracticeIndex}`;
  if (!canSpeak()) return;
  if (playback.status !== "idle") stopSpeech({ quiet: true });
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.lang = item.language === "en" ? "en-US" : "fr-FR";
  utterance.rate = Number(state.settings.rate || 0.9);
  const voice = selectedVoiceForLanguage(utterance.lang);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || utterance.lang;
  }
  phrasePracticeSpeaking = true;
  renderPhrasePracticeSpeakButton();
  const finish = () => {
    phrasePracticeSpeaking = false;
    renderPhrasePracticeSpeakButton();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

function renderPhrasePracticeSpeakButton() {
  setButtonContent(elements.phrasePracticeSpeakBtn, phrasePracticeSpeaking ? "pause" : "speaker", phrasePracticeSpeaking ? "暂停" : "播放");
}

function revealPhrasePracticeAnswer() {
  phrasePracticeRevealed = true;
  renderPhrasePractice();
}

function advancePhrasePractice(correct) {
  const item = currentPhrasePracticeItem();
  if (item?.raw) {
    item.raw.practiceCount = Number(item.raw.practiceCount || 0) + 1;
    item.raw.lastPracticedAt = nowIso();
    item.raw.status = correct ? "got" : "learning";
    item.raw.updatedAt = nowIso();
  }
  recordStudyEvent({ cards: 1, known: correct });
  phrasePracticeIndex += 1;
  phrasePracticeRevealed = false;
  phrasePracticeLastSpokenKey = "";
  phrasePracticePromptLanguage = phrasePracticeDisplayMode === "random"
    ? (Math.random() > 0.5 ? "translation" : "original")
    : phrasePracticeDisplayMode;
  persist();
  if (phrasePracticeIndex >= phrasePracticeItems.length) {
    phrasePracticeFinished = true;
    window.speechSynthesis.cancel();
  }
  renderPhrasePractice();
}

function toggleAllSentences() {
  const rows = Array.from(elements.sentenceList.querySelectorAll(".sentence-row"));
  const items = sentences.map((sentence, index) => ({
    text: sentence,
    element: rows[index],
    label: `第 ${index + 1} 句`
  }));
  if (items.length > 0 && !isActivePlayback("reader:all")) {
    recordPracticeIfEntry();
  }
  togglePlayback(items, { key: "reader:all", label: "全文" });
}

function openSaveCurrentDialog() {
  const text = state.currentText.trim();
  if (!text) {
    setStatus("没有可保存的文本");
    return;
  }

  ensureLibraryForSave();
  const title = firstSentenceTitle(text);
  const tapeOptions = state.tapes.map((tape) => {
    const album = getAlbum(tape.albumId);
    return { value: tape.id, label: `${album?.title || "专辑"} / ${tape.title}` };
  });

  openDialog({
    title: "保存段落",
    submitText: "保存",
    fields: [
      { name: "title", label: "标题", type: "text", value: title, required: true },
      { name: "tapeId", label: "磁带", type: "select", value: state.ui.selectedTapeId || state.tapes[0]?.id, options: tapeOptions, required: true },
      { name: "notes", label: "备注", type: "textarea", value: "" }
    ],
    onSubmit(values) {
      const entry = createEntry(values.tapeId, values.title, text, values.notes);
      state.activeEntryId = entry.id;
      state.ui.selectedAlbumId = getTape(entry.tapeId)?.albumId || state.ui.selectedAlbumId;
      state.ui.selectedTapeId = entry.tapeId;
      persist();
      renderAll();
      setStatus("已保存到磁带");
    }
  });
}

function openAlbumDialog(albumId) {
  const album = getAlbum(albumId);
  openDialog({
    title: album ? "编辑磁带" : "新建磁带",
    submitText: album ? "更新" : "创建",
    fields: [
      { name: "title", label: "标题", type: "text", value: album?.title || "", required: true },
      { name: "description", label: "描述", type: "textarea", value: album?.description || "" },
      { name: "coverColor", label: "封面色", type: "color", value: album?.coverColor || pickAlbumColor() }
    ],
    onSubmit(values) {
      if (album) {
        album.title = values.title.trim();
        album.description = values.description.trim();
        album.coverColor = values.coverColor;
        album.updatedAt = nowIso();
      } else {
        const created = createAlbum(values.title, values.description, values.coverColor);
        state.ui.selectedAlbumId = created.id;
        libraryAlbumScope = created.id;
        const tape = createTape(created.id, "素材", "磁带里的学习素材");
        state.ui.selectedTapeId = tape.id;
      }
      persist();
      renderLibrary();
    }
  });
}

function openWordbookDialog(wordbookId) {
  const wordbook = state.wordbooks.find((item) => item.id === wordbookId);
  openDialog({
    title: wordbook ? "编辑词句本" : "新建词句本",
    submitText: wordbook ? "更新" : "创建",
    fields: [
      { name: "title", label: "名称", type: "text", value: wordbook?.title || "", required: true },
      { name: "description", label: "描述", type: "textarea", value: wordbook?.description || "" }
    ],
    onSubmit(values) {
      if (wordbook) {
        wordbook.title = values.title.trim();
        wordbook.description = values.description.trim();
        wordbook.updatedAt = nowIso();
      } else {
        const created = createWordbook(values.title, values.description);
        state.ui.selectedWordbookId = created.id;
      }
      persist();
      renderWordbooks();
      renderVocab();
    }
  });
}

function deleteWordbook(wordbookId) {
  const wordbook = state.wordbooks.find((item) => item.id === wordbookId);
  if (!wordbook || !window.confirm(`删除词句本「${wordbook.title}」？`)) return;
  state.wordbooks = state.wordbooks.filter((item) => item.id !== wordbookId);
  state.vocabulary.forEach((item) => {
    item.wordbookIds = (item.wordbookIds || []).filter((id) => id !== wordbookId);
  });
  if (state.ui.selectedWordbookId === wordbookId) {
    state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
  }
  persist();
  renderWordbooks();
  renderVocab();
}

function openEntryDialog(entryId, tapeId = state.ui.selectedTapeId) {
  const entry = getEntry(entryId);
  const currentTape = getTape(entry?.tapeId || tapeId);
  const currentAlbumId = currentTape?.albumId || state.ui.selectedAlbumId || state.albums[0]?.id || "";
  const albumOptions = state.albums.map((album) => ({ value: album.id, label: album.title }));
  openDialog({
    title: entry ? "编辑素材" : "新建素材",
    submitText: entry ? "更新" : "创建",
    fields: [
      { name: "albumId", label: "所属磁带", type: "select", value: currentAlbumId, options: albumOptions, required: true },
      { name: "title", label: "标题", type: "text", value: entry?.title || "", required: true },
      { name: "language", label: "学习语言", type: "select", value: entry?.language || "fr", options: [{ value: "fr", label: "法语" }, { value: "en", label: "英语" }], required: true },
      { name: "materialType", label: "素材类型", type: "select", value: entry?.materialType || "文章", options: [{ value: "文章", label: "文章" }, { value: "情景对话", label: "情景对话" }, { value: "笔记", label: "笔记" }, { value: "歌词", label: "歌词" }, { value: "自定义文本", label: "自定义文本" }], required: true },
      { name: "text", label: "学习文本", type: "textarea", value: entry?.text || "", required: true },
      { name: "notes", label: "备注", type: "textarea", value: entry?.notes || "" }
    ],
    onSubmit(values) {
      if (entry?.courseLessonId) {
        const plan = planEntryLessonTurns({ ...entry, text: values.text.trim(), materialType: values.materialType });
        if (plan.dropped.length && !window.confirm(`有 ${plan.dropped.length} 句录音对应的句子被改动或删除，保存后这些录音会被移除。继续吗？`)) {
          return false;
        }
      }
      const targetTapeId = ensureTapeForAlbum(values.albumId);
      if (entry) {
        entry.tapeId = targetTapeId;
        entry.title = values.title.trim();
        entry.language = values.language === "en" ? "en" : "fr";
        entry.materialType = values.materialType;
        entry.text = values.text.trim();
        entry.notes = values.notes.trim();
        entry.updatedAt = nowIso();
        if (entry.courseLessonId) syncCourseFromEntry(entry);
        if (state.activeEntryId === entry.id) {
          setCurrentText(entry.text, entry.id, { skipPersist: true });
        }
      } else {
        createEntry(targetTapeId, values.title, values.text, values.notes, { language: values.language, materialType: values.materialType });
      }
      state.ui.selectedAlbumId = values.albumId;
      state.ui.selectedTapeId = targetTapeId;
      libraryAlbumScope = values.albumId;
      persist();
      renderAll();
    }
  });
}

function openVocabDialog(vocabId) {
  const item = getVocabulary(vocabId);
  const seed = item || (selectedWord ? buildVocabularyItem(selectedWord.raw) : null);
  const currentWordbook = item?.wordbookIds?.[0] || selectedCustomWordbookId();
  const wordbookOptions = [
    { value: "", label: "不放入自定义单词本" },
    ...state.wordbooks.map((wordbook) => ({ value: wordbook.id, label: wordbook.title }))
  ];
  openDialog({
    title: item ? "编辑单词" : "新建单词",
    submitText: item ? "更新" : "创建",
    fields: [
      { name: "word", label: "法语词", type: "text", value: seed?.word || "", required: true },
      { name: "ipa", label: "音标", type: "text", value: seed?.ipa || "" },
      { name: "zh", label: "中文释义", type: "textarea", value: seed?.zh || "" },
      { name: "wordbookId", label: "自定义单词本", type: "select", value: currentWordbook, options: wordbookOptions },
      {
        name: "status",
        label: "状态",
        type: "select",
        value: seed?.status || "new",
        options: [
          { value: "new", label: "new" },
          { value: "got", label: "got" }
        ],
        required: true
      }
    ],
    onSubmit(values) {
      const info = resolveWordInfo(values.word);
      if (!info.lemma) return false;
      const presentation = vocabularyPresentation(values.word, {
        lemma: info.lexicon?.word || info.lemma,
        pos: item?.partOfSpeech || ""
      }, item?.language === "en" ? "en" : "fr");
      // The dialog edits one wordbook (the first); any others the word belongs to stay.
      const otherWordbooks = (item?.wordbookIds || []).slice(1).filter((id) => id !== values.wordbookId);
      const wordbookIds = [...(values.wordbookId ? [values.wordbookId] : []), ...otherWordbooks];

      const existing = state.vocabulary.find((word) => word.normalized === presentation.identity && word.id !== item?.id);
      if (existing && item) {
        // Renaming this word onto another existing word: merge them, keep both histories.
        existing.ipa = values.ipa.trim() || existing.ipa;
        existing.zh = values.zh.trim() || existing.zh;
        existing.status = values.status === "got" || existing.status === "got" ? "got" : "new";
        existing.wordbookIds = mergeWordbookIds(existing.wordbookIds, [...wordbookIds, ...item.wordbookIds]);
        existing.seenForms = mergeSeenForms(existing.seenForms, item.seenForms);
        trackSeenForm(existing, values.word);
        existing.updatedAt = nowIso();
        state.vocabulary = state.vocabulary.filter((word) => word.id !== item.id);
      } else if (existing) {
        existing.word = presentation.displayWord;
        existing.surface = presentation.surface;
        existing.lemma = presentation.lemma;
        existing.normalized = presentation.identity;
        existing.ipa = values.ipa.trim();
        existing.zh = values.zh.trim();
        existing.status = values.status;
        existing.wordbookIds = wordbookIds;
        trackSeenForm(existing, values.word);
        existing.updatedAt = nowIso();
      } else if (item) {
        item.word = presentation.displayWord;
        item.surface = presentation.surface;
        item.lemma = presentation.lemma;
        item.normalized = presentation.identity;
        item.ipa = values.ipa.trim();
        item.zh = values.zh.trim();
        item.status = values.status;
        item.wordbookIds = wordbookIds;
        trackSeenForm(item, values.word);
        item.updatedAt = nowIso();
      } else {
        state.vocabulary.push({
          id: makeId("word"),
          word: presentation.displayWord,
          surface: presentation.surface,
          lemma: presentation.lemma,
          normalized: presentation.identity,
          partOfSpeech: presentation.pos,
          ipa: values.ipa.trim(),
          zh: values.zh.trim(),
          status: values.status,
          wordbookIds,
          seenForms: [{ form: values.word.trim(), normalized: normalizeWord(values.word), count: 1 }],
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }
      persist();
      renderWordbooks();
      renderVocab();
      renderSentences();
      renderWordPanel();
    }
  });
}

function openDialog({ title, submitText, fields, onSubmit }) {
  elements.dialogTitle.textContent = title;
  elements.dialogSubmitBtn.textContent = submitText;
  elements.dialogBody.replaceChildren();
  dialogSubmitHandler = onSubmit;
  dialogRequiredFields = fields.filter((field) => field.required).map((field) => field.name);

  fields.forEach((field) => {
    if (field.type === "static") {
      const note = el("div", "dialog-note");
      if (field.label) {
        note.append(el("span", "field-label", field.label));
      }
      note.append(el("p", "", field.value || ""));
      elements.dialogBody.append(note);
      return;
    }

    const wrapper = el("label", "dialog-field");
    const label = el("span", "field-label", field.label);
    const input = createDialogInput(field);
    wrapper.append(label, input);
    elements.dialogBody.append(wrapper);
  });

  if (typeof elements.dialog.showModal === "function") {
    elements.dialog.showModal();
  } else {
    elements.dialog.setAttribute("open", "");
  }
}

function setAudioSettingsOpen(isOpen) {
  elements.audioSettingsPanel.hidden = !isOpen;
  elements.audioSettingsToggle.setAttribute("aria-expanded", String(isOpen));
  elements.audioSettingsToggle.classList.toggle("is-active", isOpen);
}

function createDialogInput(field) {
  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
  } else if (field.type === "select") {
    input = document.createElement("select");
    (field.options || []).forEach((option) => {
      input.append(new Option(option.label, option.value));
    });
  } else if (field.type === "color") {
    const row = el("div", "color-row");
    input = document.createElement("input");
    input.type = "color";
    row.append(input, el("span", "micro-copy", " "));
    input.name = field.name;
    input.value = field.value || "#0a5f59";
    return row;
  } else {
    input = document.createElement("input");
    input.type = field.type || "text";
  }

  input.name = field.name;
  input.value = field.value || "";
  input.required = Boolean(field.required);
  if (input.tagName === "INPUT") {
    input.className = "text-input";
  }
  return input;
}

function collectDialogValues() {
  const formData = new FormData(elements.dialogForm);
  return Object.fromEntries(formData.entries());
}

// The native `required` attribute accepts "   "; trim required fields and
// reject the ones that are blank so they are not silently dropped on reload.
function validateRequiredDialogValues(values, requiredNames) {
  const next = { ...values };
  for (const name of requiredNames) {
    next[name] = String(next[name] ?? "").trim();
    if (!next[name]) return { ok: false, field: name, values: next };
  }
  return { ok: true, values: next };
}

function closeDialog() {
  dialogSubmitHandler = null;
  dialogRequiredFields = [];
  if (typeof elements.dialog.close === "function") {
    elements.dialog.close();
  } else {
    elements.dialog.removeAttribute("open");
  }
}

function setCurrentText(text, entryId, options = {}) {
  state.currentText = text;
  state.activeEntryId = entryId;
  selectedWord = null;
  syncInput();
  renderActiveEntryLine();
  renderSentences();
  renderWordPanel();
  if (!options.skipPersist) persist();
}

function createAlbum(title, description = "", coverColor = pickAlbumColor()) {
  const timestamp = nowIso();
  const album = {
    id: makeId("album"),
    title: title.trim(),
    description: description.trim(),
    coverColor,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.albums.push(album);
  return album;
}

function createTape(albumId, title, description = "") {
  const timestamp = nowIso();
  const tape = {
    id: makeId("tape"),
    albumId,
    title: title.trim(),
    description: description.trim(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.tapes.push(tape);
  return tape;
}

function createEntry(tapeId, title, text, notes = "", options = {}) {
  const timestamp = nowIso();
  const entry = {
    id: makeId("entry"),
    tapeId,
    title: title.trim(),
    text: text.trim(),
    notes: notes.trim(),
    language: options.language === "en" ? "en" : "fr",
    materialType: ["情景对话", "文章", "歌词", "笔记", "自定义文本"].includes(options.materialType) ? options.materialType : inferStoredMaterialType(text),
    courseLessonId: options.courseLessonId ? String(options.courseLessonId) : "",
    practiceCount: 0,
    lastPracticedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.entries.push(entry);
  const tape = getTape(tapeId);
  const album = tape ? getAlbum(tape.albumId) : null;
  if (album && !album.courseLessonId) migrateLegacyAlbumsToCourses(state);
  return entry;
}

function createWordbook(title, description = "") {
  const timestamp = nowIso();
  const wordbook = {
    id: makeId("wordbook"),
    title: title.trim(),
    description: description.trim(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.wordbooks.push(wordbook);
  return wordbook;
}

function deleteAlbum(albumId) {
  const album = getAlbum(albumId);
  const albumEntries = getEntriesByAlbum(albumId);
  const lessonIds = new Set([album?.courseLessonId, ...albumEntries.map((entry) => entry.courseLessonId)].filter(Boolean));
  if (!album || !window.confirm(`删除磁带「${album.title}」及其中 ${albumEntries.length} 条素材？${lessonRemovalSummary(lessonIds)}`)) return;
  const tapeIds = getTapes(albumId).map((tape) => tape.id);
  state.albums = state.albums.filter((item) => item.id !== albumId);
  state.tapes = state.tapes.filter((item) => item.albumId !== albumId);
  state.entries = state.entries.filter((item) => !tapeIds.includes(item.tapeId));
  removeLessons(lessonIds);
  if (state.ui.selectedAlbumId === albumId) {
    state.ui.selectedAlbumId = state.albums[0]?.id || null;
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }
  if (libraryAlbumScope === albumId) libraryAlbumScope = state.ui.selectedAlbumId || "all";
  if (state.activeEntryId && !getEntry(state.activeEntryId)) {
    state.activeEntryId = null;
  }
  persist();
  renderAll();
}

function deleteEntry(entryId) {
  const entry = getEntry(entryId);
  if (!entry || !window.confirm(`删除素材「${entry.title}」？${lessonRemovalSummary([entry.courseLessonId])}`)) return;
  state.entries = state.entries.filter((item) => item.id !== entryId);
  removeLessons([entry.courseLessonId]);
  if (state.activeEntryId === entryId) {
    state.activeEntryId = null;
  }
  persist();
  renderAll();
}

function recordPracticeIfEntry() {
  const entry = getEntry(state.activeEntryId);
  if (!entry) return;
  entry.practiceCount = Number(entry.practiceCount || 0) + 1;
  entry.lastPracticedAt = nowIso();
  entry.updatedAt = nowIso();
  persist();
  renderActiveEntryLine();
  renderLibrary();
}

function addWordToVocabulary(rawWord, courseInfo = null) {
  const item = ensureVocabularyItem(rawWord, courseInfo);
  trackSeenForm(item, rawWord);
  const selectedBookId = selectedCustomWordbookId();
  if (selectedBookId) {
    addVocabularyToWordbook(item, selectedBookId);
  }
  return item;
}

function ensureVocabularyItem(rawWord, courseInfo = null) {
  const existing = findVocabulary(rawWord, courseInfo);
  if (existing) return existing;
  const item = buildVocabularyItem(rawWord, courseInfo);
  state.vocabulary.push(item);
  return item;
}

function buildVocabularyItem(rawWord, courseInfo = null) {
  const info = resolveWordInfo(rawWord);
  const hint = info.lexicon || lookupLexicon(rawWord);
  const presentation = vocabularyPresentation(rawWord, {
    lemma: courseInfo?.lemma || hint?.word || info.lemma,
    pos: courseInfo?.partOfSpeech || courseInfo?.pos || ""
  });
  return {
    id: makeId("word"),
    word: presentation.displayWord,
    surface: presentation.surface,
    lemma: presentation.lemma,
    normalized: presentation.identity,
    partOfSpeech: presentation.pos,
    // "音标待补充" and similar are display placeholders, not data: store them
    // as empty so the word shows up in the DIY wordbook until it is filled in.
    ipa: [courseInfo?.ipa, hint?.ipa].find(hasMeaningfulText) || "",
    zh: [courseInfo?.zh, hint?.zh].find(hasMeaningfulText) || "",
    en: courseInfo?.en || "",
    status: "new",
    wordbookIds: selectedCustomWordbookId() ? [selectedCustomWordbookId()] : [],
    seenForms: [{ form: rawWord.trim(), normalized: info.normalized, count: 1 }],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function addVocabularyToWordbook(item, wordbookId) {
  if (!wordbookId) return;
  if (!Array.isArray(item.wordbookIds)) item.wordbookIds = [];
  if (!item.wordbookIds.includes(wordbookId)) {
    item.wordbookIds.push(wordbookId);
    item.updatedAt = nowIso();
  }
}

function toggleVocabularyStatus(vocabId) {
  const item = getVocabulary(vocabId);
  if (!item) return;
  item.status = item.status === "got" ? "new" : "got";
  item.updatedAt = nowIso();
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
}

function deleteVocabulary(vocabId) {
  const item = getVocabulary(vocabId);
  if (!item || !window.confirm(`删除单词「${item.word}」？`)) return;
  state.vocabulary = state.vocabulary.filter((word) => word.id !== vocabId);
  if (selectedWord && resolveWordInfo(selectedWord.raw).lemma === item.normalized) {
    selectedWord = null;
  }
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
}

function findVocabulary(rawWord, courseInfo = null) {
  const info = resolveWordInfo(rawWord);
  const presentation = vocabularyPresentation(rawWord, {
    lemma: courseInfo?.lemma || info.lexicon?.word || info.lemma,
    pos: courseInfo?.partOfSpeech || courseInfo?.pos || ""
  });
  return state.vocabulary.find((item) => item.normalized === presentation.identity) || null;
}

function getVocabulary(vocabId) {
  return state.vocabulary.find((item) => item.id === vocabId) || null;
}

function getWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.find((book) => book.id === wordbookId)
    || state.wordbooks.find((book) => book.id === wordbookId)
    || null;
}

function isSystemWordbook(wordbookId) {
  return SYSTEM_WORDBOOKS.some((book) => book.id === wordbookId);
}

function isKnownWordbookId(wordbookId) {
  return isSystemWordbook(wordbookId) || state.wordbooks.some((book) => book.id === wordbookId);
}

function wordbookScopeValue(wordbookId) {
  return isSystemWordbook(wordbookId) ? wordbookId : `book:${wordbookId}`;
}

function wordbookIdFromScope(scopeValue, currentWordbookId = state.ui.selectedWordbookId) {
  if (scopeValue === "current") return currentWordbookId || ALL_WORDBOOK_ID;
  if (String(scopeValue || "").startsWith("book:")) return String(scopeValue).slice(5);
  return scopeValue || ALL_WORDBOOK_ID;
}

function vocabularyForWordbook(wordbookId) {
  return state.vocabulary.filter((item) => vocabularyMatchesWordbook(item, wordbookId));
}

function vocabularyMatchesWordbook(item, wordbookId) {
  if (!wordbookId || wordbookId === ALL_WORDBOOK_ID) return true;
  if (wordbookId === NEW_WORDBOOK_ID) return item.status !== "got";
  if (wordbookId === GOT_WORDBOOK_ID) return item.status === "got";
  if (wordbookId === DIY_WORDBOOK_ID) return isDiyVocabulary(item);
  return Array.isArray(item.wordbookIds) && item.wordbookIds.includes(wordbookId);
}

function vocabularyMatchesScope(item, scopeValue, currentWordbookId = state.ui.selectedWordbookId) {
  return vocabularyMatchesWordbook(item, wordbookIdFromScope(scopeValue, currentWordbookId));
}

function vocabularyForScope(scopeValue, vocabulary = state.vocabulary, currentWordbookId = state.ui.selectedWordbookId) {
  return vocabulary.filter((item) => vocabularyMatchesScope(item, scopeValue, currentWordbookId));
}

function wordbookScopeLabel(scopeValue, sourceWordbooks = state.wordbooks, currentWordbookId = state.ui.selectedWordbookId) {
  const wordbookId = wordbookIdFromScope(scopeValue, currentWordbookId);
  if (scopeValue === "current") {
    const selected = getWordbook(currentWordbookId);
    return `当前：${selected?.title || "all"}`;
  }
  if (wordbookId === ALL_WORDBOOK_ID) return "全部词句本";
  if (wordbookId === NEW_WORDBOOK_ID) return "new";
  if (wordbookId === GOT_WORDBOOK_ID) return "got";
  if (wordbookId === DIY_WORDBOOK_ID) return "DIY";
  return sourceWordbooks.find((wordbook) => wordbook.id === wordbookId)?.title || "自定义单词本";
}

function wordbooksForVocabulary(vocabulary, sourceWordbooks = state.wordbooks) {
  const ids = new Set();
  vocabulary.forEach((item) => {
    (item.wordbookIds || []).forEach((id) => ids.add(id));
  });
  return sourceWordbooks.filter((wordbook) => ids.has(wordbook.id));
}

function wordbooksForScope(scopeValue, vocabulary, sourceWordbooks = state.wordbooks, currentWordbookId = state.ui.selectedWordbookId) {
  const wordbookId = wordbookIdFromScope(scopeValue, currentWordbookId);
  if (wordbookId === ALL_WORDBOOK_ID) return sourceWordbooks;
  if (!isSystemWordbook(wordbookId)) {
    const custom = sourceWordbooks.find((wordbook) => wordbook.id === wordbookId);
    return custom ? [custom] : [];
  }
  return wordbooksForVocabulary(vocabulary, sourceWordbooks);
}

function isDiyVocabulary(item) {
  return !hasMeaningfulText(item.ipa) || !hasMeaningfulText(item.zh);
}

function selectedCustomWordbookId() {
  const selected = state.ui.selectedWordbookId;
  return state.wordbooks.some((book) => book.id === selected) ? selected : "";
}

function lookupLexicon(rawWord) {
  const lexicon = window.OOFR_LEXICON || {};
  const normalized = normalizeWord(rawWord);
  const candidates = legacyLexiconCandidates(normalized);
  return candidates.map((candidate) => lexicon[candidate]).find(Boolean) || null;
}

function isLexiconReady() {
  return Boolean(window.OOFR_LEXICON_META?.entries && window.OOFR_LEXICON && window.OOFR_FORM_LEMMAS);
}

function isLexiconLoading() {
  return !isLexiconReady() && lexiconLoadState !== "failed";
}

function resolveWordInfo(rawWord) {
  const lexicon = window.OOFR_LEXICON || {};
  const forms = window.OOFR_FORM_LEMMAS || {};
  const normalized = normalizeWord(rawWord);
  const candidates = legacyLexiconCandidates(normalized);
  const direct = lexicon[normalized];
  const directHasMeaning = Boolean(direct?.zh);
  const mappedLemma = directHasMeaning ? "" : candidates.map((candidate) => forms[candidate]).find(Boolean);
  const fallbackLemma = directHasMeaning ? "" : candidates.map((candidate) => singularFallback(candidate, lexicon)).find(Boolean);
  const directCandidate = candidates.map((candidate) => lexicon[candidate] ? candidate : "").find(Boolean);
  const lemma = directHasMeaning
    ? normalized
    : mappedLemma || fallbackLemma || directCandidate || normalized;
  return {
    raw: rawWord,
    normalized,
    lemma,
    lexicon: lexicon[lemma] || direct || candidates.map((candidate) => lexicon[candidate]).find(Boolean) || null,
    formLexicon: direct || null
  };
}

function wordLookupCandidates(normalized) {
  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  add(normalized);
  add(elidedCore(normalized));
  add(normalized.replace(/['-]/g, ""));
  add(normalized.replace(/['-]/g, "_"));
  normalized.split(/['-]/).filter(Boolean).reverse().forEach(add);
  return candidates;
}

function legacyLexiconCandidates(normalized) {
  const exact = wordLookupCandidates(normalized);
  // The compact legacy lexicon used accent-folded keys. Reusing such a key for
  // an accented spelling can return another word (ça/ca, à/a, où/ou), so only
  // consult those aliases when the input itself has no accents.
  if (foldWordKey(normalized) !== normalized) return exact;
  return exact.flatMap((candidate) => [candidate, foldWordKey(candidate)])
    .filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);
}

function elidedCore(normalized) {
  const parts = normalized.split("'").filter(Boolean);
  if (parts.length < 2) return "";
  const prefix = parts[0];
  if (!ELIDED_PREFIXES.has(prefix)) return "";
  return parts.slice(1).join("'");
}

function singularFallback(normalized, lexicon) {
  if (normalized.length <= 3) return "";
  if (normalized.endsWith("aux") && lexicon[`${normalized.slice(0, -3)}al`]) {
    return `${normalized.slice(0, -3)}al`;
  }
  if (normalized.endsWith("x") && lexicon[normalized.slice(0, -1)]) {
    return normalized.slice(0, -1);
  }
  if (normalized.endsWith("s") && lexicon[normalized.slice(0, -1)]) {
    return normalized.slice(0, -1);
  }
  return "";
}

function trackSeenForm(item, rawWord) {
  const normalized = normalizeWord(rawWord);
  if (!normalized) return;
  if (!Array.isArray(item.seenForms)) item.seenForms = [];
  const existing = item.seenForms.find((entry) => entry.normalized === normalized);
  if (existing) {
    existing.count = Number(existing.count || 0) + 1;
    existing.form = rawWord.trim() || existing.form;
  } else {
    item.seenForms.push({ form: rawWord.trim(), normalized, count: 1 });
  }
  item.updatedAt = nowIso();
}

function normalizeWord(word) {
  return String(word || "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’]/g, "'")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}'\-]/gu, "")
    .replace(/^['-]+|['-]+$/g, "");
}

function foldWordKey(word) {
  return normalizeWord(word).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isVerbPartOfSpeech(pos) {
  return /(^|[\s/·;,；，|])(verb|verbe|动词)([\s/·;,；，|]|$)/i.test(String(pos || ""));
}

function likelyFrenchVerbLemma(lemma, surface = "") {
  const normalizedLemma = normalizeWord(lemma);
  return normalizedLemma !== normalizeWord(surface) && /(?:er|ir|re|oir)$/.test(normalizedLemma);
}

function vocabularyDisplayWord(surface, lemma, pos, language = "fr") {
  const cleanSurface = canonicalCourseLookupSurface(surface, language) || String(surface || "").trim();
  if (/\s/u.test(cleanSurface)) return cleanSurface;
  return isVerbPartOfSpeech(pos) || (language === "fr" && likelyFrenchVerbLemma(lemma, cleanSurface))
    ? String(lemma || cleanSurface).trim()
    : cleanSurface;
}

function vocabularyPresentation(surface, info = {}, language = "fr") {
  const cleanSurface = canonicalCourseLookupSurface(surface, language) || String(surface || "").trim();
  const lemma = String(info.lemma || cleanSurface).trim();
  const pos = String(info.pos || info.partOfSpeech || "");
  const displayWord = vocabularyDisplayWord(cleanSurface, lemma, pos, language);
  return {
    surface: cleanSurface,
    lemma,
    pos,
    displayWord,
    identity: normalizeWord(displayWord)
  };
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function countWords(text) {
  return Array.from(text.matchAll(wordPattern())).length;
}

function wordPattern() {
  return new RegExp(WORD_PATTERN_SOURCE, "gu");
}

function ensureSelections() {
  if (state.ui.selectedAlbumId && !getAlbum(state.ui.selectedAlbumId)) {
    state.ui.selectedAlbumId = null;
  }

  if (!state.ui.selectedAlbumId && state.albums.length > 0) {
    state.ui.selectedAlbumId = state.albums[0].id;
  }

  if (state.ui.selectedTapeId && !getTape(state.ui.selectedTapeId)) {
    state.ui.selectedTapeId = null;
  }

  if (!state.ui.selectedTapeId && state.ui.selectedAlbumId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }

  const selectedTape = getTape(state.ui.selectedTapeId);
  if (selectedTape && selectedTape.albumId !== state.ui.selectedAlbumId) {
    state.ui.selectedTapeId = getTapes(state.ui.selectedAlbumId)[0]?.id || null;
  }

  if (!isKnownWordbookId(state.ui.selectedWordbookId)) {
    state.ui.selectedWordbookId = ALL_WORDBOOK_ID;
  }
}

function ensureLibraryForSave() {
  if (state.albums.length === 0) {
    const album = createAlbum("练习磁带", "临时保存的法语段落", "#0a5f59");
    const tape = createTape(album.id, "第一盘磁带", "");
    state.ui.selectedAlbumId = album.id;
    state.ui.selectedTapeId = tape.id;
  } else if (state.tapes.length === 0) {
    const albumId = state.ui.selectedAlbumId || state.albums[0].id;
    const tape = createTape(albumId, "第一盘磁带", "");
    state.ui.selectedAlbumId = albumId;
    state.ui.selectedTapeId = tape.id;
  }
}

function getAlbum(albumId) {
  return state.albums.find((album) => album.id === albumId) || null;
}

function getTape(tapeId) {
  return state.tapes.find((tape) => tape.id === tapeId) || null;
}

function getEntry(entryId) {
  return state.entries.find((entry) => entry.id === entryId) || null;
}

function getTapes(albumId) {
  return state.tapes.filter((tape) => tape.albumId === albumId);
}

function getEntriesByAlbum(albumId) {
  const tapeIds = getTapes(albumId).map((tape) => tape.id);
  return state.entries.filter((entry) => tapeIds.includes(entry.tapeId));
}

function ensureTapeForAlbum(albumId) {
  const existing = getTapes(albumId)[0];
  if (existing) return existing.id;
  const created = createTape(albumId, "素材", "磁带里的学习素材");
  persist();
  return created.id;
}

function syncSettingsControls() {
  elements.rateControl.value = state.settings.rate;
  elements.pauseControl.value = state.settings.pause;
  if (elements.systemLanguageSelect) elements.systemLanguageSelect.value = state.settings.systemLanguage || "zh";
  if (elements.localAiEndpointInput) elements.localAiEndpointInput.value = state.settings.localAiEndpoint || "http://127.0.0.1:11434";
  if (elements.localAiModelInput) elements.localAiModelInput.value = state.settings.localAiModel || "auto";
  document.documentElement.lang = state.settings.systemLanguage === "fr" ? "fr" : state.settings.systemLanguage === "en" ? "en" : "zh-CN";
  setRepeat(state.settings.repeat);
}

function updateLabels() {
  elements.rateLabel.textContent = `${Number(state.settings.rate).toFixed(2)}x`;
  elements.pauseLabel.textContent = `${Number(state.settings.pause).toFixed(1)}s`;
}

function setRepeat(value) {
  elements.repeatGroup.querySelectorAll("button[data-repeat]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.repeat === String(value)));
  });
  if (elements.courseRepeatSelect) elements.courseRepeatSelect.value = String(getRepeat());
}

// The repeat and gap choices of the player menu always show the saved settings.
function syncCourseTimingControls() {
  if (elements.courseRepeatSelect) elements.courseRepeatSelect.value = String(getRepeat());
  if (!elements.coursePauseSelect) return;
  const options = Array.from(elements.coursePauseSelect.options, (option) => Number(option.value));
  const wanted = Number(state.settings.pause);
  const closest = options.reduce((best, value) => (Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best), options[0]);
  elements.coursePauseSelect.value = String(closest);
}

function getRepeat() {
  const repeat = Math.round(Number(state.settings.repeat));
  return Number.isFinite(repeat) && repeat >= 1 && repeat <= 5 ? repeat : 1;
}

function getPauseMs() {
  return Number(state.settings.pause) * 1000;
}

function loadVoices() {
  if (!canSpeak()) {
    elements.voiceSelect.replaceChildren(new Option("不可用", ""));
    elements.courseVoiceSelect.replaceChildren(new Option("不可用", ""));
    return;
  }

  allVoices = window.speechSynthesis.getVoices();
  frenchVoices = allVoices.filter((voice) => /^fr([-_]|$)/i.test(voice.lang));

  const currentValue = state.settings.voice || "";
  populateVoiceSelect(elements.voiceSelect, frenchVoices, currentValue);

  if (!allVoices.length) {
    // Chrome/Edge fill the list asynchronously (voiceschanged). Until then we
    // know nothing about the user's locked voice, so leave the setting alone.
    syncCourseVoiceSelect();
    return;
  }

  if (state.settings.voiceLocked && frenchVoices.some((voice) => voiceOptionValue(voice) === currentValue || voice.name === currentValue)) {
    elements.voiceSelect.value = currentValue;
  } else {
    const preferred = preferredDefaultVoice();
    const nextVoice = preferred ? voiceOptionValue(preferred) : "";
    elements.voiceSelect.value = nextVoice;
    if (state.settings.voice !== nextVoice || state.settings.voiceLocked) {
      state.settings.voice = nextVoice;
      state.settings.voiceLocked = false;
      persist();
    }
  }

  syncCourseVoiceSelect();

  if (frenchVoices.length === 0) {
    setStatus("未找到法语声音，使用系统默认", { toast: false });
  }
}

function populateVoiceSelect(select, voices, selectedValue = "") {
  if (!select) return;
  select.replaceChildren(new Option("系统默认（fr-FR）", ""));
  if (!voices.length) {
    select.append(new Option("等待系统音色…", "", false, false));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  voices.forEach((voice) => {
    select.append(new Option(`${voice.name} · ${voice.lang}`, voiceOptionValue(voice)));
  });
  if (voices.some((voice) => voiceOptionValue(voice) === selectedValue)) {
    select.value = selectedValue;
  }
}

function voiceOptionValue(voice) {
  return voice.voiceURI || `${voice.name}|${voice.lang}`;
}

function syncCourseVoiceSelect() {
  if (!elements.courseVoiceSelect) return;
  populateVoiceSelect(elements.courseVoiceSelect, frenchVoices, state?.settings?.voice || "");
  elements.courseVoiceSelect.value = state?.settings?.voice || "";
  renderCompactVoiceMenu();
}

function voiceShortName(voice) {
  if (!voice) return "系统默认";
  return String(voice.name || "系统音色").split(/[([]/)[0].trim() || "系统音色";
}

function renderCompactVoiceMenu() {
  if (!elements.courseVoiceButton || !elements.courseVoiceOptions) return;
  const selected = selectedVoice();
  elements.courseVoiceButton.textContent = voiceShortName(selected);
  elements.courseVoiceButton.title = selected ? `${selected.name} · ${selected.lang}` : "使用系统默认音色";
  elements.courseVoiceOptions.replaceChildren();
  const options = [{ value: "", label: "系统默认", voice: null }, ...frenchVoices.map((voice) => ({ value: voiceOptionValue(voice), label: voiceShortName(voice), voice }))];
  options.forEach((option) => {
    const item = button(option.label, `course-voice-option${(state.settings.voice || "") === option.value ? " is-selected" : ""}`, () => {
      state.settings.voice = option.value;
      state.settings.voiceLocked = Boolean(option.value);
      if (elements.courseVoiceSelect) elements.courseVoiceSelect.value = option.value;
      if (elements.voiceSelect) elements.voiceSelect.value = option.value;
      persist();
      renderCompactVoiceMenu();
      closeCompactVoiceMenu();
      setStatus(`音色已切换为：${option.label}`);
    });
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String((state.settings.voice || "") === option.value));
    elements.courseVoiceOptions.append(item);
  });
}

function toggleCompactVoiceMenu() {
  const hidden = elements.courseVoiceOptions.hidden;
  elements.courseVoiceOptions.hidden = !hidden;
  elements.courseVoiceButton.setAttribute("aria-expanded", String(hidden));
}

function closeCompactVoiceMenu() {
  elements.courseVoiceOptions.hidden = true;
  elements.courseVoiceButton.setAttribute("aria-expanded", "false");
}

function closeCompactVoiceMenuOnOutsideClick(event) {
  if (event.target.closest?.(".course-voice-menu")) return;
  closeCompactVoiceMenu();
}

function toggleCourseCustomMenu() {
  const opening = elements.courseCustomOptions.hidden;
  elements.courseCustomOptions.hidden = !opening;
  elements.courseCustomButton.setAttribute("aria-expanded", String(opening));
}

function closeCourseCustomMenu() {
  elements.courseCustomOptions.hidden = true;
  elements.courseCustomButton.setAttribute("aria-expanded", "false");
}

function closeCourseCustomMenuOnOutsideClick(event) {
  if (event.target.closest?.(".course-custom-menu")) return;
  closeCourseCustomMenu();
}

function courseModeLabel(mode) {
  return ({ all: "全文播放", single: "单句循环", loop: "选段循环", speaker: "对话练习" })[mode] || "自定义";
}

function syncCourseCustomMenu() {
  if (!elements.courseCustomButton || !elements.courseCustomOptions) return;
  syncCourseTimingControls();
  elements.courseCustomButton.textContent = courseModeLabel(courseMode);
  elements.courseCustomButton.title = `当前模式：${courseModeLabel(courseMode)}`;
  elements.courseCustomOptions.querySelectorAll("[data-course-mode]").forEach((option) => {
    const selected = option.dataset.courseMode === courseMode;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
}

function preferredDefaultVoice() {
  if (isEdgeBrowser()) {
    const edgeExact = frenchVoices.find((voice) => voice.name === EDGE_DEFAULT_VOICE && voice.lang.toLowerCase() === "fr-fr");
    if (edgeExact) return edgeExact;

    const edgeVoice = frenchVoices.find((voice) => /microsoft\s+henri/i.test(voice.name) && voice.lang.toLowerCase() === "fr-fr");
    if (edgeVoice) return edgeVoice;
  }

  const chromeExact = frenchVoices.find((voice) => voice.name === CHROME_DEFAULT_VOICE && voice.lang.toLowerCase() === "fr-fr");
  if (chromeExact) return chromeExact;

  const chromeVoice = frenchVoices.find((voice) => /google/i.test(voice.name) && /^fr([-_]|$)/i.test(voice.lang));
  if (chromeVoice) return chromeVoice;

  return frenchVoices.find((voice) => voice.lang.toLowerCase() === "fr-fr") || frenchVoices[0] || null;
}

function isEdgeBrowser() {
  return /Edg\//i.test(window.navigator.userAgent);
}

function selectedVoice() {
  const name = state.settings.voice;
  return frenchVoices.find((voice) => voiceOptionValue(voice) === name || voice.name === name) || null;
}

function selectedVoiceForLanguage(language) {
  if (/^fr([-_]|$)/i.test(language)) return selectedFrenchVoice();
  const normalizedLanguage = String(language || "").toLowerCase().replace("_", "-");
  const exact = allVoices.find((voice) => voice.lang?.toLowerCase() === normalizedLanguage);
  if (exact) return exact;
  const family = normalizedLanguage.split("-")[0];
  return allVoices.find((voice) => voice.lang?.toLowerCase().startsWith(`${family}-`)) || null;
}

function selectedFrenchVoice() {
  return selectedVoice() || preferredDefaultVoice() || frenchVoices.find((voice) => voice.lang.toLowerCase() === "fr-fr") || frenchVoices[0] || null;
}

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function setBusy(isBusy) {
  document.body.classList.toggle("is-playing", isBusy);
}

function renderPlaybackControls() {
  renderReaderPlayButton();
  renderSentencePlayButtons();
  renderWordPlayButton();
  renderCoursePlaybackButtons();
  renderCourseTurnPlayButtons();
  renderPhrasebookPlayButtons();
}

function renderReaderPlayButton() {
  const key = "reader:all";
  if (playback.key === key && playback.status === "playing") {
    setButtonContent(elements.playAllReader, "pause", "暂停");
    elements.playAllReader.title = "暂停全文";
    elements.playAllReader.setAttribute("aria-label", "暂停全文");
  } else if (playback.key === key && playback.status === "paused") {
    setButtonContent(elements.playAllReader, "play", "继续");
    elements.playAllReader.title = "继续全文";
    elements.playAllReader.setAttribute("aria-label", "继续全文");
  } else {
    setButtonContent(elements.playAllReader, "play", "全文");
    elements.playAllReader.title = "播放全文";
    elements.playAllReader.setAttribute("aria-label", "播放全文");
  }

  elements.stopReader.disabled = playback.status === "idle";
}

function renderSentencePlayButtons() {
  elements.sentenceList.querySelectorAll(".sentence-play").forEach((button) => {
    const key = button.dataset.playbackKey;
    const row = button.closest(".sentence-row");
    const index = Number(row?.dataset.index || 0) + 1;
    if (playback.key === key && playback.status === "playing") {
      button.innerHTML = icons.pause;
      button.title = `暂停第 ${index} 句`;
      button.setAttribute("aria-label", `暂停第 ${index} 句`);
    } else if (playback.key === key && playback.status === "paused") {
      button.innerHTML = icons.play;
      button.title = `继续第 ${index} 句`;
      button.setAttribute("aria-label", `继续第 ${index} 句`);
  } else {
      button.innerHTML = icons.play;
      button.title = `播放第 ${index} 句`;
      button.setAttribute("aria-label", `播放第 ${index} 句`);
    }
  });
}

function renderPhrasebookPlayButtons() {
  elements.vocabList?.querySelectorAll(".phrasebook-play").forEach((button) => {
    const key = button.dataset.playbackKey;
    const active = playback.key === key && playback.status === "playing";
    const paused = playback.key === key && playback.status === "paused";
    setButtonContent(button, active ? "pause" : "play", active ? "暂停" : paused ? "继续" : "播放");
  });
}

function renderWordPlayButton() {
  if (!selectedWord) {
    elements.wordPlayBtn.innerHTML = icons.speaker;
    return;
  }

  const key = `word:${selectedWord.normalized}`;
  if (playback.key === key && playback.status === "playing") {
    elements.wordPlayBtn.innerHTML = icons.pause;
    elements.wordPlayBtn.title = "暂停单词";
    elements.wordPlayBtn.setAttribute("aria-label", "暂停单词");
  } else if (playback.key === key && playback.status === "paused") {
    elements.wordPlayBtn.innerHTML = icons.play;
    elements.wordPlayBtn.title = "继续单词";
    elements.wordPlayBtn.setAttribute("aria-label", "继续单词");
  } else {
    elements.wordPlayBtn.innerHTML = icons.speaker;
    elements.wordPlayBtn.title = "播放单词";
    elements.wordPlayBtn.setAttribute("aria-label", "播放单词");
  }
}

function setButtonContent(button, iconName, label) {
  button.replaceChildren();
  button.insertAdjacentHTML("beforeend", icons[iconName] || "");
  button.append(el("span", "", label));
}

// Feedback for what the learner just did. It is shown as a short toast (and read
// aloud by screen readers); `toast: false` keeps routine progress text, such as
// "正在播放：第 2 句", out of the way.
function setStatus(text, { toast = true } = {}) {
  elements.statusLine.textContent = text;
  if (toast) showToast(text);
}

let toastTimer = 0;

function showToast(message) {
  const node = elements.toast;
  const text = String(message || "").trim();
  if (!node || !text) return;
  node.textContent = text;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { node.hidden = true; }, Math.min(8000, 2500 + text.length * 70));
}

function exportData() {
  downloadJson(state, `oofr-backup-${dateStamp()}.json`);
}

function activeLearningPackageMaterial(lesson) {
  const entry = state.entries.find((item) => item.courseLessonId === lesson.id) || null;
  const tape = entry ? getTape(entry.tapeId) : null;
  const album = tape ? getAlbum(tape.albumId) : state.albums.find((item) => item.courseLessonId === lesson.id) || null;
  // The package carries the lesson, not the learner's private notes or practice history.
  return { album, tape, entry: entry ? { ...entry, notes: "", practiceCount: 0, lastPracticedAt: null } : null };
}

function dictionaryEntriesForLesson(lesson) {
  const terms = new Set();
  lesson.turns.forEach((turn) => {
    const words = String(turn.text || "").match(new RegExp(WORD_PATTERN_SOURCE, "gu")) || [];
    words.forEach((word) => terms.add(normalizeLexicalUnit(word)));
  });
  (lesson.lexicalUnits || []).forEach((item) => {
    terms.add(normalizeLexicalUnit(item.text));
    terms.add(normalizeLexicalUnit(item.lemma));
  });
  return Object.fromEntries(Object.entries(state.dictionaryEntries || {}).filter(([, item]) => terms.has(normalizeLexicalUnit(item.lemma))));
}

function exportActiveLearningPackage() {
  const lesson = getActiveCourseLesson();
  if (!lesson || !globalThis.OoFRLearningPackage?.build) {
    setStatus("当前课程无法导出学习包");
    return;
  }
  try {
    const payload = globalThis.OoFRLearningPackage.build({
      appVersion: APP_VERSION,
      lesson,
      material: activeLearningPackageMaterial(lesson),
      dictionaryEntries: dictionaryEntriesForLesson(lesson),
      phraseItems: state.phraseItems.filter((item) => item.sourceLessonId === lesson.id)
    });
    downloadJson(payload, `${slugifyFilePart(lesson.title)}-${dateStamp()}.oofr-learning.json`);
    const explanationCount = lesson.turns.filter((turn) => turn.aiExplanation).length;
    setStatus(`学习包已导出：${lesson.turns.length} 句 · ${explanationCount} 句讲解`);
  } catch (error) {
    setStatus(error.message || "学习包导出失败");
  }
}

async function previewLearningPackageFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    pendingLearningPackage = globalThis.OoFRLearningPackage.validate(raw);
    renderLearningPackagePreview(pendingLearningPackage, file.name);
    if (!elements.learningPackageDialog.open) elements.learningPackageDialog.showModal();
  } catch (error) {
    pendingLearningPackage = null;
    setStatus(error.message || "学习包读取失败");
  } finally {
    event.target.value = "";
  }
}

function renderLearningPackagePreview(pkg, filename = "") {
  const lesson = pkg.course;
  const explanationCount = lesson.turns.filter((turn) => turn.aiExplanation).length;
  const translatedCount = lesson.turns.filter((turn) => String(turn.translation || "").trim()).length;
  const lexicalCount = Array.isArray(lesson.lexicalUnits) ? lesson.lexicalUnits.length : 0;
  const existingLesson = state.courseLessons.find((item) => item.id === lesson.id);
  const existing = Boolean(existingLesson);
  const droppedRecordings = existingLesson
    ? carryOverTurns(existingLesson.turns, lesson.turns, { prefer: "new" }).dropped.length
    : 0;
  elements.learningPackageTitle.textContent = `导入：${lesson.title}`;
  elements.learningPackagePreview.replaceChildren(
    el("p", "learning-package-source", filename ? `文件：${filename}` : `来源版本：${pkg.appVersion || "未知"}`),
    learningPackagePreviewRow("课程", lesson.title),
    learningPackagePreviewRow("内容", `${lesson.turns.length} 句 · ${translatedCount} 句译文`),
    learningPackagePreviewRow("AI 缓存", `${explanationCount} 句讲解 · ${lexicalCount} 个固定表达`),
    learningPackagePreviewRow("来源", pkg.material?.album?.title || pkg.material?.tape?.title || pkg.material?.entry?.title || "独立课程"),
    el("p", `micro-copy learning-package-conflict${existing ? " is-warning" : ""}`, existing
      ? `这台设备已有同一课程。默认更新课程，并保留本机逐句录音；也可以导入为副本。${droppedRecordings ? `\n注意：本机有 ${droppedRecordings} 句录音对应的句子在学习包里已不存在，更新后这些录音会被移除；想保留请选“导入为副本”。` : ""}`
      : "这是一门新课程。点击“更新已有课程”会直接加入当前设备。")
  );
  elements.learningPackageUpdateBtn.textContent = existing ? "更新已有课程" : "导入课程";
}

function learningPackagePreviewRow(label, value) {
  const row = el("div", "learning-package-preview-row");
  row.append(el("span", "micro-copy", label), el("strong", "", value));
  return row;
}

function closeLearningPackagePreview() {
  pendingLearningPackage = null;
  if (elements.learningPackageDialog?.open) elements.learningPackageDialog.close();
}

function importPendingLearningPackage(strategy) {
  if (!pendingLearningPackage) return;
  try {
    const importedTitle = applyLearningPackage(pendingLearningPackage, strategy);
    closeLearningPackagePreview();
    setStatus(`${strategy === "copy" ? "学习包已作为副本导入" : "学习包已导入"}：${importedTitle}`);
  } catch (error) {
    setStatus(error.message || "学习包导入失败");
  }
}

// Ids from files are untrusted: they end up in storage keys and CSS selectors.
const SAFE_ID_PATTERN = /^[\w:.-]{1,80}$/;

function applyLearningPackage(pkg, strategy = "update") {
  const source = globalThis.OoFRLearningPackage.validate(pkg);
  const copyMode = strategy === "copy";
  const sourceLessonId = String(source.course.id);
  const lessonId = copyMode || !SAFE_ID_PATTERN.test(sourceLessonId) ? makeId("course") : sourceLessonId;
  const importedLesson = cloneJson(source.course);
  importedLesson.id = lessonId;
  if (copyMode) importedLesson.title = `${importedLesson.title}（导入）`;
  importedLesson.turns = importedLesson.turns.map((turn, index) => ({
    ...turn,
    id: !copyMode && SAFE_ID_PATTERN.test(String(turn.id || "")) ? String(turn.id) : `${lessonId}_turn_${index + 1}`,
    recording: { status: "none", durationMs: 0, mediaKey: "" }
  }));

  const existingLesson = copyMode ? null : state.courseLessons.find((item) => item.id === lessonId);
  const normalizedLesson = normalizeCourseLesson(importedLesson);
  if (!normalizedLesson?.turns.length) throw new Error("学习包里没有可学习的句子，已取消导入");
  let dropped = [];
  if (existingLesson) {
    // The package brings translations and AI notes; recordings exist only on this device.
    const carried = carryOverTurns(existingLesson.turns, normalizedLesson.turns, { prefer: "new" });
    normalizedLesson.turns = carried.turns;
    dropped = carried.dropped;
  }

  const material = importLearningPackageMaterial(source.material, normalizedLesson, copyMode);
  queueRecordingRelease(dropped.map((turn) => turn.recording.mediaKey));
  const lessonIndex = state.courseLessons.findIndex((item) => item.id === normalizedLesson.id);
  if (lessonIndex >= 0) state.courseLessons.splice(lessonIndex, 1, normalizedLesson);
  else state.courseLessons.unshift(normalizedLesson);

  state.dictionaryEntries = normalizeDictionaryEntryCache({ ...state.dictionaryEntries, ...source.dictionaryEntries });
  source.phraseItems.forEach((raw) => {
    const item = normalizePhraseItem({
      ...raw,
      id: copyMode || !SAFE_ID_PATTERN.test(String(raw.id || "")) ? makeId("phrase") : raw.id,
      sourceLessonId: normalizedLesson.id,
      sourceTitle: normalizedLesson.title
    });
    if (!item) return;
    const existing = state.phraseItems.find((candidate) => candidate.id === item.id || (candidate.sourceLessonId === item.sourceLessonId && candidate.text === item.text));
    if (!existing) state.phraseItems.push(item);
  });

  state.activeCourseId = normalizedLesson.id;
  state.activeEntryId = material.entry?.id || null;
  state.ui.activeView = "course";
  courseActiveLessonId = normalizedLesson.id;
  courseCurrentTurnIndex = 0;
  persist();
  renderAll();
  setCourseStage("player");
  return normalizedLesson.title;
}

// Brings the package's material (album / tape / entry) onto this device.
// Updating never rewrites what the learner already has: an existing album or
// tape is kept as is, and an existing entry only takes the package's text and
// type while keeping local notes and practice history.
function importLearningPackageMaterial(material, lesson, copyMode) {
  if (!material || (!material.album && !material.tape && !material.entry)) return { album: null, tape: null, entry: null };
  const albumSource = material.album || {};
  const tapeSource = material.tape || {};
  const entrySource = material.entry || {};
  const safeSourceId = (value) => (!copyMode && SAFE_ID_PATTERN.test(String(value || "")) ? String(value) : "");
  const fallbackText = lesson.turns.map((turn) => lesson.materialType === "情景对话" ? `${turn.speakerLabel}: ${turn.text}` : turn.text).join("\n");
  const entryFields = {
    title: entrySource.title || lesson.title,
    text: typeof entrySource.text === "string" && entrySource.text.trim() ? entrySource.text : fallbackText,
    language: lesson.language,
    materialType: lesson.materialType,
    courseLessonId: lesson.id
  };

  const existingEntry = safeSourceId(entrySource.id) ? getEntry(safeSourceId(entrySource.id)) : null;
  if (existingEntry) {
    const tape = getTape(existingEntry.tapeId);
    const album = tape ? getAlbum(tape.albumId) : null;
    Object.assign(existingEntry, entryFields, { updatedAt: nowIso() });
    if (album) state.ui.selectedAlbumId = album.id;
    if (tape) state.ui.selectedTapeId = tape.id;
    return { album, tape, entry: existingEntry };
  }

  let tape = safeSourceId(tapeSource.id) ? getTape(safeSourceId(tapeSource.id)) : null;
  let album = tape ? getAlbum(tape.albumId) : (safeSourceId(albumSource.id) ? getAlbum(safeSourceId(albumSource.id)) : null);
  // A package without an album joins the album the learner has open, untouched.
  if (!album && !copyMode && !material.album) album = getAlbum(state.ui.selectedAlbumId);
  if (!album) {
    const albumId = safeSourceId(albumSource.id) || makeId("album");
    album = normalizeAlbum({
      ...albumSource,
      id: albumId,
      title: copyMode ? `${albumSource.title || lesson.title}（导入）` : (albumSource.title || lesson.title),
      courseLessonId: ""
    }) || normalizeAlbum({ id: albumId, title: lesson.title, description: "从学习包导入", courseLessonId: "" });
    state.albums.push(album);
  }
  if (!tape || tape.albumId !== album.id) {
    const tapeId = safeSourceId(tapeSource.id) && !getTape(safeSourceId(tapeSource.id)) ? safeSourceId(tapeSource.id) : makeId("tape");
    tape = normalizeTape({ ...tapeSource, id: tapeId, albumId: album.id, title: tapeSource.title || "导入素材" })
      || normalizeTape({ id: tapeId, albumId: album.id, title: "导入素材", description: "" });
    state.tapes.push(tape);
  }

  const entryId = safeSourceId(entrySource.id) || makeId("entry");
  const entry = normalizeEntry({ ...entrySource, ...entryFields, id: entryId, tapeId: tape.id });
  if (!entry) throw new Error("学习包素材格式无效");
  state.entries.push(entry);
  state.ui.selectedAlbumId = album.id;
  state.ui.selectedTapeId = tape.id;
  return { album, tape, entry };
}

function exportWordbooks() {
  const scopeValue = elements.wordbookExportScope?.value || ALL_WORDBOOK_ID;
  const payload = buildWordbookExportPayload(scopeValue);
  downloadJson(payload, `oofr-wordbooks-${payload.scope.filePart}-${dateStamp()}.json`);
  setStatus(`已导出${payload.scope.label}：${payload.vocabulary.length} 词`);
}

function buildWordbookExportPayload(scopeValue) {
  const currentWordbookId = state.ui.selectedWordbookId;
  const vocabulary = vocabularyForScope(scopeValue, state.vocabulary, currentWordbookId);
  const wordbooks = wordbooksForScope(scopeValue, vocabulary, state.wordbooks, currentWordbookId);
  const resolvedId = wordbookIdFromScope(scopeValue, currentWordbookId);
  const label = wordbookScopeLabel(scopeValue, state.wordbooks, currentWordbookId);
  return {
    type: "oofr.wordbooks.v1",
    exportedAt: nowIso(),
    scope: {
      value: scopeValue,
      resolvedId,
      label,
      filePart: wordbookScopeFilePart(scopeValue, label, currentWordbookId),
      vocabularyCount: vocabulary.length
    },
    wordbooks: cloneJson(wordbooks),
    vocabulary: cloneJson(vocabulary)
  };
}

function downloadJson(data, filename) {
  downloadText(JSON.stringify(data, null, 2), filename);
}

function downloadText(content, filename, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download on Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      await importBackupText(String(reader.result || ""));
    } catch (error) {
      console.error("OoFR import failed", error);
      setStatus("导入失败");
    } finally {
      elements.importFile.value = "";
    }
  });
  reader.addEventListener("error", () => {
    setStatus("文件读取失败");
    elements.importFile.value = "";
  });
  reader.readAsText(file);
}

// Replaces ALL local data with a backup file. Returns { imported, reason }.
async function importBackupText(text) {
  let imported;
  try {
    imported = JSON.parse(text);
  } catch {
    setStatus("导入失败：文件不是有效的备份");
    return { imported: false, reason: "invalid-json" };
  }
  if (!looksLikeOoFRState(imported)) {
    setStatus(imported?.type === LEARNING_PACKAGE_TYPE ? "这是学习包，请在课程页导入" : "这不是 OoFR 完整数据备份");
    return { imported: false, reason: "not-a-backup" };
  }
  const nextState = ensureStateShape(imported);
  const message = [
    "完整数据导入会覆盖当前设备上的专辑、磁带、段落、单词本和播放设置。",
    `文件包含 ${nextState.albums.length} 专辑、${nextState.tapes.length} 磁带、${nextState.entries.length} 段落、${nextState.vocabulary.length} 词。`,
    "导入前的数据会先暂存一份，之后可在「我的」页点「恢复导入前数据」撤销。"
  ].join("\n");
  if (!window.confirm(message)) {
    setStatus("已取消完整数据导入");
    return { imported: false, reason: "cancelled" };
  }
  const stashed = await stashStateBackup(state);
  if (!stashed && !window.confirm("设备空间不足，无法暂存导入前的数据。仍然导入吗？\n建议先取消，用「导出」备份当前数据。")) {
    setStatus("已取消完整数据导入");
    return { imported: false, reason: "no-backup-space" };
  }

  state = nextState;
  selectedWord = null;
  syncSettingsControls();
  persist();
  renderAll();
  void refreshRestoreButton();
  setStatus("完整数据导入完成");
  return { imported: true };
}

async function stashStateBackup(snapshot) {
  try {
    await storageDriver.setLocal(BACKUP_STORAGE_KEY, snapshot);
    return true;
  } catch {
    return false;
  }
}

// Swaps the stored pre-import copy with the current data, so restoring can
// itself be undone by pressing the button again.
async function restoreStateBackup() {
  let backup = null;
  try {
    backup = await storageDriver.getLocal(BACKUP_STORAGE_KEY);
  } catch {
    backup = null;
  }
  if (!looksLikeOoFRState(backup)) {
    setStatus("没有可恢复的导入前数据");
    return false;
  }
  await stashStateBackup(state);
  state = ensureStateShape(backup);
  selectedWord = null;
  syncSettingsControls();
  persist();
  renderAll();
  void refreshRestoreButton();
  setStatus("已恢复导入前的数据");
  return true;
}

async function refreshRestoreButton() {
  if (!elements.restoreBackupBtn) return;
  let exists = false;
  try {
    exists = await storageDriver.hasLocal(BACKUP_STORAGE_KEY);
  } catch {
    exists = false;
  }
  elements.restoreBackupBtn.hidden = !exists;
}

function importWordbooks(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      const bundle = prepareWordbookImport(imported);
      if (bundle.incomingWordbooks.length === 0 && bundle.incomingVocabulary.length === 0) {
        setStatus("没有找到可导入的单词本数据");
        return;
      }

      openWordbookImportDialog(bundle);
    } catch {
      setStatus("单词本导入失败");
    } finally {
      elements.wordbookImportFile.value = "";
    }
  });
  reader.readAsText(file);
}

function prepareWordbookImport(imported) {
  return {
    sourceScope: imported?.scope || null,
    incomingWordbooks: normalizeWordbookList(imported?.wordbooks || []),
    incomingVocabulary: Array.isArray(imported?.vocabulary)
      ? normalizeVocabularyList(imported.vocabulary)
      : []
  };
}

function openWordbookImportDialog(bundle) {
  const sourceText = bundle.sourceScope?.label ? `原导出范围：${bundle.sourceScope.label}。` : "";
  const diyCount = vocabularyForScope(DIY_WORDBOOK_ID, bundle.incomingVocabulary).length;
  openDialog({
    title: "导入单词本",
    submitText: "导入",
    fields: [
      {
        type: "static",
        label: "预览",
        value: `文件包含 ${bundle.incomingVocabulary.length} 个词、${bundle.incomingWordbooks.length} 个自定义单词本，其中 ${diyCount} 个词需要 DIY 补充。${sourceText}单词本导入会与当前数据取并集，不会删除本地词条。`
      },
      {
        label: "导入范围",
        name: "scope",
        type: "select",
        value: ALL_WORDBOOK_ID,
        options: wordbookImportScopeOptions(bundle)
      },
      {
        label: "重复词处理",
        name: "conflictStrategy",
        type: "select",
        value: WORDBOOK_CONFLICT_KEEP_LOCAL,
        options: [
          { value: WORDBOOK_CONFLICT_KEEP_LOCAL, label: "保留本地 got/new 状态（推荐）" },
          { value: WORDBOOK_CONFLICT_USE_IMPORTED, label: "使用导入文件的状态" }
        ]
      }
    ],
    onSubmit: (values) => applyWordbookImport(bundle, values)
  });
}

function wordbookImportScopeOptions(bundle) {
  const systemOptions = [
    { value: ALL_WORDBOOK_ID, label: `全部（${bundle.incomingVocabulary.length} 词）` },
    { value: NEW_WORDBOOK_ID, label: `仅 new（${vocabularyForScope(NEW_WORDBOOK_ID, bundle.incomingVocabulary).length} 词）` },
    { value: GOT_WORDBOOK_ID, label: `仅 got（${vocabularyForScope(GOT_WORDBOOK_ID, bundle.incomingVocabulary).length} 词）` },
    { value: DIY_WORDBOOK_ID, label: `仅 DIY（${vocabularyForScope(DIY_WORDBOOK_ID, bundle.incomingVocabulary).length} 词）` }
  ];
  const customOptions = bundle.incomingWordbooks.map((wordbook) => {
    const scopeValue = wordbookScopeValue(wordbook.id);
    const count = vocabularyForScope(scopeValue, bundle.incomingVocabulary).length;
    return { value: scopeValue, label: `词句本：${wordbook.title}（${count} 词）` };
  });
  return [...systemOptions, ...customOptions];
}

function applyWordbookImport(bundle, values) {
  const scopeValue = values.scope || ALL_WORDBOOK_ID;
  const conflictStrategy = values.conflictStrategy || WORDBOOK_CONFLICT_KEEP_LOCAL;
  const incomingVocabulary = vocabularyForScope(scopeValue, bundle.incomingVocabulary);
  const incomingWordbooks = wordbooksForScope(scopeValue, incomingVocabulary, bundle.incomingWordbooks);

  if (incomingVocabulary.length === 0 && incomingWordbooks.length === 0) {
    setStatus("这个范围没有可导入的单词");
    return;
  }

  const wordbookSummary = mergeImportedWordbooks(incomingWordbooks, conflictStrategy);
  const vocabularySummary = mergeImportedVocabulary(incomingVocabulary, conflictStrategy);

  state.vocabulary.forEach((item) => {
    item.wordbookIds = validWordbookIds(item.wordbookIds);
  });
  ensureSelections();
  persist();
  renderWordbooks();
  renderVocab();
  renderSentences();
  renderWordPanel();
  renderMy();
  setStatus(`单词本导入完成：新增 ${vocabularySummary.added} 词，合并 ${vocabularySummary.merged} 词；词本新增 ${wordbookSummary.added}，更新 ${wordbookSummary.updated}`);
}

function mergeImportedWordbooks(incomingWordbooks, conflictStrategy = WORDBOOK_CONFLICT_KEEP_LOCAL) {
  const summary = { added: 0, updated: 0 };
  incomingWordbooks.forEach((wordbook) => {
    const existing = state.wordbooks.find((item) => item.id === wordbook.id);
    if (existing) {
      // "Keep local" must also keep a title or description the learner changed here.
      existing.title = mergeImportedText(existing.title, wordbook.title, conflictStrategy);
      existing.description = mergeImportedText(existing.description, wordbook.description, conflictStrategy);
      existing.updatedAt = nowIso();
      summary.updated += 1;
      return;
    }
    state.wordbooks.push({ ...wordbook });
    summary.added += 1;
  });
  return summary;
}

function mergeImportedVocabulary(incomingVocabulary, conflictStrategy) {
  const summary = { added: 0, merged: 0 };
  incomingVocabulary.forEach((incoming) => {
    const item = {
      ...incoming,
      wordbookIds: validWordbookIds(incoming.wordbookIds),
      seenForms: mergeSeenForms([], incoming.seenForms)
    };
    const existing = state.vocabulary.find((word) => word.normalized === item.normalized);
    if (!existing) {
      const idExists = state.vocabulary.some((word) => word.id === item.id);
      state.vocabulary.push({
        ...item,
        id: idExists ? makeId("word") : item.id,
        createdAt: item.createdAt || nowIso(),
        updatedAt: nowIso()
      });
      summary.added += 1;
      return;
    }

    existing.ipa = mergeImportedText(existing.ipa, item.ipa, conflictStrategy);
    existing.zh = mergeImportedText(existing.zh, item.zh, conflictStrategy);
    if (conflictStrategy === WORDBOOK_CONFLICT_USE_IMPORTED) {
      existing.status = item.status === "got" ? "got" : "new";
    }
    existing.wordbookIds = mergeWordbookIds(existing.wordbookIds, item.wordbookIds);
    existing.seenForms = mergeSeenForms(existing.seenForms, item.seenForms, { combine: "max" });
    existing.updatedAt = nowIso();
    summary.merged += 1;
  });
  return summary;
}

function mergeImportedText(localValue, importedValue, conflictStrategy) {
  if (conflictStrategy === WORDBOOK_CONFLICT_USE_IMPORTED) {
    return String(importedValue || localValue || "");
  }
  return String(localValue || importedValue || "");
}

function wordbookScopeFilePart(scopeValue, label, currentWordbookId = state.ui.selectedWordbookId) {
  const wordbookId = wordbookIdFromScope(scopeValue, currentWordbookId);
  if ([ALL_WORDBOOK_ID, NEW_WORDBOOK_ID, GOT_WORDBOOK_ID, DIY_WORDBOOK_ID].includes(wordbookId)) {
    return wordbookId;
  }
  return `book-${slugifyFilePart(label || wordbookId)}`;
}

function slugifyFilePart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "selection";
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        setStatus("离线缓存未启用");
      });
  });
}

function el(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, className, onClick, iconName) {
  const node = el("button", className);
  node.type = "button";
  if (iconName && icons[iconName]) {
    node.insertAdjacentHTML("afterbegin", icons[iconName]);
  }
  node.append(el("span", "", label));
  node.addEventListener("click", onClick);
  return node;
}

function miniButton(label, onClick) {
  const node = el("button", "mini-button", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function emptyState(text) {
  return el("div", "empty-state", text);
}

function pickAlbumColor() {
  const colors = ["#0a5f59", "#b84533", "#356aa0", "#7b4f9f", "#237c4a", "#a35c18"];
  let count = 0;
  try {
    count = Array.isArray(state?.albums) ? state.albums.length : 0;
  } catch {
    count = 0;
  }
  return colors[count % colors.length];
}

function firstSentenceTitle(text) {
  const first = splitSentences(text)[0] || text;
  return first.replace(/\s+/g, " ").slice(0, 28) || "练习段落";
}

function makeId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}
