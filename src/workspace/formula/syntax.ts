import type { WorkspaceFormula } from '../types';
import { MAX_FORMULA_DECIMAL_PLACES } from './rounding';

export type FormulaNode = { kind: 'number'; value: number } | { kind: 'source'; columnId: string }
  | { kind: 'unary'; operator: '+' | '-'; operand: FormulaNode }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };
export interface CompiledWorkspaceFormula { node: FormulaNode; sources: string[]; variablesUsed: string[]; decimalPlaces?: number }
interface Token { kind: 'number' | 'variable' | 'symbol' | 'end'; text: string; position: number }
const compiled = new WeakMap<WorkspaceFormula, CompiledWorkspaceFormula | Error>();
const symbols: Record<string, string> = { '×': '*', '÷': '/', '−': '-', '＋': '+', '－': '-', '＊': '*', '／': '/', '（': '(', '）': ')' };
const failure = (position: number, message: string): never => { throw new Error(`公式第 ${position + 1} 個字元：${message}`); };

const tokenize = (expression: string): Token[] => {
  if (!expression.trim()) throw new Error('請輸入計算公式');
  if (expression.length > 4096) throw new Error('公式最多可輸入 4096 個字元');
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/u.test(character)) { index++; continue; }
    const position = index;
    if (character === '[') {
      let name = '', closed = false;
      index++;
      while (index < expression.length) {
        if (expression[index] === ']') {
          if (expression[index + 1] === ']') { name += ']'; index += 2; continue; }
          index++; closed = true; break;
        }
        name += expression[index++];
      }
      if (!closed || !name.trim()) failure(position, '變數名稱缺少結束的 ] 或名稱為空');
      tokens.push({ kind: 'variable', text: name.trim(), position });
    } else if (/[\d.]/u.test(character)) {
      const number = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u)?.[0];
      if (!number || !Number.isFinite(Number(number))) return failure(position, '不是有效的有限數字');
      tokens.push({ kind: 'number', text: number, position }); index += number.length;
    } else if (/[\p{L}_]/u.test(character)) {
      const name = expression.slice(index).match(/^[\p{L}_][\p{L}\p{N}_]*/u)![0];
      tokens.push({ kind: 'variable', text: name, position }); index += name.length;
    } else {
      const symbol = symbols[character] ?? character;
      if (!'+-*/()'.includes(symbol)) failure(position, `不支援「${character}」`);
      tokens.push({ kind: 'symbol', text: symbol, position }); index++;
    }
    if (tokens.length > 1024) throw new Error('公式過於複雜');
  }
  tokens.push({ kind: 'end', text: '', position: expression.length });
  return tokens;
};

const compile = (formula: WorkspaceFormula): CompiledWorkspaceFormula => {
  if (formula.version !== 1) throw new Error('不支援的公式版本');
  if (typeof formula.expression !== 'string' || !formula.variables || typeof formula.variables !== 'object' || Array.isArray(formula.variables)) throw new Error('公式設定格式不正確');
  if (formula.decimalPlaces !== undefined && (!Number.isInteger(formula.decimalPlaces) || formula.decimalPlaces < 0 || formula.decimalPlaces > MAX_FORMULA_DECIMAL_PLACES)) throw new Error(`小數位數必須是 0～${MAX_FORMULA_DECIMAL_PLACES} 的整數`);
  const tokens = tokenize(formula.expression);
  const sources = new Set<string>(), variablesUsed = new Set<string>();
  let index = 0, nodes = 0;
  const peek = () => tokens[index];
  const node = (value: FormulaNode): FormulaNode => { if (++nodes > 512) throw new Error('公式最多支援 512 個運算節點'); return value; };
  const unary = (depth: number): FormulaNode => {
    if (depth > 32) throw new Error('公式括號或正負號巢狀最多 32 層');
    const token = tokens[index++];
    if (token.kind === 'symbol' && (token.text === '+' || token.text === '-')) return node({ kind: 'unary', operator: token.text, operand: unary(depth + 1) });
    if (token.kind === 'number') return node({ kind: 'number', value: Number(token.text) });
    if (token.kind === 'variable') {
      const binding = Object.hasOwn(formula.variables, token.text) ? formula.variables[token.text] : undefined;
      if (!binding || typeof binding.columnId !== 'string' || !binding.columnId) return failure(token.position, `未定義變數「${token.text}」，請使用下方屬性按鈕`);
      sources.add(binding.columnId); variablesUsed.add(token.text);
      return node({ kind: 'source', columnId: binding.columnId });
    }
    if (token.kind === 'symbol' && token.text === '(') {
      const value = expression(0, depth + 1);
      if (peek().text !== ')') failure(peek().position, '缺少右括號 )');
      index++; return value;
    }
    return failure(token.position, '此處需要數字、變數或左括號');
  };
  const precedence = (token: Token) => token.kind === 'symbol' ? token.text === '+' || token.text === '-' ? 1 : token.text === '*' || token.text === '/' ? 2 : 0 : 0;
  const expression = (minimum: number, depth: number): FormulaNode => {
    let left = unary(depth);
    while (precedence(peek()) > minimum) {
      const token = tokens[index++];
      const right = expression(precedence(token), depth);
      left = node({ kind: 'binary', operator: token.text as '+' | '-' | '*' | '/', left, right });
    }
    return left;
  };
  const root = expression(0, 0);
  if (peek().kind !== 'end') failure(peek().position, '此處需要運算符號，或有多餘的括號');
  return { node: root, sources: [...sources], variablesUsed: [...variablesUsed], decimalPlaces: formula.decimalPlaces };
};

/** Formula definitions are immutable; parsing is shared across rows and consumers. */
export const compileWorkspaceFormula = (formula: WorkspaceFormula): CompiledWorkspaceFormula => {
  if (!formula || typeof formula !== 'object') throw new Error('公式設定格式不正確');
  let plan = compiled.get(formula);
  if (!plan) {
    try { plan = compile(formula); } catch (error) { plan = error instanceof Error ? error : new Error('公式設定格式不正確'); }
    compiled.set(formula, plan);
  }
  if (plan instanceof Error) throw plan;
  return plan;
};
