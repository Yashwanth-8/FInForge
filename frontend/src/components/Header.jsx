import styles from './Header.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>⬡</div>
        <div>
          <div className={styles.logoName}>FinForge</div>
          <div className={styles.logoSub}>Financial Crime Detection Engine</div>
        </div>
      </div>

      <div className={styles.pills}>
        <div className={styles.pill}>
          <span className={styles.dot} />
          Graph Engine Ready
        </div>
        <div className={`${styles.pill} ${styles.pillDim}`}>
          RIFT 2026 · Graph Theory Track
        </div>
      </div>
    </header>
  )
}
