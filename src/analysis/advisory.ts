export const ADVISORY_CATEGORIES = {
  profanity: 'Profanity',
  violence: 'Violence',
  sexual_content: 'Sexual content',
  substance_use: 'Substance use',
  hate: 'Hate / discrimination',
  self_harm: 'Self-harm / suicide',
} as const;

export type AdvisoryCategory = keyof typeof ADVISORY_CATEGORIES;
export type AdvisoryStatus = 'clear' | 'flagged' | 'uncertain';
