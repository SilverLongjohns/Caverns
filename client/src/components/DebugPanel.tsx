import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import allItems from '../../../shared/src/data/items.json';
import allUniqueItems from '../../../shared/src/data/uniqueItems.json';

const combinedItems = [...allItems, ...allUniqueItems];

// Extract biome from room ID: "fungal_corridor_3_z1_17" -> "fungal" (zone prefix before _z)
function getBiome(roomId: string): string {
  const zoneMatch = roomId.match(/_z(\d+)_/);
  if (!zoneMatch) return 'unknown';
  const prefix = roomId.slice(0, roomId.indexOf(`_z${zoneMatch[1]}_`));
  const clean = prefix.replace(/^multi_/, '');
  const parts = clean.split('_');
  return parts[0] || 'unknown';
}

type DebugTab = 'rooms' | 'items';

interface DebugPanelProps {
  onTeleport: (roomId: string) => void;
  onRevealAll: () => void;
  onGiveItem: (itemId: string) => void;
}

export function DebugPanel({ onTeleport, onRevealAll, onGiveItem }: DebugPanelProps) {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DebugTab>('rooms');
  const [filter, setFilter] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemRarityFilter, setItemRarityFilter] = useState('');

  const roomList = Object.values(rooms);
  const biomes = [...new Set(roomList.map((r) => getBiome(r.id)))].sort();

  const filteredRooms = filter
    ? roomList.filter((r) => getBiome(r.id) === filter)
    : roomList;

  const searchLower = itemSearch.toLowerCase();
  const filteredItems = combinedItems.filter((item) => {
    if (itemRarityFilter && item.rarity !== itemRarityFilter) return false;
    if (searchLower && !item.name.toLowerCase().includes(searchLower) && !item.id.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const rarities = ['common', 'uncommon', 'rare', 'legendary', 'unique'];

  return (
    <div className="debug-panel">
      <button className="debug-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Close Debug' : 'Debug'}
      </button>
      {open && (
        <div className="debug-content">
          <div className="debug-tabs">
            <button className={tab === 'rooms' ? 'active' : ''} onClick={() => setTab('rooms')}>Rooms</button>
            <button className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')}>Items</button>
          </div>

          {tab === 'rooms' && (
            <>
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
                {filteredRooms.map((room) => (
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
            </>
          )}

          {tab === 'items' && (
            <>
              <input
                className="debug-item-search"
                type="text"
                placeholder="Search items..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
              <div className="debug-filters">
                <button
                  className={itemRarityFilter === '' ? 'active' : ''}
                  onClick={() => setItemRarityFilter('')}
                >
                  All
                </button>
                {rarities.map((r) => (
                  <button
                    key={r}
                    className={itemRarityFilter === r ? 'active' : ''}
                    onClick={() => setItemRarityFilter(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="debug-room-list">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    className="debug-room"
                    onClick={() => onGiveItem(item.id)}
                    title={item.description}
                  >
                    <span className="debug-room-biome">{item.slot}</span>
                    <span className={`debug-room-name rarity-${item.rarity}`}>{item.name}</span>
                    {item.effect && <span className="debug-item-effect">{item.effect}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
