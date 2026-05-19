import { useEffect, useState } from 'react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Tooltip,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  LeftOutlined,
  LogoutOutlined,
  RightOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons'

import { formatTime, getLastToolSchemas, buildInitialToolFormValues } from '../lib/chat-format'
import { requestJson } from '../lib/api'
import { SettingsModal } from './settings/SettingsModal'
import { ToolField } from './ToolField'
import type {
  AuthSession,
  AutomationRule,
  Conversation,
  MessageItem,
  ToolFieldValue,
  ToolSchemaOption,
} from '../types/chat'

type ConversationSidebarProps = {
  abortPopoverConversationId: string
  abortReason: string
  abortingConversationId: string
  auth: AuthSession
  automationRuleEditorOpen: boolean
  automationRules: AutomationRule[]
  automationRulesModalOpen: boolean
  collapsed: boolean
  conversations: Conversation[]
  deletingConversationId: string
  editingAutomationRule: AutomationRule | null
  onAbortConversation: (conversationId: string) => void | Promise<void>
  onCreateAutomationRule: () => void | Promise<void>
  onDeleteAutomationRule: (ruleId: string) => void | Promise<void>
  onDeleteConversation: (conversationId: string) => void | Promise<void>
  onEditAutomationRule: (ruleId: string) => void | Promise<void>
  onLogout: () => void | Promise<void>
  onPruneConversations: () => void | Promise<void>
  onSaveAutomationRule: (rule: AutomationRule) => void | Promise<void>
  onSelectConversation: (conversationId: string) => void | Promise<void>
  onToggleAutomationRule: (ruleId: string, enabled: boolean) => void | Promise<void>
  onToggleCollapsed: () => void
  onTotpRefresh: () => void
  pruneKeepCount: number
  pruneModalOpen: boolean
  pruningConversations: boolean
  savingAutomationRules: boolean
  selectedConversationId: string
  setAbortPopoverConversationId: (value: string) => void
  setAbortReason: (value: string) => void
  setAutomationRuleEditorOpen: (value: boolean) => void
  setAutomationRulesModalOpen: (value: boolean) => void
  setEditingAutomationRule: (value: AutomationRule | null) => void
  setPruneKeepCount: (value: number) => void
  setPruneModalOpen: (value: boolean) => void
  totpEnabled: boolean
}

export function ConversationSidebar({
  abortPopoverConversationId,
  abortReason,
  abortingConversationId,
  auth,
  automationRuleEditorOpen,
  automationRules,
  automationRulesModalOpen,
  collapsed,
  conversations,
  deletingConversationId,
  editingAutomationRule,
  onAbortConversation,
  onCreateAutomationRule,
  onDeleteAutomationRule,
  onDeleteConversation,
  onEditAutomationRule,
  onLogout,
  onPruneConversations,
  onSaveAutomationRule,
  onSelectConversation,
  onToggleAutomationRule,
  onToggleCollapsed,
  onTotpRefresh,
  pruneKeepCount,
  pruneModalOpen,
  pruningConversations,
  savingAutomationRules,
  selectedConversationId,
  setAbortPopoverConversationId,
  setAbortReason,
  setAutomationRuleEditorOpen,
  setAutomationRulesModalOpen,
  setEditingAutomationRule,
  setPruneKeepCount,
  setPruneModalOpen,
  totpEnabled,
}: ConversationSidebarProps) {
  const [toolCallModalOpen, setToolCallModalOpen] = useState(false)
  const [toolCallSchemaConversationId, setToolCallSchemaConversationId] = useState('')
  const [toolCallSchemas, setToolCallSchemas] = useState<ToolSchemaOption[]>([])
  const [toolCallSchemasLoading, setToolCallSchemasLoading] = useState(false)
  const [toolCallToolName, setToolCallToolName] = useState('')
  const [toolCallFormValues, setToolCallFormValues] = useState<Record<string, ToolFieldValue>>({})
  const [toolCallId, setToolCallId] = useState('')

  useEffect(() => {
    if (!toolCallModalOpen || !toolCallSchemaConversationId) {
      setToolCallSchemas([])
      setToolCallToolName('')
      setToolCallFormValues({})
      return
    }
    let cancelled = false
    setToolCallSchemasLoading(true)
    requestJson<{ ok: boolean; items?: MessageItem[] }>(
      `/api/conversations/${toolCallSchemaConversationId}/messages`,
    )
      .then((data) => {
        if (cancelled) return
        const messages = Array.isArray(data.items) ? data.items : []
        setToolCallSchemas(getLastToolSchemas(messages))
      })
      .catch(() => {
        if (cancelled) return
        setToolCallSchemas([])
      })
      .finally(() => {
        if (!cancelled) setToolCallSchemasLoading(false)
      })
    return () => { cancelled = true }
  }, [toolCallModalOpen, toolCallSchemaConversationId])

  function openToolCallModal() {
    if (!editingAutomationRule) return
    const action = editingAutomationRule.action
    setToolCallSchemaConversationId('')
    setToolCallSchemas([])
    setToolCallToolName(action.tool_name ?? '')
    setToolCallFormValues(action.tool_arguments ? (() => {
      try { return JSON.parse(action.tool_arguments) } catch { return {} }
    })() : {})
    setToolCallId(action.tool_call_id ?? '')
    setToolCallModalOpen(true)
  }

  function handleToolCallModalOk() {
    if (!editingAutomationRule) return
    if (!toolCallToolName) {
      return
    }
    let argumentsJson = '{}'
    try {
      const selectedSchema = toolCallSchemas.find((s) => s.name === toolCallToolName)
      if (selectedSchema) {
        const properties = selectedSchema.parameters?.properties ?? {}
        const required = new Set(selectedSchema.parameters?.required ?? [])
        const entries = Object.entries(properties).flatMap(([key]) => {
          const rawValue = toolCallFormValues[key]
          if (rawValue == null || rawValue === '') {
            if (required.has(key)) return []
            return []
          }
          return [[key, rawValue] as const]
        })
        argumentsJson = JSON.stringify(Object.fromEntries(entries))
      }
    } catch {
      // keep default
    }
    setEditingAutomationRule({
      ...editingAutomationRule,
      action: {
        ...editingAutomationRule.action,
        type: 'tool_call',
        tool_name: toolCallToolName,
        tool_arguments: argumentsJson,
        tool_call_id: toolCallId,
      },
    })
    setToolCallModalOpen(false)
  }

  function validateRegex(pattern: string): boolean {
    if (!pattern) return true
    try {
      new RegExp(pattern)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className={`sidebar-inner ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-top-copy">
          <Typography.Text className="eyebrow">ChatAPI</Typography.Text>
          {!collapsed ? (
            <Typography.Title level={4} className="sidebar-title">
              会话
            </Typography.Title>
          ) : null}
        </div>
        <Space size={4}>
          <Tooltip title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
            <Button
              type="text"
              size="small"
              icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
              className="sidebar-action-button"
              onClick={onToggleCollapsed}
            />
          </Tooltip>
          {!collapsed ? (
            <Tooltip title="删除最近 N 个会话以外的会话">
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                className="sidebar-action-button"
                onClick={() => setPruneModalOpen(true)}
              />
            </Tooltip>
          ) : null}
        </Space>
      </div>
      <List
        className="conversation-list"
        dataSource={conversations}
        locale={{ emptyText: <Empty description="暂无会话" /> }}
        renderItem={(item) => {
          const active = item.id === selectedConversationId
          const realtimeStatus = item.metadata?.realtime_status
          const isWaiting = realtimeStatus === 'waiting'
          const statusColor =
            realtimeStatus === 'waiting'
              ? '#22c55e'
              : realtimeStatus === 'closed' || realtimeStatus === 'aborted'
                ? '#ef4444'
                : ''

          return (
            <List.Item
              className={`conversation-item ${active ? 'active' : ''}`}
              onClick={() => void onSelectConversation(item.id)}
            >
              <div className="conversation-row">
                <Space align="start" className="conversation-main">
                  {statusColor ? (
                    <Badge dot color={statusColor} offset={[-4, 4]}>
                      <Avatar shape="square" className="conversation-avatar">
                        {item.title?.slice(0, 1) || '会'}
                      </Avatar>
                    </Badge>
                  ) : (
                    <Avatar shape="square" className="conversation-avatar">
                      {item.title?.slice(0, 1) || '会'}
                    </Avatar>
                  )}
                  {!collapsed ? (
                    <div className="conversation-meta">
                      <Typography.Text className="conversation-title">
                        {item.title || '新会话'}
                      </Typography.Text>
                      <Typography.Paragraph
                        className="conversation-preview"
                        ellipsis={{ rows: 2 }}
                      >
                        {item.last_message_preview || item.last_user_text || '尚无消息'}
                      </Typography.Paragraph>
                      <Typography.Text className="conversation-time">
                        {item.message_count > 0
                          ? `${item.message_count} 条消息 · ${formatTime(item.last_message_at)}`
                          : '空会话'}
                      </Typography.Text>
                    </div>
                  ) : null}
                </Space>
                {isWaiting ? (
                  <Popover
                    trigger="click"
                    open={abortPopoverConversationId === item.id}
                    onOpenChange={(open) => {
                      if (!open) {
                        setAbortPopoverConversationId('')
                        setAbortReason('')
                        return
                      }
                      setAbortPopoverConversationId(item.id)
                      setAbortReason('')
                    }}
                    placement="leftTop"
                    content={
                      <div
                        className="abort-popover"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Input
                          value={abortReason}
                          onChange={(event) => setAbortReason(event.target.value)}
                          placeholder="输入返回给请求方的错误信息"
                          onPressEnter={() => void onAbortConversation(item.id)}
                        />
                        <Button
                          danger
                          type="primary"
                          loading={abortingConversationId === item.id}
                          onClick={() => void onAbortConversation(item.id)}
                        >
                          abort
                        </Button>
                      </div>
                    }
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<StopOutlined />}
                      className="conversation-delete-button"
                      loading={abortingConversationId === item.id}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                    />
                  </Popover>
                ) : (
                  <Tooltip title="删除会话">
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      className="conversation-delete-button"
                      loading={deletingConversationId === item.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        void onDeleteConversation(item.id)
                      }}
                    />
                  </Tooltip>
                )}
              </div>
            </List.Item>
          )
        }}
      />
      <div className="sidebar-footer">
        {!collapsed ? (
          <>
            <div className="footer-head">
              <Typography.Text className="footer-name">{auth.user?.username}</Typography.Text>
              <Tooltip title="自动化规则">
                <Button
                  type="text"
                  icon={<SettingOutlined />}
                  className="footer-settings-button"
                  onClick={() => setAutomationRulesModalOpen(true)}
                />
              </Tooltip>
            </div>
            <Button icon={<LogoutOutlined />} onClick={() => void onLogout()} block>
              退出登录
            </Button>
          </>
        ) : (
          <div className="sidebar-footer-collapsed">
            <Tooltip title="自动化规则">
              <Button
                type="text"
                icon={<SettingOutlined />}
                className="footer-settings-button"
                onClick={() => setAutomationRulesModalOpen(true)}
              />
            </Tooltip>
            <Tooltip title="退出登录">
              <Button type="text" icon={<LogoutOutlined />} onClick={() => void onLogout()} />
            </Tooltip>
          </div>
        )}
      </div>
      <Modal
        title="批量删除旧会话"
        open={pruneModalOpen}
        onCancel={() => {
          if (pruningConversations) return
          setPruneModalOpen(false)
        }}
        onOk={() => void onPruneConversations()}
        okText="删除"
        okButtonProps={{ danger: true, loading: pruningConversations }}
        cancelButtonProps={{ disabled: pruningConversations }}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} className="prune-modal-stack">
          <Typography.Text>
            保留最近 n 个会话，其余更早的会话将被删除。等待中的会话会自动跳过。
          </Typography.Text>
          <div>
            <Typography.Text className="prune-input-label">保留数量</Typography.Text>
            <InputNumber
              min={0}
              precision={0}
              value={pruneKeepCount}
              onChange={(value) => setPruneKeepCount(typeof value === 'number' ? value : 0)}
              className="prune-input"
              placeholder="输入 n"
            />
          </div>
        </Space>
      </Modal>
      <SettingsModal
        automationRuleEditorOpen={automationRuleEditorOpen}
        automationRules={automationRules}
        onCreateAutomationRule={onCreateAutomationRule}
        onDeleteAutomationRule={onDeleteAutomationRule}
        onEditAutomationRule={onEditAutomationRule}
        onToggleAutomationRule={onToggleAutomationRule}
        open={automationRulesModalOpen}
        onClose={() => setAutomationRulesModalOpen(false)}
        savingAutomationRules={savingAutomationRules}
        user={auth.user}
        totpEnabled={totpEnabled}
        onTotpRefresh={onTotpRefresh}
      />
      <Modal
        title={editingAutomationRule ? `编辑规则 ${editingAutomationRule.id}` : '编辑规则'}
        width={980}
        open={automationRuleEditorOpen}
        onCancel={() => {
          if (savingAutomationRules) return
          setAutomationRuleEditorOpen(false)
          setEditingAutomationRule(null)
        }}
        onOk={() => {
          if (!editingAutomationRule) return
          void onSaveAutomationRule(editingAutomationRule)
        }}
        okText="保存规则"
        okButtonProps={{ loading: savingAutomationRules }}
        cancelButtonProps={{ disabled: savingAutomationRules }}
        destroyOnHidden
      >
        <Space direction="vertical" size={18} className="automation-editor-stack">
          <div className="automation-editor-section">
            <Typography.Title level={5} className="automation-editor-title">
              条件
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, fontWeight: 'normal', marginLeft: 8 }}
              >
                示例：weather|forecast、^帮我.*查天气$、(北京|上海).+天气
              </Typography.Text>
            </Typography.Title>
            <div>
              <Typography.Text className="prune-input-label">正则表达式</Typography.Text>
              <Input
                value={editingAutomationRule?.conditions.contains?.[0]?.pattern ?? ''}
                onChange={(event) => {
                  if (!editingAutomationRule) return
                  const pattern = event.target.value
                  const currentConditions = editingAutomationRule.conditions.contains ?? []
                  const firstCondition = currentConditions[0]
                  if (firstCondition) {
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      conditions: {
                        ...editingAutomationRule.conditions,
                        contains: [
                          { match_type: 'regex', pattern },
                          ...currentConditions.slice(1),
                        ],
                      },
                    })
                  } else {
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      conditions: {
                        ...editingAutomationRule.conditions,
                        contains: [{ match_type: 'regex', pattern }],
                      },
                    })
                  }
                }}
                placeholder="输入正则表达式，匹配的消息将触发规则"
                status={
                  editingAutomationRule?.conditions.contains?.[0]?.pattern &&
                  !validateRegex(editingAutomationRule.conditions.contains[0].pattern)
                    ? 'error'
                    : undefined
                }
                style={
                  editingAutomationRule?.conditions.contains?.[0]?.pattern
                    ? {
                        borderColor: validateRegex(editingAutomationRule.conditions.contains[0].pattern)
                          ? '#52c41a'
                          : '#ff4d4f',
                      }
                    : undefined
                }
              />
              {editingAutomationRule?.conditions.contains?.[0]?.pattern &&
                !validateRegex(editingAutomationRule.conditions.contains[0].pattern) && (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    正则语法错误
                  </Typography.Text>
                )}
            </div>
          </div>
          <div className="automation-editor-section">
            <Typography.Title level={5} className="automation-editor-title">
              动作
            </Typography.Title>
            <div className="automation-action-type-group">
              <Button
                type={editingAutomationRule?.action.type === 'output_text' ? 'primary' : 'default'}
                onClick={() => {
                  if (!editingAutomationRule) return
                  setEditingAutomationRule({
                    ...editingAutomationRule,
                    action: {
                      ...editingAutomationRule.action,
                      type: 'output_text',
                    },
                  })
                }}
              >
                流式输出
              </Button>
              <Button
                type={editingAutomationRule?.action.type === 'complete' ? 'primary' : 'default'}
                onClick={() => {
                  if (!editingAutomationRule) return
                  setEditingAutomationRule({
                    ...editingAutomationRule,
                    action: {
                      ...editingAutomationRule.action,
                      type: 'complete',
                    },
                  })
                }}
              >
                结束输出
              </Button>
              <Button
                danger={editingAutomationRule?.action.type === 'error'}
                type={editingAutomationRule?.action.type === 'error' ? 'primary' : 'default'}
                onClick={() => {
                  if (!editingAutomationRule) return
                  setEditingAutomationRule({
                    ...editingAutomationRule,
                    action: {
                      ...editingAutomationRule.action,
                      type: 'error',
                    },
                  })
                }}
              >
                返回 error
              </Button>
              <Button
                type={editingAutomationRule?.action.type === 'tool_call' ? 'primary' : 'default'}
                onClick={() => {
                  if (!editingAutomationRule) return
                  setEditingAutomationRule({
                    ...editingAutomationRule,
                    action: {
                      ...editingAutomationRule.action,
                      type: 'tool_call',
                    },
                  })
                  openToolCallModal()
                }}
              >
                工具调用
              </Button>
            </div>
            <div className="automation-editor-grid" style={{ marginTop: 12 }}>
              <div className="automation-editor-inline-field">
                <Typography.Text className="prune-input-label">收到后延时（秒）</Typography.Text>
                <InputNumber
                  min={0}
                  value={editingAutomationRule?.timing.delay_seconds ?? 0}
                  onChange={(value) => {
                    if (!editingAutomationRule) return
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      timing: {
                        ...editingAutomationRule.timing,
                        delay_seconds: typeof value === 'number' ? value : 0,
                      },
                    })
                  }}
                  className="prune-input"
                />
              </div>
              {editingAutomationRule?.action.type === 'output_text' && (
                <div className="automation-editor-inline-field">
                  <Typography.Text className="prune-input-label">每隔时间重复（秒）</Typography.Text>
                  <InputNumber
                    min={0}
                    value={editingAutomationRule?.timing.repeat_interval_seconds ?? 0}
                    onChange={(value) => {
                      if (!editingAutomationRule) return
                      setEditingAutomationRule({
                        ...editingAutomationRule,
                        timing: {
                          ...editingAutomationRule.timing,
                          repeat_interval_seconds: typeof value === 'number' ? value : 0,
                        },
                      })
                    }}
                    className="prune-input"
                  />
                </div>
              )}
            </div>
            {editingAutomationRule?.action.type === 'output_text' ? (
              <div className="automation-editor-action-field">
                <Typography.Text className="prune-input-label">输出文本</Typography.Text>
                <Input.TextArea
                  value={editingAutomationRule.action.text}
                  onChange={(event) => {
                    if (!editingAutomationRule) return
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      action: {
                        ...editingAutomationRule.action,
                        text: event.target.value,
                      },
                    })
                  }}
                  autoSize={{ minRows: 5, maxRows: 12 }}
                  placeholder="命中规则后输出的文本"
                />
              </div>
            ) : null}
            {editingAutomationRule?.action.type === 'complete' ? (
              <div className="automation-editor-action-field">
                <Typography.Text className="prune-input-label">结束时补充文本</Typography.Text>
                <Input.TextArea
                  value={editingAutomationRule.action.text}
                  onChange={(event) => {
                    if (!editingAutomationRule) return
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      action: {
                        ...editingAutomationRule.action,
                        text: event.target.value,
                      },
                    })
                  }}
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  placeholder="可留空；留空时直接以当前草稿结束"
                />
              </div>
            ) : null}
            {editingAutomationRule?.action.type === 'error' ? (
              <div className="automation-editor-action-field">
                <Typography.Text className="prune-input-label">错误信息</Typography.Text>
                <Input.TextArea
                  value={editingAutomationRule.action.error_message}
                  onChange={(event) => {
                    if (!editingAutomationRule) return
                    setEditingAutomationRule({
                      ...editingAutomationRule,
                      action: {
                        ...editingAutomationRule.action,
                        error_message: event.target.value,
                      },
                    })
                  }}
                  autoSize={{ minRows: 4, maxRows: 10 }}
                  placeholder="命中规则后直接返回给请求方的错误信息"
                />
              </div>
            ) : null}
            {editingAutomationRule?.action.type === 'tool_call' ? (
              <div className="automation-editor-action-field">
                <Typography.Text className="prune-input-label">工具调用配置</Typography.Text>
                <Card
                  size="small"
                  style={{ marginTop: 8 }}
                  extra={
                    <Button size="small" onClick={openToolCallModal}>
                      编辑
                    </Button>
                  }
                >
                  <Typography.Text>
                    {editingAutomationRule.action.tool_name
                      ? `Tool: ${editingAutomationRule.action.tool_name}`
                      : '未配置工具调用'}
                  </Typography.Text>
                </Card>
              </div>
            ) : null}
          </div>
        </Space>
      </Modal>
      <Modal
        title="编辑工具调用"
        width={680}
        open={toolCallModalOpen}
        onCancel={() => setToolCallModalOpen(false)}
        onOk={handleToolCallModalOk}
        okText="确认"
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Typography.Text className="prune-input-label">选择历史会话（获取 Tool Schema）</Typography.Text>
            <Select
              value={toolCallSchemaConversationId || undefined}
              onChange={(value) => setToolCallSchemaConversationId(value)}
              placeholder="选择一个会话以加载其 tool schema"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
              options={conversations.map((c) => ({
                label: c.title || c.id,
                value: c.id,
              }))}
            />
          </div>
          {toolCallSchemasLoading && <Spin size="small" />}
          {!toolCallSchemasLoading && toolCallSchemaConversationId && toolCallSchemas.length === 0 && (
            <Typography.Text type="secondary">该会话中没有可用的 tool schema</Typography.Text>
          )}
          {toolCallSchemas.length > 0 && (
            <>
              <div>
                <Typography.Text className="prune-input-label">选择 Tool</Typography.Text>
                <Select
                  value={toolCallToolName || undefined}
                  onChange={(value) => {
                    setToolCallToolName(value)
                    const schema = toolCallSchemas.find((s) => s.name === value)
                    setToolCallFormValues(schema ? buildInitialToolFormValues(schema.parameters) : {})
                  }}
                  placeholder="选择一个 tool"
                  style={{ width: '100%' }}
                  options={toolCallSchemas.map((s) => ({
                    label: s.name,
                    value: s.name,
                  }))}
                />
              </div>
              <div>
                <Typography.Text className="prune-input-label">Tool Call ID（可留空自动生成）</Typography.Text>
                <Input
                  value={toolCallId}
                  onChange={(event) => setToolCallId(event.target.value)}
                  placeholder="tool call id"
                />
              </div>
              {(() => {
                const selectedSchema = toolCallSchemas.find((s) => s.name === toolCallToolName)
                if (!selectedSchema) return null
                const properties = selectedSchema.parameters?.properties ?? {}
                const requiredFields = selectedSchema.parameters?.required ?? []
                const entries = Object.entries(properties)
                return (
                  <Card size="small" title={selectedSchema.name}>
                    {selectedSchema.description && (
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                        {selectedSchema.description}
                      </Typography.Text>
                    )}
                    {entries.length > 0 ? (
                      <div className="tool-form-grid">
                        {entries.map(([fieldName, schema]) => (
                          <ToolField
                            key={fieldName}
                            disabled={false}
                            fieldName={fieldName}
                            onChange={(nextField, nextValue) =>
                              setToolCallFormValues((prev) => ({
                                ...prev,
                                [nextField]: nextValue,
                              }))
                            }
                            required={requiredFields.includes(fieldName)}
                            schema={schema}
                            value={toolCallFormValues[fieldName]}
                          />
                        ))}
                      </div>
                    ) : (
                      <Typography.Text type="secondary">该 tool 没有参数</Typography.Text>
                    )}
                  </Card>
                )
              })()}
            </>
          )}
        </Space>
      </Modal>
    </div>
  )
}
