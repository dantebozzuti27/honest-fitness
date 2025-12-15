import { useState, useEffect } from 'react'
import { getAllExercises } from '../db/lazyDb'
import ExercisePicker from './ExercisePicker'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'
import ConfirmDialog from './ConfirmDialog'
import Button from './Button'
import InputField from './InputField'
import { normalizeTemplateExercises } from '../utils/templateUtils'
import styles from './TemplateEditor.module.css'

export default function TemplateEditor({ templates, onClose, onSave, onDelete, onEdit, editingTemplate: initialEditingTemplate }) {
  const [editingTemplate, setEditingTemplate] = useState(initialEditingTemplate || null)
  const [allExercises, setAllExercises] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const { toast, showToast, hideToast } = useToast()
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' })
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    exercises: []
  })

  useEffect(() => {
    async function load() {
      try {
        const exercises = await getAllExercises()
        setAllExercises(Array.isArray(exercises) ? exercises : [])
      } catch (error) {
        // Error loading exercises - silently fail, will retry
        setAllExercises([])
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (initialEditingTemplate) {
      setEditingTemplate(initialEditingTemplate)
      setFormData({
        id: initialEditingTemplate.id,
        name: initialEditingTemplate.name,
        exercises: normalizeTemplateExercises(initialEditingTemplate.exercises)
      })
    } else if (!editingTemplate) {
      setFormData({
        id: `template-${Date.now()}`,
        name: '',
        exercises: []
      })
    }
  }, [initialEditingTemplate])

  useEffect(() => {
    if (editingTemplate) {
      setFormData({
        id: editingTemplate.id,
        name: editingTemplate.name,
        exercises: normalizeTemplateExercises(editingTemplate.exercises)
      })
    }
  }, [editingTemplate])

  const handleAddExercise = (exercise) => {
    const meta = allExercises.find(e => e?.name === exercise?.name) || {}
    const isCardio = meta?.category === 'Cardio'
    const isRecovery = meta?.category === 'Recovery'
    const defaultSets = (isCardio || isRecovery) ? 1 : 4
    setFormData(prev => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        {
          name: exercise.name,
          sets: defaultSets,
          reps: isCardio ? '' : '8-12',
          time: isCardio ? '20:00' : '',
          notes: '',
          stackGroup: null
        }
      ]
    }))
    setShowPicker(false)
  }

  const handleRemoveExercise = (index) => {
    setFormData(prev => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== index)
    }))
  }

  const handleMoveExercise = (index, direction) => {
    const newExercises = [...formData.exercises]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newExercises.length) return
    ;[newExercises[index], newExercises[targetIndex]] = [newExercises[targetIndex], newExercises[index]]
    setFormData(prev => ({ ...prev, exercises: newExercises }))
  }

  const patchExercise = (index, patch) => {
    setFormData(prev => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => (i === index ? { ...(ex || {}), ...patch } : ex))
    }))
  }

  const getStackSize = (stackGroup) => {
    if (!stackGroup) return 0
    return formData.exercises.filter(e => e?.stackGroup && e.stackGroup === stackGroup).length
  }

  const stackWithNext = (index) => {
    const nextIndex = index + 1
    if (nextIndex >= formData.exercises.length) return

    const a = formData.exercises[index]
    const b = formData.exercises[nextIndex]
    if (!a || !b) return

    const aGroup = a.stackGroup || null
    const bGroup = b.stackGroup || null

    // Pick an existing group if either exercise is already in one; otherwise make a new one.
    const group = aGroup || bGroup || `stack_${Date.now()}_${Math.random().toString(16).slice(2)}`

    // If both have groups and differ, merge into `group` (prefer aGroup)
    const mergeFrom = aGroup && bGroup && aGroup !== bGroup ? bGroup : null

    setFormData(prev => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (!ex) return ex
        if (i === index || i === nextIndex) {
          return { ...ex, stackGroup: group }
        }
        if (mergeFrom && ex.stackGroup === mergeFrom) {
          return { ...ex, stackGroup: group }
        }
        return ex
      })
    }))
  }

  const unstackExercise = (index) => {
    patchExercise(index, { stackGroup: null })
  }

  const handleSave = () => {
    if (!formData.name.trim()) {
      showToast('Please enter a template name', 'error')
      return
    }
    if (formData.exercises.length === 0) {
      showToast('Please add at least one exercise', 'error')
      return
    }
    onSave(formData)
    setEditingTemplate(null)
    setFormData({
      id: `template-${Date.now()}`,
      name: '',
      exercises: []
    })
    if (onEdit) onEdit(null)
  }

  const handleNewTemplate = () => {
    const id = `template-${Date.now()}`
    const draft = { id, name: '', exercises: [] }
    setEditingTemplate(draft) // IMPORTANT: must be truthy to show editor UI
    setFormData(draft)
    if (onEdit) onEdit(null)
  }

  const handleCancel = () => {
    setEditingTemplate(null)
    setFormData({
      id: `template-${Date.now()}`,
      name: '',
      exercises: []
    })
    if (onEdit) onEdit(null)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Templates</h2>
          <Button unstyled onClick={onClose}>✕</Button>
        </div>
        
        {!editingTemplate ? (
          <div className={styles.templatesList}>
            <Button unstyled className={styles.newTemplateBtn} onClick={handleNewTemplate}>
              + New Template
            </Button>
            {templates.length === 0 ? (
              <p className={styles.emptyText}>No templates yet. Create your first one!</p>
            ) : (
              templates.map(template => (
                <div key={template.id} className={styles.templateCard}>
                  <div className={styles.templateInfo}>
                    <span className={styles.templateCardName}>{template.name}</span>
                    <span className={styles.templateCardCount}>{template.exercises?.length || 0} exercises</span>
                  </div>
                  <div className={styles.templateActions}>
                    <Button
                      unstyled
                      className={styles.editTemplateBtn}
                      onClick={() => {
                        setEditingTemplate(template)
                        if (onEdit) onEdit(template)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      unstyled
                      className={styles.deleteTemplateBtn}
                      onClick={() => {
                        setDeleteConfirm({ open: true, id: template.id, name: template.name })
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div className={styles.editHeader}>
              <h2>{editingTemplate && templates.find(t => t.id === editingTemplate.id) ? 'Edit Template' : 'New Template'}</h2>
              <Button unstyled onClick={handleCancel}>← Back</Button>
            </div>
            <div className={styles.content}>
              <div className={styles.formGroup}>
                <InputField
                  label="Template Name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Push Day, Leg Day"
                />
              </div>

              <div className={styles.exercisesSection}>
                <div className={styles.exercisesHeader}>
                  <label>Exercises</label>
                  <Button
                    unstyled
                    className={styles.addExerciseBtn}
                    onClick={() => setShowPicker(true)}
                  >
                    + Add Exercise
                  </Button>
                </div>
                
                <div className={styles.exercisesList}>
                  {formData.exercises.length === 0 ? (
                    <p className={styles.emptyText}>No exercises added yet</p>
                  ) : (
                    formData.exercises.map((ex, index) => (
                      <div key={index} className={styles.exerciseItem}>
                        <div className={styles.exerciseTopRow}>
                          <span className={styles.exerciseName}>{ex?.name}</span>
                          <div className={styles.exerciseActions}>
                            {ex?.stackGroup ? (
                              <span className={styles.stackPill}>
                                {(getStackSize(ex.stackGroup) === 2 ? 'Superset' : 'Circuit')} ({getStackSize(ex.stackGroup)})
                              </span>
                            ) : null}
                            <Button
                              unstyled
                              className={styles.stackBtn}
                              onClick={() => stackWithNext(index)}
                              disabled={index === formData.exercises.length - 1}
                              title="Stack with the next exercise (superset/circuit)"
                            >
                              Stack ↓
                            </Button>
                            {ex?.stackGroup ? (
                              <Button
                                unstyled
                                className={styles.unstackBtn}
                                onClick={() => unstackExercise(index)}
                                title="Remove from stack"
                              >
                                Unstack
                              </Button>
                            ) : null}
                            <Button
                              unstyled
                              className={styles.moveBtn}
                              onClick={() => handleMoveExercise(index, 'up')}
                              disabled={index === 0}
                            >
                              ↑
                            </Button>
                            <Button
                              unstyled
                              className={styles.moveBtn}
                              onClick={() => handleMoveExercise(index, 'down')}
                              disabled={index === formData.exercises.length - 1}
                            >
                              ↓
                            </Button>
                            <Button
                              unstyled
                              className={styles.removeBtn}
                              onClick={() => handleRemoveExercise(index)}
                            >
                              ✕
                            </Button>
                          </div>
                        </div>

                        <div className={styles.presetRow}>
                          <div className={styles.presetField}>
                            <div className={styles.presetLabel}>Sets</div>
                            <input
                              className={styles.presetInput}
                              inputMode="numeric"
                              value={ex?.sets ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                const n = v === '' ? '' : Math.max(1, Math.min(20, Number(v)))
                                patchExercise(index, { sets: Number.isFinite(n) ? n : '' })
                              }}
                              placeholder="4"
                            />
                          </div>
                          <div className={styles.presetField}>
                            <div className={styles.presetLabel}>Reps (strength)</div>
                            <input
                              className={styles.presetInput}
                              value={ex?.reps ?? ''}
                              onChange={(e) => patchExercise(index, { reps: e.target.value })}
                              placeholder="8-12"
                            />
                          </div>
                          <div className={styles.presetField}>
                            <div className={styles.presetLabel}>Time (cardio)</div>
                            <input
                              className={styles.presetInput}
                              value={ex?.time ?? ''}
                              onChange={(e) => patchExercise(index, { time: e.target.value })}
                              placeholder="20:00"
                            />
                          </div>
                        </div>

                        <div className={styles.presetField}>
                          <div className={styles.presetLabel}>Coach notes</div>
                          <textarea
                            className={styles.presetTextarea}
                            value={ex?.notes ?? ''}
                            onChange={(e) => patchExercise(index, { notes: e.target.value })}
                            placeholder="Cues, tempo, rest targets, substitutions…"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={styles.footer}>
              <Button unstyled className={styles.cancelBtn} onClick={handleCancel}>
                Cancel
              </Button>
              <Button unstyled className={styles.saveBtn} onClick={handleSave}>
                {editingTemplate && templates.find(t => t.id === editingTemplate.id) ? 'Update' : 'Create'} Template
              </Button>
            </div>
          </>
        )}

        {showPicker && (
          <ExercisePicker
            exercises={Array.isArray(allExercises) ? allExercises : []}
            onSelect={handleAddExercise}
            onClose={() => setShowPicker(false)}
          />
        )}

        <ConfirmDialog
          open={deleteConfirm.open}
          title="Delete template?"
          message={deleteConfirm.name ? `Delete "${deleteConfirm.name}"?` : 'Delete this template?'}
          confirmText="Delete"
          cancelText="Cancel"
          destructive
          onCancel={() => setDeleteConfirm({ open: false, id: null, name: '' })}
          onConfirm={() => {
            if (deleteConfirm.id) {
              onDelete(deleteConfirm.id)
            }
            setDeleteConfirm({ open: false, id: null, name: '' })
          }}
        />

        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
      </div>
    </div>
  )
}

