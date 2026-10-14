/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { X, Smartphone, Copy, Check, Radio, Volume2, CloudCheck, ExternalLink, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { SongProject } from '../types/rhythm';

interface ShareMobileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: SongProject;
  samplesCount: number;
}

export const ShareMobileModal: React.FC<ShareMobileModalProps> = ({
  isOpen,
  onClose,
  currentProject,
  samplesCount,
}) => {
  const [syncQrDataUrl, setSyncQrDataUrl] = useState<string>('');
  const [copiedSync, setCopiedSync] = useState(false);
  const [copiedApp, setCopiedApp] = useState(false);
  const [syncUrl, setSyncUrl] = useState<string>('');
  const [appUrl, setAppUrl] = useState<string>('');
  const [syncMode, setSyncMode] = useState<'current_rhythm' | 'app_home'>('current_rhythm');

  useEffect(() => {
    if (!isOpen) return;
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const base = `${origin}${pathname}`;
    setAppUrl(base);

    // Create a compact payload of the current project (without heavy Blobs, just pattern and tracks)
    try {
      const compactProject = {
        ...currentProject,
        tracks: currentProject.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          soundType: t.soundType,
          color: t.color,
          volume: t.volume,
          pan: t.pan,
          tune: t.tune,
          decay: t.decay,
          tone: t.tone,
          customSampleId: t.customSampleId,
          customSampleName: t.customSampleName,
          muted: t.muted,
          solo: t.solo,
        })),
      };
      const encoded = encodeURIComponent(JSON.stringify(compactProject));
      const fullSyncUrl = `${base}#sync=${encoded}`;
      setSyncUrl(fullSyncUrl);

      // Generate QR Code for direct rhythm sync (if fits in QR), otherwise app URL
      const targetUrlForQr = fullSyncUrl.length <= 2500 ? fullSyncUrl : base;
      QRCode.toDataURL(targetUrlForQr, {
        width: 280,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((dataUrl) => setSyncQrDataUrl(dataUrl))
        .catch(() => {
          // Fallback to base url if payload was too large for QR
          QRCode.toDataURL(base, { width: 280, margin: 1.5 }).then((url) => setSyncQrDataUrl(url));
        });
    } catch {
      setSyncUrl(base);
      QRCode.toDataURL(base, { width: 280, margin: 1.5 }).then((url) => setSyncQrDataUrl(url));
    }
  }, [isOpen, currentProject]);

  if (!isOpen) return null;

  const handleCopySyncLink = () => {
    navigator.clipboard.writeText(syncUrl);
    setCopiedSync(true);
    setTimeout(() => setCopiedSync(false), 2500);
  };

  const handleCopyAppLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopiedApp(true);
    setTimeout(() => setCopiedApp(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f172a] border border-amber-400/40 rounded-2xl w-full max-w-lg shadow-[0_0_50px_rgba(245,158,11,0.25)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-400/10 text-amber-400 border border-amber-400/30">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Sincronizar PC ➔ Celular
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  Direto & Sem Perdas
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Transfira o ritmo atualizado do PC para o celular imediatamente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Target Rhythm Badge */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase text-amber-400 font-bold">Ritmo a Enviar do PC:</div>
              <div className="text-sm font-bold text-white">&ldquo;{currentProject.name}&rdquo;</div>
              <div className="text-xs text-slate-300">
                {currentProject.tracks.length} trilhas organizadas • {currentProject.bpm} BPM • {currentProject.barsCount || 1} comp.
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-md font-mono border border-emerald-500/30">
                Pronto para Celular
              </span>
            </div>
          </div>

          {/* QR Code and Quick Scan */}
          <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-950/70 border border-slate-800 rounded-xl p-4">
            <div className="bg-white p-2 rounded-xl shadow-md shrink-0 flex items-center justify-center">
              {syncQrDataUrl ? (
                <img
                  src={syncQrDataUrl}
                  alt="QR Code de Sincronização para celular"
                  className="w-36 h-36 rounded-lg object-contain"
                />
              ) : (
                <div className="w-36 h-36 flex items-center justify-center text-slate-400 text-xs">
                  <QrCode className="w-8 h-8 animate-pulse text-slate-500" />
                </div>
              )}
            </div>

            <div className="space-y-2.5 flex-1 w-full">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span>Passo 1: Aponte a Câmera do Celular</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ao escanear com a câmera, o celular abre o aplicativo e <strong>carrega automaticamente este ritmo com a ordem das trilhas do seu PC</strong>.
              </p>
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  onClick={handleCopySyncLink}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    copiedSync
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-sm'
                  }`}
                >
                  {copiedSync ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Link com Ritmo Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar Link do Ritmo (WhatsApp)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Sync info banner */}
          <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-3.5 flex items-start gap-3">
            <CloudCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <span className="font-bold text-emerald-300">
                Proteção Ativa contra Sobrescrita no Vercel
              </span>
              <p className="text-slate-300">
                Seu PC nunca mais perderá as modificações para o esquema antigo do Vercel. O celular agora recebe as atualizações diretamente do seu computador!
              </p>
              <p className="text-slate-400 text-[11px]">
                {currentProject.tracks.length} pistas configuradas com {samplesCount} sons de áudio salvos. Ao abrir no celular, o ritmo carrega automaticamente sem precisar recriar!
              </p>
            </div>
          </div>

          {/* Mobile instructions */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Instruções para tocar no Celular:
            </h4>

            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                <Volume2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-white block">1. Toque na tela para ativar o áudio</span>
                  <span className="text-slate-400">
                    Sistemas mobile (Android e iOS) exigem 1 toque na tela para liberar o alto-falante.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                <Radio className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-white block">2. Pedal Cuvave Cube Turner Pro no Celular</span>
                  <span className="text-slate-400">
                    No celular, conecte o pedal via Bluetooth. Qualquer toque no pedal agora dispara o ritmo, viradas e acentos com resposta imediata.
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                <span className="font-bold block text-amber-200">3. Sincronização no Vercel:</span>
                <span className="text-slate-300">
                  Os 8 samples de percussão padrão carregam automaticamente no celular. Para sincronizar ritmos modificados ou novos samples gravados no Vercel, faça login com o Google no botão do topo em ambos os aparelhos ou use a opção <strong>Exportar Kit</strong> na aba de Samples.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg transition-all cursor-pointer shadow-sm"
          >
            Entendido, fechar
          </button>
        </div>
      </div>
    </div>
  );
};
