import React, { useCallback, useRef, useState } from 'react'

export interface DraggableResult {
  pos: { x: number; y: number }
  resetPos: (x: number, y: number) => void
  onHeaderMouseDown: (e: React.MouseEvent<HTMLElement>) => void
}

export function useDraggable(): DraggableResult {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  // keep a ref so onHeaderMouseDown never has stale pos
  const posRef = useRef(pos)
  posRef.current = pos

  const resetPos = useCallback((x: number, y: number) => {
    setPos({ x, y })
  }, [])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return
    // Clicks on buttons inside the header should not start a drag
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const originX = posRef.current.x
    const originY = posRef.current.y

    const onMouseMove = (ev: MouseEvent) => {
      setPos({ x: originX + ev.clientX - startX, y: originY + ev.clientY - startY })
    }
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  return { pos, resetPos, onHeaderMouseDown }
}
