/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  Sliders,
  Trash2,
  Plus,
  Play,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import {
  SongPartId,
  StepData,
  TrackDefinition,
  RhythmicResolution,
  cleanInstrumentName,
} from '../types/rhythm';
import { TRACK_COLOR_PALETTE } from './SampleManagerModal';

interface SequencerGridProps {
  tracks: TrackDefinition[];
  partSteps: Record<string, StepData[]>;
  partStepCounts?: Record<string, number>;
  activePartId: SongPartId;
  playingTick: number;
  activeTrackSteps: Record<string, number>;
  isPlaying: boolean;
  resolution?: RhythmicResolution;
  barsCount?: number;
  timeSignature?: string;
  onResolutionChange?: (res: RhythmicResolution) => void;
  onBarsCountChange?: (bars: number) => void;
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onUpdateStep: (trackId: string, stepIndex: number, stepData: Partial<StepData>) => void;
  onUpdateTrackLength: (trackId: string, newLength: number) => void;
  onUpdateTrackVolume: (trackId: string, vol: number) => void;
  onUpdateTrackPan: (trackId: string, pan: number) => void;
  onToggleTrackMute: (trackId: string) => void;
  onToggleTrackSolo: (trackId: string) => void;
  onTriggerTrack: (trackDef: TrackDefinition) => void;
  onOpenTrackSettings: (trackDef: TrackDefinition) => void;
  onDeleteTrack: (trackId: string) => void;
  onRemoveTrackSample?: (trackId: string) => void;
  onMoveTrack?: (trackId: string, direction: 'up' | 'down') => void;
  onUpdateTrackColor?: (trackId: string, color: string) => void;
  onUpdateTrackName?: (trackId: string, name: string) => void;
  onAddTrackClick: () => void;
}

export const SequencerGrid: React.FC<SequencerGridProps> = ({
  tracks,
  partSteps,
  partStepCounts: _partStepCounts,
  activePartId: _activePartId,
  playingTick: _playingTick,
  activeTrackSteps,
  isPlaying,
  resolution = '1/32',
  barsCount = 1,
  timeSignature = '4/4',
  onResolutionChange,
  onBarsCountChange: _onBarsCountChange,
  onToggleStep,
  onUpdateStep,
  onUpdateTrackLength: _onUpdateTrackLength,
  onUpdateTrackVolume: _onUpdateTrackVolume,
  onUpdateTrackPan: _onUpdateTrackPan,
  onToggleTrackMute,
  onToggleTrackSolo,
  onTriggerTrack,
  onOpenTrackSettings,
  onDeleteTrack,
  onRemoveTrackSample,
  onMoveTrack,
  onUpdateTrackColor,
  onUpdateTrackName,
  onAddTrackClick,
}) => {
  // Currently inspected step for micro-editing modal (right-click)
  const [inspectedStep, setInspectedStep] = useState<{
    trackId: string;
    stepIndex: number;
  } | null>(null);

  // Velocity drag state for real-time humanization
  const [draggingVelocity, setDraggingVelocity] = useState<{
    trackId: string;
    stepIndex: number;
    velocity: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    trackId: string;
    stepIndex: number;
    startY: number;
    startX: number;
    initialVelocity: number;
    hasDragged: boolean;
  } | null>(null);

  // Quick inline rename state
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [tempTrackName, setTempTrackName] = useState<string>('');

  // Quick color picker state
  const [colorPickerTrackId, setColorPickerTrackId] = useState<string | null>(null);

  // Subdivisões por tempo
  // 1/64: 16 subdivisões por tempo (Semifusa)
  // 1/32: 8 subdivisões por tempo (Fusa)
  // 1/16: 4 subdivisões por tempo (Semicolcheia)
  const subPerBeat =
    resolution === '1/64'
      ? 16
      : resolution === '1/16'
      ? 4
      : resolution === '1/8'
      ? 2
      : 8;

  const beatsPerBar =
    timeSignature === '3/4'
      ? 3
      : timeSignature === '5/4'
      ? 5
      : timeSignature === '7/8'
      ? 7
      : timeSignature === '6/8'
      ? 6
      : timeSignature === '12/8'
      ? 12
      : 4;

  const stepsPerBar =
    timeSignature === '3/4'
      ? 3 * subPerBeat
      : timeSignature === '6/8'
      ? Math.max(6, Math.round(6 * (subPerBeat / 2)))
      : timeSignature === '7/8'
      ? Math.max(7, Math.round(7 * (subPerBeat / 2)))
      : timeSignature === '12/8'
      ? Math.max(12, Math.round(12 * (subPerBeat / 4)))
      : beatsPerBar * subPerBeat;

  const totalBars = barsCount || 1;
  const totalDisplaySteps =
    resolution === '1/64' ? 64 : Math.min(64, stepsPerBar * totalBars);

  // Pointer drag event handlers for adjusting velocity
  const handleStepPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    trackId: string,
    stepIdx: number,
    step?: StepData
  ) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const initialVel = step?.active ? step.velocity ?? 90 : 90;
    dragRef.current = {
      pointerId: e.pointerId,
      trackId,
      stepIndex: stepIdx,
      startY: e.clientY,
      startX: e.clientX,
      initialVelocity: initialVel,
      hasDragged: false,
    };
  };

  const handleStepPointerMove = (
    e: React.PointerEvent<HTMLButtonElement>,
    trackId: string,
    stepIdx: number
  ) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;

    const deltaY = current.startY - e.clientY; // Upwards is positive

    if (!current.hasDragged) {
      if (Math.abs(deltaY) > 3) {
        current.hasDragged = true;
      } else {
        return;
      }
    }

    const newVel = Math.round(
      Math.min(127, Math.max(10, current.initialVelocity + deltaY * 1.1))
    );

    setDraggingVelocity({
      trackId,
      stepIndex: stepIdx,
      velocity: newVel,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    onUpdateStep(trackId, stepIdx, { active: true, velocity: newVel });
  };

  const handleStepPointerUp = (
    e: React.PointerEvent<HTMLButtonElement>,
    trackId: string,
    stepIdx: number
  ) => {
    const current = dragRef.current;
    if (current && current.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}

      if (!current.hasDragged) {
        onToggleStep(trackId, stepIdx);
      }
      dragRef.current = null;
      setDraggingVelocity(null);
    }
  };

  const handleStepPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (current && current.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      dragRef.current = null;
      setDraggingVelocity(null);
    }
  };

  return (
    <div className="flex-1 overflow-x-auto p-4 sm:p-6 bg-[#090d16]">
      <div
        className="space-y-3"
        style={{ minWidth: totalDisplaySteps > 32 ? '1420px' : '980px' }}
      >
        {/* Step Numbers & Bars Header */}
        <div className="space-y-2 pb-1 border-b border-slate-800/80">
          {/* Quick Resolution Selector & Humanize Dica */}
          <div className="flex items-center justify-between gap-3 pb-1 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 pl-1">
                Subdivisão da Grade:
              </span>
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => onResolutionChange?.('1/32')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    resolution === '1/32'
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  1/32 (Fusa • 32 notas)
                </button>
                <button
                  type="button"
                  onClick={() => onResolutionChange?.('1/64')}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    resolution === '1/64'
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  1/64 (Semifusa • 64 notas)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-400 pr-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                <strong className="text-amber-300">Humanização Dinâmica:</strong>{' '}
                Clique e arraste a nota para cima (&uarr;) ou baixo (&darr;) para ajustar o velocity!
              </span>
            </div>
          </div>

          {/* Compassos (Bars) Banner Row */}
          <div className="flex items-center gap-2">
            <div className="w-[260px] shrink-0 text-xs font-semibold text-slate-400 pl-2">
              Divisão de Compassos ({resolution})
            </div>
            <div
              className="flex-1 gap-1"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${totalDisplaySteps}, minmax(${
                  totalDisplaySteps > 32 ? '17px' : '22px'
                }, 1fr))`,
              }}
            >
              {Array.from({ length: totalBars }, (_, bIdx) => {
                const barStart = bIdx * stepsPerBar;
                const barSpan = Math.min(stepsPerBar, totalDisplaySteps - barStart);
                if (barSpan <= 0) return null;
                return (
                  <div
                    key={bIdx}
                    style={{ gridColumn: `span ${barSpan}` }}
                    className={`py-1 text-center font-bold text-[11px] rounded-md border flex items-center justify-center gap-1.5 transition-colors ${
                      bIdx % 2 === 0
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    }`}
                  >
                    <span>Compasso #{bIdx + 1}</span>
                    <span className="text-[10px] opacity-75 font-mono">
                      ({barSpan} notas • {barStart + 1} a {barStart + barSpan})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Individual Step Numbers & Beats */}
          <div className="flex items-center gap-2">
            <div className="w-[260px] shrink-0 text-[11px] text-slate-500 pl-2 font-mono">
              Tempo / Subdivisão
            </div>
            <div
              className="flex-1 gap-1 font-mono text-[9px] text-slate-400 text-center"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${totalDisplaySteps}, minmax(${
                  totalDisplaySteps > 32 ? '17px' : '22px'
                }, 1fr))`,
              }}
            >
              {Array.from({ length: totalDisplaySteps }, (_, i) => {
                const isDownbeat = i % subPerBeat === 0;
                const barNum = Math.floor(i / stepsPerBar) + 1;
                const beatNum = Math.floor((i % stepsPerBar) / subPerBeat) + 1;
                const subInBeat = (i % subPerBeat) + 1;

                return (
                  <div
                    key={i}
                    title={`Compasso ${barNum}, Tempo ${beatNum}.${subInBeat} (Nota #${i + 1})`}
                    className={`py-0.5 rounded truncate px-0.5 ${
                      isDownbeat
                        ? 'bg-slate-800/90 text-amber-300 font-bold border border-slate-700/80 shadow-xs'
                        : 'bg-slate-950/40 text-slate-500'
                    }`}
                  >
                    <span>
                      {isDownbeat || subInBeat === 1 || subInBeat === Math.floor(subPerBeat / 2) + 1
                        ? `${beatNum}.${subInBeat}`
                        : `${subInBeat}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tracks List */}
        {tracks.map((track, trackIdx) => {
          const steps = partSteps[track.id] || [];
          const activeStepIdx = activeTrackSteps[track.id];

          return (
            <div
              key={track.id}
              className="group flex items-center gap-2 p-2 rounded-xl bg-[#0f172a]/90 hover:bg-[#131d35] border border-slate-800 transition-colors"
            >
              {/* Track Controls (Left Panel) */}
              <div className="w-[260px] shrink-0 flex items-center justify-between gap-2 bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {/* Up / Down Reorder Buttons */}
                  {onMoveTrack && tracks.length > 1 && (
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        title={trackIdx === 0 ? 'Já está no topo' : 'Mover trilha para cima'}
                        disabled={trackIdx === 0}
                        onClick={() => onMoveTrack(track.id, 'up')}
                        className="w-4 h-3.5 flex items-center justify-center rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title={
                          trackIdx === tracks.length - 1
                            ? 'Já está no fim'
                            : 'Mover trilha para baixo'
                        }
                        disabled={trackIdx === tracks.length - 1}
                        onClick={() => onMoveTrack(track.id, 'down')}
                        className="w-4 h-3.5 flex items-center justify-center rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 disabled:opacity-20 disabled:pointer-events-none transition-colors cursor-pointer"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Play audition button */}
                  <button
                    type="button"
                    title="Ouvir som deste instrumento"
                    onClick={() => onTriggerTrack(track)}
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 border border-slate-700 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                    style={{ backgroundColor: `${track.color}25`, borderColor: track.color }}
                  >
                    <Play className="w-3.5 h-3.5" style={{ color: track.color }} />
                  </button>

                  {/* Instrument Name, Clean Label & Color Picker */}
                  <div className="min-w-0 flex-1 relative">
                    <div className="flex items-center gap-1.5">
                      {/* Color Dot Button with Quick Color Picker Popover */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          title="Clique para escolher a cor desta trilha"
                          onClick={() =>
                            setColorPickerTrackId(
                              colorPickerTrackId === track.id ? null : track.id
                            )
                          }
                          className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/30 hover:scale-125 transition-transform cursor-pointer shadow-xs block"
                          style={{ backgroundColor: track.color }}
                        />
                        {colorPickerTrackId === track.id && (
                          <div className="absolute left-0 top-6 z-40 p-2.5 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col gap-1.5 w-48 animate-in fade-in zoom-in-95 duration-100">
                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 border-b border-slate-800 pb-1">
                              <span>Cor da Trilha</span>
                              <button
                                type="button"
                                onClick={() => setColorPickerTrackId(null)}
                                className="text-slate-400 hover:text-white cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {TRACK_COLOR_PALETTE.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => {
                                    onUpdateTrackColor?.(track.id, c);
                                    setColorPickerTrackId(null);
                                  }}
                                  className={`w-8 h-8 rounded-md border transition-transform hover:scale-110 cursor-pointer ${
                                    track.color.toLowerCase() === c.toLowerCase()
                                      ? 'border-white ring-2 ring-white/50 scale-105'
                                      : 'border-transparent'
                                  }`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Instrument Name with Inline Rename */}
                      {editingTrackId === track.id ? (
                        <input
                          type="text"
                          value={tempTrackName}
                          onChange={(e) => setTempTrackName(e.target.value)}
                          onBlur={() => {
                            if (tempTrackName.trim()) {
                              onUpdateTrackName?.(track.id, tempTrackName.trim());
                            }
                            setEditingTrackId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (tempTrackName.trim()) {
                                onUpdateTrackName?.(track.id, tempTrackName.trim());
                              }
                              setEditingTrackId(null);
                            } else if (e.key === 'Escape') {
                              setEditingTrackId(null);
                            }
                          }}
                          autoFocus
                          className="bg-slate-900 border border-amber-400 text-xs px-1.5 py-0.5 rounded text-white font-bold w-28 focus:outline-none"
                        />
                      ) : (
                        <div className="flex items-center gap-1 group/name min-w-0">
                          <button
                            type="button"
                            title="Clique para editar o nome ou som deste instrumento"
                            onClick={() => {
                              setEditingTrackId(track.id);
                              setTempTrackName(cleanInstrumentName(track.name));
                            }}
                            className="text-xs font-bold text-white hover:text-amber-300 truncate max-w-[110px] text-left cursor-pointer transition-colors"
                          >
                            {cleanInstrumentName(track.name)}
                          </button>
                          <button
                            type="button"
                            title="Renomear instrumento"
                            onClick={() => {
                              setEditingTrackId(track.id);
                              setTempTrackName(cleanInstrumentName(track.name));
                            }}
                            className="opacity-0 group-hover/name:opacity-100 text-slate-500 hover:text-amber-400 transition-opacity p-0.5 cursor-pointer"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}

                      {/* Remove sample button if custom sample attached */}
                      {track.customSampleName && (
                        <button
                          type="button"
                          title="Remover sample customizado desta pista"
                          onClick={() => onRemoveTrackSample?.(track.id)}
                          className="text-slate-500 hover:text-rose-400 p-0.5 rounded cursor-pointer ml-auto"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block truncate">
                      {track.customSampleName
                        ? 'Sample de Áudio'
                        : track.category !== 'custom'
                        ? track.category
                        : 'Percussão'}
                    </span>
                  </div>
                </div>

                {/* Right controls inside track panel: Mute, Solo, Sound Settings & Delete */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Mute button */}
                  <button
                    type="button"
                    title={track.muted ? 'Desmutar' : 'Mutar'}
                    onClick={() => onToggleTrackMute(track.id)}
                    className={`w-6 h-6 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                      track.muted
                        ? 'bg-rose-500 text-slate-950 font-extrabold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    M
                  </button>

                  {/* Solo button */}
                  <button
                    type="button"
                    title={track.solo ? 'Desativar Solo' : 'Solo'}
                    onClick={() => onToggleTrackSolo(track.id)}
                    className={`w-6 h-6 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                      track.solo
                        ? 'bg-amber-400 text-slate-950 font-extrabold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    S
                  </button>

                  {/* Sound & Sample Editor Settings */}
                  <button
                    type="button"
                    title="Ajustar som ou trocar sample"
                    onClick={() => onOpenTrackSettings(track)}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete track */}
                  {tracks.length > 1 && (
                    <button
                      type="button"
                      title="Excluir pista"
                      onClick={() => onDeleteTrack(track.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Step Pads Matrix */}
              <div
                className="flex-1 gap-1"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${totalDisplaySteps}, minmax(${
                    totalDisplaySteps > 32 ? '17px' : '22px'
                  }, 1fr))`,
                }}
              >
                {Array.from({ length: totalDisplaySteps }, (_, stepIdx) => {
                  const step = steps[stepIdx];
                  const isActive = step?.active ?? false;
                  const isPlayhead = isPlaying && activeStepIdx === stepIdx;
                  const isBeatDown = stepIdx % subPerBeat === 0;

                  // Dynamic velocity visuals
                  const velocity = step?.velocity ?? 90;
                  const isAccent = isActive && velocity >= 115;
                  const isGhost = isActive && velocity <= 65;
                  const ratchet = step?.ratchet ?? 1;

                  return (
                    <button
                      key={stepIdx}
                      type="button"
                      onPointerDown={(e) => handleStepPointerDown(e, track.id, stepIdx, step)}
                      onPointerMove={(e) => handleStepPointerMove(e, track.id, stepIdx)}
                      onPointerUp={(e) => handleStepPointerUp(e, track.id, stepIdx)}
                      onPointerCancel={handleStepPointerCancel}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setInspectedStep({ trackId: track.id, stepIndex: stepIdx });
                      }}
                      className={`relative h-11 rounded-lg border transition-all duration-75 flex flex-col items-center justify-center cursor-ns-resize select-none overflow-hidden ${
                        isActive
                          ? isAccent
                            ? 'shadow-[0_0_12px_rgba(245,158,11,0.5)] border-amber-300 font-bold'
                            : isGhost
                            ? 'bg-slate-800/80 border-slate-600 text-slate-300'
                            : 'border-slate-300/80 text-white font-semibold'
                          : isBeatDown
                          ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                          : 'bg-slate-950/60 border-slate-900 hover:border-slate-800'
                      } ${
                        isPlayhead ? 'ring-2 ring-white scale-[1.05] z-10' : ''
                      }`}
                      style={{
                        touchAction: 'none',
                        backgroundColor: isActive
                          ? isGhost
                            ? `${track.color}35`
                            : `${track.color}20`
                          : undefined,
                        borderColor: isActive
                          ? isAccent
                            ? '#fbbf24'
                            : track.color
                          : undefined,
                      }}
                    >
                      {/* DAW-Style Vertical Velocity Meter Fill */}
                      {isActive && (
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-b-[7px] pointer-events-none transition-[height] duration-75"
                          style={{
                            height: `${Math.max(15, Math.min(100, (velocity / 127) * 100))}%`,
                            backgroundColor: isAccent
                              ? '#fbbf24'
                              : isGhost
                              ? '#64748b'
                              : track.color,
                            opacity: isGhost ? 0.45 : isAccent ? 0.95 : 0.85,
                          }}
                        />
                      )}

                      {/* Step Indicator and Velocity Label */}
                      {isActive && (
                        <div className="relative z-10 flex flex-col items-center justify-between h-full py-0.5 pointer-events-none">
                          <div className="flex items-center gap-0.5">
                            {isAccent && (
                              <span className="text-[9px] font-black leading-none text-amber-300 drop-shadow-xs">
                                ▲
                              </span>
                            )}
                            {isGhost && (
                              <span className="text-[9px] font-mono leading-none text-slate-300">
                                g
                              </span>
                            )}
                            {ratchet > 1 && (
                              <span className="text-[7px] font-bold px-1 rounded bg-black/60 text-white leading-none">
                                {ratchet}x
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[8px] font-mono leading-none font-bold ${
                              isAccent ? 'text-amber-300' : 'text-white drop-shadow-xs'
                            }`}
                          >
                            {velocity}
                          </span>
                        </div>
                      )}

                      {/* Ghost dot if inactive */}
                      {!isActive && (
                        <div
                          className={`w-1.5 h-1.5 rounded-full pointer-events-none ${
                            isBeatDown ? 'bg-slate-700' : 'bg-slate-800'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Add Track & Percussion Button */}
        <div className="pt-3">
          <button
            type="button"
            onClick={onAddTrackClick}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-700 hover:border-amber-400 bg-slate-950/40 hover:bg-slate-900/60 text-slate-300 hover:text-amber-400 transition-all text-xs font-semibold cursor-pointer w-full justify-center"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Novo Instrumento ou Enviar Sample Próprio</span>
          </button>
        </div>
      </div>

      {/* Real-time Dynamic Drag Velocity HUD Floating Tooltip */}
      {draggingVelocity && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full mb-3 bg-slate-950/95 border border-amber-400 text-white rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md flex flex-col items-center gap-1 min-w-[130px] animate-in fade-in zoom-in-95 duration-75"
          style={{
            left: draggingVelocity.clientX,
            top: draggingVelocity.clientY - 12,
          }}
        >
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
            <span className="text-amber-400">Velocity:</span>
            <span className="text-white text-sm font-black">{draggingVelocity.velocity}</span>
            <span className="text-slate-400 text-[10px]">
              ({Math.round((draggingVelocity.velocity / 127) * 100)}%)
            </span>
          </div>
          <div className="text-[10px] font-semibold">
            {draggingVelocity.velocity >= 115 ? (
              <span className="text-amber-300">🔥 Acento (Forte)</span>
            ) : draggingVelocity.velocity <= 65 ? (
              <span className="text-slate-400">👻 Ghost Note (Suave)</span>
            ) : (
              <span className="text-emerald-400">🎵 Normal</span>
            )}
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/80">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 rounded-full transition-all duration-75"
              style={{ width: `${(draggingVelocity.velocity / 127) * 100}%` }}
            />
          </div>
          <span className="text-[9px] text-slate-400 font-sans mt-0.5">
            &uarr; mais forte | &darr; mais suave
          </span>
        </div>
      )}

      {/* Micro Step Editor Modal */}
      {inspectedStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Micro-Edição do Passo #{inspectedStep.stepIndex + 1}</span>
              </h4>
              <button
                type="button"
                onClick={() => setInspectedStep(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {(() => {
              const currentStep =
                partSteps[inspectedStep.trackId]?.[inspectedStep.stepIndex] || {
                  active: true,
                  velocity: 90,
                  probability: 1.0,
                  ratchet: 1,
                };

              return (
                <div className="space-y-4 text-xs">
                  {/* Velocity Slider */}
                  <div>
                    <div className="flex justify-between text-slate-300 font-semibold mb-1">
                      <span>Intensidade (Velocity 1-127):</span>
                      <span className="font-mono text-amber-400">
                        {currentStep.velocity}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={127}
                      value={currentStep.velocity}
                      onChange={(e) =>
                        onUpdateStep(inspectedStep.trackId, inspectedStep.stepIndex, {
                          velocity: Number(e.target.value),
                        })
                      }
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                      <span>Ghost (50)</span>
                      <span>Normal (90)</span>
                      <span>Acento (125)</span>
                    </div>
                  </div>

                  {/* Ratchet / Rolls */}
                  <div>
                    <div className="text-slate-300 font-semibold mb-1">
                      Subdivisão / Rolo (Ratchet):
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[1, 2, 3, 4].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() =>
                            onUpdateStep(inspectedStep.trackId, inspectedStep.stepIndex, {
                              ratchet: r,
                            })
                          }
                          className={`py-1.5 rounded-lg border font-mono font-bold cursor-pointer transition-colors ${
                            currentStep.ratchet === r
                              ? 'bg-amber-400 text-slate-950 border-amber-300'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                          }`}
                        >
                          {r === 1 ? '1x (Único)' : `${r}x (Rolo)`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Probability */}
                  <div>
                    <div className="flex justify-between text-slate-300 font-semibold mb-1">
                      <span>Probabilidade de Disparo:</span>
                      <span className="font-mono text-cyan-400">
                        {Math.round((currentStep.probability ?? 1.0) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round((currentStep.probability ?? 1.0) * 100)}
                      onChange={(e) =>
                        onUpdateStep(inspectedStep.trackId, inspectedStep.stepIndex, {
                          probability: Number(e.target.value) / 100,
                        })
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
