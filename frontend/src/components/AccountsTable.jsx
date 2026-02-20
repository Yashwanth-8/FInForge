import styles from './AccountsTable.module.css'

const TAG_CLASS = (p) => {
  if (p.includes('cycle')) return styles.tagCycle
  if (p.includes('fan') || p.includes('velocity') || p.includes('smurf')) return styles.tagSmurf
  return styles.tagShell
}

export default function AccountsTable({ accounts }) {
  if (!accounts || accounts.length === 0) return null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>
          Suspicious Accounts
          <span className={styles.badge}>{accounts.length}</span>
        </div>
      </div>
      <div className={styles.sectionLabel}>05 · Account Detail</div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Account ID</th>
              <th>Suspicion Score</th>
              <th>Ring</th>
              <th>Patterns Detected</th>
            </tr>
          </thead>
          <tbody>
            {accounts.slice(0, 100).map(acc => {
              const score = acc.suspicion_score
              const barColor = score >= 80 ? 'var(--danger)' : score >= 55 ? 'var(--warn)' : 'var(--safe)'
              return (
                <tr key={acc.account_id}>
                  <td>
                    <span className={styles.accountId}>{acc.account_id}</span>
                  </td>
                  <td>
                    <div className={styles.scoreWrap}>
                      <div className={styles.scoreBar}>
                        <div
                          className={styles.scoreFill}
                          style={{ width: `${score}%`, background: barColor }}
                        />
                      </div>
                      <span className={styles.scoreNum} style={{ color: barColor }}>{score}</span>
                    </div>
                  </td>
                  <td>
                    <span className={styles.ringId}>{acc.ring_id}</span>
                  </td>
                  <td>
                    <div className={styles.tags}>
                      {acc.detected_patterns.map(p => (
                        <span key={p} className={`${styles.tag} ${TAG_CLASS(p)}`}>
                          {p.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
