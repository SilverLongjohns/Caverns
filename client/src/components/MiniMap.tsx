import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import type { Direction } from '@caverns/shared';

const ROOM_W = 100;
const ROOM_H = 50;
const GAP_X = 140;
const GAP_Y = 80;

const PLAYER_COLORS = ['#d4a857', '#cc4444', '#5599cc', '#88cc66'];

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

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    const roomList = Object.values(rooms);
    if (roomList.length === 0) return { positions, connections: [] };

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

    const connections: { from: string; to: string }[] = [];
    const seen = new Set<string>();
    for (const room of roomList) {
      for (const targetId of Object.values(room.exits)) {
        if (targetId && positions.has(targetId)) {
          const key = [room.id, targetId].sort().join('-');
          if (!seen.has(key)) {
            seen.add(key);
            connections.push({ from: room.id, to: targetId });
          }
        }
      }
    }

    return { positions, connections };
  }, [rooms]);

  if (layout.positions.size === 0) return null;

  const allPos = Array.from(layout.positions.values());
  const minX = Math.min(...allPos.map((p) => p.x)) * GAP_X - ROOM_W;
  const maxX = Math.max(...allPos.map((p) => p.x)) * GAP_X + ROOM_W * 2;
  const minY = Math.min(...allPos.map((p) => p.y)) * GAP_Y - ROOM_H;
  const maxY = Math.max(...allPos.map((p) => p.y)) * GAP_Y + ROOM_H * 2;

  const playerList = Object.values(players);

  return (
    <div className="minimap">
      <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} width="100%" height="100%">
        {layout.connections.map(({ from, to }) => {
          const p1 = layout.positions.get(from)!;
          const p2 = layout.positions.get(to)!;
          return (
            <line key={`${from}-${to}`}
              x1={p1.x * GAP_X + ROOM_W / 2} y1={p1.y * GAP_Y + ROOM_H / 2}
              x2={p2.x * GAP_X + ROOM_W / 2} y2={p2.y * GAP_Y + ROOM_H / 2}
              stroke="#4a3d2a" strokeWidth={2}
            />
          );
        })}

        {Array.from(layout.positions.entries()).map(([roomId, pos]) => {
          const room = rooms[roomId];
          const isCurrent = roomId === currentRoomId;
          return (
            <g key={roomId}>
              <rect x={pos.x * GAP_X} y={pos.y * GAP_Y} width={ROOM_W} height={ROOM_H} rx={4}
                fill={isCurrent ? '#2a2010' : '#1a1410'}
                stroke={isCurrent ? '#d4a857' : '#3d3122'}
                strokeWidth={isCurrent ? 2 : 1}
              />
              <text x={pos.x * GAP_X + ROOM_W / 2} y={pos.y * GAP_Y + ROOM_H / 2}
                textAnchor="middle" dominantBaseline="middle" fill="#c8b89a" fontSize={10}
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
                      textAnchor="middle" dominantBaseline="middle" fill="#5a4530" fontSize={14}
                    >?</text>
                  );
                }
                return null;
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
