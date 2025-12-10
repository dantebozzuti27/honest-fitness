import styles from './Tabs.module.css'

export default function Tabs({ tabs, activeTab, onTabChange, className = '' }) {
  return (
    <div className={`${styles.tabs} ${className}`}>
      {tabs.map((tab) => {
        const tabLabel = typeof tab === 'string' ? tab : tab.label
        const tabId = typeof tab === 'string' ? tab : tab.id || tab.label
        
        return (
          <button
            key={tabId}
            className={`${styles.tab} ${activeTab === tabId ? styles.active : ''}`}
            onClick={() => onTabChange(tabId)}
            aria-selected={activeTab === tabId}
            role="tab"
          >
            {tabLabel}
          </button>
        )
      })}
    </div>
  )
}

