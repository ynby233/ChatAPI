import { useEffect, useState } from 'react'
import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Select,
} from 'antd'
import { DeleteOutlined, HistoryOutlined, PlusOutlined, SafetyOutlined } from '@ant-design/icons'

import { appMessage } from '../../lib/antdApp'
import { requestJson } from '../../lib/api'
import type { AdminUserHistoryMessage, AdminUserHistoryResponse, User } from '../../types/chat'

type UserManagementPanelProps = {
  open: boolean
}

export function UserManagementPanel({ open }: UserManagementPanelProps) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [form] = Form.useForm()

  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [pwUserId, setPwUserId] = useState('')
  const [pwUsername, setPwUsername] = useState('')
  const [pwForm] = Form.useForm()
  const [pwSubmitting, setPwSubmitting] = useState(false)

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailUser, setDetailUser] = useState<User | null>(null)
  const [historyMessages, setHistoryMessages] = useState<AdminUserHistoryMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true

    async function loadUsers() {
      setLoading(true)
      try {
        const data = await requestJson<{ ok: boolean; users: User[] }>('/api/admin/users')
        if (!active) return
        setUsers(data.users)
      } catch (error) {
        if (!active) return
        appMessage.error(error instanceof Error ? error.message : '加载用户列表失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadUsers()
    return () => {
      active = false
    }
  }, [open])

  useEffect(() => {
    const userId = detailUser?.id
    if (!detailModalOpen || !userId) return
    let active = true

    async function loadHistory() {
      setHistoryLoading(true)
      try {
        const data = await requestJson<AdminUserHistoryResponse>(
          `/api/admin/users/${userId}/history?limit=30`,
        )
        if (!active) return
        setHistoryMessages(data.recent_messages)
      } catch (error) {
        if (!active) return
        appMessage.error(error instanceof Error ? error.message : '加载历史消息失败')
      } finally {
        if (active) setHistoryLoading(false)
      }
    }

    void loadHistory()
    return () => {
      active = false
    }
  }, [detailModalOpen, detailUser?.id])

  async function handleCreate(values: { username: string; password: string; role: string }) {
    setCreating(true)
    try {
      const data = await requestJson<{ ok: boolean; user: User }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      setUsers((prev) => [...prev, data.user])
      form.resetFields()
      appMessage.success('用户已创建')
    } catch (error) {
      appMessage.error(error instanceof Error ? error.message : '创建用户失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(userId: string) {
    setDeletingId(userId)
    try {
      await requestJson(`/api/admin/users/${userId}`, { method: 'DELETE' })
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      if (detailUser?.id === userId) {
        setDetailModalOpen(false)
        setDetailUser(null)
        setHistoryMessages([])
      }
      appMessage.success('用户已删除')
    } catch (error) {
      appMessage.error(error instanceof Error ? error.message : '删除用户失败')
    } finally {
      setDeletingId('')
    }
  }

  function openPasswordModal(user: User) {
    setPwUserId(user.id)
    setPwUsername(user.username)
    pwForm.resetFields()
    setPwModalOpen(true)
  }

  function openDetailModal(user: User) {
    setDetailUser(user)
    setHistoryMessages([])
    setDetailModalOpen(true)
  }

  async function handlePasswordChange() {
    try {
      const values = await pwForm.validateFields()
      setPwSubmitting(true)
      await requestJson(`/api/admin/users/${pwUserId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: values.password }),
      })
      appMessage.success(`已修改 ${pwUsername} 的密码`)
      setPwModalOpen(false)
    } catch (error) {
      if (error instanceof Error) {
        appMessage.error(error.message)
      }
    } finally {
      setPwSubmitting(false)
    }
  }

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (role === 'admin' ? '管理员' : '普通用户'),
    },
    {
      title: 'API Keys',
      dataIndex: 'api_key_count',
      key: 'api_key_count',
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: '当前连接数',
      dataIndex: 'current_connection_count',
      key: 'current_connection_count',
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: User) => (
        <Space size={8} wrap>
          <Button
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => openDetailModal(record)}
          >
            查看历史消息
          </Button>
          <Button
            size="small"
            icon={<SafetyOutlined />}
            onClick={() => openPasswordModal(record)}
          >
            重置密码
          </Button>
          <Popconfirm
            title={`删除用户：${record.username}`}
            description="删除后该用户的所有会话、消息和 API Key 都会被清理，且无法恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.id}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const historyColumns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 190,
      render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '会话',
      dataIndex: 'conversation_title',
      key: 'conversation_title',
      width: 180,
      render: (v: string, record: AdminUserHistoryMessage) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{v || '未命名会话'}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.conversation_id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 90,
      render: (role: string) => {
        const color = role === 'assistant' ? 'blue' : role === 'user' ? 'green' : 'default'
        return <Tag color={color}>{role || '-'}</Tag>
      },
    },
    {
      title: '内容',
      dataIndex: 'content',
      key: 'content',
      render: (value: string) => (
        <Typography.Paragraph
          style={{ marginBottom: 0 }}
          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
        >
          {value || '-'}
        </Typography.Paragraph>
      ),
    },
  ]

  return (
    <div className="user-management-panel">
      <div className="user-management-header">
        <Typography.Text className="user-management-subtitle">
          管理系统中的所有用户账户。
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => form.submit()}>
          添加用户
        </Button>
      </div>

      <Form form={form} layout="inline" onFinish={handleCreate} className="user-management-form">
        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input placeholder="用户名" allowClear />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[{ required: true, min: 4, message: '密码至少 4 个字符' }]}
        >
          <Input.Password placeholder="密码" allowClear />
        </Form.Item>
        <Form.Item name="role" initialValue="user">
          <Select
            style={{ width: 100 }}
            options={[
              { label: '普通用户', value: 'user' },
              { label: '管理员', value: 'admin' },
            ]}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={creating}>
            添加
          </Button>
        </Form.Item>
      </Form>

      <Table
        className="user-management-table"
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
          pageSizeOptions: ['5', '10', '20', '50'],
          showTotal: (total) => `共 ${total} 条`,
        }}
        size="small"
      />

      <Modal
        title={`查看历史消息 - ${detailUser?.username ?? ''}`}
        open={detailModalOpen}
        onCancel={() => {
          setDetailModalOpen(false)
          setDetailUser(null)
          setHistoryMessages([])
        }}
        footer={null}
        width={1060}
        destroyOnHidden
      >
        <div className="user-history-modal">
          <Descriptions bordered column={2} size="small" className="user-history-descriptions">
            <Descriptions.Item label="用户名">{detailUser?.username ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="角色">
              {detailUser?.role === 'admin' ? '管理员' : '普通用户'}
            </Descriptions.Item>
            <Descriptions.Item label="API Keys">{detailUser?.api_key_count ?? 0}</Descriptions.Item>
            <Descriptions.Item label="当前连接数">
              {detailUser?.current_connection_count ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>
              {detailUser?.created_at ? new Date(detailUser.created_at).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="历史登录" span={2}>
              {detailUser?.last_login_at ? new Date(detailUser.last_login_at).toLocaleString() : '未登录'}
            </Descriptions.Item>
          </Descriptions>

          <div className="user-history-actions">
            <Button
              icon={<SafetyOutlined />}
              onClick={() => detailUser && openPasswordModal(detailUser)}
            >
              重置密码
            </Button>
            <Popconfirm
              title={`删除用户：${detailUser?.username ?? ''}`}
              description="删除后该用户的所有会话、消息和 API Key 都会被清理，且无法恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => detailUser && handleDelete(detailUser.id)}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={detailUser ? deletingId === detailUser.id : false}
              >
                删除用户
              </Button>
            </Popconfirm>
          </div>

          <Table
            className="user-history-table"
            columns={historyColumns}
            dataSource={historyMessages}
            rowKey="id"
            loading={historyLoading}
            pagination={false}
            size="small"
            locale={{
              emptyText: historyLoading ? '加载中...' : '暂无历史消息',
            }}
          />
        </div>
      </Modal>

      <Modal
        title={`重置密码 - ${pwUsername}`}
        open={pwModalOpen}
        onOk={handlePasswordChange}
        onCancel={() => setPwModalOpen(false)}
        confirmLoading={pwSubmitting}
        okText="确认修改"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={pwForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[{ required: true, min: 4, message: '密码至少 4 个字符' }]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次密码输入不一致'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
