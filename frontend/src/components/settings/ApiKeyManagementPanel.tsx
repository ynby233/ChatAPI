import { useEffect, useState } from 'react'
import { Button, Form, Input, Popconfirm, Space, Table, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'

import { requestJson } from '../../lib/api'
import type { ApiKeyInfo } from '../../types/chat'

type ApiKeyManagementPanelProps = {
  open: boolean
}

export function ApiKeyManagementPanel({ open }: ApiKeyManagementPanelProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    if (!open) return
    let active = true
    async function loadKeys() {
      setLoading(true)
      try {
        const data = await requestJson<{ ok: boolean; api_keys: ApiKeyInfo[] }>('/api/user/api-keys')
        if (!active) return
        setApiKeys(data.api_keys)
      } catch (error) {
        if (!active) return
        message.error(error instanceof Error ? error.message : '加载 API Key 列表失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadKeys()
    return () => { active = false }
  }, [open])

  async function handleCreate(values: { name: string; api_key: string }) {
    setCreating(true)
    try {
      const data = await requestJson<{ ok: boolean; api_key: ApiKeyInfo }>('/api/user/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          api_key: values.api_key || undefined,
        }),
      })
      setApiKeys((prev) => [...prev, data.api_key])
      form.resetFields()
      message.success('API Key 已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建 API Key 失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(keyId: string) {
    setDeletingId(keyId)
    try {
      await requestJson(`/api/user/api-keys/${keyId}`, { method: 'DELETE' })
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId))
      message.success('API Key 已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除 API Key 失败')
    } finally {
      setDeletingId('')
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const data = await requestJson<{ ok: boolean; api_key: string }>('/api/user/api-keys/generate')
      form.setFieldValue('api_key', data.api_key)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成 API Key 失败')
    } finally {
      setGenerating(false)
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (v: string) => v || '-' },
    {
      title: 'API Key',
      dataIndex: 'api_key',
      key: 'api_key',
      render: (v: string) => (
        <Space>
          <Typography.Text copyable={{ text: v }} style={{ fontFamily: 'monospace' }}>
            {v}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ApiKeyInfo) => (
        <Popconfirm
          title="确定删除该 API Key？"
          onConfirm={() => handleDelete(record.id)}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            loading={deletingId === record.id}
          >
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div className="api-key-management-panel">
      <div className="api-key-management-header">
        <Typography.Text className="api-key-management-subtitle">
          管理你的 API Key，用于程序化访问接口。
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => form.submit()}>
          添加 Key
        </Button>
      </div>

      <Form form={form} layout="vertical" onFinish={handleCreate} className="api-key-management-form">
        <Form.Item name="name" label="名称">
          <Input placeholder="可选，用于标识用途" allowClear />
        </Form.Item>
        <Form.Item name="api_key" label="API Key" extra="自定义或点击生成按钮创建强密钥（至少 4 个字符）">
          <Space.Compact style={{ width: '100%' }}>
            <Input placeholder="留空则自动生成" allowClear style={{ fontFamily: 'monospace' }} />
            <Button icon={<ThunderboltOutlined />} onClick={handleGenerate} loading={generating}>
              生成
            </Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={creating}>
            添加
          </Button>
        </Form.Item>
      </Form>

      <Table
        className="api-key-management-table"
        columns={columns}
        dataSource={apiKeys}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
      />
    </div>
  )
}
