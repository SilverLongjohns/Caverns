import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CLASS_DEFINITIONS } from '@caverns/shared';

const STALAGMITES: { art: string; left: string; opacity: number }[] = [
  // ========= LEFT EDGE — tallest =========
  { left: '-3%', opacity: 0.75, art: [
    "                 ░",
    "                ░░",
    "               ░░░",
    "               ▒░░",
    "              ▒░░░",
    "              ▒▒░░░",
    "             ▒▒░░░░",
    "             ▒▒▒░░░",
    "            ▒▒▒░░░░",
    "            ▒▒▒▒░░░░",
    "           ▒▒▒▒░░░░░",
    "          ▓▒▒▒▒░░░░░",
    "          ▓▓▒▒▒░░░░░",
    "         ▓▓▓▒▒▒▒░░░░░",
    "         ▓▓▓▒▒▒▒░░░░░░",
    "        ▓▓▓▓▒▒▒▒░░░░░░",
    "        ▓▓▓▓▒▒▒▒▒░░░░░░",
    "       ████▓▒▒▒▒▒░░░░░░",
    "       ████▓▓▒▒▒▒░░░░░░░",
    "      █████▓▓▒▒▒▒▒░░░░░░",
    "      ██████▓▒▒▒▒▒░░░░░░░",
    "     ██████▓▓▒▒▒▒▒░░░░░░░",
    "     ███████▓▓▒▒▒▒░░░░░░░░",
    "    ████████▓▓▒▒▒▒▒░░░░░░░",
    "    █████████▓▒▒▒▒▒░░░░░░░░",
    "   ██████████▓▓▒▒▒▒▒░░░░░░░░",
    "   ██████████▓▓▒▒▒▒▒░░░░░░░░░",
    "  ███████████▓▓▒▒▒▒▒░░░░░░░░░",
    "  ████████████▓▒▒▒▒▒░░░░░░░░░░",
    " █████████████▓▓▒▒▒▒▒░░░░░░░░░",
    " █████████████▓▓▒▒▒▒▒░░░░░░░░░░",
    "██████████████▓▓▒▒▒▒▒░░░░░░░░░░░",
  ].join('\n') },
  { left: '4%', opacity: 0.4, art: "  ░\n ▒░\n▓▒░░\n██▒░░" },
  { left: '6%', opacity: 0.45, art: " ░\n▒░░\n▓▒░░\n█▓▒░░\n██▓░░░" },
  // --- large ---
  { left: '7%', opacity: 0.7, art: [
    "           ░",
    "          ░░",
    "         ░░░",
    "         ░░░",
    "        ▒░░░",
    "        ▒░░░░",
    "       ▒▒░░░░",
    "       ▒▒▒░░░",
    "      ▒▒▒░░░░",
    "      ▒▒▒▒░░░",
    "     ▒▒▒▒░░░░",
    "    ▓▒▒▒▒░░░░",
    "    ▓▓▒▒▒░░░░░",
    "   ▓▓▓▒▒▒▒░░░░",
    "   ▓▓▓▒▒▒▒░░░░░",
    "  ▓▓▓▓▒▒▒▒░░░░░",
    "  ████▓▒▒▒▒░░░░░",
    " █████▓▓▒▒▒░░░░░░",
    " ██████▓▒▒▒▒░░░░░",
    "██████▓▓▒▒▒▒░░░░░░",
    "███████▓▒▒▒▒░░░░░░░",
  ].join('\n') },
  { left: '15%', opacity: 0.35, art: " ░\n░░\n▒░░\n▓▒░" },
  { left: '16%', opacity: 0.4, art: "  ░\n ▒░░\n▓▒▒░\n█▓▒░░" },
  // --- medium ---
  { left: '17%', opacity: 0.55, art: [
    "       ░",
    "      ░░",
    "     ▒░░░",
    "     ▒▒░░",
    "    ▒▒▒░░░",
    "    ▓▒▒░░░",
    "   ▓▓▒▒░░░░",
    "   ▓▓▒▒▒░░░",
    "  ▓▓▓▒▒▒░░░░",
    "  ███▓▒▒▒░░░░",
    " ████▓▒▒▒░░░░░",
    "████▓▓▒▒▒░░░░░░",
  ].join('\n') },
  { left: '23%', opacity: 0.4, art: " ░\n▒░░\n▓▒░\n█▓▒░░" },
  // --- small ---
  { left: '24%', opacity: 0.5, art: [
    "    ░",
    "   ░░",
    "  ▒░░░",
    "  ▒▒░░",
    " ▓▒▒░░░",
    " ▓▓▒▒░░",
    "██▓▒▒░░░",
    "██▓▓▒░░░░",
  ].join('\n') },
  { left: '29%', opacity: 0.35, art: "  ░\n ▒░\n▓▒░░\n██▒░░" },
  { left: '30%', opacity: 0.45, art: " ░\n░░\n▒░░\n▓▒░░\n█▓▒░░" },
  // --- small ---
  { left: '32%', opacity: 0.5, art: [
    "     ░",
    "    ░░",
    "   ▒░░░",
    "   ▒▒░░",
    "  ▒▒░░░",
    " ▓▒▒▒░░",
    " ▓▓▒▒░░░",
    "▓▓▒▒▒░░░",
    "██▓▒▒░░░░",
  ].join('\n') },
  { left: '37%', opacity: 0.35, art: " ░\n▒░░\n▓▒░\n█▓░░" },
  { left: '38%', opacity: 0.4, art: "  ░\n ▒░░\n▓▒▒░\n█▓▒░░" },
  // ========= CENTER — valley (shorter but still dense) =========
  { left: '40%', opacity: 0.45, art: [
    "   ░",
    "  ▒░",
    "  ▒░░",
    " ▓▒░░",
    " ▓▒▒░░",
    "▓▓▒▒░░",
    "██▓▒░░░",
  ].join('\n') },
  { left: '43%', opacity: 0.35, art: " ░\n▒░░\n▓▒░\n█▓▒░░" },
  { left: '44%', opacity: 0.4, art: "  ░\n ▒░\n▓▒░░" },
  { left: '46%', opacity: 0.45, art: [
    "    ░",
    "   ░░",
    "  ▒░░",
    "  ▒▒░░",
    " ▓▒▒░░",
    "██▓▒░░░",
  ].join('\n') },
  { left: '48%', opacity: 0.3, art: " ░\n▒░\n▓▒░\n█▓░░" },
  { left: '49%', opacity: 0.4, art: "  ░\n ▒░░\n▓▒▒░\n█▓▒░░" },
  { left: '51%', opacity: 0.45, art: [
    "   ░",
    "  ▒░",
    "  ▒░░",
    " ▓▒░░",
    " ▓▒▒░░",
    "▓▓▒▒░░",
    "██▓▒░░░",
  ].join('\n') },
  { left: '53%', opacity: 0.35, art: " ░\n░░\n▒░░\n▓▒░░" },
  { left: '55%', opacity: 0.4, art: "  ░\n ▒░\n▓▒░░\n██▒░░" },
  { left: '56%', opacity: 0.45, art: [
    "    ░",
    "   ░░",
    "  ▒░░░",
    "  ▒▒░░",
    " ▓▒▒░░░",
    " ▓▓▒▒░░",
    "██▓▒▒░░░",
  ].join('\n') },
  { left: '59%', opacity: 0.3, art: "░\n▒░\n▓▒░\n█▓░░" },
  { left: '60%', opacity: 0.4, art: " ░\n▒░░\n▓▒░\n█▓▒░░" },
  // ========= RIGHT SIDE — builds back up =========
  // --- small ---
  { left: '62%', opacity: 0.5, art: [
    "    ░",
    "   ░░",
    "   ▒░░",
    "  ▒▒░░",
    "  ▓▒░░░",
    " ▓▓▒▒░░",
    " ▓▓▒▒░░░",
    "██▓▒▒░░░░",
  ].join('\n') },
  { left: '66%', opacity: 0.35, art: "  ░\n ▒░░\n▓▒▒░\n█▓▒░░" },
  { left: '67%', opacity: 0.4, art: " ░\n░░\n▒░░\n▓▒░░\n█▓▒░░" },
  // --- small ---
  { left: '68%', opacity: 0.5, art: [
    "     ░",
    "    ░░",
    "   ▒░░░",
    "   ▒▒░░",
    "  ▒▒░░░",
    " ▓▒▒▒░░",
    " ▓▓▒▒░░░",
    "▓▓▒▒▒░░░",
    "██▓▒▒░░░░",
  ].join('\n') },
  { left: '72%', opacity: 0.35, art: " ░\n▒░░\n▓▒░\n█▓░░" },
  // --- medium ---
  { left: '73%', opacity: 0.6, art: [
    "       ░",
    "      ░░",
    "     ▒░░░",
    "     ▒▒░░",
    "    ▒▒▒░░░",
    "    ▓▒▒░░░",
    "   ▓▓▒▒░░░░",
    "   ▓▓▒▒▒░░░",
    "  ▓▓▓▒▒▒░░░░",
    "  ███▓▒▒▒░░░░",
    " ████▓▒▒▒░░░░░",
    "████▓▓▒▒▒░░░░░░",
  ].join('\n') },
  { left: '78%', opacity: 0.4, art: "  ░\n ▒░\n▓▒░░\n██▒░░" },
  // --- large ---
  { left: '79%', opacity: 0.7, art: [
    "          ░",
    "         ░░░",
    "         ▒░░",
    "        ▒▒░░░",
    "        ▒▒░░░",
    "       ▒▒▒░░░",
    "       ▒▒▒░░░░",
    "      ▓▒▒▒░░░░",
    "      ▓▒▒▒▒░░░░",
    "     ▓▓▒▒▒▒░░░░",
    "     ▓▓▒▒▒▒░░░░░",
    "    ▓▓▓▒▒▒▒░░░░░",
    "    ▓▓▓▓▒▒▒░░░░░░",
    "   ████▓▒▒▒▒░░░░░",
    "   ████▓▓▒▒▒░░░░░░",
    "  █████▓▓▒▒▒▒░░░░░░",
    "  ██████▓▒▒▒▒░░░░░░░",
    " ███████▓▓▒▒▒▒░░░░░░░",
    "████████▓▓▒▒▒▒░░░░░░░░",
  ].join('\n') },
  { left: '87%', opacity: 0.4, art: "  ░\n ▒░\n▓▒░░\n██▒░░" },
  { left: '88%', opacity: 0.45, art: " ░\n▒░░\n▓▒░░\n█▓▒░░" },
  // ========= RIGHT EDGE — tallest =========
  { left: '89%', opacity: 0.75, art: [
    "                 ░",
    "                ░░",
    "               ░░░",
    "               ▒░░",
    "              ▒░░░",
    "              ▒▒░░░",
    "             ▒▒░░░░",
    "             ▒▒▒░░░",
    "            ▒▒▒░░░░",
    "            ▒▒▒▒░░░░",
    "           ▒▒▒▒░░░░░",
    "          ▓▒▒▒▒░░░░░",
    "          ▓▓▒▒▒░░░░░",
    "         ▓▓▓▒▒▒▒░░░░░",
    "         ▓▓▓▒▒▒▒░░░░░░",
    "        ▓▓▓▓▒▒▒▒░░░░░░",
    "        ▓▓▓▓▒▒▒▒▒░░░░░░",
    "       ████▓▒▒▒▒▒░░░░░░",
    "       ████▓▓▒▒▒▒░░░░░░░",
    "      █████▓▓▒▒▒▒▒░░░░░░",
    "      ██████▓▒▒▒▒▒░░░░░░░",
    "     ██████▓▓▒▒▒▒▒░░░░░░░",
    "     ███████▓▓▒▒▒▒░░░░░░░░",
    "    ████████▓▓▒▒▒▒▒░░░░░░░",
    "    █████████▓▒▒▒▒▒░░░░░░░░",
    "   ██████████▓▓▒▒▒▒▒░░░░░░░░",
    "   ██████████▓▓▒▒▒▒▒░░░░░░░░░",
    "  ███████████▓▓▒▒▒▒▒░░░░░░░░░",
    "  ████████████▓▒▒▒▒▒░░░░░░░░░░",
    " █████████████▓▓▒▒▒▒▒░░░░░░░░░",
    " █████████████▓▓▒▒▒▒▒░░░░░░░░░░",
    "██████████████▓▓▒▒▒▒▒░░░░░░░░░░░",
  ].join('\n') },
  { left: '96%', opacity: 0.6, art: [
    "      ░",
    "     ░░",
    "    ▒░░░",
    "    ▒▒░░",
    "   ▒▒▒░░░",
    "   ▓▒▒░░░",
    "  ▓▓▒▒░░░░",
    "  ▓▓▒▒▒░░░",
    " ▓▓▓▒▒▒░░░░",
    " ███▓▒▒░░░░░",
    "████▓▒▒▒░░░░░",
  ].join('\n') },
];

const STALACTITES: { art: string; left: string; opacity: number }[] = [
  // ========= LEFT EDGE — tallest =========
  { left: '-2%', opacity: 0.7, art: [
    "██████████▓▓▒▒▒▒░░░░░░░░░",
    " █████████▓▒▒▒▒▒░░░░░░░░",
    " ████████▓▓▒▒▒▒░░░░░░░░",
    "  ███████▓▓▒▒▒▒░░░░░░░",
    "  ██████▓▓▒▒▒▒░░░░░░░",
    "   █████▓▒▒▒▒░░░░░░░",
    "   ████▓▓▒▒▒░░░░░░",
    "    ████▓▒▒▒░░░░░░",
    "    ▓▓▓▓▒▒▒░░░░░",
    "     ▓▓▓▒▒▒░░░░░",
    "     ▓▓▒▒▒░░░░",
    "      ▓▒▒▒░░░░",
    "      ▒▒▒░░░░",
    "       ▒▒░░░",
    "       ▒▒░░░",
    "        ▒░░",
    "        ░░░",
    "         ░░",
    "         ░",
  ].join('\n') },
  { left: '6%', opacity: 0.4, art: "██▒░░\n▓▒░░\n ▒░\n  ░" },
  { left: '8%', opacity: 0.45, art: "█▓▒░░\n▓▒░░\n▒░░\n ░" },
  // --- medium ---
  { left: '9%', opacity: 0.6, art: [
    "████▓▒▒▒░░░░░",
    " ███▓▒▒░░░░░",
    " ▓▓▓▒▒░░░░",
    "  ▓▓▒▒░░░░",
    "  ▓▒▒░░░",
    "   ▒▒░░░",
    "   ▒░░░",
    "    ▒░░",
    "    ░░",
    "     ░",
  ].join('\n') },
  { left: '17%', opacity: 0.35, art: "▓▒░\n▒░░\n ░" },
  { left: '18%', opacity: 0.4, art: "█▓▒░░\n▓▒░░\n ▒░\n  ░" },
  // --- small ---
  { left: '20%', opacity: 0.5, art: [
    "██▓▒▒░░░░",
    " ▓▓▒▒░░░",
    " ▓▒▒░░░",
    "  ▒▒░░",
    "  ▒░░",
    "   ░░",
    "   ░",
  ].join('\n') },
  { left: '26%', opacity: 0.35, art: "█▓▒░░\n▓▒░\n ▒░\n  ░" },
  { left: '28%', opacity: 0.4, art: "▓▒░░\n▒░░\n ░\n ░" },
  // --- small ---
  { left: '30%', opacity: 0.45, art: [
    "██▓▒░░░",
    " ▓▒▒░░",
    " ▒▒░░",
    "  ▒░░",
    "  ░░",
    "   ░",
  ].join('\n') },
  { left: '34%', opacity: 0.35, art: "▓▒░░\n▒░\n ░" },
  { left: '36%', opacity: 0.4, art: "█▓▒░░\n▓▒░\n ▒░\n  ░" },
  // ========= CENTER — tiny =========
  { left: '39%', opacity: 0.35, art: [
    "▓▒▒░░",
    " ▒░░",
    " ░░",
    "  ░",
  ].join('\n') },
  { left: '42%', opacity: 0.3, art: "▓▒░\n▒░\n ░" },
  { left: '45%', opacity: 0.35, art: "█▓░░\n▒░░\n ░" },
  { left: '48%', opacity: 0.3, art: "▒░░\n ░" },
  { left: '51%', opacity: 0.35, art: "▓▒░\n▒░░\n ░" },
  { left: '54%', opacity: 0.3, art: "█▓░░\n▒░\n ░" },
  { left: '57%', opacity: 0.35, art: [
    "▓▒▒░░",
    " ▒░░",
    " ░░",
    "  ░",
  ].join('\n') },
  { left: '60%', opacity: 0.3, art: "▒░░\n ░" },
  // ========= RIGHT SIDE — builds back up =========
  { left: '62%', opacity: 0.4, art: "█▓▒░░\n▓▒░\n ▒░\n  ░" },
  { left: '64%', opacity: 0.35, art: "▓▒░░\n▒░\n ░" },
  // --- small ---
  { left: '66%', opacity: 0.45, art: [
    "██▓▒░░░",
    " ▓▒▒░░",
    " ▒▒░░",
    "  ▒░░",
    "  ░░",
    "   ░",
  ].join('\n') },
  { left: '70%', opacity: 0.35, art: "▓▒░░\n▒░░\n ░" },
  { left: '72%', opacity: 0.4, art: "█▓▒░░\n▓▒░░\n ▒░\n  ░" },
  // --- small ---
  { left: '74%', opacity: 0.5, art: [
    "██▓▒▒░░░░",
    " ▓▓▒▒░░░",
    " ▓▒▒░░░",
    "  ▒▒░░",
    "  ▒░░",
    "   ░░",
    "   ░",
  ].join('\n') },
  { left: '79%', opacity: 0.35, art: "▓▒░\n▒░░\n ░" },
  { left: '80%', opacity: 0.4, art: "█▓▒░░\n▓▒░░\n ▒░\n  ░" },
  // --- medium ---
  { left: '82%', opacity: 0.6, art: [
    "████▓▒▒▒░░░░░",
    " ███▓▒▒░░░░░",
    " ▓▓▓▒▒░░░░",
    "  ▓▓▒▒░░░░",
    "  ▓▒▒░░░",
    "   ▒▒░░░",
    "   ▒░░░",
    "    ▒░░",
    "    ░░",
    "     ░",
  ].join('\n') },
  { left: '89%', opacity: 0.4, art: "█▓▒░░\n▓▒░░\n ▒░\n  ░" },
  { left: '90%', opacity: 0.45, art: "██▒░░\n▓▒░░\n ▒░\n  ░" },
  // ========= RIGHT EDGE — tallest =========
  { left: '91%', opacity: 0.7, art: [
    "██████████▓▓▒▒▒▒░░░░░░░░░",
    " █████████▓▒▒▒▒▒░░░░░░░░",
    " ████████▓▓▒▒▒▒░░░░░░░░",
    "  ███████▓▓▒▒▒▒░░░░░░░",
    "  ██████▓▓▒▒▒▒░░░░░░░",
    "   █████▓▒▒▒▒░░░░░░░",
    "   ████▓▓▒▒▒░░░░░░",
    "    ████▓▒▒▒░░░░░░",
    "    ▓▓▓▓▒▒▒░░░░░",
    "     ▓▓▓▒▒▒░░░░░",
    "     ▓▓▒▒▒░░░░",
    "      ▓▒▒▒░░░░",
    "      ▒▒▒░░░░",
    "       ▒▒░░░",
    "       ▒▒░░░",
    "        ▒░░",
    "        ░░░",
    "         ░░",
    "         ░",
  ].join('\n') },
];

const EYES: { left: string; top: string; delay: number; size: number }[] = [
  { left: '12%', top: '62%', delay: 0, size: 3 },
  { left: '82%', top: '58%', delay: 4.5, size: 3 },
  { left: '25%', top: '72%', delay: 8, size: 2 },
  { left: '71%', top: '68%', delay: 2.5, size: 2 },
  { left: '6%', top: '45%', delay: 11, size: 2 },
  { left: '91%', top: '48%', delay: 7, size: 2 },
  { left: '38%', top: '78%', delay: 14, size: 2 },
  { left: '58%', top: '76%', delay: 6, size: 2 },
  { left: '48%', top: '82%', delay: 10, size: 1.5 },
  { left: '16%', top: '32%', delay: 3, size: 2 },
  { left: '86%', top: '28%', delay: 9, size: 2 },
];

function CaveBackground() {
  return (
    <>
      <div className="lobby-cave-bg">
        {STALAGMITES.map((s, i) => (
          <pre key={i} style={{ left: s.left, opacity: s.opacity }}>{s.art}</pre>
        ))}
      </div>
      <div className="lobby-cave-top">
        {STALACTITES.map((s, i) => (
          <pre key={i} style={{ left: s.left, opacity: s.opacity }}>{s.art}</pre>
        ))}
      </div>
      {EYES.map((e, i) => (
        <div
          key={`eyes-${i}`}
          className="cave-eyes"
          style={{
            left: e.left,
            top: e.top,
            animationDelay: `${e.delay}s`,
            gap: `${e.size + 1}px`,
            fontSize: `${e.size}px`,
          }}
        >
          <span className="cave-eye" />
          <span className="cave-eye" />
        </div>
      ))}
    </>
  );
}

interface LobbyProps {
  onJoin: (name: string, roomCode?: string, className?: string) => void;
  onStart: (apiKey?: string, difficulty?: 'easy' | 'medium' | 'hard') => void;
  onSetDifficulty: (difficulty: 'easy' | 'medium' | 'hard') => void;
}

type LobbyScreen = 'name' | 'choose' | 'join_code' | 'waiting';

export function Lobby({ onJoin, onStart, onSetDifficulty }: LobbyProps) {
  const [name, setName] = useState('');
  const [screen, setScreen] = useState<LobbyScreen>('name');
  const [codeInput, setCodeInput] = useState('');
  const [selectedClass, setSelectedClass] = useState('vanguard');
  const [apiKey, setApiKey] = useState('');
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers);
  const isHost = useGameStore((s) => s.isHost);
  const difficulty = useGameStore((s) => s.lobbyDifficulty);
  const roomCode = useGameStore((s) => s.roomCode);

  useEffect(() => {
    if (roomCode) setScreen('waiting');
  }, [roomCode]);

  const handleNameSubmit = useCallback(() => {
    if (name.trim()) setScreen('choose');
  }, [name]);

  useEffect(() => {
    if (screen !== 'name') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNameSubmit();
      } else if (e.key === 'Backspace') {
        setName((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        setName((prev) => (prev.length < 20 ? prev + e.key : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, handleNameSubmit]);

  useEffect(() => {
    if (screen !== 'join_code') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && codeInput.length === 4) {
        onJoin(name.trim(), codeInput.toUpperCase(), selectedClass);
      } else if (e.key === 'Backspace') {
        setCodeInput((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setScreen('choose');
        setCodeInput('');
      } else if (/^[a-zA-Z]$/.test(e.key) && codeInput.length < 4) {
        setCodeInput((prev) => prev + e.key.toUpperCase());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, codeInput, name, onJoin]);

  if (screen === 'name') {
    return (
      <div className="lobby">
        <CaveBackground />
        <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
        <p className="lobby-subtitle">A cooperative dungeon crawler</p>
        <p className="dos-prompt-label">&gt; ENTER YOUR NAME_</p>
        <div className="dos-input">
          <span className="dos-input-text">{name}</span>
          <span className="dos-cursor" />
        </div>
        <button onClick={handleNameSubmit} disabled={!name.trim()}>
          Continue
        </button>
      </div>
    );
  }

  if (screen === 'choose') {
    return (
      <div className="lobby">
        <CaveBackground />
        <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
        <p className="lobby-subtitle">Welcome, {name.trim()}</p>

        <div className="class-selector">
          <p className="lobby-label">Choose your class:</p>
          <div className="class-options">
            {CLASS_DEFINITIONS.map((cls) => (
              <button
                key={cls.id}
                className={`class-btn ${selectedClass === cls.id ? 'class-selected' : ''}`}
                onClick={() => setSelectedClass(cls.id)}
              >
                <span className="class-name">{cls.displayName}</span>
                <span className="class-desc">{cls.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-choose">
          <button className="lobby-start" onClick={() => onJoin(name.trim(), undefined, selectedClass)}>
            Create Lobby
          </button>
          <button className="lobby-start" onClick={() => setScreen('join_code')}>
            Join Lobby
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'join_code') {
    return (
      <div className="lobby">
        <CaveBackground />
        <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
        <p className="lobby-subtitle">Enter room code</p>
        <div className="room-code-input">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`code-char ${codeInput[i] ? 'filled' : ''}`}>
              {codeInput[i] || '_'}
            </span>
          ))}
        </div>
        <div className="lobby-choose">
          <button onClick={() => onJoin(name.trim(), codeInput.toUpperCase(), selectedClass)} disabled={codeInput.length !== 4}>
            Join
          </button>
          <button className="back-btn" onClick={() => { setScreen('choose'); setCodeInput(''); }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Waiting for players...</p>
      {roomCode && (
        <div className="room-code-display">
          <span className="lobby-label">Room Code:</span>
          <span className="room-code">{roomCode}</span>
        </div>
      )}
      <div className="lobby-players">
        {lobbyPlayers.map((p) => (
          <div key={p.id} className="lobby-player">
            <span>{p.name}</span>
            <span className="lobby-player-class">{p.className}</span>
          </div>
        ))}
      </div>

      <div className="lobby-difficulty">
        <span className="lobby-label">Difficulty:</span>
        <div className="difficulty-buttons">
          {(['easy', 'medium', 'hard'] as const).map((d) => (
            <button
              key={d}
              className={`difficulty-btn ${d === difficulty ? 'active' : ''}`}
              onClick={() => onSetDifficulty(d)}
              disabled={!isHost}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isHost && (
        <div className="lobby-apikey">
          <label className="lobby-label" htmlFor="apikey-input">
            API Key (optional):
          </label>
          <input
            id="apikey-input"
            type="password"
            className="apikey-input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
          />
          <p className="apikey-hint">Leave empty to play the static dungeon</p>
        </div>
      )}

      {isHost && (
        <button
          className="lobby-start"
          onClick={() => onStart(apiKey || undefined, difficulty)}
          disabled={lobbyPlayers.length === 0}
        >
          Enter the Caverns
        </button>
      )}
      {!isHost && <p className="lobby-waiting">Waiting for host to start...</p>}
    </div>
  );
}
