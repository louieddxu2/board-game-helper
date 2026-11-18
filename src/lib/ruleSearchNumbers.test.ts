import { describe, expect, it } from 'vitest';
import { ruleSearchSource } from './ruleSearchNumbers';

const find = (query: string, text: string) => new RegExp(ruleSearchSource(query), 'iu').exec(text)?.[0];

describe('written quantities in rule searches', () => {
  it.each([
    ['3元', '每人拿３元', '３元'],
    ['３元', '每人拿三元', '三元'],
    ['三元', '每人拿 3 元', '3 元'],
    ['每３個一分', '每三個１分', '每三個１分'],
    ['２ 人', '僅限兩人', '兩人'],
    ['兩人', '僅限二人', '二人'],
    ['十二分', '共得１２分', '１２分'],
    ['第10輪', '第十輪', '第十輪'],
    ['101點', '一百零一點', '一百零一點'],
    ['兩百元', '２００元', '２００元'],
    ['20000元', '兩萬元', '兩萬元'],
    ['3萬元', '共得３萬元', '３萬元'],
    ['三萬元', '共得３萬元', '３萬元'],
    ['30萬元', '共得三十萬元', '三十萬元'],
    ['〇分', '0分', '0分'],
    ['[３元]+', '牌上寫著[三元]+', '[三元]+'],
    ['顏色', '圖案顏色不同', '顏色'],
    ['一兩次', '一兩次', '一兩次'],
  ])('finds %s in %s using the original spelling', (query, text, expected) => {
    expect(find(query, text)).toBe(expected);
  });
  it.each([['三元', '13元'], ['3元', '十三元'], ['１２元', '一兩元'], ['03元', '三元']])(
    'keeps %s distinct from %s', (query, text) => expect(find(query, text)).toBeUndefined(),
  );
});
