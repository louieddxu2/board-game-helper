export interface AxisMarkerPosition {
  center: number;
  arrow: number;
}

export const calculateAxisMarkerPosition = (stageWidth: number, markerWidth: number, score: number, scaleStart = 0, scaleEnd = stageWidth): AxisMarkerPosition => {
  const safeStageWidth = Math.max(0, stageWidth);
  const safeMarkerWidth = Math.min(Math.max(0, markerWidth), safeStageWidth);
  const safeScaleStart = Math.max(0, Math.min(safeStageWidth, scaleStart));
  const safeScaleEnd = Math.max(safeScaleStart, Math.min(safeStageWidth, scaleEnd));
  const target = safeScaleStart + (safeScaleEnd - safeScaleStart) * Math.max(0, Math.min(10, score)) / 10;
  const halfMarker = safeMarkerWidth / 2;
  const center = Math.max(halfMarker, Math.min(safeStageWidth - halfMarker, target));
  return {
    center,
    arrow: Math.max(0, Math.min(safeMarkerWidth, target - center + halfMarker)),
  };
};
