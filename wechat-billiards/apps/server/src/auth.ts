import { createHash, randomBytes } from "node:crypto";

export interface AuthenticatedUser {
  userId: string;
  displayName: string;
  sessionToken: string;
  expiresAt: number;
}

interface LoginInput {
  code?: string;
  token?: string;
  displayName?: string;
}

interface IdentityProvider {
  identify(code: string): Promise<{ userId: string }>;
}

export class LocalIdentityProvider implements IdentityProvider {
  async identify(code: string) {
    return {
      userId: `dev-${createHash("sha256").update(code).digest("hex").slice(0, 20)}`,
    };
  }
}

export class WeChatIdentityProvider implements IdentityProvider {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  async identify(code: string) {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("微信登录服务不可用");
    const data = (await response.json()) as {
      openid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!response.ok || data.errcode || !data.openid) {
      throw new Error(
        `微信登录凭证无效${data.errcode ? `（${data.errcode}）` : ""}`,
      );
    }
    return {
      userId: `wx-${createHash("sha256").update(data.openid).digest("hex").slice(0, 32)}`,
    };
  }
}

function cleanName(value: string | undefined, fallback: string): string {
  const name = Array.from(value ?? fallback)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  return (name || fallback).slice(0, 24);
}

export class AuthService {
  private readonly sessions = new Map<string, AuthenticatedUser>();
  private readonly provider: IdentityProvider;

  constructor(provider?: IdentityProvider) {
    if (provider) this.provider = provider;
    else if (process.env.WX_APP_ID && process.env.WX_APP_SECRET) {
      this.provider = new WeChatIdentityProvider(
        process.env.WX_APP_ID,
        process.env.WX_APP_SECRET,
      );
    } else if (
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_LOCAL_AUTH === "true"
    ) {
      this.provider = new LocalIdentityProvider();
    } else {
      throw new Error("生产环境必须配置 WX_APP_ID 和 WX_APP_SECRET");
    }
  }

  async login(input: LoginInput): Promise<AuthenticatedUser> {
    if (input.token) {
      const existing = this.sessions.get(input.token);
      if (existing && existing.expiresAt > Date.now()) return existing;
      if (input.token) this.sessions.delete(input.token);
      if (!input.code) throw new Error("登录已过期，请重新登录");
    }
    if (!input.code) throw new Error("缺少微信登录 code");
    const identity = await this.provider.identify(input.code);
    const user: AuthenticatedUser = {
      userId: identity.userId,
      displayName: cleanName(
        input.displayName,
        identity.userId.startsWith("dev-") ? "练习玩家" : "微信球友",
      ),
      sessionToken: randomBytes(32).toString("base64url"),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    this.sessions.set(user.sessionToken, user);
    if (this.sessions.size > 10000) {
      for (const [token, session] of this.sessions) {
        if (session.expiresAt <= Date.now()) this.sessions.delete(token);
      }
    }
    return user;
  }
}
