import { useEffect, useRef } from 'react';
import type { ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';
import { loadSessionToken } from '../auth/sessionStorage.js';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handleServerMessage = useGameStore((s) => s.handleServerMessage);
  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    (ws as unknown as { __id: number }).__id = Math.floor(Math.random() * 10000);
    console.log('[useWebSocket] CREATE ws', (ws as unknown as { __id: number }).__id);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useWebSocket] OPEN ws', (ws as unknown as { __id: number }).__id, 'wsRef still us?', wsRef.current === ws);
      setConnectionStatus('connected');
      const token = loadSessionToken();
      if (token) {
        ws.send(JSON.stringify({ type: 'resume_session', token }));
      }
    };
    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        console.log('[recv]', msg.type, 'via ws', (ws as unknown as { __id: number }).__id);
        handleServerMessage(msg);
      } catch (err) {
        console.error('[recv] parse error', err);
      }
    };
    ws.onclose = () => {
      console.log('[useWebSocket] CLOSE ws', (ws as unknown as { __id: number }).__id, 'wsRef still us?', wsRef.current === ws);
      setConnectionStatus('disconnected');
    };

    return () => {
      console.log('[useWebSocket] CLEANUP (effect unmount) ws', (ws as unknown as { __id: number }).__id);
      ws.close();
    };
  }, [handleServerMessage, setConnectionStatus]);

  return wsRef;
}
