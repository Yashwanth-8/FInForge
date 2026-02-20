import { useState } from 'react'
import styles from './RingPanel.module.css'

const PATTERN_ICONS = { cycle: '⟳', smurfing: '◈', shell_network: '◻' }

export default function RingPanel({ rings }) {
  const [active, setActive] = useState(null)
  const sorted = [...rings].sort((a, b) => b.risk_score - a.risk_score)

  const scoreClass = (s) => s >= 80 ? styles.high : s >= 55 ? styles.med : styles.low

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>
          Fraud Ring Summary
        </div>
        <span className={styles.badge}>{rings.length} rings</span>
      </div>

      <div className={styles.sectionLabel}>04 · Detected Rings</div>

      <div className={styles.list}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No fraud rings detected in this dataset.</div>
        ) : (
          sorted.map(ring => (
            <div
              key={ring.ring_id}
              className={`${styles.card} ${active === ring.ring_id ? styles.active : ''}`}
              onClick={() => setActive(active === ring.ring_id ? null : ring.ring_id)}
            >
              <div className={styles.cardTop}>
                <div className={styles.ringId}>{ring.ring_id}</div>
                <div className={`${styles.score} ${scoreClass(ring.risk_score)}`}>
                  {ring.risk_score.toFixed(1)}
                </div>
              </div>

              <div className={styles.meta}>
                <span className={styles.patternTag}>
                  {PATTERN_ICONS[ring.pattern_type] || '?'} {ring.pattern_type.replace(/_/g, ' ')}
                </span>
                <span className={styles.memberCount}>{ring.member_accounts.length} accounts</span>
              </div>

              <div className={styles.members}>
                {ring.member_accounts.join(', ')}
              </div>

              {active === ring.ring_id && (
                <div className={styles.expanded}>
                  <div className={styles.expandLabel}>Member Accounts</div>
                  <div className={styles.memberList}>
                    {ring.member_accounts.map(m => (
                      <span key={m} className={styles.memberChip}>{m}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
