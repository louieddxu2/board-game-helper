import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { WorkspaceColumn, WorkspaceFormula, WorkspaceRow } from '../types';
import { formulaVariableChoices, getWorkspaceFormulaError, quoteWorkspaceFormulaVariable } from './configuration';
import { getWorkspaceEffectiveCell } from './values';
import { MAX_FORMULA_DECIMAL_PLACES } from './rounding';
import { WorkspaceChoice } from '../WorkspaceChoice';

export const emptyWorkspaceFormula = (): WorkspaceFormula => ({ version: 1, expression: '', variables: {} });

export const FormulaEditor = ({ column, columns, formula, previewRow, onChange }: {
  column: WorkspaceColumn; columns: readonly WorkspaceColumn[]; formula: WorkspaceFormula;
  previewRow?: WorkspaceRow; onChange(formula: WorkspaceFormula): void;
}) => {
  const input = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  const pendingCaret = useRef<number | undefined>(undefined);
  const choices = useMemo(() => formulaVariableChoices(columns, column.id, formula), [columns, column.id, formula]);
  const variables = Object.fromEntries([...Object.entries(formula.variables), ...choices.map(choice => [choice.alias, choice.binding] as const)]);
  const complete = { ...formula, variables };
  const error = getWorkspaceFormulaError({ ...column, formula: complete }, columns);
  const preview = !error && previewRow ? getWorkspaceEffectiveCell(previewRow, { ...column, formula: complete }) : undefined;
  const insert = (text: string) => {
    const start = input.current?.selectionStart ?? formula.expression.length;
    const end = input.current?.selectionEnd ?? start;
    pendingCaret.current = start + text.length;
    onChange({ ...complete, expression: formula.expression.slice(0, start) + text + formula.expression.slice(end) });
  };
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = undefined;
  }, [formula.expression]);
  return <div className="workspace-formula-editor">
    <label className="workspace-form-field">計算公式<textarea ref={input} rows={2} aria-label="計算公式" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} value={formula.expression} placeholder="例如：[價格] ÷ [次數]" onChange={event => onChange({ ...complete, expression: event.target.value })} /></label>
    {error ? <p id={errorId} className="form-error" title={error} role="status">{error}</p> : preview && <p className={preview.error ? 'form-error' : undefined} title={preview.error || undefined} role="status">預覽（{String(previewRow?.name || '第一個物件')}）：{preview.value === null ? '空白' : String(preview.value)}</p>}
    <div className="workspace-formula-buttons" role="group" aria-label="公式運算符號">
      {['+', '−', '×', '÷', '(', ')'].map(symbol => <button key={symbol} type="button" aria-label={`插入 ${symbol}`} onPointerDown={event => event.preventDefault()} onClick={() => insert(symbol)}>{symbol}</button>)}
    </div>
    <div className="workspace-formula-buttons workspace-formula-variables" role="group" aria-label="公式欄位變數">
      {choices.map(({ column: source, alias }) => <button key={source.id} type="button" title={alias === source.name ? undefined : `公式變數：${alias}`} aria-label={`插入變數 ${source.name}`} onPointerDown={event => event.preventDefault()} onClick={() => insert(quoteWorkspaceFormulaVariable(alias))}>{source.name || '未命名屬性'}</button>)}
    </div>
    <div className="workspace-form-field workspace-formula-rounding"><span>四捨五入</span><WorkspaceChoice ariaLabel="四捨五入小數位數" value={String(formula.decimalPlaces ?? '')} options={[{ value: '', label: '不設定' }, ...Array.from({ length: MAX_FORMULA_DECIMAL_PLACES + 1 }, (_, places) => ({ value: String(places), label: places === 0 ? '整數（0 位）' : `小數 ${places} 位` }))]} onChange={value => onChange({ ...complete, decimalPlaces: value === '' ? undefined : Number(value) })} /></div>
  </div>;
};
