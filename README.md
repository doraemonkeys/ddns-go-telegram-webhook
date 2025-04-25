# ddns-go-telegram-webhook

[![github action](https://github.com/doraemonkeys/ddns-go-telegram-webhook/actions/workflows/deploy.yml/badge.svg)](https://github.com/doraemonkeys/ddns-go-telegram-webhook/actions)





## 使用



1. 打开并启用 [ddns-go-Webhook](https://t.me/ddns_webhook777_bot)
2. 发送 `/gethook` 命令
3. 复制 Webhook URL 并粘贴
4. 复制 RequestBody 并粘贴

注：未启用 IPv4 或 IPv6 可删除对应 Object

```json
{
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

![Deploy](https://dash.deno.com/new?url=https://raw.githubusercontent.com/doraemonkeys/ddns-go-telegram-webhook/main/main.ts;env=BOT_TOKEN,BASE_URL,WEBHOOK_SECRET)




程序需要以下三个环境变量才能运行。

*   `BOT_TOKEN`: 您的 Telegram 机器人 Bot Token。
*   `BASE_URL`: 您的服务公网可访问的基准 URL (例如: `https://your_domain.com` 或 `http://your_public_ip:8000`)。**重要：这个 URL 必须以 `http://` 或 `https://` 开头，且不包含末尾的 `/`。**
*   `WEBHOOK_SECRET`: 您生成的 Webhook Secret Token。
