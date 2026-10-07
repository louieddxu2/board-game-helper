import { useClampedAxisMarker } from '../components/useClampedAxisMarker';
import { type ScopedAttributeQuestionOptions } from '../lib/attributeCollection';
import { attributeComparisonWording } from '../lib/attributeQuestion';
import { type PendingAttributeResponse } from '../lib/localDb';
import { attributeDisplayEndpoints, canonicalAttributeAnswer } from '../shared/attributeScale';
import type { AttributeActivity, AttributeComparisonResult, AttributeQuestion, AttributeScoreExample } from '../shared/types';

export type QuestionMotion = 'idle' | 'answering' | 'leaving' | 'entering' | 'leaving-a' | 'entering-a' | 'leaving-b' | 'entering-b';

export type VoteFeedback = { state: 'saving' | 'saved'; text: string } | null;

export type AttributeVoteScope = 'all' | 'collection';

export type ConnectionState = 'online' | 'offline' | 'server-unavailable';

export type AttributeResponseDraft = Omit<PendingAttributeResponse, 'id' | 'createdAt'>;

export const QUESTION_EXIT_MS = 150;

export const QUESTION_ENTER_MS = 260;

export const SAVED_FEEDBACK_MS = 360;

export const ATTRIBUTE_QUESTION_CACHE_FRESH_MS = 5 * 60 * 1000;

export const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const browserIsOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;

export const connectionStateAfterFailure = (): ConnectionState => browserIsOffline() ? 'offline' : 'server-unavailable';

const subjectName = (subject: { displayName: string }) => <span>{subject.displayName}</span>;

const activitySubject = (subject: { displayName: string }, rating?: number) => <>{subjectName(subject)}{rating != null ? `（${rating}）` : null}</>;

export const activityText = (activity: AttributeActivity) => {
  if (activity.subjectA && activity.subjectB && activity.result) {
    if (activity.attributePoles) {
      const { low, high } = activity.attributePoles;
      const scale = `（0＝${low}，10＝${high}）`;
      if (activity.result === 'SIMILAR') return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 與 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」差不多{scale}</>;
      const higher = activity.result === 'A_HIGHER' ? activity.subjectA : activity.subjectB;
      const lower = activity.result === 'A_HIGHER' ? activity.subjectB : activity.subjectA;
      const higherRating = activity.result === 'A_HIGHER' ? activity.ratingA : activity.ratingB;
      const lowerRating = activity.result === 'A_HIGHER' ? activity.ratingB : activity.ratingA;
      return <>{activity.actorName} 認為 {activitySubject(higher, higherRating)} 比 {activitySubject(lower, lowerRating)} 更偏「{high}」{scale}</>;
    }
    const attributeKey = activity.attributeId.replace(/^attribute[-_]/, '');
    const wording = attributeComparisonWording(attributeKey);
    if (activity.result === 'A_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 的「{activity.attributeName}」比 {activitySubject(activity.subjectB, activity.ratingB)} {wording.higher}</>;
    if (activity.result === 'B_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」比 {activitySubject(activity.subjectA, activity.ratingA)} {wording.higher}</>;
    return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 與 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」{wording.similar}</>;
  }
  return `${activity.actorName} 完成了一筆屬性投票`;
};

export const ExtremeScoreMarker = ({ example, direction, row }: { example: AttributeScoreExample; direction: 'low' | 'high'; row: 'lower' | 'upper' }) => {
  const markerRef = useClampedAxisMarker<HTMLSpanElement>(example.score, `${example.subject.id}:${example.subject.displayName}:${example.score}`);
  return <span
    ref={markerRef}
    className={`attributes-scoreline-marker is-${direction} is-${row}`}
    style={{ left: `${example.score * 10}%` }}
    title={`${example.score} 分：${example.subject.displayName}`}
  >
    <span className="attributes-scoreline-marker-label">{subjectName(example.subject)}</span>
  </span>;
};

export const questionOptions = (question: AttributeQuestion | undefined, mode: 'pair' | 'a' | 'b'): ScopedAttributeQuestionOptions => {
  if (!question) return {};
  const base = {
    excludeSubjectAId: question.subjectA.id,
    excludeSubjectBId: question.subjectB.id,
    excludeAttributeId: question.attribute.id,
  };
  const highPole = question.attribute.scaleType === 'bipolar' ? question.highPole ?? 'high' : undefined;
  if (mode === 'a') return { ...base, fixedSubjectBId: question.subjectB.id, fixedAttributeId: question.attribute.id, highPole };
  if (mode === 'b') return { ...base, fixedSubjectAId: question.subjectA.id, fixedAttributeId: question.attribute.id, highPole };
  return base;
};

export const attributeQuestionKey = (value: AttributeQuestion | undefined) => value
  ? `${value.attribute.id}:${value.subjectA.id}:${value.subjectB.id}:${value.highPole ?? 'high'}`
  : '';

export const comparisonChoiceText = (question: AttributeQuestion, result: AttributeComparisonResult) => {
  const endpoints = attributeDisplayEndpoints(question.attribute, question.highPole);
  const ending = endpoints ? `更偏${endpoints.high.label}` : '較高';
  if (result === 'A_HIGHER') return `${question.subjectA.displayName}${ending}`;
  if (result === 'B_HIGHER') return `${question.subjectB.displayName}${ending}`;
  return '兩款差不多';
};

export const OPTIMISTIC_ACTIVITY_LIMIT = 5;

export const optimisticComparisonActivity = (question: AttributeQuestion, draft: AttributeResponseDraft, actorName: string): AttributeActivity | null => {
  if (!draft.comparison) return null;
  const canonical = canonicalAttributeAnswer(draft);
  return {
    id: `optimistic:${draft.responseId}`,
    responseId: draft.responseId,
    kind: 'comparison',
    actorName,
    attributeId: draft.attributeId,
    attributeName: question.attribute.name,
    attributePoles: question.attribute.scaleType === 'bipolar' && question.attribute.endpoints
      ? { low: question.attribute.endpoints.low.label, high: question.attribute.endpoints.high.label } : undefined,
    subjectA: question.subjectA,
    subjectB: question.subjectB,
    ratingA: canonical.ratingA ?? undefined,
    ratingB: canonical.ratingB ?? undefined,
    result: canonical.comparison ?? undefined,
    createdAt: Date.now(),
  };
};

export const mergeRecentActivities = (serverActivities: AttributeActivity[], optimisticActivities: AttributeActivity[]) => {
  const seen = new Set<string>();
  return [...optimisticActivities, ...serverActivities]
    .filter((activity) => activity.kind === 'comparison')
    .filter((activity) => {
      const key = activity.responseId ? `response:${activity.responseId}` : `activity:${activity.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, OPTIMISTIC_ACTIVITY_LIMIT);
};
