import { useRef, useState } from 'react'
import styles from './UploadZone.module.css'

export default function UploadZone({ onFile, onSample, loading, progress, error }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) onFile(f)
  }

  const handleChange = (e) => {
    if (e.target.files[0]) {
      onFile(e.target.files[0])
      // reset so same file can be picked again without refresh
      e.target.value = ''
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.label}>
        <span>01 · Data Ingestion</span>
      </div>

      <div
        className={`${styles.zone} ${dragging ? styles.dragging : ''} ${loading ? styles.loading : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !loading && inputRef.current?.click()}
      >
        <div className={styles.inner}>
          {loading ? (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <div className={styles.progressLabel}>{progress.label}</div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
              </div>
              <div className={styles.progressPct}>{progress.pct}%</div>
            </div>
          ) : (
            <>
              <div className={styles.icon}>📂</div>
              <div className={styles.title}>Drop your transaction CSV here</div>
              <div className={styles.sub}>
                Required columns:{' '}
                <code>transaction_id, sender_id, receiver_id, amount, timestamp</code>
                <br />
                Supports datasets up to 10,000 transactions · YYYY-MM-DD HH:MM:SS format
              </div>
              <button
                className={styles.btn}
                onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
              >
                ↑ Select CSV File
              </button>
              <div className={styles.sampleHint}>
                No data?{' '}
                <button
                  className={styles.sampleLink}
                  onClick={(e) => { e.stopPropagation(); onSample() }}
                >
                  Load built-in sample dataset
                </button>{' '}
                to see all detection patterns
              </div>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleChange}
        />
      </div>

      {error && (
        <div className={styles.error}>
          ⚠ {error}
        </div>
      )}
    </section>
  )
}
