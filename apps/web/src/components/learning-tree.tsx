'use client';

import { useState, useEffect } from 'react';
import { useLanguageStore } from '@/stores/language-store';

interface LearningTreeProps {
  streak: number;
  className?: string;
}

type Stage = { label: string; labelVi: string; emoji: string; desc: string; descVi: string };

const STAGES: Stage[] = [
  { label: 'Wilting', labelVi: 'Đang héo', emoji: '🥀', desc: 'Study today to revive me!', descVi: 'Hãy học ngay hôm nay để hồi sinh cây!' },
  { label: 'Seedling', labelVi: 'Hạt nảy mầm', emoji: '🌱', desc: 'A long journey begins...', descVi: 'Một hành trình vạn dặm...' },
  { label: 'Sapling', labelVi: 'Cây con', emoji: '🌿', desc: 'Growing well!', descVi: 'Cây đang phát triển tốt!' },
  { label: 'Growing', labelVi: 'Đang lớn', emoji: '🌳', desc: 'Keep going!', descVi: 'Cây đang lớn dần, cố lên!' },
  { label: 'Blooming', labelVi: 'Đang nở hoa', emoji: '🌸', desc: 'Beautiful blooms!', descVi: 'Tuyệt vời! Cây đã ra hoa!' },
  { label: 'Flourishing', labelVi: 'Kết quả ngọt', emoji: '🍎', desc: 'You are outstanding!', descVi: 'Quá xuất sắc! Cây đã kết trái!' },
];

function getStage(streak: number): number {
  if (streak === 0) return 0;
  if (streak <= 2) return 1;
  if (streak <= 6) return 2;
  if (streak <= 13) return 3;
  if (streak <= 29) return 4;
  return 5;
}

type TreeType = 'oak' | 'sakura' | 'pine' | 'maple';

export function LearningTree({ streak, className = '' }: LearningTreeProps) {
  const { locale } = useLanguageStore();
  const stageIdx = getStage(streak);
  const stage = STAGES[stageIdx];
  const isDying = streak === 0;

  const [treeType, setTreeType] = useState<TreeType>('oak');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('selected_tree_type') as TreeType;
      if (saved && ['oak', 'sakura', 'pine', 'maple'].includes(saved)) {
        setTreeType(saved);
      }
    }
  }, []);

  const changeTreeType = (type: TreeType) => {
    setTreeType(type);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selected_tree_type', type);
    }
  };

  const getFill = (gradId: string) => {
    return isDying ? 'url(#wilted-grad)' : `url(#${gradId})`;
  };

  const treeTypesList = [
    { id: 'oak' as const, name: 'Sồi Xanh', nameEn: 'Green Oak', emoji: '🌳' },
    { id: 'sakura' as const, name: 'Anh Đào', nameEn: 'Cherry Blossom', emoji: '🌸' },
    { id: 'pine' as const, name: 'Thông Zen', nameEn: 'Zen Pine', emoji: '🌲' },
    { id: 'maple' as const, name: 'Phong Đỏ', nameEn: 'Red Maple', emoji: '🍁' },
  ];

  // Dynamic leaf glow color
  const glowColors: Record<TreeType, string> = {
    oak: '#22c55e',
    sakura: '#f43f5e',
    pine: '#0d9488',
    maple: '#ea580c',
  };
  const leafGlowColor = isDying ? '#94a3b8' : glowColors[treeType];

  return (
    <div className={`flex flex-col items-center gap-3 w-full ${className}`}>
      {/* SVG Tree Container */}
      <div className="relative">
        <svg viewBox="0 0 160 200" width="130" height="160" xmlns="http://www.w3.org/2000/svg" className="filter drop-shadow-md">
          <defs>
            {/* Oak Gradients */}
            <linearGradient id="oak-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#86efac" />
              <stop offset="60%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#15803d" />
            </linearGradient>
            <linearGradient id="oak-dark-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#14532d" />
            </linearGradient>

            {/* Sakura Gradients */}
            <linearGradient id="sakura-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffe4e6" />
              <stop offset="50%" stopColor="#fda4af" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
            <linearGradient id="sakura-dark-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fda4af" />
              <stop offset="100%" stopColor="#be123c" />
            </linearGradient>

            {/* Pine Gradients */}
            <linearGradient id="pine-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#99f6e4" />
              <stop offset="50%" stopColor="#0d9488" />
              <stop offset="100%" stopColor="#115e59" />
            </linearGradient>
            <linearGradient id="pine-dark-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0f766e" />
              <stop offset="100%" stopColor="#134e4a" />
            </linearGradient>

            {/* Maple Gradients */}
            <linearGradient id="maple-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <linearGradient id="maple-dark-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#7c2d12" />
            </linearGradient>

            {/* Wilted Gradient */}
            <linearGradient id="wilted-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>

            {/* Trunk Gradient */}
            <linearGradient id="trunk-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#78350f" />
              <stop offset="40%" stopColor="#92400e" />
              <stop offset="100%" stopColor="#78350f" />
            </linearGradient>
            <linearGradient id="trunk-wilted-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>

          {/* Glow under tree base */}
          {!isDying && stageIdx >= 3 && (
            <ellipse cx="80" cy="182" rx="45" ry="6" fill={leafGlowColor} opacity="0.15" />
          )}

          {/* Ground soil */}
          <ellipse cx="80" cy="185" rx="52" ry="8" fill={isDying ? '#cbd5e1' : '#b45309'} opacity="0.25" />

          {/* Trunk with flare roots */}
          {stageIdx > 0 && (
            <path
              d={
                stageIdx === 1 ? "M77 180 L78 158 Q80 155 82 158 L83 180 Z" :
                stageIdx === 2 ? "M75 180 L76 142 Q80 138 84 142 L85 180 Z" :
                stageIdx === 3 ? "M73 181 Q64 182 60 185 L100 185 Q96 182 87 181 L85 125 L75 125 Z" :
                stageIdx === 4 ? "M72 181 Q62 182 58 186 L102 186 Q98 182 88 181 L85 110 L75 110 Z" :
                "M70 181 Q58 182 54 187 L106 187 Q102 182 90 181 L87 95 L73 95 Z"
              }
              fill={isDying ? "url(#trunk-wilted-grad)" : "url(#trunk-grad)"}
            />
          )}

          {/* Stage 0: Wilting plant in pot */}
          {stageIdx === 0 && (
            <>
              {/* Ceramic Pot */}
              <path d="M60 178 Q60 192 80 192 Q100 192 100 178 L95 166 H65 Z" fill={isDying ? "#64748b" : "#78350f"} opacity="0.8" />
              <rect x="58" y="164" width="44" height="6" rx="3" fill={isDying ? "#475569" : "#92400e"} opacity="0.9" />
              {/* Wilted stem */}
              <path d="M80 164 Q70 148 66 133 Q62 121 69 114" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              {/* Wilted fallen leaves */}
              <path d="M69 114 Q61 107 56 112 Q53 120 63 122" fill="#64748b" opacity="0.6" />
              <path d="M69 114 Q79 108 83 114 Q85 122 75 124" fill="#64748b" opacity="0.5" />
            </>
          )}

          {/* Sprouts & Trees rendering logic */}
          {stageIdx === 1 && (
            <>
              {treeType === 'pine' ? (
                <polygon points="80,140 72,158 88,158" fill={getFill('pine-grad')} />
              ) : (
                <>
                  <ellipse cx="80" cy="150" rx="10" ry="8" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="73" cy="156" rx="7" ry="5" fill={getFill(`${treeType}-grad`)} opacity="0.8" />
                  <ellipse cx="87" cy="156" rx="7" ry="5" fill={getFill(`${treeType}-grad`)} opacity="0.8" />
                </>
              )}
            </>
          )}

          {stageIdx === 2 && (
            <>
              {treeType === 'pine' ? (
                <>
                  <polygon points="80,118 64,146 96,146" fill={getFill('pine-grad')} />
                  <polygon points="80,132 58,156 102,156" fill={getFill('pine-grad')} />
                </>
              ) : (
                <>
                  <ellipse cx="80" cy="134" rx="22" ry="17" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="64" cy="144" rx="14" ry="11" fill={getFill(`${treeType}-grad`)} opacity="0.82" />
                  <ellipse cx="96" cy="144" rx="14" ry="11" fill={getFill(`${treeType}-grad`)} opacity="0.82" />
                </>
              )}
            </>
          )}

          {stageIdx === 3 && (
            <>
              {treeType === 'pine' ? (
                <>
                  <polygon points="80,102 66,128 94,128" fill={getFill('pine-grad')} />
                  <polygon points="80,118 56,148 104,148" fill={getFill('pine-grad')} />
                  <polygon points="80,134 48,162 112,162" fill={getFill('pine-grad')} />
                </>
              ) : (
                <>
                  <ellipse cx="80" cy="118" rx="28" ry="22" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="56" cy="132" rx="18" ry="14" fill={getFill(`${treeType}-grad`)} opacity="0.84" />
                  <ellipse cx="104" cy="132" rx="18" ry="14" fill={getFill(`${treeType}-grad`)} opacity="0.84" />
                  <ellipse cx="66" cy="104" rx="16" ry="13" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                  <ellipse cx="94" cy="104" rx="16" ry="13" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                </>
              )}
            </>
          )}

          {stageIdx === 4 && (
            <>
              {treeType === 'pine' ? (
                <>
                  <polygon points="80,88 68,112 92,112" fill={getFill('pine-grad')} />
                  <polygon points="80,104 58,132 102,132" fill={getFill('pine-grad')} />
                  <polygon points="80,120 50,152 110,152" fill={getFill('pine-grad')} />
                  <polygon points="80,138 42,170 118,170" fill={getFill('pine-grad')} />
                  {/* Pine cones */}
                  {!isDying && [{cx:65,cy:128},{cx:95,cy:128},{cx:58,cy:148},{cx:102,cy:148}].map((f, i) => (
                    <rect key={i} x={f.cx-3} y={f.cy} width="6" height="8" rx="2" fill="#78350f" opacity="0.85" />
                  ))}
                </>
              ) : (
                <>
                  <ellipse cx="80" cy="98" rx="34" ry="26" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="50" cy="118" rx="22" ry="17" fill={getFill(`${treeType}-grad`)} opacity="0.84" />
                  <ellipse cx="110" cy="118" rx="22" ry="17" fill={getFill(`${treeType}-grad`)} opacity="0.84" />
                  <ellipse cx="58" cy="88" rx="20" ry="15" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                  <ellipse cx="102" cy="88" rx="20" ry="15" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                  <ellipse cx="80" cy="74" rx="24" ry="18" fill={getFill(`${treeType}-grad`)} />
                  
                  {/* Special accents */}
                  {!isDying && treeType === 'sakura' && (
                    <>
                      {/* Flower buds */}
                      {[{cx:48,cy:112},{cx:112,cy:112},{cx:55,cy:82},{cx:105,cy:82},{cx:80,cy:66}].map((f, i) => (
                        <g key={i}>
                          <circle cx={f.cx} cy={f.cy} r="4.5" fill="#fff" opacity="0.95" />
                          <circle cx={f.cx} cy={f.cy} r="2" fill="#f43f5e" />
                        </g>
                      ))}
                      {/* Falling petals */}
                      {[{x:50,y:142},{x:110,y:146},{x:74,y:162}].map((p, i) => (
                        <path key={i} d={`M${p.x} ${p.y} Q${p.x-2} ${p.y+3} ${p.x-1} ${p.y+5} Q${p.x+2} ${p.y+3} ${p.x} ${p.y}`} fill="#fda4af" opacity="0.8" />
                      ))}
                    </>
                  )}

                  {!isDying && treeType === 'maple' && (
                    <>
                      {/* Golden stars or autumn leaves */}
                      {[{x:46,y:115},{x:114,y:115},{x:56,y:85}].map((p, i) => (
                        <text key={i} x={p.x} y={p.y} fontSize="8" fill="#facc15" opacity="0.9">🍁</text>
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {stageIdx === 5 && (
            <>
              {treeType === 'pine' ? (
                <>
                  <polygon points="80,72 68,96 92,96" fill={getFill('pine-grad')} />
                  <polygon points="80,88 58,116 102,116" fill={getFill('pine-grad')} />
                  <polygon points="80,105 50,136 110,136" fill={getFill('pine-grad')} />
                  <polygon points="80,123 42,156 118,156" fill={getFill('pine-grad')} />
                  <polygon points="80,142 34,176 126,176" fill={getFill('pine-grad')} />
                  {/* Pine cones */}
                  {!isDying && [{cx:65,cy:112},{cx:95,cy:112},{cx:58,cy:132},{cx:102,cy:132},{cx:50,cy:152},{cx:110,cy:152}].map((f, i) => (
                    <rect key={i} x={f.cx-3} y={f.cy} width="6" height="9" rx="2" fill="#7c2d12" opacity="0.9" />
                  ))}
                  {/* Sparkles */}
                  {!isDying && [{x:30,y:155},{x:130,y:155},{x:80,y:50}].map((s, i) => (
                    <text key={i} x={s.x} y={s.y} fontSize="10" textAnchor="middle" opacity="0.8">✨</text>
                  ))}
                </>
              ) : (
                <>
                  <ellipse cx="80" cy="88" rx="40" ry="30" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="44" cy="112" rx="26" ry="20" fill={getFill(`${treeType}-grad`)} opacity="0.85" />
                  <ellipse cx="116" cy="112" rx="26" ry="20" fill={getFill(`${treeType}-grad`)} opacity="0.85" />
                  <ellipse cx="52" cy="74" rx="24" ry="19" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                  <ellipse cx="108" cy="74" rx="24" ry="19" fill={getFill(`${treeType}-grad`)} opacity="0.88" />
                  <ellipse cx="80" cy="58" rx="28" ry="21" fill={getFill(`${treeType}-grad`)} />
                  <ellipse cx="60" cy="50" rx="18" ry="14" fill={getFill(`${treeType}-grad`)} opacity="0.85" />
                  <ellipse cx="100" cy="50" rx="18" ry="14" fill={getFill(`${treeType}-grad`)} opacity="0.85" />

                  {/* Special stage 5 accents */}
                  {!isDying && treeType === 'oak' && (
                    <>
                      {/* Acorns or red apples */}
                      {[{cx:42,cy:114},{cx:118,cy:112},{cx:60,cy:82},{cx:98,cy:80},{cx:80,cy:62}].map((f, i) => (
                        <circle key={i} cx={f.cx} cy={f.cy} r="3.5" fill="#f43f5e" />
                      ))}
                    </>
                  )}

                  {!isDying && treeType === 'sakura' && (
                    <>
                      {/* Cherry fruits */}
                      {[{cx:40,cy:116},{cx:120,cy:116},{cx:62,cy:88},{cx:98,cy:86},{cx:80,cy:46}].map((f, i) => (
                        <g key={i}>
                          <path d={`M${f.cx} ${f.cy-6} Q${f.cx+2} ${f.cy-4} ${f.cx} ${f.cy}`} stroke="#15803d" strokeWidth="1" fill="none" />
                          <circle cx={f.cx} cy={f.cy} r="4" fill="#e11d48" />
                        </g>
                      ))}
                      {/* Falling petals */}
                      {[{x:40,y:135},{x:120,y:135},{x:74,y:158},{x:92,y:154}].map((p, i) => (
                        <path key={i} d={`M${p.x} ${p.y} Q${p.x-2} ${p.y+3} ${p.x-1} ${p.y+5} Q${p.x+2} ${p.y+3} ${p.x} ${p.y}`} fill="#fda4af" opacity="0.8" />
                      ))}
                    </>
                  )}

                  {!isDying && treeType === 'maple' && (
                    <>
                      {/* Glowing maple leaves */}
                      {[{cx:42,cy:106},{cx:118,cy:106},{cx:60,cy:74},{cx:100,cy:74},{cx:80,cy:58}].map((f, i) => (
                        <text key={i} x={f.cx} y={f.cy} fontSize="10" opacity="0.95" fill="#facc15">🍁</text>
                      ))}
                      {/* Falling maple leaves */}
                      {[{x:34,y:128},{x:124,y:130},{x:74,y:154}].map((p, i) => (
                        <text key={i} x={p.x} y={p.y} fontSize="8" fill="#f97316" opacity="0.7">🍁</text>
                      ))}
                    </>
                  )}

                  {/* Sparkles */}
                  {!isDying && [{x:28,y:52},{x:132,y:56},{x:80,y:30}].map((s, i) => (
                    <text key={i} x={s.x} y={s.y} fontSize="11" textAnchor="middle" opacity="0.8">✨</text>
                  ))}
                </>
              )}
            </>
          )}
        </svg>

        {/* Dynamic backdrop pulse glow */}
        {!isDying && stageIdx >= 2 && (
          <div
            className="pointer-events-none absolute -inset-2 rounded-full opacity-25 animate-pulse"
            style={{
              background: `radial-gradient(circle, ${leafGlowColor}33 0%, transparent 70%)`,
            }}
          />
        )}
      </div>

      {/* Tree Status & Description */}
      <div className="w-full text-center space-y-1">
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-lg">{stage.emoji}</span>
          <span className="text-sm font-bold text-foreground">
            {locale === 'vi' ? stage.labelVi : stage.label}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug min-h-[32px] flex items-center justify-center px-4">
          {locale === 'vi' ? stage.descVi : stage.desc}
        </p>

        {/* Streak progress bar */}
        <div className="mt-2 px-2">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{
                width: `${Math.min((streak / 30) * 100, 100)}%`,
                background: isDying
                  ? '#94a3b8'
                  : `linear-gradient(90deg, ${leafGlowColor}, ${leafGlowColor}bb)`,
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground font-medium">
            <span>0</span>
            <span className="text-foreground/80 font-bold">{streak} {locale === 'vi' ? 'ngày' : 'days'} 🔥</span>
            <span>30+</span>
          </div>
        </div>

        {/* Tree Selector Horizontal Row */}
        <div className="flex flex-col gap-1 pt-2.5 border-t border-border/40 mt-3">
          <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider">
            {locale === 'vi' ? 'Chọn loại cây học tập' : 'Select Learning Tree'}
          </span>
          <div className="flex justify-center gap-3 mt-1.5">
            {treeTypesList.map((t) => {
              const isSelected = treeType === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => changeTreeType(t.id)}
                  disabled={isDying}
                  className={`relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-300 ${
                    isSelected 
                      ? 'scale-110 shadow-md bg-secondary/80 ring-2 ring-primary border-none' 
                      : 'opacity-50 hover:opacity-100 hover:scale-105 hover:bg-muted/40'
                  } ${isDying ? 'cursor-not-allowed opacity-30' : ''}`}
                  title={locale === 'vi' ? t.name : t.nameEn}
                >
                  <span className="text-base">{t.emoji}</span>
                  {isSelected && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground shadow-sm">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
