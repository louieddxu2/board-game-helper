import { describe, expect, test } from 'vitest';
import { calculateAxisMarkerPosition } from './axisMarker';

describe('calculateAxisMarkerPosition', () => {
  test('keeps a marker centered on its score when it fits', () => {
    expect(calculateAxisMarkerPosition(300, 100, 5)).toEqual({ center: 150, arrow: 50 });
  });

  test('moves a long label inward while leaving its arrow at the score', () => {
    expect(calculateAxisMarkerPosition(300, 180, 1)).toEqual({ center: 90, arrow: 30 });
    expect(calculateAxisMarkerPosition(300, 180, 9)).toEqual({ center: 210, arrow: 150 });
  });

  test('lets a label use the entire track and still points to both endpoints', () => {
    expect(calculateAxisMarkerPosition(300, 400, 0)).toEqual({ center: 150, arrow: 0 });
    expect(calculateAxisMarkerPosition(300, 400, 10)).toEqual({ center: 150, arrow: 300 });
  });
});
