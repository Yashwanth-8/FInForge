import styles from './DownloadBar.module.css'

export default function DownloadBar({ result, onReset }) {
  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'finforge_fraud_report.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.bar}>
      <div className={styles.label}>
        <span>06 · Export</span>
      </div>
      <div className={styles.actions}>
        <button className={styles.btnDownload} onClick={downloadJSON}>
          ↓ Download JSON Report
        </button>
        <button className={styles.btnReset} onClick={onReset}>
          ⟳ Analyze New File
        </button>
      </div>
    </div>
  )
}
