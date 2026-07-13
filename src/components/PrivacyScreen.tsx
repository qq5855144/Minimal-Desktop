/**
 * 隐私屏组件
 * - 首次使用：设置6位数密码
 * - 后续进入：输入密码验证
 * - 密码哈希存 Supabase，浏览器不缓存任何验证状态
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { hashPin, verifyPin } from '@/lib/privacyCrypto';

interface PrivacyScreenProps {
  /** 验证通过后回调 */
  onUnlock: () => void;
  /** 关闭隐私屏（不验证，仅在右滑唤起时可关闭） */
  onClose: () => void;
}

type Mode = 'loading' | 'setup' | 'verify';

// 单个数字格
const PinCell: React.FC<{ value: string; active: boolean; filled: boolean; masked: boolean }> = ({
  value, active, filled, masked,
}) => (
  <div
    className={`
      w-12 h-14 flex items-center justify-center rounded-xl border-2 text-2xl font-bold
      transition-all duration-150
      ${active ? 'border-white/80 bg-white/10 scale-105' : filled ? 'border-white/40 bg-white/8' : 'border-white/20 bg-white/5'}
    `}
  >
    {filled ? (masked ? (
      <div className="w-3 h-3 rounded-full bg-white/90" />
    ) : (
      <span className="text-white">{value}</span>
    )) : null}
  </div>
);

// 数字键盘
const NumPad: React.FC<{ onPress: (v: string) => void; onDelete: () => void }> = ({ onPress, onDelete }) => {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
      {keys.map((k, i) => {
        if (k === '') return <div key={i} />;
        const isDelete = k === '⌫';
        return (
          <button
            key={k}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); isDelete ? onDelete() : onPress(k); }}
            className={`
              h-14 rounded-2xl text-xl font-medium text-white
              flex items-center justify-center
              transition-all duration-100 active:scale-95
              ${isDelete
                ? 'bg-white/10 hover:bg-white/15'
                : 'bg-white/15 hover:bg-white/25'}
            `}
            style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
};

const PrivacyScreen: React.FC<PrivacyScreenProps> = ({ onUnlock, onClose }) => {
  const [mode, setMode] = useState<Mode>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [masked, setMasked] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  // 读取是否已设置密码
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('privacy_config')
        .select('pw_hash')
        .eq('id', 'default')
        .maybeSingle();
      if (cancelled) return;
      setMode(data?.pw_hash ? 'verify' : 'setup');
    })();
    return () => { cancelled = true; };
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  const currentPin = isConfirming ? confirmPin : pin;
  const setCurrentPin = isConfirming ? setConfirmPin : setPin;

  const handlePress = useCallback((v: string) => {
    setError('');
    setCurrentPin((prev) => prev.length < 6 ? prev + v : prev);
  }, [setCurrentPin]);

  const handleDelete = useCallback(() => {
    setError('');
    setCurrentPin((prev) => prev.slice(0, -1));
  }, [setCurrentPin]);

  // 自动提交
  useEffect(() => {
    if (currentPin.length < 6) return;

    const submit = async () => {
      setSubmitting(true);
      try {
        if (mode === 'setup') {
          if (!isConfirming) {
            // 第一步：记录并进入确认
            setFirstPin(currentPin);
            setIsConfirming(true);
            setPin(currentPin);
            setConfirmPin('');
          } else {
            // 第二步：确认匹配
            if (currentPin !== firstPin) {
              setError('两次密码不一致，请重新设置');
              triggerShake();
              setIsConfirming(false);
              setFirstPin('');
              setPin('');
              setConfirmPin('');
            } else {
              const hash = await hashPin(currentPin);
              const { error: dbErr } = await supabase
                .from('privacy_config')
                .upsert({ id: 'default', pw_hash: hash });
              if (dbErr) {
                setError('保存失败，请重试');
                triggerShake();
                setConfirmPin('');
              } else {
                onUnlock();
              }
            }
          }
        } else {
          // 验证模式
          const { data } = await supabase
            .from('privacy_config')
            .select('pw_hash')
            .eq('id', 'default')
            .maybeSingle();
          if (!data?.pw_hash) {
            setMode('setup');
            setPin('');
            return;
          }
          const ok = await verifyPin(currentPin, data.pw_hash);
          if (ok) {
            onUnlock();
          } else {
            setError('密码错误，请重试');
            triggerShake();
            setPin('');
          }
        }
      } finally {
        setSubmitting(false);
      }
    };

    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPin]);

  const displayPin = isConfirming ? confirmPin : pin;
  const title = mode === 'loading' ? '加载中...'
    : mode === 'setup'
      ? (isConfirming ? '请再次输入密码' : '设置隐私屏密码')
      : '输入密码解锁';
  const subtitle = mode === 'setup'
    ? (isConfirming ? '确认你的6位数字密码' : '首次使用，请设置6位数字密码')
    : '向左滑动返回桌面';

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center select-none"
      style={{
        background: 'linear-gradient(160deg, rgba(10,10,20,0.97) 0%, rgba(20,10,40,0.97) 100%)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
      }}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center
          bg-white/10 hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      {/* 标题区 */}
      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-1"
          style={{ background: 'rgba(255,255,255,0.1)' }}>
          {mode === 'verify' ? (
            <Lock className="w-7 h-7 text-white/80" />
          ) : (
            <ShieldCheck className="w-7 h-7 text-white/80" />
          )}
        </div>
        <h2 className="text-white text-xl font-semibold tracking-wide">{title}</h2>
        <p className="text-white/50 text-sm">{subtitle}</p>
      </div>

      {/* PIN 格子 */}
      <div className={`flex gap-3 mb-2 transition-transform ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <PinCell
            key={i}
            value={displayPin[i] ?? ''}
            active={displayPin.length === i && !submitting && mode !== 'loading'}
            filled={i < displayPin.length}
            masked={masked}
          />
        ))}
      </div>

      {/* 显示/隐藏密码 */}
      <button
        type="button"
        onClick={() => setMasked((v) => !v)}
        className="flex items-center gap-1.5 text-white/40 hover:text-white/60 text-xs mb-2 py-1 px-2 transition-colors"
      >
        {masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        {masked ? '显示密码' : '隐藏密码'}
      </button>

      {/* 错误提示 */}
      <div className="h-6 mb-4">
        {error && (
          <p className="text-red-400 text-sm animate-fade-in">{error}</p>
        )}
      </div>

      {/* 数字键盘 */}
      {mode !== 'loading' && (
        <NumPad onPress={handlePress} onDelete={handleDelete} />
      )}

      {/* 忘记密码（验证模式下） */}
      {mode === 'verify' && (
        <button
          type="button"
          onClick={async () => {
            if (window.confirm('重置密码将清除已保存的密码，需重新设置。确认重置？')) {
              await supabase.from('privacy_config').delete().eq('id', 'default');
              setMode('setup');
              setPin('');
              setIsConfirming(false);
              setFirstPin('');
              setError('');
            }
          }}
          className="mt-6 text-white/30 hover:text-white/50 text-xs transition-colors"
        >
          忘记密码？重置
        </button>
      )}
    </div>
  );
};

export default PrivacyScreen;
