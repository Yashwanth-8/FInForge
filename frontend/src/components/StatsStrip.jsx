import styles from './StatsStrip.module.css'

export default function StatsStrip({ summary }) {
  const cards = [
    { label: 'Total Accounts', value: summary.total_accounts_analyzed?.toLocaleString(), sub: `${summary.total_transactions} transactions`, accent: 'ok' },
    { label: 'Suspicious Accounts', value: summary.suspicious_accounts_flagged, sub: 'Flagged by algorithms', accent: 'warn' },
    { label: 'Fraud Rings Detected', value: summary.fraud_rings_detected, sub: `${summary.cycles_found} cycles · ${summary.smurfing_hubs_found} smurfing hubs`, accent: 'danger' },
    { label: 'Processing Time', value: `${summary.processing_time_seconds}s`, sub: 'Graph traversal complete', accent: 'default' },
  ]

  return (
    <div className={styles.strip}>
      <div className={styles.label}>
        <span>02 · Analysis Summary</span>
      </div>
      <div className={styles.cards}>
        {cards.map((c, i) => (
          <div key={i} className={`${styles.card} ${styles[c.accent]}`}>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardValue}>{c.value}</div>
            <div className={styles.cardSub}>{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
