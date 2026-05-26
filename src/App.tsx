import { useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ChatMessage = {
  id: string
  role: 'user' | 'model'
  text: string
  tools?: string[]
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const prompt = input.trim()
    if (!prompt || isSending) {
      return
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: prompt,
    }
    const nextMessages = [...messages, userMessage]

    setMessages(nextMessages)
    setInput('')
    setError('')
    setIsSending(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, text }) => ({ role, text })),
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'The agent could not answer that request.')
      }

      const payload = (await response.json()) as {
        text?: string
        toolRuns?: { name: string }[]
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'model',
          text: payload.text?.trim() || 'I did not receive a text response.',
          tools: payload.toolRuns?.map((toolRun) => toolRun.name),
        },
      ])
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Gemini could not answer that request.'
      setError(message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="chat-start">
      <section className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <h1>Where should we begin?</h1>
        ) : (
          messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <p>{message.text}</p>
            {message.tools?.length ? (
              <span className="tool-chip">Used {message.tools.join(', ')}</span>
            ) : null}
          </article>
        ))
      )}

        {isSending && (
          <article className="message model thinking" aria-label="Gemini is thinking">
            <span></span>
            <span></span>
            <span></span>
          </article>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <form className="composer" aria-label="Chat prompt" onSubmit={handleSubmit}>
        <button className="icon-button add-button" type="button" aria-label="Add">
          <span aria-hidden="true"></span>
        </button>

        <input
          type="text"
          placeholder="Ask anything"
          aria-label="Ask anything"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isSending}
        />

        <div className="actions">
          <button className="icon-button mic-button" type="button" aria-label="Voice input">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14.5a3.4 3.4 0 0 0 3.4-3.4V6.4a3.4 3.4 0 0 0-6.8 0v4.7a3.4 3.4 0 0 0 3.4 3.4Z" />
              <path d="M18.5 11.2a6.5 6.5 0 0 1-13 0" />
              <path d="M12 17.7V21" />
              <path d="M8.7 21h6.6" />
            </svg>
          </button>

          <button className="voice-button" type="submit" aria-label="Send message">
            <span className="bar bar-1" aria-hidden="true"></span>
            <span className="bar bar-2" aria-hidden="true"></span>
            <span className="bar bar-3" aria-hidden="true"></span>
            <span className="bar bar-4" aria-hidden="true"></span>
          </button>
        </div>
      </form>
    </main>
  )
}

export default App
