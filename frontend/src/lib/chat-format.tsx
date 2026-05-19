import type {
  JsonSchema,
  MessageItem,
  ToolFieldValue,
  ToolSchemaOption,
} from '../types/chat'

type RenderableContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; detail?: string }

function normalizeDisplayText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
}

export function formatTime(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatJson(value: unknown) {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toToolSchemaOption(schema: unknown): ToolSchemaOption | null {
  if (!schema || typeof schema !== 'object') return null

  const record = schema as Record<string, unknown>
  const functionRecord =
    record.type === 'function' &&
    record.function &&
    typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : record

  const name = functionRecord.name
  if (typeof name !== 'string' || !name.trim()) return null

  const description =
    typeof functionRecord.description === 'string' ? functionRecord.description : ''
  const parameters =
    functionRecord.parameters &&
    typeof functionRecord.parameters === 'object'
      ? (functionRecord.parameters as JsonSchema)
      : { type: 'object', properties: {} }

  return {
    name: name.trim(),
    description,
    parameters,
  }
}

export function getSchemaType(schema?: JsonSchema): string {
  if (!schema?.type) return ''
  return Array.isArray(schema.type) ? String(schema.type[0] ?? '') : schema.type
}

export function getLastToolSchemas(items: MessageItem[]): ToolSchemaOption[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index]?.metadata?.request_debug?.tool_schemas
    if (!Array.isArray(candidate) || candidate.length === 0) continue
    return candidate
      .map((item) => toToolSchemaOption(item))
      .filter((item): item is ToolSchemaOption => item !== null)
  }
  return []
}

export function buildInitialToolFormValues(schema?: JsonSchema) {
  const values: Record<string, ToolFieldValue> = {}
  const properties = schema?.properties ?? {}
  for (const [key, propertySchema] of Object.entries(properties)) {
    const type = getSchemaType(propertySchema)
    if (propertySchema.default == null) continue
    if (
      type === 'string' ||
      type === 'number' ||
      type === 'integer' ||
      type === 'boolean'
    ) {
      values[key] = propertySchema.default as ToolFieldValue
    } else {
      values[key] = formatJson(propertySchema.default)
    }
  }
  return values
}

export function normalizeToolFieldValue(value: unknown, schema?: JsonSchema) {
  const type = getSchemaType(schema)
  if (value == null || value === '') return undefined

  if (schema?.enum?.length) {
    return value
  }

  if (type === 'number' || type === 'integer') {
    return typeof value === 'number' ? value : Number(value)
  }
  if (type === 'boolean') {
    return Boolean(value)
  }
  if (type === 'array' || type === 'object') {
    if (typeof value !== 'string') return value
    return JSON.parse(value)
  }
  return typeof value === 'string' ? value : String(value)
}

function isHostedImageUrl(value: string): boolean {
  return /^(?:https?:\/\/[^/]+)?\/api\/uploads\/imgs\/[A-Za-z0-9._-]+(?:\?.*)?$/i.test(
    value.trim(),
  )
}

function isRenderableImageUrl(value: string): boolean {
  return isHostedImageUrl(value)
}

function tryParseStructuredContent(rawContent: string): unknown {
  try {
    return JSON.parse(rawContent)
  } catch {
    // Some mock payloads use Python repr style:
    // [{'type': 'input_image', 'image_url': '/api/uploads/imgs/...'}]
  }

  const trimmed = rawContent.trim()
  if (!trimmed || !/^[\[{]/.test(trimmed)) return null

  let normalized = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escapeNext = false

  for (const char of trimmed) {
    if (escapeNext) {
      normalized += char
      escapeNext = false
      continue
    }
    if (char === '\\') {
      normalized += char
      escapeNext = true
      continue
    }
    if (char === "'" && !inDoubleQuote) {
      normalized += '"'
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      normalized += char
      inDoubleQuote = !inDoubleQuote
      continue
    }
    normalized += inSingleQuote && char === '"' ? '\\"' : char
  }

  normalized = normalized
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function parseRenderableContent(rawContent: string): RenderableContentPart[] {
  const fallback = rawContent.trim()
    ? isRenderableImageUrl(rawContent.trim())
      ? [{ type: 'image', src: rawContent.trim() } satisfies RenderableContentPart]
      : [{ type: 'text', text: normalizeDisplayText(rawContent) } satisfies RenderableContentPart]
    : []

  const parsed = tryParseStructuredContent(rawContent)

  const parts: RenderableContentPart[] = []

  const visit = (value: unknown): void => {
    if (value == null) return
    if (typeof value === 'string') {
      if (isRenderableImageUrl(value)) {
        parts.push({ type: 'image', src: value.trim() })
      } else if (value.trim()) {
        parts.push({ type: 'text', text: normalizeDisplayText(value) })
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== 'object') return

    const record = value as Record<string, unknown>
    const itemType = String(record.type ?? '').trim().toLowerCase()
    const imageCandidate =
      typeof record.image_url === 'string'
        ? record.image_url
        : typeof record.url === 'string'
          ? record.url
          : typeof record.src === 'string'
            ? record.src
            : typeof record.data === 'string' && isRenderableImageUrl(record.data)
              ? record.data
              : ''

    if (imageCandidate && isRenderableImageUrl(imageCandidate)) {
      parts.push({
        type: 'image',
        src: imageCandidate.trim(),
        detail:
          typeof record.detail === 'string' && record.detail.trim()
            ? record.detail.trim()
            : undefined,
      })
      return
    }

    if (
      (itemType === 'input_image' ||
        itemType === 'output_image' ||
        itemType === 'image' ||
        (itemType === 'file' && typeof record.image_url === 'string')) &&
      typeof record.image_url === 'string' &&
      isRenderableImageUrl(record.image_url)
    ) {
      parts.push({
        type: 'image',
        src: record.image_url.trim(),
        detail:
          typeof record.detail === 'string' && record.detail.trim()
            ? record.detail.trim()
            : undefined,
      })
      return
    }

    if (
      typeof record.text === 'string' &&
      record.text.trim() &&
      (itemType === 'input_text' ||
        itemType === 'output_text' ||
        itemType === 'text' ||
        !itemType)
    ) {
      parts.push({ type: 'text', text: normalizeDisplayText(record.text) })
      return
    }

    if (typeof record.content === 'string' && record.content.trim()) {
      visit(record.content)
      return
    }

    for (const [childKey, childValue] of Object.entries(record)) {
      if (childKey === 'type') continue
      visit(childValue)
    }
  }

  if (parsed == null) return fallback
  visit(parsed)
  return parts.length > 0 ? parts : fallback
}

export function renderMessageContent(rawContent: string) {
  const parts = parseRenderableContent(rawContent)
  if (parts.length === 0) return null

  return parts.map((part, index) => {
    if (part.type === 'image') {
      return (
        <figure key={`${part.src.slice(0, 32)}-${index}`} className="message-image-card">
          <img src={part.src} alt={`message image ${index + 1}`} className="message-image" />
          {part.detail ? <figcaption>detail: {part.detail}</figcaption> : null}
        </figure>
      )
    }
    return (
      <div key={`text-${index}`} className="message-text-block">
        {part.text}
      </div>
    )
  })
}

export function buildCurlCommand(requestBody: unknown): string {
  if (requestBody == null) return ''
  const origin = window.location.origin
  const format = (requestBody as Record<string, unknown>)?.model != null
    && 'input' in (requestBody as Record<string, unknown>)
    && !('messages' in (requestBody as Record<string, unknown>))
    && !('max_tokens' in (requestBody as Record<string, unknown>))
    ? 'responses'
    : (requestBody as Record<string, unknown>)?.messages != null
      ? 'chat_completions'
      : 'anthropic'

  let endpoint = '/v1/responses'
  if (format === 'chat_completions') endpoint = '/v1/chat/completions'
  else if (format === 'anthropic') endpoint = '/messages'

  const body = JSON.stringify(requestBody, null, 2)
  return `curl '${origin}${endpoint}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -d '${body}'`
}
