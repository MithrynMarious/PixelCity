/**
 * useLiveActivity — WebSocket hook for live Claude Code activity monitoring.
 *
 * Connects to the PixelCity server WebSocket, listens for live JSONL watcher
 * messages, and exposes isActive / currentTool / townHallGlowing state.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = 'ws://localhost:3001/ws'
const RECONNECT_DELAY_MS = 2_000
const API_BASE = 'http://localhost:3001/api/live'

export interface LiveActivityState {
  isConnected: boolean
  isActive: boolean
  currentTool: string | null
  townHallGlowing: boolean
  watching: boolean
  jsonlPath: string | null
  startWatch: (path: string) => Promise<void>
  stopWatch: () => Promise<void>
  fetchStatus: () => Promise<void>
}

interface LiveMessage {
  type: 'liveToolStart' | 'liveToolDone' | 'liveTurnEnd' | 'liveIdle'
  tool?: string
  status?: string
}

export function useLiveActivity(): LiveActivityState {
  const [isConnected, setIsConnected] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [currentTool, setCurrentTool] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const [jsonlPath, setJsonlPath] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // WebSocket connection management
  useEffect(() => {
    mountedRef.current = true

    function connect() {
      if (!mountedRef.current) return

      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (mountedRef.current) setIsConnected(true)
      }

      ws.onclose = () => {
        if (mountedRef.current) {
          setIsConnected(false)
          // Auto-reconnect
          reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      ws.onerror = () => {
        // onclose will fire after this
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(event.data as string) as LiveMessage
          switch (msg.type) {
            case 'liveToolStart':
              setIsActive(true)
              setCurrentTool(msg.status || msg.tool || null)
              break
            case 'liveToolDone':
              // Still active (more tools may come before turn ends)
              break
            case 'liveTurnEnd':
            case 'liveIdle':
              setIsActive(false)
              setCurrentTool(null)
              break
          }
        } catch {
          // Ignore malformed messages
        }
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.onclose = null // Prevent reconnect on intentional close
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Fetch server-side watcher status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`)
      if (res.ok) {
        const data = await res.json() as { watching: boolean; jsonlPath: string | null; isActive: boolean; currentTool: string | null }
        setWatching(data.watching)
        setJsonlPath(data.jsonlPath)
        setIsActive(data.isActive)
        setCurrentTool(data.currentTool)
      }
    } catch {
      // Server not reachable — ignore
    }
  }, [])

  // Fetch initial status on mount
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Start watching a JSONL path
  const startWatch = useCallback(async (path: string) => {
    try {
      const res = await fetch(`${API_BASE}/watch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (res.ok) {
        setWatching(true)
        setJsonlPath(path)
      }
    } catch {
      // Server not reachable
    }
  }, [])

  // Stop watching
  const stopWatch = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stop`, { method: 'POST' })
      if (res.ok) {
        setWatching(false)
        setJsonlPath(null)
        setIsActive(false)
        setCurrentTool(null)
      }
    } catch {
      // Server not reachable
    }
  }, [])

  return {
    isConnected,
    isActive,
    currentTool,
    townHallGlowing: isActive,
    watching,
    jsonlPath,
    startWatch,
    stopWatch,
    fetchStatus,
  }
}
