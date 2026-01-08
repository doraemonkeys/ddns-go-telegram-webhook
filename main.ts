import { Bot, webhookCallback } from "grammy";

// --- 配置 ---
// 1. 从环境变量获取 Bot Token
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
if (!BOT_TOKEN) {
  console.error("❌ 环境变量 BOT_TOKEN 未设置!");
  Deno.exit(1);
}

// 2. 从环境变量获取你的公网地址或域名
// 例如: http://your_public_ip:8000 或 https://your_domain.com
const BASE_URL = Deno.env.get("BASE_URL");
if (!BASE_URL) {
  console.error("❌ 环境变量 BASE_URL 未设置! 请设置为你的公网可访问地址 (带端口 if needed) 例如: http://your_ip:8000");
  Deno.exit(1);
}

// 3. 从环境变量获取 Webhook Secret Token (用于增强安全性)
// 建议生成一个随机的、足够长的字符串作为 secret token
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
if (!WEBHOOK_SECRET) {
  console.error("❌ 环境变量 WEBHOOK_SECRET 未设置! 请设置一个随机且安全的字符串。");
  Deno.exit(1);
}


// --- 初始化 ---
const bot = new Bot(BOT_TOKEN);
const kv = await Deno.openKv(); // 打开 Deno KV 数据库

// --- KV 键结构 ---
// ["chat", chatId] -> webhookPath (string)
// ["webhook", webhookPath] -> chatId (number)

// --- Telegram 机器人命令处理 ---
bot.command("start", async (ctx) => {
  await ctx.reply(
    "你好! 我是一个用于接收 ddns-go Webhook 回调的机器人。\n" +
    "发送 /gethook 来获取你的专属 Webhook 配置信息。",
  );
});

bot.command("gethook", async (ctx) => {
  const chatId = ctx.chat.id;

  // 1. 检查是否已为该用户生成过 Webhook 路径
  const userEntry = await kv.get(["chat", chatId]);
  let webhookPath = userEntry.value as string | null;

  if (!webhookPath) {
    // 2. 如果没有，生成一个唯一的路径 (使用 UUID 的一部分)
    webhookPath = crypto.randomUUID().split('-')[0]; // 取 UUID 的第一段作为路径，通常足够唯一且不长

    // 3. 存储 Chat ID -> Webhook Path 和 Webhook Path -> Chat ID 的映射
    try {
      await kv.atomic()
        .set(["chat", chatId], webhookPath)
        .set(["webhook", webhookPath], chatId)
        .commit();
      console.log(`✅ 生成新的 webhook 路径 ${webhookPath} 给用户 ${chatId}`);
    } catch (error) {
      console.error(`❌ 存储 KV 时出错: ${error}`);
      await ctx.reply("❌ 抱歉，在生成 Webhook 时发生了错误。请稍后再试。");
      return;
    }
  } else {
    console.log(`用户 ${chatId} 已有 webhook 路径 ${webhookPath}`);
  }

  // 4. 构造 Webhook URL 和 RequestBody
  const ddnsWebhookUrl = `${BASE_URL}/ddns-webhook/${webhookPath}`; // 修改路径，更清晰

  // ddns-go 的 RequestBody 模板
  const requestBody = `\`\`\`json
{
    "server": "自定义服务器名称(可选)",
    "description": "自定义描述信息(可选)",
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
\`\`\``; // 使用 Markdown 代码块格式化 JSON

  // 5. 发送配置信息给用户
  await ctx.reply(
    `✅ 你的 ddns-go Webhook 配置信息：\n\n` +
    `🌐 **Webhook URL:**\n\`${ddnsWebhookUrl}\`\n\n` +
    `📝 **RequestBody (POST 方法):**\n${requestBody}\n\n` +
    `请将上述 Webhook URL 和 RequestBody 填写到 ddns-go 的 Webhook 设置中。\n` +
    `_注：server、description 字段可自定义以区分多台服务器，也可删除；未启用 IPv4 或 IPv6 可删除对应 Object_\n\n` +
    `当 ddns-go 更新成功时，我将在这里发送通知。`,
    { parse_mode: "Markdown" } // 使用 Markdown 格式发送消息
  );
});

// --- HTTP Webhook 服务器处理 ---

// 定义 Telegram Webhook 路径
const TELEGRAM_WEBHOOK_PATH = "/telegram-webhook"; // 可以自定义，但需要和 setWebhook 设置的一致
const TELEGRAM_WEBHOOK_ROUTE = new URLPattern({ pathname: TELEGRAM_WEBHOOK_PATH });

// 定义 ddns-go Webhook 路径
const DDNS_WEBHOOK_ROUTE = new URLPattern({ pathname: "/ddns-webhook/:uuid" }); // 使用新路径

// 创建 grammY 的 webhookCallback 处理函数
// handleUpdate 会验证 secret token
const handleTelegramWebhook = webhookCallback(bot, "std/http", {
  secretToken: WEBHOOK_SECRET,
});


// HTTP 请求处理函数
async function handler(req: Request): Promise<Response> {
  console.log(`➡️ 收到请求: ${req.method} ${req.url}`);

  // 1. 检查是否是 Telegram Webhook 请求
  const telegramMatch = TELEGRAM_WEBHOOK_ROUTE.exec(req.url);
  if (telegramMatch) {
    console.log(`   匹配到 Telegram Webhook 路径`);
    try {
      // 将请求交给 grammY 的 handleUpdate 处理
      const response = await handleTelegramWebhook(req);
      console.log(`   Telegram Webhook 处理完成, 状态码: ${response.status}`);
      return response;
    } catch (error) {
      console.error("❌ 处理 Telegram Webhook 时出错:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // 2. 检查是否是 ddns-go Webhook 请求
  const ddnsMatch = DDNS_WEBHOOK_ROUTE.exec(req.url);
  if (ddnsMatch) {
    const uuid = ddnsMatch.pathname.groups.uuid;
    if (!uuid) {
      console.warn(`   未匹配到 webhook 路径`);
      return new Response("Not Found (Invalid webhook path)", { status: 404 });
    }
    console.log(`   匹配到 ddns-go Webhook 路径, uuid: ${uuid}`);

    // 从 KV 中查找对应的 Chat ID
    const chatEntry = await kv.get(["webhook", uuid]);
    const chatId = chatEntry.value as number | null;

    if (!chatId) {
      // 路径不存在或找不到对应的用户
      console.warn(`   ddns-go Webhook UUID "${uuid}" 未找到对应的 Chat ID`);
      return new Response("Not Found (Invalid webhook path)", { status: 404 });
    }

    // 检查请求方法是否是 POST
    if (req.method !== "POST") {
      console.warn(`   ddns-go Webhook UUID "${uuid}" 收到非 POST 请求: ${req.method}`);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 解析请求体 JSON
    try {
      const body = await req.json();
      console.log(`   收到 ddns-go webhook body:`, JSON.stringify(body));

      // 格式化消息内容
      let messageText = "🌐 **DDNS-GO IP 更新通知**\n\n";

      // 可选：显示服务器名称（兼容旧版本，没有 server 字段也能正常工作）
      if (body.server) {
        messageText += `🖥️ 服务器: \`${body.server}\`\n`;
      }

      // 可选：显示描述信息
      if (body.description) {
        messageText += `📝 描述: ${body.description}\n`;
      }

      if (body.server || body.description) {
        messageText += "\n";
      }

      if (body.ipv4) {
        messageText += `**IPv4:**\n`;
        messageText += `  结果: \`${body.ipv4.result}\`\n`;
        if (body.ipv4.addr) messageText += `  地址: \`${body.ipv4.addr}\`\n`;
        if (body.ipv4.domains) messageText += `  域名: \`${body.ipv4.domains}\`\n`;
        messageText += "\n";
      }

      if (body.ipv6) {
        messageText += `**IPv6:**\n`;
        messageText += `  结果: \`${body.ipv6.result}\`\n`;
        if (body.ipv6.addr) messageText += `  地址: \`${body.ipv6.addr}\`\n`;
        if (body.ipv6.domains) messageText += `  域名: \`${body.ipv6.domains}\`\n`;
        messageText += "\n";
      }

      // 通过 Telegram 机器人发送消息给用户
      try {
        await bot.api.sendMessage(chatId, messageText, { parse_mode: "Markdown" });
        console.log(`   成功发送消息到 Chat ID ${chatId}`);
      } catch (telegramErr) {
        console.error(`   ❌ 发送 Telegram 消息到 ${chatId} 时出错:`, telegramErr);
        // 即使发送 Telegram 消息失败，仍然返回 200 给 ddns-go
      }

      // 返回成功响应给 ddns-go
      return new Response("OK", { status: 200 });

    } catch (jsonErr) {
      console.error(`   ❌ 解析 ddns-go webhook body 时出错:`, jsonErr);
      return new Response("Bad Request (Invalid JSON)", { status: 400 });
    }

  }

  // 3. 未匹配到任何已知路径
  console.warn(`   未匹配到已知路径: ${req.url}`);
  const redirectUrl = `https://github.com/doraemonkeys/ddns-go-telegram-webhook`;
  return new Response(null, {
    status: 302,
    headers: {
      "Location": redirectUrl,
    },
  });
}

// --- 启动服务器和设置 Webhook ---

const httpPort = 8000; // 你希望 Deno 监听的端口

// 在启动 HTTP 服务器之前，先设置 Telegram Webhook
const telegramWebhookUrl = `${BASE_URL}${TELEGRAM_WEBHOOK_PATH}`;
console.log(`⚙️ 正在设置 Telegram Webhook 到: ${telegramWebhookUrl}`);

try {
  const success = await bot.api.setWebhook(telegramWebhookUrl, {
    secret_token: WEBHOOK_SECRET,
    // max_connections: 40, // 可选参数，根据你的服务器能力设置
    // allowed_updates: ["message", "callback_query"], // 可选参数，只接收指定类型的更新
  });

  if (success) {
    console.log("✅ Telegram Webhook 设置成功!");
  } else {
    // bot.api.setWebhook 在失败时可能会抛出错误，但也可能返回 success: false
    console.error("❌ Telegram Webhook 设置失败 (API 返回 false)");
    // 可以尝试获取 getWebhookInfo 看看具体是什么问题
    const info = await bot.api.getWebhookInfo();
    console.error("Webhook Info:", info);
    // 如果是永久性错误，可能需要退出
    // Deno.exit(1); // 根据实际情况决定是否退出
  }

  // 启动 HTTP 服务器来监听传入的 Webhook 请求
  console.log(`🚀 启动 HTTP Webhook 服务器在端口 ${httpPort}`);
  // Deno.serve 是非阻塞的
  Deno.serve({ port: httpPort }, handler);
  console.log("服务器正在运行，等待传入的 Webhook 请求...");

} catch (error) {
  console.error("❌ 启动过程中发生错误:", error);
  console.error("请检查 BASE_URL 是否正确，以及网络是否能访问 Telegram API。");
  Deno.exit(1); // 启动失败，退出程序
}

// 注意: 在 Webhook 模式下，bot.start() 是不需要的，因为它用于 polling
// 程序会因为 Deno.serve 的运行而保持活跃