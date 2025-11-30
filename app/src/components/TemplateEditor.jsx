import { useState, useEffect } from 'react'
import { getAllExercises } from '../db'
import ExercisePicker from './ExercisePicker'
import styles from './TemplateEditor.module.css'

export default function TemplateEditor({ templates, onClose, onSave, onDelete, onEdit, editingTemplate: initialEditingTemplate }) {
  const [editingTemplate, setEditingTemplate] = useState(initialEditingTemplate || null)
  const [allExercises, setAllExercises] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    exercises: []
  })

  useEffect(() => {
    async function load() {
      const exercises = await getAllExercises()
      setAllExercises(exercises)
    }
    load()
  }, [])

  useEffect(() => {
    if (initialEditingTemplate) {
      setEditingTemplate(initialEditingTemplate)
      setFormData({
        id: initialEditingTemplate.id,
        name: initialEditingTemplate.name,
        exercises: [...initialEditingTemplate.exercises]
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
        exercises: [...editingTemplate.exercises]
      })
    }
  }, [editingTemplate])

  const handleAddExercise = (exercise) => {
    setFormData(prev => ({
      ...prev,
      exercises: [...prev.exercises, exercise.name]
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

  const handleSave = () => {
    if (!formData.name.trim()) {
      alert('Please enter a template name')
      return
    }
    if (formData.exercises.length === 0) {
      alert('Please add at least one exercise')
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
    setEditingTemplate(null)
    setFormData({
      id: `template-${Date.now()}`,
      name: '',
      exercises: []
    })
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
          <button onClick={onClose}>✕</button>
        </div>
        
        {!editingTemplate ? (
          <div className={styles.templatesList}>
            <button className={styles.newTemplateBtn} onClick={handleNewTemplate}>
              + New Template
            </button>
            {templates.length === 0 ? (
              <p className={styles.emptyText}>No templates yet. Create your first one!</p>
            ) : (
              templates.map(template => (
                <div key={template.id} className={styles.templateCard}>
                  <div className={styles.templateInfo}>
                    <span className={styles.templateCardName}>{template.name}</span>
                    <span className={styles.templateCardCount}>{template.exercises.length} exercises</span>
                  </div>
                  <div className={styles.templateActions}>
                    <button
                      className={styles.editTemplateBtn}
                      onClick={() => {
                        setEditingTemplate(template)
                        if (onEdit) onEdit(template)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.deleteTemplateBtn}
                      onClick={() => {
                        if (confirm(`Delete "${template.name}"?`)) {
                          onDelete(template.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div className={styles.editHeader}>
              <h2>{editingTemplate && templates.find(t => t.id === editingTemplate.id) ? 'Edit Template' : 'New Template'}</h2>
              <button onClick={handleCancel}>← Back</button>
            </div>
            <div className={styles.content}>
              <div className={styles.formGroup}>
                <label>Template Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Push Day, Leg Day"
                />
              </div>

              <div className={styles.exercisesSection}>
                <div className={styles.exercisesHeader}>
                  <label>Exercises</label>
                  <button
                    className={styles.addExerciseBtn}
                    onClick={() => setShowPicker(true)}
                  >
                    + Add Exercise
                  </button>
                </div>
                
                <div className={styles.exercisesList}>
                  {formData.exercises.length === 0 ? (
                    <p className={styles.emptyText}>No exercises added yet</p>
                  ) : (
                    formData.exercises.map((exName, index) => (
                      <div key={index} className={styles.exerciseItem}>
                        <span className={styles.exerciseName}>{exName}</span>
                        <div className={styles.exerciseActions}>
                          <button
                            className={styles.moveBtn}
                            onClick={() => handleMoveExercise(index, 'up')}
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            className={styles.moveBtn}
                            onClick={() => handleMoveExercise(index, 'down')}
                            disabled={index === formData.exercises.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            className={styles.removeBtn}
                            onClick={() => handleRemoveExercise(index)}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={handleCancel}>
                Cancel
              </button>
              <button className={styles.saveBtn} onClick={handleSave}>
                {editingTemplate && templates.find(t => t.id === editingTemplate.id) ? 'Update' : 'Create'} Template
              </button>
            </div>
          </>
        )}

        {showPicker && (
          <ExercisePicker
            onSelect={handleAddExercise}
            onClose={() => setShowPicker(false)}
            allExercises={allExercises}
          />
        )}
      </div>
    </div>
  )
}

