import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Switch, Typography, message } from 'antd'

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
}

export function SystemSettingsPanel({ open, onClose }: SystemSettingsPanelProps) {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [savedConfig, setSavedConfig] = useState<SystemConfig>(DEFAULT_CONFIG)
  const [, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    async function loadConfig() {
      setLoading(true)
      try {
        const data = await requestJson<{ ok: boolean } & SystemConfig>('/api/config/system')
        if (!active) return
        const nextConfig: SystemConfig = {
          public_statistics: Boolean(data.public_statistics),
          title_enabled: Boolean(data.title_enabled),
          title: String(data.title ?? ''),
        }
        setConfig(nextConfig)
        setSavedConfig(nextConfig)
      } catch (error) {
        if (!active) return
        message.error(error instanceof Error ? error.message : '系统设置加载失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadConfig()
    return () => { active = false }
  }, [open])

  const dirtyState = useMemo(() => ({
    public_statistics: config.public_statistics !== savedConfig.public_statistics,
    title: config.title_enabled !== savedConfig.title_enabled || config.title !== savedConfig.title,
  }), [config, savedConfig])

  const hasUnsavedChanges = Object.values(dirtyState).some(Boolean)

  function updateSection<K extends keyof SystemConfig>(key: K, value: SystemConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }))
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
        title_enabled: Boolean(data.title_enabled),
        title: String(data.title ?? ''),
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
