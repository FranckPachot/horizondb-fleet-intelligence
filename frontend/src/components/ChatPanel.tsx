import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Bot, CalendarDays, MapPinned, RefreshCw, RotateCcw, Send, UserRound, X } from 'lucide-react'
import type { Coordinate, SearchResponse } from '../types'
import type { ShipmentStatus } from '../types'
import { STATUS_COLORS, STATUS_LABELS } from '../shipmentStatus'

const SUGGESTIONS = [
  'Show medical supplies for clinics',
  'Find delayed electronics from Asia',
  'Which shipments are going to Europe?',
  'Show cold-chain food and medicine',
]

interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  text: string
  chatModel?: string
}

interface ChatPanelProps {
  onSearch: (query: string) => Promise<SearchResponse>
  onShowAll: () => void
  searchCenter: Coordinate | null
  searchRadiusKm: number
  onSearchRadiusChange: (radiusKm: number) => void
  onClearSearchCenter: () => void
  status: ShipmentStatus | 'all'
  onStatusChange: (status: ShipmentStatus | 'all') => void
  etaDate: string | null
  etaDays: number
  onEtaDateChange: (date: string | null) => void
  onEtaDaysChange: (days: number) => void
}

const initialMessage: ChatMessage = {
  id: 1,
  role: 'assistant',
  text: 'Ask about cargo, routes, regions, or status. Click the map to combine a PostGIS radius with DiskANN semantic search.',
}

export function ChatPanel({
  onSearch,
  onShowAll,
  searchCenter,
  searchRadiusKm,
  onSearchRadiusChange,
  onClearSearchCenter,
  status,
  onStatusChange,
  etaDate,
  etaDays,
  onEtaDateChange,
  onEtaDaysChange,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage])
  const [input, setInput] = useState('')
  const [lastQuery, setLastQuery] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const messageEnd = useRef<HTMLDivElement>(null)
  const nextMessageId = useRef(2)
  const statusColor = status === 'all' ? '#758496' : STATUS_COLORS[status]

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, searching])

  async function submitQuery(query: string) {
    const normalized = query.trim()
    if (normalized.length < 2 || searching) return

    const userMessage: ChatMessage = {
      id: nextMessageId.current++,
      role: 'user',
      text: normalized,
    }
    setMessages((current) => [...current, userMessage])
    setLastQuery(normalized)
    setInput('')
    setSearching(true)

    try {
      const result = await onSearch(normalized)
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId.current++,
          role: 'assistant',
          text: result.answer,
          chatModel: result.chat_model,
        },
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId.current++,
          role: 'assistant',
          text:
            error instanceof Error
              ? `Search failed: ${error.message}`
              : 'Search failed. Please try again.',
        },
      ])
    } finally {
      setSearching(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitQuery(input)
  }

  function resetChat() {
    setMessages([initialMessage])
    setInput('')
    setLastQuery(null)
    onShowAll()
  }

  return (
    <aside className="chat-panel workspace-panel" aria-label="Semantic shipment search">
      <div className="panel-heading chat-heading">
        <div>
          <span className="eyebrow">Agent with tools</span>
          <h2>Shipment assistant</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Reset conversation"
          aria-label="Reset conversation"
          onClick={resetChat}
        >
          <RotateCcw size={17} />
        </button>
      </div>

      <div className="search-scope-control">
        <div className="search-scope-heading">
          <span>
            <strong>Search scope</strong>
            <small>Applied to the next message</small>
          </span>
          <button
            className="rerun-button"
            type="button"
            title="Rerun last prompt with current scope"
            aria-label="Rerun last prompt with current filters"
            disabled={!lastQuery || searching}
            onClick={() => lastQuery && void submitQuery(lastQuery)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <label className="agent-status-field">
          <span><i style={{ backgroundColor: statusColor }} />Status</span>
          <select
            value={status}
            style={{ borderColor: statusColor, color: statusColor }}
            onChange={(event) =>
              onStatusChange(event.target.value as ShipmentStatus | 'all')
            }
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option value={value} key={value} style={{ color: STATUS_COLORS[value as ShipmentStatus] }}>{label}</option>
            ))}
          </select>
        </label>
        <label className="eta-field">
          <span><CalendarDays size={13} />ETA</span>
          <span className="eta-inputs">
            <input
              type="date"
              value={etaDate ?? ''}
              onChange={(event) => onEtaDateChange(event.target.value || null)}
            />
            <b>±</b>
            <input
              type="number"
              min="0"
              max="365"
              value={etaDays}
              disabled={!etaDate}
              aria-label="ETA tolerance in days"
              onChange={(event) => onEtaDaysChange(Number(event.target.value))}
            />
            <small>days</small>
            {etaDate ? (
              <button
                type="button"
                title="Clear ETA filter"
                aria-label="Clear ETA filter"
                onClick={() => onEtaDateChange(null)}
              >
                <X size={13} />
              </button>
            ) : null}
          </span>
        </label>
        <div className="spatial-search-status">
          <MapPinned size={15} aria-hidden="true" />
          <span>
            <b>{searchCenter ? 'Spatial filter active' : 'Click map for radius search'}</b>
            {searchCenter ? (
              <small>
                {searchCenter.latitude.toFixed(2)}, {searchCenter.longitude.toFixed(2)}
              </small>
            ) : null}
          </span>
          {searchCenter ? (
            <button type="button" onClick={onClearSearchCenter}>Clear</button>
          ) : null}
        </div>
        <label className={`radius-field ${searchCenter ? '' : 'disabled'}`}>
          <span>Radius <b>{searchRadiusKm.toLocaleString()} km</b></span>
          <input
            type="range"
            min="50"
            max="3000"
            step="50"
            value={searchRadiusKm}
            disabled={!searchCenter}
            onChange={(event) => onSearchRadiusChange(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="chat-messages" aria-live="polite">
        {messages.map((message, messageIndex) => (
          <div className={`chat-turn ${message.role}`} key={message.id}>
            <span className="chat-avatar" aria-hidden="true">
              {message.role === 'assistant' ? (
                <Bot size={17} />
              ) : (
                <UserRound size={17} />
              )}
            </span>
            <div className="chat-turn-content">
              <p>{message.text}</p>
              {messageIndex === 0 ? (
                <div className="suggestion-list">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => void submitQuery(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}

              {message.chatModel ? (
                <span className="answer-engine">
                  {message.chatModel} · grounded by PostGIS + SQ DiskANN
                </span>
              ) : null}
            </div>
          </div>
        ))}

        {searching ? (
          <div className="chat-turn assistant searching-turn">
            <span className="chat-avatar" aria-hidden="true">
              <Bot size={17} />
            </span>
            <div className="typing-indicator" aria-label="Searching">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
        <div ref={messageEnd} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <label>
          <span className="sr-only">Ask about shipments</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about shipments"
            maxLength={300}
            disabled={searching}
          />
        </label>
        <button
          type="submit"
          aria-label="Send message"
          title="Send"
          disabled={input.trim().length < 2 || searching}
        >
          <Send size={17} />
        </button>
      </form>
    </aside>
  )
}