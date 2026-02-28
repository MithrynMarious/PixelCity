/**
 * ReplayPanel — Overlay UI for EAM session replay controls.
 *
 * Shows a session list, play/stop buttons, speed selector, and
 * status indicator during active replay.
 */

import { useState } from 'react'
import type { ReplaySessionSummary, ReplayState } from '../hooks/useReplay.js'

interface ReplayPanelProps {
  sessions: ReplaySessionSummary[]
  activeReplay: ReplayState | null
  playbackSpeed: number
  onPlay: (filename: string) => void
  onStop: () => void
  onSpeedChange: (speed: number) => void
  onRefresh: () => void
  // Live watcher props
  liveWatching: boolean
  liveJsonlPath: string | null
  liveIsActive: boolean
  liveCurrentTool: string | null
  liveIsConnected: boolean
  onLiveWatch: (path: string) => Promise<void>
  onLiveStop: () => Promise<void>
}

const SPEEDS = [0.5, 1, 2]

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 12,
  width: 280,
  maxHeight: '60vh',
  background: 'rgba(20, 20, 35, 0.92)',
  border: '1px solid #444',
  fontFamily: 'monospace',
  fontSize: '12px',
  color: '#ccc',
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #333',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: '#8af',
  fontWeight: 'bold',
  fontSize: '13px',
  flexShrink: 0,
}

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
}

const itemStyle: React.CSSProperties = {
  padding: '6px 10px',
  cursor: 'pointer',
  borderBottom: '1px solid #2a2a3a',
}

const itemHoverBg = 'rgba(100, 140, 255, 0.12)'

const controlsStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderTop: '1px solid #333',
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
  flexShrink: 0,
}

const buttonStyle: React.CSSProperties = {
  background: '#334',
  border: '1px solid #556',
  color: '#aaf',
  padding: '3px 8px',
  fontFamily: 'monospace',
  fontSize: '11px',
  cursor: 'pointer',
}

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#446',
  borderColor: '#88a',
  color: '#fff',
}

export function ReplayPanel({
  sessions,
  activeReplay,
  playbackSpeed,
  onPlay,
  onStop,
  onSpeedChange,
  onRefresh,
  liveWatching,
  liveJsonlPath,
  liveIsActive,
  liveCurrentTool,
  liveIsConnected,
  onLiveWatch,
  onLiveStop,
}: ReplayPanelProps) {
  const isPlaying = activeReplay !== null
  const [livePath, setLivePath] = useState('')

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>EAM Replay</span>
        <button
          style={{ ...buttonStyle, padding: '2px 6px' }}
          onClick={onRefresh}
          title="Refresh session list"
        >
          Refresh
        </button>
      </div>

      {/* Active replay status */}
      {activeReplay && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(60, 120, 255, 0.15)',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}>
          <div style={{ color: '#8cf', marginBottom: 2 }}>
            Replaying... ({activeReplay.phase})
          </div>
          <div style={{ color: '#999', fontSize: '11px' }}>
            {activeReplay.session.epic ?? activeReplay.session.filename}
          </div>
          {activeReplay.session.constructs.length > 0 && (
            <div style={{ color: '#aaa', fontSize: '11px', marginTop: 2 }}>
              {activeReplay.session.constructs.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      <div style={listStyle}>
        {sessions.length === 0 && (
          <div style={{ padding: '12px 10px', color: '#666', textAlign: 'center' }}>
            No sessions found. Click Refresh.
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.filename}
            style={itemStyle}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = itemHoverBg }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            onClick={() => { if (!isPlaying) onPlay(s.filename) }}
            title={s.anchor ?? s.filename}
          >
            <div style={{ color: '#ddd', marginBottom: 2 }}>
              {s.filename.replace(/\.md$/, '')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '10px' }}>
              <span>{s.date ?? '—'}</span>
              <span>{s.constructs.length > 0 ? s.constructs.join(', ') : 'no constructs'}</span>
            </div>
            {s.epic && (
              <div style={{ color: '#77a', fontSize: '10px', marginTop: 1 }}>{s.epic}</div>
            )}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={controlsStyle}>
        {isPlaying ? (
          <button style={{ ...buttonStyle, background: '#633', borderColor: '#a55', color: '#faa' }} onClick={onStop}>
            Stop
          </button>
        ) : (
          <span style={{ color: '#666', fontSize: '10px' }}>Select a session to replay</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '3px' }}>
          {SPEEDS.map(spd => (
            <button
              key={spd}
              style={playbackSpeed === spd ? activeButtonStyle : buttonStyle}
              onClick={() => onSpeedChange(spd)}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      {/* Live watcher section */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #333', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: !liveIsConnected ? '#a33' : liveWatching ? (liveIsActive ? '#4f4' : '#fa0') : '#666',
            boxShadow: liveIsActive ? '0 0 6px #4f4' : 'none',
          }} />
          <span style={{ color: '#8af', fontWeight: 'bold', fontSize: '13px' }}>Live</span>
          <span style={{ color: '#888', fontSize: '10px', marginLeft: 'auto' }}>
            {!liveIsConnected ? 'disconnected' : liveWatching ? 'watching' : 'idle'}
          </span>
        </div>

        {liveWatching && liveIsActive && liveCurrentTool && (
          <div style={{ color: '#8f8', fontSize: '11px', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {liveCurrentTool}
          </div>
        )}

        {liveWatching && liveJsonlPath && (
          <div style={{ color: '#666', fontSize: '10px', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={liveJsonlPath}>
            {liveJsonlPath.split(/[\\/]/).pop()}
          </div>
        )}

        {!liveWatching && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="JSONL path..."
              value={livePath}
              onChange={e => setLivePath(e.target.value)}
              style={{
                flex: 1,
                background: '#1a1a2a',
                border: '1px solid #444',
                color: '#ccc',
                fontFamily: 'monospace',
                fontSize: '10px',
                padding: '3px 6px',
                outline: 'none',
              }}
            />
            <button
              style={buttonStyle}
              onClick={() => { if (livePath.trim()) onLiveWatch(livePath.trim()) }}
            >
              Watch
            </button>
          </div>
        )}

        {liveWatching && (
          <button
            style={{ ...buttonStyle, background: '#633', borderColor: '#a55', color: '#faa', fontSize: '10px' }}
            onClick={onLiveStop}
          >
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
