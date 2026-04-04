import { useEffect, useRef } from 'react';
import type { ServerMessage } from '@caverns/shared';
import { useGameStore } from '../store/gameStore.js';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handleServerMessage = useGameStore((s) => s.handleServerMessage);
  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => { setConnectionStatus('connected'); };
    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {}
    };
    ws.onclose = () => { setConnectionStatus('disconnected'); };

    return () => { ws.close(); };
  }, [handleServerMessage, setConnectionStatus]);

  return wsRef;
}
