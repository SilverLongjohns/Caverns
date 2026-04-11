import { useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Direction } from '@caverns/shared';
import { MAP_UI_CONFIG } from '../uiconfig/mapUI.js';

const ROOM_W = 100;
const ROOM_H = 50;
const GAP_X = 140;
const GAP_Y = 80;

// How many grid units to show around the player in follow mode
const VIEWPORT_RADIUS_X = MAP_UI_CONFIG.viewportRadius;
const VIEWPORT_RADIUS_Y = MAP_UI_CONFIG.viewportRadius;

const PLAYER_COLORS = MAP_UI_CONFIG.playerColors;

const DIR_OFFSET: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

export function MiniMap() {
  const rooms = useGameStore((s) => s.rooms);
  const players = useGameStore((s) => s.players);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const scoutThreats = useGameStore((s) => s.scoutThreats);
  const [fullscreen, setFullscreen] = useState(false);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const roomList = Object.values(rooms);
    if (roomList.length === 0) return { positions, connections: [] };

    // Use server-provided grid positions if available, otherwise fall back to BFS
    const hasGridPositions = roomList.some(r => r.gridX !== undefined && r.gridY !== undefined);

    if (hasGridPositions) {
      for (const room of roomList) {
        if (room.gridX !== undefined && room.gridY !== undefined) {
          positions.set(room.id, { x: room.gridX, y: room.gridY });
        }
      }
    } else {
      const startId = roomList[0].id;
      const queue: { id: string; x: number; y: number }[] = [{ id: startId, x: 0, y: 0 }];
      const visited = new Set<string>();
      visited.add(startId);

      while (queue.length > 0) {
        const { id, x, y } = queue.shift()!;
        positions.set(id, { x, y });
        const room = rooms[id];
        if (!room) continue;
        for (const [dir, targetId] of Object.entries(room.exits)) {
          if (targetId && !visited.has(targetId) && rooms[targetId]) {
            visited.add(targetId);
            const offset = DIR_OFFSET[dir as Direction];
            queue.push({ id: targetId, x: x + offset.dx, y: y + offset.dy });
          }
        }
      }
    }

    const connections: { from: string; to: string; dir: Direction; locked: boolean }[] = [];
    const seen = new Set<string>();
    for (const room of roomList) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        if (targetId && positions.has(targetId)) {
          const key = [room.id, targetId].sort().join('-');
          if (!seen.has(key)) {
            seen.add(key);
            const isLocked = !!(room.lockedExits && room.lockedExits[dir as Direction]);
            connections.push({ from: room.id, to: targetId, dir: dir as Direction, locked: isLocked });
          }
        }
      }
    }

    return { positions, connections };
  }, [rooms]);

  if (layout.positions.size === 0) return null;

  // Compute viewBox based on mode
  const playerPos = layout.positions.get(currentRoomId);
  let viewBox: string;

  if (fullscreen) {
    // Show entire map
    const allPos = Array.from(layout.positions.values());
    const minX = Math.min(...allPos.map((p) => p.x)) * GAP_X - ROOM_W;
    const maxX = Math.max(...allPos.map((p) => p.x)) * GAP_X + ROOM_W * 2;
    const minY = Math.min(...allPos.map((p) => p.y)) * GAP_Y - ROOM_H;
    const maxY = Math.max(...allPos.map((p) => p.y)) * GAP_Y + ROOM_H * 2;
    viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  } else if (playerPos) {
    // Follow player with consistent zoom
    const cx = playerPos.x * GAP_X + ROOM_W / 2;
    const cy = playerPos.y * GAP_Y + ROOM_H / 2;
    const vw = VIEWPORT_RADIUS_X * 2 * GAP_X;
    const vh = VIEWPORT_RADIUS_Y * 2 * GAP_Y;
    viewBox = `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`;
  } else {
    const allPos = Array.from(layout.positions.values());
    const minX = Math.min(...allPos.map((p) => p.x)) * GAP_X - ROOM_W;
    const maxX = Math.max(...allPos.map((p) => p.x)) * GAP_X + ROOM_W * 2;
    const minY = Math.min(...allPos.map((p) => p.y)) * GAP_Y - ROOM_H;
    const maxY = Math.max(...allPos.map((p) => p.y)) * GAP_Y + ROOM_H * 2;
    viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }

  const playerList = Object.values(players);

  return (
    <div className={`minimap ${fullscreen ? 'minimap-fullscreen' : ''}`}>
      <button
        className="minimap-toggle"
        onClick={() => setFullscreen(!fullscreen)}
        title={fullscreen ? 'Close map' : 'Expand map'}
      >
        {fullscreen ? '\u2716' : '\u26F6'}
      </button>
      <svg viewBox={viewBox} width="100%" height="100%">
        {layout.connections.map(({ from, to, dir, locked }) => {
          const p1 = layout.positions.get(from)!;
          const p2 = layout.positions.get(to)!;
          const x1 = p1.x * GAP_X + ROOM_W / 2;
          const y1 = p1.y * GAP_Y + ROOM_H / 2;
          const x2 = p2.x * GAP_X + ROOM_W / 2;
          const y2 = p2.y * GAP_Y + ROOM_H / 2;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const isAdjacent = Math.abs(dx) + Math.abs(dy) === 1;
          const stroke = locked ? '#5a1a1a' : '#1a3a3a';
          const strokeWidth = locked ? 3 : 2;
          const dashArray = locked ? '4 3' : undefined;

          if (isAdjacent) {
            return (
              <g key={`${from}-${to}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArray} />
                {locked && (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2}
                    textAnchor="middle" dominantBaseline="middle" fontSize={12}>&#x1F512;</text>
                )}
              </g>
            );
          }

          // Non-adjacent: draw a curved path exiting in the correct direction
          const offset = DIR_OFFSET[dir];
          const exitX1 = x1 + offset.dx * (ROOM_W / 2 + 10);
          const exitY1 = y1 + offset.dy * (ROOM_H / 2 + 10);
          const oppDir = { dx: -offset.dx, dy: -offset.dy };
          const exitX2 = x2 + oppDir.dx * (ROOM_W / 2 + 10);
          const exitY2 = y2 + oppDir.dy * (ROOM_H / 2 + 10);
          const cx1 = exitX1 + offset.dx * GAP_X * 0.5;
          const cy1 = exitY1 + offset.dy * GAP_Y * 0.5;
          const cx2 = exitX2 + oppDir.dx * GAP_X * 0.5;
          const cy2 = exitY2 + oppDir.dy * GAP_Y * 0.5;
          const d = `M${exitX1},${exitY1} C${cx1},${cy1} ${cx2},${cy2} ${exitX2},${exitY2}`;
          return (
            <g key={`${from}-${to}`}>
              <line x1={x1} y1={y1} x2={exitX1} y2={exitY1}
                stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArray} />
              <path d={d} fill="none"
                stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArray} />
              <line x1={exitX2} y1={exitY2} x2={x2} y2={y2}
                stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArray} />
              {locked && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2}
                  textAnchor="middle" dominantBaseline="middle" fontSize={12}>&#x1F512;</text>
              )}
            </g>
          );
        })}

        {Array.from(layout.positions.entries()).map(([roomId, pos]) => {
          const room = rooms[roomId];
          const isCurrent = roomId === currentRoomId;
          return (
            <g key={roomId}>
              <rect x={pos.x * GAP_X} y={pos.y * GAP_Y} width={ROOM_W} height={ROOM_H} rx={4}
                fill={isCurrent ? '#051515' : '#0a0a0a'}
                stroke={isCurrent ? '#00e4ff' : '#1a3a3a'}
                strokeWidth={isCurrent ? 2 : 1}
              />
              <text x={pos.x * GAP_X + ROOM_W / 2} y={pos.y * GAP_Y + ROOM_H / 2}
                textAnchor="middle" dominantBaseline="middle" fill="#b4b4b4" fontSize={10}
              >
                {room?.name ?? roomId}
              </text>
              {room && Object.entries(room.exits).map(([dir, targetId]) => {
                if (targetId && !rooms[targetId]) {
                  const offset = DIR_OFFSET[dir as Direction];
                  return (
                    <text key={dir}
                      x={pos.x * GAP_X + ROOM_W / 2 + offset.dx * (ROOM_W / 2 + 12)}
                      y={pos.y * GAP_Y + ROOM_H / 2 + offset.dy * (ROOM_H / 2 + 12)}
                      textAnchor="middle" dominantBaseline="middle" fill="#3a5a5a" fontSize={14}
                    >?</text>
                  );
                }
                return null;
              })}
              {scoutThreats[roomId] && Object.entries(scoutThreats[roomId]).map(([dir, hasThreat]) => {
                const offset = DIR_OFFSET[dir as Direction];
                const targetId = room?.exits[dir as Direction];
                if (targetId && rooms[targetId]) return null;
                return (
                  <text key={`scout-${dir}`}
                    x={pos.x * GAP_X + ROOM_W / 2 + offset.dx * (ROOM_W / 2 + 12)}
                    y={pos.y * GAP_Y + ROOM_H / 2 + offset.dy * (ROOM_H / 2 + 12)}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={hasThreat ? '#cc4444' : '#44cc44'} fontSize={10}
                  >{hasThreat ? '\u2620' : '\u2713'}</text>
                );
              })}
            </g>
          );
        })}

        {playerList.map((player, i) => {
          const pos = layout.positions.get(player.roomId);
          if (!pos) return null;
          return (
            <circle key={player.id}
              cx={pos.x * GAP_X + ROOM_W / 2 + (i - playerList.length / 2) * 14}
              cy={pos.y * GAP_Y + ROOM_H - 8}
              r={5} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            >
              <title>{player.name}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
