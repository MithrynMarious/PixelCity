/**
 * Live watcher API routes.
 *
 * GET  /api/live/status  — Current watcher state
 * POST /api/live/watch   — Start watching a JSONL path
 * POST /api/live/stop    — Stop watching
 */

import { Router } from 'express'
import fs from 'node:fs'
import type { WebSocketServer } from 'ws'
import { getState, startWatching, stopWatching } from '../watchers/jsonlWatcher.js'

export function createLiveRouter(wss: WebSocketServer): Router {
  const router = Router()

  router.get('/status', (_req, res) => {
    const s = getState()
    res.json({
      watching: s.watching,
      jsonlPath: s.jsonlPath,
      isActive: s.isActive,
      currentTool: s.currentTool,
    })
  })

  router.post('/watch', (req, res) => {
    const { path: jsonlPath } = req.body as { path?: string }
    if (!jsonlPath || typeof jsonlPath !== 'string') {
      res.status(400).json({ error: 'Missing "path" in request body' })
      return
    }

    try {
      fs.accessSync(jsonlPath, fs.constants.R_OK)
    } catch {
      res.status(400).json({ error: 'File not found or not readable' })
      return
    }

    try {
      startWatching(jsonlPath, wss)
      res.json({ ok: true, jsonlPath })
    } catch (e) {
      res.status(500).json({ error: String(e) })
    }
  })

  router.post('/stop', (_req, res) => {
    stopWatching()
    res.json({ ok: true })
  })

  return router
}
