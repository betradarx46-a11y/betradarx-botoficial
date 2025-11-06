import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import TelegramBot from 'node-telegram-bot-api';

const sendTelegramMessage = createTool({
  id: "send-telegram-message",
  description: "Sends a message via Telegram Bot API",
  inputSchema: z.object({
    message: z.string().describe("The message to send"),
    parseMode: z.enum(["HTML", "Markdown"]).optional().describe("Message formatting mode")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [sendTelegramMessage] Starting execution");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      logger?.error("\u274C [sendTelegramMessage] Missing credentials", {
        hasToken: !!token,
        hasChatId: !!chatId
      });
      return {
        success: false,
        error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured"
      };
    }
    try {
      const bot = new TelegramBot(token);
      logger?.info("\u{1F4E4} [sendTelegramMessage] Sending message", {
        messageLength: context.message.length,
        parseMode: context.parseMode
      });
      const options = {};
      if (context.parseMode) {
        options.parse_mode = context.parseMode;
      }
      const result = await bot.sendMessage(chatId, context.message, options);
      logger?.info("\u2705 [sendTelegramMessage] Message sent successfully", {
        messageId: result.message_id
      });
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger?.error("\u274C [sendTelegramMessage] Error sending message", {
        error: error.message
      });
      return {
        success: false,
        error: error.message || "Unknown error occurred"
      };
    }
  }
});

export { sendTelegramMessage };
//# sourceMappingURL=5e744f94-7780-4157-8b8a-0e18dbc24025.mjs.map
