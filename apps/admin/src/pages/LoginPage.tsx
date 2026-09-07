import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner, useToast } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('alice@pulse.space');
  const [password, setPassword] = useState('Passw0rd123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      toast('登录成功');
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-420">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-violet-dark text-white shadow-[var(--shadow-button)]">
            <ShieldCheck size={24} />
          </div>
          <h1 className="font-display text-24px font-700 text-ink">Pulse Space 管理后台</h1>
          <p className="mt-1 text-13px text-muted">仅限平台管理员登录</p>
        </div>

        <div className="card p-8">
          <form onSubmit={submit}>
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
              {loading && <Spinner size={15} />} 登录
            </button>
          </form>

          <div className="mt-4 text-center text-11px text-muted">
            演示管理员：alice@pulse.space / Passw0rd123
          </div>
        </div>
      </div>
    </div>
  );
}