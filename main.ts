import { Bot, webhookCallback } from "grammy";

// 从环境变量获取 Telegram Bot Token
// 在 Deno Deploy 项目设置中配置 BOT_TOKEN
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN environment variable not set.");
  // Deno Deploy 会检查 envs，所以运行时如果没有通常是部署配置问题
}

// 初始化 GramJS Bot 实例
const bot = new Bot(BOT_TOKEN || ""); // 如果 BOT_TOKEN 为空，bot 不会正常工作

// 打开 Deno KV 数据库
// Deno Deploy 会自动提供对项目关联 KV 的访问
const kv = await Deno.openKv();

// 定义预期的 DDNS-Go Webhook JSON 结构类型
interface DdnsGoIPDetail {
  result: "OK" | "FAIL" | "NO_CHANGE";
  addr: string; // IP 地址
  domains: string; // 受影响的域名列表, 逗号分隔
}

interface DdnsGoWebhookBody {
  ipv4?: DdnsGoIPDetail;
  ipv6?: DdnsGoIPDetail;
}


// --- Telegram Bot Logic ---

// 处理 /start 命令
bot.command("start", async (ctx) => {
  await ctx.reply("你好！我是 DDNS-Go Webhook 通知机器人。发送 /gethook 获取你的专属 Webhook URL 和配置信息。");
});

// 处理 /gethook 命令
bot.command("gethook", async (ctx) => {
  const chatId = ctx.chat.id;

  // 生成一个唯一的 ID 作为 Webhook 路径的一部分
  const hookId = crypto.randomUUID();

  // 将 hookId 与 chatId 关联存储到 Deno KV
  // Key: ["hook", hookId], Value: chatId
  await kv.set(["hook", hookId], chatId);

  // 构造 Webhook URL placeholder
  // 用户需要手动替换 YOUR_DENO_DEPLOY_PROJECT_NAME.deno.dev
  const placeholderWebhookUrl = `https://YOUR_DENO_DEPLOY_PROJECT_NAME.deno.dev/webhook/${hookId}`;

  // 建议的 Request Body 格式
  const requestBodyExample = `\`\`\`json
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
\`\`\`
**注：**如果你的 DDNS-Go 未启用 IPv4 或 IPv6，请删除对应的 \`ipv4\` 或 \`ipv6\` 对象。`;


  await ctx.reply(
    `好的，这是你的专属 DDNS-Go Webhook 配置信息：\n\n` +
    `**1. Webhook URL:**\n\`${placeholderWebhookUrl}\`\n\n` +
    `**重要提示：**请将 \`YOUR_DENO_DEPLOY_PROJECT_NAME.deno.dev\` 替换为你实际的 Deno Deploy 项目域名！\n\n` +
    `**2. Request Method:** \`POST\`\n\n` +
    `**3. Request Body:**\n` + requestBodyExample + `\n\n` +
    `请将上述 URL 和 Body 配置到你的 DDNS-Go Webhook 设置中。当 IP 发生变化时，我会通知你。`,
    { parse_mode: "Markdown" } // 使用 Markdown 格式发送，URL 和 JSON 可以用代码块显示
  );

  console.log(`Generated hook ${hookId} for chat ${chatId}`);
});


// --- HTTP Server Logic ---

// 创建一个处理 Telegram webhook update 的函数
// Deno Deploy 接收 Telegram updates 到 / 的 POST 请求
// 使用 "callback" 适配器，因为它返回一个标准的请求处理函数
const handleTelegramUpdate = webhookCallback(bot, "callback");

// HTTP 请求处理函数
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  console.log(`Received request: ${request.method} ${pathname}`);

  // 根路径，处理 Telegram 更新或简单的健康检查
  if (pathname === "/") {
    if (request.method === "POST") {
      try {
        // 将 Request 对象传递给 handleTelegramUpdate 函数
        return await handleTelegramUpdate(request);
      } catch (e) {
        console.error("Error handling Telegram update:", e);
        // 在生产环境中，不建议将内部错误信息直接返回给客户端
        return new Response("Internal Server Error (Telegram handler)", { status: 500 });
      }
    } else {
      return new Response("DDNS-Go Telegram Webhook Bot is running!", { status: 200 });
    }
  }

  // DDNS-Go Webhook 路径
  // 格式为 /webhook/:hookId
  const webhookMatch = pathname.match(/^\/webhook\/([^/]+)$/);
  if (request.method === "POST" && webhookMatch) {
    const hookId = webhookMatch[1];
    console.log(`Received webhook for hookId: ${hookId}`);

    // 从 KV 获取对应的 Chat ID
    const entry = await kv.get<number>(["hook", hookId]);

    if (!entry || entry.value === null) {
      console.warn(`Invalid or not found hookId: ${hookId}`);
      return new Response("Invalid hook ID", { status: 404 });
    }

    const chatId = entry.value;

    try {
      // 验证 Content-Type 是否是 JSON
      const contentType = request.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        console.warn(`Received non-JSON webhook body for hookId: ${hookId}`);
        return new Response("Bad Request: Content-Type must be application/json", { status: 415 }); // 415 Unsupported Media Type
      }

      // 解析 JSON 请求体
      let body: DdnsGoWebhookBody;
      try {
        body = await request.json();
        console.log("Webhook body parsed:", body);
      } catch (e) {
        console.error("Failed to parse JSON body for hookId:", hookId, e);
        return new Response("Bad Request: Invalid JSON body", { status: 400 });
      }

      // 构造通知消息
      let messageText = `🤖 DDNS-Go IP 更新通知：\n\n`;
      let notificationSent = false; // 标记是否有需要用户关注的更新（OK 或 FAIL）

      // 处理 IPv4 更新
      if (body.ipv4) {
        messageText += `🌐 IPv4 更新结果: \`${body.ipv4.result}\`\n`;
        if (body.ipv4.result === "OK") {
          messageText += `  地址: \`${body.ipv4.addr}\`\n`;
          messageText += `  域名: \`${body.ipv4.domains}\`\n`;
          notificationSent = true;
        } else if (body.ipv4.result === "FAIL") {
          messageText += `  详细信息: ${body.ipv4.addr || 'N/A'} (见ddns-go日志)\n`; // addr在FAIL时可能包含错误信息
          notificationSent = true; // FAIL 也需要通知用户
        }
        // 如果是 NO_CHANGE，不添加额外信息，只保留结果行
      }

      // 处理 IPv6 更新
      if (body.ipv6) {
        messageText += `🌐 IPv6 更新结果: \`${body.ipv6.result}\`\n`;
        if (body.ipv6.result === "OK") {
          messageText += `  地址: \`${body.ipv6.addr}\`\n`;
          messageText += `  域名: \`${body.ipv6.domains}\`\n`;
          notificationSent = true;
        } else if (body.ipv6.result === "FAIL") {
          messageText += `  详细信息: ${body.ipv6.addr || 'N/A'} (见ddns-go日志)\n`; // addr在FAIL时可能包含错误信息
          notificationSent = true; // FAIL 也需要通知用户
        }
        // 如果是 NO_CHANGE，不添加额外信息，只保留结果行
      }

      // 如果既没有 IPv4 也没有 IPv6 信息，或者两者都有但都是 NO_CHANGE，可以添加一条提示
      // 仅在没有发送过需要用户关注的通知时执行
      if (!notificationSent) {
        if (!body.ipv4 && !body.ipv6) {
          console.warn(`Webhook body for hookId ${hookId} contains neither ipv4 nor ipv6 objects.`);
          // 不向用户发送消息，因为可能是ddns-go配置不包含任何IP
          // 但可以返回400让ddns-go知道格式有问题
          return new Response("Bad Request: Webhook body must contain ipv4 or ipv6 object", { status: 400 });
        } else {
          // 既有ipv4/ipv6对象，但结果都不是OK或FAIL (即都是NO_CHANGE)，则发送一个无变化的通知
          messageText += "本次 IP 检测无变化（NO_CHANGE）。";
          await bot.api.sendMessage(chatId, messageText.trim(), { parse_mode: "Markdown" });
        }
      } else {
        // 如果有OK或FAIL结果，发送包含详细信息的通知
        await bot.api.sendMessage(chatId, messageText.trim(), { parse_mode: "Markdown" });
      }


      console.log(`Processed webhook for hook ${hookId} and potentially sent notification to chat ${chatId}`);

      // 无论是否发送了通知消息，只要 webhook 处理成功且格式正确，都返回 OK 给 ddns-go
      return new Response("OK", { status: 200 });

    } catch (error) {
      console.error(`Error processing webhook for hookId ${hookId}:`, error);
      // 更详细的错误响应，但发送给ddns-go，它可能不处理
      return new Response(`Internal Server Error: ${error}`, { status: 500 });
    }
  }

  // 其他未知路径
  return new Response("Not Found", { status: 404 });
}

// 启动 HTTP 服务器
Deno.serve(handler);

console.log("HTTP server started on port 8000"); // Deno Deploy 使用 8000 端口