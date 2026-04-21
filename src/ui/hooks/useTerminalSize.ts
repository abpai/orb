import { useSyncExternalStore } from 'react'

interface TerminalSize {
  columns: number
  rows: number
}

const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 }
const subscribers = new Set<() => void>()
let isListeningForResize = false
let currentSize = DEFAULT_SIZE

function readCurrentSize(): TerminalSize {
  if (!process.stdout.isTTY) {
    return DEFAULT_SIZE
  }
  return {
    columns: process.stdout.columns ?? DEFAULT_SIZE.columns,
    rows: process.stdout.rows ?? DEFAULT_SIZE.rows,
  }
}

function getCurrentSize(): TerminalSize {
  const nextSize = readCurrentSize()
  if (nextSize.columns === currentSize.columns && nextSize.rows === currentSize.rows) {
    return currentSize
  }
  currentSize = nextSize
  return currentSize
}

function notifySubscribers() {
  for (const subscriber of subscribers) {
    subscriber()
  }
}

function handleResize() {
  const nextSize = readCurrentSize()
  if (nextSize.columns === currentSize.columns && nextSize.rows === currentSize.rows) {
    return
  }
  currentSize = nextSize
  notifySubscribers()
}

function attachResizeListener() {
  if (isListeningForResize || !process.stdout.isTTY) return
  currentSize = getCurrentSize()
  process.stdout.on('resize', handleResize)
  isListeningForResize = true
}

function detachResizeListener() {
  if (!isListeningForResize || subscribers.size > 0) return
  process.stdout.off('resize', handleResize)
  isListeningForResize = false
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange)
  attachResizeListener()

  return () => {
    subscribers.delete(onStoreChange)
    detachResizeListener()
  }
}

export function useTerminalSize(): TerminalSize {
  return useSyncExternalStore(subscribe, getCurrentSize, () => DEFAULT_SIZE)
}
