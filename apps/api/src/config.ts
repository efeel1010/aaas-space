const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  PORT: num(process.env.PORT, 3101),
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://pulse_space:pulse_space@localhost:5434/pulse_space',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5183',
  ADMIN_ORIGIN: process.env.ADMIN_ORIGIN ?? 'http://localhost:5184',
  QWEN_BASE_URL:
    process.env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  QWEN_API_KEY: process.env.QWEN_API_KEY ?? '',
  QWEN_MODEL: process.env.QWEN_MODEL ?? 'glm-5.2',
};
