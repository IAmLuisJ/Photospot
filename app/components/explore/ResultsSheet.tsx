import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { nextSnap, SNAP_HEIGHTS, type SheetSnap } from "~/domain/explore/results-sheet";

/**
 * A draggable sheet over the full-screen map (spec §8, mobile).
 *
 * Pointer events rather than touch events: they cover mouse, touch and pen from
 * one code path, and they make the sheet draggable with a mouse, which is the
 * only way it can be exercised in a desktop preview.
 *
 * All the rules live in `nextSnap`. This component only measures.
 */
export function ResultsSheet({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const drag = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Capture, so a fast drag that leaves the handle still delivers its
    // pointerup here rather than stranding the sheet mid-gesture.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp };
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;

    const deltaY = e.clientY - start.y;
    const elapsed = e.timeStamp - start.t;
    // Guard the divide: a tap can register zero elapsed milliseconds, and
    // Infinity would read as a flick in whichever direction the noise went.
    const velocityY = elapsed > 0 ? deltaY / elapsed : 0;

    setSnap(nextSnap(snap, deltaY, velocityY));
  };

  return (
    <div className="results-sheet" style={{ height: SNAP_HEIGHTS[snap] }} data-snap={snap}>
      <div
        className="results-sheet__handle"
        role="slider"
        aria-label="Results"
        aria-valuetext={snap}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      />
      <div className="results-sheet__body">{children}</div>
    </div>
  );
}
