/**
 * 隐私屏遮罩组件
 * - 毛玻璃遮罩覆盖在隐私桌面上方，底层内容可见但模糊
 * - 首次使用：设置6位数密码
 * - 后续进入：输入密码，验证通过后遮罩消失，露出底层桌面
 * - 密码哈希存 Supabase，浏览器不缓存任何验证状态
 */
import React, { useState, useEffect, useCallback } from 'react';
import { X, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { hashPin, verifyPin } from '@/lib/privacyCrypto';

interface PrivacyScreenProps {
  onUnlock: () => void;
  onClose: () => void;
}

type Mode = 'loading' | 'setup' | 'verify';

const PinCell: React.FC<{ value: string; active: boolean; filled: boolean; masked: boolean }> = ({
  value, active, filled, masked,
}) => (
  <div
    className={`
      flex items-center justify-center rounded-xl border-2 text-xl font-bold
      transition-all duration-150
      ${active
        ? 'border-white/90 bg-white/15 scale-105 shadow-[0_0_12px_rgba(255,255,255,0.2)]'
        : filled ? 'border-white/50 bg-white/10'
        : 'border-white/20 bg-white/5'}
    `}
    style={{ width: 44, height: 52 }}
  >
    {filled ? (masked ? (
      <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
    ) : (
      <span className="text-white">{value}</span>
    )) : null}
  </div>
);

const NumPad: React.FC<{ onPress: (v: string) => void; onDelete: () => void }> = ({ onPress, onDelete }) => {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-2.5 w-full max-w-[264px]">
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
              ${isDelete ? 'bg-white/10 hover:bg-white/18' : 'bg-white/18 hover:bg-white/28'}
            `}
            style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
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

  useEffect(() => {
    if (currentPin.length < 6 || submitting) return;
    const submit = async () => {
      setSubmitting(true);
      try {
        if (mode === 'setup') {
          if (!isConfirming) {
            setFirstPin(currentPin);
            setIsConfirming(true);
            setPin(currentPin);
            setConfirmPin('');
          } else {
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
          const { data } = await supabase
            .from('privacy_config')
            .select('pw_hash')
            .eq('id', 'default')
            .maybeSingle();
          if (!data?.pw_hash) { setMode('setup'); setPin(''); return; }
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
    : mode === 'setup' ? (isConfirming ? '请再次输入密码' : '设置隐私屏密码')
    : '输入密码解锁';
  const subtitle = mode === 'setup'
    ? (isConfirming ? '确认你的6位数字密码' : '首次使用，请设置6位数字密码')
    : '输入密码查看隐私内容';

  return (
    /* 遮罩层：覆盖在桌面内容上方，强毛玻璃模糊底层 */
    <div
      className="absolute inset-0 z-[200] flex flex-col items-center justify-center"
      style={{
        backdropFilter: 'blur(28px) brightness(0.65)',
        WebkitBackdropFilter: 'blur(28px) brightness(0.65)',
        background: 'rgba(5,5,15,0.55)',
      }}
    >
      {/* 关闭 → 返回桌面 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center
          bg-white/10 hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      {/* 标题区 */}
      <div className="flex flex-col items-center gap-2 mb-7">
        <div className="rounded-2xl flex items-center justify-center"
          style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.12)' }}>
          {mode === 'verify'
            ? <Lock className="w-6 h-6 text-white/85" />
            : <ShieldCheck className="w-6 h-6 text-white/85" />}
        </div>
        <h2 className="text-white text-lg font-semibold tracking-wide mt-1">{title}</h2>
        <p className="text-white/50 text-xs">{subtitle}</p>
      </div>

      {/* PIN 格子 */}
      <div className={`flex gap-2.5 mb-1 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
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

      {/* 显示/隐藏 */}
      <button
        type="button"
        onClick={() => setMasked((v) => !v)}
        className="flex items-center gap-1 text-white/35 hover:text-white/55 text-[11px] py-1 px-2 mb-1 transition-colors"
      >
        {masked ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        {masked ? '显示密码' : '隐藏密码'}
      </button>

      {/* 错误提示 */}
      <div className="h-5 mb-4">
        {error && <p className="text-red-400 text-xs animate-fade-in">{error}</p>}
      </div>

      {/* 数字键盘 */}
      {mode !== 'loading' && <NumPad onPress={handlePress} onDelete={handleDelete} />}

      {/* 忘记密码 */}
      {mode === 'verify' && (
        <button
          type="button"
          onClick={async () => {
            if (window.confirm('重置将清除已保存的密码，需重新设置。确认重置？')) {
              await supabase.from('privacy_config').delete().eq('id', 'default');
              setMode('setup');
              setPin('');
              setIsConfirming(false);
              setFirstPin('');
              setError('');
            }
          }}
          className="mt-5 text-white/30 hover:text-white/50 text-[11px] transition-colors"
        >
          忘记密码？重置
        </button>
      )}
    </div>
  );
};

export default PrivacyScreen;
