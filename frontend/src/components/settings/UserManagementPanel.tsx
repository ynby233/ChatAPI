import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Popconfirm, Select, Table, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'

import { requestJson } from '../../lib/api'
import type { User } from '../../types/chat'

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
        message.error(error instanceof Error ? error.message : '加载用户列表失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadUsers()
    return () => { active = false }
  }, [open])

  async function handleCreate(values: { username: string; password: string; role: string }) {
    setCreating(true)
    try {
      const data = await requestJson<{ ok: boolean; user: User }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      setUsers((prev) => [...prev, data.user])
      form.resetFields()
      message.success('用户已创建')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建用户失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(userId: string) {
    setDeletingId(userId)
    try {
      await requestJson(`/api/admin/users/${userId}`, { method: 'DELETE' })
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      message.success('用户已删除')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除用户失败')
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

  async function handlePasswordChange() {
    try {
      const values = await pwForm.validateFields()
      setPwSubmitting(true)
      await requestJson(`/api/admin/users/${pwUserId}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: values.password }),
      })
      message.success(`已修改 ${pwUsername} 的密码`)
      setPwModalOpen(false)
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message)
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
      render: (role: string) => role === 'admin' ? '管理员' : '普通用户',
    },
    {
      title: 'API Keys',
      dataIndex: 'api_key_count',
      key: 'api_key_count',
      render: (v: number | undefined) => v ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: '上次登录',
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      render: (v: string | undefined) => v ? new Date(v).toLocaleString() : '未登录',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: User) => (
        <span>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openPasswordModal(record)}
          >
            修改密码
          </Button>
          <Popconfirm
            title="确定删除该用户？"
            description="删除后该用户的所有数据将丢失"
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
        </span>
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
        pagination={false}
        size="small"
      />

      <Modal
        title={`修改密码 - ${pwUsername}`}
        open={pwModalOpen}
        onOk={handlePasswordChange}
        onCancel={() => setPwModalOpen(false)}
        confirmLoading={pwSubmitting}
        okText="确认修改"
        cancelText="取消"
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
