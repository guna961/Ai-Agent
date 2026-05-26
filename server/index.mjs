import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { ChatGoogle } from '@langchain/google'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const app = express()
const port = Number(process.env.AGENT_PORT || 8787)
const apiKey = process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY

app.use(cors())
app.use(express.json({ limit: '1mb' }))

const calculatorTool = tool(
  ({ expression }) => {
    if (!/^[\d\s+\-*/().,%]+$/.test(expression)) {
      return 'The calculator only accepts numbers and arithmetic operators.'
    }

    const normalizedExpression = expression.replaceAll('%', '/100')
    const result = Function(`"use strict"; return (${normalizedExpression})`)()

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return 'The calculator could not produce a finite number.'
    }

    return `${expression} = ${result}`
  },
  {
    name: 'calculator',
    description: 'Evaluate arithmetic expressions. Use for math, percentages, and numeric calculations.',
    schema: z.object({
      expression: z.string().describe('A safe arithmetic expression, such as "(128 * 4) / 2".'),
    }),
  },
)

const currentTimeTool = tool(
  ({ timeZone }) => {
    const date = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    })

    return formatter.format(date)
  },
  {
    name: 'current_time',
    description: 'Get the current date and time for a specific IANA time zone.',
    schema: z.object({
      timeZone: z.string().describe('An IANA time zone like "Asia/Kolkata" or "America/New_York".'),
    }),
  },
)

const textStatsTool = tool(
  ({ text }) => {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean)

    return JSON.stringify({
      characters: text.length,
      words: words.length,
      sentences: sentences.length,
    })
  },
  {
    name: 'text_stats',
    description: 'Count characters, words, and sentences in a piece of text.',
    schema: z.object({
      text: z.string().describe('The text to analyze.'),
    }),
  },
)

const tools = [calculatorTool, currentTimeTool, textStatsTool]
const toolsByName = Object.fromEntries(tools.map((agentTool) => [agentTool.name, agentTool]))

function createModel() {
  if (!apiKey) {
    return null
  }

  return new ChatGoogle({
    apiKey,
    model: 'gemini-2.5-flash',
    temperature: 0.4,
    maxRetries: 2,
  }).bindTools(tools)
}

function toLangChainMessages(messages = []) {
  return messages
    .filter((message) => typeof message?.text === 'string' && message.text.trim())
    .slice(-12)
    .map((message) => {
      if (message.role === 'model') {
        return new AIMessage(message.text)
      }

      return new HumanMessage(message.text)
    })
}

function getTextContent(message) {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim()
  }

  return ''
}

async function runAgent({ messages }) {
  const model = createModel()

  if (!model) {
    throw new Error('Missing GOOGLE_API_KEY or VITE_GEMINI_API_KEY in .env.')
  }

  const conversation = [
    new SystemMessage(
      [
        'You are a helpful AI agent in a minimal chat app.',
        'Use tools whenever they make the answer more accurate.',
        'Available tools: calculator, current_time, text_stats.',
        'When you use a tool, explain the useful result naturally.',
      ].join(' '),
    ),
    ...toLangChainMessages(messages),
  ]
  const toolRuns = []

  for (let step = 0; step < 4; step += 1) {
    const response = await model.invoke(conversation)
    conversation.push(response)

    if (!response.tool_calls?.length) {
      return {
        text: getTextContent(response) || 'I completed the request, but did not receive text output.',
        toolRuns,
      }
    }

    for (const toolCall of response.tool_calls) {
      const selectedTool = toolsByName[toolCall.name]

      if (!selectedTool) {
        conversation.push(
          new ToolMessage({
            content: `Tool "${toolCall.name}" is not available.`,
            name: toolCall.name,
            tool_call_id: toolCall.id || toolCall.name,
            status: 'error',
          }),
        )
        continue
      }

      const result = await selectedTool.invoke(toolCall.args)
      toolRuns.push({ name: toolCall.name, input: toolCall.args, output: String(result) })
      conversation.push(
        new ToolMessage({
          content: String(result),
          name: toolCall.name,
          tool_call_id: toolCall.id || toolCall.name,
          status: 'success',
        }),
      )
    }
  }

  return {
    text: 'I used the available tools, but hit the tool-step limit before a final answer.',
    toolRuns,
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, tools: tools.map((agentTool) => agentTool.name) })
})

app.post('/api/chat', async (request, response) => {
  try {
    const result = await runAgent({ messages: request.body?.messages })
    response.json(result)
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'The agent failed to respond.',
    })
  }
})

app.listen(port, () => {
  console.log(`LangChain agent server running at http://127.0.0.1:${port}`)
})
