import React, { useEffect, useState } from 'react';
import { Menu, Shield, Search, Moon, Sun, Wifi, WifiOff, RefreshCw, Zap, Bell, ChevronDown, Check, UserCheck } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';

// Public assets are prefixed with the Vite base so the build also works from a
// repo subpath (GitHub Pages); same pattern as src/engine/detectors.js.
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;

export default function Header() {
  const { isDarkMode, toggleTheme, themeStyles } = useTheme();
  const {
    searchQuery,
    setSearchQuery,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isWsConnected,
    isReconnecting,
    activeOperator,
    availableOperators,
    switchOperator,
    operatorName,
    setOperatorName,
    simulateIncomingWsEvent,
    toggleWsSimulation
  } = useSecurity();

  const [showDemoMenu, setShowDemoMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [operatorDraft, setOperatorDraft] = useState(operatorName);

  useEffect(() => {
    setOperatorDraft(operatorName);
  }, [operatorName]);

  const commitOperator = () => {
    setOperatorName(operatorDraft);
  };

  return (
    <header
      style={{
        backgroundColor: themeStyles.navBg || (isDarkMode ? '#181818' : '#FFFFFF'),
        borderColor: themeStyles.navBorder || (isDarkMode ? 'rgba(255, 255, 255, 0.10)' : '#E5E7EB'),
        color: isDarkMode ? '#F5F5F5' : '#1F1F1F'
      }}
      className="no-print h-16 px-4 md:px-6 flex items-center justify-between border-b shadow-md z-30 sticky top-0 shrink-0 select-none transition-colors"
    >
      {/* 1. Brand & Titlu LocalSight */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center shrink-0"
          title={isSidebarCollapsed ? "Deschide meniu navigare" : "Restrânge meniu navigare"}
          aria-label="Comută meniu navigare"
        >
          <Menu size={18} />
        </button>
        <img
          src={LOGO_SRC}
          alt="LocalSight"
          className="w-10 h-10 rounded-full object-cover shadow-md border border-white/20 shrink-0"
        />
        <div>
          <h1 className="font-black text-xl tracking-tight leading-none uppercase drop-shadow-sm">
            LocalSight
          </h1>
          <p className="text-xs font-medium text-slate-400 tracking-wide mt-0.5">
            Management condiții siguranță
          </p>
        </div>
      </div>

      {/* 2. Banner Conexiune Edge (C-10) */}
      {!isWsConnected && (
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[#D73833] text-white rounded-lg text-xs font-bold shadow-md animate-pulse">
          <WifiOff size={14} />
          <span>Semnal Edge Pierdut (Polling activat)</span>
          <button
            onClick={toggleWsSimulation}
            disabled={isReconnecting}
            className="ml-2 px-2.5 py-1 bg-black/40 hover:bg-black/60 rounded text-[10px] flex items-center gap-1.5 font-mono transition-colors"
          >
            <RefreshCw size={11} className={isReconnecting ? "animate-spin" : ""} /> {isReconnecting ? "Se reconectează..." : "Reconectează"}
          </button>
        </div>
      )}

      {/* 3. Bara de Căutare (Placeholder simplificat: "Cauta incidente") */}
      <div className="flex-1 max-w-xs md:max-w-sm mx-4 hidden sm:block">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cauta incidente"
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 focus:bg-white/15 border border-white/10 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FFEB33] transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 4. Controale Dreapta: Demo Triggers, Dark/Light Mode, Selector User */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Trigger-ele demo sunt doar pentru mock; în real se folosește backend/scripts/demo_event.py */}
        {USE_MOCK && (
        <div className="relative">
          <button
            onClick={() => {
              setShowDemoMenu(!showDemoMenu);
              setShowUserMenu(false);
            }}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Generează evenimente de test (doar în modul mock)"
          >
            <Zap size={14} className="text-[#FFEB33] fill-[#FFEB33]" />
            <span className="hidden md:inline">Simulare</span>
            <ChevronDown size={12} className="opacity-80" />
          </button>

          {showDemoMenu && (
            <div
              style={{
                backgroundColor: isDarkMode ? '#282828' : '#FFFFFF',
                borderColor: isDarkMode ? 'rgba(255,255,255,0.15)' : '#E5E7EB',
                color: isDarkMode ? '#F5F5F5' : '#1F1F1F'
              }}
              className="absolute right-0 mt-2 w-64 rounded-xl border p-2 shadow-2xl space-y-1 text-xs z-50 font-sans"
            >
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b pb-1 mb-1">
                Evenimente de test (mod mock)
              </div>
              <button
                onClick={() => {
                  simulateIncomingWsEvent('RESTRICTED_ZONE', 'CRITICAL');
                  setShowDemoMenu(false);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#D73833]/15 text-[#D73833] font-bold flex items-center justify-between"
              >
                <span>Persoană în Zonă Motor</span>
                <span className="text-[10px] font-mono bg-[#D73833] text-white px-1.5 rounded">CRITICAL</span>
              </button>
              <button
                onClick={() => {
                  simulateIncomingWsEvent('NO_PPE', 'WARNING');
                  setShowDemoMenu(false);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#FFEB33]/15 text-amber-500 font-bold flex items-center justify-between"
              >
                <span>Lucrător fără Vestă EIP</span>
                <span className="text-[10px] font-mono bg-[#FFEB33] text-[#1F1F1F] px-1.5 rounded">WARNING</span>
              </button>
              <button
                onClick={() => {
                  simulateIncomingWsEvent('SMOKING', 'WARNING');
                  setShowDemoMenu(false);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#FFEB33]/15 text-amber-500 font-bold flex items-center justify-between"
              >
                <span>Fumat în Zonă Alimentare</span>
                <span className="text-[10px] font-mono bg-[#FFEB33] text-[#1F1F1F] px-1.5 rounded">WARNING</span>
              </button>
              <button
                onClick={() => {
                  simulateIncomingWsEvent('CAMERA_OFFLINE', 'WARNING');
                  setShowDemoMenu(false);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-500/10 text-slate-400 font-semibold flex items-center justify-between"
              >
                <span>Camera Rampa Sud Offline</span>
                <span className="text-[10px] font-mono bg-slate-600 text-white px-1.5 rounded">OFFLINE</span>
              </button>
            </div>
          )}
        </div>
        )}

        {/* Toggle Theme: Dark / Light Mode */}
        <button
          onClick={toggleTheme}
          style={{
            backgroundColor: isDarkMode ? '#282828' : '#F5F5F5',
            borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : '#E5E7EB'
          }}
          className="p-2 rounded-xl border transition-all text-xs flex items-center justify-center shadow-sm"
          title={isDarkMode ? 'Comută pe tema luminoasă' : 'Comută pe tema întunecată'}
          aria-label="Comută tema interfeței"
        >
          {isDarkMode ? (
            <Sun size={16} className="text-[#FFEB33]" />
          ) : (
            <Moon size={16} className="text-[#1F1F1F]" />
          )}
        </button>

        {/* Selector Operator / Profil Activ */}
        <div className="relative">
          <button
            onClick={() => {
              setShowUserMenu(!showUserMenu);
              setShowDemoMenu(false);
            }}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition-all shadow-sm"
            title="Schimbă operatorul activ"
          >
            <div style={{ backgroundColor: isDarkMode ? '#D73833' : '#7EDEED', color: isDarkMode ? '#FFFFFF' : '#1F1F1F' }} className="w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shadow-inner">
              {operatorName?.[0]?.toUpperCase() || 'O'}
            </div>
            <div className="hidden lg:block text-left text-xs leading-tight">
              <p className="font-bold flex items-center gap-1">
                <span>{operatorName || 'Operator'}</span>
                <ChevronDown size={11} className="opacity-70" />
              </p>
              <p className="text-[10px] text-slate-400 font-medium">
                {activeOperator ? activeOperator.badge : 'OPERATOR'}
              </p>
            </div>
          </button>

          {showUserMenu && availableOperators && (
            <div
              style={{
                backgroundColor: isDarkMode ? '#282828' : '#FFFFFF',
                borderColor: isDarkMode ? 'rgba(255,255,255,0.15)' : '#E5E7EB',
                color: isDarkMode ? '#F5F5F5' : '#1F1F1F'
              }}
              className="absolute right-0 mt-2 w-64 rounded-xl border p-2 shadow-2xl space-y-1 text-xs z-50 font-sans"
            >
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b pb-1 mb-1">
                Rol
              </div>
              {availableOperators.map((op) => {
                const isSelected = activeOperator && op.id === activeOperator.id;
                return (
                  <button
                    key={op.id}
                    onClick={() => {
                      switchOperator(op.id);
                      setShowUserMenu(false);
                    }}
                    style={{
                      backgroundColor: isSelected
                        ? (isDarkMode ? '#D73833' : '#7EDEED')
                        : 'transparent',
                      color: isSelected
                        ? (isDarkMode ? '#FFFFFF' : '#1F1F1F')
                        : (isDarkMode ? '#F5F5F5' : '#1F1F1F')
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'font-bold shadow-sm'
                        : (isDarkMode ? 'hover:bg-white/5' : 'hover:bg-slate-100')
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-xs leading-none">{op.name}</p>
                      <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                        {op.role}
                      </p>
                    </div>
                    {isSelected && <Check size={14} className={isDarkMode ? 'text-white shrink-0' : 'text-[#1F1F1F] shrink-0 font-bold'} />}
                  </button>
                );
              })}

              <div className="pt-2 border-t border-white/10 mt-1 space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block px-1">
                  Numele tău (apare în jurnal)
                </span>
                <input
                  type="text"
                  value={operatorDraft}
                  onChange={(e) => setOperatorDraft(e.target.value)}
                  onBlur={commitOperator}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitOperator();
                      setShowUserMenu(false);
                    }
                  }}
                  className="w-full px-2.5 py-1 rounded text-xs bg-black/20 border border-white/20 focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                  placeholder="Ex: I. Popescu"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
