import { useEffect, useRef, type MutableRefObject } from 'react'
import { Form } from 'antd'

export type GeetestCaptcha = {
  appendTo: (selector: string) => void
  getValidate: () => {
    lot_number: string
    captcha_output: string
    pass_token: string
    gen_time: string
  } | false
  reset: () => void
  showBox: () => void
}

declare global {
  interface Window {
    initGeetest4?: (config: { captchaId: string; product: string }, callback: (captcha: GeetestCaptcha) => void) => void
  }
}

type GeetestCaptchaFieldProps = {
  enabled: boolean
  captchaId: string
  containerId: string
  captchaRef: MutableRefObject<GeetestCaptcha | null>
}

export function GeetestCaptchaField({ enabled, captchaId, containerId, captchaRef }: GeetestCaptchaFieldProps) {
  const geetestReadyRef = useRef(false)

  useEffect(() => {
    if (!enabled || !captchaId) return
    if (geetestReadyRef.current) return

    let mounted = true

    function initCaptcha() {
      if (!mounted || !window.initGeetest4 || geetestReadyRef.current) return
      window.initGeetest4({ captchaId, product: 'float' }, (captcha) => {
        if (!mounted) return
        captchaRef.current = captcha
        geetestReadyRef.current = true
        captcha.appendTo(`#${containerId}`)
      })
    }

    if (window.initGeetest4) {
      initCaptcha()
      return () => {
        mounted = false
      }
    }

    const existing = document.querySelector('script[src*="geetest"]')
    if (existing) {
      existing.addEventListener('load', initCaptcha)
      return () => {
        mounted = false
        existing.removeEventListener('load', initCaptcha)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://static.geetest.com/v4/gt4.js'
    script.onload = initCaptcha
    document.head.appendChild(script)

    return () => {
      mounted = false
    }
  }, [captchaId, captchaRef, containerId, enabled])

  if (!enabled || !captchaId) {
    return null
  }

  return (
    <Form.Item label="人机验证">
      <div id={containerId} />
    </Form.Item>
  )
}
