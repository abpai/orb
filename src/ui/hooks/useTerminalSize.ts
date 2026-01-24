import { useState, useEffect } from 'react'

interface TerminalSize {
  columns: number
  rows: number
}

const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 }

function getCurrentSize(): TerminalSize {
  if (!process.stdout.isTTY) {
    return DEFAULT_SIZE
  }
  return {
    columns: process.stdout.columns ?? DEFAULT_SIZE.columns,
    rows: process.stdout.rows ?? DEFAULT_SIZE.rows,
  }
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(getCurrentSize)

  useEffect(() => {
    if (!process.stdout.isTTY) return

    const handleResize = () => {
      setSize(getCurrentSize())
    }

    process.stdout.on('resize', handleResize)
    return () => {
      process.stdout.off('resize', handleResize)
    }
  }, [])

  return size
}
