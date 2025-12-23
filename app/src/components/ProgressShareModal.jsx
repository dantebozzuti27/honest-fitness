import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import Button from './Button'
import { generateShareImage, shareNative, copyImageToClipboard, downloadImage } from '../utils/shareUtils'
import styles from './ProgressShareModal.module.css'

export default function ProgressShareModal({ isOpen, onClose, title = 'Progress', subtitle = '', items = [] }) {
  const cardRef = useRef(null)
  const closeBtnRef = useRef(null)
  const modalRef = useRef(null)
  const [imageDataUrl, setImageDataUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(async () => {
      try {
        if (!cardRef.current) return
        const url = await generateShareImage(cardRef.current, 'instagram')
        setImageDataUrl(url || null)
      } catch {
        setImageDataUrl(null)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [isOpen, title, subtitle, items])

  const doNativeShare = async () => {
    setBusy(true)
    try {
      const imageToShare = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current, 'instagram') : null)
      await shareNative('Echelon', 'My progress this week.', window.location.origin, imageToShare)
      onClose()
    } catch {
      // non-blocking
    } finally {
      setBusy(false)
    }
  }

  const doCopy = async () => {
    setBusy(true)
    try {
      const imageToCopy = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current, 'instagram') : null)
      if (imageToCopy) await copyImageToClipboard(imageToCopy)
    } catch {
      // non-blocking
    } finally {
      setBusy(false)
    }
  }

  const doDownload = async () => {
    setBusy(true)
    try {
      const imageToDl = imageDataUrl || (cardRef.current ? await generateShareImage(cardRef.current, 'instagram') : null)
      if (imageToDl) await downloadImage(imageToDl, 'echelon-progress.png')
    } catch {
      // non-blocking
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      containerRef={modalRef}
      initialFocusRef={closeBtnRef}
      overlayClassName={styles.overlay}
      modalClassName={styles.modal}
      ariaLabel="Share progress"
    >
      <div className={styles.header}>
        <div>
          <div className={styles.headerTitle}>Share</div>
          <div className={styles.headerSub}>Export a progress card for social.</div>
        </div>
        <Button ref={closeBtnRef} unstyled className={styles.closeBtn} onClick={onClose}>✕</Button>
      </div>

      <div className={styles.previewWrap}>
        <div className={styles.card} ref={cardRef}>
          <div className={styles.cardTop}>
            <div className={styles.cardBrand}>ECHELON</div>
            <div className={styles.cardTitle}>{title}</div>
            {subtitle ? <div className={styles.cardSub}>{subtitle}</div> : null}
          </div>
          <div className={styles.cardList}>
            {(Array.isArray(items) ? items : []).slice(0, 10).map((it, idx) => (
              <div key={idx} className={styles.cardRow}>
                <div className={styles.cardRowLeft}>
                  <div className={styles.cardRowTitle}>{it.title}</div>
                  {it.sub ? <div className={styles.cardRowSub}>{it.sub}</div> : null}
                </div>
                {it.value ? <div className={styles.cardRowValue}>{it.value}</div> : null}
              </div>
            ))}
          </div>
          <div className={styles.cardFooter}>honestfitness · progress</div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={doNativeShare} disabled={busy} type="button">
          Share
        </button>
        <button className={styles.actionBtn} onClick={doCopy} disabled={busy} type="button">
          Copy image
        </button>
        <button className={styles.actionBtn} onClick={doDownload} disabled={busy} type="button">
          Download
        </button>
      </div>
    </Modal>
  )
}





