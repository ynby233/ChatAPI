import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Select, Switch, Typography } from 'antd'

import { appMessage } from '../../lib/antdApp'
import { requestJson } from '../../lib/api'
import type { SystemConfig } from '../../types/chat'

type SystemSettingsPanelProps = {
  open: boolean
  onClose: () => void
}

const DEFAULT_CONFIG: SystemConfig = {
  public_statistics: false,
  title_enabled: false,
  title: '',
  external_registration_enabled: false,
  email_verification_enabled: false,
  email_provider: '',
  email_provider_options: [],
  registration_email_domain_restriction_enabled: false,
  registration_email_domains: '',
}

function normalizeSystemConfig(data: Partial<SystemConfig> & { ok?: boolean }): SystemConfig {
  const nextConfig: SystemConfig = {
    public_statistics: Boolean(data.public_statistics),
    title_enabled: Boolean(data.title_enabled),
    title: String(data.title ?? ''),
    external_registration_enabled: Boolean(data.external_registration_enabled),
    email_verification_enabled: Boolean(data.email_verification_enabled),
    email_provider: String(data.email_provider ?? ''),
    email_provider_options: Array.isArray(data.email_provider_options)
      ? data.email_provider_options
          .filter((option): option is { value: string; label: string } => Boolean(option?.value))
          .map((option) => ({
            value: String(option.value),
            label: String(option.label ?? option.value),
          }))
      : [],
    registration_email_domain_restriction_enabled: Boolean(data.registration_email_domain_restriction_enabled),
    registration_email_domains: String(data.registration_email_domains ?? ''),
  }

  if (nextConfig.email_verification_enabled && !nextConfig.email_provider && nextConfig.email_provider_options.length > 0) {
    nextConfig.email_provider = nextConfig.email_provider_options[0].value
  }
  if (
    nextConfig.email_provider &&
    !nextConfig.email_provider_options.some((option) => option.value === nextConfig.email_provider)
  ) {
    nextConfig.email_provider = nextConfig.email_provider_options[0]?.value ?? ''
  }

  return nextConfig
}

export function SystemSettingsPanel({ open, onClose }: SystemSettingsPanelProps) {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [savedConfig, setSavedConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [registrationEmailDomainsError, setRegistrationEmailDomainsError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    async function loadConfig() {
      setLoading(true)
      try {
        const data = await requestJson<{ ok: boolean } & SystemConfig>('/api/config/system')
        if (!active) return
        const nextConfig = normalizeSystemConfig(data)
        setConfig(nextConfig)
        setSavedConfig(nextConfig)
        setRegistrationEmailDomainsError('')
      } catch (error) {
        if (!active) return
        appMessage.error(error instanceof Error ? error.message : '系统设置加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadConfig()
    return () => { active = false }
  }, [open])

  const dirtyState = useMemo(
    () => ({
      public_statistics: config.public_statistics !== savedConfig.public_statistics,
      title: config.title_enabled !== savedConfig.title_enabled || config.title !== savedConfig.title,
      registration:
        config.external_registration_enabled !== savedConfig.external_registration_enabled
        || config.email_verification_enabled !== savedConfig.email_verification_enabled
        || config.email_provider !== savedConfig.email_provider
        || config.registration_email_domain_restriction_enabled !== savedConfig.registration_email_domain_restriction_enabled
        || config.registration_email_domains !== savedConfig.registration_email_domains,
    }),
    [config, savedConfig],
  )

  const hasUnsavedChanges = Object.values(dirtyState).some(Boolean)

  function updateSection<K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) {
    if (key === 'registration_email_domains') {
      setRegistrationEmailDomainsError('')
    }
    if (key === 'registration_email_domain_restriction_enabled' && !value) {
      setRegistrationEmailDomainsError('')
    }
    if (key === 'email_verification_enabled' && value && !config.email_provider) {
      const fallbackProvider = config.email_provider_options[0]?.value ?? ''
      if (fallbackProvider) {
        setConfig((current) => ({ ...current, [key]: value, email_provider: fallbackProvider }))
        return
      }
    }
    setConfig((current) => ({ ...current, [key]: value }))
  }

  function isRegistrationEmailDomainError(message: string) {
    return message.includes('邮箱域名') || message.includes('允许的域名')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const data = await requestJson<{ ok: boolean } & SystemConfig>('/api/config/system', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      const nextConfig = normalizeSystemConfig(data)
      setConfig(nextConfig)
      setSavedConfig(nextConfig)
      setRegistrationEmailDomainsError('')
      appMessage.success('系统设置已保存')
    } catch (error) {
      const message = error instanceof Error ? error.message : '系统设置保存失败'
      if (isRegistrationEmailDomainError(message)) {
        setRegistrationEmailDomainsError(message)
      }
      appMessage.error(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSendTestEmail() {
    if (!testEmail || !testEmail.includes('@')) {
      appMessage.warning('请输入有效的邮箱地址')
      return
    }
    setSendingTest(true)
    try {
      await requestJson<{ ok: boolean; message?: string; error?: string }>('/api/admin/send-test-email', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail }),
      })
      appMessage.success('测试邮件已发送')
      setTestEmail('')
    } catch (error) {
      appMessage.error(error instanceof Error ? error.message : '发送测试邮件失败')
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div className="system-settings-panel">
      <div className="system-settings-rows">
        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">公开统计</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text className="system-settings-row-help">
              开启后，未登录用户也可以访问独立统计页和统计接口。
            </Typography.Text>
          </div>
          <Switch
            checked={config.public_statistics}
            checkedChildren="公开"
            unCheckedChildren="关闭"
            onChange={(checked) => updateSection('public_statistics', checked)}
          />
        </div>

        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">站点标题</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text
              className={`system-settings-row-help ${
                config.title_enabled ? 'system-settings-row-help-hidden' : 'system-settings-row-help-visible'
              }`}
            >
              开启后，页面和通知里使用这里的标题。
            </Typography.Text>
            <div
              className={`system-settings-row-field ${
                config.title_enabled ? 'system-settings-row-field-visible' : 'system-settings-row-field-hidden'
              }`}
            >
              <Input
                value={config.title}
                placeholder="站点标题"
                allowClear
                onChange={(event) => updateSection('title', event.target.value)}
              />
            </div>
          </div>
          <Switch
            checked={config.title_enabled}
            checkedChildren="启用"
            unCheckedChildren="关闭"
            onChange={(enabled) => updateSection('title_enabled', enabled)}
          />
        </div>

        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">测试邮件</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text className="system-settings-row-help">
              填写邮箱地址并点击发送，用于验证当前配置的邮箱发送方式是否正确。
            </Typography.Text>
            <div className="system-settings-row-field system-settings-row-field-visible">
              <Input
                value={testEmail}
                placeholder="接收测试邮件的邮箱"
                onChange={(event) => setTestEmail(event.target.value)}
                onPressEnter={() => void handleSendTestEmail()}
              />
            </div>
          </div>
          <Button
            type="primary"
            loading={sendingTest}
            disabled={!testEmail}
            onClick={() => void handleSendTestEmail()}
          >
            发送
          </Button>
        </div>

        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">外部注册</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text className="system-settings-row-help">
              开启后，未注册用户可以通过邮箱注册新账号。
            </Typography.Text>
          </div>
          <Switch
            checked={config.external_registration_enabled}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(checked) => updateSection('external_registration_enabled', checked)}
          />
        </div>

        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">限制注册邮箱域名</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text
              className={`system-settings-row-help ${
                config.registration_email_domain_restriction_enabled
                  ? 'system-settings-row-help-hidden'
                  : 'system-settings-row-help-visible'
              }`}
            >
              开启后，只允许指定域名的邮箱注册，多个域名用英文逗号分隔，例如 example.com,example.org。
            </Typography.Text>
            <div
              className={`system-settings-row-field ${
                config.registration_email_domain_restriction_enabled
                  ? 'system-settings-row-field-visible'
                  : 'system-settings-row-field-hidden'
              }`}
            >
              <Input
                value={config.registration_email_domains}
                placeholder="example.com,example.org"
                allowClear
                status={registrationEmailDomainsError ? 'error' : undefined}
                onChange={(event) => updateSection('registration_email_domains', event.target.value)}
              />
              {registrationEmailDomainsError ? (
                <Typography.Text type="danger">{registrationEmailDomainsError}</Typography.Text>
              ) : null}
            </div>
          </div>
          <Switch
            checked={config.registration_email_domain_restriction_enabled}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(checked) => updateSection('registration_email_domain_restriction_enabled', checked)}
          />
        </div>

        <div className="system-settings-row">
          <Typography.Text className="system-settings-row-title">邮箱验证</Typography.Text>
          <div className="system-settings-row-body">
            <Typography.Text
              className={`system-settings-row-help ${
                config.email_verification_enabled ? 'system-settings-row-help-hidden' : 'system-settings-row-help-visible'
              }`}
            >
              开启后，注册时需要输入邮箱收到的验证码。请选择可用的邮箱提供商。
            </Typography.Text>
            <div
              className={`system-settings-row-field ${
                config.email_verification_enabled ? 'system-settings-row-field-visible' : 'system-settings-row-field-hidden'
              }`}
            >
              {config.email_provider_options.length > 0 ? (
                <Select
                  value={config.email_provider || undefined}
                  placeholder="选择邮箱提供商"
                  options={config.email_provider_options}
                  style={{ width: '100%' }}
                  onChange={(value) => updateSection('email_provider', value)}
                />
              ) : (
                <Typography.Text type="secondary">
                  当前未检测到可用的邮箱提供商，请先配置 SMTP 或 Resend API Key。
                </Typography.Text>
              )}
            </div>
          </div>
          <Switch
            checked={config.email_verification_enabled}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(checked) => updateSection('email_verification_enabled', checked)}
          />
        </div>
      </div>

      <div className="system-settings-footer">
        <Typography.Text className="system-settings-footer-hint">
          {hasUnsavedChanges ? '有未保存的更改。' : '当前状态已保存。'}
        </Typography.Text>
        <div className="system-settings-footer-actions">
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" disabled={!hasUnsavedChanges} loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
