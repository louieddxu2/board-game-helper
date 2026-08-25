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
      const { center, arrow } = calculateAxisMarkerPosition(stageWidth, marker.offsetWidth, score);
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
