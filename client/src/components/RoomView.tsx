import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getTemplateForRoom, getInteractableDefinition } from '@caverns/shared';
import type { InteractableInstance } from '@caverns/shared';

interface InteractableChar {
  kind: 'interactable';
  char: string;
  instanceId: string;
  name: string;
  fullyUsed: boolean;
}

interface TextRun {
  kind: 'text';
  text: string;
}

type RowSegment = InteractableChar | TextRun;

function isFullyUsed(instance: InteractableInstance): boolean {
  const def = getInteractableDefinition(instance.definitionId);
  if (!def) return false;
  const nonRepeatable = def.actions.filter(a => !a.repeatable);
  if (nonRepeatable.length === 0) return false;
  return nonRepeatable.every(a => a.id in instance.usedActions);
}

interface RoomViewProps {
  onInteract: (interactableId: string) => void;
}

export function RoomView({ onInteract }: RoomViewProps) {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const selectedInteractableId = useGameStore((s) => s.selectedInteractableId);
  const selectInteractable = useGameStore((s) => s.selectInteractable);

  const room = rooms[currentRoomId];

  const rows = useMemo(() => {
    if (!room) return [];

    const template = getTemplateForRoom(room.type);
    const lines = template.lines;

    // Build a map of interactable positions
    const interactableMap = new Map<string, { instance: InteractableInstance; asciiChar: string; name: string }>();
    if (room.interactables) {
      for (const inst of room.interactables) {
        const def = getInteractableDefinition(inst.definitionId);
        if (def) {
          interactableMap.set(`${inst.position.x},${inst.position.y}`, {
            instance: inst,
            asciiChar: def.asciiChar,
            name: def.name,
          });
        }
      }
    }

    // Build rows of segments — consecutive plain chars grouped into text runs
    const result: RowSegment[][] = [];
    for (let y = 0; y < lines.length; y++) {
      const segments: RowSegment[] = [];
      let textBuf = '';

      for (let x = 0; x < lines[y].length; x++) {
        const posKey = `${x},${y}`;
        const interactable = interactableMap.get(posKey);

        if (interactable) {
          // Flush text buffer
          if (textBuf) {
            segments.push({ kind: 'text', text: textBuf });
            textBuf = '';
          }
          segments.push({
            kind: 'interactable',
            char: interactable.asciiChar,
            instanceId: interactable.instance.instanceId,
            name: interactable.name,
            fullyUsed: isFullyUsed(interactable.instance),
          });
        } else {
          textBuf += lines[y][x];
        }
      }
      // Flush remaining text
      if (textBuf) {
        segments.push({ kind: 'text', text: textBuf });
      }
      result.push(segments);
    }
    return result;
  }, [room]);

  if (!room) return null;

  const handleInteractableClick = (instanceId: string) => {
    if (selectedInteractableId === instanceId) {
      selectInteractable(null);
      useGameStore.setState({ pendingInteractActions: null });
    } else {
      selectInteractable(instanceId);
      useGameStore.setState({ pendingInteractActions: null });
      onInteract(instanceId);
    }
  };

  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <pre className="room-grid">
        {rows.map((segments, y) => (
          <div key={y} className="room-row">
            {segments.map((seg, i) => {
              if (seg.kind === 'text') {
                return <span key={i} className="room-text">{seg.text}</span>;
              }
              const isSelected = seg.instanceId === selectedInteractableId;
              const className = [
                seg.fullyUsed ? 'char-interactable-used' : 'char-interactable',
                isSelected ? 'char-selected' : '',
              ].filter(Boolean).join(' ');
              return (
                <span
                  key={i}
                  className={className}
                  onClick={() => handleInteractableClick(seg.instanceId)}
                  title={isSelected ? seg.name : undefined}
                >
                  {seg.char}
                </span>
              );
            })}
          </div>
        ))}
      </pre>
    </div>
  );
}
