/**
 * MathLiveField — 可视化 LaTeX 公式编辑器
 * 基于 mathlive Web Component (<math-field>)，提供所见即所得的公式输入体验。
 */
import React, { useEffect, useRef, useCallback } from 'react'

// 注册 <math-field> 自定义元素（仅执行一次）
import 'mathlive'

// 扩展 JSX 内置元素类型以支持 <math-field>
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'virtual-keyboard-mode'?: string
          'smart-mode'?: string
          'math-mode-space'?: string
          'placeholder'?: string
        },
        HTMLElement
      >
    }
  }
}

interface MathLiveFieldProps {
  value: string
  onChange: (latex: string) => void
  onConfirm?: () => void
  style?: React.CSSProperties
}

type MathfieldEl = HTMLElement & { value: string }

export default function MathLiveField({ value, onChange, onConfirm, style }: MathLiveFieldProps) {
  const ref = useRef<MathfieldEl>(null)
  // 用于防止外部 value 更新触发 onChange 循环
  const suppressInputRef = useRef(false)

  // 外部 value 变化时同步到 math-field（仅在值真正不同时更新）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.value === value) return
    suppressInputRef.current = true
    el.value = value
    // 下一个 tick 恢复监听
    requestAnimationFrame(() => { suppressInputRef.current = false })
  }, [value])

  const handleInput = useCallback(() => {
    if (suppressInputRef.current) return
    const el = ref.current
    if (!el) return
    onChange(el.value)
  }, [onChange])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl/Cmd + Enter 快捷确定
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.stopPropagation()
      onConfirm?.()
    }
  }, [onConfirm])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('input', handleInput)
    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('input', handleInput)
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleInput, handleKeyDown])

  return (
    <math-field
      ref={ref as React.RefObject<HTMLElement>}
      virtual-keyboard-mode="onfocus"
      math-mode-space="\,"
      style={{
        display: 'block',
        width: '100%',
        minHeight: 72,
        fontSize: 20,
        border: '1px solid #d5dbea',
        borderRadius: 6,
        padding: '10px 12px',
        boxSizing: 'border-box',
        outline: 'none',
        fontFamily: 'inherit',
        ...style,
      }}
    />
  )
}
