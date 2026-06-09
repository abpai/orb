import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AppConfig, LlmModelId, LlmProvider } from '../types'
import { modelCachePath as orbModelCachePath } from './orb-paths'

export const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
export const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000

type ModelCatalogSource = 'gateway' | 'cache' | 'stale-cache' | 'fallback'

interface CatalogModel {
  gatewayId: string
  provider: LlmProvider
  nativeId: LlmModelId
  name?: string
  type?: string
  released?: number
  contextWindow?: number
  maxTokens?: number
  tags: string[]
}

interface LoadedModelCatalog {
  models: CatalogModel[]
  fetchedAt: number
  source: ModelCatalogSource
  warning?: string
}

interface ResolvedModelConfig {
  llmModel: LlmModelId
  llmModelChoices: LlmModelId[]
  llmModelLabels: Record<LlmModelId, string>
  catalog: LoadedModelCatalog
}

interface GatewayModel {
  id?: unknown
  name?: unknown
  type?: unknown
  released?: unknown
  context_window?: unknown
  max_tokens?: unknown
  tags?: unknown
}

interface CachedModelCatalog {
  fetchedAt: number
  models: CatalogModel[]
}

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>

interface LoadModelCatalogOptions {
  cachePath?: string
  fetchImpl?: FetchImpl
  now?: number
  timeoutMs?: number
  ttlMs?: number
}

const PROVIDER_GATEWAY_PREFIX: Record<LlmProvider, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
}

export const DEFAULT_MODEL_ALIAS_BY_PROVIDER: Record<LlmProvider, LlmModelId> = {
  anthropic: 'haiku',
  openai: 'gpt-5.5',
  gemini: 'pro',
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, LlmModelId> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.5',
  gemini: 'gemini-3.1-pro-preview',
}

// ── Model family descriptors ─────────────────────────────────────────────────
//
// One descriptor per alias family. Adding or renaming a family is a single
// entry; matchesAlias, modelAliasFamily, labelForModel, buildProviderModelChoices,
// isModelAlias, and isForeignModelAlias are all derived from this array.

interface ModelFamilyDescriptor {
  provider: LlmProvider
  name: string // alias name used on the CLI / in config
  fallbackModel: LlmModelId // concrete ID used when the catalog is unavailable
  fallbackLabel: string // display label for the fallback model
  matches: (nativeId: string) => boolean // family membership — drives matchesAlias + modelAliasFamily
  label: (nativeId: string) => string // display label — drives labelForModel + buildProviderModelChoices
}

function isGeminiImageModel(nativeId: string): boolean {
  return nativeId.includes('image') || nativeId.includes('imagen')
}

function genericModelLabel(nativeId: string): string {
  return nativeId
    .replace(/^gpt-/, 'GPT ')
    .replace(/^gemini-/, 'Gemini ')
    .split('-')
    .map((part, index) =>
      index === 0 && part === 'GPT'
        ? part
        : part.length <= 3 && /\d/.test(part)
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
}

function anthropicFamilyLabel(familyName: string, nativeId: string): string {
  const version = nativeId.match(/-(\d)-(\d)(?:-|$)/)
  return version ? `${familyName} ${version[1]}.${version[2]}` : familyName
}

const PROVIDER_FAMILIES: Record<LlmProvider, ModelFamilyDescriptor[]> = {
  anthropic: [
    {
      provider: 'anthropic',
      name: 'haiku',
      fallbackModel: 'claude-haiku-4-5-20251001',
      fallbackLabel: 'Haiku 4.5',
      matches: (id) => /^claude-haiku-/.test(id),
      label: (id) => anthropicFamilyLabel('Haiku', id),
    },
    {
      provider: 'anthropic',
      name: 'sonnet',
      fallbackModel: 'claude-sonnet-4-6',
      fallbackLabel: 'Sonnet 4.6',
      matches: (id) => /^claude-sonnet-/.test(id),
      label: (id) => anthropicFamilyLabel('Sonnet', id),
    },
    {
      provider: 'anthropic',
      name: 'opus',
      fallbackModel: 'claude-opus-4-7',
      fallbackLabel: 'Opus 4.7',
      matches: (id) => /^claude-opus-/.test(id),
      label: (id) => anthropicFamilyLabel('Opus', id),
    },
  ],
  openai: [
    {
      provider: 'openai',
      name: 'gpt',
      fallbackModel: 'gpt-5.5',
      fallbackLabel: 'GPT 5.5',
      matches: (id) =>
        /^gpt-\d/.test(id) && !/(?:mini|nano|pro|chat|codex|instant|thinking|oss)/.test(id),
      label: genericModelLabel,
    },
    {
      provider: 'openai',
      name: 'mini',
      fallbackModel: 'gpt-5.4-mini',
      fallbackLabel: 'GPT 5.4 Mini',
      matches: (id) => /^gpt-\d/.test(id) && id.includes('mini'),
      label: genericModelLabel,
    },
    {
      provider: 'openai',
      name: 'nano',
      fallbackModel: 'gpt-5.4-nano',
      fallbackLabel: 'GPT 5.4 Nano',
      matches: (id) => /^gpt-\d/.test(id) && id.includes('nano'),
      label: genericModelLabel,
    },
    {
      provider: 'openai',
      name: 'pro',
      fallbackModel: 'gpt-5.4-pro',
      fallbackLabel: 'GPT 5.4 Pro',
      matches: (id) => /^gpt-\d/.test(id) && id.includes('pro'),
      label: genericModelLabel,
    },
    {
      provider: 'openai',
      name: 'codex',
      fallbackModel: 'gpt-5.3-codex',
      fallbackLabel: 'GPT 5.3 Codex',
      matches: (id) => /^gpt-\d/.test(id) && id.includes('codex'),
      label: genericModelLabel,
    },
  ],
  gemini: [
    {
      provider: 'gemini',
      name: 'pro',
      fallbackModel: 'gemini-3.1-pro-preview',
      fallbackLabel: 'Gemini 3.1 Pro Preview',
      matches: (id) => id.startsWith('gemini-') && !isGeminiImageModel(id) && id.includes('pro'),
      label: genericModelLabel,
    },
    {
      provider: 'gemini',
      name: 'flash',
      fallbackModel: 'gemini-3-flash',
      fallbackLabel: 'Gemini 3 Flash',
      matches: (id) =>
        id.startsWith('gemini-') &&
        !isGeminiImageModel(id) &&
        id.includes('flash') &&
        !id.includes('lite'),
      label: genericModelLabel,
    },
    {
      provider: 'gemini',
      name: 'flash-lite',
      fallbackModel: 'gemini-3.1-flash-lite-preview',
      fallbackLabel: 'Gemini 3.1 Flash Lite Preview',
      matches: (id) =>
        id.startsWith('gemini-') && !isGeminiImageModel(id) && id.includes('flash-lite'),
      label: genericModelLabel,
    },
  ],
}

export const FALLBACK_MODEL_CHOICES_BY_PROVIDER: Record<LlmProvider, LlmModelId[]> = {
  anthropic: PROVIDER_FAMILIES.anthropic.map((f) => f.fallbackModel),
  openai: PROVIDER_FAMILIES.openai.map((f) => f.fallbackModel),
  gemini: PROVIDER_FAMILIES.gemini.map((f) => f.fallbackModel),
}

const FALLBACK_CATALOG_MODELS: CatalogModel[] = (
  Object.entries(PROVIDER_FAMILIES) as [LlmProvider, ModelFamilyDescriptor[]][]
).flatMap(([provider, families]) =>
  families.map((f) => ({
    gatewayId: `${PROVIDER_GATEWAY_PREFIX[provider]}/${f.fallbackModel}`,
    provider,
    nativeId: f.fallbackModel,
    name: f.fallbackLabel,
    type: 'language',
    tags: ['tool-use'],
  })),
)

function modelCachePath(homeDir = os.homedir()): string {
  return orbModelCachePath(homeDir)
}

function getGatewayProvider(id: string): LlmProvider | null {
  const [prefix] = id.split('/', 1)
  if (prefix === 'anthropic') return 'anthropic'
  if (prefix === 'openai') return 'openai'
  if (prefix === 'google') return 'gemini'
  return null
}

function gatewayToNativeId(provider: LlmProvider, gatewayId: string): LlmModelId {
  const nativeId = gatewayId.slice(gatewayId.indexOf('/') + 1)
  if (provider !== 'anthropic') return nativeId

  // Anthropic's native Claude API currently uses a dated Haiku 4.5 ID, while
  // the Gateway catalog publishes the shorter marketing ID.
  if (nativeId === 'claude-haiku-4.5') return 'claude-haiku-4-5-20251001'

  return nativeId.replace(/(\d)\.(\d)/g, '$1-$2')
}

function normalizeGatewayModel(raw: GatewayModel): CatalogModel | null {
  if (typeof raw.id !== 'string') return null

  const provider = getGatewayProvider(raw.id)
  if (!provider) return null

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
    : []

  return {
    gatewayId: raw.id,
    provider,
    nativeId: gatewayToNativeId(provider, raw.id),
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.type === 'string' ? { type: raw.type } : {}),
    ...(typeof raw.released === 'number' ? { released: raw.released } : {}),
    ...(typeof raw.context_window === 'number' ? { contextWindow: raw.context_window } : {}),
    ...(typeof raw.max_tokens === 'number' ? { maxTokens: raw.max_tokens } : {}),
    tags,
  }
}

function parseGatewayPayload(payload: unknown): CatalogModel[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  return data
    .map((model) => normalizeGatewayModel(model as GatewayModel))
    .filter((model): model is CatalogModel => model !== null)
}

function normalizeCachedCatalog(payload: unknown): CachedModelCatalog | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as { fetchedAt?: unknown; models?: unknown }
  if (typeof candidate.fetchedAt !== 'number' || !Array.isArray(candidate.models)) return null

  const models = candidate.models.filter((model): model is CatalogModel => {
    if (!model || typeof model !== 'object') return false
    const typed = model as Partial<CatalogModel>
    return (
      typeof typed.gatewayId === 'string' &&
      typeof typed.provider === 'string' &&
      typeof typed.nativeId === 'string' &&
      Array.isArray(typed.tags)
    )
  })

  return { fetchedAt: candidate.fetchedAt, models }
}

async function readCachedCatalog(cachePath: string): Promise<CachedModelCatalog | null> {
  try {
    const contents = await fs.readFile(cachePath, 'utf8')
    return normalizeCachedCatalog(JSON.parse(contents))
  } catch {
    return null
  }
}

async function writeCachedCatalog(cachePath: string, catalog: CachedModelCatalog): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await Bun.write(cachePath, JSON.stringify(catalog, null, 2))
}

async function fetchGatewayCatalog(
  fetchImpl: FetchImpl,
  timeoutMs: number,
): Promise<CatalogModel[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(GATEWAY_MODELS_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`Gateway model catalog returned HTTP ${response.status}`)
    const models = parseGatewayPayload(await response.json())
    if (models.length === 0) throw new Error('Gateway model catalog was empty')
    return models
  } finally {
    clearTimeout(timeout)
  }
}

export async function loadModelCatalog(
  options: LoadModelCatalogOptions = {},
): Promise<LoadedModelCatalog> {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? MODEL_CATALOG_TTL_MS
  const cachePath = options.cachePath ?? modelCachePath()
  const cached = await readCachedCatalog(cachePath)

  if (cached && now - cached.fetchedAt < ttlMs) {
    return { ...cached, source: 'cache' }
  }

  try {
    const models = await fetchGatewayCatalog(options.fetchImpl ?? fetch, options.timeoutMs ?? 2500)
    const next = { fetchedAt: now, models }
    await writeCachedCatalog(cachePath, next).catch(() => {})
    return { ...next, source: 'gateway' }
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error)
    if (cached) {
      return { ...cached, source: 'stale-cache', warning }
    }
    return { fetchedAt: 0, models: FALLBACK_CATALOG_MODELS, source: 'fallback', warning }
  }
}

function normalizeModelToken(value: string): string {
  return value.trim().toLowerCase()
}

export function isModelAlias(provider: LlmProvider, model: string): boolean {
  const normalized = normalizeModelToken(model)
  return PROVIDER_FAMILIES[provider].some((f) => f.name === normalized)
}

export function isForeignModelAlias(provider: LlmProvider, model: string): boolean {
  const normalized = normalizeModelToken(model)
  return (Object.keys(PROVIDER_FAMILIES) as LlmProvider[]).some(
    (p) => p !== provider && PROVIDER_FAMILIES[p].some((f) => f.name === normalized),
  )
}

function versionParts(id: string): number[] {
  const parts = id.match(/\d+(?:\.\d+)?/g) ?? []
  return parts.flatMap((part) => part.split('.').map((piece) => Number(piece)))
}

function compareVersionedModels(a: CatalogModel, b: CatalogModel): number {
  const aParts = versionParts(a.gatewayId)
  const bParts = versionParts(b.gatewayId)
  const length = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (diff !== 0) return diff
  }

  const releasedDiff = (a.released ?? 0) - (b.released ?? 0)
  if (releasedDiff !== 0) return releasedDiff
  return a.gatewayId.localeCompare(b.gatewayId)
}

function isLanguageModel(model: CatalogModel): boolean {
  return model.type === undefined || model.type === 'language'
}

function matchesAlias(provider: LlmProvider, alias: string, model: CatalogModel): boolean {
  if (model.provider !== provider || !isLanguageModel(model)) return false
  const family = PROVIDER_FAMILIES[provider].find((f) => f.name === alias)
  return family ? family.matches(model.nativeId) : false
}

/**
 * Classify a native model id into its alias family (haiku/sonnet/opus,
 * gpt/mini/nano/pro/codex, flash/flash-lite/pro). Returns null when the id has
 * no recognizable family. Used by the UI to decide whether a saved session's
 * model still maps onto a current choice.
 */
export function modelAliasFamily(provider: LlmProvider, model: LlmModelId): string | null {
  return PROVIDER_FAMILIES[provider].find((f) => f.matches(model))?.name ?? null
}

function anthropicComparableTokens(value: string): string[] {
  const normalized = normalizeModelToken(value)
  const withoutProvider = normalized.replace(/^anthropic\//, '')
  const withoutClaudePrefix = withoutProvider.replace(/^claude-/, '')
  const dashed = withoutClaudePrefix.replace(/\./g, '-')

  return Array.from(new Set([normalized, withoutProvider, withoutClaudePrefix, dashed]))
}

function matchesExactProviderModel(
  provider: LlmProvider,
  requestedModel: string,
  model: CatalogModel,
): boolean {
  if (model.provider !== provider || !isLanguageModel(model)) return false

  const normalized = normalizeModelToken(requestedModel)
  if (normalized === normalizeModelToken(model.nativeId)) return true
  if (normalized === normalizeModelToken(model.gatewayId)) return true

  if (provider !== 'anthropic') return false

  const requestedTokens = new Set(anthropicComparableTokens(requestedModel))
  return [
    ...anthropicComparableTokens(model.nativeId),
    ...anthropicComparableTokens(model.gatewayId),
  ].some((token) => requestedTokens.has(token))
}

function selectExactProviderModel(
  provider: LlmProvider,
  requestedModel: string,
  models: CatalogModel[],
): CatalogModel | null {
  return (
    models
      .filter((model) => matchesExactProviderModel(provider, requestedModel, model))
      .sort(compareVersionedModels)
      .at(-1) ?? null
  )
}

function selectLatestAliasModel(
  provider: LlmProvider,
  alias: string,
  models: CatalogModel[],
): CatalogModel | null {
  return (
    models
      .filter((model) => matchesAlias(provider, alias, model))
      .sort(compareVersionedModels)
      .at(-1) ?? null
  )
}

function labelFromGatewayName(provider: LlmProvider, name?: string): string | undefined {
  if (!name) return undefined
  if (provider === 'anthropic') return name.replace(/^Claude\s+/i, '')
  return name
}

/**
 * The single home for orb's model taxonomy: turns a native model id into its
 * human display label. UI helpers (`formatModelLabel`) delegate here so the
 * provider-specific naming rules live in exactly one place.
 */
export function labelForModel(provider: LlmProvider, nativeId: string): string {
  const family = PROVIDER_FAMILIES[provider].find((f) => f.matches(nativeId))
  return family ? family.label(nativeId) : genericModelLabel(nativeId)
}

export function buildProviderModelChoices(
  provider: LlmProvider,
  models: CatalogModel[],
): { choices: LlmModelId[]; labels: Record<LlmModelId, string> } {
  const choices: LlmModelId[] = []
  const labels: Record<LlmModelId, string> = {}

  for (const family of PROVIDER_FAMILIES[provider]) {
    const selected = selectLatestAliasModel(provider, family.name, models)
    const nativeId = selected?.nativeId ?? family.fallbackModel
    if (!nativeId || choices.includes(nativeId)) continue

    choices.push(nativeId)
    labels[nativeId] = labelFromGatewayName(provider, selected?.name) ?? family.label(nativeId)
  }

  return {
    choices: choices.length > 0 ? choices : FALLBACK_MODEL_CHOICES_BY_PROVIDER[provider],
    labels,
  }
}

export function resolveModelForProvider(
  provider: LlmProvider,
  model: string,
  models: CatalogModel[],
): LlmModelId {
  const normalized = normalizeModelToken(model)
  if (!normalized)
    return resolveModelForProvider(provider, DEFAULT_MODEL_ALIAS_BY_PROVIDER[provider], models)

  const gatewayPrefix = `${PROVIDER_GATEWAY_PREFIX[provider]}/`
  if (normalized.startsWith(gatewayPrefix)) {
    return gatewayToNativeId(provider, normalized)
  }

  if (isModelAlias(provider, normalized)) {
    const selected = selectLatestAliasModel(provider, normalized, models)
    const family = PROVIDER_FAMILIES[provider].find((f) => f.name === normalized)
    return selected?.nativeId ?? family?.fallbackModel ?? normalized
  }

  const selected = selectExactProviderModel(provider, normalized, models)
  if (selected) return selected.nativeId

  return model.trim()
}

export async function resolveAppModelConfig(
  config: AppConfig,
  options: LoadModelCatalogOptions = {},
): Promise<ResolvedModelConfig> {
  const catalog = await loadModelCatalog(options)
  const { choices, labels } = buildProviderModelChoices(config.llmProvider, catalog.models)
  const llmModel = resolveModelForProvider(config.llmProvider, config.llmModel, catalog.models)

  if (!labels[llmModel]) {
    labels[llmModel] = labelForModel(config.llmProvider, llmModel)
  }

  return {
    llmModel,
    llmModelChoices: choices,
    llmModelLabels: labels,
    catalog,
  }
}
