import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Select,
  Segmented,
  Space,
  Spin,
  Typography,
} from 'antd'
import { LogoutOutlined, MenuOutlined, SaveOutlined, SendOutlined, UserOutlined, CopyOutlined } from '@ant-design/icons'

import {
  formatJson,
  formatTime,
  renderMessageContent,
  buildCurlCommand,
} from '../lib/chat-format'
import { ThemeToggle } from './ThemeToggle'
import { ToolField } from './ToolField'
import type {
  ComposerMode,
  ToolFieldValue,
  ToolSchemaOption,
  VisibleMessage,
} from '../types/chat'

const { TextArea } = Input

type ChatPaneProps = {
  availableToolSchemas: ToolSchemaOption[]
  chatScrollRef: React.RefObject<HTMLDivElement | null>
  composer: string
  composerMode: ComposerMode
  draftBuffer: string
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  isMobile: boolean
  isWaitingForUser: boolean
  keyboardOffset: number
  messagesLoading: boolean
  onDraft: () => void | Promise<void>
  onLogout: () => void | Promise<void>
  onOpenDrawer: () => void
  onSend: () => void | Promise<void>
  selectedConversationTitle: string
  selectedToolSchema: ToolSchemaOption | null
  sending: boolean
  setComposer: (value: string) => void
  setComposerMode: (value: ComposerMode) => void
  setToolCallId: (value: string) => void
  setToolFormValues: React.Dispatch<React.SetStateAction<Record<string, ToolFieldValue>>>
  setToolName: (value: string) => void
  toolCallId: string
  toolFormValues: Record<string, ToolFieldValue>
  toolName: string
  visibleMessages: VisibleMessage[]
}

export function ChatPane(props: ChatPaneProps) {
  const { message: antMessage } = App.useApp()
  const {
    availableToolSchemas,
    chatScrollRef,
    composer,
    composerMode,
    draftBuffer,
    handleComposerKeyDown,
    isMobile,
    isWaitingForUser,
    keyboardOffset,
    messagesLoading,
    onDraft,
    onLogout,
    onOpenDrawer,
    onSend,
    selectedConversationTitle,
    selectedToolSchema,
    sending,
    setComposer,
    setComposerMode,
    setToolCallId,
    setToolFormValues,
    setToolName,
    toolCallId,
    toolFormValues,
    toolName,
    visibleMessages,
  } = props
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  const [visualViewportRect, setVisualViewportRect] = useState(() => ({
    bottomInset: 0,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    offsetTop: 0,
  }))

  useEffect(() => {
    const element = composerCardRef.current
    if (!element) return

    const updateComposerHeight = () => {
      setComposerHeight(Math.ceil(element.getBoundingClientRect().height))
    }

    updateComposerHeight()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateComposerHeight)
      return () => window.removeEventListener('resize', updateComposerHeight)
    }

    const observer = new ResizeObserver(updateComposerHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const updateVisualViewportRect = () => {
      const viewport = window.visualViewport
      const height = Math.round(viewport?.height ?? window.innerHeight)
      const offsetTop = Math.round(viewport?.offsetTop ?? 0)
      const bottomInset = Math.max(0, Math.round(window.innerHeight - height - offsetTop))
      setVisualViewportRect({
        bottomInset,
        height,
        offsetTop,
      })
    }

    updateVisualViewportRect()

    const viewport = window.visualViewport
    window.addEventListener('resize', updateVisualViewportRect)
    viewport?.addEventListener('resize', updateVisualViewportRect)
    viewport?.addEventListener('scroll', updateVisualViewportRect)

    return () => {
      window.removeEventListener('resize', updateVisualViewportRect)
      viewport?.removeEventListener('resize', updateVisualViewportRect)
      viewport?.removeEventListener('scroll', updateVisualViewportRect)
    }
  }, [])

  const paneStyle = {
    '--composer-height': `${composerHeight}px`,
    '--keyboard-offset': `${keyboardOffset}px`,
    '--app-viewport-height': `${visualViewportRect.height}px`,
    '--visual-keyboard-offset': `${visualViewportRect.bottomInset}px`,
    '--visual-viewport-height': `${visualViewportRect.height}px`,
  } as CSSProperties
  const composerStyle = {
    bottom: isMobile ? `${visualViewportRect.bottomInset}px` : 0,
    maxHeight: isMobile
      ? `calc(${visualViewportRect.height}px - env(safe-area-inset-top) - 8px)`
      : undefined,
  } as CSSProperties

  const toolFields = Object.entries(selectedToolSchema?.parameters.properties ?? {})

  return (
    <div className="chat-pane" style={paneStyle}>
      <div className="chat-topbar">
        <Space align="center" size={12}>
          {isMobile && (
            <Button icon={<MenuOutlined />} onClick={onOpenDrawer} className="menu-button" />
          )}
          <div>
            <Typography.Text className="eyebrow">OpenAI Responses</Typography.Text>
            <Typography.Title level={3} className="chat-title">
              {selectedConversationTitle || '选择一个会话'}
            </Typography.Title>
          </div>
        </Space>
        <Space>
          <ThemeToggle className="workspace-theme-toggle" />
          {!isMobile && (
            <Button icon={<LogoutOutlined />} onClick={() => void onLogout()}>
              退出
            </Button>
          )}
        </Space>
      </div>

      <div ref={chatScrollRef} className="chat-scroll">
        {messagesLoading && visibleMessages.length === 0 ? (
          <div className="empty-stage">
            <Spin size="large" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="empty-stage">
            <Empty
              description={
                isWaitingForUser
                  ? '可以开始流式输出，再点击结束输出完成这一轮'
                  : '等待左侧会话出现绿色状态后再回复'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          visibleMessages.map((item) => {
            const isUser = item.role === 'user'
            const isToolInput = item.role === 'tool'
            const isDraft = item.role === 'draft'
            const isToolCall = item.metadata?.response_mode === 'tool_call'
            const isToolResult = item.metadata?.response_mode === 'tool_result'
            const requestDebug = item.metadata?.request_debug
            const debugSections = [
              {
                label: '请求格式',
                value: requestDebug?.request_format || item.metadata?.request_format || '',
              },
              { label: '模型', value: requestDebug?.model || item.metadata?.model || '' },
              { label: '请求 ID', value: requestDebug?.request_id || '' },
              { label: '响应 ID', value: requestDebug?.response_id || item.response_id || '' },
              { label: '请求 Keys', value: requestDebug?.request_keys?.join(', ') || '' },
              { label: 'User-Agent', value: requestDebug?.headers?.user_agent || '' },
              { label: 'Content-Type', value: requestDebug?.headers?.content_type || '' },
            ].filter((section) => section.value)
            const hasDebugCard =
              isUser &&
              !isDraft &&
              !!(
                debugSections.length ||
                requestDebug?.tool_schemas?.length ||
                requestDebug?.input_payload != null ||
                requestDebug?.request_body != null
              )

            return (
              <div
                key={item.id}
                className={`message-row ${
                  isUser
                    ? 'user'
                    : isToolInput
                      ? 'tool-input'
                      : isToolCall
                        ? 'tool-call'
                        : isToolResult
                          ? 'tool-result'
                          : 'assistant'
                } ${isDraft ? 'draft' : ''}`}
              >
                {(isUser || isToolInput) && (
                  <Avatar className="message-avatar user-avatar" icon={<UserOutlined />} />
                )}
                <div
                  className={`message-bubble ${
                    isUser
                      ? 'user'
                      : isToolInput
                        ? 'tool-input'
                        : isToolCall
                          ? 'tool-call'
                          : isToolResult
                            ? 'tool-result'
                            : 'assistant'
                  } ${isDraft ? 'draft' : ''}`}
                >
                  {isToolCall && <div className="message-kind-badge">Tool Call</div>}
                  {isToolResult && <div className="message-kind-badge tool-result">Tool Result</div>}
                  <div className="message-content">{renderMessageContent(item.content)}</div>
                  {(isToolCall || isToolResult) && (
                    <div className="message-tool-meta">
                      <div>
                        <span className="message-debug-label">Tool</span>
                        <span className="message-debug-value">{item.metadata?.tool_name || '-'}</span>
                      </div>
                      <div>
                        <span className="message-debug-label">Call ID</span>
                        <span className="message-debug-value">{item.metadata?.tool_call_id || '-'}</span>
                      </div>
                    </div>
                  )}
                  {hasDebugCard && (
                    <details className="message-debug-card">
                      <summary>请求详情</summary>
                      <div className="message-debug-body">
                        {debugSections.map((section) => (
                          <div key={section.label} className="message-debug-row">
                            <span className="message-debug-label">{section.label}</span>
                            <span className="message-debug-value">{section.value}</span>
                          </div>
                        ))}
                        {requestDebug?.tool_schemas?.length ? (
                          <div className="message-debug-block">
                            <div className="message-debug-label">Tool Schemas</div>
                            <pre>{formatJson(requestDebug.tool_schemas)}</pre>
                          </div>
                        ) : null}
                        {requestDebug?.input_payload != null ? (
                          <div className="message-debug-block">
                            <div className="message-debug-label">Input Payload</div>
                            <pre>{formatJson(requestDebug.input_payload)}</pre>
                          </div>
                        ) : null}
                        {requestDebug?.request_body != null ? (
                          <div className="message-debug-block">
                            <div className="message-debug-label-row">
                              <span className="message-debug-label">Request Body</span>
                              <Button
                                size="small"
                                type="link"
                                icon={<CopyOutlined />}
                                className="copy-curl-btn"
                                onClick={() => {
                                  const curl = buildCurlCommand(requestDebug.request_body)
                                  if (!curl) return
                                  if (navigator.clipboard && window.isSecureContext) {
                                    navigator.clipboard.writeText(curl).then(() => {
                                      antMessage.success('已复制 curl')
                                    }).catch(() => {
                                      antMessage.error('复制失败')
                                    })
                                  } else {
                                    const textarea = document.createElement('textarea')
                                    textarea.value = curl
                                    textarea.style.position = 'fixed'
                                    textarea.style.opacity = '0'
                                    document.body.appendChild(textarea)
                                    textarea.select()
                                    document.execCommand('copy')
                                    document.body.removeChild(textarea)
                                    antMessage.success('已复制 curl')
                                  }
                                }}
                              >
                                复制 curl
                              </Button>
                            </div>
                            <pre>{formatJson(requestDebug.request_body)}</pre>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )}
                  <div className="message-meta">
                    <span>
                      {isDraft
                        ? '流式输出中'
                        : isToolInput
                          ? 'tool'
                          : isToolCall
                            ? 'tool_call'
                            : isToolResult
                              ? 'tool_result'
                              : item.role}
                    </span>
                    <span>{formatTime(item.created_at)}</span>
                  </div>
                </div>
                {!isUser && !isToolInput && (
                  <Avatar className="message-avatar assistant-avatar">AI</Avatar>
                )}
              </div>
            )
          })
        )}
        {sending && (
          <div className="message-row assistant">
            <Avatar className="message-avatar assistant-avatar">AI</Avatar>
            <div className="message-bubble assistant typing">
              <Spin size="small" />
              <span>正在生成回复...</span>
            </div>
          </div>
        )}
      </div>

      <Card ref={composerCardRef} className="composer-card" style={composerStyle}>
        <div className="composer-shell">
          <Space direction="vertical" size={12} className="composer-stack">
            {draftBuffer && (
              <div className="draft-banner">
                <span>已流式输出 {draftBuffer.length} 字</span>
                <Button
                  size="small"
                  disabled={composerMode !== 'assistant_message'}
                  onClick={() => {
                    setComposer(`${draftBuffer}${composer}`)
                  }}
                >
                  继续编辑
                </Button>
              </div>
            )}
            <div className="composer-mode-row">
              <Segmented
                value={composerMode}
                onChange={(value) => {
                  const nextMode = value as ComposerMode
                  setComposerMode(nextMode)
                }}
                options={[
                  { label: 'Assistant Message', value: 'assistant_message' },
                  { label: 'Tool Call', value: 'tool_call' },
                ]}
                disabled={sending || !isWaitingForUser}
              />
            </div>
            {composerMode === 'tool_call' && (
              <div className="tool-call-panel">
                <div className="tool-call-fields">
                  <Select
                    value={toolName || undefined}
                    onChange={(value) => setToolName(value)}
                    placeholder={availableToolSchemas.length ? '选择一个 tool' : '当前请求没有可用 schema'}
                    options={availableToolSchemas.map((schema) => ({
                      label: schema.name,
                      value: schema.name,
                      title: schema.description,
                    }))}
                    disabled={sending || !isWaitingForUser || availableToolSchemas.length === 0}
                  />
                  <Input
                    value={toolCallId}
                    onChange={(event) => setToolCallId(event.target.value)}
                    placeholder="tool call id，可留空自动生成"
                    disabled={sending || !isWaitingForUser}
                  />
                </div>
                {selectedToolSchema && (
                  <div className="tool-schema-summary">
                    <div className="tool-schema-header">
                      <span className="tool-schema-name">{selectedToolSchema.name}</span>
                      <span className="tool-schema-badge">{toolFields.length} fields</span>
                    </div>
                    {selectedToolSchema.description ? (
                      <Typography.Text className="tool-schema-description">
                        {selectedToolSchema.description}
                      </Typography.Text>
                    ) : null}
                  </div>
                )}
                {selectedToolSchema ? (
                  <div className="tool-form-grid">
                    {toolFields.length ? (
                      toolFields.map(([fieldName, schema]) => (
                        <ToolField
                          key={fieldName}
                          disabled={sending || !isWaitingForUser}
                          fieldName={fieldName}
                          onChange={(nextField, nextValue) =>
                            setToolFormValues((prev) => ({
                              ...prev,
                              [nextField]: nextValue,
                            }))
                          }
                          required={(selectedToolSchema.parameters.required ?? []).includes(fieldName)}
                          schema={schema}
                          value={toolFormValues[fieldName]}
                        />
                      ))
                    ) : (
                      <div className="tool-form-empty">当前 tool 没有参数，直接点击左侧按钮输出即可。</div>
                    )}
                  </div>
                ) : (
                  <div className="tool-form-empty">当前消息里没有可解析的 tool schema。</div>
                )}
              </div>
            )}
            {composerMode === 'assistant_message' && (
              <TextArea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  isWaitingForUser
                    ? '输入你作为 assistant 的回复。点“流式输出”会把当前内容追加到这轮回复里，点“结束输出”会结束这一轮。'
                    : '当前没有等待中的 user 请求。'
                }
                autoSize={{ minRows: 4, maxRows: 10 }}
                className="composer-textarea"
                disabled={sending || !isWaitingForUser}
              />
            )}
          </Space>
          <Flex justify="space-between" align="center" gap={12} wrap className="composer-actions">
            <Typography.Text className="composer-hint">
              {isWaitingForUser
                ? composerMode === 'assistant_message'
                  ? '流式输出的片段会保留在本轮回复里，结束输出之后这一轮结束。'
                  : 'Tool Call 模式会根据 schema 组装参数 JSON，点击左侧按钮会直接输出一个 function_call item。'
                : '没有新的 user 请求时不能输出回复。'}
            </Typography.Text>
            <Space>
              <Button
                type={composerMode === 'tool_call' ? 'primary' : 'default'}
                icon={<SaveOutlined />}
                onClick={() => void onDraft()}
                disabled={
                  !isWaitingForUser ||
                  sending ||
                  (composerMode === 'assistant_message' ? !composer.trim() : !toolName.trim())
                }
              >
                {composerMode === 'assistant_message' ? '流式输出' : '输出 Tool Call'}
              </Button>
              <Button
                type={composerMode === 'assistant_message' ? 'primary' : 'default'}
                icon={<SendOutlined />}
                onClick={() => void onSend()}
                loading={sending}
                disabled={
                  sending ||
                  !isWaitingForUser ||
                  composerMode !== 'assistant_message' ||
                  (!composer.trim() && !draftBuffer.trim())
                }
              >
                结束输出
              </Button>
            </Space>
          </Flex>
        </div>
      </Card>
    </div>
  )
}
