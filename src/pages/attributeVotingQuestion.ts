import { availableAttributeSubjectIds, chooseScopedAttributeQuestion, chooseScopedExtremeExamples, type ScopedAttributeQuestionOptions } from '../lib/attributeCollection';
import { localDb } from '../lib/localDb';
import { chooseAttributeHighPole } from '../shared/attributeScale';
import type { AttributeActivity, AttributeCatalogPayload, AttributeQuestionPayload } from '../shared/types';

export const drawAttributeVotingQuestion = async (
  catalog: AttributeCatalogPayload,
  scopedSubjectIds: string[] | undefined,
  options: ScopedAttributeQuestionOptions,
  activities: AttributeActivity[],
): Promise<AttributeQuestionPayload> => {
  const { deferred, questionNumber } = await localDb.getAttributeQuestionContext();
  const subjectIds = availableAttributeSubjectIds(catalog, scopedSubjectIds, deferred, questionNumber);
  let selection = chooseScopedAttributeQuestion(catalog, subjectIds, options);
  if (!selection && options.allowedAttributeIds && options.excludeAttributeId && !options.fixedAttributeId) {
    // With a narrow pool, both games may still be needed to form an eligible pair.
    selection = chooseScopedAttributeQuestion(catalog, subjectIds, {
      ...options,
      allowPreviousSubjects: true,
    });
  }
  if (!selection) return { question: null, activities, extremeExamples: { lowest: [], highest: [] } };
  const { attributeId, subjectAId, subjectBId } = selection;
  const subjectA = catalog.subjects.find((subject) => subject.id === subjectAId);
  const subjectB = catalog.subjects.find((subject) => subject.id === subjectBId);
  const attribute = catalog.attributes.find((item) => item.id === attributeId);
  if (!subjectA || !subjectB || !attribute) return { question: null, activities };
  await localDb.advanceAttributeQuestionNumber().catch(() => undefined);
  return {
    question: { subjectA, subjectB, attribute, highPole: attribute.scaleType === 'bipolar' ? chooseAttributeHighPole(attribute, options.highPole) : undefined },
    activities,
    scoreModelVersion: catalog.scoreModelVersion,
    extremeExamples: chooseScopedExtremeExamples(catalog, attributeId, scopedSubjectIds),
  };
};
