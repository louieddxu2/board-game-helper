import type { AttributeCatalogPayload, AttributeMatrixValue } from '../src/shared/types';

export const WIN_CORRECTIONS = [
  { subjectId: 'attribute_subject_game:game_attribute_import_the_mind', name: '心靈同步', scoreRace: 1, endCondition: 9 },
  { subjectId: 'attribute_config_7th_continent_what_goes_up', name: '第七大陸＋有起必有落', scoreRace: 0, endCondition: 10 },
  { subjectId: 'attribute_subject_game:game_attribute_import_and_then_we_held_hands', name: '然後我們牽起手', scoreRace: 2, endCondition: 8 },
  { subjectId: 'attribute_subject_game:game_attribute_import_fog_of_love', name: '愛霧', scoreRace: 0, endCondition: 10 },
  { subjectId: 'attribute_subject_game:game_attribute_import_hanabi', name: '花火', scoreRace: 8, endCondition: 2 },
] as const;

export const mergeWinScore = (scoreRace: number | null, endCondition: number | null) => {
  for (const value of [scoreRace, endCondition]) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10)) throw new Error('invalid_score');
  }
  if (scoreRace === null) return endCondition;
  if (endCondition === null) return 10 - scoreRace;
  return ((10 - scoreRace) + endCondition) / 2;
};

// A placeholder state is not evidence. Legacy records use counts when evidenceCount is absent.
const hasEvidence = (value: AttributeMatrixValue) => value.evidenceCount == null
  ? value.directCount > 0 || value.comparisonCount > 0 : value.evidenceCount > 0;

export const buildWinMergePreview = (catalog: AttributeCatalogPayload) => {
  const scoreAttribute = catalog.attributes.find((attribute) => attribute.key === 'score_race');
  const conditionAttribute = catalog.attributes.find((attribute) => attribute.key === 'end_condition');
  if (!scoreAttribute || !conditionAttribute) throw new Error('source_attributes_missing');
  const subjectIds = new Set(catalog.subjects.map((subject) => subject.id));
  if (subjectIds.size !== catalog.subjects.length) throw new Error('duplicate_subject');
  const values = new Map<string, AttributeMatrixValue>();
  for (const value of catalog.values) {
    if (value.attributeId !== scoreAttribute.id && value.attributeId !== conditionAttribute.id) continue;
    const key = `${value.subjectId}|${value.attributeId}`;
    if (values.has(key)) throw new Error(`duplicate_value:${key}`);
    if (!subjectIds.has(value.subjectId)) throw new Error(`unknown_subject:${value.subjectId}`);
    mergeWinScore(value.score, null);
    values.set(key, value);
  }
  const missingCorrections = WIN_CORRECTIONS.filter((correction) => !subjectIds.has(correction.subjectId));
  if (missingCorrections.length) throw new Error(`correction_targets_missing:${missingCorrections.map((item) => item.name).join(',')}`);
  const rows = catalog.subjects.map((subject) => {
    const sourceScore = values.get(`${subject.id}|${scoreAttribute.id}`);
    const sourceCondition = values.get(`${subject.id}|${conditionAttribute.id}`);
    const scoreRace = sourceScore && hasEvidence(sourceScore) ? sourceScore.score : null;
    const endCondition = sourceCondition && hasEvidence(sourceCondition) ? sourceCondition.score : null;
    const correction = WIN_CORRECTIONS.find((item) => item.subjectId === subject.id);
    const proposedScoreRace = correction?.scoreRace ?? scoreRace;
    const proposedEndCondition = correction?.endCondition ?? endCondition;
    return {
      subjectId: subject.id, name: subject.displayName, kind: subject.kind,
      scoreRace, endCondition, beforeMerge: mergeWinScore(scoreRace, endCondition),
      proposedScoreRace, proposedEndCondition, merged: mergeWinScore(proposedScoreRace, proposedEndCondition),
      corrected: Boolean(correction),
      disagreement: scoreRace === null || endCondition === null ? null : Math.abs(10 - scoreRace - endCondition),
      // Keep separate provenance. Neither summing counts nor assigning a new RD is justified by averaging.
      sourceScore: sourceScore ?? null, sourceCondition: sourceCondition ?? null,
    };
  });
  return {
    generation: catalog.generation, throughVersion: catalog.throughVersion, snapshotGeneratedAt: catalog.generatedAt,
    scoreAttribute, conditionAttribute, rows,
    pendingCandidates: catalog.candidates.map((candidate) => {
      const scoreRace = candidate.values[catalog.attributes.indexOf(scoreAttribute)] ?? null;
      const endCondition = candidate.values[catalog.attributes.indexOf(conditionAttribute)] ?? null;
      return { id: candidate.id, name: candidate.displayName, scoreRace, endCondition, merged: mergeWinScore(scoreRace, endCondition) };
    }),
  };
};

const number = (value: number | null) => value === null ? '—' : value.toFixed(2).replace(/\.?0+$/, '');
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
export const renderWinMergePreview = (preview: ReturnType<typeof buildWinMergePreview>, fetchedAt: string, source: string) => {
  const known = preview.rows.filter((row) => row.merged !== null);
  const ranked = [...known].sort((a, b) => a.merged! - b.merged! || a.name.localeCompare(b.name, 'zh-Hant'));
  const row = (item: typeof preview.rows[number]) => `| ${cell(item.name)} | ${number(item.scoreRace)} | ${number(item.endCondition)} | ${number(item.beforeMerge)} | ${item.corrected ? `${number(item.proposedScoreRace)}／${number(item.proposedEndCondition)}` : '不變'} | ${number(item.merged)} |`;
  const header = '| 遊戲／配置 | 現有得分 | 現有條件 | 直接平均 | 指定校正（得分／條件） | 預覽結果 |\n|---|---:|---:|---:|---|---:|';
  return `# 得分取勝／條件取勝合併預覽

擷取時間：${fetchedAt}。來源：${source}（公開快照＋增量，版本 ${preview.throughVersion}，快照 generation ${preview.generation}）。

這是唯讀預覽，不是已執行的資料遷移。未新增屬性、修改舊值或停用舊屬性。

## 換算方式

固定方向：0＝${preview.scoreAttribute.name}，10＝${preview.conditionAttribute.name}。

兩筆皆有資料時，結果＝((10 − 得分取勝) ＋ 條件取勝) ÷ 2。只有一筆時用該筆換向後的值；皆無有效證據則未知，不填 5。中間值不是勝利機率或具體比例。

目前 ${preview.rows.length} 個遊戲／配置；預覽有分數 ${known.length} 個、未知 ${preview.rows.length - known.length} 個。指定校正 ${preview.rows.filter((item) => item.corrected).length} 個。另有 ${preview.pendingCandidates.length} 個未對應候選，不混入正式遊戲排名。

## 五款指定校正

以下將指定數字暫作預覽輸入，不覆寫目前社群合成分數，也不冒充新增直接評分。

${header}
${preview.rows.filter((item) => item.corrected).map(row).join('\n')}

## 快餐不校正

${header}
${preview.rows.filter((item) => item.subjectId === 'attribute_subject_game:game_188f6b31d9b1b4888025' || item.subjectId === 'attribute_config_food_chain_magnate_ketchup').map(row).join('\n')}

「不校正」是保留兩個來源值；合併欄位仍依同一公式換算。

## 兩端各三款（僅按數值，並列時按名稱取前三）

${header}
${[...ranked.slice(0, 3), ...[...known].sort((a, b) => b.merged! - a.merged! || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 3)].map(row).join('\n')}

## 兩個舊分數不互補的項目

差距＝|10 − 得分取勝 − 條件取勝|。以下列差距至少 4 的項目；4 只是人工檢視門檻，不代表遊戲資料有錯。平均會丟失這種差異，完整來源狀態另存於 JSON，保留回溯。

| 遊戲／配置 | 現有得分 | 現有條件 | 差距 | 未校正平均 |
|---|---:|---:|---:|---:|
${[...preview.rows].filter((item) => item.disagreement !== null && item.disagreement >= 4).sort((a,b) => b.disagreement! - a.disagreement!).map((item) => `| ${cell(item.name)} | ${number(item.scoreRace)} | ${number(item.endCondition)} | ${number(item.disagreement)} | ${number(item.beforeMerge)} |`).join('\n')}

## 原文（直接保留）

### ${preview.scoreAttribute.name}

${preview.scoreAttribute.fullDescription ?? preview.scoreAttribute.shortDescription ?? ''}

### ${preview.conditionAttribute.name}

${preview.conditionAttribute.fullDescription ?? preview.conditionAttribute.shortDescription ?? ''}

## 全部遊戲／配置

${header}
${preview.rows.map(row).join('\n')}

## 未對應候選（不套用遊戲校正）

| 來源項目 | 得分 | 條件 | 平均 |
|---|---:|---:|---:|
${preview.pendingCandidates.map((item) => `| ${cell(item.name)} | ${number(item.scoreRace)} | ${number(item.endCondition)} | ${number(item.merged)} |`).join('\n')}

## 啟用前仍需處理

- 這次不相加來源 evidenceCount、directCount、comparisonCount，也不推算新的 RD。合併初始狀態必須與新增投票分開，保存兩端來源快照。
- 正式遷移前重抓最新版本並核對差異；不能把本報告當成可直接覆寫的新資料。
- 五款指定校正的套用層次（合併初始值，不覆寫舊投票）、新屬性識別碼、旧欄位保留與回復策略，應隨啟用方案一併驗證。
`;
};
