// The models OoFR installs and uses. Chosen by running this app's own tasks on
// both (v2/docs/ai-model-choice.md): quality first, then memory.

export interface ModelChoice {
  name: string;
  downloadGb: number;
  // Below this much memory the model would push the computer into swap.
  minMemoryGb: number;
}

export const MODELS: ModelChoice[] = [
  { name: "qwen3.5:9b", downloadGb: 6.6, minMemoryGb: 16 },
  { name: "qwen3.5:4b", downloadGb: 3.3, minMemoryGb: 8 }
];

export function isAllowedModel(name: string): boolean {
  return MODELS.some((model) => model.name === name);
}

// The best model this computer can run. memoryGb is null when unknown (a
// browser does not say), and then the standard model is assumed to fit.
export function chooseModel(memoryGb: number | null): ModelChoice {
  return MODELS.find((model) => memoryGb === null || memoryGb >= model.minMemoryGb) ?? MODELS[MODELS.length - 1];
}
