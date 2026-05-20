import { useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import './App.css'
import { GithubButton } from './components/GithubButton'
import { HomepageScreen } from './components/HomepageScreen'
import { LoginScreen } from './components/LoginScreen'
import { RegistrationScreen } from './components/RegistrationScreen'
import { type GeetestCaptcha } from './components/GeetestCaptchaField'
import { StatisticsPage } from './components/StatisticsPage'
import { ThemeToggle } from './components/ThemeToggle'
import { WorkspaceRoute } from './components/WorkspaceRoute'
import { useAuthSession } from './hooks/useAuthSession'
import { appMessage } from './lib/antdApp'
import type { LoginFormValues } from './types/chat'

function RouteLoading() {
  return (
    <div className="boot-screen">
      <Spin size="large" />
    </div>
  )
}

function LoginRoute() {
  const navigate = useNavigate()
  const auth = useAuthSession()
  const [loading, setLoading] = useState(false)
  const [totpRequired, setTotpRequired] = useState(false)
  const captchaRef = useRef<GeetestCaptcha | null>(null)

  async function handleSubmit(values: LoginFormValues) {
    setLoading(true)
    try {
      await auth.login(values)
      navigate('/app', { replace: true })
    } catch (error) {
      captchaRef.current?.reset()
      // Check if TOTP is required based on the error response
      if (error instanceof Error && (error as any).responseBody?.totp_required) {
        setTotpRequired(true)
        appMessage.error(error instanceof Error ? error.message : '请输入验证码')
      } else {
        appMessage.error(error instanceof Error ? error.message : '登录失败')
      }
    } finally {
      setLoading(false)
    }
  }

  if (auth.loading) {
    return <RouteLoading />
  }

  if (auth.session.authenticated) {
    return <Navigate to="/app" replace />
  }

  return (
    <LoginScreen
      loading={loading}
      totpEnabled={auth.session.totp_enabled || totpRequired}
      registrationEnabled={auth.session.registration_enabled}
      geetestEnabled={auth.session.geetest_enabled}
      geetestCaptchaId={auth.session.geetest_captcha_id}
      geetestCaptchaRef={captchaRef}
      onSubmit={(values) => void handleSubmit(values)}
      onNavigateToRegister={() => navigate('/register')}
    />
  )
}

function RegisterRoute() {
  const navigate = useNavigate()
  const auth = useAuthSession()

  if (auth.loading) {
    return <RouteLoading />
  }

  if (auth.session.authenticated) {
    return <Navigate to="/app" replace />
  }

  return (
    <RegistrationScreen
      onRegistered={() => navigate('/login')}
      onBackToLogin={() => navigate('/login')}
    />
  )
}

function StatisticsRoute() {
  return <StatisticsPage />
}

function App() {
  const location = useLocation()

  useEffect(() => {
    document.body.dataset.route = location.pathname
    return () => {
      delete document.body.dataset.route
    }
  }, [location.pathname])

  return (
    <>
      {!location.pathname.startsWith('/app') ? (
        <div className="global-theme-toggle-wrap">
          <div className="global-theme-toggle-group">
            <GithubButton />
            <ThemeToggle />
          </div>
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<HomepageScreen />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/register" element={<RegisterRoute />} />
        <Route path="/stat" element={<StatisticsRoute />} />
        <Route path="/statistics" element={<StatisticsRoute />} />
        <Route path="/app/*" element={<WorkspaceRoute />} />
        <Route path="*" element={<HomepageScreen />} />
      </Routes>
    </>
  )
}

export default App
