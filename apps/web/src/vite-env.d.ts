/// <reference types="vite/client" />

// Vite 将 `*?worker` 后缀导入编译为 Worker 构造器
declare module '*?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// html2pdf.js（无内置类型）
declare module 'html2pdf.js' {
  interface Html2PdfWorker {
    set(cfg: Record<string, unknown>): Html2PdfWorker;
    from(el: Element): Html2PdfWorker;
    save(): Promise<void>;
    toPdf(): Html2PdfWorker;
    get(type: string): unknown;
    output(type: string): unknown;
  }
  export default function html2pdf(el?: Element): Html2PdfWorker;
}