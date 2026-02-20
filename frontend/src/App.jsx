import { useState } from 'react'
import axios from 'axios'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import StatsStrip from './components/StatsStrip'
import GraphPanel from './components/GraphPanel'
import RingPanel from './components/RingPanel'
import AccountsTable from './components/AccountsTable'
import DownloadBar from './components/DownloadBar'
import styles from './App.module.css'

export default function App() {
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [error, setError]       = useState(null)

  const fakeProgress = (stages) => {
    let i = 0
    const tick = () => {
      if (i >= stages.length) return
      setProgress(stages[i++])
      setTimeout(tick, 400)
    }
    tick()
  }

  const analyze = async (file) => {
    setError(null)
    setResult(null)
    setLoading(true)

    fakeProgress([
      { pct: 10, label: 'Parsing CSV…' },
      { pct: 28, label: 'Building transaction graph…' },
      { pct: 48, label: 'Detecting cycles (Johnson DFS)…' },
      { pct: 65, label: 'Detecting smurfing patterns…' },
      { pct: 80, label: 'Detecting shell networks…' },
      { pct: 92, label: 'Scoring & filtering false positives…' },
      { pct: 98, label: 'Rendering visualization…' },
    ])

    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await axios.post('/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,  // 5 min timeout for large files
      })
      setProgress({ pct: 100, label: 'Done!' })
      // small delay so progress hits 100% before results render
      setTimeout(() => { setResult(data); setLoading(false) }, 300)
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Analysis failed'
      setError(msg)
      setLoading(false)
    }
  }

  const loadSample = async () => {
    setError(null)
    setResult(null)
    setLoading(true)

    fakeProgress([
      { pct: 15, label: 'Generating sample dataset…' },
      { pct: 40, label: 'Building transaction graph…' },
      { pct: 60, label: 'Running detection algorithms…' },
      { pct: 85, label: 'Scoring accounts…' },
      { pct: 98, label: 'Rendering visualization…' },
    ])

    try {
      const { data } = await axios.post('/sample')
      setProgress({ pct: 100, label: 'Done!' })
      setTimeout(() => { setResult(data); setLoading(false) }, 300)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load sample data')
      setLoading(false)
    }
  }

  const reset = () => { setResult(null); setError(null); setLoading(false) }

  return (
    <div className={styles.app}>
      <div className={styles.grid} aria-hidden />
      <Header />

      <main className={styles.main}>
        <UploadZone
          onFile={analyze}
          onSample={loadSample}
          loading={loading}
          progress={progress}
          error={error}
        />

        {result && (
          <>
            <div className="fade-up">
              <StatsStrip summary={result.summary} />
            </div>

            <div className={`${styles.resultsGrid} fade-up-2`}>
              <div className={styles.leftCol}>
                <GraphPanel
                  graphData={result.graph}
                  suspiciousAccounts={result.suspicious_accounts}
                  fraudRings={result.fraud_rings}
                />
                <AccountsTable accounts={result.suspicious_accounts} />
              </div>
              <div className={styles.rightCol}>
                <RingPanel rings={result.fraud_rings} />
              </div>
            </div>

            <div className="fade-up-3">
              <DownloadBar result={result} onReset={reset} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
