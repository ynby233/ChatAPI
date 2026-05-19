import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, InputNumber, Space, Switch, Typography, message } from 'antd'

import { requestJson } from '../../lib/api'
import type { SystemConfig } from '../../types/chat'

type SystemSettingsPanelProps = {
  open: boolean
  onClose: () => void
}

const DEFAULT_CONFIG: SystemConfig = {
  public_statistics: false,
  api_key_enabled: false,
  api_key: '',
  title_enabled: false,
  title: '',
  ntfy_url_enabled: false,
  ntfy_url: '',
  messages_per_minute_limit_enabled: false,
  messages_per_minute_limit: 0,
  totp_secret_enabled: false,
  totp_secret: '',
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31]
  }

  return output
}

function generateTotpSecret(): string {
  const bytes = new Uint8Array(20)
  window.crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

export function SystemSettingsPanel({ open, onClose }: SystemSettingsPanelProps) {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [savedConfig, setSavedConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return

    let active = true

    async function loadSystemConfig() {
      setLoading(true)
      try {
        const data = await requestJson<{ ok: boolean } & SystemConfig>('/api/config/system')
        if (!active) return
        const nextConfig: SystemConfig = {
          public_statistics: Boolean(data.public_statistics),
          api_key_enabled: Boolean(data.api_key_enabled),
          api_key: String(data.api_key ?? ''),
          title_enabled: Boolean(data.title_enabled),
          title: String(data.title ?? ''),
          ntfy_url_enabled: Boolean(data.ntfy_url_enabled),
          ntfy_url: String(data.ntfy_url ?? ''),
          messages_per_minute_limit_enabled: Boolean(data.messages_per_minute_limit_enabled),
          messages_per_minute_limit: Number(data.messages_per_minute_limit ?? 0),
          totp_secret_enabled: Boolean(data.totp_secret_enabled),
          totp_secret: String(data.totp_secret ?? ''),
        }
        setConfig(nextConfig)
        setSavedConfig(nextConfig)
      } catch (error) {
        if (!active) return
        message.error(error instanceof Error ? error.message : '系统设置加载失败')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadSystemConfig()

    return () => {
      active = false
    }
  }, [open])

  const dirtyState = useMemo(() => {
    return {
      public_statistics: config.public_statistics !== savedConfig.public_statistics,
      api_key:
        config.api_key_enabled !== savedConfig.api_key_enabled ||
        config.api_key !== savedConfig.api_key,
      title:
        config.title_enabled !== savedConfig.title_enabled ||
        config.title !== savedConfig.title,
      ntfy_url:
        config.ntfy_url_enabled !== savedConfig.ntfy_url_enabled ||
        config.ntfy_url !== savedConfig.ntfy_url,
      messages_per_minute_limit:
        config.messages_per_minute_limit_enabled !==
          savedConfig.messages_per_minute_limit_enabled ||
        config.messages_per_minute_limit !== savedConfig.messages_per_minute_limit,
      totp_secret:
        config.totp_secret_enabled !== savedConfig.totp_secret_enabled ||
        config.totp_secret !== savedConfig.totp_secret,
    }
  }, [config, savedConfig])

  const hasUnsavedChanges = Object.values(dirtyState).some(Boolean)

  function updateSection<K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const data = await requestJson<{ ok: boolean } & SystemConfig>('/api/config/system', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      const nextConfig: SystemConfig = {
        public_statistics: Boolean(data.public_statistics),
        api_key_enabled: Boolean(data.api_key_enabled),
        api_key: String(data.api_key ?? ''),
        title_enabled: Boolean(data.title_enabled),
        title: String(data.title ?? ''),
        ntfy_url_enabled: Boolean(data.ntfy_url_enabled),
        ntfy_url: String(data.ntfy_url ?? ''),
        messages_per_minute_limit_enabled: Boolean(data.messages_per_minute_limit_enabled),
        messages_per_minute_limit: Number(data.messages_per_minute_limit ?? 0),
        totp_secret_enabled: Boolean(data.totp_secret_enabled),
        totp_secret: String(data.totp_secret ?? ''),
      }
      setConfig(nextConfig)
      setSavedConfig(nextConfig)
      message.success('系统设置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '系统设置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="system-settings-panel">
      <Card className="system-settings-card" loading={loading}>
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
            <Typography.Text className="system-settings-row-title">API Key</Typography.Text>
            <div className="system-settings-row-body">
              <Typography.Text
                className={`system-settings-row-help ${
                  config.api_key_enabled ? 'system-settings-row-help-hidden' : 'system-settings-row-help-visible'
                }`}
              >
                开启后，系统会把这里填写的值作为接口鉴权密钥。
              </Typography.Text>
              <div
                className={`system-settings-row-field ${
                  config.api_key_enabled ? 'system-settings-row-field-visible' : 'system-settings-row-field-hidden'
                }`}
              >
                <Input.Password
                  value={config.api_key}
                  placeholder="API Key"
                  allowClear
                  onChange={(event) => updateSection('api_key', event.target.value)}
                />
              </div>
            </div>
            <Switch
              checked={config.api_key_enabled}
              checkedChildren="启用"
              unCheckedChildren="关闭"
              onChange={(enabled) => updateSection('api_key_enabled', enabled)}
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
            <Typography.Text className="system-settings-row-title">ntfy 推送地址</Typography.Text>
            <div className="system-settings-row-body">
              <Typography.Text
                className={`system-settings-row-help ${
                  config.ntfy_url_enabled ? 'system-settings-row-help-hidden' : 'system-settings-row-help-visible'
                }`}
              >
                开启后，收到用户消息时会向这里发送推送。
              </Typography.Text>
              <div
                className={`system-settings-row-field ${
                  config.ntfy_url_enabled ? 'system-settings-row-field-visible' : 'system-settings-row-field-hidden'
                }`}
              >
                <Input
                  value={config.ntfy_url}
                  placeholder="https://ntfy.sh/your-topic"
                  allowClear
                  onChange={(event) => updateSection('ntfy_url', event.target.value)}
                />
              </div>
            </div>
            <Switch
              checked={config.ntfy_url_enabled}
              checkedChildren="启用"
              unCheckedChildren="关闭"
              onChange={(enabled) => updateSection('ntfy_url_enabled', enabled)}
            />
          </div>

          <div className="system-settings-row">
            <Typography.Text className="system-settings-row-title">消息限流</Typography.Text>
            <div className="system-settings-row-body">
              <Typography.Text
                className={`system-settings-row-help ${
                  config.messages_per_minute_limit_enabled
                    ? 'system-settings-row-help-hidden'
                    : 'system-settings-row-help-visible'
                }`}
              >
                开启后，按每分钟消息数限制输入请求。
              </Typography.Text>
              <div
                className={`system-settings-row-field ${
                  config.messages_per_minute_limit_enabled
                    ? 'system-settings-row-field-visible'
                    : 'system-settings-row-field-hidden'
                }`}
              >
                <InputNumber
                  value={config.messages_per_minute_limit}
                  min={0}
                  precision={0}
                  controls
                  className="system-settings-number-input"
                  placeholder="0"
                  onChange={(value) => updateSection('messages_per_minute_limit', Number(value ?? 0))}
                />
              </div>
            </div>
            <Switch
              checked={config.messages_per_minute_limit_enabled}
              checkedChildren="启用"
              unCheckedChildren="关闭"
              onChange={(enabled) => updateSection('messages_per_minute_limit_enabled', enabled)}
            />
          </div>

          <div className="system-settings-row">
            <Typography.Text className="system-settings-row-title">TOTP 验证</Typography.Text>
            <div className="system-settings-row-body">
              <Typography.Text
                className={`system-settings-row-help ${
                  config.totp_secret_enabled ? 'system-settings-row-help-hidden' : 'system-settings-row-help-visible'
                }`}
              >
                开启后，登录时需要输入 6 位验证码。
              </Typography.Text>
              <div
                className={`system-settings-row-field ${
                  config.totp_secret_enabled ? 'system-settings-row-field-visible' : 'system-settings-row-field-hidden'
                }`}
              >
                <Space.Compact className="system-settings-compact">
                  <Input.Password
                    value={config.totp_secret}
                    placeholder="TOTP secret"
                    allowClear
                    onChange={(event) => updateSection('totp_secret', event.target.value)}
                  />
                  <Button
                    onClick={() => {
                      const secret = generateTotpSecret()
                      updateSection('totp_secret', secret)
                      updateSection('totp_secret_enabled', true)
                    }}
                  >
                    生成
                  </Button>
                </Space.Compact>
              </div>
            </div>
            <Switch
              checked={config.totp_secret_enabled}
              checkedChildren="启用"
              unCheckedChildren="关闭"
              onChange={(enabled) => updateSection('totp_secret_enabled', enabled)}
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
      </Card>
    </div>
  )
}
