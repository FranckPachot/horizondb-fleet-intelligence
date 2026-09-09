import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Bot, MapPin, RotateCcw, Send, UserRound, Workflow } from 'lucide-react'
import type { ChatResponse, ExplainPlan, Shipment } from '../types'
import { STATUS_COLORS } from '../shipmentStatus'
import { StatusBadge } from './StatusBadge'

const SUGGESTIONS = [
  'Which delayed shipments need attention?',
  'Find healthcare cargo for clinics',
  'Which shipments are headed to Europe?',
  'Summarize cold-chain risks',
]

interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  text: string
  chatModel?: string
  shipments?: Shipment[]
  explain?: ExplainPlan | null
}

interface ChatPanelProps {
  onSearch: (query: string) => Promise<ChatResponse>
  onSelect: (shipment: Shipment) => void
  onShowExplain: (explain: ExplainPlan) => void
  selectedNumber: string | null
}

const initialMessage: ChatMessage = {
  id: 1,
  role: 'assistant',
  text: 'Ask about cargo, routes, regions, or operational risk. I will choose and run the HorizonDB shipment tool.',
}

export function ChatPanel({
  onSearch,
  onSelect,
  onShowExplain,
  selectedNumber,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage])
  const [input, setInput] = useState('')
  const [searching, setSearching] = useState(false)
  const messageEnd = useRef<HTMLDivElement>(null)
  const latestAgentResult = useRef<HTMLDivElement>(null)
  const nextMessageId = useRef(2)

  useEffect(() => {
    if (messages.at(-1)?.chatModel) {
      latestAgentResult.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
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
          shipments: result.shipments,
          explain: result.explain,
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
              {message.chatModel ? (
                <div
                  className="agent-result-block"
                  ref={messageIndex === messages.length - 1 ? latestAgentResult : undefined}
                >
                  <div className="answer-meta">
                    <span className="answer-engine">
                      {message.chatModel} · Agent Framework · PostGIS + SQ4 DiskANN
                    </span>
                    {message.explain ? (
                      <button
                        type="button"
                        className="agent-query-button"
                        onClick={() => onShowExplain(message.explain as ExplainPlan)}
                      >
                        <Workflow size={12} aria-hidden="true" />
                        Query + plan
                      </button>
                    ) : null}
                  </div>
                  {message.shipments?.length ? (
                    <div
                      className="agent-result-list"
                      aria-label={`${message.shipments.length} shipment matches`}
                    >
                      {message.shipments.map((shipment) => (
                        <button
                          className={`agent-result-card ${
                            selectedNumber === shipment.shipment_number ? 'selected' : ''
                          }`}
                          type="button"
                          key={shipment.id}
                          title={`Show ${shipment.shipment_number} on the map`}
                          onClick={() => onSelect(shipment)}
                        >
                          <span className="agent-result-topline">
                            <span className="agent-result-number">
                              <i
                                style={{ backgroundColor: STATUS_COLORS[shipment.status] }}
                                aria-hidden="true"
                              />
                              {shipment.shipment_number}
                            </span>
                            {shipment.similarity !== null ? (
                              <span
                                className="similarity-mini"
                                title="Cosine similarity, not a probability"
                              >
                                cos {shipment.similarity.toFixed(2)}
                              </span>
                            ) : null}
                          </span>
                          <strong>{shipment.title}</strong>
                          <span className="agent-result-route">
                            <MapPin size={11} aria-hidden="true" />
                            <span>{shipment.current_location_name}</span>
                            <ArrowRight size={11} aria-hidden="true" />
                            <span>{shipment.destination_name}</span>
                          </span>
                          <span className="agent-result-footer">
                            <StatusBadge status={shipment.status} compact />
                            {shipment.distance_km !== null ? (
                              <small>{shipment.distance_km.toLocaleString()} km</small>
                            ) : shipment.hybrid_score !== null ? (
                              <small>hybrid {shipment.hybrid_score.toFixed(2)}</small>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

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