import type { ReactNode } from "react";

export interface FieldSpec {
  name: string;
  type: string; // string | text | number | float | bool | select
  options?: string;
  help?: string;
  required?: boolean;
  label?: string;
  readOnly?: boolean;
}

const LABELS: Record<string, string> = {
  mount_path: "挂载路径", order: "序号", remark: "备注", cache_expiration: "缓存过期（分钟）", custom_cache_policies: "自定义缓存策略",
  web_proxy: "网页代理", webdav_policy: "WebDAV 策略", proxy_range: "代理 Range 请求", down_proxy_url: "下载代理地址",
  disable_proxy_sign: "下载代理不签名", order_by: "排序字段", order_direction: "排序方向", extract_folder: "文件夹位置",
  disable_index: "不参与搜索索引", enable_sign: "启用签名", root_folder_path: "根文件夹路径", root_folder_id: "根文件夹 ID",
  cookie: "Cookie", page_size: "分页大小", limit_rate: "限速（每秒请求）", thumbnail: "生成缩略图", thumb_cache_folder: "缩略图缓存目录",
  username: "用户名", password: "密码", refresh_token: "Refresh Token", access_token: "Access Token", client_id: "Client ID",
  client_secret: "Client Secret", url: "地址", address: "地址", token: "Token", show_hidden: "显示隐藏文件", mkdir_perm: "新建目录权限",
  recycle_bin_path: "回收站路径", directory_size: "计算文件夹大小", qrcode_token: "扫码 Token", qrcode_source: "扫码来源",
};

const OPTION_LABELS: Record<string, string> = {
  native_proxy: "本机代理", use_proxy_url: "使用代理地址", "302_redirect": "302 重定向", name: "名称", size: "大小", modified: "修改时间",
  asc: "升序", desc: "降序", front: "前面", back: "后面",
};

export function labelFor(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

export function Field({ spec, value, onChange, adornment }: { spec: FieldSpec; value: unknown; onChange: (value: unknown) => void; adornment?: ReactNode }) {
  const id = `f-${spec.name}`;
  const label = spec.label ?? labelFor(spec.name);
  let control: ReactNode;
  if (spec.type === "bool") {
    const on = value === true || value === "true";
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div>
          <label htmlFor={id} className="text-[13.5px] font-medium">{label}{spec.required && <span className="text-danger"> *</span>}</label>
          {spec.help && <p className="mt-0.5 max-w-[60ch] text-[12.5px] text-faint">{spec.help}</p>}
        </div>
        <button id={id} type="button" role="switch" aria-checked={on} className="switch mt-0.5" disabled={spec.readOnly}
          onClick={() => onChange(typeof value === "string" ? String(!on) : !on)} />
      </div>
    );
  }
  if (spec.type === "select") {
    const options = (spec.options ?? "").split(",").map(option => option.trim()).filter(Boolean);
    control = (
      <select id={id} className="field" value={String(value ?? "")} disabled={spec.readOnly} onChange={event => onChange(event.target.value)}>
        {!spec.required && <option value="">（默认）</option>}
        {options.map(option => <option key={option} value={option}>{OPTION_LABELS[option] ?? option}</option>)}
      </select>
    );
  } else if (spec.type === "text") {
    control = <textarea id={id} className="field font-mono text-[12.5px]" rows={3} value={String(value ?? "")} readOnly={spec.readOnly} onChange={event => onChange(event.target.value)} />;
  } else {
    const numeric = spec.type === "number" || spec.type === "float";
    control = (
      <input id={id} className={`field ${numeric ? "tabular" : ""}`} inputMode={numeric ? "decimal" : undefined} value={String(value ?? "")} readOnly={spec.readOnly}
        type={/password|secret/.test(spec.name) ? "password" : "text"} autoComplete="off" spellCheck={false}
        onChange={event => onChange(event.target.value)} />
    );
  }
  return (
    <div>
      <label className="label" htmlFor={id}>{label}{spec.required && <span className="text-danger"> *</span>}</label>
      {adornment ? <div className="flex gap-2"><div className="min-w-0 flex-1">{control}</div>{adornment}</div> : control}
      {spec.help && <p className="mt-1.5 max-w-[70ch] text-[12.5px] text-faint">{spec.help}</p>}
    </div>
  );
}

/** Coerce a form value to the JSON type the driver expects. */
export function coerce(type: string, value: unknown): unknown {
  if (type === "bool") return value === true || value === "true";
  if (type === "number") { const n = parseInt(String(value), 10); return Number.isFinite(n) ? n : 0; }
  if (type === "float") { const n = parseFloat(String(value)); return Number.isFinite(n) ? n : 0; }
  return value === undefined || value === null ? "" : String(value);
}

export function PageHeader({ title, children, detail }: { title: string; children?: ReactNode; detail?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[26px] font-semibold tracking-[-0.03em]">{title}</h2>
        {detail && <p className="mt-1 text-[13px] text-muted">{detail}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
