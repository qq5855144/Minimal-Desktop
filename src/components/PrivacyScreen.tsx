/**
 * 隐私屏遮罩组件（完善版）
 * - 密码哈希存 localStorage（SHA-256+盐，不可逆）
 * - 连续错误 5 次锁定 60 秒，显示倒计时
 * - 支持修改密码
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Lock, ShieldCheck, Eye, EyeOff, KeyRound } from 'lucide-react';
import { hashPin, verifyPin } from '@/lib/privacyCrypto';
import {
  loadPinHash, savePinHash, clearPinHash,
  loadLockout, saveLockout, clearLockout,
  loadSyncConfig, loadPrivacyPageItems,
} from '@/lib/storage';
import { uploadToGithub } from '@/lib/github';
import type { DesktopData } from '@/types';
import { useDesktop } from '@/contexts/DesktopContext';

/** 设置/修改密码成功后，如果已开启自动同步则立即上传 */
async function syncPinToCloud(hash: string) {
  const cfg = loadSyncConfig();
  if (!cfg?.token || !cfg?.owner) return;
  try {
    const { loadDesktopData } = await import('@/lib/storage');
    const data: DesktopData = {
      ...loadDesktopData(),
      pinHash: hash,
      privacyItems: loadPrivacyPageItems(),
    };
    await uploadToGithub({ ...cfg, path: 'desktop_backup.json' }, data);
  } catch { /* 后台静默失败，不影响主流程 */ }
}

interface PrivacyScreenProps {
  onUnlock: () => void;
  onClose: () => void;
}

type Mode = 'setup' | 'verify' | 'change-old' | 'change-new';

const MAX_FAIL = 5;
const LOCKOUT_SECONDS = 60;

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
    style={{ width: 38, height: 44 }}
  >
    {filled ? (masked ? (
      <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
    ) : (
      <span className="text-white">{value}</span>
    )) : null}
  </div>
);

const NumPad: React.FC<{ onPress: (v: string) => void; onDelete: () => void; disabled?: boolean }> = ({
  onPress, onDelete, disabled,
}) => {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-2 w-full max-w-[240px]">
      {keys.map((k, i) => {
        if (k === '') return <div key={i} />;
        const isDelete = k === '⌫';
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onPointerDown={(e) => { e.preventDefault(); if (!disabled) { isDelete ? onDelete() : onPress(k); } }}
            className={`
              h-11 rounded-xl text-lg font-medium text-white
              flex items-center justify-center
              transition-all duration-100 active:scale-95
              ${disabled ? 'opacity-30 cursor-not-allowed' : ''}
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
  const { privacyPageItems } = useDesktop();
  const existingHash = loadPinHash();
  const [mode, setMode] = useState<Mode>(existingHash ? 'verify' : 'setup');
  const [pin, setPin] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [masked, setMasked] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  // 锁定倒计时
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 初始化时检查是否在锁定期
  useEffect(() => {
    const ls = loadLockout();
    const now = Date.now();
    if (ls.lockedUntil > now) {
      setLockoutLeft(Math.ceil((ls.lockedUntil - now) / 1000));
    }
  }, []);

  // 倒计时 ticker
  useEffect(() => {
    if (lockoutLeft <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setLockoutLeft((v) => {
        if (v <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockoutLeft]);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }, []);

  const handlePress = useCallback((v: string) => {
    if (lockoutLeft > 0) return;
    setError('');
    setPin((prev) => prev.length < 6 ? prev + v : prev);
  }, [lockoutLeft]);

  const handleDelete = useCallback(() => {
    setError('');
    setPin((prev) => prev.slice(0, -1));
  }, []);

  // PIN 满6位后自动提交
  useEffect(() => {
    if (pin.length < 6 || submitting || lockoutLeft > 0) return;

    const submit = async () => {
      setSubmitting(true);
      try {
        // ── 设置密码 ──
        if (mode === 'setup') {
          if (!isConfirming) {
            setFirstPin(pin);
            setIsConfirming(true);
            setPin('');
            return;
          }
          if (pin !== firstPin) {
            setError('两次密码不一致，请重新设置');
            triggerShake();
            setIsConfirming(false);
            setFirstPin('');
            setPin('');
            return;
          }
          const hash = await hashPin(pin);
          savePinHash(hash);
          clearLockout();
          syncPinToCloud(hash); // 后台异步同步，不阻塞解锁
          onUnlock();
          return;
        }

        // ── 验证密码 ──
        if (mode === 'verify') {
          const storedHash = loadPinHash();
          if (!storedHash) { setMode('setup'); setPin(''); return; }
          const ok = await verifyPin(pin, storedHash);
          if (ok) {
            clearLockout();
            onUnlock();
          } else {
            const ls = loadLockout();
            const newFail = ls.failCount + 1;
            if (newFail >= MAX_FAIL) {
              const until = Date.now() + LOCKOUT_SECONDS * 1000;
              saveLockout({ failCount: 0, lockedUntil: until });
              setLockoutLeft(LOCKOUT_SECONDS);
              setError(`错误次数过多，锁定 ${LOCKOUT_SECONDS} 秒`);
            } else {
              saveLockout({ failCount: newFail, lockedUntil: 0 });
              setError(`密码错误，还剩 ${MAX_FAIL - newFail} 次机会`);
            }
            triggerShake();
            setPin('');
          }
          return;
        }

        // ── 修改密码：验证旧密码 ──
        if (mode === 'change-old') {
          const storedHash = loadPinHash();
          if (!storedHash) { setMode('setup'); setPin(''); return; }
          const ok = await verifyPin(pin, storedHash);
          if (ok) {
            setMode('change-new');
            setIsConfirming(false);
            setFirstPin('');
            setPin('');
          } else {
            setError('旧密码错误，请重试');
            triggerShake();
            setPin('');
          }
          return;
        }

        // ── 修改密码：设置新密码 ──
        if (mode === 'change-new') {
          if (!isConfirming) {
            setFirstPin(pin);
            setIsConfirming(true);
            setPin('');
            return;
          }
          if (pin !== firstPin) {
            setError('两次密码不一致，请重新输入');
            triggerShake();
            setIsConfirming(false);
            setFirstPin('');
            setPin('');
            return;
          }
          const hash = await hashPin(pin);
          savePinHash(hash);
          clearLockout();
          syncPinToCloud(hash); // 后台异步同步
          onUnlock();
        }
      } finally {
        setSubmitting(false);
      }
    };

    submit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const displayPin = pin;

  const title = (() => {
    if (mode === 'setup') return isConfirming ? '请再次输入密码' : '设置隐私屏密码';
    if (mode === 'verify') return '输入密码解锁';
    if (mode === 'change-old') return '验证旧密码';
    if (mode === 'change-new') return isConfirming ? '再次确认新密码' : '设置新密码';
  })();

  const subtitle = (() => {
    if (mode === 'setup') return isConfirming ? '确认你的6位数字密码' : '首次使用，请设置6位数字密码';
    if (mode === 'verify') return '输入密码查看隐私内容';
    if (mode === 'change-old') return '请输入当前密码';
    if (mode === 'change-new') return isConfirming ? '确认新的6位数字密码' : '请设置新的6位数字密码';
  })();

  const isLocked = lockoutLeft > 0;

  return (
    <div
      className="absolute inset-0 z-[200] flex flex-col items-center justify-center"
      style={{
        backdropFilter: 'blur(28px) brightness(0.65)',
        WebkitBackdropFilter: 'blur(28px) brightness(0.65)',
        background: 'rgba(5,5,15,0.55)',
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
      <div className="flex flex-col items-center gap-1 mb-5">
        <div className="rounded-2xl flex items-center justify-center"
          style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.12)' }}>
          {mode === 'verify'
            ? <Lock className="w-5 h-5 text-white/85" />
            : mode === 'change-old' || mode === 'change-new'
            ? <KeyRound className="w-5 h-5 text-white/85" />
            : <ShieldCheck className="w-5 h-5 text-white/85" />}
        </div>
        <h2 className="text-white text-base font-semibold tracking-wide mt-0.5">{title}</h2>
        <p className="text-white/50 text-[11px]">{subtitle}</p>
      </div>

      {/* PIN 格子 */}
      <div className={`flex gap-2 mb-0.5 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <PinCell
            key={i}
            value={displayPin[i] ?? ''}
            active={displayPin.length === i && !submitting && !isLocked}
            filled={i < displayPin.length}
            masked={masked}
          />
        ))}
      </div>

      {/* 显示/隐藏 */}
      <button
        type="button"
        onClick={() => setMasked((v) => !v)}
        className="flex items-center gap-1 text-white/35 hover:text-white/55 text-[10px] py-0.5 px-2 mb-0.5 transition-colors"
      >
        {masked ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
        {masked ? '显示密码' : '隐藏密码'}
      </button>

      {/* 错误提示 / 锁定倒计时 */}
      <div className="h-5 mb-3 flex items-center justify-center">
        {isLocked ? (
          <p className="text-amber-400 text-[11px] animate-fade-in">
            🔒 锁定中，请等待 {lockoutLeft} 秒
          </p>
        ) : error ? (
          <p className="text-red-400 text-[11px] animate-fade-in">{error}</p>
        ) : null}
      </div>

      {/* 数字键盘 */}
      <NumPad onPress={handlePress} onDelete={handleDelete} disabled={isLocked || submitting} />

      {/* 底部操作区 */}
      <div className="flex flex-col items-center gap-2 mt-4">
        {/* 修改密码（验证通过后的入口） */}
        {mode === 'verify' && (
          <button
            type="button"
            onClick={() => { setMode('change-old'); setPin(''); setError(''); }}
            className="text-white/35 hover:text-white/55 text-[10px] transition-colors"
          >
            修改密码
          </button>
        )}
        {/* 忘记密码（重置） */}
        {(mode === 'verify' || mode === 'change-old') && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('重置将清除已保存的密码，需重新设置。确认重置？')) {
                clearPinHash();
                clearLockout();
                setMode('setup');
                setPin('');
                setIsConfirming(false);
                setFirstPin('');
                setError('');
                setLockoutLeft(0);
              }
            }}
            className="text-white/25 hover:text-white/45 text-[10px] transition-colors"
          >
            忘记密码？重置
          </button>
        )}
        {/* 返回（修改密码流程中） */}
        {(mode === 'change-old' || mode === 'change-new') && (
          <button
            type="button"
            onClick={() => { setMode('verify'); setPin(''); setIsConfirming(false); setFirstPin(''); setError(''); }}
            className="text-white/25 hover:text-white/45 text-[10px] transition-colors"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
};

export default PrivacyScreen;
