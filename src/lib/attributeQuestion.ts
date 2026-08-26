export const ATTRIBUTE_QUESTION_ENDINGS: Record<string, string> = {
  mechanism_uniqueness: '程度較高',
  systemic_coherence: '較強',
  cooperation: '較多',
  worker_placement: '成分較多',
  luck: '較多',
  adaptability: '要求較高',
  long_term_planning: '可規劃得較長遠',
  setup_variability: '幅度較大',
  numeric_calculation: '較多',
  process_calculation: '較多',
  interaction_calculation: '較多',
  thematic_integration: '程度較高',
  score_race: '比重較高',
  end_condition: '比重較高',
  personal_puzzle: '成分較多',
  shared_puzzle: '成分較多',
  shared_environment: '變動較大',
  strategic_abstraction: '程度較高',
  engine_building: '比重較高',
  hidden_information: '較多',
  prior_information: '影響較大',
  logical_deduction: '比重較高',
  intentional_inference: '比重較高',
  waiting_for_actions: '時間較長',
  waiting_for_thinking: '時間較長',
  real_time_reaction: '要求較高',
};

export const attributeQuestionEnding = (attributeKey: string) => ATTRIBUTE_QUESTION_ENDINGS[attributeKey] ?? '程度較高';

export interface AttributeComparisonWording {
  higher: string;
  similar: string;
}

const COMPARISON_WORDING_BY_ENDING: Record<string, AttributeComparisonWording> = {
  '較多': { higher: '更多', similar: '數量相近' },
  '成分較多': { higher: '成分更多', similar: '成分相近' },
  '程度較高': { higher: '程度更高', similar: '程度相近' },
  '較強': { higher: '更強', similar: '強度相近' },
  '要求較高': { higher: '要求更高', similar: '要求相近' },
  '可規劃得較長遠': { higher: '能規劃得更長遠', similar: '可規劃的長度相近' },
  '幅度較大': { higher: '變化幅度更大', similar: '變化幅度相近' },
  '變動較大': { higher: '變動幅度更大', similar: '變動幅度相近' },
  '比重較高': { higher: '比重更高', similar: '比重相近' },
  '影響較大': { higher: '影響更大', similar: '影響相近' },
  '時間較長': { higher: '時間更長', similar: '時間相近' },
};

export const attributeComparisonWording = (attributeKey: string): AttributeComparisonWording =>
  COMPARISON_WORDING_BY_ENDING[attributeQuestionEnding(attributeKey)] ?? { higher: '程度更高', similar: '程度相近' };
