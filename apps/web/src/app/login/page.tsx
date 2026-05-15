'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get('next') ?? '/workbench';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.push(next);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '用户名或密码错误');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: 360,
        background: '#ffffff',
        border: '1px solid #eff3f4',
        borderRadius: 16,
        padding: '36px 32px',
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0f1419', marginBottom: 4 }}>
            内容中台
          </div>
          <div style={{ fontSize: 13, color: '#536471' }}>请登录以继续</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#536471', marginBottom: 6, fontWeight: 600 }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#ffffff',
                border: '1px solid #cfd9de',
                borderRadius: 8,
                color: '#0f1419',
                fontSize: 14,
                padding: '10px 14px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#536471', marginBottom: 6, fontWeight: 600 }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#ffffff',
                border: '1px solid #cfd9de',
                borderRadius: 8,
                color: '#0f1419',
                fontSize: 14,
                padding: '10px 14px',
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16,
              padding: '8px 12px',
              background: '#ef44441a',
              border: '1px solid #ef4444',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 0',
              background: loading ? '#cfd9de' : '#1d9bf0',
              border: 'none',
              borderRadius: 9999,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
