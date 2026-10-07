

export const ATTRIBUTE_COMPARISON_RESULTS = ['A_HIGHER', 'SIMILAR', 'B_HIGHER'] as const;

export type AttributeComparisonResult = (typeof ATTRIBUTE_COMPARISON_RESULTS)[number];

export type AttributePole = 'low' | 'high';

export interface AttributeEndpoint {
  label: string;
  question: string;
  shortDescription?: string;
  fullDescription?: string;
}

export interface AttributeDefinition {
  id: string;
  key: string;
  name: string;
  shortDescription?: string;
  fullDescription?: string;
  /** Missing on legacy catalogs means unipolar. */
  scaleType?: 'unipolar' | 'bipolar';
  endpoints?: { low: AttributeEndpoint; high: AttributeEndpoint };
  minValue: number;
  maxValue: number;
  sortOrder: number;
}

export interface AttributeSubjectComponent {
  order: number;
  gameId?: string;
  type: 'base' | 'expansion' | 'label';
  label: string;
  englishName?: string;
  bggId?: number;
}

export interface AttributeSubject {
  id: string;
  slug: string;
  kind: 'game' | 'configuration';
  displayName: string;
  secondaryName?: string;
  year?: number;
  thumbnailUrl?: string;
  externalSource?: string;
  externalId?: string;
  /** All known BoardGameGeek IDs for this canonical game, including editions. */
  bggIds?: number[];
  gameId?: string;
  gameSlug?: string;
  components?: AttributeSubjectComponent[];
}

export interface AttributeScoreExample {
  subject: AttributeSubject;
  score: number;
}

export interface AttributeExtremeExamples {
  lowest: AttributeScoreExample[];
  highest: AttributeScoreExample[];
}

export interface AttributeImportCandidate {
  id: string;
  displayName: string;
  values: Array<number | null>;
  matchStatus: 'pending' | 'matched' | 'ambiguous' | 'skipped';
  subjectId?: string;
  sourceRowNumber: number;
}

export interface AttributeActivitySubject {
  id: string;
  displayName: string;
  slug?: string;
  gameSlug?: string;
}

export interface AttributeActivity {
  id: string;
  responseId?: string;
  kind: 'rating' | 'comparison';
  actorName: string;
  attributeId: string;
  attributeName: string;
  attributePoles?: { low: string; high: string };
  subject?: AttributeActivitySubject;
  subjectA?: AttributeActivitySubject;
  subjectB?: AttributeActivitySubject;
  value?: number;
  ratingA?: number;
  ratingB?: number;
  result?: AttributeComparisonResult;
  createdAt: number;
}

export interface AttributeQuestion {
  /** Pole presented as 10 in this question. Missing means canonical high. */
  highPole?: AttributePole;
  subjectA: AttributeSubject;
  subjectB: AttributeSubject;
  attribute: AttributeDefinition;
}

export interface AttributeScoreSummary {
  average: number;
  count: number;
  myValue?: number;
}

export interface AttributeProfileEntry extends AttributeScoreSummary {
  attributeId: string;
}

export interface AttributeComparisonSummary {
  result: AttributeComparisonResult;
  count: number;
}

export interface AttributesPayload {
  attributes: AttributeDefinition[];
  subjects: AttributeSubject[];
  values: AttributeMatrixValue[];
  candidates: AttributeImportCandidate[];
  activities: AttributeActivity[];
  scoreModelVersion?: string;
  nextSubjectCursor?: string | null;
  nextCandidateCursor?: string | null;
  hasMoreSubjects?: boolean;
  hasMoreCandidates?: boolean;
}

export interface AttributeCatalogPayload extends AttributesPayload {
  generation: number;
  throughVersion: number;
  generatedAt: number;
}

export interface AttributeCatalogChange {
  entryKey: string;
  catalogVersion: number;
  deleted: boolean;
  attribute?: AttributeDefinition;
  value?: AttributeMatrixValue;
  subject?: AttributeSubject;
  /**
   * A complete replacement for one subject's score rows.  Publishers use
   * this instead of emitting one catalog entry for every attribute state.
   */
  values?: AttributeMatrixValue[];
  candidate?: AttributeImportCandidate;
}

export interface AttributeCatalogChangesPayload {
  changes: AttributeCatalogChange[];
  throughVersion: number;
  hasMore: boolean;
  snapshot: {
    generation: number;
    generatedAt: number;
  };
}

export interface AttributeQuestionPayload {
  question: AttributeQuestion | null;
  activities: AttributeActivity[];
  extremeExamples?: AttributeExtremeExamples;
  scoreModelVersion?: string;
}

export interface AttributeMatrixValue {
  subjectId: string;
  attributeId: string;
  score: number;
  directAverage?: number;
  directCount: number;
  comparisonCount: number;
  decisiveComparisonCount: number;
  evidenceCount?: number;
  ratingDeviation?: number;
  comparisonScore?: number;
  modelVersion: string;
}

export interface AttributeWorkbenchPayload {
  subjectA: AttributeSubject;
  subjectB: AttributeSubject;
  attributeId: string;
  scores: {
    a: AttributeScoreSummary;
    b: AttributeScoreSummary;
  };
  profile: {
    a: AttributeProfileEntry[];
    b: AttributeProfileEntry[];
  };
  comparisons: AttributeComparisonSummary[];
  myComparison?: AttributeComparisonResult;
}
