/**
 * jsonlWatcher — Live JSONL transcript file watcher.
 *
 * Watches a Claude Code JSONL transcript file for new lines,
 * parses them to detect tool activity, and broadcasts status
 * over WebSocket to connected clients.
 *
 * Ported from the VS Code extension's fileWatcher.ts + transcriptParser.ts,
 * stripped of VS Code dependencies.
 */

import fs from 'node:fs'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { WebSocketServer } from 'ws'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveWatcherState {
  watching: boolean
  jsonlPath: string | null
  isActive: boolean
  currentTool: string | null
  fileOffset: number
  lineBuffer: string
}

interface LiveMessage {
  type: 'liveToolStart' | 'liveToolDone' | 'liveTurnEnd' | 'liveIdle'
  tool?: string
  status?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 5_000
const BASH_CMD_MAX = 60
const TASK_DESC_MAX = 40

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const state: LiveWatcherState = {
  watching: false,
  jsonlPath: null,
  isActive: false,
  currentTool: null,
  fileOffset: 0,
  lineBuffer: '',
}

let chokidarWatcher: FSWatcher | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let wssRef: WebSocketServer | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getState(): Readonly<LiveWatcherState> {
  return { ...state }
}

export function startWatching(jsonlPath: string, wss: WebSocketServer): void {
  // Stop any existing watcher first
  if (state.watching) {
    stopWatching()
  }

  wssRef = wss

  // Validate file exists
  fs.accessSync(jsonlPath, fs.constants.R_OK)

  state.watching = true
  state.jsonlPath = jsonlPath
  state.isActive = false
  state.currentTool = null
  // Start from end of file — we only care about new activity
  state.fileOffset = fs.statSync(jsonlPath).size
  state.lineBuffer = ''

  console.log(`[Live] Watching: ${path.basename(jsonlPath)}`)

  chokidarWatcher = watch(jsonlPath, { usePolling: false })
  chokidarWatcher.on('change', () => {
    readNewLines()
  })
}

export function stopWatching(): void {
  if (chokidarWatcher) {
    chokidarWatcher.close()
    chokidarWatcher = null
  }
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  state.watching = false
  state.jsonlPath = null
  state.isActive = false
  state.currentTool = null
  state.fileOffset = 0
  state.lineBuffer = ''
  wssRef = null
  console.log('[Live] Stopped watching')
}

// ---------------------------------------------------------------------------
// Incremental line reader (ported from fileWatcher.ts:readNewLines)
// ---------------------------------------------------------------------------

function readNewLines(): void {
  if (!state.jsonlPath) return
  try {
    const stat = fs.statSync(state.jsonlPath)
    if (stat.size <= state.fileOffset) return

    const buf = Buffer.alloc(stat.size - state.fileOffset)
    const fd = fs.openSync(state.jsonlPath, 'r')
    fs.readSync(fd, buf, 0, buf.length, state.fileOffset)
    fs.closeSync(fd)
    state.fileOffset = stat.size

    const text = state.lineBuffer + buf.toString('utf-8')
    const lines = text.split('\n')
    state.lineBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      processLine(line)
    }

    // Reset idle timer — we got data
    resetIdleTimer()
  } catch (e) {
    console.log(`[Live] Read error: ${e}`)
  }
}

// ---------------------------------------------------------------------------
// JSONL parser (simplified from transcriptParser.ts:processTranscriptLine)
// ---------------------------------------------------------------------------

function processLine(line: string): void {
  try {
    const record = JSON.parse(line) as Record<string, unknown>

    // assistant message with tool_use blocks → active
    if (record.type === 'assistant') {
      const content = (record.message as Record<string, unknown> | undefined)?.content
      if (!Array.isArray(content)) return

      const blocks = content as Array<{ type: string; name?: string; input?: Record<string, unknown> }>
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.name) {
          const status = formatToolStatus(block.name, block.input || {})
          state.isActive = true
          state.currentTool = status
          broadcast({ type: 'liveToolStart', tool: block.name, status })
          return
        }
      }
    }

    // user message with tool_result → tool done (still active until turn_duration)
    if (record.type === 'user') {
      const content = (record.message as Record<string, unknown> | undefined)?.content
      if (!Array.isArray(content)) return

      const blocks = content as Array<{ type: string }>
      if (blocks.some(b => b.type === 'tool_result')) {
        broadcast({ type: 'liveToolDone' })
      }
    }

    // system turn_duration → turn complete, go idle
    if (record.type === 'system' && (record as Record<string, unknown>).subtype === 'turn_duration') {
      state.isActive = false
      state.currentTool = null
      broadcast({ type: 'liveTurnEnd' })
    }
  } catch {
    // Ignore malformed lines
  }
}

// ---------------------------------------------------------------------------
// Tool status formatter (ported from transcriptParser.ts:formatToolStatus)
// ---------------------------------------------------------------------------

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : ''
  switch (toolName) {
    case 'Read': return `Reading ${base(input.file_path)}`
    case 'Edit': return `Editing ${base(input.file_path)}`
    case 'Write': return `Writing ${base(input.file_path)}`
    case 'Bash': {
      const cmd = (input.command as string) || ''
      return `Running: ${cmd.length > BASH_CMD_MAX ? cmd.slice(0, BASH_CMD_MAX) + '\u2026' : cmd}`
    }
    case 'Glob': return 'Searching files'
    case 'Grep': return 'Searching code'
    case 'WebFetch': return 'Fetching web content'
    case 'WebSearch': return 'Searching the web'
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc ? `Subtask: ${desc.length > TASK_DESC_MAX ? desc.slice(0, TASK_DESC_MAX) + '\u2026' : desc}` : 'Running subtask'
    }
    case 'AskUserQuestion': return 'Waiting for answer'
    case 'EnterPlanMode': return 'Planning'
    case 'NotebookEdit': return 'Editing notebook'
    default: return `Using ${toolName}`
  }
}

// ---------------------------------------------------------------------------
// Idle detection — 5s after last data, broadcast idle
// ---------------------------------------------------------------------------

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
  }
  idleTimer = setTimeout(() => {
    if (state.isActive) {
      state.isActive = false
      state.currentTool = null
      broadcast({ type: 'liveIdle' })
    }
  }, IDLE_TIMEOUT_MS)
}

// ---------------------------------------------------------------------------
// WebSocket broadcast
// ---------------------------------------------------------------------------

function broadcast(msg: LiveMessage): void {
  if (!wssRef) return
  const data = JSON.stringify(msg)
  for (const client of wssRef.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data)
    }
  }
}
