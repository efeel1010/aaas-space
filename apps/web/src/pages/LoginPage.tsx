import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner, useToast } from '../components/ui';

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'register'>(params.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('alice@pulse.space');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('Passw0rd123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
    setPassword('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        toast('登录成功');
      } else {
        if (!name.trim()) throw new Error('请输入姓名');
        await register(email.trim(), name.trim(), password);
        toast('注册成功，已自动登录');
      }
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <img src="/pulse-space-logo.svg" alt="Pulse Space" className="mx-auto mb-4 h-10" />
          <h1 className="font-display text-24px font-700 text-ink">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="mt-1 text-13px text-muted">
            {mode === 'login' ? '登录 Pulse Space 团队协作空间' : '加入 Pulse Space，开启团队协作'}
          </p>
        </div>

        <div className="card p-8">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 text-13px font-650 transition-all ${
                  mode === m ? 'bg-white text-violet shadow-sm' : 'text-muted'
                }`}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="form-group">
                <label>姓名</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="你的姓名"
                  required
                />
              </div>
            )}
            <div className="form-group">
              <label>邮箱</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                required
              />
            </div>

            {error && <p className="mb-3 text-13px font-600 text-coral">{error}</p>}

            <button className="btn btn-primary w-full py-3 text-13px" disabled={loading}>
              {loading && <Spinner size={15} />}
              {mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          {mode === 'login' && (
            <div className="mt-4 text-center text-11px text-muted">
              演示账号：alice@pulse.space / Passw0rd123
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
