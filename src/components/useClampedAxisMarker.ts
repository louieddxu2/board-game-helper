import { useLayoutEffect, useRef } from 'react';
import { calculateAxisMarkerPosition } from '../lib/axisMarker';

export const useClampedAxisMarker = <T extends HTMLElement>(score: number, contentKey: string) => {
  const markerRef = useRef<T>(null);

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const stage = marker?.parentElement;
    if (!marker || !stage) return;

    const updatePosition = () => {
      const stageWidth = stage.clientWidth;
      if (stageWidth <= 0) return;
      const rail = stage.querySelector<HTMLElement>('.attribute-score-axis-rail');
      const stageRect = stage.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      const scaleStart = railRect ? railRect.left - stageRect.left : 0;
      const scaleEnd = railRect ? railRect.right - stageRect.left : stageWidth;
      const { center, arrow } = calculateAxisMarkerPosition(stageWidth, marker.offsetWidth, score, scaleStart, scaleEnd);
      marker.style.left = `${center}px`;
      marker.style.setProperty('--attribute-axis-arrow-left', `${arrow}px`);
    };

    updatePosition();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updatePosition);
    observer.observe(stage);
    observer.observe(marker);
    return () => observer.disconnect();
  }, [contentKey, score]);

  return markerRef;
};
