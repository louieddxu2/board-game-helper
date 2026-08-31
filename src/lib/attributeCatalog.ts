import type { AttributeCatalogChange, AttributeCatalogPayload, AttributeDefinition, AttributeImportCandidate, AttributeMatrixValue, AttributeSubject } from '../shared/types';

const valueKey = (value: Pick<AttributeMatrixValue, 'subjectId' | 'attributeId'>) => `${value.subjectId}:${value.attributeId}`;

const sortSubjects = (subjects: Iterable<AttributeSubject>) => [...subjects].sort((left, right) =>
  left.displayName.localeCompare(right.displayName, 'zh-Hant') || left.id.localeCompare(right.id));

const sortCandidates = (candidates: Iterable<AttributeImportCandidate>) => [...candidates].sort((left, right) =>
  left.sourceRowNumber - right.sourceRowNumber || left.id.localeCompare(right.id));

const sortAttributes = (attributes: Iterable<AttributeDefinition>) => [...attributes].sort((left, right) =>
  left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));

export const mergeAttributeSubjectMetadata = (current: AttributeSubject | undefined, incoming: AttributeSubject) => {
  if (!current) return incoming;
  const merged = { ...current, ...incoming };
  if (incoming.components === undefined && current.components !== undefined) merged.components = current.components;
  if (incoming.bggIds === undefined && current.bggIds !== undefined) merged.bggIds = current.bggIds;
  return merged;
};

export const applyAttributeCatalogChanges = (
  cached: AttributeCatalogPayload,
  changes: AttributeCatalogChange[],
  throughVersion = changes.at(-1)?.catalogVersion ?? cached.throughVersion,
): AttributeCatalogPayload => {
  const attributes = new Map(cached.attributes.map((attribute) => [attribute.id, attribute]));
  const subjects = new Map(cached.subjects.map((subject) => [subject.id, subject]));
  const values = new Map(cached.values.map((value) => [valueKey(value), value]));
  const candidates = new Map(cached.candidates.map((candidate) => [candidate.id, candidate]));

  changes.forEach((change) => {
    if (change.entryKey.startsWith('attribute:')) {
      const attributeId = change.entryKey.slice('attribute:'.length);
      if (change.deleted) attributes.delete(attributeId);
      else if (change.attribute) attributes.set(change.attribute.id, change.attribute);
    }
    if (change.entryKey.startsWith('subject:')) {
      const subjectId = change.entryKey.slice('subject:'.length);
      if (change.deleted) {
        subjects.delete(subjectId);
        for (const key of values.keys()) {
          if (key.startsWith(`${subjectId}:`)) values.delete(key);
        }
      }
      else if (change.subject) subjects.set(change.subject.id, mergeAttributeSubjectMetadata(subjects.get(change.subject.id), change.subject));
    }
    if (change.entryKey.startsWith('value:')) {
      if (change.deleted) {
        const [subjectId, attributeId] = change.entryKey.slice('value:'.length).split(':');
        if (subjectId && attributeId) values.delete(`${subjectId}:${attributeId}`);
      } else if (change.value) {
        values.set(valueKey(change.value), change.value);
        if (change.subject) subjects.set(change.subject.id, mergeAttributeSubjectMetadata(subjects.get(change.subject.id), change.subject));
      }
    }
    if (change.entryKey.startsWith('candidate:')) {
      const candidateId = change.candidate?.id ?? change.entryKey.slice('candidate:'.length);
      if (change.deleted) candidates.delete(candidateId);
      else if (change.candidate && (change.candidate.matchStatus === 'pending' || change.candidate.matchStatus === 'ambiguous')) candidates.set(candidateId, change.candidate);
      else candidates.delete(candidateId);
    }
  });

  return {
    ...cached,
    throughVersion: Math.max(cached.throughVersion, throughVersion),
    generatedAt: cached.generatedAt,
    attributes: sortAttributes(attributes.values()),
    subjects: sortSubjects(subjects.values()),
    values: [...values.values()],
    candidates: sortCandidates(candidates.values()),
    activities: [],
  };
};
