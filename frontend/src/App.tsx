import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { message, Spin } from 'antd'

import './App.css'
import { HomepageScreen } from './components/HomepageScreen'
import { LoginScreen } from './components/LoginScreen'
import { StatisticsPage } from './components/StatisticsPage'
import { ThemeToggle } from './components/ThemeToggle'
import { WorkspaceRoute } from './components/WorkspaceRoute'
import { useAuthSession } from './hooks/useAuthSession'
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

  async function handleSubmit(values: LoginFormValues) {
    setLoading(true)
    try {
      await auth.login(values)
      navigate('/app', { replace: true })
    } catch (error) {
      // Check if TOTP is required based on the error response
      if (error instanceof Error && (error as any).responseBody?.totp_required) {
        setTotpRequired(true)
        message.error(error instanceof Error ? error.message : '请输入验证码')
      } else {
        message.error(error instanceof Error ? error.message : '登录失败')
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
      onSubmit={(values) => void handleSubmit(values)}
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
          <ThemeToggle />
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<HomepageScreen />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/stat" element={<StatisticsRoute />} />
        <Route path="/statistics" element={<StatisticsRoute />} />
        <Route path="/app/*" element={<WorkspaceRoute />} />
        <Route path="*" element={<HomepageScreen />} />
      </Routes>
    </>
  )
}

export default App
