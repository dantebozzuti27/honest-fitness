import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import { requireSupabase } from '../lib/supabase'
import { ROUTES } from '../utils/appRoutes'
import styles from './OntologyDashboard.module.css'

type CountMap = Record<string, number>

type EntityCard = {
  id: string
  title: string
  table: string
  pk: string
  description: string
  relations: string[]
}

type RelationEdgeDef = {
  id: string
  source: string
  target: string
  fk: string
  cardinality: string
  label: string
}

type OntologyNodeData = {
  title: string
  table: string
  count: number
}

const ENTITY_CARDS: EntityCard[] = [
  {
    id: 'user_profile',
    title: 'UserProfile',
    table: 'user_preferences',
    pk: 'user_id',
    description: 'User goals, constraints, and session defaults.',
    relations: ['1 -> N WorkoutPlanVersion', '1 -> N GeneratedWorkout', '1 -> N WorkoutSession'],
  },
  {
    id: 'plan_version',
    title: 'WorkoutPlanVersion',
    table: 'weekly_plans',
    pk: 'id',
    description: 'Versioned weekly plans. Exactly one active plan per week.',
    relations: ['N -> 1 UserProfile', '1 -> N WorkoutPlanDay'],
  },
  {
    id: 'plan_day',
    title: 'WorkoutPlanDay',
    table: 'weekly_plan_days',
    pk: 'id',
    description: 'Per-day state machine: planned -> adapted -> completed/skipped.',
    relations: ['N -> 1 WorkoutPlanVersion', '0..1 -> 1 WorkoutSession (actual_workout_id)'],
  },
  {
    id: 'generated_workout',
    title: 'GeneratedWorkout',
    table: 'generated_workouts',
    pk: 'id (uuid)',
    description: 'Canonical generated payload with lineage across planning and execution.',
    relations: ['N -> 1 UserProfile', '1 -> N WorkoutOutcomeEvent', '1 -> N ExerciseExecutionEvent'],
  },
  {
    id: 'workout_session',
    title: 'WorkoutSession',
    table: 'workouts',
    pk: 'id',
    description: 'Executed session and observed metrics. May reference generated workout lineage.',
    relations: ['N -> 1 UserProfile', 'N -> 1 GeneratedWorkout (generated_workout_id)'],
  },
  {
    id: 'outcome_event',
    title: 'WorkoutOutcomeEvent',
    table: 'workout_outcomes',
    pk: 'id',
    description: 'Outcome and quality signals with idempotency protection.',
    relations: ['N -> 1 UserProfile', 'N -> 1 GeneratedWorkout'],
  },
  {
    id: 'execution_event',
    title: 'ExerciseExecutionEvent',
    table: 'prescription_execution_events',
    pk: 'id / event_id',
    description: 'Set-level execution data with strict idempotency keys.',
    relations: ['N -> 1 UserProfile', 'N -> 1 WorkoutSession', 'N -> 1 GeneratedWorkout'],
  },
  {
    id: 'feedback',
    title: 'ModelFeedback',
    table: 'model_feedback',
    pk: 'id',
    description: 'LLM pattern observations that influence future generation.',
    relations: ['N -> 1 UserProfile', 'N -> 0..1 WorkoutSession (workout_date)'],
  },
]

const RELATIONSHIP_FLOW = [
  'UserProfile -> WorkoutPlanVersion -> WorkoutPlanDay',
  'WorkoutPlanDay.planned_workout -> GeneratedWorkout',
  'GeneratedWorkout -> WorkoutSession (via workouts.generated_workout_id)',
  'WorkoutSession -> WorkoutOutcomeEvent',
  'WorkoutSession + GeneratedWorkout -> ExerciseExecutionEvent',
  'LLM validation -> ModelFeedback -> next TrainingProfile -> next GeneratedWorkout',
]

const RELATION_EDGES: RelationEdgeDef[] = [
  {
    id: 'e-user-plan',
    source: 'user_profile',
    target: 'plan_version',
    fk: 'weekly_plans.user_id',
    cardinality: '1 -> N',
    label: 'owns weekly plans',
  },
  {
    id: 'e-plan-day',
    source: 'plan_version',
    target: 'plan_day',
    fk: 'weekly_plan_days.weekly_plan_id',
    cardinality: '1 -> N',
    label: 'contains days',
  },
  {
    id: 'e-user-generated',
    source: 'user_profile',
    target: 'generated_workout',
    fk: 'generated_workouts.user_id',
    cardinality: '1 -> N',
    label: 'generation lineage',
  },
  {
    id: 'e-day-workout',
    source: 'plan_day',
    target: 'workout_session',
    fk: 'weekly_plan_days.actual_workout_id',
    cardinality: '0..1 -> 1',
    label: 'actual execution',
  },
  {
    id: 'e-generated-session',
    source: 'generated_workout',
    target: 'workout_session',
    fk: 'workouts.generated_workout_id',
    cardinality: '1 -> N',
    label: 'planned -> performed',
  },
  {
    id: 'e-session-outcome',
    source: 'workout_session',
    target: 'outcome_event',
    fk: 'workout_outcomes.generated_workout_id/user_id',
    cardinality: '1 -> N',
    label: 'session outcomes',
  },
  {
    id: 'e-generated-outcome',
    source: 'generated_workout',
    target: 'outcome_event',
    fk: 'workout_outcomes.generated_workout_id',
    cardinality: '1 -> N',
    label: 'outcome lineage',
  },
  {
    id: 'e-session-exec',
    source: 'workout_session',
    target: 'execution_event',
    fk: 'prescription_execution_events.workout_id',
    cardinality: '1 -> N',
    label: 'set execution',
  },
  {
    id: 'e-generated-exec',
    source: 'generated_workout',
    target: 'execution_event',
    fk: 'prescription_execution_events.generated_workout_id',
    cardinality: '1 -> N',
    label: 'prescription lineage',
  },
  {
    id: 'e-user-feedback',
    source: 'user_profile',
    target: 'feedback',
    fk: 'model_feedback.user_id',
    cardinality: '1 -> N',
    label: 'llm feedback',
  },
]

const NODE_LAYOUT: Record<string, { x: number; y: number }> = {
  user_profile: { x: 0, y: 210 },
  plan_version: { x: 280, y: 60 },
  plan_day: { x: 560, y: 60 },
  generated_workout: { x: 280, y: 350 },
  workout_session: { x: 560, y: 350 },
  outcome_event: { x: 840, y: 270 },
  execution_event: { x: 840, y: 420 },
  feedback: { x: 280, y: 520 },
}

const EntityNode = memo(({ data, selected }: NodeProps & { data: OntologyNodeData }) => {
  return (
    <div className={`${styles.flowNode} ${selected ? styles.flowNodeSelected : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.flowHandle} />
      <div className={styles.flowNodeTitle}>{data.title}</div>
      <div className={styles.flowNodeMeta}>{data.table}</div>
      <div className={styles.flowNodeCount}>{data.count} rows</div>
      <Handle type="source" position={Position.Right} className={styles.flowHandle} />
    </div>
  )
})

const nodeTypes = { ontology: EntityNode }

async function countRowsForUser(userId: string, table: string): Promise<number> {
  const supabase = requireSupabase()
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return 0
  return Number(count || 0)
}

export default function OntologyDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [counts, setCounts] = useState<CountMap>({})
  const [loading, setLoading] = useState(true)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!user?.id) return
      setLoading(true)
      const next: CountMap = {}
      for (const e of ENTITY_CARDS) {
        next[e.table] = await countRowsForUser(user.id, e.table)
      }
      if (!cancelled) {
        setCounts(next)
        setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [user?.id])

  const totalRows = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts]
  )

  const nodes: Node[] = useMemo(() => {
    return ENTITY_CARDS.map((entity) => ({
      id: entity.id,
      type: 'ontology',
      position: NODE_LAYOUT[entity.id],
      data: {
        title: entity.title,
        table: entity.table,
        count: loading ? 0 : counts[entity.table] ?? 0,
      } as OntologyNodeData,
      draggable: false,
    }))
  }, [counts, loading])

  const edges: Edge[] = useMemo(() => {
    return RELATION_EDGES.map((edge) => {
      const active = !!selectedEntityId && (selectedEntityId === edge.source || selectedEntityId === edge.target)
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.cardinality,
        markerEnd: { type: MarkerType.ArrowClosed, color: active ? '#2dd4bf' : '#52525b' },
        style: {
          stroke: active ? '#2dd4bf' : '#52525b',
          strokeWidth: active ? 2.5 : 1.5,
          opacity: selectedEntityId ? (active ? 1 : 0.25) : 0.9,
        },
        labelStyle: { fill: active ? '#99f6e4' : '#a1a1aa', fontSize: 10 },
        animated: active,
      }
    })
  }, [selectedEntityId])

  const selectedEntity = useMemo(
    () => ENTITY_CARDS.find((e) => e.id === selectedEntityId) ?? null,
    [selectedEntityId]
  )

  const selectedInbound = useMemo(
    () => RELATION_EDGES.filter((e) => e.target === selectedEntityId),
    [selectedEntityId]
  )
  const selectedOutbound = useMemo(
    () => RELATION_EDGES.filter((e) => e.source === selectedEntityId),
    [selectedEntityId]
  )

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedEntityId(node.id)
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <BackButton />
        <h1 className={styles.title}>Ontology Dashboard</h1>
      </div>

      <div className={styles.content}>
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>System Graph</h2>
          <p className={styles.body}>
            This view explains how planning, generation, execution, and feedback are linked.
            It is the contract-level map for lineage and idempotency.
          </p>
          <div className={styles.flowList}>
            {RELATIONSHIP_FLOW.map((edge) => (
              <div key={edge} className={styles.flowItem}>{edge}</div>
            ))}
          </div>
          <div className={styles.meta}>
            {loading ? 'Loading counts...' : `Tracked rows across ontology tables: ${totalRows}`}
          </div>
          <div className={styles.flowWrap}>
            <div className={styles.flowCanvas}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                onNodeClick={onNodeClick}
                onPaneClick={() => setSelectedEntityId(null)}
                nodesConnectable={false}
                elementsSelectable
                proOptions={{ hideAttribution: true }}
                minZoom={0.5}
                maxZoom={1.7}
              >
                <Background gap={22} size={1} color="#2a2a2a" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            <aside className={styles.flowPanel}>
              {!selectedEntity ? (
                <div className={styles.flowHint}>
                  Select a node to inspect its incoming/outgoing relationships and foreign-key path.
                </div>
              ) : (
                <>
                  <h3 className={styles.panelTitle}>{selectedEntity.title}</h3>
                  <div className={styles.entityMeta}>table: {selectedEntity.table}</div>
                  <div className={styles.entityMeta}>pk: {selectedEntity.pk}</div>
                  <div className={styles.entityMeta}>rows: {loading ? '...' : counts[selectedEntity.table] ?? 0}</div>
                  <p className={styles.entityDesc}>{selectedEntity.description}</p>

                  <div className={styles.relationTitle}>Inbound</div>
                  <ul className={styles.relations}>
                    {selectedInbound.length === 0 && <li>None</li>}
                    {selectedInbound.map((edge) => (
                      <li key={edge.id}>
                        {edge.source} {'->'} {edge.target} ({edge.cardinality}) via {edge.fk}
                      </li>
                    ))}
                  </ul>

                  <div className={styles.relationTitle}>Outbound</div>
                  <ul className={styles.relations}>
                    {selectedOutbound.length === 0 && <li>None</li>}
                    {selectedOutbound.map((edge) => (
                      <li key={edge.id}>
                        {edge.source} {'->'} {edge.target} ({edge.cardinality}) via {edge.fk}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>
        </section>

        <section className={styles.grid}>
          {ENTITY_CARDS.map((entity) => (
            <article key={entity.id} className={styles.entityCard}>
              <div className={styles.entityTop}>
                <h3 className={styles.entityTitle}>{entity.title}</h3>
                <span className={styles.entityCount}>
                  {loading ? '...' : counts[entity.table] ?? 0}
                </span>
              </div>
              <div className={styles.entityMeta}>table: {entity.table}</div>
              <div className={styles.entityMeta}>pk: {entity.pk}</div>
              <p className={styles.entityDesc}>{entity.description}</p>
              <div className={styles.relationTitle}>Relationships</div>
              <ul className={styles.relations}>
                {entity.relations.map((relation) => (
                  <li key={relation}>{relation}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Debug Paths</h2>
          <p className={styles.body}>
            Use these to inspect behavior from different abstraction layers.
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => navigate(ROUTES.model)}>
              Open ML Pipeline Dashboard
            </Button>
            <Button variant="secondary" onClick={() => navigate(ROUTES.today)}>
              Open Today Workout
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
