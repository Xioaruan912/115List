import { ApiError } from "./api";

/**
 * What a person reads when something fails. Server and driver messages are
 * English, long and full of paths ("failed to list archive [/a/b.iso]/: UDF
 * volumes are not supported"); none of that reaches the screen. Each failure
 * becomes a short reason and a next step; the raw text stays in the console
 * and behind a "复制详情" button.
 */
export interface Explained {
  title: string;
  hint: string;
  /** Whether trying again can help. */
  retry: boolean;
  raw: string;
}

type Rule = [RegExp, string, string, boolean];

// First match wins: the specific before the general.
const RULES: Rule[] = [
  [/密钥错误|security key/, "115 安全密钥不对", "清空回收站需要 115 的 6 位安全密钥。", false],
  [/simplehttp tool does not support/, "SimpleHttp 下不了磁力链接", "工具换成网盘自带的离线下载（比如 115 Cloud），或者 aria2 / qBittorrent。", false],
  [/ed2k protocol is not supported/, "这个工具下不了 ed2k 链接", "换成 115 或迅雷的离线下载。", false],
  [/udf volumes? are not supported/, "这个光盘镜像打不开", "它是 UDF 格式的 ISO，网页里还不能直接浏览。下载后用本地播放器打开就行。", false],
  [/wrong archive password|archive password|bad password/, "压缩包密码不对", "再输入一次试试。", true],
  [/(not supported|unsupported|unknown format|not a valid|cannot open|invalid header|not an archive)/, "这个格式打不开", "网页里暂时看不了，下载到本地再打开。", false],
  [/share code|sharing code/, "提取码不对", "确认一下分享给你的提取码。", true],
  [/expired|no longer valid|invalid sharing/, "链接已失效", "分享已过期或被停用了。", false],
  [/sharing not found|share does not exist/, "分享不存在", "它可能已经被删除。", false],
  [/password is incorrect|need password|password/, "需要密码", "这个文件夹设了密码。", true],
  [/permission|forbidden|not allowed|access denied/, "没有权限", "这个操作需要管理员给你开通权限。", false],
  [/guest user is disabled|token|unauthorized|login/, "登录已过期", "重新登录一下就好。", false],
  [/tmdb is not configured/, "还没设置 TMDB", "管理员在 设置 › 影视库 里填上 TMDB 令牌后就能用。", false],
  [/outside the media library paths/, "这里不在影视库里", "管理员在 设置 › 影视库 的生效目录里加上这个文件夹后就能用。", false],
  [/mount path already used/, "这个挂载路径已经有存储了", "换一个路径，比如在后面加上文件夹名。", false],
  [/no such 115 storage|this storage is not working/, "这个 115 账号现在用不了", "先在存储列表里确认它是「工作中」，再回来选文件夹。", true],
  [/choose a folder and a mount path/, "还没选好", "选一个文件夹，再填挂载路径。", false],
  [/already exists?|file exists|\] exists|same name/, "已经有同名的文件", "换个名字，或者先处理掉同名的那个。", false],
  [/storage not found|failed get storage|storage is not|not mounted|storage.*disabled/, "这里的存储还没准备好", "稍后再试，或者请管理员检查一下存储。", true],
  [/object not found|not found|no such file|does not exist|not exist|404/, "找不到这个文件", "它可能被移动、改名或删除了，刷新一下看看。", true],
  [/\b405\b|waf|too many|rate limit|\b429\b|频繁/, "网盘有点忙", "请求太频繁，网盘暂时限流了。过一两分钟再试。", true],
  [/quota|no space|insufficient|capacity|空间不足/, "空间不够了", "清理一些文件后再试。", false],
  [/timeout|timed out|deadline|tls|\beof\b|connection (reset|refused|closed)|no such host|i\/o|broken pipe|bad gateway|502|503|504/, "网盘连接不稳定", "这次没连上网盘，重试一般就好。", true],
  [/failed to fetch|networkerror|load failed|network/, "网络断开了", "检查一下网络再重试。", true],
];

export function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export function explain(error: unknown): Explained {
  const raw = rawMessage(error);
  const text = raw.toLowerCase();
  // 115's own words for a refused offline link are already Chinese and say exactly what is wrong.
  const refused = /115 offline download: (.+?) \(code (-?\d+)\)/.exec(raw);
  if (refused) return { title: `115 没接受：${refused[1]}`, hint: "换一个链接，或在 115 的云下载里直接添加看看。", retry: false, raw };
  if (/not in 115's offline list/.test(text)) return { title: "115 的云下载里找不到这个任务", hint: "可能被 115 拒绝了，或在 115 里被删掉了。", retry: true, raw };
  for (const [pattern, title, hint, retry] of RULES) {
    if (pattern.test(text)) return { title, hint, retry, raw };
  }
  if (error instanceof ApiError) {
    if (error.code === 401) return { title: "登录已过期", hint: "重新登录一下就好。", retry: false, raw };
    if (error.code === 403) return { title: "没有权限", hint: "这个操作需要管理员给你开通权限。", retry: false, raw };
    if (error.code === 404) return { title: "找不到这个文件", hint: "它可能被移动、改名或删除了。", retry: true, raw };
    if (error.code === 429) return { title: "操作太频繁", hint: "歇一会儿再试。", retry: true, raw };
  }
  return { title: "这次没有成功", hint: "可能是网盘一时没有响应，稍后再试一次。", retry: true, raw };
}

/** For places with room for one line only. */
export function reason(error: unknown): string {
  const raw = rawMessage(error);
  if (raw) console.warn("[tgvio-web]", raw);
  return explain(error).title;
}
