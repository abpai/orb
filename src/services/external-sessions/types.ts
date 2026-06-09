import type { SessionSummary } from '../session'

export interface ExternalSessionMeta {
  messageCount: number
  preview: string
  lastModified: string
}

export interface CodexListResult {
  rows: SessionSummary[]
  capped: boolean
}
