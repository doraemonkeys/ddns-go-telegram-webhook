# ddns-go-telegram-webhook

[![github action](https://github.com/doraemonkeys/ddns-go-telegram-webhook/actions/workflows/deploy.yml/badge.svg)](https://github.com/doraemonkeys/ddns-go-telegram-webhook/actions)





## 使用



1. 打开并启用 [ddns-go-Webhook](https://t.me/ddns_webhook777_bot)
2. 发送 `/gethook` 命令
3. 复制 Webhook URL 并粘贴
4. 复制 RequestBody 并粘贴

注：`server` 字段可自定义名称以区分多台服务器，也可删除；未启用 IPv4 或 IPv6 可删除对应 Object

```json
{
    "server": "自定义服务器名称(可选)",
    "ipv4": {
        "result": "#{ipv4Result}",
        "addr": "#{ipv4Addr}",
        "domains": "#{ipv4Domains}"
    },
    "ipv6": {
        "result": "#{ipv6Result}",
        "addr": "#{ipv6Addr}",
        "domains": "#{ipv6Domains}"
    }
}
```



## Deploy

[Deno Deploy](https://dash.deno.com/new?url=https://raw.githubusercontent.com/doraemonkeys/ddns-go-telegram-webhook/main/main.ts&amp;env=BOT_TOKEN,BASE_URL,WEBHOOK_SECRET)




程序需要以下三个环境变量才能运行。

*   `BOT_TOKEN`: 您的 Telegram 机器人 Bot Token。
*   `BASE_URL`: 您的服务公网可访问的基准 URL (例如: `https://your_domain.com` 或 `http://your_public_ip:8000`)。**重要：这个 URL 必须以 `http://` 或 `https://` 开头，且不包含末尾的 `/`。**
*   `WEBHOOK_SECRET`: 您生成的 Webhook Secret Token。



## Fork 部署指南

如果你想 Fork 本仓库并部署自己的实例，需要修改以下内容：

### 必须配置

1. **创建 Telegram Bot**
   - 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)
   - 发送 `/newbot` 创建新机器人
   - 保存获得的 `BOT_TOKEN`

2. **创建 Deno Deploy 项目**
   - 前往 [Deno Deploy](https://dash.deno.com/) 创建新项目
   - 关联你 Fork 的 GitHub 仓库
   - 记下项目名称（如 `my-ddns-webhook`）

3. **修改 GitHub Actions 配置**
   - 编辑 `.github/workflows/deploy.yml` 第 37 行
   - 将 `project: "ddns-go-tel"` 改为你的项目名

   ```yaml
   - name: Upload to Deno Deploy
     uses: denoland/deployctl@v1
     with:
       project: "你的项目名"  # 修改这里
       entrypoint: "main.ts"
   ```

4. **设置环境变量** (在 Deno Deploy 控制台配置)
   | 变量名 | 说明 |
   |--------|------|
   | `BOT_TOKEN` | 上一步从 BotFather 获取的 Token |
   | `BASE_URL` | Deno Deploy 分配的域名，如 `https://your-project.deno.dev` |
   | `WEBHOOK_SECRET` | 自定义一个随机安全字符串，如 `openssl rand -hex 32` 生成 |