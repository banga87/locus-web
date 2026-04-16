'use client';

import { useCallback, useRef } from 'react';

import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

const MIN = 220;
const MAX = 480;
const STEP = 8;
const DEFAULT = 280;
const RAIL_WIDTH = 56;

export function ResizeHandle() {
  const { collapsed, width, setWidth } = useSidebarLayout();
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    document.documentElement.setAttribute('data-dragging', '');
  }, [collapsed]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setWidth(e.clientX);
  }, [setWidth]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    document.documentElement.removeAttribute('data-dragging');
  }, []);

  const onDoubleClick = useCallback(() => {
    setWidth(DEFAULT);
  }, [setWidth]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setWidth(width - STEP);
        break;
      case 'ArrowRight':
        e.preventDefault();
        setWidth(width + STEP);
        break;
      case 'Home':
        e.preventDefault();
        setWidth(MIN);
        break;
      case 'End':
        e.preventDefault();
        setWidth(MAX);
        break;
    }
  }, [width, setWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={collapsed ? RAIL_WIDTH : width}
      tabIndex={collapsed ? -1 : 0}
      className="sidebar-resize-handle"
      data-collapsed={collapsed || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  );
}
