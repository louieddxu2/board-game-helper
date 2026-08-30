import { useContext, useMemo, useState } from 'react';
import { ToastContext } from '../context/ToastContext';
import { useDragPanScroll } from '../hooks/useDragPanScroll';
import { rankAttributeSimilarity, type AttributeSimilarityMatch } from '../lib/attributeSimilarity';
import type { AttributeMatrixValue, AttributesPayload } from '../shared/types';

type TableFilter = 'all' | 'processed' | 'pending';

interface AttributeTableRow {
  id: string;
  displayName: string;
  kind: 'processed' | 'pending';
  statusLabel: string;
  values: Array<number | undefined>;
  details: Array<string | undefined>;
  states: Array<AttributeMatrixValue | undefined>;
}

type SortDirection = 'asc' | 'desc';

const formatScore = (value: number | undefined) => value == null ? '—' : value.toFixed(1);

const scoreClass = (value: number | undefined) => {
  if (value == null) return 'empty';
  return value >= 7 ? 'high' : value >= 4 ? 'medium' : 'low';
};

const valueDetails = (value: AttributesPayload['values'][number] | undefined) => {
  if (!value) return '尚無資料';
  const direct = value.directCount > 0 ? `直接 ${value.directCount} 筆` : '無直接分數';
  const comparison = value.comparisonCount > 0 ? `比較 ${value.comparisonCount} 次` : '無比較資料';
  const evidence = value.evidenceCount == null ? '' : `；有效資料 ${value.evidenceCount} 筆`;
  const rd = value.ratingDeviation == null ? '' : `；RD=${value.ratingDeviation.toFixed(2)}`;
  return `目前 ${value.score.toFixed(1)}；${direct}；${comparison}${evidence}${rd}`;
};

export const AttributeMatrixTable = ({ payload }: { payload: AttributesPayload }) => {
  const showToast = useContext(ToastContext)?.showToast;
  const [tableQuery, setTableQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [sort, setSort] = useState<{ attributeId: string; direction: SortDirection }>();
  const [similarity, setSimilarity] = useState<{ anchorId: string; matches: AttributeSimilarityMatch[] }>();
  const tablePan = useDragPanScroll();
  const valueMap = useMemo(() => new Map(payload.values.map((value) => [`${value.subjectId}:${value.attributeId}`, value])), [payload.values]);
  const tableRows = useMemo<AttributeTableRow[]>(() => {
    const processed: AttributeTableRow[] = payload.subjects.map((subject) => {
      const cells = payload.attributes.map((attribute) => valueMap.get(`${subject.id}:${attribute.id}`));
      return {
        id: subject.id,
        displayName: subject.displayName,
        kind: 'processed',
        statusLabel: subject.kind === 'configuration' ? '已建立配置' : '已對應遊戲',
        values: cells.map((value) => value?.score),
        details: cells.map(valueDetails),
        states: cells,
      };
    });
    const pending: AttributeTableRow[] = payload.candidates.map((candidate) => ({
      id: `candidate:${candidate.id}`,
      displayName: candidate.displayName,
      kind: 'pending',
      statusLabel: candidate.matchStatus === 'ambiguous' ? '待確認來源' : '待對應遊戲',
      values: payload.attributes.map((_, index) => candidate.values[index] ?? undefined),
      details: payload.attributes.map(() => '匯入候選值；尚未納入目前遊戲的合成評分'),
      states: payload.attributes.map(() => undefined),
    }));
    return [...processed, ...pending];
  }, [payload, valueMap]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = tableQuery.trim().toLocaleLowerCase();
    return tableRows.filter((row) => {
      if (tableFilter === 'processed' && row.kind !== 'processed') return false;
      if (tableFilter === 'pending' && row.kind !== 'pending') return false;
      return !normalizedQuery || row.displayName.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [tableFilter, tableQuery, tableRows]);

  const sortedRows = useMemo(() => {
    if (similarity) {
      const rowMap = new Map(visibleRows.map((row) => [row.id, row]));
      const anchor = rowMap.get(similarity.anchorId);
      if (!anchor) return [];
      return [anchor, ...similarity.matches.flatMap((match) => {
        const row = rowMap.get(match.subjectId);
        return row ? [row] : [];
      })];
    }
    if (!sort) return visibleRows;
    const attributeIndex = payload.attributes.findIndex((attribute) => attribute.id === sort.attributeId);
    if (attributeIndex < 0) return visibleRows;
    return visibleRows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = left.row.values[attributeIndex];
        const rightValue = right.row.values[attributeIndex];
        if (leftValue == null && rightValue == null) return left.index - right.index;
        if (leftValue == null) return 1;
        if (rightValue == null) return -1;
        const difference = sort.direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
        return difference || left.index - right.index;
      })
      .map(({ row }) => row);
  }, [payload.attributes, similarity, sort, visibleRows]);

  const similarityMap = useMemo(() => new Map(similarity?.matches.map((match) => [match.subjectId, match]) ?? []), [similarity]);

  const selectSimilarityAnchor = (row: AttributeTableRow) => {
    setTableQuery('');
    if (similarity?.anchorId === row.id) {
      setSimilarity(undefined);
      return;
    }
    const matches = rankAttributeSimilarity(row.states, tableRows
      .filter((candidate) => candidate.kind === 'processed' && candidate.id !== row.id)
      .map((candidate) => ({ subjectId: candidate.id, values: candidate.states })));
    if (matches.length === 0) {
      showToast?.('尚無可評斷相近的資料', 'info');
      return;
    }
    setSort(undefined);
    setSimilarity({ anchorId: row.id, matches });
  };

  const toggleSort = (attributeId: string) => {
    setSimilarity(undefined);
    setSort((current) => {
      if (current?.attributeId !== attributeId) return { attributeId, direction: 'desc' };
      if (current.direction === 'desc') return { attributeId, direction: 'asc' };
      return undefined;
    });
  };

  return <section className="attributes-table-card" aria-label="完整屬性資料表">
    <div className="attributes-section-heading"><label className="attributes-search">搜尋遊戲或來源項目<input type="search" value={tableQuery} onChange={(event) => { setTableQuery(event.target.value); setSimilarity(undefined); }} placeholder="輸入名稱" /></label></div>
    <div className="attributes-table-toolbar"><div className="attributes-table-filters" role="group" aria-label="資料狀態篩選">{([['all', '全部'], ['processed', '已對應'], ['pending', '尚未處理']] as const).map(([filter, label]) => <button type="button" key={filter} className={tableFilter === filter ? 'active' : ''} onClick={() => { setTableFilter(filter); setSimilarity(undefined); }}>{label}</button>)}</div><span>顯示 {sortedRows.length} / {tableRows.length} 個項目・{payload.attributes.length} 個屬性</span></div>
    <div
      className={`attributes-table-scroll ${tablePan.panning ? 'is-panning' : ''}`}
      onPointerDown={tablePan.onPointerDown}
      onPointerMove={tablePan.onPointerMove}
      onPointerUp={tablePan.onPointerUp}
      onPointerCancel={tablePan.onPointerCancel}
      onClickCapture={tablePan.onClickCapture}
      onDragStart={(event) => event.preventDefault()}
    >
      <table className="attributes-matrix">
        <thead><tr><th scope="col" className="attributes-matrix-subject">遊戲／來源項目</th>{payload.attributes.map((attribute) => {
          const isSorted = sort?.attributeId === attribute.id;
          const direction = isSorted ? sort.direction : undefined;
          return <th scope="col" key={attribute.id} title={attribute.fullDescription} aria-sort={direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none'}><button type="button" className={`attributes-matrix-sort ${isSorted ? 'is-sorted' : ''}`} onClick={() => toggleSort(attribute.id)} aria-label={`${attribute.name}排序：${direction === 'desc' ? '由大到小' : direction === 'asc' ? '由小到大' : '正常'}`}><span>{attribute.name}</span><span className="attributes-matrix-sort-indicator" aria-hidden="true">{direction === 'desc' ? '↓' : direction === 'asc' ? '↑' : '↕'}</span></button></th>;
        })}</tr></thead>
        <tbody>{sortedRows.map((row) => {
          const match = similarityMap.get(row.id);
          const isAnchor = similarity?.anchorId === row.id;
          const statusLabel = isAnchor ? '相近比較基準' : match ? `共同資料 ${match.sharedAttributeCount} 項` : row.statusLabel;
          return <tr key={row.id} className={`${row.kind === 'pending' ? 'attributes-matrix-pending ' : ''}${isAnchor ? 'attributes-matrix-anchor' : ''}`.trim() || undefined}><th scope="row" className="attributes-matrix-subject">{row.kind === 'processed' ? <button type="button" className="attributes-matrix-subject-button" aria-pressed={isAnchor} onClick={() => selectSimilarityAnchor(row)}>{row.displayName}</button> : <span>{row.displayName}</span>}<small>{statusLabel}</small></th>{row.values.map((value, index) => <td key={payload.attributes[index]?.id ?? index} className={`attributes-matrix-value ${scoreClass(value)}`} title={row.details[index] ?? '尚無資料'}>{formatScore(value)}</td>)}</tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
};
