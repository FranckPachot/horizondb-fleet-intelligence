import { Check, Copy, FileText, GitFork, Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ExplainPlan } from '../types'

interface ExplainPlanModalProps {
  explain: ExplainPlan | null
  loading: boolean
  error: string | null
  onClose: () => void
}

interface PlanNode {
  id: number
  operation: string
  indexName: string | null
  kind: 'default' | 'combine' | 'index' | 'diskann'
  estimatedRows: string | null
  actualRows: string | null
  actualTime: string | null
  details: string[]
  children: PlanNode[]
}

type SqlInputKind = 'prompt' | 'status' | 'eta' | 'point' | 'radius'

interface SqlInputRange {
  start: number
  end: number
  kind: SqlInputKind
}

function inputRanges(query: string): SqlInputRange[] {
  const ranges: SqlInputRange[] = []
  const addCapture = (pattern: RegExp, kind: SqlInputKind, captures = [1]) => {
    for (const match of query.matchAll(pattern)) {
      for (const capture of captures) {
        const value = match[capture]
        if (!value || value === 'NULL') continue
        const relativeOffset = match[0].indexOf(value)
        ranges.push({
          start: match.index + relativeOffset,
          end: match.index + relativeOffset + value.length,
          kind,
        })
      }
    }
  }

  addCapture(
    /azure_openai\.create_embeddings\(\s*'(?:''|[^'])*',\s*('(?:''|[^'])*')/g,
    'prompt',
  )
  addCapture(/s\.status\s*=\s*('(?:''|[^'])*'|NULL)/gi, 'status')
  addCapture(/('(?:\d{4}-\d{2}-\d{2})'(?:::\w+)+)/g, 'eta')
  addCapture(/\((\d+)\s*\*\s*INTERVAL\s+'1 day'\)/g, 'eta')
  addCapture(
    /ST_MakePoint\(\s*(NULL|-?\d+(?:\.\d+)?),\s*(NULL|-?\d+(?:\.\d+)?)\s*\)/g,
    'point',
    [1, 2],
  )
  addCapture(/\b(NULL|\d+(?:\.\d+)?)\s*\*\s*1000\.0/g, 'radius')
  addCapture(/distance_km\s*\/\s*(NULL|\d+(?:\.\d+)?)/g, 'radius')

  return ranges
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((range, index, sorted) => index === 0 || range.start >= sorted[index - 1].end)
}

function HighlightedQuery({ query }: { query: string }) {
  const labels: Record<SqlInputKind, string> = {
    prompt: 'Prompt',
    status: 'Status',
    eta: 'ETA window',
    point: 'Search point',
    radius: 'Radius',
  }
  const ranges = inputRanges(query)
  const content: ReactNode[] = []
  let offset = 0

  for (const range of ranges) {
    content.push(query.slice(offset, range.start))
    content.push(
      <mark
        className={`sql-input sql-input-${range.kind}`}
        title={labels[range.kind]}
        key={`${range.start}-${range.kind}`}
      >
        {query.slice(range.start, range.end)}
      </mark>,
    )
    offset = range.end
  }
  content.push(query.slice(offset))

  return <pre className="query-output">{content}</pre>
}

function parsePlan(plan: string): PlanNode[] {
  const roots: PlanNode[] = []
  const stack: Array<{ indent: number; node: PlanNode }> = []
  let nextId = 1

  for (const line of plan.split('\n')) {
    const costOffset = line.indexOf('(cost=')
    if (costOffset >= 0) {
      const indent = line.search(/\S/)
      const rawOperation = line.slice(0, costOffset).trim().replace(/^->\s*/, '')
      const indexName = rawOperation.match(
        /(?:Bitmap Index Scan|Index Only Scan|Index Scan) on ([^\s(]+)/,
      )?.[1] ?? null
      const operation = indexName
        ? rawOperation.replace(` on ${indexName}`, '')
        : rawOperation
      const estimatedRows = line.match(/cost=[\d.]+\.\.[\d.]+ rows=(\d+)/)?.[1] ?? null
      const actual = line.match(/actual time=([\d.]+)\.\.([\d.]+) rows=(\d+)/)
      const node: PlanNode = {
        id: nextId++,
        operation,
        indexName,
        kind: operation.includes('DiskANNFilteredScan')
          ? 'diskann'
          : indexName
            ? 'index'
            : operation === 'BitmapAnd' || operation === 'BitmapOr'
              ? 'combine'
              : 'default',
        estimatedRows,
        actualRows: actual?.[3] ?? null,
        actualTime: actual?.[2] ?? null,
        details: [],
        children: [],
      }

      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
      const parent = stack.at(-1)?.node
      if (parent) parent.children.push(node)
      else roots.push(node)
      stack.push({ indent, node })
      continue
    }

    const detail = line.trim()
    if (
      stack.length
      && /^(Index Cond|Recheck Cond|Filter|Strategy|TIDs Collected|Rows Removed by Filter):/.test(detail)
    ) {
      stack.at(-1)!.node.details.push(detail)
    }
  }

  return roots
}

function PlanTreeNode({ node }: { node: PlanNode }) {
  return (
    <div className="plan-tree-branch">
      <article className={`plan-node plan-node-${node.kind}`}>
        <div className="plan-node-heading">
          <strong>{node.operation}</strong>
          {node.indexName ? <code>{node.indexName}</code> : null}
        </div>
        <div className="plan-node-metrics">
          {node.actualRows ? <span><b>{node.actualRows}</b> rows</span> : null}
          {node.estimatedRows ? <span><b>{node.estimatedRows}</b> estimated</span> : null}
          {node.actualTime ? <span><b>{node.actualTime}</b> ms</span> : null}
        </div>
        {node.details.length ? (
          <div className="plan-node-details">
            {node.details.map((detail) => {
              const separator = detail.indexOf(':')
              return (
                <div key={detail}>
                  <b>{detail.slice(0, separator)}</b>
                  <code>{detail.slice(separator + 1).trim()}</code>
                </div>
              )
            })}
          </div>
        ) : null}
      </article>
      {node.children.length ? (
        <div className="plan-tree-children">
          {node.children.map((child) => <PlanTreeNode node={child} key={child.id} />)}
        </div>
      ) : null}
    </div>
  )
}

function PlanGraph({ plan }: { plan: string }) {
  const roots = parsePlan(plan)
  return (
    <div className="plan-graph">
      <div className="plan-graph-legend">
        <span className="diskann">DiskANN</span>
        <span className="index">Index</span>
        <span className="combine">Combination</span>
      </div>
      {roots.map((root) => <PlanTreeNode node={root} key={root.id} />)}
    </div>
  )
}

function HighlightedPlan({ plan }: { plan: string }) {
  return (
    <pre className="plan-output">
      {plan.split('\n').map((line, index) => {
        const indexScan = line.match(
          /^(.*?)(Bitmap Index Scan|Index Only Scan|Index Scan)( on )([^\s(]+)(.*)$/,
        )
        if (indexScan) {
          return (
            <span className="plan-line plan-index-scan" key={index}>
              {indexScan[1]}
              <mark className="plan-operation">{indexScan[2]}</mark>
              {indexScan[3]}
              <mark className="plan-index-name">{indexScan[4]}</mark>
              {indexScan[5] || ' '}
            </span>
          )
        }

        const diskannOffset = line.indexOf('DiskANNFilteredScan')
        if (diskannOffset >= 0) {
          return (
            <span className="plan-line plan-diskann-scan" key={index}>
              {line.slice(0, diskannOffset)}
              <mark className="plan-diskann-name">DiskANNFilteredScan</mark>
              {line.slice(diskannOffset + 'DiskANNFilteredScan'.length) || ' '}
            </span>
          )
        }

        const diskannDetail = line.match(/^(\s*)(Strategy:|TIDs Collected:)(.*)$/)
        if (diskannDetail) {
          const detailClass = diskannDetail[2] === 'Strategy:'
            ? 'plan-diskann-strategy'
            : 'plan-diskann-tids'
          return (
            <span className={`plan-line ${detailClass}`} key={index}>
              {diskannDetail[1]}
              <mark>{diskannDetail[2]}</mark>
              {diskannDetail[3] || ' '}
            </span>
          )
        }

        return (
          <span
            className={`plan-line ${line.includes('Index Cond:') ? 'plan-index-cond' : ''}`}
            key={index}
          >
            {line || ' '}
          </span>
        )
      })}
    </pre>
  )
}

export function ExplainPlanModal({
  explain,
  loading,
  error,
  onClose,
}: ExplainPlanModalProps) {
  const [copied, setCopied] = useState<'query' | 'plan' | null>(null)
  const [planView, setPlanView] = useState<'text' | 'graph'>('graph')
  const [queryPaneWidth, setQueryPaneWidth] = useState(40)
  const contentRef = useRef<HTMLDivElement>(null)
  const draggingPane = useRef(false)

  function resizePanes(clientX: number) {
    const bounds = contentRef.current?.getBoundingClientRect()
    if (!bounds) return
    const percentage = ((clientX - bounds.left) / bounds.width) * 100
    setQueryPaneWidth(Math.min(70, Math.max(25, percentage)))
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function copy(value: string, target: 'query' | 'plan') {
    await navigator.clipboard.writeText(value)
    setCopied(target)
    window.setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className="explain-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="explain-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explain-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="explain-header">
          <div>
            <span className="explain-mark" aria-hidden="true"><Workflow size={18} /></span>
            <span>
              <strong id="explain-title">Last execution plan</strong>
              <small>
                {explain
                  ? new Date(explain.captured_at).toLocaleString()
                  : 'No captured query'}
              </small>
            </span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close" aria-label="Close execution plan">
            <X size={18} />
          </button>
        </header>

        {loading ? <div className="explain-state">Loading execution plan...</div> : null}
        {error ? <div className="explain-state error" role="alert">{error}</div> : null}
        {!loading && !error && !explain ? (
          <div className="explain-state">Run a database query to capture its execution plan.</div>
        ) : null}

        {explain ? (
          <div
            className="explain-content"
            ref={contentRef}
            style={{ '--query-pane-width': `${queryPaneWidth}%` } as CSSProperties}
          >
            <section>
              <div className="explain-section-heading">
                <strong>Query with literals</strong>
                <button type="button" title="Copy query" aria-label="Copy query" onClick={() => void copy(explain.query, 'query')}>
                  {copied === 'query' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <HighlightedQuery query={explain.query} />
            </section>
            <div
              className="pane-resizer"
              role="separator"
              aria-label="Resize query and plan panes"
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={70}
              aria-valuenow={Math.round(queryPaneWidth)}
              tabIndex={0}
              onPointerDown={(event) => {
                draggingPane.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                resizePanes(event.clientX)
              }}
              onPointerMove={(event) => {
                if (draggingPane.current) resizePanes(event.clientX)
              }}
              onPointerUp={(event) => {
                draggingPane.current = false
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setQueryPaneWidth((width) => Math.max(25, width - 2))
                }
                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  setQueryPaneWidth((width) => Math.min(70, width + 2))
                }
              }}
            >
              <span />
            </div>
            <section>
              <div className="explain-section-heading">
                <strong>EXPLAIN ANALYZE · BUFFERS · WAL</strong>
                <div className="plan-view-actions">
                  <div className="plan-view-tabs" role="tablist" aria-label="Execution plan view">
                    <button type="button" role="tab" aria-selected={planView === 'text'} onClick={() => setPlanView('text')}>
                      <FileText size={13} /> Text
                    </button>
                    <button type="button" role="tab" aria-selected={planView === 'graph'} onClick={() => setPlanView('graph')}>
                      <GitFork size={13} /> Graph
                    </button>
                  </div>
                  <button type="button" title="Copy plan" aria-label="Copy plan" onClick={() => void copy(explain.plan, 'plan')}>
                    {copied === 'plan' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              {planView === 'text'
                ? <HighlightedPlan plan={explain.plan} />
                : <PlanGraph plan={explain.plan} />}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  )
}