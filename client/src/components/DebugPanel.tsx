import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';

// Extract biome from room ID: "fungal_corridor_3_z1_17" → "fungal" (zone prefix before _z)
function getBiome(roomId: string): string {
  const zoneMatch = roomId.match(/_z(\d+)_/);
  if (!zoneMatch) return 'unknown';
  // Everything before the zone marker minus trailing underscore, take first segment
  const prefix = roomId.slice(0, roomId.indexOf(`_z${zoneMatch[1]}_`));
  // Multi-biome rooms start with "multi_", strip it
  const clean = prefix.replace(/^multi_/, '');
  // First word is typically the biome
  const parts = clean.split('_');
  return parts[0] || 'unknown';
}

interface DebugPanelProps {
  onTeleport: (roomId: string) => void;
  onRevealAll: () => void;
}

export function DebugPanel({ onTeleport, onRevealAll }: DebugPanelProps) {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const roomList = Object.values(rooms);
  const biomes = [...new Set(roomList.map((r) => getBiome(r.id)))].sort();

  const filtered = filter
    ? roomList.filter((r) => getBiome(r.id) === filter)
    : roomList;

  return (
    <div className="debug-panel">
      <button className="debug-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Close Debug' : 'Debug'}
      </button>
      {open && (
        <div className="debug-content">
          <button className="debug-reveal-all" onClick={onRevealAll}>
            Reveal All Rooms
          </button>
          <div className="debug-filters">
            <button
              className={filter === '' ? 'active' : ''}
              onClick={() => setFilter('')}
            >
              All
            </button>
            {biomes.map((b) => (
              <button
                key={b}
                className={filter === b ? 'active' : ''}
                onClick={() => setFilter(b)}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="debug-room-list">
            {filtered.map((room) => (
              <button
                key={room.id}
                className={`debug-room ${room.id === currentRoomId ? 'current' : ''}`}
                onClick={() => onTeleport(room.id)}
                title={room.id}
              >
                <span className="debug-room-biome">{getBiome(room.id)}</span>
                <span className="debug-room-name">{room.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
