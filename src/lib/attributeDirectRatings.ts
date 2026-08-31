export const ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT = 1000;

export interface AttributeDirectRatingInput {
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  responseId: string;
  ratingA?: number | null;
  ratingB?: number | null;
}

export interface AttributeDirectRatingRecord {
  key: string;
  ownerId: string;
  subjectId: string;
  attributeId: string;
  value: number;
  responseId: string;
  ratedAt: number;
}

export const attributeDirectRatingKey = (subjectId: string, attributeId: string) =>
  `${subjectId}\u0000${attributeId}`;

export const attributeDirectRatingKeysFromResponse = (input: AttributeDirectRatingInput) => [
  ...(input.ratingA == null ? [] : [attributeDirectRatingKey(input.subjectAId, input.attributeId)]),
  ...(input.ratingB == null ? [] : [attributeDirectRatingKey(input.subjectBId, input.attributeId)]),
];

const storedAttributeDirectRatingKey = (ownerId: string, subjectId: string, attributeId: string) =>
  `${ownerId}\u0000${attributeDirectRatingKey(subjectId, attributeId)}`;

export const attributeDirectRatingRecordsFromResponse = (
  ownerId: string,
  input: AttributeDirectRatingInput,
  ratedAt = Date.now(),
): AttributeDirectRatingRecord[] => [
  ...(input.ratingA == null ? [] : [{
    key: storedAttributeDirectRatingKey(ownerId, input.subjectAId, input.attributeId),
    ownerId,
    subjectId: input.subjectAId,
    attributeId: input.attributeId,
    value: input.ratingA,
    responseId: input.responseId,
    ratedAt,
  }]),
  ...(input.ratingB == null ? [] : [{
    key: storedAttributeDirectRatingKey(ownerId, input.subjectBId, input.attributeId),
    ownerId,
    subjectId: input.subjectBId,
    attributeId: input.attributeId,
    value: input.ratingB,
    responseId: input.responseId,
    ratedAt,
  }]),
];

export const newestAttributeDirectRatingRecords = (
  records: AttributeDirectRatingRecord[],
  limit = ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT,
) => [...records]
  .sort((left, right) => right.ratedAt - left.ratedAt || right.key.localeCompare(left.key))
  .slice(0, Math.max(0, limit));
